// App.js
import React, { useEffect, useRef, useState, useCallback } from "react";
import ConnectionScreen from "./screens/connection/ConnectionScreen";
import AppScreen from "./screens/app/AppScreen";
import io from "socket.io-client";
import { useDispatch } from "react-redux";
import {
  setUserConnectionId, setRemoteConnectionId,
  setSessionMode, setSessionStartTime, setShowSessionDialog,
} from "./states/connectionSlice";
import { Peer } from "peerjs";
import SourcePicker from "./components/Sourcepicker";
import CONFIG from "./config";

const { ipcRenderer } = window.require("electron");

const getMicStream = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log("🎤 Mic acquired:", stream.getAudioTracks().map(t => t.label));
    return stream;
  } catch (e) {
    console.warn("🎤 Mic unavailable:", e.message);
    const dest = new AudioContext().createMediaStreamDestination();
    return dest.stream;
  }
};

const makeDummyVideoTrack = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 2; canvas.height = 2;
  const ctx = canvas.getContext("2d");
  let tick = 0;
  const draw = () => {
    ctx.fillStyle = tick++ % 2 === 0 ? "#000001" : "#000000";
    ctx.fillRect(0, 0, 2, 2);
  };
  draw();
  const stream = canvas.captureStream(30);
  const track  = stream.getVideoTracks()[0];
  const iv     = setInterval(draw, 33);
  track._stop  = () => clearInterval(iv);
  return track;
};

const unlockAudio = (audioEl) => {
  if (!audioEl) { console.warn("🔊 unlockAudio: no element"); return; }
  try {
    const ac   = new AudioContext();
    const buf  = ac.createBuffer(1, 1, ac.sampleRate);
    const src  = ac.createBufferSource();
    src.buffer = buf;
    const dest       = ac.createMediaStreamDestination();
    src.connect(dest);
    src.start();
    const unlockStream = dest.stream;
    audioEl.srcObject  = unlockStream;
    audioEl.volume     = 0;
    audioEl.muted      = false;
    audioEl.play()
      .then(() => {
        console.log("🔊 Audio pre-unlocked ✅");
        src.stop();
        ac.close();
        if (audioEl.srcObject === unlockStream) {
          audioEl.srcObject = null;
          audioEl.volume    = 1.0;
        }
      })
      .catch(e => console.warn("🔊 unlockAudio failed:", e.message));
  } catch (e) {
    console.warn("🔊 unlockAudio error:", e.message);
  }
};

const buildHostAudioMix = (desktopAudioTrack, micTrack) => {
  const audioCtx   = new AudioContext();
  const destination = audioCtx.createMediaStreamDestination();

  if (desktopAudioTrack) {
    const desktopStream  = new MediaStream([desktopAudioTrack]);
    const desktopSource  = audioCtx.createMediaStreamSource(desktopStream);
    desktopSource.connect(destination);
    console.log("🔊 Desktop audio connected to mixer ✅");
  }

  const micGain = audioCtx.createGain();
  micGain.gain.value = 0;
  if (micTrack) {
    const micStream  = new MediaStream([micTrack]);
    const micSource  = audioCtx.createMediaStreamSource(micStream);
    micSource.connect(micGain);
    console.log("🎤 Mic connected to mixer (muted) ✅");
  }
  micGain.connect(destination);

  const mixedTrack = destination.stream.getAudioTracks()[0];
  console.log("🔊 Mixed audio track created:", mixedTrack?.label);

  return { audioCtx, mixedTrack, micGain };
};

const wireHostAudio = (call, audioRef) => {
  let audioSetup = false;

  const playTrack = (track) => {
    if (track.kind !== "audio") return;
    if (audioSetup) { console.log("🔊 wireHostAudio: duplicate ignored"); return; }
    audioSetup = true;

    const audioEl = audioRef.current;
    if (!audioEl) { console.warn("🔊 hostAudioRef null"); return; }

    console.log(`🔊 Host got viewer audio: state=${track.readyState} enabled=${track.enabled}`);
    const ms = new MediaStream([track]);
    audioEl.srcObject = ms;
    audioEl.volume    = 1.0;
    audioEl.muted     = false;
    audioEl.play()
      .then(() => console.log("🔊 Host audio playing ✅"))
      .catch(e  => console.warn("🔊 host audio.play():", e.message));
  };

  let polls = 0;
  const attach = () => {
    const pc = call.peerConnection;
    if (!pc) {
      if (polls++ < 200) setTimeout(attach, 25);
      else console.warn("🔊 peerConnection never appeared");
      return;
    }
    console.log(`🔊 pc found (poll=${polls})`);
    pc.addEventListener("track", ev => {
      console.log(`🔊 pc.track: ${ev.track.kind} state=${ev.track.readyState}`);
      playTrack(ev.track);
    });
    pc.getReceivers().forEach(r => { if (r.track) playTrack(r.track); });
  };
  attach();

  call.on("stream", stream => {
    console.log("🔊 call.on(stream):", stream.getTracks().map(t => `${t.kind} ${t.readyState}`));
    stream.getAudioTracks().forEach(playTrack);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
const App = () => {
  const dispatch = useDispatch();

  const peerInstance      = useRef(null);
  const socketRef         = useRef(null);
  const callRef           = useRef(null);
  const remoteStreamRef   = useRef(null);
  const remoteIdRef       = useRef("");
  const userIdRef         = useRef("");
  const localMicStreamRef = useRef(null);
  const localMicTrackRef  = useRef(null);
  const dummyTrackRef     = useRef(null);
  const hostAudioCtxRef   = useRef(null);
  const hostMicGainRef    = useRef(null);
  const localStreamRef    = useRef(null);

  const hostAudioRef   = useRef(null);
  const viewerAudioRef = useRef(null);

  const [myId,             setMyId]            = useState("");
  const [currentScreen,    setCurrentScreen]   = useState("home");
  const [remoteStream,     setRemoteStream]    = useState(null);
  const [sessionEnded,     setSessionEnded]    = useState(false);
  const [callRejected,     setCallRejected]    = useState(false);
  const [incomingCall,     setIncomingCall]    = useState(null);
  const [incomingCallerId, setIncomingCallerId]= useState("");
  const [sources,          setSources]         = useState([]);
  const [showPicker,       setShowPicker]      = useState(false);
  const [pendingCall,      setPendingCall]     = useState(null);
  // FIX: Start sessionReset at null so ConnectionScreen can distinguish
  // "never reset" (null) from "first reset" (1). The old value of 0 was
  // falsy, causing the reset effect in ConnectionScreen to be skipped on
  // the very first disconnect — leaving `connecting:true` and the Remote
  // Connection ID input unclickable.
  const [sessionReset, setSessionReset] = useState(null);

  const stopMic = useCallback(() => {
    if (localMicStreamRef.current) {
      localMicStreamRef.current.getTracks().forEach(t => { t.enabled = false; t.stop(); });
      localMicStreamRef.current = null;
    }
    localMicTrackRef.current = null;
    if (dummyTrackRef.current) {
      dummyTrackRef.current._stop?.();
      dummyTrackRef.current.stop();
      dummyTrackRef.current = null;
    }
    if (hostAudioCtxRef.current) {
      hostAudioCtxRef.current.close().catch(() => {});
      hostAudioCtxRef.current = null;
      hostMicGainRef.current  = null;
    }
    console.log("🎤 Mic stopped, audio mixer closed");
  }, []);

  const stopAllAudio = useCallback(() => {
    [hostAudioRef, viewerAudioRef].forEach(ref => {
      if (ref.current) { ref.current.srcObject = null; ref.current.pause(); }
    });
  }, []);

  useEffect(() => {
    const uid = String(Math.floor(Math.random() * 9000000000) + 1000000000);
    setMyId(uid);
    userIdRef.current = uid;
    dispatch(setUserConnectionId(uid));

    const socket = io(CONFIG.SOCKET_URL, {
      reconnectionDelay: 1000,
      transports: ["polling", "websocket"],
      extraHeaders: { "ngrok-skip-browser-warning": "true" },
    });
    socketRef.current = socket;

    socket.on("connect",            () => { console.log("🟢 Socket:", socket.id); socket.emit("join", "User" + uid); });
    socket.on("disconnect",         r  => console.warn("🔴 Socket:", r));
    socket.on("connect_error",      e  => console.error("🔴 Socket:", e.message));
    socket.on("remotedisconnected", () => setSessionEnded(true));
    socket.on("callrejected", () => {
      setCallRejected(true); setCurrentScreen("home");
      if (callRef.current) { callRef.current.close(); callRef.current = null; }
    });
    socket.on("mousemove",         e => ipcRenderer.send("mousemove",         e));
    socket.on("mousedown",         e => ipcRenderer.send("mousedown",         e));
    socket.on("mouseup",           e => ipcRenderer.send("mouseup",           e));
    socket.on("dblclick",          e => ipcRenderer.send("dblclick",          e));
    socket.on("scroll",            e => ipcRenderer.send("scroll",            e));
    socket.on("keydown",           e => ipcRenderer.send("keydown",           e));
    socket.on("keyup",             e => ipcRenderer.send("keyup",             e));
    socket.on("stream-resolution", e => ipcRenderer.send("stream-resolution", e));

    const peer = new Peer(uid, {
      host: CONFIG.PEER_HOST, port: CONFIG.PEER_PORT,
      path: CONFIG.PEER_PATH, secure: CONFIG.PEER_SECURE, debug: 2,
      config: { iceServers: [
        { urls: "stun:stun.l.google.com:19302"  },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
      ]},
    });
    peer.on("open",         id  => console.log("✅ PeerJS:", id));
    peer.on("disconnected", ()  => { if (!peer.destroyed) peer.reconnect(); });
    peer.on("error",        err => {
      console.error("❌ Peer:", err.type, err.message);
      if (err.type === "unavailable-id") window.location.reload();
    });
    peer.on("call", call => { setIncomingCall(call); setIncomingCallerId(call.peer); });

    peerInstance.current = peer;

    const onWillClose = () => {
      console.log("🚪 App closing — notifying remote side...");
      const rid = remoteIdRef.current;
      if (socket.connected && rid) {
        socket.emit("remotedisconnected", { remoteId: rid });
        console.log("📡 Sent remotedisconnected to", rid);
      }
      if (callRef.current) {
        callRef.current.close();
        callRef.current = null;
      }
      setTimeout(() => {
        socket.disconnect();
        ipcRenderer.send("cleanup-done");
      }, 300);
    };
    ipcRenderer.on("app-will-close", onWillClose);

    return () => {
      ipcRenderer.removeListener("app-will-close", onWillClose);
      socket.disconnect();
      peer.destroy();
      stopMic();
      stopAllAudio();
    };
  }, []);

  const resetSession = useCallback(() => {
    // FIX: Always release global capture FIRST before any state changes.
    // This is critical — if controlActive is still true in electron.js,
    // it intercepts mouse clicks via globalShortcut, making the Remote
    // Connection ID input appear unclickable after returning to home screen.
    ipcRenderer.send("set-global-capture", false);

    // FIX: Also send session-ended so electron.js clears sessionActive flag
    ipcRenderer.send("session-ended");

    setCurrentScreen("home");
    setRemoteStream(null);
    remoteStreamRef.current  = null;
    localStreamRef.current   = null;
    remoteIdRef.current      = "";
    dispatch(setShowSessionDialog(false));
    dispatch(setSessionMode(-1));
    stopMic();
    stopAllAudio();

    // FIX: Increment from null-safe base. Using functional update ensures
    // we always get a truthy number (1, 2, 3...) that ConnectionScreen's
    // useEffect will never skip due to falsy check.
    setSessionReset(prev => (prev === null ? 1 : prev + 1));

    console.log("🔄 Session reset");
  }, [stopMic, stopAllAudio]);

  // ── HOST: Accept ──────────────────────────────────────────────────────────
  const acceptCall = useCallback(async () => {
    const call = incomingCall;
    setIncomingCall(null); setIncomingCallerId("");
    setPendingCall(call);
    unlockAudio(hostAudioRef.current);
    const srcs = await ipcRenderer.invoke("GET_SOURCES");
    setSources(srcs); setShowPicker(true);
  }, [incomingCall]);

  const rejectCall = useCallback(() => {
    const call = incomingCall; const callerId = incomingCallerId;
    setIncomingCall(null); setIncomingCallerId("");
    if (call) call.close();
    socketRef.current?.emit("callrejected", { remoteId: callerId });
  }, [incomingCall, incomingCallerId]);

  // ── HOST: source selected → answer ───────────────────────────────────────
  const onSourceSelected = useCallback(async (sourceId) => {
    setShowPicker(false);
    const call = pendingCall;
    if (!call) return;

    await ipcRenderer.invoke("MINIMIZE_WIN");
    await new Promise(r => setTimeout(r, 500));

    const tryCapture = (withAudio) => navigator.mediaDevices.getUserMedia({
      audio: withAudio ? { mandatory: { chromeMediaSource: "desktop" } } : false,
      video: { mandatory: {
        chromeMediaSource: "desktop", chromeMediaSourceId: sourceId,
        minWidth: 1280, maxWidth: 1920, minHeight: 720, maxHeight: 1080,
      }},
    });

    try {
      let screenStream;
      try   { screenStream = await tryCapture(true);  }
      catch { screenStream = await tryCapture(false); }

      const desktopAudioTrack = screenStream.getAudioTracks()[0] ?? null;
      const screenVideoTrack  = screenStream.getVideoTracks()[0];

      const micStream = await getMicStream();
      const micTrack  = micStream.getAudioTracks()[0] ?? null;
      localMicStreamRef.current = micStream;
      localMicTrackRef.current  = micTrack;

      const { audioCtx, mixedTrack, micGain } = buildHostAudioMix(desktopAudioTrack, micTrack);
      hostAudioCtxRef.current = audioCtx;
      hostMicGainRef.current  = micGain;

      const combined = new MediaStream();
      if (screenVideoTrack) combined.addTrack(screenVideoTrack);
      combined.addTrack(mixedTrack);

      localStreamRef.current = combined;

      console.log("📡 Host answering:", combined.getTracks().map(t => `${t.kind} label="${t.label}"`));

      wireHostAudio(call, hostAudioRef);
      call.answer(combined);

      callRef.current     = call;
      remoteIdRef.current = call.peer;
      dispatch(setRemoteConnectionId(call.peer));
      dispatch(setSessionMode(0));
      dispatch(setSessionStartTime(new Date()));
      dispatch(setShowSessionDialog(false));
      ipcRenderer.send("session-started");
      setTimeout(() => ipcRenderer.invoke("RESTORE_WIN"), 1000);
      call.on("close", resetSession);
      call.on("error", e => console.error("Host call error:", e));
    } catch (e) {
      ipcRenderer.invoke("RESTORE_WIN");
      alert("Screen capture failed: " + e.message);
      socketRef.current?.emit("callrejected", { remoteId: call.peer });
    }
  }, [pendingCall, resetSession]);

  // ── VIEWER: call the host ─────────────────────────────────────────────────
  const startCall = useCallback(async (remoteId) => {
    const peer = peerInstance.current;
    if (!peer || peer.destroyed) { alert("Not connected to server yet."); return; }

    unlockAudio(viewerAudioRef.current);

    dispatch(setRemoteConnectionId(remoteId));
    remoteIdRef.current = remoteId;

    const micStream  = await getMicStream();
    const micTrack   = micStream.getAudioTracks()[0];
    localMicStreamRef.current = micStream;
    localMicTrackRef.current  = micTrack;

    const dummyVideo = makeDummyVideoTrack();
    dummyTrackRef.current = dummyVideo;

    const outStream = new MediaStream();
    outStream.addTrack(dummyVideo);
    if (micTrack) outStream.addTrack(micTrack);

    console.log("📞 Viewer calling:", outStream.getTracks().map(t => `${t.kind} enabled=${t.enabled}`));

    const call = peer.call(String(remoteId), outStream);
    if (!call) { alert("Could not reach that peer."); return; }

    setTimeout(() => {
      if (localMicTrackRef.current) {
        localMicTrackRef.current.enabled = false;
        console.log("🔇 Viewer mic muted (default)");
      }
    }, 200);

    callRef.current = call;
    setCurrentScreen("viewing");

    call.on("stream", stream => {
      console.log("🎉 Viewer stream:", stream.getTracks().map(t => `${t.kind} en=${t.enabled} state=${t.readyState}`));
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
      dispatch(setSessionMode(1));
      dispatch(setSessionStartTime(new Date()));
    });
    call.on("error", err => { console.error("Call error:", err); resetSession(); });
    call.on("close", ()  => resetSession());
  }, [resetSession]);

  useEffect(() => { if (sessionEnded) { resetSession(); setSessionEnded(false); } }, [sessionEnded]);
  useEffect(() => {
    if (callRejected) { const t = setTimeout(() => setCallRejected(false), 4000); return () => clearTimeout(t); }
  }, [callRejected]);

  const handleDisconnect = useCallback(() => {
    const rid = remoteIdRef.current;
    if (socketRef.current && rid) socketRef.current.emit("remotedisconnected", { remoteId: rid });
    if (callRef.current) { callRef.current.close(); callRef.current = null; }
    resetSession();
  }, [resetSession]);

  const audioElements = (
    <>
      <audio ref={hostAudioRef}   style={{ display:"none" }} />
      <audio ref={viewerAudioRef} style={{ display:"none" }} />
    </>
  );

  if (currentScreen === "viewing") {
    return (
      <>
        {audioElements}
        <AppScreen
          remoteStream={remoteStream}
          remoteStreamRef={remoteStreamRef}
          socketRef={socketRef}
          callRef={callRef}
          remoteIdRef={remoteIdRef}
          userIdRef={userIdRef}
          localMicTrackRef={localMicTrackRef}
          audioRef={viewerAudioRef}
          onDisconnect={handleDisconnect}
          onEndSession={handleDisconnect}
        />
      </>
    );
  }

  return (
    <>
      {audioElements}
      <ConnectionScreen
        myId={myId}
        socketRef={socketRef}
        remoteIdRef={remoteIdRef}
        userIdRef={userIdRef}
        localMicTrackRef={localMicTrackRef}
        hostMicGainRef={hostMicGainRef}
        localStreamRef={localStreamRef}
        callRef={callRef}
        incomingCall={incomingCall}
        incomingCallerId={incomingCallerId}
        acceptCall={acceptCall}
        rejectCall={rejectCall}
        startCall={startCall}
        onEndSession={handleDisconnect}
        callRejected={callRejected}
        sessionReset={sessionReset}
      />
      {showPicker && (
        <SourcePicker
          sources={sources}
          onSelect={onSourceSelected}
          onCancel={() => {
            setShowPicker(false);
            if (pendingCall) {
              pendingCall.close();
              socketRef.current?.emit("callrejected", { remoteId: pendingCall.peer });
              setPendingCall(null);
            }
          }}
        />
      )}
    </>
  );
};

export default App;
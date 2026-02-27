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

// ─────────────────────────────────────────────────────────────────────────────
// getMicStream — track.enabled=TRUE so SDP negotiates sendrecv audio channel.
// Caller mutes the track AFTER the call/answer is created.
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// makeDummyVideoTrack — live 30fps animated 2×2 canvas.
// PeerJS requires a video track in the SDP offer so it can negotiate the host's
// screen-share video back. Without it → black screen on viewer.
// 30fps keeps Chromium from downgrading the connection.
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// unlockAudio — MUST be called synchronously inside a user-gesture handler.
// Electron/Chromium requires the FIRST play() call to happen during a user
// gesture. ICE negotiation takes 5–15s, so the gesture will expire by then.
// We pre-unlock the element NOW so later play() calls always succeed.
// ─────────────────────────────────────────────────────────────────────────────
const unlockAudio = (audioEl) => {
  if (!audioEl) { console.warn("🔊 unlockAudio: no element"); return; }
  try {
    const ac   = new AudioContext();
    const buf  = ac.createBuffer(1, ac.sampleRate * 0.1, ac.sampleRate);
    const src  = ac.createBufferSource();
    src.buffer = buf;
    const dest = ac.createMediaStreamDestination();
    src.connect(dest);
    src.start();
    audioEl.srcObject = dest.stream;
    audioEl.volume    = 0;
    audioEl.muted     = false;
    audioEl.play()
      .then(() => {
        console.log("🔊 Audio pre-unlocked ✅");
        src.stop();
        ac.close();
        audioEl.srcObject = null;
        audioEl.volume    = 1.0;
      })
      .catch(e => console.warn("🔊 unlockAudio failed:", e.message));
  } catch (e) {
    console.warn("🔊 unlockAudio error:", e.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// wireHostAudio — connects host's <audio> element to the viewer's mic track.
// Must be called AFTER unlockAudio() and BEFORE call.answer().
// Receives ref OBJECT (not .current) so closures always read live DOM element.
// Three approaches for reliability:
//   1. pc.addEventListener("track") — raw WebRTC, per-track, never overwritten
//   2. pc.getReceivers() — catches tracks already present at attach time
//   3. call.on("stream") — PeerJS backup
// ─────────────────────────────────────────────────────────────────────────────
const wireHostAudio = (call, audioRef) => {
  const playTrack = (track) => {
    if (track.kind !== "audio") return;
    const audioEl = audioRef.current;
    if (!audioEl) { console.warn("🔊 hostAudioRef null"); return; }
    console.log(`🔊 Host got viewer audio track: state=${track.readyState} enabled=${track.enabled}`);
    let ms = audioEl.srcObject;
    if (!(ms instanceof MediaStream)) { ms = new MediaStream(); audioEl.srcObject = ms; }
    if (!ms.getTrackById(track.id)) ms.addTrack(track);
    audioEl.volume = 1.0;
    audioEl.muted  = false;
    audioEl.play()
      .then(() => console.log("🔊 Host audio playing ✅"))
      .catch(e  => console.warn("🔊 host audio.play():", e.message));
  };

  let polls = 0;
  const attach = () => {
    const pc = call.peerConnection;
    if (!pc) {
      if (polls++ < 200) setTimeout(attach, 25);
      else console.warn("🔊 peerConnection never appeared after 5s");
      return;
    }
    console.log(`🔊 pc found (poll=${polls}), attaching track listener`);
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

  // TWO persistent audio element refs — both rendered in EVERY branch so they
  // are NEVER unmounted. React reuses the same DOM node across re-renders when
  // the element stays in the tree. Both are pre-unlocked during user gestures.
  const hostAudioRef      = useRef(null);  // host hears viewer's mic
  const viewerAudioRef    = useRef(null);  // viewer hears host's screen audio + mic

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
  const [sessionReset,     setSessionReset]   = useState(0);

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
    console.log("🎤 Mic stopped");
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
    return () => { socket.disconnect(); peer.destroy(); stopMic(); stopAllAudio(); };
  }, []);

  const resetSession = useCallback(() => {
    ipcRenderer.send("set-global-capture", false);
    setCurrentScreen("home");
    setRemoteStream(null);
    remoteStreamRef.current = null;
    remoteIdRef.current     = "";
    dispatch(setShowSessionDialog(false));
    dispatch(setSessionMode(-1));
    ipcRenderer.send("session-ended");
    stopMic();
    stopAllAudio();
    setSessionReset(n => n + 1);
    console.log("🔄 Session reset");
  }, [stopMic, stopAllAudio]);

  // ── HOST: Accept (user gesture) — unlock host audio NOW ──────────────────
  const acceptCall = useCallback(async () => {
    const call = incomingCall;
    setIncomingCall(null); setIncomingCallerId("");
    setPendingCall(call);
    // MUST be synchronous before any await — user gesture expires after first await
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

  // ── HOST answers after source selected ───────────────────────────────────
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

      const micStream = await getMicStream();
      const micTrack  = micStream.getAudioTracks()[0];
      localMicStreamRef.current = micStream;
      localMicTrackRef.current  = micTrack ?? null;

      const combined = new MediaStream();
      screenStream.getTracks().forEach(t => combined.addTrack(t));
      if (micTrack) combined.addTrack(micTrack);

      console.log("📡 Host answering:", combined.getTracks().map(t => `${t.kind} enabled=${t.enabled}`));

      // Wire BEFORE answer() — hostAudioRef already unlocked in acceptCall()
      wireHostAudio(call, hostAudioRef);
      call.answer(combined);

      // Mute host mic AFTER answer() — SDP already committed with sendrecv
      if (micTrack) { micTrack.enabled = false; console.log("🔇 Host mic muted"); }

      callRef.current     = call;
      remoteIdRef.current = call.peer;
      dispatch(setRemoteConnectionId(call.peer));
      dispatch(setSessionMode(0));
      dispatch(setSessionStartTime(new Date()));
      dispatch(setShowSessionDialog(true));
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

  // ── VIEWER calls ──────────────────────────────────────────────────────────
  // startCall is called directly from ConnectionScreen's handleConnect onClick.
  // It is the FIRST thing that runs in the async chain — unlockAudio MUST be
  // called before any await so we are still within the user gesture window.
  const startCall = useCallback(async (remoteId) => {
    const peer = peerInstance.current;
    if (!peer || peer.destroyed) { alert("Not connected to server yet."); return; }

    // Synchronous — still in user gesture at this point
    unlockAudio(viewerAudioRef.current);

    dispatch(setRemoteConnectionId(remoteId));
    remoteIdRef.current = remoteId;

    // All awaits happen AFTER unlockAudio — gesture already captured
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

    // Mute after 200ms — lets PeerJS finish SDP/addTrack queuing first
    setTimeout(() => {
      if (localMicTrackRef.current) {
        localMicTrackRef.current.enabled = false;
        console.log("🔇 Viewer mic muted (default)");
      }
    }, 200);

    callRef.current = call;
    setCurrentScreen("viewing");

    call.on("stream", stream => {
      console.log("🎉 Viewer stream:", stream.getTracks().map(t => `${t.kind} enabled=${t.enabled} state=${t.readyState}`));
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

  // ── ALWAYS RENDER BOTH AUDIO ELEMENTS ────────────────────────────────────
  // CRITICAL: Both <audio> elements must be rendered in EVERY return branch.
  // If they unmount (e.g. switching from home to viewing), their DOM nodes are
  // destroyed and the refs become null — breaking all audio.
  // By rendering them in both branches, React reuses the same DOM nodes and the
  // refs stay valid and pre-unlocked across the screen transition.
  const audioElements = (
    <>
      {/* Host audio: plays viewer's mic. Unlocked in acceptCall(). */}
      <audio ref={hostAudioRef}   style={{ display:"none" }} />
      {/* Viewer audio: plays host's screen audio+mic. Unlocked in startCall(). */}
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
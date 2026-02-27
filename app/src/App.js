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
// getMicStream — acquire mic with track.enabled=TRUE so WebRTC SDP negotiates
// a proper sendrecv audio channel. We mute AFTER the call object is created.
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
// makeDummyVideoTrack
// Creates a live 30fps animated canvas track.
// Static 1fps canvas caused Electron/Chromium to treat the peer connection as
// degraded, silently breaking the audio channel. 30fps keeps it fully active.
// ─────────────────────────────────────────────────────────────────────────────
const makeDummyVideoTrack = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 2; canvas.height = 2;
  const ctx = canvas.getContext("2d");
  // Animate so Chromium doesn't mark the stream as inactive
  let tick = 0;
  const draw = () => {
    ctx.fillStyle = tick++ % 2 === 0 ? "#000001" : "#000000";
    ctx.fillRect(0, 0, 2, 2);
  };
  draw();
  const stream = canvas.captureStream(30);
  const track = stream.getVideoTracks()[0];
  // Keep animating every frame so the track stays live
  const interval = setInterval(draw, 33);
  track._stopInterval = () => clearInterval(interval); // cleanup handle
  return track;
};

// ─────────────────────────────────────────────────────────────────────────────
// wireHostAudio
// Sets up the host's <audio> element to receive the viewer's mic audio.
//
// THREE approaches combined — belt + suspenders + extra suspenders:
//
// 1. pc.addEventListener("track") — raw WebRTC, fires per-track, most reliable.
//    Uses addEventListener (not ontrack=) so PeerJS can't overwrite our handler.
//    Polls for peerConnection since PeerJS creates it lazily.
//
// 2. pc.getReceivers() check — catches tracks already present when we attach.
//
// 3. call.on("stream") — PeerJS backup, fires when it considers all tracks ready.
//
// Receives hostAudioRef (the ref OBJECT, not .current) so the callback always
// reads the live mounted DOM element, avoiding stale-closure null bugs.
// ─────────────────────────────────────────────────────────────────────────────
const wireHostAudio = (call, audioRef) => {
  const playTrack = (track) => {
    if (track.kind !== "audio") return;
    const audioEl = audioRef.current;
    if (!audioEl) { console.warn("🔊 hostAudioRef not mounted"); return; }

    console.log(`🔊 Host: viewer audio track id=${track.id} state=${track.readyState}`);

    let ms = audioEl.srcObject;
    if (!(ms instanceof MediaStream)) { ms = new MediaStream(); audioEl.srcObject = ms; }
    if (!ms.getTrackById(track.id)) ms.addTrack(track);

    audioEl.volume = 1.0;
    audioEl.muted  = false;
    audioEl.play()
      .then(() => console.log("🔊 Host audio playing ✅"))
      .catch(e  => console.warn("🔊 audio.play():", e.message));
  };

  // Approach 1 + 2: raw RTCPeerConnection events
  let polls = 0;
  const attach = () => {
    const pc = call.peerConnection;
    if (!pc) {
      if (polls++ < 200) setTimeout(attach, 25);
      else console.warn("🔊 peerConnection never appeared after 5s");
      return;
    }
    console.log("🔊 pc found, attaching track listener");
    pc.addEventListener("track", ev => playTrack(ev.track));
    // Check for tracks already negotiated before we attached
    pc.getReceivers().forEach(r => { if (r.track) playTrack(r.track); });
  };
  attach();

  // Approach 3: PeerJS stream event backup
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
  const dummyTrackRef     = useRef(null); // viewer's dummy video track (cleanup)
  const hostAudioRef      = useRef(null); // plays viewer's mic on host side

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
    // Stop dummy video track animation interval
    if (dummyTrackRef.current) {
      dummyTrackRef.current._stopInterval?.();
      dummyTrackRef.current.stop();
      dummyTrackRef.current = null;
    }
    console.log("🎤 Mic + dummy track stopped");
  }, []);

  const stopHostAudio = useCallback(() => {
    if (hostAudioRef.current) {
      hostAudioRef.current.srcObject = null;
      hostAudioRef.current.pause();
    }
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

    socket.on("connect",           () => { console.log("🟢 Socket:", socket.id); socket.emit("join", "User" + uid); });
    socket.on("disconnect",        (r) => console.warn("🔴 Socket disconnected:", r));
    socket.on("connect_error",     (e) => console.error("🔴 Socket error:", e.message));
    socket.on("remotedisconnected",()  => setSessionEnded(true));
    socket.on("callrejected", () => {
      setCallRejected(true);
      setCurrentScreen("home");
      if (callRef.current) { callRef.current.close(); callRef.current = null; }
    });

    socket.on("mousemove",         (e) => ipcRenderer.send("mousemove",         e));
    socket.on("mousedown",         (e) => ipcRenderer.send("mousedown",         e));
    socket.on("mouseup",           (e) => ipcRenderer.send("mouseup",           e));
    socket.on("dblclick",          (e) => ipcRenderer.send("dblclick",          e));
    socket.on("scroll",            (e) => ipcRenderer.send("scroll",            e));
    socket.on("keydown",           (e) => ipcRenderer.send("keydown",           e));
    socket.on("keyup",             (e) => ipcRenderer.send("keyup",             e));
    socket.on("stream-resolution", (e) => ipcRenderer.send("stream-resolution", e));

    const peer = new Peer(uid, {
      host: CONFIG.PEER_HOST, port: CONFIG.PEER_PORT,
      path: CONFIG.PEER_PATH, secure: CONFIG.PEER_SECURE, debug: 2,
      config: { iceServers: [
        { urls: "stun:stun.l.google.com:19302"  },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
      ]},
    });
    peer.on("open",         (id)  => console.log("✅ PeerJS:", id));
    peer.on("disconnected", ()    => { if (!peer.destroyed) peer.reconnect(); });
    peer.on("error",        (err) => {
      console.error("❌ Peer:", err.type, err.message);
      if (err.type === "unavailable-id") window.location.reload();
    });
    peer.on("call", (call) => { setIncomingCall(call); setIncomingCallerId(call.peer); });

    peerInstance.current = peer;
    return () => { socket.disconnect(); peer.destroy(); stopMic(); stopHostAudio(); };
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
    stopHostAudio();
    setSessionReset(n => n + 1);
    console.log("🔄 Session reset");
  }, [stopMic, stopHostAudio]);

  const acceptCall = useCallback(async () => {
    const call = incomingCall;
    setIncomingCall(null); setIncomingCallerId("");
    setPendingCall(call);
    const srcs = await ipcRenderer.invoke("GET_SOURCES");
    setSources(srcs); setShowPicker(true);
  }, [incomingCall]);

  const rejectCall = useCallback(() => {
    const call = incomingCall; const callerId = incomingCallerId;
    setIncomingCall(null); setIncomingCallerId("");
    if (call) call.close();
    socketRef.current?.emit("callrejected", { remoteId: callerId });
  }, [incomingCall, incomingCallerId]);

  // ── HOST answers ──────────────────────────────────────────────────────────
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

      // Wire BEFORE answer() — ref object passed so callback always gets live element
      wireHostAudio(call, hostAudioRef);

      call.answer(combined);

      // Mute AFTER answer() — SDP already committed with sendrecv audio channel
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
      call.on("error", (e) => console.error("Host call error:", e));
    } catch (e) {
      ipcRenderer.invoke("RESTORE_WIN");
      alert("Screen capture failed: " + e.message);
      socketRef.current?.emit("callrejected", { remoteId: call.peer });
    }
  }, [pendingCall, resetSession]);

  // ── VIEWER calls ──────────────────────────────────────────────────────────
  // IMPORTANT: Must include a video track in the offer stream.
  // PeerJS/WebRTC requires video in the SDP offer to negotiate the host's
  // screen-share video track properly. Without it → black screen on viewer.
  //
  // FIX: Use a live 30fps animated canvas (not static 1fps).
  // A 1fps static canvas made Chromium/Electron downgrade the peer connection,
  // silently breaking the audio channel. 30fps keeps the connection fully active.
  //
  // FIX: Mute mic after 200ms so PeerJS internal addTrack/SDP tasks finish first.
  // ─────────────────────────────────────────────────────────────────────────────
  const startCall = useCallback(async (remoteId) => {
    const peer = peerInstance.current;
    if (!peer || peer.destroyed) { alert("Not connected to server yet."); return; }

    dispatch(setRemoteConnectionId(remoteId));
    remoteIdRef.current = remoteId;

    const micStream = await getMicStream();
    const micTrack  = micStream.getAudioTracks()[0];
    localMicStreamRef.current = micStream;
    localMicTrackRef.current  = micTrack;

    // Live 30fps dummy video — keeps peer connection fully active in Chromium
    const dummyVideo = makeDummyVideoTrack();
    dummyTrackRef.current = dummyVideo;

    const outStream = new MediaStream();
    outStream.addTrack(dummyVideo);
    if (micTrack) outStream.addTrack(micTrack);

    console.log("📞 Viewer calling:", outStream.getTracks().map(t => `${t.kind} enabled=${t.enabled}`));

    const call = peer.call(String(remoteId), outStream);
    if (!call) { alert("Could not reach that peer."); return; }

    // Mute mic after 200ms — lets PeerJS finish internal SDP/addTrack queuing first
    setTimeout(() => {
      if (localMicTrackRef.current) {
        localMicTrackRef.current.enabled = false;
        console.log("🔇 Viewer mic muted (default)");
      }
    }, 200);

    callRef.current = call;
    setCurrentScreen("viewing");

    call.on("stream", (stream) => {
      console.log("🎉 Viewer stream:", stream.getTracks().map(t => `${t.kind} enabled=${t.enabled} state=${t.readyState}`));
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
      dispatch(setSessionMode(1));
      dispatch(setSessionStartTime(new Date()));
    });
    call.on("error", (err) => { console.error("Call error:", err); resetSession(); });
    call.on("close", ()    => resetSession());
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

  if (currentScreen === "viewing") {
    return (
      <AppScreen
        remoteStream={remoteStream}
        remoteStreamRef={remoteStreamRef}
        socketRef={socketRef}
        callRef={callRef}
        remoteIdRef={remoteIdRef}
        userIdRef={userIdRef}
        localMicTrackRef={localMicTrackRef}
        onDisconnect={handleDisconnect}
        onEndSession={handleDisconnect}
      />
    );
  }

  return (
    <>
      {/* Hidden audio — plays viewer's mic on host side */}
      <audio ref={hostAudioRef} autoPlay style={{ display:"none" }} />

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
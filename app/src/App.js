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
// getMicStream — track.enabled stays TRUE during call setup so WebRTC SDP
// negotiates a proper sendrecv audio channel. We mute AFTER call is created.
// ─────────────────────────────────────────────────────────────────────────────
const getMicStream = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log("🎤 Mic acquired:", stream.getAudioTracks().map(t => t.label));
    return stream;
  } catch (e) {
    console.warn("🎤 Mic unavailable:", e.message);
    // Return silent dummy so SDP still negotiates an audio channel
    const dest = new AudioContext().createMediaStreamDestination();
    return dest.stream;
  }
};

// Wire up the host audio element to hear the viewer's mic.
// Uses BOTH pc.ontrack (raw WebRTC) AND call.on("stream") (PeerJS) as fallbacks.
// pc.ontrack fires once per track — most reliable.
// call.on("stream") is the PeerJS wrapper — fires when all tracks are ready.
const wireHostAudio = (call, audioEl) => {
  if (!audioEl) { console.warn("🔊 wireHostAudio: no audioEl"); return; }

  const playAudioStream = (stream) => {
    if (!stream) return;
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) { console.warn("🔊 no audio tracks yet"); return; }
    console.log("🔊 Host playing viewer audio, tracks:", tracks.map(t => `${t.kind} state=${t.readyState}`));
    const audioOnly = new MediaStream(tracks);
    audioEl.srcObject = audioOnly;
    audioEl.volume = 1.0;
    audioEl.muted  = false;
    audioEl.play()
      .then(() => console.log("🔊 Host audio playing ✅"))
      .catch(e => console.warn("🔊 host audio.play():", e.message));
  };

  // Method 1: RTCPeerConnection.ontrack — fires per-track, most reliable
  // peerConnection may not exist yet when wireHostAudio is called (PeerJS lazily creates it).
  // Poll until it exists, then attach.
  const attachPcTrack = () => {
    const pc = call.peerConnection;
    if (!pc) { setTimeout(attachPcTrack, 50); return; }  // poll every 50ms until ready
    const inStream = new MediaStream();
    pc.ontrack = (ev) => {
      console.log(`🔊 pc.ontrack: ${ev.track.kind} state=${ev.track.readyState}`);
      if (ev.track.kind === "audio") {
        inStream.addTrack(ev.track);
        audioEl.srcObject = inStream;
        audioEl.volume = 1.0;
        audioEl.muted  = false;
        audioEl.play().catch(e => console.warn("🔊 ontrack play():", e.message));
      }
    };
  };
  attachPcTrack();

  // Method 2: PeerJS call.on("stream") — backup for when stream already has tracks
  call.on("stream", (viewerStream) => {
    console.log("🔊 call.on(stream) viewer:", viewerStream.getTracks().map(t => `${t.kind} enabled=${t.enabled}`));
    playAudioStream(viewerStream);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
const App = () => {
  const dispatch = useDispatch();

  const peerInstance       = useRef(null);
  const socketRef          = useRef(null);
  const callRef            = useRef(null);
  const remoteStreamRef    = useRef(null);
  const remoteIdRef        = useRef("");
  const userIdRef          = useRef("");
  const localMicStreamRef  = useRef(null);
  const localMicTrackRef   = useRef(null);
  // Host-side audio element ref — plays viewer's incoming voice
  const hostAudioRef       = useRef(null);

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
  // Passed to ConnectionScreen so it can reset its own connecting state
  const [sessionReset,     setSessionReset]   = useState(0);

  // ── Stop mic ──────────────────────────────────────────────────────────────
  const stopMic = useCallback(() => {
    if (localMicStreamRef.current) {
      localMicStreamRef.current.getTracks().forEach(t => { t.enabled = false; t.stop(); });
      localMicStreamRef.current = null;
    }
    localMicTrackRef.current = null;
    console.log("🎤 Mic stopped");
  }, []);

  // ── Stop host audio playback + clean up pc.ontrack ────────────────────────
  const stopHostAudio = useCallback(() => {
    if (hostAudioRef.current) {
      hostAudioRef.current.srcObject = null;
      hostAudioRef.current.pause();
    }
    // Remove pc.ontrack so stale handlers don't fire after disconnect
    if (callRef.current?.peerConnection) {
      callRef.current.peerConnection.ontrack = null;
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

  // ── Reset session — clears everything, unlocks UI ─────────────────────────
  const resetSession = useCallback(() => {
    // CRITICAL: always turn off global capture first, or input stays unclickable
    ipcRenderer.send("set-global-capture", false);

    setCurrentScreen("home");
    setRemoteStream(null);
    remoteStreamRef.current = null;
    remoteIdRef.current     = "";
    dispatch(setShowSessionDialog(false));
    dispatch(setSessionMode(-1));   // -1 = no active session, prevents SessionInfo showing
    ipcRenderer.send("session-ended");
    stopMic();
    stopHostAudio();
    // Increment to signal ConnectionScreen to reset its local state
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

      // Mic track enabled=TRUE so SDP negotiates proper sendrecv audio channel
      const micStream = await getMicStream();
      const micTrack  = micStream.getAudioTracks()[0];
      localMicStreamRef.current = micStream;
      localMicTrackRef.current  = micTrack ?? null;

      // Build combined stream — ALL tracks must be present BEFORE call.answer()
      // so they are included in the SDP offer/answer negotiation
      const combined = new MediaStream();
      screenStream.getTracks().forEach(t => combined.addTrack(t)); // screen video + desktop audio
      if (micTrack) combined.addTrack(micTrack);                   // host mic

      // ── Wire host audio BEFORE answer() so zero tracks are missed ──────
      // pc.ontrack fires for each incoming track as soon as ICE connects.
      // Must be set before call.answer() to guarantee we catch everything.
      wireHostAudio(call, hostAudioRef.current);

      console.log("📡 Host answering with tracks:", combined.getTracks().map(t => `${t.kind} enabled=${t.enabled}`));
      call.answer(combined);

      // Mute mic AFTER answer() — SDP already committed with audio channel open
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
  const startCall = useCallback(async (remoteId) => {
    const peer = peerInstance.current;
    if (!peer || peer.destroyed) { alert("Not connected to server yet."); return; }

    dispatch(setRemoteConnectionId(remoteId));
    remoteIdRef.current = remoteId;

    // Dummy 1×1 video track (required by PeerJS) + real mic track
    const canvas = document.createElement("canvas");
    canvas.width = 1; canvas.height = 1;
    canvas.getContext("2d").fillRect(0, 0, 1, 1);
    const videoTrack = canvas.captureStream(1).getVideoTracks()[0];

    const micStream = await getMicStream();
    const micTrack  = micStream.getAudioTracks()[0];
    localMicStreamRef.current = micStream;
    localMicTrackRef.current  = micTrack;

    const outStream = new MediaStream();
    outStream.addTrack(videoTrack);
    if (micTrack) outStream.addTrack(micTrack);

    console.log("📞 Viewer calling with tracks:", outStream.getTracks().map(t => `${t.kind} enabled=${t.enabled}`));
    const call = peer.call(String(remoteId), outStream);
    if (!call) { alert("Could not reach that peer."); return; }

    // Mute mic AFTER call() — SDP already negotiated with audio channel
    if (micTrack) { micTrack.enabled = false; console.log("🔇 Viewer mic muted"); }

    callRef.current = call;
    setCurrentScreen("viewing");

    // Viewer receives host's screen + desktop audio + host mic via this event
    call.on("stream", (stream) => {
      console.log("🎉 Viewer got host stream:", stream.getTracks().map(t => `${t.kind} enabled=${t.enabled} state=${t.readyState}`));
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
      {/* Hidden <audio> — plays viewer's incoming voice on host side */}
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
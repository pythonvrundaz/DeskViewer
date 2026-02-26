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
// getMicStream
// ─────────────────────────────────────────────────────────────────────────────
// KEY RULE: track.enabled must be TRUE when peer.call() / call.answer() runs.
// WebRTC SDP is negotiated from the track state at call time.
// If enabled=false at negotiation → remote side gets "recvonly" → no audio ever.
// We set enabled=false ONLY after the call object exists (post-negotiation).
const getMicStream = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    // DO NOT set enabled=false here — call negotiation happens next
    console.log("🎤 Mic acquired, tracks:", stream.getAudioTracks().map(t => t.label));
    return stream;
  } catch (e) {
    console.warn("🎤 Mic unavailable:", e.message);
    const ctx  = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    return dest.stream;
  }
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

  // ── Stop mic completely ───────────────────────────────────────────────────
  const stopMic = useCallback(() => {
    if (localMicStreamRef.current) {
      localMicStreamRef.current.getTracks().forEach(t => { t.enabled = false; t.stop(); });
      localMicStreamRef.current = null;
    }
    localMicTrackRef.current = null;
    console.log("🎤 Mic stopped");
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
    return () => { socket.disconnect(); peer.destroy(); stopMic(); };
  }, []);

  // ── Reset session ─────────────────────────────────────────────────────────
  const resetSession = useCallback(() => {
    setCurrentScreen("home");
    setRemoteStream(null);
    remoteStreamRef.current = null;
    remoteIdRef.current     = "";
    dispatch(setShowSessionDialog(false));
    ipcRenderer.send("session-ended");
    stopMic();
    console.log("🔄 Session reset");
  }, [stopMic]);

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
      let stream;
      try   { stream = await tryCapture(true);  }
      catch { stream = await tryCapture(false); }

      // Build a COMBINED stream so all tracks are in the SDP from the start.
      // stream.addTrack() after call.answer() does NOT update the SDP — tracks
      // added post-answer are invisible to the remote peer.
      // Solution: create a new MediaStream with ALL tracks, then call answer().
      const micStream  = await getMicStream();
      const micTrack   = micStream.getAudioTracks()[0];

      const combined   = new MediaStream();
      stream.getTracks().forEach(t => combined.addTrack(t));   // screen video + desktop audio
      if (micTrack) combined.addTrack(micTrack);               // mic audio

      localMicStreamRef.current = micStream;
      localMicTrackRef.current  = micTrack ?? null;
      console.log("🎤 Combined stream tracks:", combined.getTracks().map(t => `${t.kind} label=${t.label} enabled=${t.enabled}`));

      // answer() with all tracks present → SDP negotiates ALL audio channels
      call.answer(combined);

      // Mute mic immediately after answer() — SDP is already committed with mic channel open
      if (micTrack) { micTrack.enabled = false; console.log("🔇 Host mic muted (post-answer)"); }

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

    // 1x1 dummy video + real mic (enabled=true for negotiation)
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

    console.log("📞 Calling, tracks:", outStream.getTracks().map(t => `${t.kind} enabled=${t.enabled}`));

    // peer.call() with mic enabled → SDP negotiates audio sendrecv
    const call = peer.call(String(remoteId), outStream);
    if (!call) { alert("Could not reach that peer."); return; }

    // NOW mute mic — after call() so negotiation already includes audio channel
    if (micTrack) { micTrack.enabled = false; console.log("🔇 Viewer mic muted (post-call)"); }

    callRef.current = call;
    setCurrentScreen("viewing");

    call.on("stream", (stream) => {
      console.log("🎉 Got remote stream, tracks:", stream.getTracks().map(t => `${t.kind} enabled=${t.enabled} readyState=${t.readyState}`));
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
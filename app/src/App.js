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
// Returns a real getUserMedia stream. track.enabled stays TRUE so WebRTC SDP
// negotiates a proper sendrecv audio channel. We mute AFTER the call is made.
// ─────────────────────────────────────────────────────────────────────────────
const getMicStream = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log("🎤 Mic acquired:", stream.getAudioTracks().map(t => t.label));
    return stream;
  } catch (e) {
    console.warn("🎤 Mic unavailable:", e.message);
    // Silent fallback so WebRTC still negotiates an audio channel in SDP
    const dest = new AudioContext().createMediaStreamDestination();
    return dest.stream;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// wireHostAudio
//
// Sets up the host's <audio> element to play the viewer's microphone.
//
// FIX: Pass the hostAudioRef OBJECT (not .current) so the callback always
//      accesses the live DOM element even if first render hasn't attached yet.
//
// FIX: Use pc.addEventListener("track", ...) instead of pc.ontrack = ...
//      addEventListener stacks listeners; ontrack assignment can be overwritten
//      by PeerJS internals. Also catches tracks that arrive before our handler.
//
// FIX: Also hook call.on("stream") as backup — fires when PeerJS considers
//      all tracks ready.
// ─────────────────────────────────────────────────────────────────────────────
const wireHostAudio = (call, audioRef) => {
  const playTrackOnAudio = (track) => {
    const audioEl = audioRef.current;
    if (!audioEl) { console.warn("🔊 hostAudioRef not mounted yet"); return; }
    if (track.kind !== "audio") return;

    console.log(`🔊 Host got viewer audio track: id=${track.id} state=${track.readyState} enabled=${track.enabled}`);

    // Build/extend the MediaStream playing on the audio element
    let stream = audioEl.srcObject;
    if (!stream || !(stream instanceof MediaStream)) {
      stream = new MediaStream();
      audioEl.srcObject = stream;
    }
    // Avoid duplicate tracks
    if (!stream.getTrackById(track.id)) {
      stream.addTrack(track);
    }
    audioEl.volume = 1.0;
    audioEl.muted  = false;
    audioEl.play()
      .then(() => console.log("🔊 Host audio playing ✅"))
      .catch(e  => console.warn("🔊 host audio.play():", e.message));
  };

  // Method 1: RTCPeerConnection "track" event via addEventListener
  // Poll for peerConnection (PeerJS creates it lazily / asynchronously)
  let pollCount = 0;
  const attachTrackListener = () => {
    const pc = call.peerConnection;
    if (!pc) {
      if (pollCount++ < 100) setTimeout(attachTrackListener, 30); // poll up to 3s
      else console.warn("🔊 peerConnection never appeared");
      return;
    }
    console.log("🔊 Attaching pc track listener");
    pc.addEventListener("track", (ev) => {
      console.log(`🔊 pc track event: ${ev.track.kind}`);
      playTrackOnAudio(ev.track);
    });
    // Also check receivers for tracks already added before our listener
    pc.getReceivers().forEach(receiver => {
      if (receiver.track) playTrackOnAudio(receiver.track);
    });
  };
  attachTrackListener();

  // Method 2: PeerJS call.on("stream") — fires when PeerJS remote stream is ready
  call.on("stream", (remoteStream) => {
    console.log("🔊 call.on(stream) - viewer stream tracks:",
      remoteStream.getTracks().map(t => `${t.kind} enabled=${t.enabled} state=${t.readyState}`));
    remoteStream.getAudioTracks().forEach(playTrackOnAudio);
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

  // ── Stop mic ──────────────────────────────────────────────────────────────
  const stopMic = useCallback(() => {
    if (localMicStreamRef.current) {
      localMicStreamRef.current.getTracks().forEach(t => { t.enabled = false; t.stop(); });
      localMicStreamRef.current = null;
    }
    localMicTrackRef.current = null;
    console.log("🎤 Mic stopped");
  }, []);

  // ── Stop host audio ───────────────────────────────────────────────────────
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

  // ── Reset session ─────────────────────────────────────────────────────────
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

      // Get host mic — track.enabled=TRUE so SDP negotiates sendrecv
      const micStream = await getMicStream();
      const micTrack  = micStream.getAudioTracks()[0];
      localMicStreamRef.current = micStream;
      localMicTrackRef.current  = micTrack ?? null;

      // Combined stream: screen video + desktop audio + host mic
      const combined = new MediaStream();
      screenStream.getTracks().forEach(t => combined.addTrack(t));
      if (micTrack) combined.addTrack(micTrack);

      console.log("📡 Host answering with:", combined.getTracks().map(t => `${t.kind} enabled=${t.enabled}`));

      // Wire host audio BEFORE answer() — passes ref object so callback always gets live element
      wireHostAudio(call, hostAudioRef);

      // Answer the call
      call.answer(combined);

      // Mute host mic AFTER answer() — SDP already committed with audio channel
      if (micTrack) { micTrack.enabled = false; console.log("🔇 Host mic muted (default)"); }

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
  //
  // KEY FIX: Send audio-only stream (no dummy video track).
  // A dummy 1-fps canvas track causes Electron/Chromium to sometimes treat
  // the entire peer connection as low-priority, silently dropping audio.
  // PeerJS v1.x handles audio-only streams correctly.
  //
  // KEY FIX: Mute mic with a small delay (100ms) after peer.call() so the
  // internal async SDP/addTrack operations fully complete first.
  // ─────────────────────────────────────────────────────────────────────────
  const startCall = useCallback(async (remoteId) => {
    const peer = peerInstance.current;
    if (!peer || peer.destroyed) { alert("Not connected to server yet."); return; }

    dispatch(setRemoteConnectionId(remoteId));
    remoteIdRef.current = remoteId;

    // Get mic — track.enabled=TRUE during call so SDP negotiates sendrecv
    const micStream = await getMicStream();
    const micTrack  = micStream.getAudioTracks()[0];
    localMicStreamRef.current = micStream;
    localMicTrackRef.current  = micTrack;

    // Audio-only outgoing stream — no dummy video (causes issues in Electron)
    const outStream = new MediaStream();
    if (micTrack) outStream.addTrack(micTrack);

    console.log("📞 Viewer calling with:", outStream.getTracks().map(t => `${t.kind} enabled=${t.enabled}`));

    const call = peer.call(String(remoteId), outStream);
    if (!call) { alert("Could not reach that peer."); return; }

    // Mute mic after a short delay — lets PeerJS complete addTrack/SDP queuing
    setTimeout(() => {
      if (localMicTrackRef.current) {
        localMicTrackRef.current.enabled = false;
        console.log("🔇 Viewer mic muted (default)");
      }
    }, 200);

    callRef.current = call;
    setCurrentScreen("viewing");

    // Viewer receives host stream (screen video + desktop audio + host mic)
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
      {/* Hidden <audio> — plays viewer's mic audio on host side */}
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
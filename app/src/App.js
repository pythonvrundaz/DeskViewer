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
    return stream;
  } catch (e) {
    const dest = new AudioContext().createMediaStreamDestination();
    return dest.stream;
  }
};

const makeDummyVideoTrack = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 2; canvas.height = 2;
  const ctx = canvas.getContext("2d");
  let tick = 0;
  const draw = () => { ctx.fillStyle = tick++ % 2 === 0 ? "#000001" : "#000000"; ctx.fillRect(0, 0, 2, 2); };
  draw();
  const stream = canvas.captureStream(30);
  const track = stream.getVideoTracks()[0];
  const iv = setInterval(draw, 33);
  track._stop = () => clearInterval(iv);
  return track;
};

const unlockAudio = (audioEl) => {
  if (!audioEl) return;
  try {
    const ac = new AudioContext(), buf = ac.createBuffer(1, 1, ac.sampleRate), src = ac.createBufferSource();
    src.buffer = buf;
    const dest = ac.createMediaStreamDestination();
    src.connect(dest); src.start();
    const us = dest.stream;
    audioEl.srcObject = us; audioEl.volume = 0; audioEl.muted = false;
    audioEl.play().then(() => { src.stop(); ac.close(); if (audioEl.srcObject === us) { audioEl.srcObject = null; audioEl.volume = 1.0; } }).catch(() => { });
  } catch { }
};

const buildHostAudioMix = (desktopAudioTrack, micTrack) => {
  const audioCtx = new AudioContext(), destination = audioCtx.createMediaStreamDestination();
  if (desktopAudioTrack) { const ds = new MediaStream([desktopAudioTrack]); audioCtx.createMediaStreamSource(ds).connect(destination); }
  const micGain = audioCtx.createGain(); micGain.gain.value = 0;
  if (micTrack) { const ms = new MediaStream([micTrack]); audioCtx.createMediaStreamSource(ms).connect(micGain); }
  micGain.connect(destination);
  return { audioCtx, mixedTrack: destination.stream.getAudioTracks()[0], micGain };
};

const wireHostAudio = (call, audioRef) => {
  let done = false;
  const play = (track) => {
    if (track.kind !== "audio" || done) return; done = true;
    const el = audioRef.current; if (!el) return;
    el.srcObject = new MediaStream([track]); el.volume = 1.0; el.muted = false;
    el.play().catch(() => { });
  };
  let polls = 0;
  const attach = () => {
    const pc = call.peerConnection; if (!pc) { if (polls++ < 200) setTimeout(attach, 25); return; }
    pc.addEventListener("track", ev => play(ev.track));
    pc.getReceivers().forEach(r => { if (r.track) play(r.track); });
  };
  attach();
  call.on("stream", s => s.getAudioTracks().forEach(play));
};

// Safe call cleanup — removes listeners then closes
const closeCall = (call) => {
  if (!call) return;
  try { call.removeAllListeners?.(); } catch { }
  try { call.close(); } catch { }
};

// ─────────────────────────────────────────────────────────────────────────────
const App = () => {
  const dispatch = useDispatch();

  const peerInstance = useRef(null);
  const socketRef = useRef(null);
  const callRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const remoteIdRef = useRef("");
  const userIdRef = useRef("");
  const localMicStreamRef = useRef(null);
  const localMicTrackRef = useRef(null);
  const dummyTrackRef = useRef(null);
  const hostAudioCtxRef = useRef(null);
  const hostMicGainRef = useRef(null);
  const localStreamRef = useRef(null);
  const hostAudioRef = useRef(null);
  const viewerAudioRef = useRef(null);
  const isResettingRef = useRef(false);  // prevents double resetSession
  const isConnectingRef = useRef(false);  // true while viewer is waiting for host

  const [myId, setMyId] = useState("");
  const [currentScreen, setCurrentScreen] = useState("home");
  const [remoteStream, setRemoteStream] = useState(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [callRejected, setCallRejected] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [incomingCallerId, setIncomingCallerId] = useState("");
  const [sources, setSources] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [pendingCall, setPendingCall] = useState(null);
  const [sessionReset, setSessionReset] = useState(null);

  // connectError: { type: "unavailable"|"rejected"|"timeout"|"error"|"disconnected", message: string }
  const [connectError, setConnectError] = useState(null);

  const stopMic = useCallback(() => {
    if (localMicStreamRef.current) {
      localMicStreamRef.current.getTracks().forEach(t => { t.enabled = false; t.stop(); });
      localMicStreamRef.current = null;
    }
    localMicTrackRef.current = null;
    if (dummyTrackRef.current) { dummyTrackRef.current._stop?.(); dummyTrackRef.current.stop(); dummyTrackRef.current = null; }
    if (hostAudioCtxRef.current) { hostAudioCtxRef.current.close().catch(() => { }); hostAudioCtxRef.current = null; hostMicGainRef.current = null; }
  }, []);

  const stopAllAudio = useCallback(() => {
    [hostAudioRef, viewerAudioRef].forEach(r => { if (r.current) { r.current.srcObject = null; r.current.pause(); } });
  }, []);

  // ── resetSession ── single exit point back to home screen ─────────────────
  // errorInfo: null | { type, message } — shown as banner in ConnectionScreen
  const resetSession = useCallback((errorInfo = null) => {
    if (isResettingRef.current) { console.log("🔄 resetSession: duplicate skipped"); return; }
    isResettingRef.current = true;
    isConnectingRef.current = false;

    ipcRenderer.send("set-global-capture", false);
    ipcRenderer.send("session-ended");
    // Tell server to remove session pair so unexpected-disconnect doesn't double-notify
    if (socketRef.current?.connected && userIdRef.current) {
      socketRef.current.emit("session-unpair", { myId: userIdRef.current });
    }

    setCurrentScreen("home");
    setRemoteStream(null);
    remoteStreamRef.current = null;
    localStreamRef.current = null;
    remoteIdRef.current = "";
    dispatch(setShowSessionDialog(false));
    dispatch(setSessionMode(-1));
    stopMic();
    stopAllAudio();

    if (errorInfo) setConnectError(errorInfo);
    setSessionReset(prev => (prev === null ? 1 : prev + 1));
    setTimeout(() => { isResettingRef.current = false; }, 500);
  }, [stopMic, stopAllAudio]);

  // ── cancelConnecting ── viewer cancels before host responds ───────────────
  // CORNER CASE: viewer clicks "Cancel" while waiting. Must close the pending
  // PeerJS call and stop mic so host doesn't receive a ghost ring.
  const cancelConnecting = useCallback(() => {
    isConnectingRef.current = false;
    // Notify host via socket FIRST — this is the reliable fast path to dismiss
    // the host modal/picker. PeerJS call.on("close") alone is not guaranteed
    // to fire quickly enough on the host side.
    const rid = remoteIdRef.current;
    if (socketRef.current?.connected && rid) {
      socketRef.current.emit("remotedisconnected", { remoteId: rid });
    }
    const call = callRef.current; callRef.current = null;
    closeCall(call);
    stopMic();
    remoteIdRef.current = "";
    setCurrentScreen("home");
    setSessionReset(prev => (prev === null ? 1 : prev + 1));
  }, [stopMic]);

  useEffect(() => {
    const uid = String(Math.floor(Math.random() * 9000000000) + 1000000000);
    setMyId(uid); userIdRef.current = uid;
    dispatch(setUserConnectionId(uid));

    const socket = io(CONFIG.SOCKET_URL, {
      reconnectionDelay: 1000,
      transports: ["polling", "websocket"],
      extraHeaders: { "ngrok-skip-browser-warning": "true" },
    });
    socketRef.current = socket;

    socket.on("connect", () => { console.log("🟢 Socket:", socket.id); socket.emit("join", "User" + uid); });
    socket.on("disconnect", r => console.warn("🔴 Socket:", r));
    socket.on("connect_error", e => console.error("🔴 Socket:", e.message));

    // CORNER CASE: remote side disconnected.
    // This fires in THREE scenarios that all need different handling:
    // 1. Active session — remote closed app or clicked disconnect
    // 2. Viewer cancelled while host was showing the approve/reject modal
    // 3. Viewer cancelled while host had already accepted and source picker was open
    // For all three: clear modal + picker state, then trigger session reset.
    socket.on("remotedisconnected", () => {
      // Always dismiss incoming call modal and source picker first —
      // viewer may have cancelled before host responded
      setIncomingCall(prev => { if (prev) { closeCall(prev); } return null; });
      setIncomingCallerId("");
      setShowPicker(false);
      setPendingCall(prev => { if (prev) { closeCall(prev); } return null; });
      // Then trigger full session reset (handles active session + connecting state)
      setSessionEnded(true);
    });

    // CORNER CASE: host rejected the call (or cancelled source picker)
    // Previously: only set callRejected+setCurrentScreen, never called resetSession
    // so mic stream was never stopped and connecting state stayed stuck.
    socket.on("callrejected", () => {
      isConnectingRef.current = false;
      const call = callRef.current; callRef.current = null;
      closeCall(call);
      stopMic();
      remoteIdRef.current = "";
      setCallRejected(true);
      setCurrentScreen("home");
      setSessionReset(prev => (prev === null ? 1 : prev + 1));
    });

    socket.on("mousemove", e => ipcRenderer.send("mousemove", e));
    socket.on("mousedown", e => ipcRenderer.send("mousedown", e));
    socket.on("mouseup", e => ipcRenderer.send("mouseup", e));
    socket.on("dblclick", e => ipcRenderer.send("dblclick", e));
    socket.on("scroll", e => ipcRenderer.send("scroll", e));
    socket.on("keydown", e => ipcRenderer.send("keydown", e));
    socket.on("keyup", e => ipcRenderer.send("keyup", e));
    socket.on("stream-resolution", e => ipcRenderer.send("stream-resolution", e));

    // ── Peer factory — call this to (re)create the PeerJS instance ───────────
    // We extract this into a named function so we can call it again after
    // a "network" error, which leaves the peer in an unrecoverable state
    // that requires a full destroy + recreate (peer.reconnect() is not enough).
    let peerReconnectTimer = null;
    let peerReconnectCount = 0;

    const createPeer = () => {
      // Destroy any existing peer cleanly before creating a new one
      if (peerInstance.current && !peerInstance.current.destroyed) {
        try { peerInstance.current.destroy(); } catch { }
      }
      clearTimeout(peerReconnectTimer);

      const peer = new Peer(uid, {
        host: CONFIG.PEER_HOST, port: CONFIG.PEER_PORT,
        path: CONFIG.PEER_PATH, secure: CONFIG.PEER_SECURE, debug: 2,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:stun2.l.google.com:19302" },
          ]
        },
      });

      peer.on("open", id => {
        console.log("✅ PeerJS connected:", id);
        peerReconnectCount = 0; // reset backoff on successful connection
        // Clear any "server unreachable" error that was showing
        setConnectError(prev => prev?.type === "server" ? null : prev);
      });

      // "disconnected" = PeerJS lost its WebSocket to the server but peer not destroyed.
      // Safe to call reconnect() here — this handles normal transient drops.
      peer.on("disconnected", () => {
        console.warn("⚡ PeerJS disconnected from server — attempting reconnect...");
        if (!peer.destroyed) {
          try { peer.reconnect(); } catch (e) {
            console.warn("peer.reconnect() failed:", e.message);
          }
        }
      });

      peer.on("error", err => {
        console.error("❌ Peer:", err.type, err.message);

        // ── peer-unavailable: target ID is offline ──────────────────────────
        if (err.type === "peer-unavailable") {
          isConnectingRef.current = false;
          const call = callRef.current; callRef.current = null;
          closeCall(call);
          stopMic();
          remoteIdRef.current = "";
          setCurrentScreen("home");
          setConnectError({ type: "unavailable", message: "That ID is not online. Make sure the other person has DeskViewer open." });
          setSessionReset(prev => (prev === null ? 1 : prev + 1));
          return;
        }

        // ── unavailable-id: our ID is already taken ─────────────────────────
        if (err.type === "unavailable-id") {
          window.location.reload();
          return;
        }

        // ── network / server-error: lost connection to PeerJS server ────────
        // peer.reconnect() does NOT work after a "network" error — the peer
        // is left in an error state. We must destroy and recreate the peer.
        // Use exponential backoff: 2s, 4s, 8s, max 30s.
        if (err.type === "network" || err.type === "server-error" || err.type === "socket-error" || err.type === "socket-closed") {
          console.warn(`🔄 PeerJS ${err.type} — will recreate peer with backoff`);

          // If we were in a session or connecting, clean up first
          if (isConnectingRef.current || callRef.current) {
            resetSession({ type: "server", message: "Lost connection to server. Reconnecting…" });
          } else {
            // Just on home screen — show non-blocking reconnecting notice
            setConnectError({ type: "server", message: "Lost connection to server. Reconnecting…" });
          }

          // Exponential backoff: 2^n * 1000ms, capped at 30s
          peerReconnectCount = Math.min(peerReconnectCount + 1, 5);
          const delay = Math.min(Math.pow(2, peerReconnectCount) * 1000, 30000);
          console.log(`🔄 Recreating peer in ${delay}ms (attempt ${peerReconnectCount})`);

          peerReconnectTimer = setTimeout(() => {
            if (!peer.destroyed) {
              try { peer.destroy(); } catch { }
            }
            createPeer();
          }, delay);
          return;
        }

        // ── webrtc / ICE failure during active session ───────────────────────
        if (isConnectingRef.current || callRef.current) {
          resetSession({ type: "error", message: "Connection failed due to a network error. Please try again." });
        }
      });

      // CORNER CASE: host already in session — auto-reject new caller
      // CORNER CASE: viewer cancels while host sees modal — dismiss via close listener
      peer.on("call", call => {
        if (callRef.current) {
          console.warn("📵 Busy — auto-rejecting call from", call.peer);
          closeCall(call);
          socket.emit("callrejected", { remoteId: call.peer });
          return;
        }

        // If viewer cancels before host accepts, auto-dismiss the modal
        call.on("close", () => {
          setIncomingCall(prev => (prev === call ? null : prev));
          setIncomingCallerId(prev => (prev === call.peer ? "" : prev));
        });

        setIncomingCall(call);
        setIncomingCallerId(call.peer);
      });

      peerInstance.current = peer;
      return peer;
    };

    createPeer();

    // CORNER CASE E: app closed while session active or connecting.
    // CRITICAL: We must wait for the server to relay "remotedisconnected" to
    // the remote peer BEFORE disconnecting the socket.
    // Old bug: socket.disconnect() was called 300ms after emit — if the server
    // hadn't relayed yet, the message was lost and the other side stayed stuck.
    // Fix: emit → wait 800ms for relay to complete → THEN disconnect → cleanup-done
    const onWillClose = () => {
      const rid = remoteIdRef.current;
      const call = callRef.current; callRef.current = null;
      closeCall(call);
      stopMic();

      if (socket.connected && rid) {
        // Emit notification to server — server relays to remote peer's room
        socket.emit("remotedisconnected", { remoteId: rid });
        console.log("[onWillClose] Sent remotedisconnected to", rid);
        // Give the server enough time to relay the message before we cut the socket
        setTimeout(() => {
          socket.disconnect();
          ipcRenderer.send("cleanup-done");
        }, 800);
      } else {
        // Not in a session — disconnect immediately
        socket.disconnect();
        ipcRenderer.send("cleanup-done");
      }
    };
    ipcRenderer.on("app-will-close", onWillClose);

    return () => {
      ipcRenderer.removeListener("app-will-close", onWillClose);

      socket.disconnect();

      if (peerInstance.current && !peerInstance.current.destroyed) {
        peerInstance.current.destroy();
      }

      stopMic();
      stopAllAudio();
    };
  }, []);

  // ── HOST: Accept ──────────────────────────────────────────────────────────
  const acceptCall = useCallback(async () => {
    const call = incomingCall;
    setIncomingCall(null); setIncomingCallerId("");
    setPendingCall(call);
    unlockAudio(hostAudioRef.current);
    const srcs = await ipcRenderer.invoke("GET_SOURCES");
    setSources(srcs); setShowPicker(true);
  }, [incomingCall]);

  // ── HOST: Reject ──────────────────────────────────────────────────────────
  // CORNER CASE: host clicks Reject → viewer must return to home screen
  // Previously this just closed the call locally without notifying the viewer
  // via socket, so the viewer stayed stuck on "Waiting for host..."
  const rejectCall = useCallback(() => {
    const call = incomingCall; const callerId = incomingCallerId;
    setIncomingCall(null); setIncomingCallerId("");
    closeCall(call);
    socketRef.current?.emit("callrejected", { remoteId: callerId });
  }, [incomingCall, incomingCallerId]);

  // ── HOST: Screen source selected ──────────────────────────────────────────
  const onSourceSelected = useCallback(async (sourceId) => {
    setShowPicker(false);
    const call = pendingCall; if (!call) return;

    await ipcRenderer.invoke("MINIMIZE_WIN");
    await new Promise(r => setTimeout(r, 500));

    const tryCapture = (withAudio) => navigator.mediaDevices.getUserMedia({
      audio: withAudio ? { mandatory: { chromeMediaSource: "desktop" } } : false,
      video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId, minWidth: 1280, maxWidth: 1920, minHeight: 720, maxHeight: 1080 } },
    });

    try {
      let screenStream;
      try { screenStream = await tryCapture(true); } catch { screenStream = await tryCapture(false); }

      const desktopAudioTrack = screenStream.getAudioTracks()[0] ?? null;
      const screenVideoTrack = screenStream.getVideoTracks()[0];

      const micStream = await getMicStream();
      const micTrack = micStream.getAudioTracks()[0] ?? null;
      localMicStreamRef.current = micStream; localMicTrackRef.current = micTrack;

      const { audioCtx, mixedTrack, micGain } = buildHostAudioMix(desktopAudioTrack, micTrack);
      hostAudioCtxRef.current = audioCtx; hostMicGainRef.current = micGain;

      const combined = new MediaStream();
      if (screenVideoTrack) combined.addTrack(screenVideoTrack);
      combined.addTrack(mixedTrack);
      localStreamRef.current = combined;

      wireHostAudio(call, hostAudioRef);
      call.answer(combined);

      callRef.current = call;
      remoteIdRef.current = call.peer;
      dispatch(setRemoteConnectionId(call.peer));
      dispatch(setSessionMode(0));
      dispatch(setSessionStartTime(new Date()));
      dispatch(setShowSessionDialog(false));
      ipcRenderer.send("session-started");
      setTimeout(() => ipcRenderer.invoke("RESTORE_WIN"), 1000);
      // Tell server to track session pair for unexpected-disconnect notification
      socketRef.current?.emit("session-pair", { myId: userIdRef.current, remoteId: call.peer });

      call.on("close", () => resetSession());
      call.on("error", e => {
        console.error("Host call error:", e);
        resetSession({ type: "error", message: "Connection was lost unexpectedly." });
      });
    } catch (e) {
      // CORNER CASE: screen capture permission denied or source disappeared
      ipcRenderer.invoke("RESTORE_WIN");
      setPendingCall(null);
      setConnectError({ type: "error", message: "Screen capture failed: " + e.message });
      socketRef.current?.emit("callrejected", { remoteId: call.peer });
    }
  }, [pendingCall, resetSession]);

  // ── HOST: Cancel source picker ────────────────────────────────────────────
  // CORNER CASE: host opened picker then clicked Cancel (changed their mind).
  // Must send callrejected to the viewer so they return to home screen.
  const onSourceCancelled = useCallback(() => {
    setShowPicker(false);
    if (pendingCall) {
      closeCall(pendingCall);
      socketRef.current?.emit("callrejected", { remoteId: pendingCall.peer });
      setPendingCall(null);
    }
  }, [pendingCall]);

  // ── VIEWER: Start call ────────────────────────────────────────────────────
  const startCall = useCallback(async (remoteId) => {
    const peer = peerInstance.current;
    // CORNER CASE: peer not ready yet
    if (!peer || peer.destroyed) {
      setConnectError({ type: "error", message: "Not connected to server yet. Please wait a moment and try again." });
      setSessionReset(prev => (prev === null ? 1 : prev + 1));
      return;
    }

    setConnectError(null);
    isConnectingRef.current = true;
    unlockAudio(viewerAudioRef.current);
    dispatch(setRemoteConnectionId(remoteId));
    remoteIdRef.current = remoteId;

    const micStream = await getMicStream();
    const micTrack = micStream.getAudioTracks()[0];
    localMicStreamRef.current = micStream; localMicTrackRef.current = micTrack;

    const dummyVideo = makeDummyVideoTrack();
    dummyTrackRef.current = dummyVideo;
    const outStream = new MediaStream();
    outStream.addTrack(dummyVideo);
    if (micTrack) outStream.addTrack(micTrack);

    const call = peer.call(String(remoteId), outStream);

    // CORNER CASE: peer.call() returned null (peer not ready internally)
    if (!call) {
      isConnectingRef.current = false;
      stopMic(); remoteIdRef.current = "";
      setConnectError({ type: "error", message: "Could not initiate call. Please try again." });
      setSessionReset(prev => (prev === null ? 1 : prev + 1));
      return;
    }

    setTimeout(() => { if (localMicTrackRef.current) localMicTrackRef.current.enabled = false; }, 200);

    callRef.current = call;
    setCurrentScreen("viewing");

    call.on("stream", stream => {
      isConnectingRef.current = false;
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
      dispatch(setSessionMode(1));
      dispatch(setSessionStartTime(new Date()));
      // Tell server to track session pair for unexpected-disconnect notification
      socketRef.current?.emit("session-pair", { myId: userIdRef.current, remoteId: String(remoteId) });
    });

    // CORNER CASE: network failure mid-call
    call.on("error", err => {
      console.error("Viewer call error:", err);
      resetSession({ type: "error", message: "Connection failed. Please try again." });
    });

    // CORNER CASE: call closed before stream arrived (host vanished after answering)
    call.on("close", () => resetSession());
  }, [resetSession, stopMic]);

  // ── Session ended by remote side (socket event) ─────────────────────────
  // This triggers from remotedisconnected socket event which now also clears
  // incomingCall and pendingCall state (see socket handler above).
  // We only show the "disconnected" error if we were in an active session
  // (callRef existed) — not if the host was just on the home screen.
  useEffect(() => {
    if (!sessionEnded) return;
    const wasInSession = !!callRef.current;
    const call = callRef.current; callRef.current = null;
    closeCall(call);
    resetSession(wasInSession ? { type: "disconnected", message: "The other side ended the session." } : null);
    setSessionEnded(false);
  }, [sessionEnded]);

  // Auto-clear connect error after 6s
  useEffect(() => {
    if (!connectError) return;
    const t = setTimeout(() => setConnectError(null), 6000);
    return () => clearTimeout(t);
  }, [connectError]);

  // Auto-clear rejected banner after 4s
  useEffect(() => {
    if (!callRejected) return;
    const t = setTimeout(() => setCallRejected(false), 4000);
    return () => clearTimeout(t);
  }, [callRejected]);

  // ── Disconnect (initiated locally, called from AppScreen or ConnectionScreen) ─
  const handleDisconnect = useCallback(() => {
    const rid = remoteIdRef.current;
    if (socketRef.current && rid) socketRef.current.emit("remotedisconnected", { remoteId: rid });
    const call = callRef.current; callRef.current = null;
    closeCall(call);
    resetSession();
  }, [resetSession]);

  const audioElements = (
    <>
      <audio ref={hostAudioRef} style={{ display: "none" }} />
      <audio ref={viewerAudioRef} style={{ display: "none" }} />
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
        cancelConnecting={cancelConnecting}
        onEndSession={handleDisconnect}
        callRejected={callRejected}
        sessionReset={sessionReset}
        connectError={connectError}
        clearConnectError={() => setConnectError(null)}
      />
      {showPicker && (
        <SourcePicker
          sources={sources}
          onSelect={onSourceSelected}
          onCancel={onSourceCancelled}
        />
      )}
    </>
  );
};

export default App;
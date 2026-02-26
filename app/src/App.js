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

const createDummyStream = () => {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1280; canvas.height = 720;
    canvas.getContext("2d").fillRect(0, 0, 1280, 720);
    const videoTrack = canvas.captureStream(0).getVideoTracks()[0];
    const audioTrack = new AudioContext().createMediaStreamDestination().stream.getAudioTracks()[0];
    return new MediaStream([videoTrack, audioTrack]);
  } catch (e) { return new MediaStream(); }
};

const App = () => {
  const dispatch = useDispatch();

  const peerInstance    = useRef(null);
  const socketRef       = useRef(null);
  const callRef         = useRef(null);
  const remoteStreamRef = useRef(null);
  const remoteIdRef     = useRef("");
  const userIdRef       = useRef("");

  const [myId, setMyId]                         = useState("");
  const [currentScreen, setCurrentScreen]       = useState("home");
  const [remoteStream, setRemoteStream]         = useState(null);
  const [sessionEnded, setSessionEnded]         = useState(false);
  const [callRejected, setCallRejected]         = useState(false);
  const [incomingCall, setIncomingCall]         = useState(null);
  const [incomingCallerId, setIncomingCallerId] = useState("");
  const [sources, setSources]                   = useState([]);
  const [showPicker, setShowPicker]             = useState(false);
  const [pendingCall, setPendingCall]           = useState(null);

  useEffect(() => {
    const uid = String(Math.floor(Math.random() * 9000000000) + 1000000000);
    setMyId(uid);
    userIdRef.current = uid;
    dispatch(setUserConnectionId(uid));

    // FIX for ngrok 400 error:
    // 1. Use polling FIRST then upgrade to websocket (ngrok blocks direct WS upgrade)
    // 2. Send ngrok-skip-browser-warning header (required by ngrok free tier)
    const socket = io(CONFIG.SOCKET_URL, {
      reconnectionDelay: 1000,
      transports: ["polling", "websocket"],   // polling first! then upgrade
      extraHeaders: {
        "ngrok-skip-browser-warning": "true", // bypasses ngrok's browser warning page
      },
    });
    socketRef.current = socket;

    socket.on("connect",    () => { console.log("🟢 Socket:", socket.id); socket.emit("join", "User" + uid); });
    socket.on("disconnect", (r) => console.warn("🔴 Socket disconnected:", r));
    socket.on("connect_error", (e) => console.error("🔴 Socket error:", e.message));

    socket.on("remotedisconnected", () => setSessionEnded(true));
    socket.on("callrejected", () => {
      setCallRejected(true);
      setCurrentScreen("home");
      if (callRef.current) { callRef.current.close(); callRef.current = null; }
    });

    // Remote control events from viewer → forward to electron main process → nut-js
    // NOTE: no "click" event — we use only mousedown+mouseup to avoid double-action bug
    socket.on("mousemove",        (e) => ipcRenderer.send("mousemove",        e));
    socket.on("mousedown",        (e) => ipcRenderer.send("mousedown",        e));
    socket.on("mouseup",          (e) => ipcRenderer.send("mouseup",          e));
    socket.on("dblclick",         (e) => ipcRenderer.send("dblclick",         e));
    socket.on("scroll",           (e) => ipcRenderer.send("scroll",           e));
    socket.on("keydown",          (e) => ipcRenderer.send("keydown",          e));
    socket.on("keyup",            (e) => ipcRenderer.send("keyup",            e));
    socket.on("stream-resolution",(e) => ipcRenderer.send("stream-resolution",e));

    const peer = new Peer(uid, {
      host:   CONFIG.PEER_HOST,
      port:   CONFIG.PEER_PORT,
      path:   CONFIG.PEER_PATH,
      secure: CONFIG.PEER_SECURE,
      debug:  2,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
          { urls: "stun:stun3.l.google.com:19302" },
        ],
      },
    });

    peer.on("open",         (id)  => console.log("✅ PeerJS:", id));
    peer.on("disconnected", ()    => { if (!peer.destroyed) peer.reconnect(); });
    peer.on("error",        (err) => {
      console.error("❌ Peer:", err.type, err.message);
      if (err.type === "unavailable-id") window.location.reload();
    });
    peer.on("call", (call) => {
      console.log("📞 Incoming call:", call.peer);
      setIncomingCall(call);
      setIncomingCallerId(call.peer);
    });

    peerInstance.current = peer;
    return () => { socket.disconnect(); peer.destroy(); };
  }, []);

  const resetSession = useCallback(() => {
    setCurrentScreen("home");
    setRemoteStream(null);
    remoteStreamRef.current = null;
    remoteIdRef.current = "";
    dispatch(setShowSessionDialog(false));
    // Tell electron: session ended → minimize is allowed again
    ipcRenderer.send("session-ended");
  }, []);

  const acceptCall = useCallback(async () => {
    const call = incomingCall;
    setIncomingCall(null);
    setIncomingCallerId("");
    setPendingCall(call);
    const srcs = await ipcRenderer.invoke("GET_SOURCES");
    setSources(srcs);
    setShowPicker(true);
  }, [incomingCall]);

  const rejectCall = useCallback(() => {
    const call     = incomingCall;
    const callerId = incomingCallerId;
    setIncomingCall(null);
    setIncomingCallerId("");
    if (call) call.close();
    socketRef.current?.emit("callrejected", { remoteId: callerId });
  }, [incomingCall, incomingCallerId]);

  const onSourceSelected = useCallback(async (sourceId) => {
    setShowPicker(false);
    const call = pendingCall;
    if (!call) return;

    await ipcRenderer.invoke("MINIMIZE_WIN");
    await new Promise((r) => setTimeout(r, 500));

    const tryCapture = (withAudio) => navigator.mediaDevices.getUserMedia({
      audio: withAudio ? { mandatory: { chromeMediaSource: "desktop" } } : false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
          minWidth: 1280, maxWidth: 1920,
          minHeight: 720,  maxHeight: 1080,
        },
      },
    });

    try {
      let stream;
      try   { stream = await tryCapture(true);  }
      catch { stream = await tryCapture(false); }

      // Add host mic so viewer can hear the host speak
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        micStream.getAudioTracks().forEach(t => stream.addTrack(t));
      } catch(e) { console.warn("Host mic unavailable:", e.message); }

      call.answer(stream);
      callRef.current     = call;
      remoteIdRef.current = call.peer;
      dispatch(setRemoteConnectionId(call.peer));
      dispatch(setSessionMode(0));
      dispatch(setSessionStartTime(new Date()));
      dispatch(setShowSessionDialog(true));
      // Tell electron: hosting session is now active → block window minimize
      // so viewer's remote control clicks on our minimize button don't kill the stream
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

  const startCall = useCallback((remoteId) => {
    const peer = peerInstance.current;
    if (!peer || peer.destroyed) { alert("Not connected to server yet."); return; }

    dispatch(setRemoteConnectionId(remoteId));
    remoteIdRef.current = remoteId;

    const call = peer.call(String(remoteId), createDummyStream());
    if (!call) { alert("Could not reach that peer. Are they online?"); return; }

    callRef.current = call;
    setCurrentScreen("viewing");

    call.on("stream", (stream) => {
      console.log("🎉 Stream received!", stream.getTracks().map(t => t.kind));
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
      dispatch(setSessionMode(1));
      dispatch(setSessionStartTime(new Date()));
    });
    call.on("error",  (err) => { console.error("Call error:", err); resetSession(); });
    call.on("close",  ()    => resetSession());
  }, [resetSession]);

  useEffect(() => { if (sessionEnded)  { resetSession(); setSessionEnded(false); } }, [sessionEnded]);
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
// // App.js
// import React, { useEffect, useRef, useState } from "react";
// import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
// import ConnectionScreen from "./screens/connection/ConnectionScreen";
// import AppScreen from "./screens/app/AppScreen";
// import io from "socket.io-client";
// import { useDispatch, useSelector } from "react-redux";
// import { setShowSessionDialog } from "./states/connectionSlice";

// // const ipcRenderer = window.electronAPI;

// const { ipcRenderer } = window.require("electron");

// // https://github.com/ishantchauhan710/DeskViewer/tree/master?tab=readme-ov-file

// // npx electron . 

// const App = () => {
//   const callRef = useRef();

//   const socket = io("http://127.0.0.1:5000");
//   // const socket = io(" 192.168.1.2:5000");

//   const remoteId = useSelector((state) => state.connection.remoteConnectionId);
//   const [sessionEnded, setSessionEnded] = useState(false);

//   // Socket connection
//   useEffect(() => {
//     socket.on("connect", () => {
//       console.log("Socket connected");
//     });

//     socket.on("connect_error", (e) => {
//       console.log("Socket connection error, retrying..." + e);
//       setTimeout(() => socket.connect(), 5000);
//     });

//     socket.on("disconnect", () => {
//       console.log("Socket disconnected");
//       if (remoteId) {
//         socket.emit("remotedisconnected", { remoteId: remoteId });
//       }
//     });

//     socket.on("remotedisconnected", () => {
//       //alert("Remote disconnected");
//       setSessionEnded(true);
//     });

//     // --------- MOUSE AND KEYBOARD EVENTS ----------

//     socket.on("mousemove", (event) => {
//       //console.log(`Mousemove: x=${event.x} y=${event.y}`);
//       ipcRenderer.send("mousemove", event);
//     });

//     socket.on("mousedown", (event) => {
//       console.log(`Mouse down: ${event.button}`);
//       ipcRenderer.send("mousedown", event);
//     });

//     socket.on("scroll", (event) => {
//       console.log(`Scroll: ${event.scroll}`);
//       ipcRenderer.send("scroll", event);
//     });

//     socket.on("keydown", (event) => {
//       console.log(`Key pressed: ${event.keyCode}`);
//       ipcRenderer.send("keydown", event);
//     });
//   }, []);

//   return (
//     socket && (
//       <HashRouter>
//         <Routes>
//           <Route path="/" exact element={<ConnectionScreen callRef={callRef} socket={socket} />} />
//           <Route path="/app" element={ <AppScreen callRef={callRef} socket={socket} sessionEnded={sessionEnded} /> } />
//           <Route path="*" element={<div>DeskViewer Error: Page not found</div>} />
//         </Routes>
//       </HashRouter>
//     )
//   );
// };

// export default App;

// ---------------------------------------------------------------------------------------------------------------------------------

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

  const [myId, setMyId]                         = useState("");
  const [currentScreen, setCurrentScreen]       = useState("home");
  const [remoteStream, setRemoteStream]         = useState(null);
  const [sessionEnded, setSessionEnded]         = useState(false);
  const [callRejected, setCallRejected]         = useState(false);  // NEW
  const [incomingCall, setIncomingCall]         = useState(null);
  const [incomingCallerId, setIncomingCallerId] = useState("");
  const [sources, setSources]                   = useState([]);
  const [showPicker, setShowPicker]             = useState(false);
  const [pendingCall, setPendingCall]           = useState(null);

  useEffect(() => {
    const uid = String(Math.floor(Math.random() * 9000000000) + 1000000000);
    setMyId(uid);
    dispatch(setUserConnectionId(uid));

    // local
    // const socket = io("http://127.0.0.1:5000", { reconnectionDelay: 1000 });

    // ngrok
    
    const socket = io("https://laevorotatory-painstakingly-lorraine.ngrok-free.dev", { reconnectionDelay: 1000 });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("🟢 Socket:", socket.id);
      socket.emit("join", "User" + uid);
    });

    socket.on("remotedisconnected", () => setSessionEnded(true));

    // NEW: host rejected — viewer gets this and goes back home with message
    socket.on("callrejected", () => {
      console.log("❌ Call was rejected by host");
      setCallRejected(true);
      setCurrentScreen("home");
      if (callRef.current) { callRef.current.close(); callRef.current = null; }
    });

    socket.on("mousemove", (e) => ipcRenderer.send("mousemove", e));
    socket.on("mousedown", (e) => ipcRenderer.send("mousedown", e));
    socket.on("mouseup",   (e) => ipcRenderer.send("mouseup",   e));
    socket.on("dblclick",  (e) => ipcRenderer.send("dblclick",  e));
    socket.on("scroll",    (e) => ipcRenderer.send("scroll",    e));
    socket.on("keydown",   (e) => ipcRenderer.send("keydown",   e));
    socket.on("keyup",     (e) => ipcRenderer.send("keyup",     e));

    
    const peer = new Peer(uid, {
      host:   CONFIG.PEER_HOST,
      port:   CONFIG.PEER_PORT,
      path:   CONFIG.PEER_PATH,
      secure: CONFIG.PEER_SECURE,  // true for https/ngrok
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

    peer.on("open",        (id)  => console.log("✅ PeerJS:", id));
    peer.on("disconnected", ()   => { if (!peer.destroyed) peer.reconnect(); });
    peer.on("error",       (err) => {
      console.error("❌ Peer:", err.type);
      if (err.type === "unavailable-id") window.location.reload();
    });
    peer.on("call", (call) => {
      console.log("📞 Incoming call from:", call.peer);
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
  }, []);

  // ── HOST: Accept — show source picker ────────────────────────────────────────
  const acceptCall = useCallback(async () => {
    const call = incomingCall;
    setIncomingCall(null);
    setIncomingCallerId("");
    setPendingCall(call);
    const srcs = await ipcRenderer.invoke("GET_SOURCES");
    setSources(srcs);
    setShowPicker(true);
  }, [incomingCall]);

  // ── HOST: Reject — close call AND notify viewer via socket ───────────────────
  const rejectCall = useCallback(() => {
    const call = incomingCall;
    const callerId = incomingCallerId;

    setIncomingCall(null);
    setIncomingCallerId("");

    // Close the PeerJS call
    if (call) call.close();

    // Tell viewer via socket so their screen goes back to home
    const socket = socketRef.current;
    if (socket && callerId) {
      socket.emit("callrejected", { remoteId: callerId });
    }
  }, [incomingCall, incomingCallerId]);

  // ── HOST: Source selected ─────────────────────────────────────────────────────
  const onSourceSelected = useCallback(async (sourceId) => {
    setShowPicker(false);
    const call = pendingCall;
    if (!call) return;

    await ipcRenderer.invoke("MINIMIZE_WIN");
    await new Promise((r) => setTimeout(r, 500));

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: "desktop" } },
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: sourceId,
            minWidth: 1280, maxWidth: 1920,
            minHeight: 720,  maxHeight: 1080,
          },
        },
      });

      call.answer(mediaStream);
      callRef.current = call;
      remoteIdRef.current = call.peer;
      dispatch(setRemoteConnectionId(call.peer));
      dispatch(setSessionMode(0));
      dispatch(setSessionStartTime(new Date()));
      dispatch(setShowSessionDialog(true));
      setTimeout(() => ipcRenderer.invoke("RESTORE_WIN"), 1000);
      call.on("close", () => resetSession());
      call.on("error", (e) => console.error("Host call error:", e));

    } catch (e) {
      ipcRenderer.invoke("RESTORE_WIN");
      // Retry without audio if system audio capture fails
      try {
        const videoOnly = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: sourceId,
              minWidth: 1280, maxWidth: 1920,
              minHeight: 720,  maxHeight: 1080,
            },
          },
        });
        call.answer(videoOnly);
        callRef.current = call;
        remoteIdRef.current = call.peer;
        dispatch(setRemoteConnectionId(call.peer));
        dispatch(setSessionMode(0));
        dispatch(setSessionStartTime(new Date()));
        dispatch(setShowSessionDialog(true));
        call.on("close", () => resetSession());
      } catch (e2) {
        alert("Screen capture failed: " + e2.message);
        // Reject the call since capture failed — notify viewer
        const socket = socketRef.current;
        if (socket && call.peer) socket.emit("callrejected", { remoteId: call.peer });
      }
    }
  }, [pendingCall, resetSession]);

  // ── VIEWER: Start call ────────────────────────────────────────────────────────
  const startCall = useCallback((remoteId) => {
    const peer = peerInstance.current;
    if (!peer || peer.destroyed) { alert("Not connected to server yet."); return; }

    dispatch(setRemoteConnectionId(remoteId));
    remoteIdRef.current = remoteId;

    const dummyStream = createDummyStream();
    const call = peer.call(String(remoteId), dummyStream);
    if (!call) { alert("Could not reach that peer. Are they online?"); return; }

    callRef.current = call;
    setCurrentScreen("viewing");

    call.on("stream", (stream) => {
      console.log("🎉 Stream received! tracks:", stream.getTracks().map(t => t.kind));
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
      dispatch(setSessionMode(1));
      dispatch(setSessionStartTime(new Date()));
    });

    call.on("error", (err) => { console.error("Call error:", err); resetSession(); });
    call.on("close", ()    => { console.log("Call closed");         resetSession(); });
  }, [resetSession]);

  // ── Session ended / rejected ──────────────────────────────────────────────────
  useEffect(() => {
    if (sessionEnded) { resetSession(); setSessionEnded(false); }
  }, [sessionEnded, resetSession]);

  // Auto-clear rejected state after showing message
  useEffect(() => {
    if (callRejected) {
      const t = setTimeout(() => setCallRejected(false), 4000);
      return () => clearTimeout(t);
    }
  }, [callRejected]);

  const handleDisconnect = useCallback(() => {
    const socket = socketRef.current;
    const rid = remoteIdRef.current;
    if (socket && rid) socket.emit("remotedisconnected", { remoteId: rid });
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
        incomingCall={incomingCall}
        incomingCallerId={incomingCallerId}
        acceptCall={acceptCall}
        rejectCall={rejectCall}
        startCall={startCall}
        onEndSession={handleDisconnect}
        callRejected={callRejected}        // show rejection banner
      />
      {showPicker && (
        <SourcePicker
          sources={sources}
          onSelect={onSourceSelected}
          onCancel={() => {
            setShowPicker(false);
            // If host cancels picker, also notify viewer
            if (pendingCall) {
              pendingCall.close();
              const socket = socketRef.current;
              if (socket && pendingCall.peer) {
                socket.emit("callrejected", { remoteId: pendingCall.peer });
              }
              setPendingCall(null);
            }
          }}
        />
      )}
    </>
  );
};

export default App;
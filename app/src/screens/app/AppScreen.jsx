// // AppScreen.jsx
// import React, { useEffect, useRef, useState } from "react";
// import { useDispatch, useSelector } from "react-redux";
// import SessionInfo from "../../components/SessionInfo";
// import SessionLoading from "../../components/SessionLoading";
// import {
//   setSessionMode,
//   setSessionStartTime,
//   setShowSessionDialog,
// } from "../../states/connectionSlice";

// import { ImConnection } from "react-icons/im";
// import { Navigate, useNavigate } from "react-router-dom";

// const AppScreen = ({ callRef, socket, sessionEnded }) => {
//   const videoRef = useRef();
//   const [remoteConnecting, setRemoteConnecting] = useState(true);
//   const dispatch = useDispatch();

//   const showSessionDialog = useSelector(
//     (state) => state.connection.showSessionDialog
//   );

//   const userId = useSelector((state) => state.connection.userConnectionId);
//   const remoteId = useSelector((state) => state.connection.remoteConnectionId);
//   const navigate = useNavigate();

//   useEffect(() => {
//     // When call is accepted
//     callRef.current.on("stream", function (remoteStream) {
//       setRemoteConnecting(false);
//       dispatch(setSessionMode(1));
//       dispatch(setSessionStartTime(new Date()));
//       dispatch(setShowSessionDialog(true));
//       videoRef.current.srcObject = remoteStream;
//       videoRef.current.play();
//     });

//     callRef.current.on("close", function () {
//       alert("Connection closed");
//       console.log("Closed");
//     });

//     callRef.current.on("error", function () {
//       alert("Connection error");
//       console.log("Error");
//     });
//   }, []);

//   // Handling key press
//   useEffect(() => {
//     if (socket) {
//       // -------- MOUSE CURSOR COORDINATES -------
//       let mousePos = null;
//       let lastPos = null;
//       // Whenever user moves cursor, save its coordinates in a variable
//       document.addEventListener("mousemove", (e) => {
//         mousePos = e;
//       });

//       // Every 100ms delay, share coordinates with connected user
//       setInterval(() => {
//         if (mousePos) {
//           socket.emit("mousemove", {
//             userId: userId,
//             remoteId: remoteId,
//             event: { x: mousePos.pageX, y: mousePos.pageY },
//           });
//         }
//       }, 100);

//       // -------- MOUSE LMB (0), MMB (1), RMB (2) CLICK -------
//       document.addEventListener("mousedown", (e) => {
//         socket.emit("mousedown", {
//           userId: userId,
//           remoteId: remoteId,
//           event: { button: e.button },
//         });
//       });

//       // ------- SCROLL ----------

//       document.addEventListener("wheel", (e) => {
//         console.log("Scrolling " + e.deltaY);
//         socket.emit("scroll", {
//           userId: userId,
//           remoteId: remoteId,
//           event: { scroll: e.deltaY },
//         });
//       });

//       // ------- KEYBOARD ----------
//       document.addEventListener("keydown", (e) => {
//         socket.emit("keydown", {
//           userId: userId,
//           remoteId: remoteId,
//           event: { keyCode: e.key },
//         });
//       });
//     }
//   }, [socket]);

//   useEffect(() => {
//     if (sessionEnded) {
//       navigate("/");
//       window.location.reload();
//     }
//   }, [sessionEnded]);

//   return (
//     <div className="h-screen bg-gray-700">
//       <video ref={videoRef} style={{ width: "100vw", height: "100vh" }} />
//       <button
//         onClick={() => dispatch(setShowSessionDialog(true))}
//         className="fixed flex items-center justify-center text-xl right-0 mt-5 mr-10 top-0 text-white px-4 w-auto h-12 bg-sky-600 rounded-full hover:bg-sky-500 active:shadow-lg mouse shadow transition ease-in duration-200 focus:outline-none"
//       >
//         <ImConnection />
//         <span className="ml-2 text-lg">Session Info</span>
//       </button>
//       {/* {remoteConnecting && <SessionLoading />} */}
//       {showSessionDialog && <SessionInfo socket={socket} />}
//     </div>
//   );
// };

// export default AppScreen;



// AppScreen.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import SessionInfo from "../../components/SessionInfo";
import { setShowSessionDialog } from "../../states/connectionSlice";

const { ipcRenderer } = window.require("electron");

const AppScreen = ({ remoteStream, remoteStreamRef, socketRef, callRef, remoteIdRef, onDisconnect, onEndSession }) => {
  const videoRef      = useRef(null);
  const dispatch      = useDispatch();
  const mousePosRef   = useRef(null);
  const screenSizeRef = useRef({ width: 1920, height: 1080 }); // host screen size

  const showSessionDialog = useSelector((s) => s.connection.showSessionDialog);
  const userId   = useSelector((s) => s.connection.userConnectionId);
  const remoteId = useSelector((s) => s.connection.remoteConnectionId);

  const [videoPlaying,   setVideoPlaying]   = useState(false);
  const [controlEnabled, setControlEnabled] = useState(false);
  const [muted,          setMuted]          = useState(false);
  const [showToolbar,    setShowToolbar]     = useState(true);
  const toolbarTimerRef = useRef(null);

  // ── Get host screen resolution on mount ──────────────────────────────────────
  useEffect(() => {
    ipcRenderer.invoke("GET_SCREEN_SIZE").then((size) => {
      if (size) {
        screenSizeRef.current = size;
        console.log("Host screen size:", size);
      }
    });
  }, []);

  // ── Attach stream ─────────────────────────────────────────────────────────────
  const attachStream = useCallback((stream) => {
    if (!stream || !videoRef.current) return;
    const video = videoRef.current;
    video.srcObject = stream;
    video.muted = muted;
    video.play()
      .then(() => { console.log("✅ Video playing"); setVideoPlaying(true); })
      .catch(() => setTimeout(() => video.play().then(() => setVideoPlaying(true)).catch(console.error), 600));
  }, []);

  useEffect(() => { if (remoteStream)           attachStream(remoteStream);           }, [remoteStream]);
  useEffect(() => { if (remoteStreamRef?.current) attachStream(remoteStreamRef.current); }, []);

  // ── Mute ──────────────────────────────────────────────────────────────────────
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (videoRef.current) videoRef.current.muted = next;
  };

  // ── Auto-hide toolbar ─────────────────────────────────────────────────────────
  const resetToolbar = useCallback(() => {
    setShowToolbar(true);
    clearTimeout(toolbarTimerRef.current);
    toolbarTimerRef.current = setTimeout(() => setShowToolbar(false), 3500);
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", resetToolbar);
    resetToolbar();
    return () => { window.removeEventListener("mousemove", resetToolbar); clearTimeout(toolbarTimerRef.current); };
  }, [resetToolbar]);

  // ── CORRECT coordinate scaling ────────────────────────────────────────────────
  // objectFit: "contain" adds letterbox bars — must account for them
  const getScaledCoords = useCallback((e) => {
    const video = videoRef.current;
    if (!video) return { x: 0, y: 0 };

    const rect         = video.getBoundingClientRect();
    const hostW        = screenSizeRef.current.width;
    const hostH        = screenSizeRef.current.height;

    // Calculate actual video render size inside the element (letterboxed)
    const videoAspect  = hostW / hostH;
    const elemAspect   = rect.width / rect.height;

    let renderW, renderH, offsetX, offsetY;

    if (videoAspect > elemAspect) {
      // Letterbox top/bottom (horizontal bars)
      renderW = rect.width;
      renderH = rect.width / videoAspect;
      offsetX = 0;
      offsetY = (rect.height - renderH) / 2;
    } else {
      // Pillarbox left/right (vertical bars)
      renderH = rect.height;
      renderW = rect.height * videoAspect;
      offsetY = 0;
      offsetX = (rect.width - renderW) / 2;
    }

    // Mouse position relative to actual video content (excluding bars)
    const relX = e.clientX - rect.left - offsetX;
    const relY = e.clientY - rect.top  - offsetY;

    // Clamp to video bounds
    const clampedX = Math.max(0, Math.min(relX, renderW));
    const clampedY = Math.max(0, Math.min(relY, renderH));

    // Scale to host resolution
    return {
      x: Math.round((clampedX / renderW) * hostW),
      y: Math.round((clampedY / renderH) * hostH),
    };
  }, []);

  // ── Remote control event listeners ───────────────────────────────────────────
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !remoteId || !userId || !controlEnabled || !videoRef.current) return;

    const video = videoRef.current;

    const onMouseMove = (e) => {
      mousePosRef.current = getScaledCoords(e);
    };

    const onMouseDown = (e) => {
      e.preventDefault();
      const coords = getScaledCoords(e);
      // Send both mousedown AND click — more reliable across OS
      socket.emit("mousedown", { userId, remoteId, event: { button: e.button, ...coords } });
      socket.emit("click",     { userId, remoteId, event: { button: e.button, ...coords } });
    };

    const onMouseUp = (e) => {
      const coords = getScaledCoords(e);
      socket.emit("mouseup", { userId, remoteId, event: { button: e.button, ...coords } });
    };

    const onDblClick = (e) => {
      e.preventDefault();
      socket.emit("dblclick", { userId, remoteId, event: getScaledCoords(e) });
    };

    const onWheel = (e) => {
      e.preventDefault();
      socket.emit("scroll", { userId, remoteId, event: { scroll: e.deltaY, ...getScaledCoords(e) } });
    };

    const onKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === "I") return; // keep DevTools
      if (e.key === "Escape") { setControlEnabled(false); return; }
      e.preventDefault();
      socket.emit("keydown", {
        userId, remoteId,
        event: { keyCode: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey },
      });
    };

    const onKeyUp = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === "I") return;
      socket.emit("keyup", { userId, remoteId, event: { keyCode: e.key } });
    };

    // Throttled mousemove — 60fps
    const interval = setInterval(() => {
      if (mousePosRef.current) {
        socket.emit("mousemove", { userId, remoteId, event: mousePosRef.current });
        mousePosRef.current = null;
      }
    }, 16);

    video.addEventListener("mousemove",  onMouseMove);
    video.addEventListener("mousedown",  onMouseDown);
    video.addEventListener("mouseup",    onMouseUp);
    video.addEventListener("dblclick",   onDblClick);
    video.addEventListener("wheel",      onWheel,    { passive: false });
    window.addEventListener("keydown",   onKeyDown);
    window.addEventListener("keyup",     onKeyUp);

    // Change cursor to crosshair when control is on
    video.style.cursor = "crosshair";

    return () => {
      clearInterval(interval);
      video.removeEventListener("mousemove",  onMouseMove);
      video.removeEventListener("mousedown",  onMouseDown);
      video.removeEventListener("mouseup",    onMouseUp);
      video.removeEventListener("dblclick",   onDblClick);
      video.removeEventListener("wheel",      onWheel);
      window.removeEventListener("keydown",   onKeyDown);
      window.removeEventListener("keyup",     onKeyUp);
      video.style.cursor = "default";
    };
  }, [controlEnabled, socketRef, userId, remoteId, getScaledCoords]);

  const handleDisconnect = () => {
    if (!window.confirm("End this session?")) return;
    const rid = remoteIdRef?.current || remoteId;
    if (socketRef.current && rid) socketRef.current.emit("remotedisconnected", { remoteId: rid });
    if (callRef.current) { callRef.current.close(); callRef.current = null; }
    onDisconnect();
  };

  const btn = (bg, active) => ({
    display: "flex", alignItems: "center", gap: 6,
    padding: "7px 14px", borderRadius: 8,
    background: bg, border: active ? "2px solid #fff" : "2px solid transparent",
    color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
    transition: "all 0.15s",
  });

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#000", position: "relative", overflow: "hidden" }}>

      {/* Remote screen */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
      />

      {/* Loading */}
      {!videoPlaying && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#111827", zIndex: 10 }}>
          <svg className="animate-spin" style={{ width: 52, height: 52, color: "#38bdf8", marginBottom: 20 }} viewBox="0 0 24 24" fill="none">
            <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path   style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <p style={{ color: "#fff", fontSize: 18, fontWeight: 600, margin: 0 }}>Connecting to remote screen...</p>
          <p style={{ color: "#9ca3af", fontSize: 14, marginTop: 8 }}>Waiting for host to share</p>
          <button onClick={onDisconnect} style={{ marginTop: 24, padding: "8px 24px", borderRadius: 8, border: "1px solid #4b5563", background: "transparent", color: "#d1d5db", cursor: "pointer" }}>Cancel</button>
        </div>
      )}

      {/* Toolbar */}
      {videoPlaying && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 16px",
          background: "linear-gradient(to bottom, rgba(0,0,0,0.85), transparent)",
          zIndex: 20, transition: "opacity 0.4s",
          opacity: showToolbar ? 1 : 0,
          pointerEvents: showToolbar ? "auto" : "none",
        }}>
          {/* Status */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 8px #4ade80" }} />
            <span style={{ color: "#fff", fontSize: 13, fontWeight: 500 }}>Connected · {remoteId}</span>
            {controlEnabled && (
              <span style={{ background: "#dc2626", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, marginLeft: 6 }}>
                CONTROL ACTIVE
              </span>
            )}
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={toggleMute} style={btn(muted ? "#4b5563" : "#0369a1", false)}>
              {muted
                ? <svg style={{width:15,height:15}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/></svg>
                : <svg style={{width:15,height:15}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z"/></svg>
              }
              {muted ? "Unmute" : "Mute"}
            </button>

            <button onClick={() => setControlEnabled(c => !c)} style={btn(controlEnabled ? "#b91c1c" : "#7c3aed", controlEnabled)}>
              <svg style={{width:15,height:15}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 6-5 2zm0 0l5 5"/>
              </svg>
              {controlEnabled ? "Release Control" : "Request Control"}
            </button>

            <button onClick={() => dispatch(setShowSessionDialog(true))} style={btn("#0284c7", false)}>
              <svg style={{width:15,height:15}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              Session Info
            </button>

            <button onClick={handleDisconnect} style={btn("#dc2626", false)}>
              <svg style={{width:15,height:15}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
              </svg>
              Disconnect
            </button>
          </div>
        </div>
      )}

      {/* Control hint at bottom */}
      {controlEnabled && videoPlaying && (
        <div style={{
          position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
          background: "rgba(185,28,28,0.92)", color: "#fff",
          padding: "7px 20px", borderRadius: 20, fontSize: 12, fontWeight: 600,
          zIndex: 20, display: "flex", alignItems: "center", gap: 8,
          boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fca5a5" }} />
          Remote Control Active · Press Esc to release
        </div>
      )}

      {showSessionDialog && <SessionInfo socket={socketRef.current} onEndSession={onEndSession} />}
    </div>
  );
};

export default AppScreen;
// // AppScreen.jsx
// import React, { useEffect, useRef, useState, useCallback } from "react";
// import { useDispatch, useSelector } from "react-redux";
// import SessionInfo from "../../components/SessionInfo";
// import { setShowSessionDialog } from "../../states/connectionSlice";

// const { ipcRenderer } = window.require("electron");

// const AppScreen = ({ remoteStream, remoteStreamRef, socketRef, callRef, remoteIdRef, userIdRef, onDisconnect, onEndSession }) => {
//   const videoRef    = useRef(null);
//   const dispatch    = useDispatch();
//   const mousePosRef = useRef(null);
//   const controlRef  = useRef(false);

//   const showSessionDialog = useSelector((s) => s.connection.showSessionDialog);

//   const [videoPlaying,   setVideoPlaying]   = useState(false);
//   const [controlEnabled, setControlEnabled] = useState(false);
//   const [muted,          setMuted]          = useState(false);
//   const [showToolbar,    setShowToolbar]     = useState(true);
//   const toolbarTimerRef = useRef(null);

//   // ── Stream attach ─────────────────────────────────────────────────────────────
//   const attachStream = useCallback((stream) => {
//     if (!stream || !videoRef.current) return;
//     const video = videoRef.current;
//     video.srcObject = stream;
//     video.muted = false;
//     video.play()
//       .then(() => {
//         setVideoPlaying(true);
//         // Maximize viewer window so the video fills as much screen as possible
//         // This is critical for small-screen viewers accessing big-screen hosts
//         // More screen space = more precise cursor control
//         ipcRenderer.send("maximize-for-viewing");
//       })
//       .catch(() => setTimeout(() => {
//         video.play()
//           .then(() => { setVideoPlaying(true); ipcRenderer.send("maximize-for-viewing"); })
//           .catch(console.error);
//       }, 600));
//   }, []);

//   useEffect(() => { if (remoteStream)            attachStream(remoteStream);            }, [remoteStream]);
//   useEffect(() => { if (remoteStreamRef?.current) attachStream(remoteStreamRef.current); }, []);

//   const toggleMute = () => {
//     const next = !muted;
//     setMuted(next);
//     if (videoRef.current) videoRef.current.muted = next;
//   };

//   const minimizeWindow = () => ipcRenderer.send("minimize-to-taskbar");

//   // ── Toolbar auto-hide ─────────────────────────────────────────────────────────
//   const scheduleHide = useCallback(() => {
//     clearTimeout(toolbarTimerRef.current);
//     if (!controlRef.current) {
//       toolbarTimerRef.current = setTimeout(() => setShowToolbar(false), 3000);
//     }
//   }, []);

//   const handleMouseMove = useCallback(() => {
//     if (controlRef.current) return;
//     setShowToolbar(true);
//     scheduleHide();
//   }, [scheduleHide]);

//   useEffect(() => {
//     window.addEventListener("mousemove", handleMouseMove);
//     scheduleHide();
//     return () => { window.removeEventListener("mousemove", handleMouseMove); clearTimeout(toolbarTimerRef.current); };
//   }, [handleMouseMove, scheduleHide]);

//   // ── Coordinate scaling ────────────────────────────────────────────────────────
//   //
//   // Full explanation of the small→big screen problem:
//   //
//   //   Host stream resolution = video.videoWidth x video.videoHeight (e.g. 1920x1080)
//   //   Viewer window = smaller (e.g. 1366x712 after toolbar removed)
//   //
//   //   objectFit:contain will letterbox/pillarbox the video.
//   //   We calculate the actual rendered area inside the video element.
//   //   Mouse position relative to that area → scale to stream resolution → send to host.
//   //
//   //   Host then scales stream coords → logical screen coords via toLogical().
//   //   This two-step process is correct for any combination of screen sizes.
//   //
//   //   Key: we use video.videoWidth/Height (not screen size) as the target space.
//   //   This is always correct because stream IS what gets displayed in the video element.

//   const getScaledCoords = useCallback((e) => {
//     const video = videoRef.current;
//     if (!video) return { x: 0, y: 0 };

//     const rect         = video.getBoundingClientRect();
//     const streamW      = video.videoWidth  || 1280;
//     const streamH      = video.videoHeight || 720;
//     const streamAspect = streamW / streamH;
//     const elemAspect   = rect.width / rect.height;

//     let renderW, renderH, offsetX, offsetY;
//     if (streamAspect > elemAspect) {
//       // Black bars TOP and BOTTOM (letterbox)
//       renderW = rect.width;
//       renderH = rect.width / streamAspect;
//       offsetX = 0;
//       offsetY = (rect.height - renderH) / 2;
//     } else {
//       // Black bars LEFT and RIGHT (pillarbox)
//       renderH = rect.height;
//       renderW = rect.height * streamAspect;
//       offsetX = (rect.width - renderW) / 2;
//       offsetY = 0;
//     }

//     // Clamp to rendered video area only (exclude black bars)
//     const relX = Math.max(0, Math.min(e.clientX - rect.left - offsetX, renderW));
//     const relY = Math.max(0, Math.min(e.clientY - rect.top  - offsetY, renderH));

//     return {
//       x: Math.round((relX / renderW) * streamW),
//       y: Math.round((relY / renderH) * streamH),
//     };
//   }, []);

//   // ── Input listeners attached once ────────────────────────────────────────────
//   useEffect(() => {
//     const video = videoRef.current;
//     if (!video) return;

//     const emit = (name, data) => {
//       const socket   = socketRef.current;
//       const remoteId = String(remoteIdRef.current || "");
//       const uid      = String(userIdRef.current   || "");
//       if (!socket?.connected || !remoteId || !uid) return;
//       socket.emit(name, { userId: uid, remoteId, event: data });
//     };

//     const onMouseMove = (e) => { if (!controlRef.current) return; mousePosRef.current = getScaledCoords(e); };
//     const onMouseDown = (e) => {
//       if (!controlRef.current) return;
//       e.preventDefault(); e.stopPropagation();
//       const c = getScaledCoords(e);
//       emit("click",     { button: e.button, ...c });
//       emit("mousedown", { button: e.button, ...c });
//     };
//     const onMouseUp  = (e) => { if (!controlRef.current) return; emit("mouseup",  { button: e.button, ...getScaledCoords(e) }); };
//     const onDblClick = (e) => { if (!controlRef.current) return; e.preventDefault(); emit("dblclick", getScaledCoords(e)); };
//     const onWheel    = (e) => { if (!controlRef.current) return; e.preventDefault(); emit("scroll", { scroll: e.deltaY, ...getScaledCoords(e) }); };

//     const onKeyDown = (e) => {
//       if (!controlRef.current) return;
//       if (e.ctrlKey && e.shiftKey && e.key === "I") return;
//       if (e.key === "Escape") {
//         controlRef.current = false;
//         setControlEnabled(false);
//         setShowToolbar(true);
//         video.style.cursor = "default";
//         ipcRenderer.send("set-global-capture", false);
//         return;
//       }
//       e.preventDefault();
//       emit("keydown", { keyCode: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
//     };
//     const onKeyUp     = (e) => { if (!controlRef.current) return; emit("keyup", { keyCode: e.key }); };
//     const onGlobalKey = (_, d) => { if (controlRef.current) emit("keydown", d); };
//     ipcRenderer.on("global-keydown", onGlobalKey);

//     const interval = setInterval(() => {
//       if (!controlRef.current || !mousePosRef.current) return;
//       const socket   = socketRef.current;
//       const remoteId = String(remoteIdRef.current || "");
//       const uid      = String(userIdRef.current   || "");
//       if (socket?.connected && remoteId && uid) {
//         socket.emit("mousemove", { userId: uid, remoteId, event: mousePosRef.current });
//         mousePosRef.current = null;
//       }
//     }, 16);

//     video.addEventListener("mousemove", onMouseMove);
//     video.addEventListener("mousedown", onMouseDown);
//     video.addEventListener("mouseup",   onMouseUp);
//     video.addEventListener("dblclick",  onDblClick);
//     video.addEventListener("wheel",     onWheel,   { passive: false });
//     window.addEventListener("keydown",  onKeyDown);
//     window.addEventListener("keyup",    onKeyUp);

//     return () => {
//       clearInterval(interval);
//       ipcRenderer.removeListener("global-keydown", onGlobalKey);
//       video.removeEventListener("mousemove", onMouseMove);
//       video.removeEventListener("mousedown", onMouseDown);
//       video.removeEventListener("mouseup",   onMouseUp);
//       video.removeEventListener("dblclick",  onDblClick);
//       video.removeEventListener("wheel",     onWheel);
//       window.removeEventListener("keydown",  onKeyDown);
//       window.removeEventListener("keyup",    onKeyUp);
//     };
//   }, [getScaledCoords]);

//   const toggleControl = () => {
//     const next = !controlRef.current;
//     controlRef.current = next;
//     setControlEnabled(next);

//     if (next) {
//       setShowToolbar(false);
//       clearTimeout(toolbarTimerRef.current);
//       if (videoRef.current) videoRef.current.style.cursor = "none";
//     } else {
//       setShowToolbar(true);
//       scheduleHide();
//       if (videoRef.current) videoRef.current.style.cursor = "default";
//     }

//     ipcRenderer.send("set-global-capture", next);

//     // Send stream resolution to host for accurate coordinate scaling
//     if (next && videoRef.current) {
//       const sw = videoRef.current.videoWidth  || 1280;
//       const sh = videoRef.current.videoHeight || 720;
//       const socket   = socketRef.current;
//       const remoteId = String(remoteIdRef.current || "");
//       const uid      = String(userIdRef.current   || "");
//       if (socket?.connected && remoteId && uid) {
//         socket.emit("stream-resolution", { userId: uid, remoteId, event: { width: sw, height: sh } });
//         console.log(`📐 Stream resolution sent: ${sw}x${sh}`);
//       }
//     }
//   };

//   const handleDisconnect = () => {
//     if (!window.confirm("End this session?")) return;
//     ipcRenderer.send("set-global-capture", false);
//     const rid = remoteIdRef?.current;
//     if (socketRef.current && rid) socketRef.current.emit("remotedisconnected", { remoteId: rid });
//     if (callRef.current) { callRef.current.close(); callRef.current = null; }
//     onDisconnect();
//   };

//   const tbtn = (bg, active) => ({
//     display: "flex", alignItems: "center", gap: 5,
//     padding: "6px 12px", borderRadius: 7, background: bg,
//     border: active ? "1.5px solid rgba(255,255,255,0.7)" : "1.5px solid transparent",
//     color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
//   });

//   const iconBtn = (title, onClick, icon) => (
//     <button title={title} onClick={onClick} style={{
//       background: "rgba(255,255,255,0.12)", border: "1.5px solid transparent",
//       borderRadius: 7, padding: "6px 10px", color: "#fff", cursor: "pointer",
//       display: "flex", alignItems: "center",
//     }}>{icon}</button>
//   );

//   const toolbarVisible = showToolbar && !controlEnabled;

//   return (
//     <div style={{ width: "100vw", height: "100vh", background: "#0a0a0a", display: "flex", flexDirection: "column", overflow: "hidden" }}>

//       {/* TOOLBAR — collapses to 0 when control active */}
//       <div style={{
//         flexShrink: 0,
//         height: toolbarVisible ? 56 : 0,
//         overflow: "hidden",
//         transition: "height 0.2s ease",
//         display: "flex", alignItems: "center", justifyContent: "space-between",
//         padding: toolbarVisible ? "0 14px" : "0",
//         background: "rgba(15,15,20,0.97)",
//         borderBottom: toolbarVisible ? "1px solid rgba(255,255,255,0.07)" : "none",
//       }}>
//         <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
//           <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 6px #4ade80" }} />
//           <span style={{ color: "#e5e7eb", fontSize: 13, fontWeight: 500 }}>{remoteIdRef.current}</span>
//         </div>
//         <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
//           {iconBtn("Minimize to taskbar", minimizeWindow,
//             <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
//               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4"/>
//             </svg>
//           )}
//           <button onClick={toggleMute} style={tbtn(muted ? "#4b5563" : "#0369a1", false)}>
//             {muted
//               ? <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/></svg>
//               : <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z"/></svg>
//             }
//             {muted ? "Unmute" : "Mute"}
//           </button>
//           <button onClick={toggleControl} style={tbtn("#7c3aed", false)}>
//             <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
//               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 6-5 2zm0 0l5 5"/>
//             </svg>
//             Request Control
//           </button>
//           <button onClick={() => dispatch(setShowSessionDialog(true))} style={tbtn("#0284c7", false)}>
//             <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
//               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
//             </svg>
//             Info
//           </button>
//           <button onClick={handleDisconnect} style={tbtn("#dc2626", false)}>
//             <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
//               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
//             </svg>
//             Disconnect
//           </button>
//         </div>
//       </div>

//       {/* VIDEO AREA */}
//       <div style={{ flex: 1, position: "relative", background: "#000", overflow: "hidden" }}>

//         {!videoPlaying && (
//           <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#111827", zIndex: 5 }}>
//             <svg className="animate-spin" style={{ width: 48, height: 48, color: "#38bdf8", marginBottom: 16 }} viewBox="0 0 24 24" fill="none">
//               <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
//               <path   style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
//             </svg>
//             <p style={{ color: "#fff", fontSize: 17, fontWeight: 600, margin: 0 }}>Connecting to remote screen...</p>
//             <p style={{ color: "#9ca3af", fontSize: 13, marginTop: 8 }}>Waiting for host to share</p>
//             <button onClick={onDisconnect} style={{ marginTop: 20, padding: "8px 22px", borderRadius: 8, border: "1px solid #4b5563", background: "transparent", color: "#d1d5db", cursor: "pointer" }}>Cancel</button>
//           </div>
//         )}

//         <video
//           ref={videoRef}
//           autoPlay
//           playsInline
//           style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
//         />

//         {/* Control active bar at TOP — never blocks bottom taskbar */}
//         {controlEnabled && videoPlaying && (
//           <div style={{
//             position: "absolute", top: 0, left: 0, right: 0,
//             display: "flex", alignItems: "center", justifyContent: "space-between",
//             padding: "5px 12px",
//             background: "linear-gradient(to bottom, rgba(120,20,20,0.92), transparent)",
//             pointerEvents: "none",
//             zIndex: 5,
//           }}>
//             <span style={{ color: "#fca5a5", fontSize: 11, fontWeight: 700, pointerEvents: "none" }}>
//               ● CONTROL ACTIVE · Esc to release
//             </span>
//             <button
//               onClick={toggleControl}
//               style={{
//                 pointerEvents: "auto",
//                 background: "rgba(185,28,28,0.9)", border: "1px solid rgba(255,255,255,0.25)",
//                 borderRadius: 6, padding: "3px 12px",
//                 color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer",
//               }}
//             >
//               Release
//             </button>
//           </div>
//         )}
//       </div>

//       {showSessionDialog && <SessionInfo socket={socketRef.current} onEndSession={onEndSession} />}
//     </div>
//   );
// };

// export default AppScreen;



// AppScreen.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import SessionInfo from "../../components/SessionInfo";
import { setShowSessionDialog } from "../../states/connectionSlice";
import CONFIG from "../../config";

const { ipcRenderer } = window.require("electron");

const fmt = (bytes) => {
  if (bytes < 1024)       return bytes + " B";
  if (bytes < 1024*1024)  return (bytes/1024).toFixed(1) + " KB";
  return (bytes/1024/1024).toFixed(1) + " MB";
};
const isImage = (t="") => t.startsWith("image/");
const msgId   = () => Math.random().toString(36).slice(2);

// Common emoji list
const EMOJIS = ["😀","😂","😍","🥰","😎","😭","😅","🤔","😮","😡","👍","👎","❤️","🔥","✅","❌","🎉","🙏","💯","👀","😂","🤣","😊","😇","🥳","😴","🤯","🤝","💪","🎊","👋","✌️","🫡","💬","📎","🖼️","🚀","⭐","💡","🔔"];

const AppScreen = ({ remoteStream, remoteStreamRef, socketRef, callRef, remoteIdRef, userIdRef, onDisconnect, onEndSession }) => {
  const videoRef      = useRef(null);
  const dispatch      = useDispatch();
  const mousePosRef   = useRef(null);
  const controlRef    = useRef(false);
  const localMicRef   = useRef(null);  // local mic MediaStream
  const micTrackRef   = useRef(null);  // actual audio track (to mute/unmute)

  const showSessionDialog = useSelector((s) => s.connection.showSessionDialog);

  const [videoPlaying,   setVideoPlaying]   = useState(false);
  const [controlEnabled, setControlEnabled] = useState(false);
  const [muted,          setMuted]          = useState(false);   // mic mute
  const [showToolbar,    setShowToolbar]     = useState(true);
  const [hostMinimized,  setHostMinimized]   = useState(false);

  // chat
  const [showChat,     setShowChat]     = useState(false);
  const [messages,     setMessages]     = useState([]);
  const [chatInput,    setChatInput]    = useState("");
  const [uploading,    setUploading]    = useState(false);
  const [unread,       setUnread]       = useState(0);
  const [showEmoji,    setShowEmoji]    = useState(false);
  const chatEndRef    = useRef(null);
  const fileInputRef  = useRef(null);
  const textareaRef   = useRef(null);
  const toolbarTimerRef = useRef(null);

  // ── Start mic and add track to existing call ───────────────────────────────
  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localMicRef.current = stream;
      const track = stream.getAudioTracks()[0];
      micTrackRef.current = track;

      // Add mic track to the existing PeerJS call so remote hears us
      const call = callRef.current;
      if (call?.peerConnection) {
        call.peerConnection.getSenders().forEach(s => {
          // replace empty audio sender if exists, else add
        });
        try { call.peerConnection.addTrack(track, stream); } catch(e) {}
      }
      console.log("🎤 Mic started");
    } catch(e) {
      console.warn("Mic access denied:", e.message);
    }
  }, [callRef]);

  // ── stream attach ──────────────────────────────────────────────────────────
  const attachStream = useCallback((stream) => {
    if (!stream || !videoRef.current) return;
    const video = videoRef.current;
    video.srcObject = stream;
    video.muted = false;  // hear remote audio
    const tryPlay = () =>
      video.play()
        .then(() => {
          setVideoPlaying(true);
          ipcRenderer.send("maximize-for-viewing");
          startMic(); // start mic as soon as stream is playing
        })
        .catch(() => setTimeout(tryPlay, 600));
    tryPlay();
  }, [startMic]);

  useEffect(() => { if (remoteStream)             attachStream(remoteStream);            }, [remoteStream]);
  useEffect(() => { if (remoteStreamRef?.current)  attachStream(remoteStreamRef.current); }, []);

  // ── Mute / Unmute YOUR mic ─────────────────────────────────────────────────
  const toggleMute = () => {
    const track = micTrackRef.current;
    if (track) {
      track.enabled = !track.enabled;   // false = muted (stops sending audio)
      setMuted(!track.enabled);
    } else {
      // Mic not started yet — try again
      startMic().then(() => setMuted(false));
    }
  };

  // ── toolbar auto-hide ──────────────────────────────────────────────────────
  const scheduleHide = useCallback(() => {
    clearTimeout(toolbarTimerRef.current);
    if (!controlRef.current)
      toolbarTimerRef.current = setTimeout(() => setShowToolbar(false), 3000);
  }, []);

  useEffect(() => {
    const onMove = () => { if (controlRef.current) return; setShowToolbar(true); scheduleHide(); };
    window.addEventListener("mousemove", onMove);
    scheduleHide();
    return () => { window.removeEventListener("mousemove", onMove); clearTimeout(toolbarTimerRef.current); };
  }, [scheduleHide]);

  // ── window minimize / restore ──────────────────────────────────────────────
  useEffect(() => {
    const onMinimized = () => {
      if (videoRef.current) videoRef.current.style.cursor = "default";
      setShowToolbar(true);
      clearTimeout(toolbarTimerRef.current);
    };
    const onRestored = (_, payload) => {
      const wasActive = payload?.controlActive ?? false;
      if (videoRef.current)
        videoRef.current.style.cursor = (wasActive && controlRef.current) ? "none" : "default";
      if (!controlRef.current) { setShowToolbar(true); scheduleHide(); }
    };
    const onHostMin = () => {
      setHostMinimized(true);
      if (controlRef.current) {
        controlRef.current = false;
        setControlEnabled(false);
        if (videoRef.current) videoRef.current.style.cursor = "default";
        ipcRenderer.send("set-global-capture", false);
      }
    };
    const onHostRes = () => setHostMinimized(false);

    ipcRenderer.on("window-minimized",      onMinimized);
    ipcRenderer.on("window-restored",       onRestored);
    ipcRenderer.on("host-window-minimized", onHostMin);
    ipcRenderer.on("host-window-restored",  onHostRes);
    return () => {
      ipcRenderer.removeListener("window-minimized",      onMinimized);
      ipcRenderer.removeListener("window-restored",       onRestored);
      ipcRenderer.removeListener("host-window-minimized", onHostMin);
      ipcRenderer.removeListener("host-window-restored",  onHostRes);
    };
  }, [scheduleHide]);

  // cleanup mic on unmount
  useEffect(() => () => { localMicRef.current?.getTracks().forEach(t => t.stop()); }, []);

  // ── CHAT: receive ──────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const onMsg = (msg) => {
      setMessages(prev => [...prev, msg]);
      if (!showChat) setUnread(prev => prev + 1);
    };
    socket.on("chat-message", onMsg);
    return () => socket.off("chat-message", onMsg);
  }, [showChat]);

  useEffect(() => {
    if (showChat) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, showChat]);

  const toggleChat = () => { setShowEmoji(false); setShowChat(v => { if (!v) setUnread(0); return !v; }); };

  // ── CHAT: send text ────────────────────────────────────────────────────────
  const sendText = () => {
    const text = chatInput.trim();
    if (!text) return;
    const socket   = socketRef.current;
    const remoteId = String(remoteIdRef.current || "");
    const uid      = String(userIdRef.current   || "");
    if (!socket?.connected || !remoteId) return;
    const msg = { id: msgId(), from: "me", fromId: uid, text, ts: Date.now() };
    setMessages(prev => [...prev, msg]);
    socket.emit("chat-message", { remoteId, msg: { ...msg, from: "them" } });
    setChatInput("");
    setShowEmoji(false);
  };

  // insert emoji at cursor position
  const insertEmoji = (emoji) => {
    const el = textareaRef.current;
    if (!el) { setChatInput(v => v + emoji); return; }
    const start = el.selectionStart;
    const end   = el.selectionEnd;
    const next  = chatInput.slice(0, start) + emoji + chatInput.slice(end);
    setChatInput(next);
    setTimeout(() => { el.selectionStart = el.selectionEnd = start + emoji.length; el.focus(); }, 0);
  };

  // ── CHAT: send file ────────────────────────────────────────────────────────
  const sendFile = async (file) => {
    if (!file) return;
    const socket   = socketRef.current;
    const remoteId = String(remoteIdRef.current || "");
    const uid      = String(userIdRef.current   || "");
    if (!socket?.connected || !remoteId) return;
    setUploading(true);
    try {
      const fd   = new FormData();
      fd.append("file", file);
      const base = CONFIG.SOCKET_URL.replace(/\/$/, "");
      const res  = await fetch(`${base}/upload`, { method: "POST", body: fd });
      const data = await res.json();
      const msg  = { id: msgId(), from: "me", fromId: uid, file: data, ts: Date.now() };
      setMessages(prev => [...prev, msg]);
      socket.emit("chat-message", { remoteId, msg: { ...msg, from: "them" } });
    } catch(e) { console.error("Upload failed:", e); }
    finally    { setUploading(false); }
  };

  // ── coordinates ────────────────────────────────────────────────────────────
  const getCoords = (e) => {
    const video = videoRef.current;
    if (!video) return { x:0, y:0 };
    const rect  = video.getBoundingClientRect();
    const sw    = video.videoWidth  || 1280;
    const sh    = video.videoHeight || 720;
    const sa    = sw / sh;
    const ea    = rect.width / rect.height;
    let rW, rH, oX, oY;
    if (sa > ea) { rW = rect.width; rH = rect.width/sa; oX = 0; oY = (rect.height-rH)/2; }
    else         { rH = rect.height; rW = rect.height*sa; oX = (rect.width-rW)/2; oY = 0; }
    const relX = Math.max(0, Math.min(e.clientX - rect.left - oX, rW));
    const relY = Math.max(0, Math.min(e.clientY - rect.top  - oY, rH));
    return { x: Math.round((relX/rW)*sw), y: Math.round((relY/rH)*sh) };
  };

  // ── stream resolution ──────────────────────────────────────────────────────
  const sendResolution = useCallback(() => {
    const video = videoRef.current;
    if (!video?.videoWidth) { setTimeout(sendResolution, 200); return; }
    const socket   = socketRef.current;
    const remoteId = String(remoteIdRef.current || "");
    const uid      = String(userIdRef.current   || "");
    if (socket?.connected && remoteId && uid)
      socket.emit("stream-resolution", { userId:uid, remoteId, event:{ width:video.videoWidth, height:video.videoHeight }});
  }, []);

  // ── input listeners ────────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const emit = (name, data) => {
      const socket   = socketRef.current;
      const remoteId = String(remoteIdRef.current || "");
      const uid      = String(userIdRef.current   || "");
      if (!socket?.connected || !remoteId || !uid) return;
      socket.emit(name, { userId:uid, remoteId, event:data });
    };

    const onMouseDown = (e) => {
      if (!controlRef.current) return;
      e.preventDefault(); e.stopPropagation();
      emit("mousedown", { button:e.button, ...getCoords(e) });
    };
    const onMouseUp  = (e) => { if (!controlRef.current) return; emit("mouseup",  { button:e.button, ...getCoords(e) }); };
    const onDblClick = (e) => { if (!controlRef.current) return; e.preventDefault(); emit("dblclick", getCoords(e)); };

    let scrollAccum = 0;
    const onWheel = (e) => {
      if (!controlRef.current) return;
      e.preventDefault();
      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 40;
      if (e.deltaMode === 2) delta *= 800;
      scrollAccum += delta * 8;
      const steps = Math.round(scrollAccum / 100);
      if (steps === 0) return;
      scrollAccum -= steps * 100;
      emit("scroll", { scroll: steps * 100, ...getCoords(e) });
    };

    const onMouseMove = (e) => { if (!controlRef.current) return; mousePosRef.current = getCoords(e); };

    const onKeyDown = (e) => {
      if (!controlRef.current) return;
      if (e.ctrlKey && e.shiftKey && e.key === "I") return;
      // Don't forward keys when typing in chat
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "Escape") {
        controlRef.current = false;
        setControlEnabled(false);
        setShowToolbar(true);
        video.style.cursor = "default";
        ipcRenderer.send("set-global-capture", false);
        return;
      }
      e.preventDefault();
      emit("keydown", { keyCode:e.key, ctrl:e.ctrlKey, shift:e.shiftKey, alt:e.altKey, meta:e.metaKey });
    };
    const onKeyUp = (e) => {
      if (!controlRef.current) return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      emit("keyup", { keyCode:e.key });
    };
    const onGlobalKey = (_, d) => { if (controlRef.current) emit("keydown", d); };
    ipcRenderer.on("global-keydown", onGlobalKey);

    const interval = setInterval(() => {
      if (!controlRef.current || !mousePosRef.current) return;
      const socket   = socketRef.current;
      const remoteId = String(remoteIdRef.current || "");
      const uid      = String(userIdRef.current   || "");
      if (socket?.connected && remoteId && uid) {
        socket.emit("mousemove", { userId:uid, remoteId, event:mousePosRef.current });
        mousePosRef.current = null;
      }
    }, 16);

    video.addEventListener("mousemove", onMouseMove);
    video.addEventListener("mousedown", onMouseDown);
    video.addEventListener("mouseup",   onMouseUp);
    video.addEventListener("dblclick",  onDblClick);
    video.addEventListener("wheel",     onWheel, { passive:false });
    window.addEventListener("keydown",  onKeyDown);
    window.addEventListener("keyup",    onKeyUp);

    return () => {
      clearInterval(interval);
      ipcRenderer.removeListener("global-keydown", onGlobalKey);
      video.removeEventListener("mousemove", onMouseMove);
      video.removeEventListener("mousedown", onMouseDown);
      video.removeEventListener("mouseup",   onMouseUp);
      video.removeEventListener("dblclick",  onDblClick);
      video.removeEventListener("wheel",     onWheel);
      window.removeEventListener("keydown",  onKeyDown);
      window.removeEventListener("keyup",    onKeyUp);
    };
  }, []);

  // ── toggle control ─────────────────────────────────────────────────────────
  const toggleControl = () => {
    const next = !controlRef.current;
    controlRef.current = next;
    setControlEnabled(next);
    if (next) {
      dispatch(setShowSessionDialog(false));
      setShowToolbar(true);
      clearTimeout(toolbarTimerRef.current);
      if (videoRef.current) videoRef.current.style.cursor = "none";
      sendResolution();
    } else {
      setShowToolbar(true);
      scheduleHide();
      if (videoRef.current) videoRef.current.style.cursor = "default";
    }
    ipcRenderer.send("set-global-capture", next);
  };

  const handleDisconnect = () => {
    if (!window.confirm("End this session?")) return;
    ipcRenderer.send("set-global-capture", false);
    localMicRef.current?.getTracks().forEach(t => t.stop());
    const rid = remoteIdRef?.current;
    if (socketRef.current && rid) socketRef.current.emit("remotedisconnected", { remoteId:rid });
    if (callRef.current) { callRef.current.close(); callRef.current = null; }
    onDisconnect();
  };

  // ── style helpers ──────────────────────────────────────────────────────────
  const tbtn = (bg) => ({
    display:"flex", alignItems:"center", gap:5, padding:"6px 13px", borderRadius:7,
    background:bg, border:"1.5px solid transparent",
    color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap",
  });
  const ibtn = (title, fn, icon, badge) => (
    <button title={title} onClick={fn} style={{
      position:"relative", background:"rgba(255,255,255,0.1)", border:"1.5px solid transparent",
      borderRadius:7, padding:"6px 10px", color:"#fff", cursor:"pointer", display:"flex", alignItems:"center",
    }}>
      {icon}
      {badge > 0 && (
        <span style={{ position:"absolute", top:-4, right:-4, background:"#ef4444", color:"#fff",
          fontSize:9, fontWeight:700, borderRadius:"50%", width:14, height:14,
          display:"flex", alignItems:"center", justifyContent:"center" }}>
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );

  // ── chat bubble ────────────────────────────────────────────────────────────
  const Bubble = ({ msg }) => {
    const mine = msg.from === "me";
    const base = CONFIG.SOCKET_URL.replace(/\/$/, "");
    return (
      <div style={{ display:"flex", justifyContent: mine?"flex-end":"flex-start", marginBottom:6 }}>
        <div style={{
          maxWidth:"78%",
          borderRadius: mine?"12px 12px 2px 12px":"12px 12px 12px 2px",
          background: mine?"#7c3aed":"#1f2937",
          padding: msg.file?"6px":"8px 12px",
          boxShadow:"0 1px 4px rgba(0,0,0,0.3)",
        }}>
          {msg.text && <p style={{ margin:0, color:"#fff", fontSize:13, wordBreak:"break-word", whiteSpace:"pre-wrap" }}>{msg.text}</p>}
          {msg.file && isImage(msg.file.type) && (
            <a href={base+msg.file.url} target="_blank" rel="noreferrer">
              <img src={base+msg.file.url} alt={msg.file.name}
                style={{ maxWidth:220, maxHeight:160, borderRadius:8, display:"block" }} />
            </a>
          )}
          {msg.file && !isImage(msg.file.type) && (
            <a href={base+msg.file.url} target="_blank" rel="noreferrer"
              style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", textDecoration:"none" }}>
              <svg style={{width:22,height:22,flexShrink:0,color:"#93c5fd"}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              <div>
                <div style={{ color:"#e5e7eb", fontSize:12, fontWeight:600, wordBreak:"break-all" }}>{msg.file.name}</div>
                <div style={{ color:"#9ca3af", fontSize:10 }}>{fmt(msg.file.size)}</div>
              </div>
            </a>
          )}
          <div style={{ color: mine?"rgba(255,255,255,0.45)":"#6b7280", fontSize:10, marginTop:3,
            textAlign:"right", paddingRight: msg.file?8:0 }}>
            {new Date(msg.ts).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}
          </div>
        </div>
      </div>
    );
  };

  const toolbarVisible = showToolbar;

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ width:"100vw", height:"100vh", background:"#0a0a0a", display:"flex", flexDirection:"column", overflow:"hidden" }}>

      {/* ── TOOLBAR ── */}
      <div style={{
        flexShrink:0, overflow:"hidden",
        height: toolbarVisible ? 54 : 0,
        transition:"height 0.2s ease",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding: toolbarVisible ? "0 14px" : 0,
        background:"rgba(13,13,18,0.98)",
        borderBottom: toolbarVisible ? "1px solid rgba(255,255,255,0.07)" : "none",
      }}>

        {/* LEFT: status dot + remote ID + control indicator inline */}
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:7, height:7, borderRadius:"50%", background:"#4ade80", boxShadow:"0 0 6px #4ade80" }}/>
          <span style={{ color:"#d1d5db", fontSize:13, fontWeight:500 }}>{remoteIdRef.current}</span>
          {/* ● CONTROL ACTIVE inline with remote ID */}
          {controlEnabled && (
            <span style={{
              display:"flex", alignItems:"center", gap:4,
              background:"rgba(185,28,28,0.85)", borderRadius:5,
              padding:"2px 8px", fontSize:10, fontWeight:700, color:"#fca5a5",
            }}>
              ● CONTROL ACTIVE · Esc to release
            </span>
          )}
        </div>

        {/* RIGHT: buttons */}
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>

          {ibtn("Minimize", () => ipcRenderer.send("minimize-to-taskbar"),
            <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4"/>
            </svg>
          )}

          {/* Mute mic button */}
          <button onClick={toggleMute} style={tbtn(muted ? "#374151" : "#0369a1")} title={muted ? "Unmute mic" : "Mute mic"}>
            {muted ? (
              // mic off icon
              <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
                <line x1="3" y1="3" x2="21" y2="21" strokeWidth={2} strokeLinecap="round"/>
              </svg>
            ) : (
              // mic on icon
              <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
              </svg>
            )}
            {muted ? "Unmute" : "Mute"}
          </button>

          <button onClick={toggleControl} style={tbtn(controlEnabled ? "#dc2626" : "#7c3aed")}>
            <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 6-5 2zm0 0l5 5"/>
            </svg>
            {controlEnabled ? "Release" : "Request Control"}
          </button>

          {ibtn("Chat", toggleChat,
            <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
            </svg>,
            unread
          )}

          <button onClick={() => dispatch(setShowSessionDialog(true))} style={tbtn("#0284c7")}>
            <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            Info
          </button>

          <button onClick={handleDisconnect} style={tbtn("#dc2626")}>
            <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
            Disconnect
          </button>
        </div>
      </div>

      {/* ── MAIN AREA ── */}
      <div style={{ flex:1, display:"flex", overflow:"hidden", position:"relative" }}>

        {/* VIDEO */}
        <div style={{ flex:1, position:"relative", background:"#000", overflow:"hidden" }}>
          {!videoPlaying && (
            <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"#111827", zIndex:5 }}>
              <svg style={{ width:48, height:48, color:"#38bdf8", marginBottom:16 }} viewBox="0 0 24 24" fill="none">
                <circle style={{opacity:0.25}} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path style={{opacity:0.75}} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              <p style={{ color:"#fff", fontSize:17, fontWeight:600, margin:0 }}>Connecting to remote screen...</p>
              <p style={{ color:"#9ca3af", fontSize:13, marginTop:8 }}>Waiting for host to share</p>
              <button onClick={onDisconnect} style={{ marginTop:20, padding:"8px 22px", borderRadius:8, border:"1px solid #4b5563", background:"transparent", color:"#d1d5db", cursor:"pointer" }}>Cancel</button>
            </div>
          )}

          <video ref={videoRef} autoPlay playsInline
            style={{ width:"100%", height:"100%", objectFit:"contain", display:"block" }}
          />

          {hostMinimized && (
            <div style={{ position:"absolute", inset:0, zIndex:10, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.85)", backdropFilter:"blur(4px)" }}>
              <svg style={{ width:48, height:48, color:"#f59e0b", marginBottom:14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7"/>
              </svg>
              <p style={{ color:"#fff", fontSize:16, fontWeight:700, margin:0 }}>Host minimized DeskViewer</p>
              <p style={{ color:"#9ca3af", fontSize:13, marginTop:6, textAlign:"center", maxWidth:280 }}>Ask the host to restore their window.</p>
            </div>
          )}
        </div>

        {/* ── CHAT PANEL ── */}
        {showChat && (
          <div style={{
            width:300, display:"flex", flexDirection:"column",
            background:"#111827", borderLeft:"1px solid rgba(255,255,255,0.07)",
            flexShrink:0, position:"relative",
          }}>
            {/* header */}
            <div style={{ padding:"10px 14px", borderBottom:"1px solid rgba(255,255,255,0.07)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ color:"#e5e7eb", fontSize:13, fontWeight:600 }}>Chat</span>
              <button onClick={toggleChat} style={{ background:"none", border:"none", color:"#9ca3af", cursor:"pointer", padding:2 }}>
                <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* messages */}
            <div style={{ flex:1, overflowY:"auto", padding:"10px 10px 4px", display:"flex", flexDirection:"column" }}>
              {messages.length === 0 && (
                <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:"#4b5563" }}>
                  <svg style={{width:36,height:36,marginBottom:8}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
                  </svg>
                  <span style={{ fontSize:12 }}>No messages yet</span>
                </div>
              )}
              {messages.map(m => <Bubble key={m.id} msg={m} />)}
              <div ref={chatEndRef} />
            </div>

            {/* uploading */}
            {uploading && (
              <div style={{ padding:"4px 14px", color:"#60a5fa", fontSize:11, display:"flex", alignItems:"center", gap:6 }}>
                <svg style={{width:11,height:11}} viewBox="0 0 24 24" fill="none">
                  <circle style={{opacity:0.25}} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path style={{opacity:0.75}} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Uploading...
              </div>
            )}

            {/* emoji picker */}
            {showEmoji && (
              <div style={{
                position:"absolute", bottom:58, left:0, right:0,
                background:"#1f2937", borderTop:"1px solid rgba(255,255,255,0.08)",
                padding:"8px", display:"flex", flexWrap:"wrap", gap:2, maxHeight:140, overflowY:"auto",
              }}>
                {EMOJIS.map(e => (
                  <button key={e} onClick={() => insertEmoji(e)}
                    style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", padding:"2px 4px", borderRadius:4, lineHeight:1 }}
                    title={e}>
                    {e}
                  </button>
                ))}
              </div>
            )}

            {/* input row */}
            <div style={{ padding:"8px 10px", borderTop:"1px solid rgba(255,255,255,0.07)", display:"flex", gap:6, alignItems:"flex-end" }}>

              {/* attach */}
              <button onClick={() => fileInputRef.current?.click()} title="Attach file"
                style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:7, padding:"7px 8px", color:"#9ca3af", cursor:"pointer", flexShrink:0, display:"flex", alignItems:"center" }}>
                <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/>
                </svg>
              </button>
              <input ref={fileInputRef} type="file" style={{ display:"none" }}
                onChange={(e) => { sendFile(e.target.files[0]); e.target.value=""; }} />

              {/* emoji toggle */}
              <button onClick={() => setShowEmoji(v => !v)} title="Emoji"
                style={{ background: showEmoji?"rgba(124,58,237,0.3)":"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:7, padding:"7px 8px", color:"#9ca3af", cursor:"pointer", flexShrink:0, display:"flex", alignItems:"center", fontSize:13 }}>
                😊
              </button>

              {/* text */}
              <textarea ref={textareaRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); sendText(); } }}
                placeholder="Message… (Enter)"
                rows={1}
                style={{ flex:1, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)",
                  borderRadius:7, padding:"7px 10px", color:"#e5e7eb", fontSize:12, resize:"none",
                  outline:"none", fontFamily:"inherit", lineHeight:1.4, maxHeight:80, overflowY:"auto" }}
              />

              {/* send */}
              <button onClick={sendText} disabled={!chatInput.trim()}
                style={{ background:chatInput.trim()?"#7c3aed":"rgba(255,255,255,0.06)", border:"none", borderRadius:7,
                  padding:"7px 10px", color:"#fff", cursor:chatInput.trim()?"pointer":"default",
                  flexShrink:0, display:"flex", alignItems:"center", transition:"background 0.15s" }}>
                <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {showSessionDialog && !controlEnabled && (
        <SessionInfo socket={socketRef.current} onEndSession={onEndSession} />
      )}
    </div>
  );
};

export default AppScreen;
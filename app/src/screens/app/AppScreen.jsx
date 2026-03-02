// // AppScreen.jsx
// import React, { useEffect, useRef, useState, useCallback } from "react";
// import { useDispatch, useSelector } from "react-redux";
// import SessionInfo from "../../components/SessionInfo";
// import { setShowSessionDialog } from "../../states/connectionSlice";
// import CONFIG from "../../config";

// const { ipcRenderer } = window.require("electron");

// const fmt = (bytes) => {
//   if (bytes < 1024)       return bytes + " B";
//   if (bytes < 1024*1024)  return (bytes/1024).toFixed(1) + " KB";
//   return (bytes/1024/1024).toFixed(1) + " MB";
// };
// const isImage = (t="") => t.startsWith("image/");
// const msgId   = () => Math.random().toString(36).slice(2);

// const EMOJIS = [
//   "😀","😂","😍","🥰","😎","😭","😅","🤔","😮","😡",
//   "👍","👎","❤️","🔥","✅","❌","🎉","🙏","💯","👀",
//   "🤣","😊","😇","🥳","😴","🤯","🤝","💪","🎊","👋",
//   "✌️","🫡","💬","📎","🖼️","🚀","⭐","💡","🔔","😆",
// ];

// // ─────────────────────────────────────────────────────────────────────────────
// const AppScreen = ({
//   remoteStream, remoteStreamRef, socketRef, callRef,
//   remoteIdRef, userIdRef, localMicTrackRef,
//   audioRef,          // pre-unlocked <audio> ref passed from App.js
//   onDisconnect, onEndSession,
// }) => {
//   const videoRef        = useRef(null);
//   // Use the ref passed from App.js (already pre-unlocked during Connect gesture).
//   // Fallback to a local ref in case AppScreen is ever used standalone.
//   const _localAudioRef  = useRef(null);
//   const _audioRef       = audioRef ?? _localAudioRef;
//   const dispatch        = useDispatch();
//   const mousePosRef     = useRef(null);
//   const controlRef      = useRef(false);
//   const toolbarTimerRef = useRef(null);

//   const showSessionDialog = useSelector((s) => s.connection.showSessionDialog);

//   const [videoPlaying,   setVideoPlaying]   = useState(false);
//   const [controlEnabled, setControlEnabled] = useState(false);
//   const [muted,          setMuted]          = useState(true);   // YOUR mic — starts muted
//   const [showToolbar,    setShowToolbar]     = useState(true);
//   const [hostMinimized,  setHostMinimized]   = useState(false);

//   // chat
//   const [showChat,   setShowChat]   = useState(false);
//   const [messages,   setMessages]   = useState([]);
//   const [chatInput,  setChatInput]  = useState("");
//   const [uploading,  setUploading]  = useState(false);
//   const [unread,     setUnread]     = useState(0);
//   const [showEmoji,  setShowEmoji]  = useState(false);
//   const chatEndRef   = useRef(null);
//   const fileInputRef = useRef(null);
//   const textareaRef  = useRef(null);

//   // ── Attach remote stream ───────────────────────────────────────────────────
//   // <video muted> shows the screen (no audio from it).
//   // <audio> plays only the audio tracks — this bypasses Electron's autoplay muting.
//   const attachStream = useCallback((stream) => {
//     if (!stream) return;

//     // Screen video — muted so we control audio separately
//     if (videoRef.current) {
//       videoRef.current.srcObject = stream;
//       videoRef.current.muted     = true;
//       videoRef.current.volume    = 0;
//       const tryPlay = () =>
//         videoRef.current?.play()
//           .then(() => { setVideoPlaying(true); ipcRenderer.send("maximize-for-viewing"); })
//           .catch(e => { console.warn("video.play():", e.message); setTimeout(tryPlay, 600); });
//       tryPlay();
//     }

//     // Audio-only element — plays desktop audio + host mic
//     if (_audioRef.current) {
//       const audioTracks = stream.getAudioTracks();
//       console.log("🔊 Viewer audio tracks:", audioTracks.map(t => `${t.kind} label=${t.label} enabled=${t.enabled} state=${t.readyState}`));
//       const audioEl = _audioRef.current;
//       const playAudio = (el, tracks) => {
//         if (tracks.length === 0) { console.warn("🔊 No audio tracks yet"); return; }
//         const audioOnly = new MediaStream(tracks);
//         el.srcObject = audioOnly;
//         el.volume    = 1.0;
//         el.muted     = false;
//         el.play().catch(e => console.warn("audio.play():", e.message));
//       };

//       if (audioTracks.length > 0) {
//         playAudio(audioEl, audioTracks);
//       } else {
//         console.warn("🔊 No audio tracks yet — listening for addtrack");
//         stream.addEventListener("addtrack", (ev) => {
//           if (ev.track.kind === "audio" && _audioRef.current) {
//             console.log("🔊 Audio track added to stream");
//             playAudio(_audioRef.current, stream.getAudioTracks());
//           }
//         });
//       }
//     }
//   }, []);

//   useEffect(() => { if (remoteStream)            attachStream(remoteStream);            }, [remoteStream, attachStream]);
//   useEffect(() => { if (remoteStreamRef?.current) attachStream(remoteStreamRef.current); }, []);

//   // Sync muted UI with track state.
//   // Use a small delay because viewer's mic is muted after 200ms in App.js.
//   // State starts as true (muted) which is correct default.
//   useEffect(() => {
//     const t = setTimeout(() => {
//       const track = localMicTrackRef?.current;
//       if (track) setMuted(!track.enabled);
//     }, 300);
//     return () => clearTimeout(t);
//   }, []);

//   // ── Mute / unmute YOUR mic ─────────────────────────────────────────────────
//   const toggleMute = () => {
//     const track = localMicTrackRef?.current;
//     if (!track) { console.warn("🎤 No mic track"); return; }
//     track.enabled = !track.enabled;
//     setMuted(!track.enabled);
//     console.log(`🎤 Viewer mic → ${track.enabled ? "UNMUTED (host can hear you)" : "MUTED"}`);
//   };

//   // ── Toolbar auto-hide ──────────────────────────────────────────────────────
//   const scheduleHide = useCallback(() => {
//     clearTimeout(toolbarTimerRef.current);
//     if (!controlRef.current)
//       toolbarTimerRef.current = setTimeout(() => setShowToolbar(false), 3000);
//   }, []);

//   useEffect(() => {
//     const onMove = () => { if (controlRef.current) return; setShowToolbar(true); scheduleHide(); };
//     window.addEventListener("mousemove", onMove);
//     scheduleHide();
//     return () => { window.removeEventListener("mousemove", onMove); clearTimeout(toolbarTimerRef.current); };
//   }, [scheduleHide]);

//   // ── Window events ──────────────────────────────────────────────────────────
//   useEffect(() => {
//     const onMin    = () => { videoRef.current && (videoRef.current.style.cursor = "default"); setShowToolbar(true); clearTimeout(toolbarTimerRef.current); };
//     const onRes    = (_, p) => {
//       if (videoRef.current) videoRef.current.style.cursor = (p?.controlActive && controlRef.current) ? "none" : "default";
//       if (!controlRef.current) { setShowToolbar(true); scheduleHide(); }
//     };
//     const onHostMin = () => {
//       setHostMinimized(true);
//       if (controlRef.current) { controlRef.current = false; setControlEnabled(false); videoRef.current && (videoRef.current.style.cursor = "default"); ipcRenderer.send("set-global-capture", false); }
//     };
//     const onHostRes = () => setHostMinimized(false);

//     ipcRenderer.on("window-minimized",      onMin);
//     ipcRenderer.on("window-restored",       onRes);
//     ipcRenderer.on("host-window-minimized", onHostMin);
//     ipcRenderer.on("host-window-restored",  onHostRes);
//     return () => {
//       ipcRenderer.removeListener("window-minimized",      onMin);
//       ipcRenderer.removeListener("window-restored",       onRes);
//       ipcRenderer.removeListener("host-window-minimized", onHostMin);
//       ipcRenderer.removeListener("host-window-restored",  onHostRes);
//     };
//   }, [scheduleHide]);

//   // ── Cleanup on unmount ─────────────────────────────────────────────────────
//   useEffect(() => () => {
//     if (videoRef.current) videoRef.current.srcObject = null;
//     if (_audioRef.current) _audioRef.current.srcObject = null;
//   }, []);

//   // ── Chat: receive ──────────────────────────────────────────────────────────
//   useEffect(() => {
//     const socket = socketRef.current;
//     if (!socket) return;
//     const onMsg = (msg) => {
//       setMessages(prev => [...prev, msg]);
//       if (!showChat) setUnread(u => u + 1);
//     };
//     socket.on("chat-message", onMsg);
//     return () => socket.off("chat-message", onMsg);
//   }, [showChat]);

//   useEffect(() => { if (showChat) chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, showChat]);

//   const toggleChat = () => { setShowEmoji(false); setShowChat(v => { if (!v) setUnread(0); return !v; }); };

//   // ── Chat: send text ────────────────────────────────────────────────────────
//   const sendText = () => {
//     const text = chatInput.trim(); if (!text) return;
//     const socket   = socketRef.current;
//     const remoteId = String(remoteIdRef.current || "");
//     const uid      = String(userIdRef.current   || "");
//     if (!socket?.connected || !remoteId) return;
//     const msg = { id:msgId(), from:"me", fromId:uid, text, ts:Date.now() };
//     setMessages(p => [...p, msg]);
//     socket.emit("chat-message", { remoteId, msg:{ ...msg, from:"them" } });
//     setChatInput(""); setShowEmoji(false);
//   };

//   const insertEmoji = (emoji) => {
//     const el = textareaRef.current;
//     if (!el) { setChatInput(v => v + emoji); return; }
//     const s = el.selectionStart ?? chatInput.length;
//     const e = el.selectionEnd   ?? chatInput.length;
//     setChatInput(chatInput.slice(0,s) + emoji + chatInput.slice(e));
//     setTimeout(() => { el.selectionStart = el.selectionEnd = s + emoji.length; el.focus(); }, 0);
//   };

//   // ── Chat: send file ────────────────────────────────────────────────────────
//   const sendFile = async (file) => {
//     if (!file) return;
//     const socket   = socketRef.current;
//     const remoteId = String(remoteIdRef.current || "");
//     const uid      = String(userIdRef.current   || "");
//     if (!socket?.connected || !remoteId) return;
//     setUploading(true);
//     try {
//       const fd  = new FormData(); fd.append("file", file);
//       const res = await fetch(`${CONFIG.SOCKET_URL.replace(/\/$/,"")}/upload`, { method:"POST", body:fd });
//       const data = await res.json();
//       const msg  = { id:msgId(), from:"me", fromId:uid, file:data, ts:Date.now() };
//       setMessages(p => [...p, msg]);
//       socket.emit("chat-message", { remoteId, msg:{ ...msg, from:"them" } });
//     } catch(e) { console.error("Upload failed:", e); }
//     finally    { setUploading(false); }
//   };

//   // ── Coordinates ────────────────────────────────────────────────────────────
//   const getCoords = (e) => {
//     const v = videoRef.current; if (!v) return { x:0, y:0 };
//     const r = v.getBoundingClientRect();
//     const sw = v.videoWidth||1280, sh = v.videoHeight||720;
//     const sa = sw/sh, ea = r.width/r.height;
//     let rW, rH, oX, oY;
//     if (sa>ea) { rW=r.width; rH=r.width/sa; oX=0; oY=(r.height-rH)/2; }
//     else       { rH=r.height; rW=r.height*sa; oX=(r.width-rW)/2; oY=0; }
//     return { x:Math.round((Math.max(0,Math.min(e.clientX-r.left-oX,rW))/rW)*sw), y:Math.round((Math.max(0,Math.min(e.clientY-r.top-oY,rH))/rH)*sh) };
//   };

//   const sendResolution = useCallback(() => {
//     const v = videoRef.current; if (!v?.videoWidth) { setTimeout(sendResolution,200); return; }
//     const s = socketRef.current, rid = String(remoteIdRef.current||""), uid = String(userIdRef.current||"");
//     if (s?.connected && rid && uid) s.emit("stream-resolution", { userId:uid, remoteId:rid, event:{ width:v.videoWidth, height:v.videoHeight }});
//   }, []);

//   // ── Input listeners ────────────────────────────────────────────────────────
//   useEffect(() => {
//     const video = videoRef.current; if (!video) return;
//     const emit = (name, data) => {
//       const s = socketRef.current, rid = String(remoteIdRef.current||""), uid = String(userIdRef.current||"");
//       if (s?.connected && rid && uid) s.emit(name, { userId:uid, remoteId:rid, event:data });
//     };
//     const onMD = (e) => { if (!controlRef.current) return; e.preventDefault(); e.stopPropagation(); emit("mousedown",{ button:e.button,...getCoords(e) }); };
//     const onMU = (e) => { if (!controlRef.current) return; emit("mouseup",{ button:e.button,...getCoords(e) }); };
//     const onDC = (e) => { if (!controlRef.current) return; e.preventDefault(); emit("dblclick",getCoords(e)); };
//     let acc=0;
//     const onW  = (e) => {
//       if (!controlRef.current) return; e.preventDefault();
//       let d=e.deltaY; if (e.deltaMode===1) d*=40; if (e.deltaMode===2) d*=800;
//       acc+=d*8; const steps=Math.round(acc/100); if (!steps) return; acc-=steps*100;
//       emit("scroll",{ scroll:steps*100,...getCoords(e) });
//     };
//     const onMM = (e) => { if (controlRef.current) mousePosRef.current=getCoords(e); };
//     const onKD = (e) => {
//       if (!controlRef.current) return;
//       if (e.ctrlKey&&e.shiftKey&&e.key==="I") return;
//       const tag = document.activeElement?.tagName?.toLowerCase();
//       if (tag==="input"||tag==="textarea") return;
//       if (e.key==="Escape") { controlRef.current=false; setControlEnabled(false); setShowToolbar(true); video.style.cursor="default"; ipcRenderer.send("set-global-capture",false); return; }
//       e.preventDefault();
//       emit("keydown",{ keyCode:e.key, ctrl:e.ctrlKey, shift:e.shiftKey, alt:e.altKey, meta:e.metaKey });
//     };
//     const onKU = (e) => {
//       if (!controlRef.current) return;
//       const tag = document.activeElement?.tagName?.toLowerCase();
//       if (tag==="input"||tag==="textarea") return;
//       emit("keyup",{ keyCode:e.key });
//     };
//     const onGK = (_,d) => { if (controlRef.current) emit("keydown",d); };
//     ipcRenderer.on("global-keydown", onGK);

//     const iv = setInterval(() => {
//       if (!controlRef.current || !mousePosRef.current) return;
//       const s = socketRef.current, rid = String(remoteIdRef.current||""), uid = String(userIdRef.current||"");
//       if (s?.connected && rid && uid) { s.emit("mousemove",{ userId:uid, remoteId:rid, event:mousePosRef.current }); mousePosRef.current=null; }
//     }, 16);

//     video.addEventListener("mousemove",onMM); video.addEventListener("mousedown",onMD);
//     video.addEventListener("mouseup",onMU);   video.addEventListener("dblclick",onDC);
//     video.addEventListener("wheel",onW,{ passive:false });
//     window.addEventListener("keydown",onKD);  window.addEventListener("keyup",onKU);
//     return () => {
//       clearInterval(iv); ipcRenderer.removeListener("global-keydown",onGK);
//       video.removeEventListener("mousemove",onMM); video.removeEventListener("mousedown",onMD);
//       video.removeEventListener("mouseup",onMU);   video.removeEventListener("dblclick",onDC);
//       video.removeEventListener("wheel",onW);
//       window.removeEventListener("keydown",onKD);  window.removeEventListener("keyup",onKU);
//     };
//   }, []);

//   // ── Toggle control ─────────────────────────────────────────────────────────
//   const toggleControl = () => {
//     const next = !controlRef.current; controlRef.current=next; setControlEnabled(next);
//     if (next) { dispatch(setShowSessionDialog(false)); setShowToolbar(true); clearTimeout(toolbarTimerRef.current); videoRef.current&&(videoRef.current.style.cursor="none"); sendResolution(); }
//     else      { setShowToolbar(true); scheduleHide(); videoRef.current&&(videoRef.current.style.cursor="default"); }
//     ipcRenderer.send("set-global-capture", next);
//   };

//   // ── Disconnect ─────────────────────────────────────────────────────────────
//   const handleDisconnect = () => {
//     if (!window.confirm("End this session?")) return;
//     // Clean up audio/video immediately
//     if (_audioRef.current) _audioRef.current.srcObject = null;
//     if (videoRef.current) videoRef.current.srcObject = null;
//     setMessages([]); setShowChat(false); setUnread(0);
//     ipcRenderer.send("set-global-capture", false);
//     const rid = remoteIdRef?.current;
//     if (socketRef.current && rid) socketRef.current.emit("remotedisconnected", { remoteId:rid });
//     if (callRef.current) { callRef.current.close(); callRef.current=null; }
//     onDisconnect();
//   };

//   // ── Style helpers ──────────────────────────────────────────────────────────
//   const tbtn = (bg) => ({ display:"flex", alignItems:"center", gap:5, padding:"6px 13px", borderRadius:7, background:bg, border:"1.5px solid transparent", color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" });
//   const ibtn = (title, fn, icon, badge) => (
//     <button title={title} onClick={fn} style={{ position:"relative", background:"rgba(255,255,255,0.1)", border:"1.5px solid transparent", borderRadius:7, padding:"6px 10px", color:"#fff", cursor:"pointer", display:"flex", alignItems:"center" }}>
//       {icon}
//       {badge>0 && <span style={{ position:"absolute", top:-4, right:-4, background:"#ef4444", color:"#fff", fontSize:9, fontWeight:700, borderRadius:"50%", width:14, height:14, display:"flex", alignItems:"center", justifyContent:"center" }}>{badge>9?"9+":badge}</span>}
//     </button>
//   );

//   // ── Chat bubble ────────────────────────────────────────────────────────────
//   const Bubble = ({ msg }) => {
//     const mine = msg.from==="me";
//     const base = CONFIG.SOCKET_URL.replace(/\/$/,"");
//     return (
//       <div style={{ display:"flex", justifyContent:mine?"flex-end":"flex-start", marginBottom:6 }}>
//         <div style={{ maxWidth:"78%", boxShadow:"0 1px 4px rgba(0,0,0,0.3)", borderRadius:mine?"12px 12px 2px 12px":"12px 12px 12px 2px", background:mine?"#7c3aed":"#1f2937", padding:msg.file?"6px":"8px 12px" }}>
//           {msg.text && <p style={{ margin:0, color:"#fff", fontSize:13, wordBreak:"break-word", whiteSpace:"pre-wrap" }}>{msg.text}</p>}
//           {msg.file && isImage(msg.file.type) && (
//             <a href={base+msg.file.url} target="_blank" rel="noreferrer">
//               <img src={base+msg.file.url} alt={msg.file.name} style={{ maxWidth:220, maxHeight:160, borderRadius:8, display:"block" }}/>
//             </a>
//           )}
//           {msg.file && !isImage(msg.file.type) && (
//             <a href={base+msg.file.url} target="_blank" rel="noreferrer" style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", textDecoration:"none" }}>
//               <svg style={{width:22,height:22,flexShrink:0,color:"#93c5fd"}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
//               <div><div style={{ color:"#e5e7eb", fontSize:12, fontWeight:600, wordBreak:"break-all" }}>{msg.file.name}</div><div style={{ color:"#9ca3af", fontSize:10 }}>{fmt(msg.file.size)}</div></div>
//             </a>
//           )}
//           <div style={{ color:mine?"rgba(255,255,255,0.45)":"#6b7280", fontSize:10, marginTop:3, textAlign:"right", paddingRight:msg.file?8:0 }}>
//             {new Date(msg.ts).toLocaleTimeString([],{ hour:"2-digit", minute:"2-digit" })}
//           </div>
//         </div>
//       </div>
//     );
//   };

//   // ── Render ─────────────────────────────────────────────────────────────────
//   return (
//     <div style={{ width:"100vw", height:"100vh", background:"#0a0a0a", display:"flex", flexDirection:"column", overflow:"hidden" }}>

//       {/* Audio element provided by App.js via audioRef prop — always mounted there */}

//       {/* TOOLBAR */}
//       <div style={{ flexShrink:0, overflow:"hidden", height:showToolbar?54:0, transition:"height 0.2s ease", display:"flex", alignItems:"center", justifyContent:"space-between", padding:showToolbar?"0 14px":0, background:"rgba(13,13,18,0.98)", borderBottom:showToolbar?"1px solid rgba(255,255,255,0.07)":"none" }}>
//         <div style={{ display:"flex", alignItems:"center", gap:8 }}>
//           <div style={{ width:7, height:7, borderRadius:"50%", background:"#4ade80", boxShadow:"0 0 6px #4ade80" }}/>
//           <span style={{ color:"#d1d5db", fontSize:13, fontWeight:500 }}>{remoteIdRef.current}</span>
//           {controlEnabled && (
//             <span style={{ display:"flex", alignItems:"center", gap:4, background:"rgba(185,28,28,0.85)", borderRadius:5, padding:"2px 8px", fontSize:10, fontWeight:700, color:"#fca5a5" }}>
//               ● CONTROL ACTIVE · Esc to release
//             </span>
//           )}
//         </div>
//         <div style={{ display:"flex", gap:6, alignItems:"center" }}>
//           {ibtn("Minimize", ()=>ipcRenderer.send("minimize-to-taskbar"),
//             <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4"/></svg>
//           )}
//           {/* Mic mute — controls YOUR outgoing voice */}
//           <button onClick={toggleMute} title={muted?"Unmute mic — let remote hear you":"Mute mic"} style={tbtn(muted?"#374151":"#059669")}>
//             {muted
//               ? <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/><line x1="3" y1="3" x2="21" y2="21" strokeWidth={2} strokeLinecap="round"/></svg>
//               : <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
//             }
//             {muted?"Unmute":"Mute"}
//           </button>
//           <button onClick={toggleControl} style={tbtn(controlEnabled?"#dc2626":"#7c3aed")}>
//             <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 6-5 2zm0 0l5 5"/></svg>
//             {controlEnabled?"Release":"Request Control"}
//           </button>
//           {ibtn("Chat", toggleChat,
//             <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>,
//             unread
//           )}
//           <button onClick={()=>dispatch(setShowSessionDialog(true))} style={tbtn("#0284c7")}>
//             <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
//             Info
//           </button>
//           <button onClick={handleDisconnect} style={tbtn("#dc2626")}>
//             <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
//             Disconnect
//           </button>
//         </div>
//       </div>

//       {/* MAIN */}
//       <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
//         {/* VIDEO */}
//         <div style={{ flex:1, position:"relative", background:"#000", overflow:"hidden" }}>
//           {!videoPlaying && (
//             <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"#111827", zIndex:5 }}>
//               <svg style={{ width:48, height:48, color:"#38bdf8", marginBottom:16 }} viewBox="0 0 24 24" fill="none">
//                 <circle style={{opacity:0.25}} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
//                 <path style={{opacity:0.75}} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
//               </svg>
//               <p style={{ color:"#fff", fontSize:17, fontWeight:600, margin:0 }}>Connecting...</p>
//               <p style={{ color:"#9ca3af", fontSize:13, marginTop:8 }}>Waiting for host to share</p>
//               <button onClick={onDisconnect} style={{ marginTop:20, padding:"8px 22px", borderRadius:8, border:"1px solid #4b5563", background:"transparent", color:"#d1d5db", cursor:"pointer" }}>Cancel</button>
//             </div>
//           )}
//           <video ref={videoRef} autoPlay playsInline muted
//             style={{ width:"100%", height:"100%", objectFit:"contain", display:"block" }}
//           />
//           {hostMinimized && (
//             <div style={{ position:"absolute", inset:0, zIndex:10, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.85)", backdropFilter:"blur(4px)" }}>
//               <svg style={{ width:48, height:48, color:"#f59e0b", marginBottom:14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7"/></svg>
//               <p style={{ color:"#fff", fontSize:16, fontWeight:700, margin:0 }}>Host minimized DeskViewer</p>
//               <p style={{ color:"#9ca3af", fontSize:13, marginTop:6, textAlign:"center", maxWidth:280 }}>Ask the host to restore their window.</p>
//             </div>
//           )}
//         </div>

//         {/* CHAT PANEL */}
//         {showChat && (
//           <div style={{ width:300, display:"flex", flexDirection:"column", background:"#111827", borderLeft:"1px solid rgba(255,255,255,0.07)", flexShrink:0, position:"relative" }}>
//             <div style={{ padding:"10px 14px", borderBottom:"1px solid rgba(255,255,255,0.07)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
//               <span style={{ color:"#e5e7eb", fontSize:13, fontWeight:600 }}>Chat</span>
//               <button onClick={toggleChat} style={{ background:"none", border:"none", color:"#9ca3af", cursor:"pointer", padding:2 }}>
//                 <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/></svg>
//               </button>
//             </div>
//             <div style={{ flex:1, overflowY:"auto", padding:"10px 10px 4px", display:"flex", flexDirection:"column" }}>
//               {messages.length===0 && (
//                 <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:"#4b5563" }}>
//                   <svg style={{width:36,height:36,marginBottom:8}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
//                   <span style={{ fontSize:12 }}>No messages yet</span>
//                 </div>
//               )}
//               {messages.map(m => <Bubble key={m.id} msg={m}/>)}
//               <div ref={chatEndRef}/>
//             </div>
//             {uploading && (
//               <div style={{ padding:"4px 14px", color:"#60a5fa", fontSize:11, display:"flex", alignItems:"center", gap:6 }}>
//                 <svg style={{width:11,height:11}} viewBox="0 0 24 24" fill="none"><circle style={{opacity:0.25}} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path style={{opacity:0.75}} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
//                 Uploading...
//               </div>
//             )}
//             {showEmoji && (
//               <div style={{ position:"absolute", bottom:58, left:0, right:0, background:"#1f2937", borderTop:"1px solid rgba(255,255,255,0.08)", padding:"8px", display:"flex", flexWrap:"wrap", gap:2, maxHeight:150, overflowY:"auto", zIndex:10 }}>
//                 {EMOJIS.map(e => <button key={e} onClick={()=>insertEmoji(e)} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", padding:"3px 4px", borderRadius:4, lineHeight:1 }}>{e}</button>)}
//               </div>
//             )}
//             <div style={{ padding:"8px 10px", borderTop:"1px solid rgba(255,255,255,0.07)", display:"flex", gap:5, alignItems:"flex-end" }}>
//               <button onClick={()=>fileInputRef.current?.click()} title="Attach" style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:7, padding:"7px 8px", color:"#9ca3af", cursor:"pointer", flexShrink:0, display:"flex" }}>
//                 <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
//               </button>
//               <input ref={fileInputRef} type="file" style={{ display:"none" }} onChange={e=>{sendFile(e.target.files[0]);e.target.value="";}}/>
//               <button onClick={()=>setShowEmoji(v=>!v)} title="Emoji" style={{ background:showEmoji?"rgba(124,58,237,0.3)":"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:7, padding:"7px 8px", cursor:"pointer", flexShrink:0, fontSize:14 }}>😊</button>
//               <textarea ref={textareaRef} value={chatInput} onChange={e=>setChatInput(e.target.value)}
//                 onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendText();}}}
//                 placeholder="Message… (Enter)" rows={1}
//                 style={{ flex:1, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:7, padding:"7px 10px", color:"#e5e7eb", fontSize:12, resize:"none", outline:"none", fontFamily:"inherit", lineHeight:1.4, maxHeight:80, overflowY:"auto" }}
//               />
//               <button onClick={sendText} disabled={!chatInput.trim()}
//                 style={{ background:chatInput.trim()?"#7c3aed":"rgba(255,255,255,0.06)", border:"none", borderRadius:7, padding:"7px 10px", color:"#fff", cursor:chatInput.trim()?"pointer":"default", flexShrink:0, display:"flex", transition:"background 0.15s" }}>
//                 <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
//               </button>
//             </div>
//           </div>
//         )}
//       </div>

//       {showSessionDialog && !controlEnabled && (
//         <SessionInfo socket={socketRef.current} onEndSession={onEndSession}/>
//       )}
//     </div>
//   );
// };

// export default AppScreen;



// AppScreen.jsx — DeskViewer viewer screen
// Features: remote control · chat · session recording · clipboard sync ·
//           connection quality indicator · annotation canvas overlay
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import SessionInfo from "../../components/SessionInfo";
import { setShowSessionDialog } from "../../states/connectionSlice";
import CONFIG from "../../config";

const { ipcRenderer } = window.require("electron");

const fmt = (bytes) => {
  if (bytes < 1024)      return bytes + " B";
  if (bytes < 1048576)   return (bytes/1024).toFixed(1) + " KB";
  return (bytes/1048576).toFixed(1) + " MB";
};
const isImage = (t="") => t.startsWith("image/");
const msgId   = () => Math.random().toString(36).slice(2);

const EMOJIS = ["😀","😂","😍","🥰","😎","😭","😅","🤔","😮","😡","👍","👎","❤️","🔥","✅","❌","🎉","🙏","💯","👀","🤣","😊","😇","🥳","😴","🤯","🤝","💪","🎊","👋","✌️","🫡","💬","📎","🖼️","🚀","⭐","💡","🔔","😆"];

// ── Annotation tool palette ────────────────────────────────────────────────
const ANNO_TOOLS  = ["pen","arrow","rect","text","eraser"];
const ANNO_COLORS = ["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#a855f7","#ffffff","#000000"];
const ANNO_SIZES  = [2,4,7,12];

// ─────────────────────────────────────────────────────────────────────────────
const AppScreen = ({
  remoteStream, remoteStreamRef, socketRef, callRef,
  remoteIdRef, userIdRef, localMicTrackRef,
  audioRef,
  onDisconnect, onEndSession,
}) => {
  const videoRef        = useRef(null);
  const canvasRef       = useRef(null);   // annotation overlay
  const _localAudioRef  = useRef(null);
  const _audioRef       = audioRef ?? _localAudioRef;
  const dispatch        = useDispatch();
  const mousePosRef     = useRef(null);
  const controlRef      = useRef(false);
  const toolbarTimerRef = useRef(null);

  // MediaRecorder refs
  const recorderRef    = useRef(null);
  const recChunksRef   = useRef([]);

  // Annotation drawing refs (avoid re-renders while drawing)
  const annoDrawingRef = useRef(false);
  const annoStartRef   = useRef({ x:0, y:0 });
  const annoSnapshotRef= useRef(null); // canvas snapshot before current stroke
  const annoTextPosRef = useRef(null);

  const showSessionDialog = useSelector((s) => s.connection.showSessionDialog);

  const [videoPlaying,   setVideoPlaying]   = useState(false);
  const [controlEnabled, setControlEnabled] = useState(false);
  const [muted,          setMuted]          = useState(true);
  const [showToolbar,    setShowToolbar]     = useState(true);
  const [hostMinimized,  setHostMinimized]   = useState(false);

  // chat
  const [showChat,  setShowChat]  = useState(false);
  const [messages,  setMessages]  = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [unread,    setUnread]    = useState(0);
  const [showEmoji, setShowEmoji] = useState(false);
  const chatEndRef   = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef  = useRef(null);

  // ── Feature 1: Session recording ──────────────────────────────────────────
  const [recording,    setRecording]    = useState(false);
  const [recDuration,  setRecDuration]  = useState(0);  // seconds elapsed
  const recTimerRef = useRef(null);

  // ── Feature 2: Clipboard sync ──────────────────────────────────────────────
  const [clipToast, setClipToast] = useState("");
  const clipToastTimerRef = useRef(null);
  const showClipToast = useCallback((msg) => {
    setClipToast(msg);
    clearTimeout(clipToastTimerRef.current);
    clipToastTimerRef.current = setTimeout(() => setClipToast(""), 2500);
  }, []);

  // ── Feature 3: Connection quality ─────────────────────────────────────────
  const [quality, setQuality] = useState(null);
  // quality = { rtt, fps, kbps, lost } | null

  // ── Feature 4: Annotation ─────────────────────────────────────────────────
  const [annoMode,    setAnnoMode]    = useState(false);
  const [annoTool,    setAnnoTool]    = useState("pen");
  const [annoColor,   setAnnoColor]   = useState("#ef4444");
  const [annoSize,    setAnnoSize]    = useState(4);
  const [annoTextVal, setAnnoTextVal] = useState("");
  const [showAnnoBar, setShowAnnoBar] = useState(false);
  const annoInputRef = useRef(null);

  // ── attachStream ──────────────────────────────────────────────────────────
  const attachStream = useCallback((stream) => {
    if (!stream) return;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted     = true;
      videoRef.current.volume    = 0;
      const tryPlay = () =>
        videoRef.current?.play()
          .then(() => { setVideoPlaying(true); ipcRenderer.send("maximize-for-viewing"); })
          .catch(e => { console.warn("video.play():", e.message); setTimeout(tryPlay, 600); });
      tryPlay();
    }
    if (_audioRef.current) {
      const el = _audioRef.current;
      el.srcObject = stream; el.volume = 1.0; el.muted = false;
      el.play()
        .then(() => console.log("🔊 Viewer audio playing ✅"))
        .catch(e => { console.warn("🔊 audio.play() failed:", e.message); setTimeout(() => { if (_audioRef.current?.srcObject) _audioRef.current.play().catch(()=>{}); }, 500); });
    }
  }, []);

  useEffect(() => { if (remoteStream)            attachStream(remoteStream);            }, [remoteStream, attachStream]);
  useEffect(() => { if (remoteStreamRef?.current) attachStream(remoteStreamRef.current); }, []);

  // ── Mute sync ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => { const tr = localMicTrackRef?.current; if (tr) setMuted(!tr.enabled); }, 300);
    return () => clearTimeout(t);
  }, []);

  const toggleMute = () => {
    const tr = localMicTrackRef?.current; if (!tr) return;
    tr.enabled = !tr.enabled; setMuted(!tr.enabled);
  };

  // ── Toolbar hide ───────────────────────────────────────────────────────────
  const scheduleHide = useCallback(() => {
    clearTimeout(toolbarTimerRef.current);
    if (!controlRef.current && !annoMode)
      toolbarTimerRef.current = setTimeout(() => setShowToolbar(false), 3000);
  }, [annoMode]);

  useEffect(() => {
    const onMove = () => { if (controlRef.current) return; setShowToolbar(true); scheduleHide(); };
    window.addEventListener("mousemove", onMove);
    scheduleHide();
    return () => { window.removeEventListener("mousemove", onMove); clearTimeout(toolbarTimerRef.current); };
  }, [scheduleHide]);

  // Keep toolbar visible in annotation mode
  useEffect(() => { if (annoMode) { setShowToolbar(true); clearTimeout(toolbarTimerRef.current); } }, [annoMode]);

  // ── Window / IPC events ────────────────────────────────────────────────────
  useEffect(() => {
    const onMin    = () => { videoRef.current && (videoRef.current.style.cursor="default"); setShowToolbar(true); clearTimeout(toolbarTimerRef.current); };
    const onRes    = (_,p) => { if (videoRef.current) videoRef.current.style.cursor=(p?.controlActive&&controlRef.current)?"none":"default"; if (!controlRef.current) { setShowToolbar(true); scheduleHide(); } };
    const onHostMin = () => { setHostMinimized(true); if (controlRef.current) { controlRef.current=false; setControlEnabled(false); videoRef.current&&(videoRef.current.style.cursor="default"); ipcRenderer.send("set-global-capture",false); } };
    const onHostRes = () => setHostMinimized(false);
    ipcRenderer.on("window-minimized",      onMin);
    ipcRenderer.on("window-restored",       onRes);
    ipcRenderer.on("host-window-minimized", onHostMin);
    ipcRenderer.on("host-window-restored",  onHostRes);
    return () => {
      ipcRenderer.removeListener("window-minimized",      onMin);
      ipcRenderer.removeListener("window-restored",       onRes);
      ipcRenderer.removeListener("host-window-minimized", onHostMin);
      ipcRenderer.removeListener("host-window-restored",  onHostRes);
    };
  }, [scheduleHide]);

  useEffect(() => () => {
    if (videoRef.current)  videoRef.current.srcObject  = null;
    if (_audioRef.current) _audioRef.current.srcObject = null;
    stopRecording();
  }, []);

  // ── FEATURE 1: SESSION RECORDING ──────────────────────────────────────────
  // Records the remote video stream + host audio into a WebM file.
  // Uses canvas-capture so annotation strokes are baked into the recording.
  const startRecording = useCallback(() => {
    const stream = remoteStreamRef?.current;
    if (!stream) { console.warn("No stream to record"); return; }
    try {
      // Combine: video tracks from stream + audio tracks from audio element stream
      const tracks = [...stream.getVideoTracks()];
      if (_audioRef.current?.srcObject) tracks.push(..._audioRef.current.srcObject.getAudioTracks());
      const recStream = new MediaStream(tracks);
      const mimeType  = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
      const rec = new MediaRecorder(recStream, { mimeType, videoBitsPerSecond: 3_000_000 });
      recChunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size > 0) recChunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(recChunksRef.current, { type: mimeType });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        const ts   = new Date().toISOString().replace(/[:.]/g,"-").slice(0,-5);
        a.href = url; a.download = `DeskViewer-${ts}.webm`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        console.log("🎬 Recording saved");
      };
      rec.start(1000); // collect chunks every 1s
      recorderRef.current = rec;
      setRecording(true);
      setRecDuration(0);
      recTimerRef.current = setInterval(() => setRecDuration(d => d+1), 1000);
      console.log("🎬 Recording started");
    } catch (e) { console.error("Recording failed:", e); }
  }, []);

  const stopRecording = useCallback(() => {
    clearInterval(recTimerRef.current);
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    setRecording(false);
    setRecDuration(0);
  }, []);

  const toggleRecording = () => { recording ? stopRecording() : startRecording(); };

  const fmtDuration = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  // ── FEATURE 2: CLIPBOARD SYNC ──────────────────────────────────────────────
  // Viewer copies something → emit to server → host gets it.
  // Host copies something → server emits here → viewer writes to clipboard.
  useEffect(() => {
    const socket = socketRef.current; if (!socket) return;
    const onClip = ({ text }) => {
      if (!text) return;
      navigator.clipboard.writeText(text).catch(() => {});
      showClipToast("📋 Host clipboard synced");
    };
    socket.on("clipboard-sync", onClip);
    return () => socket.off("clipboard-sync", onClip);
  }, [showClipToast]);

  useEffect(() => {
    const onCopy = async () => {
      try {
        const text = await navigator.clipboard.readText(); if (!text) return;
        const s = socketRef.current, rid = String(remoteIdRef.current||""), uid = String(userIdRef.current||"");
        if (s?.connected && rid) { s.emit("clipboard-sync", { remoteId:rid, text }); showClipToast("📋 Clipboard sent to host"); }
      } catch { /* permission denied — skip */ }
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [showClipToast]);

  // ── FEATURE 3: CONNECTION QUALITY ─────────────────────────────────────────
  // Polls RTCPeerConnection.getStats() every 2s and extracts RTT, FPS, kbps.
  useEffect(() => {
    let prevBytes = 0, prevTs = 0;
    const poll = async () => {
      const pc = callRef?.current?.peerConnection; if (!pc) return;
      try {
        const stats = await pc.getStats();
        let rtt=null, fps=null, kbps=null, lost=null;
        stats.forEach(r => {
          if (r.type==="candidate-pair" && r.state==="succeeded" && r.currentRoundTripTime!=null)
            rtt = Math.round(r.currentRoundTripTime * 1000);
          if (r.type==="inbound-rtp" && r.kind==="video") {
            fps  = r.framesPerSecond ?? null;
            const now = Date.now();
            if (prevBytes && prevTs) kbps = Math.round(((r.bytesReceived-prevBytes)*8)/(now-prevTs));
            prevBytes = r.bytesReceived; prevTs = now;
            if (r.packetsLost!=null && r.packetsReceived!=null && r.packetsReceived>0)
              lost = ((r.packetsLost/(r.packetsLost+r.packetsReceived))*100).toFixed(1);
          }
        });
        setQuality({ rtt, fps: fps!=null?Math.round(fps):null, kbps, lost });
      } catch { /* stats API not ready yet */ }
    };
    const iv = setInterval(poll, 2000);
    poll();
    return () => clearInterval(iv);
  }, []);

  const qualityColor = () => {
    if (!quality?.rtt) return "#9ca3af";
    if (quality.rtt < 80)  return "#4ade80";
    if (quality.rtt < 200) return "#facc15";
    return "#f87171";
  };
  const qualityLabel = () => {
    if (!quality?.rtt) return "—";
    if (quality.rtt < 80)  return "Good";
    if (quality.rtt < 200) return "Fair";
    return "Poor";
  };

  // ── FEATURE 5: ANNOTATION CANVAS ──────────────────────────────────────────
  // Canvas overlay sits directly over the <video> element.
  // Strokes are drawn in screen-space on the canvas and broadcast via socket
  // so the remote side (host screen) can optionally mirror them.
  // Each stroke has a timestamp; clear removes everything.

  // Resize canvas to match video element
  const syncCanvasSize = useCallback(() => {
    const v = videoRef.current, c = canvasRef.current; if (!v||!c) return;
    const r = v.getBoundingClientRect();
    if (c.width !== r.width || c.height !== r.height) {
      // Preserve existing drawing while resizing
      const tmp = document.createElement("canvas");
      tmp.width = c.width; tmp.height = c.height;
      tmp.getContext("2d").drawImage(c,0,0);
      c.width = Math.round(r.width); c.height = Math.round(r.height);
      c.getContext("2d").drawImage(tmp,0,0);
    }
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver(syncCanvasSize);
    if (videoRef.current) ro.observe(videoRef.current);
    return () => ro.disconnect();
  }, [syncCanvasSize]);

  // Canvas-relative coords clamped to element bounds
  const getCanvasXY = (e) => {
    const c = canvasRef.current; if (!c) return { x:0, y:0 };
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const annoPointerDown = useCallback((e) => {
    if (!annoMode || controlRef.current) return;
    e.preventDefault(); e.stopPropagation();
    const { x, y } = getCanvasXY(e);
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d");

    if (annoTool === "text") {
      annoTextPosRef.current = { x, y };
      setAnnoTextVal("");
      setTimeout(() => annoInputRef.current?.focus(), 30);
      return;
    }
    annoDrawingRef.current = true;
    annoStartRef.current   = { x, y };
    // Snapshot current canvas so we can redraw rect/arrow each frame
    const snap = document.createElement("canvas");
    snap.width = c.width; snap.height = c.height;
    snap.getContext("2d").drawImage(c, 0, 0);
    annoSnapshotRef.current = snap;

    if (annoTool === "pen") {
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.strokeStyle = annoColor; ctx.lineWidth = annoSize;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
    }
  }, [annoMode, annoTool, annoColor, annoSize]);

  const annoPointerMove = useCallback((e) => {
    if (!annoDrawingRef.current || !annoMode) return;
    e.preventDefault();
    const { x, y } = getCanvasXY(e);
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d");
    const { x:sx, y:sy } = annoStartRef.current;

    if (annoTool === "pen") {
      ctx.lineTo(x, y); ctx.stroke();
    } else if (annoTool === "eraser") {
      ctx.clearRect(x - annoSize*3, y - annoSize*3, annoSize*6, annoSize*6);
    } else {
      // Restore snapshot then redraw shape
      ctx.clearRect(0,0,c.width,c.height);
      ctx.drawImage(annoSnapshotRef.current,0,0);
      ctx.strokeStyle = annoColor; ctx.fillStyle = annoColor;
      ctx.lineWidth = annoSize; ctx.lineCap = "round"; ctx.lineJoin = "round";
      if (annoTool === "rect") {
        ctx.beginPath(); ctx.strokeRect(sx, sy, x-sx, y-sy);
      } else if (annoTool === "arrow") {
        const dx=x-sx, dy=y-sy, angle=Math.atan2(dy,dx), len=Math.sqrt(dx*dx+dy*dy);
        const hw = Math.min(len*0.35, 18), ha = 0.45;
        ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(x,y); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x,y);
        ctx.lineTo(x-hw*Math.cos(angle-ha), y-hw*Math.sin(angle-ha));
        ctx.lineTo(x-hw*Math.cos(angle+ha), y-hw*Math.sin(angle+ha));
        ctx.closePath(); ctx.fill();
      }
    }
  }, [annoMode, annoTool, annoColor, annoSize]);

  const annoPointerUp = useCallback((e) => {
    if (!annoDrawingRef.current) return;
    annoDrawingRef.current = false;
    annoSnapshotRef.current = null;
    // Emit strokes to remote side via socket (optional — let host see annotations)
    const c = canvasRef.current; if (!c) return;
    const s = socketRef.current, rid = String(remoteIdRef.current||""), uid = String(userIdRef.current||"");
    if (s?.connected && rid) {
      s.emit("annotation-frame", { remoteId:rid, userId:uid, dataUrl: c.toDataURL("image/png") });
    }
  }, []);

  const annoCommitText = () => {
    const text = annoTextVal.trim(); if (!text || !annoTextPosRef.current) { setAnnoTextVal(""); return; }
    const { x, y } = annoTextPosRef.current;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d");
    ctx.font = `${Math.max(annoSize*4, 16)}px sans-serif`;
    ctx.fillStyle = annoColor;
    ctx.fillText(text, x, y);
    setAnnoTextVal(""); annoTextPosRef.current = null;
    // Emit
    const s = socketRef.current, rid = String(remoteIdRef.current||""), uid = String(userIdRef.current||"");
    if (s?.connected && rid) s.emit("annotation-frame", { remoteId:rid, userId:uid, dataUrl: c.toDataURL("image/png") });
  };

  const clearCanvas = () => {
    const c = canvasRef.current; if (!c) return;
    c.getContext("2d").clearRect(0,0,c.width,c.height);
    const s = socketRef.current, rid = String(remoteIdRef.current||""), uid = String(userIdRef.current||"");
    if (s?.connected && rid) s.emit("annotation-clear", { remoteId:rid, userId:uid });
  };

  const toggleAnnotation = () => {
    const next = !annoMode;
    setAnnoMode(next);
    setShowAnnoBar(next);
    if (next) {
      // Turn off remote control while annotating
      if (controlRef.current) { controlRef.current=false; setControlEnabled(false); videoRef.current&&(videoRef.current.style.cursor="default"); ipcRenderer.send("set-global-capture",false); }
    }
  };

  // ── Chat ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = socketRef.current; if (!socket) return;
    const onMsg = (msg) => { setMessages(p => [...p, msg]); if (!showChat) setUnread(u => u+1); };
    socket.on("chat-message", onMsg);
    return () => socket.off("chat-message", onMsg);
  }, [showChat]);

  useEffect(() => { if (showChat) chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, showChat]);
  const toggleChat = () => { setShowEmoji(false); setShowChat(v => { if (!v) setUnread(0); return !v; }); };

  const sendText = () => {
    const text = chatInput.trim(); if (!text) return;
    const s=socketRef.current, rid=String(remoteIdRef.current||""), uid=String(userIdRef.current||"");
    if (!s?.connected||!rid) return;
    const msg={id:msgId(),from:"me",fromId:uid,text,ts:Date.now()};
    setMessages(p=>[...p,msg]); s.emit("chat-message",{remoteId:rid,msg:{...msg,from:"them"}});
    setChatInput(""); setShowEmoji(false);
  };
  const insertEmoji = (emoji) => {
    const el=textareaRef.current; if (!el) { setChatInput(v=>v+emoji); return; }
    const s=el.selectionStart??chatInput.length, e=el.selectionEnd??chatInput.length;
    setChatInput(chatInput.slice(0,s)+emoji+chatInput.slice(e));
    setTimeout(()=>{ el.selectionStart=el.selectionEnd=s+emoji.length; el.focus(); },0);
  };
  const sendFile = async (file) => {
    if (!file) return;
    const s=socketRef.current, rid=String(remoteIdRef.current||""), uid=String(userIdRef.current||"");
    if (!s?.connected||!rid) return;
    setUploading(true);
    try {
      const fd=new FormData(); fd.append("file",file);
      const res=await fetch(`${CONFIG.SOCKET_URL.replace(/\/$/,"")}/upload`,{method:"POST",body:fd});
      const data=await res.json();
      const msg={id:msgId(),from:"me",fromId:uid,file:data,ts:Date.now()};
      setMessages(p=>[...p,msg]); s.emit("chat-message",{remoteId:rid,msg:{...msg,from:"them"}});
    } catch(e){ console.error("Upload failed:",e); } finally { setUploading(false); }
  };

  // ── Coords & input ─────────────────────────────────────────────────────────
  const getCoords = (e) => {
    const v=videoRef.current; if (!v) return {x:0,y:0};
    const r=v.getBoundingClientRect(), sw=v.videoWidth||1280, sh=v.videoHeight||720;
    const sa=sw/sh, ea=r.width/r.height; let rW,rH,oX,oY;
    if (sa>ea) { rW=r.width; rH=r.width/sa; oX=0; oY=(r.height-rH)/2; }
    else       { rH=r.height; rW=r.height*sa; oX=(r.width-rW)/2; oY=0; }
    return { x:Math.round((Math.max(0,Math.min(e.clientX-r.left-oX,rW))/rW)*sw), y:Math.round((Math.max(0,Math.min(e.clientY-r.top-oY,rH))/rH)*sh) };
  };
  const sendResolution = useCallback(() => {
    const v=videoRef.current; if (!v?.videoWidth) { setTimeout(sendResolution,200); return; }
    const s=socketRef.current, rid=String(remoteIdRef.current||""), uid=String(userIdRef.current||"");
    if (s?.connected&&rid&&uid) s.emit("stream-resolution",{userId:uid,remoteId:rid,event:{width:v.videoWidth,height:v.videoHeight}});
  }, []);

  useEffect(() => {
    const video=videoRef.current; if (!video) return;
    const emit=(name,data)=>{ const s=socketRef.current,rid=String(remoteIdRef.current||""),uid=String(userIdRef.current||""); if(s?.connected&&rid&&uid) s.emit(name,{userId:uid,remoteId:rid,event:data}); };
    const onMD=(e)=>{ if (!controlRef.current||annoMode) return; e.preventDefault(); e.stopPropagation(); emit("mousedown",{button:e.button,...getCoords(e)}); };
    const onMU=(e)=>{ if (!controlRef.current) return; emit("mouseup",{button:e.button,...getCoords(e)}); };
    const onDC=(e)=>{ if (!controlRef.current) return; e.preventDefault(); emit("dblclick",getCoords(e)); };
    let acc=0;
    const onW=(e)=>{ if (!controlRef.current) return; e.preventDefault(); let d=e.deltaY; if(e.deltaMode===1)d*=40; if(e.deltaMode===2)d*=800; acc+=d*8; const steps=Math.round(acc/100); if(!steps)return; acc-=steps*100; emit("scroll",{scroll:steps*100,...getCoords(e)}); };
    const onMM=(e)=>{ if(controlRef.current) mousePosRef.current=getCoords(e); };
    const onKD=(e)=>{
      if (!controlRef.current) return;
      if (e.ctrlKey&&e.shiftKey&&e.key==="I") return;
      const tag=document.activeElement?.tagName?.toLowerCase();
      if (tag==="input"||tag==="textarea") return;
      if (e.key==="Escape") { controlRef.current=false; setControlEnabled(false); setShowToolbar(true); video.style.cursor="default"; ipcRenderer.send("set-global-capture",false); return; }
      e.preventDefault(); emit("keydown",{keyCode:e.key,ctrl:e.ctrlKey,shift:e.shiftKey,alt:e.altKey,meta:e.metaKey});
    };
    const onKU=(e)=>{ if(!controlRef.current)return; const tag=document.activeElement?.tagName?.toLowerCase(); if(tag==="input"||tag==="textarea")return; emit("keyup",{keyCode:e.key}); };
    const onGK=(_,d)=>{ if(controlRef.current)emit("keydown",d); };
    ipcRenderer.on("global-keydown",onGK);
    const iv=setInterval(()=>{ if(!controlRef.current||!mousePosRef.current)return; const s=socketRef.current,rid=String(remoteIdRef.current||""),uid=String(userIdRef.current||""); if(s?.connected&&rid&&uid){s.emit("mousemove",{userId:uid,remoteId:rid,event:mousePosRef.current});mousePosRef.current=null;} },16);
    video.addEventListener("mousemove",onMM); video.addEventListener("mousedown",onMD);
    video.addEventListener("mouseup",onMU);   video.addEventListener("dblclick",onDC);
    video.addEventListener("wheel",onW,{passive:false});
    window.addEventListener("keydown",onKD);  window.addEventListener("keyup",onKU);
    return ()=>{ clearInterval(iv); ipcRenderer.removeListener("global-keydown",onGK); video.removeEventListener("mousemove",onMM); video.removeEventListener("mousedown",onMD); video.removeEventListener("mouseup",onMU); video.removeEventListener("dblclick",onDC); video.removeEventListener("wheel",onW); window.removeEventListener("keydown",onKD); window.removeEventListener("keyup",onKU); };
  }, [annoMode]);

  const toggleControl = () => {
    if (annoMode) return; // can't control while annotating
    const next=!controlRef.current; controlRef.current=next; setControlEnabled(next);
    if (next) { dispatch(setShowSessionDialog(false)); setShowToolbar(true); clearTimeout(toolbarTimerRef.current); videoRef.current&&(videoRef.current.style.cursor="none"); sendResolution(); }
    else      { setShowToolbar(true); scheduleHide(); videoRef.current&&(videoRef.current.style.cursor="default"); }
    ipcRenderer.send("set-global-capture",next);
  };

  const handleDisconnect = () => {
    if (!window.confirm("End this session?")) return;
    stopRecording();
    if (_audioRef.current) _audioRef.current.srcObject=null;
    if (videoRef.current)  videoRef.current.srcObject=null;
    setMessages([]); setShowChat(false); setUnread(0);
    ipcRenderer.send("set-global-capture",false);
    const rid=remoteIdRef?.current;
    if (socketRef.current&&rid) socketRef.current.emit("remotedisconnected",{remoteId:rid});
    if (callRef.current) { callRef.current.close(); callRef.current=null; }
    onDisconnect();
  };

  // ── Style helpers ──────────────────────────────────────────────────────────
  const tbtn = (bg, active) => ({ display:"flex", alignItems:"center", gap:5, padding:"6px 12px", borderRadius:7, background:active?bg:bg, border:active?"1.5px solid rgba(255,255,255,0.4)":"1.5px solid transparent", color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap", opacity:1 });
  const ibtn = (title, fn, icon, badge) => (
    <button title={title} onClick={fn} style={{ position:"relative", background:"rgba(255,255,255,0.1)", border:"1.5px solid transparent", borderRadius:7, padding:"6px 10px", color:"#fff", cursor:"pointer", display:"flex", alignItems:"center" }}>
      {icon}{badge>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#ef4444",color:"#fff",fontSize:9,fontWeight:700,borderRadius:"50%",width:14,height:14,display:"flex",alignItems:"center",justifyContent:"center"}}>{badge>9?"9+":badge}</span>}
    </button>
  );
  const Bubble = ({ msg }) => {
    const mine=msg.from==="me", base=CONFIG.SOCKET_URL.replace(/\/$/,"");
    return (
      <div style={{display:"flex",justifyContent:mine?"flex-end":"flex-start",marginBottom:6}}>
        <div style={{maxWidth:"78%",boxShadow:"0 1px 4px rgba(0,0,0,0.3)",borderRadius:mine?"12px 12px 2px 12px":"12px 12px 12px 2px",background:mine?"#7c3aed":"#1f2937",padding:msg.file?"6px":"8px 12px"}}>
          {msg.text&&<p style={{margin:0,color:"#fff",fontSize:13,wordBreak:"break-word",whiteSpace:"pre-wrap"}}>{msg.text}</p>}
          {msg.file&&isImage(msg.file.type)&&<a href={base+msg.file.url} target="_blank" rel="noreferrer"><img src={base+msg.file.url} alt={msg.file.name} style={{maxWidth:220,maxHeight:160,borderRadius:8,display:"block"}}/></a>}
          {msg.file&&!isImage(msg.file.type)&&<a href={base+msg.file.url} target="_blank" rel="noreferrer" style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",textDecoration:"none"}}><svg style={{width:22,height:22,flexShrink:0,color:"#93c5fd"}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><div><div style={{color:"#e5e7eb",fontSize:12,fontWeight:600,wordBreak:"break-all"}}>{msg.file.name}</div><div style={{color:"#9ca3af",fontSize:10}}>{fmt(msg.file.size)}</div></div></a>}
          <div style={{color:mine?"rgba(255,255,255,0.45)":"#6b7280",fontSize:10,marginTop:3,textAlign:"right",paddingRight:msg.file?8:0}}>{new Date(msg.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
        </div>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ width:"100vw", height:"100vh", background:"#0a0a0a", display:"flex", flexDirection:"column", overflow:"hidden" }}>

      {/* CLIPBOARD TOAST */}
      {clipToast && (
        <div style={{ position:"fixed", top:16, left:"50%", transform:"translateX(-50%)", zIndex:400, background:"#1f2937", color:"#fff", fontSize:12, fontWeight:600, borderRadius:8, padding:"8px 16px", boxShadow:"0 4px 16px rgba(0,0,0,0.4)", pointerEvents:"none", whiteSpace:"nowrap" }}>
          {clipToast}
        </div>
      )}

      {/* TOOLBAR */}
      <div style={{ flexShrink:0, overflow:"hidden", height:showToolbar?54:0, transition:"height 0.2s ease", display:"flex", alignItems:"center", justifyContent:"space-between", padding:showToolbar?"0 14px":0, background:"rgba(13,13,18,0.98)", borderBottom:showToolbar?"1px solid rgba(255,255,255,0.07)":"none" }}>

        {/* LEFT: status + quality */}
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:7, height:7, borderRadius:"50%", background:"#4ade80", boxShadow:"0 0 6px #4ade80" }}/>
          <span style={{ color:"#d1d5db", fontSize:13, fontWeight:500 }}>{remoteIdRef.current}</span>

          {controlEnabled && (
            <span style={{ display:"flex", alignItems:"center", gap:4, background:"rgba(185,28,28,0.85)", borderRadius:5, padding:"2px 8px", fontSize:10, fontWeight:700, color:"#fca5a5" }}>
              ● CONTROL ACTIVE · Esc to release
            </span>
          )}
          {annoMode && (
            <span style={{ display:"flex", alignItems:"center", gap:4, background:"rgba(139,92,246,0.85)", borderRadius:5, padding:"2px 8px", fontSize:10, fontWeight:700, color:"#ddd6fe" }}>
              ✏️ ANNOTATING · click toolbar to exit
            </span>
          )}

          {/* RECORDING INDICATOR */}
          {recording && (
            <span style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(220,38,38,0.2)", border:"1px solid #ef4444", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:700, color:"#fca5a5" }}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:"#ef4444", animation:"pulse 1s infinite", display:"inline-block" }}/>
              REC {fmtDuration(recDuration)}
            </span>
          )}

          {/* CONNECTION QUALITY */}
          {quality && (
            <span title={`RTT: ${quality.rtt??'—'}ms | FPS: ${quality.fps??'—'} | ${quality.kbps??'—'} kbps | Loss: ${quality.lost??'0'}%`}
              style={{ display:"flex", alignItems:"center", gap:4, background:"rgba(255,255,255,0.05)", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600, color:qualityColor(), cursor:"default", border:`1px solid ${qualityColor()}44` }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background:qualityColor() }}/>
              {qualityLabel()}
              {quality.rtt!=null && <span style={{ opacity:0.75 }}>{quality.rtt}ms</span>}
              {quality.fps!=null && <span style={{ opacity:0.6 }}>{quality.fps}fps</span>}
            </span>
          )}
        </div>

        {/* RIGHT: controls */}
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          {ibtn("Minimize", ()=>ipcRenderer.send("minimize-to-taskbar"),
            <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4"/></svg>
          )}

          {/* MIC */}
          <button onClick={toggleMute} title={muted?"Unmute mic":"Mute mic"} style={tbtn(muted?"#374151":"#059669")}>
            {muted
              ? <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/><line x1="3" y1="3" x2="21" y2="21" strokeWidth={2} strokeLinecap="round"/></svg>
              : <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
            }
            {muted?"Unmute":"Mute"}
          </button>

          {/* REMOTE CONTROL */}
          <button onClick={toggleControl} title={annoMode?"Exit annotation to use remote control":""} disabled={annoMode} style={tbtn(controlEnabled?"#dc2626":"#7c3aed")}>
            <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 6-5 2zm0 0l5 5"/></svg>
            {controlEnabled?"Release":"Control"}
          </button>

          {/* ANNOTATE */}
          <button onClick={toggleAnnotation} title="Annotate / draw on screen" style={tbtn(annoMode?"#7c3aed":"#6b7280", annoMode)}>
            <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            Annotate
          </button>

          {/* RECORD */}
          <button onClick={toggleRecording} title={recording?"Stop recording":"Start recording session"} style={tbtn(recording?"#dc2626":"#374151", recording)}>
            {recording
              ? <svg style={{width:12,height:12}} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
              : <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="8" strokeWidth={2}/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>
            }
            {recording ? "Stop Rec" : "Record"}
          </button>

          {/* CHAT */}
          {ibtn("Chat", toggleChat,
            <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>,
            unread
          )}

          {/* INFO */}
          <button onClick={()=>dispatch(setShowSessionDialog(true))} style={tbtn("#0284c7")}>
            <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            Info
          </button>

          {/* DISCONNECT */}
          <button onClick={handleDisconnect} style={tbtn("#dc2626")}>
            <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
            Disconnect
          </button>
        </div>
      </div>

      {/* ANNOTATION TOOLBAR — appears below main toolbar when annoMode is on */}
      {annoMode && showAnnoBar && (
        <div style={{ flexShrink:0, display:"flex", alignItems:"center", gap:10, padding:"6px 14px", background:"rgba(20,10,40,0.97)", borderBottom:"1px solid rgba(255,255,255,0.1)", flexWrap:"wrap" }}>
          {/* Tools */}
          <div style={{ display:"flex", gap:4 }}>
            {ANNO_TOOLS.map(t => (
              <button key={t} onClick={()=>setAnnoTool(t)} title={t.charAt(0).toUpperCase()+t.slice(1)}
                style={{ padding:"4px 10px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", border:"1.5px solid transparent", background:annoTool===t?"#7c3aed":"rgba(255,255,255,0.07)", color:"#fff", transition:"background 0.12s", borderColor:annoTool===t?"#a78bfa":"transparent" }}>
                {t==="pen"?"✏️ Pen":t==="arrow"?"➡️ Arrow":t==="rect"?"▭ Rect":t==="text"?"T Text":"◻ Erase"}
              </button>
            ))}
          </div>
          {/* Separator */}
          <div style={{ width:1, height:20, background:"rgba(255,255,255,0.15)" }}/>
          {/* Colors */}
          <div style={{ display:"flex", gap:4, alignItems:"center" }}>
            {ANNO_COLORS.map(c => (
              <button key={c} onClick={()=>setAnnoColor(c)} title={c}
                style={{ width:18, height:18, borderRadius:"50%", background:c, border:annoColor===c?"2.5px solid #fff":"2px solid rgba(255,255,255,0.2)", cursor:"pointer", padding:0, transition:"transform 0.1s", transform:annoColor===c?"scale(1.25)":"scale(1)" }}/>
            ))}
          </div>
          {/* Separator */}
          <div style={{ width:1, height:20, background:"rgba(255,255,255,0.15)" }}/>
          {/* Stroke sizes */}
          <div style={{ display:"flex", gap:4, alignItems:"center" }}>
            {ANNO_SIZES.map(sz => (
              <button key={sz} onClick={()=>setAnnoSize(sz)} title={`Size ${sz}`}
                style={{ width:sz*2.5+10, height:sz*2.5+10, borderRadius:"50%", background:annoSize===sz?"#a78bfa":"rgba(255,255,255,0.15)", border:annoSize===sz?"2px solid #7c3aed":"2px solid transparent", cursor:"pointer", padding:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <span style={{ width:sz, height:sz, borderRadius:"50%", background:"#fff", display:"block" }}/>
              </button>
            ))}
          </div>
          {/* Separator */}
          <div style={{ width:1, height:20, background:"rgba(255,255,255,0.15)" }}/>
          {/* Text input (when text tool selected) */}
          {annoTool==="text" && (
            <input ref={annoInputRef} value={annoTextVal} onChange={e=>setAnnoTextVal(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"){e.preventDefault();annoCommitText();} if(e.key==="Escape")setAnnoTextVal(""); }}
              placeholder="Type then click where to place…"
              style={{ background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)", borderRadius:6, padding:"4px 8px", color:"#fff", fontSize:12, outline:"none", width:200 }}
            />
          )}
          {/* Clear */}
          <button onClick={clearCanvas} title="Clear all annotations"
            style={{ marginLeft:"auto", padding:"4px 12px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", background:"rgba(220,38,38,0.3)", border:"1px solid #ef4444", color:"#fca5a5" }}>
            🗑 Clear
          </button>
        </div>
      )}

      {/* MAIN CONTENT */}
      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>

        {/* VIDEO + ANNOTATION CANVAS */}
        <div style={{ flex:1, position:"relative", background:"#000", overflow:"hidden" }}>

          {/* Connecting overlay */}
          {!videoPlaying && (
            <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"#111827", zIndex:5 }}>
              <svg style={{width:48,height:48,color:"#38bdf8",marginBottom:16}} viewBox="0 0 24 24" fill="none"><circle style={{opacity:0.25}} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path style={{opacity:0.75}} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
              <p style={{color:"#fff",fontSize:17,fontWeight:600,margin:0}}>Connecting...</p>
              <p style={{color:"#9ca3af",fontSize:13,marginTop:8}}>Waiting for host to share</p>
              <button onClick={onDisconnect} style={{marginTop:20,padding:"8px 22px",borderRadius:8,border:"1px solid #4b5563",background:"transparent",color:"#d1d5db",cursor:"pointer"}}>Cancel</button>
            </div>
          )}

          {/* Video */}
          <video ref={videoRef} autoPlay playsInline muted
            style={{ width:"100%", height:"100%", objectFit:"contain", display:"block" }}
          />

          {/* ANNOTATION CANVAS — overlays the video exactly */}
          <canvas
            ref={canvasRef}
            onPointerDown={annoPointerDown}
            onPointerMove={annoPointerMove}
            onPointerUp={annoPointerUp}
            onPointerLeave={annoPointerUp}
            style={{
              position:"absolute", inset:0,
              width:"100%", height:"100%",
              cursor: annoMode ? (annoTool==="eraser"?"cell":annoTool==="text"?"text":"crosshair") : "default",
              pointerEvents: annoMode ? "all" : "none",
              touchAction:"none",
              zIndex:3,
            }}
          />

          {/* Host minimized overlay */}
          {hostMinimized && (
            <div style={{position:"absolute",inset:0,zIndex:10,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.85)",backdropFilter:"blur(4px)"}}>
              <svg style={{width:48,height:48,color:"#f59e0b",marginBottom:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7"/></svg>
              <p style={{color:"#fff",fontSize:16,fontWeight:700,margin:0}}>Host minimized DeskViewer</p>
              <p style={{color:"#9ca3af",fontSize:13,marginTop:6,textAlign:"center",maxWidth:280}}>Ask the host to restore their window.</p>
            </div>
          )}
        </div>

        {/* CHAT PANEL */}
        {showChat && (
          <div style={{width:300,display:"flex",flexDirection:"column",background:"#111827",borderLeft:"1px solid rgba(255,255,255,0.07)",flexShrink:0,position:"relative"}}>
            <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{color:"#e5e7eb",fontSize:13,fontWeight:600}}>Chat</span>
              <button onClick={toggleChat} style={{background:"none",border:"none",color:"#9ca3af",cursor:"pointer",padding:2}}>
                <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"10px 10px 4px",display:"flex",flexDirection:"column"}}>
              {messages.length===0&&<div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#4b5563"}}><svg style={{width:36,height:36,marginBottom:8}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg><span style={{fontSize:12}}>No messages yet</span></div>}
              {messages.map(m=><Bubble key={m.id} msg={m}/>)}
              <div ref={chatEndRef}/>
            </div>
            {uploading&&<div style={{padding:"4px 14px",color:"#60a5fa",fontSize:11,display:"flex",alignItems:"center",gap:6}}><svg style={{width:11,height:11}} viewBox="0 0 24 24" fill="none"><circle style={{opacity:0.25}} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path style={{opacity:0.75}} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Uploading...</div>}
            {showEmoji&&<div style={{position:"absolute",bottom:58,left:0,right:0,background:"#1f2937",borderTop:"1px solid rgba(255,255,255,0.08)",padding:"8px",display:"flex",flexWrap:"wrap",gap:2,maxHeight:150,overflowY:"auto",zIndex:10}}>{EMOJIS.map(e=><button key={e} onClick={()=>insertEmoji(e)} style={{background:"none",border:"none",fontSize:18,cursor:"pointer",padding:"3px 4px",borderRadius:4,lineHeight:1}}>{e}</button>)}</div>}
            <div style={{padding:"8px 10px",borderTop:"1px solid rgba(255,255,255,0.07)",display:"flex",gap:5,alignItems:"flex-end"}}>
              <button onClick={()=>fileInputRef.current?.click()} title="Attach" style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:7,padding:"7px 8px",color:"#9ca3af",cursor:"pointer",flexShrink:0,display:"flex"}}><svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg></button>
              <input ref={fileInputRef} type="file" style={{display:"none"}} onChange={e=>{sendFile(e.target.files[0]);e.target.value="";}}/>
              <button onClick={()=>setShowEmoji(v=>!v)} style={{background:showEmoji?"rgba(124,58,237,0.3)":"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:7,padding:"7px 8px",cursor:"pointer",flexShrink:0,fontSize:14}}>😊</button>
              <textarea ref={textareaRef} value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendText();}}} placeholder="Message… (Enter)" rows={1} style={{flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:7,padding:"7px 10px",color:"#e5e7eb",fontSize:12,resize:"none",outline:"none",fontFamily:"inherit",lineHeight:1.4,maxHeight:80,overflowY:"auto"}}/>
              <button onClick={sendText} disabled={!chatInput.trim()} style={{background:chatInput.trim()?"#7c3aed":"rgba(255,255,255,0.06)",border:"none",borderRadius:7,padding:"7px 10px",color:"#fff",cursor:chatInput.trim()?"pointer":"default",flexShrink:0,display:"flex",transition:"background 0.15s"}}><svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg></button>
            </div>
          </div>
        )}
      </div>

      {showSessionDialog && !controlEnabled && <SessionInfo socket={socketRef.current} onEndSession={onEndSession}/>}

      {/* CSS pulse animation for recording dot */}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );
};

export default AppScreen;
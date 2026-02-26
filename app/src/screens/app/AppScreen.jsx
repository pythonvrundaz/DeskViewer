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

const EMOJIS = [
  "😀","😂","😍","🥰","😎","😭","😅","🤔","😮","😡",
  "👍","👎","❤️","🔥","✅","❌","🎉","🙏","💯","👀",
  "🤣","😊","😇","🥳","😴","🤯","🤝","💪","🎊","👋",
  "✌️","🫡","💬","📎","🖼️","🚀","⭐","💡","🔔","😆",
];

// ─────────────────────────────────────────────────────────────────────────────
const AppScreen = ({
  remoteStream, remoteStreamRef, socketRef, callRef,
  remoteIdRef, userIdRef, localMicTrackRef,
  onDisconnect, onEndSession,
}) => {
  const videoRef        = useRef(null);
  const audioRef        = useRef(null);   // plays host audio (screen sound + host mic)
  const dispatch        = useDispatch();
  const mousePosRef     = useRef(null);
  const controlRef      = useRef(false);
  const toolbarTimerRef = useRef(null);

  const showSessionDialog = useSelector((s) => s.connection.showSessionDialog);

  const [videoPlaying,   setVideoPlaying]   = useState(false);
  const [controlEnabled, setControlEnabled] = useState(false);
  const [muted,          setMuted]          = useState(true);   // YOUR mic — starts muted
  const [showToolbar,    setShowToolbar]     = useState(true);
  const [hostMinimized,  setHostMinimized]   = useState(false);

  // chat
  const [showChat,   setShowChat]   = useState(false);
  const [messages,   setMessages]   = useState([]);
  const [chatInput,  setChatInput]  = useState("");
  const [uploading,  setUploading]  = useState(false);
  const [unread,     setUnread]     = useState(0);
  const [showEmoji,  setShowEmoji]  = useState(false);
  const chatEndRef   = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef  = useRef(null);

  // ── Attach remote stream ───────────────────────────────────────────────────
  // <video muted> shows the screen (no audio from it).
  // <audio> plays only the audio tracks — this bypasses Electron's autoplay muting.
  const attachStream = useCallback((stream) => {
    if (!stream) return;

    // Screen video — muted so we control audio separately
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

    // Audio-only element — plays desktop audio + host mic
    if (audioRef.current) {
      const audioTracks = stream.getAudioTracks();
      console.log("🔊 Viewer audio tracks:", audioTracks.map(t => `${t.kind} label=${t.label} enabled=${t.enabled} state=${t.readyState}`));
      if (audioTracks.length > 0) {
        const audioOnly = new MediaStream(audioTracks);
        audioRef.current.srcObject = audioOnly;
        audioRef.current.volume    = 1.0;
        audioRef.current.muted     = false;
        audioRef.current.play().catch(e => console.warn("audio.play():", e.message));
      } else {
        console.warn("🔊 No audio tracks in host stream");
      }
    }
  }, []);

  useEffect(() => { if (remoteStream)            attachStream(remoteStream);            }, [remoteStream, attachStream]);
  useEffect(() => { if (remoteStreamRef?.current) attachStream(remoteStreamRef.current); }, []);

  // Sync muted UI with track state (mic was muted right after call in App.js)
  useEffect(() => {
    const track = localMicTrackRef?.current;
    if (track) setMuted(!track.enabled);
  }, []);

  // ── Mute / unmute YOUR mic ─────────────────────────────────────────────────
  const toggleMute = () => {
    const track = localMicTrackRef?.current;
    if (!track) { console.warn("🎤 No mic track"); return; }
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
    console.log(`🎤 Viewer mic → ${track.enabled ? "UNMUTED (host can hear you)" : "MUTED"}`);
  };

  // ── Toolbar auto-hide ──────────────────────────────────────────────────────
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

  // ── Window events ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onMin    = () => { videoRef.current && (videoRef.current.style.cursor = "default"); setShowToolbar(true); clearTimeout(toolbarTimerRef.current); };
    const onRes    = (_, p) => {
      if (videoRef.current) videoRef.current.style.cursor = (p?.controlActive && controlRef.current) ? "none" : "default";
      if (!controlRef.current) { setShowToolbar(true); scheduleHide(); }
    };
    const onHostMin = () => {
      setHostMinimized(true);
      if (controlRef.current) { controlRef.current = false; setControlEnabled(false); videoRef.current && (videoRef.current.style.cursor = "default"); ipcRenderer.send("set-global-capture", false); }
    };
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

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => () => {
    if (videoRef.current) videoRef.current.srcObject = null;
    if (audioRef.current) audioRef.current.srcObject = null;
  }, []);

  // ── Chat: receive ──────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const onMsg = (msg) => {
      setMessages(prev => [...prev, msg]);
      if (!showChat) setUnread(u => u + 1);
    };
    socket.on("chat-message", onMsg);
    return () => socket.off("chat-message", onMsg);
  }, [showChat]);

  useEffect(() => { if (showChat) chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, showChat]);

  const toggleChat = () => { setShowEmoji(false); setShowChat(v => { if (!v) setUnread(0); return !v; }); };

  // ── Chat: send text ────────────────────────────────────────────────────────
  const sendText = () => {
    const text = chatInput.trim(); if (!text) return;
    const socket   = socketRef.current;
    const remoteId = String(remoteIdRef.current || "");
    const uid      = String(userIdRef.current   || "");
    if (!socket?.connected || !remoteId) return;
    const msg = { id:msgId(), from:"me", fromId:uid, text, ts:Date.now() };
    setMessages(p => [...p, msg]);
    socket.emit("chat-message", { remoteId, msg:{ ...msg, from:"them" } });
    setChatInput(""); setShowEmoji(false);
  };

  const insertEmoji = (emoji) => {
    const el = textareaRef.current;
    if (!el) { setChatInput(v => v + emoji); return; }
    const s = el.selectionStart ?? chatInput.length;
    const e = el.selectionEnd   ?? chatInput.length;
    setChatInput(chatInput.slice(0,s) + emoji + chatInput.slice(e));
    setTimeout(() => { el.selectionStart = el.selectionEnd = s + emoji.length; el.focus(); }, 0);
  };

  // ── Chat: send file ────────────────────────────────────────────────────────
  const sendFile = async (file) => {
    if (!file) return;
    const socket   = socketRef.current;
    const remoteId = String(remoteIdRef.current || "");
    const uid      = String(userIdRef.current   || "");
    if (!socket?.connected || !remoteId) return;
    setUploading(true);
    try {
      const fd  = new FormData(); fd.append("file", file);
      const res = await fetch(`${CONFIG.SOCKET_URL.replace(/\/$/,"")}/upload`, { method:"POST", body:fd });
      const data = await res.json();
      const msg  = { id:msgId(), from:"me", fromId:uid, file:data, ts:Date.now() };
      setMessages(p => [...p, msg]);
      socket.emit("chat-message", { remoteId, msg:{ ...msg, from:"them" } });
    } catch(e) { console.error("Upload failed:", e); }
    finally    { setUploading(false); }
  };

  // ── Coordinates ────────────────────────────────────────────────────────────
  const getCoords = (e) => {
    const v = videoRef.current; if (!v) return { x:0, y:0 };
    const r = v.getBoundingClientRect();
    const sw = v.videoWidth||1280, sh = v.videoHeight||720;
    const sa = sw/sh, ea = r.width/r.height;
    let rW, rH, oX, oY;
    if (sa>ea) { rW=r.width; rH=r.width/sa; oX=0; oY=(r.height-rH)/2; }
    else       { rH=r.height; rW=r.height*sa; oX=(r.width-rW)/2; oY=0; }
    return { x:Math.round((Math.max(0,Math.min(e.clientX-r.left-oX,rW))/rW)*sw), y:Math.round((Math.max(0,Math.min(e.clientY-r.top-oY,rH))/rH)*sh) };
  };

  const sendResolution = useCallback(() => {
    const v = videoRef.current; if (!v?.videoWidth) { setTimeout(sendResolution,200); return; }
    const s = socketRef.current, rid = String(remoteIdRef.current||""), uid = String(userIdRef.current||"");
    if (s?.connected && rid && uid) s.emit("stream-resolution", { userId:uid, remoteId:rid, event:{ width:v.videoWidth, height:v.videoHeight }});
  }, []);

  // ── Input listeners ────────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current; if (!video) return;
    const emit = (name, data) => {
      const s = socketRef.current, rid = String(remoteIdRef.current||""), uid = String(userIdRef.current||"");
      if (s?.connected && rid && uid) s.emit(name, { userId:uid, remoteId:rid, event:data });
    };
    const onMD = (e) => { if (!controlRef.current) return; e.preventDefault(); e.stopPropagation(); emit("mousedown",{ button:e.button,...getCoords(e) }); };
    const onMU = (e) => { if (!controlRef.current) return; emit("mouseup",{ button:e.button,...getCoords(e) }); };
    const onDC = (e) => { if (!controlRef.current) return; e.preventDefault(); emit("dblclick",getCoords(e)); };
    let acc=0;
    const onW  = (e) => {
      if (!controlRef.current) return; e.preventDefault();
      let d=e.deltaY; if (e.deltaMode===1) d*=40; if (e.deltaMode===2) d*=800;
      acc+=d*8; const steps=Math.round(acc/100); if (!steps) return; acc-=steps*100;
      emit("scroll",{ scroll:steps*100,...getCoords(e) });
    };
    const onMM = (e) => { if (controlRef.current) mousePosRef.current=getCoords(e); };
    const onKD = (e) => {
      if (!controlRef.current) return;
      if (e.ctrlKey&&e.shiftKey&&e.key==="I") return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag==="input"||tag==="textarea") return;
      if (e.key==="Escape") { controlRef.current=false; setControlEnabled(false); setShowToolbar(true); video.style.cursor="default"; ipcRenderer.send("set-global-capture",false); return; }
      e.preventDefault();
      emit("keydown",{ keyCode:e.key, ctrl:e.ctrlKey, shift:e.shiftKey, alt:e.altKey, meta:e.metaKey });
    };
    const onKU = (e) => {
      if (!controlRef.current) return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag==="input"||tag==="textarea") return;
      emit("keyup",{ keyCode:e.key });
    };
    const onGK = (_,d) => { if (controlRef.current) emit("keydown",d); };
    ipcRenderer.on("global-keydown", onGK);

    const iv = setInterval(() => {
      if (!controlRef.current || !mousePosRef.current) return;
      const s = socketRef.current, rid = String(remoteIdRef.current||""), uid = String(userIdRef.current||"");
      if (s?.connected && rid && uid) { s.emit("mousemove",{ userId:uid, remoteId:rid, event:mousePosRef.current }); mousePosRef.current=null; }
    }, 16);

    video.addEventListener("mousemove",onMM); video.addEventListener("mousedown",onMD);
    video.addEventListener("mouseup",onMU);   video.addEventListener("dblclick",onDC);
    video.addEventListener("wheel",onW,{ passive:false });
    window.addEventListener("keydown",onKD);  window.addEventListener("keyup",onKU);
    return () => {
      clearInterval(iv); ipcRenderer.removeListener("global-keydown",onGK);
      video.removeEventListener("mousemove",onMM); video.removeEventListener("mousedown",onMD);
      video.removeEventListener("mouseup",onMU);   video.removeEventListener("dblclick",onDC);
      video.removeEventListener("wheel",onW);
      window.removeEventListener("keydown",onKD);  window.removeEventListener("keyup",onKU);
    };
  }, []);

  // ── Toggle control ─────────────────────────────────────────────────────────
  const toggleControl = () => {
    const next = !controlRef.current; controlRef.current=next; setControlEnabled(next);
    if (next) { dispatch(setShowSessionDialog(false)); setShowToolbar(true); clearTimeout(toolbarTimerRef.current); videoRef.current&&(videoRef.current.style.cursor="none"); sendResolution(); }
    else      { setShowToolbar(true); scheduleHide(); videoRef.current&&(videoRef.current.style.cursor="default"); }
    ipcRenderer.send("set-global-capture", next);
  };

  // ── Disconnect ─────────────────────────────────────────────────────────────
  const handleDisconnect = () => {
    if (!window.confirm("End this session?")) return;
    // Clean up audio/video immediately
    if (audioRef.current) audioRef.current.srcObject = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setMessages([]); setShowChat(false); setUnread(0);
    ipcRenderer.send("set-global-capture", false);
    const rid = remoteIdRef?.current;
    if (socketRef.current && rid) socketRef.current.emit("remotedisconnected", { remoteId:rid });
    if (callRef.current) { callRef.current.close(); callRef.current=null; }
    onDisconnect();
  };

  // ── Style helpers ──────────────────────────────────────────────────────────
  const tbtn = (bg) => ({ display:"flex", alignItems:"center", gap:5, padding:"6px 13px", borderRadius:7, background:bg, border:"1.5px solid transparent", color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" });
  const ibtn = (title, fn, icon, badge) => (
    <button title={title} onClick={fn} style={{ position:"relative", background:"rgba(255,255,255,0.1)", border:"1.5px solid transparent", borderRadius:7, padding:"6px 10px", color:"#fff", cursor:"pointer", display:"flex", alignItems:"center" }}>
      {icon}
      {badge>0 && <span style={{ position:"absolute", top:-4, right:-4, background:"#ef4444", color:"#fff", fontSize:9, fontWeight:700, borderRadius:"50%", width:14, height:14, display:"flex", alignItems:"center", justifyContent:"center" }}>{badge>9?"9+":badge}</span>}
    </button>
  );

  // ── Chat bubble ────────────────────────────────────────────────────────────
  const Bubble = ({ msg }) => {
    const mine = msg.from==="me";
    const base = CONFIG.SOCKET_URL.replace(/\/$/,"");
    return (
      <div style={{ display:"flex", justifyContent:mine?"flex-end":"flex-start", marginBottom:6 }}>
        <div style={{ maxWidth:"78%", boxShadow:"0 1px 4px rgba(0,0,0,0.3)", borderRadius:mine?"12px 12px 2px 12px":"12px 12px 12px 2px", background:mine?"#7c3aed":"#1f2937", padding:msg.file?"6px":"8px 12px" }}>
          {msg.text && <p style={{ margin:0, color:"#fff", fontSize:13, wordBreak:"break-word", whiteSpace:"pre-wrap" }}>{msg.text}</p>}
          {msg.file && isImage(msg.file.type) && (
            <a href={base+msg.file.url} target="_blank" rel="noreferrer">
              <img src={base+msg.file.url} alt={msg.file.name} style={{ maxWidth:220, maxHeight:160, borderRadius:8, display:"block" }}/>
            </a>
          )}
          {msg.file && !isImage(msg.file.type) && (
            <a href={base+msg.file.url} target="_blank" rel="noreferrer" style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", textDecoration:"none" }}>
              <svg style={{width:22,height:22,flexShrink:0,color:"#93c5fd"}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              <div><div style={{ color:"#e5e7eb", fontSize:12, fontWeight:600, wordBreak:"break-all" }}>{msg.file.name}</div><div style={{ color:"#9ca3af", fontSize:10 }}>{fmt(msg.file.size)}</div></div>
            </a>
          )}
          <div style={{ color:mine?"rgba(255,255,255,0.45)":"#6b7280", fontSize:10, marginTop:3, textAlign:"right", paddingRight:msg.file?8:0 }}>
            {new Date(msg.ts).toLocaleTimeString([],{ hour:"2-digit", minute:"2-digit" })}
          </div>
        </div>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ width:"100vw", height:"100vh", background:"#0a0a0a", display:"flex", flexDirection:"column", overflow:"hidden" }}>

      {/* Audio element — plays host desktop audio + host mic (separate from muted video) */}
      <audio ref={audioRef} autoPlay style={{ display:"none" }} />

      {/* TOOLBAR */}
      <div style={{ flexShrink:0, overflow:"hidden", height:showToolbar?54:0, transition:"height 0.2s ease", display:"flex", alignItems:"center", justifyContent:"space-between", padding:showToolbar?"0 14px":0, background:"rgba(13,13,18,0.98)", borderBottom:showToolbar?"1px solid rgba(255,255,255,0.07)":"none" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:7, height:7, borderRadius:"50%", background:"#4ade80", boxShadow:"0 0 6px #4ade80" }}/>
          <span style={{ color:"#d1d5db", fontSize:13, fontWeight:500 }}>{remoteIdRef.current}</span>
          {controlEnabled && (
            <span style={{ display:"flex", alignItems:"center", gap:4, background:"rgba(185,28,28,0.85)", borderRadius:5, padding:"2px 8px", fontSize:10, fontWeight:700, color:"#fca5a5" }}>
              ● CONTROL ACTIVE · Esc to release
            </span>
          )}
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          {ibtn("Minimize", ()=>ipcRenderer.send("minimize-to-taskbar"),
            <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4"/></svg>
          )}
          {/* Mic mute — controls YOUR outgoing voice */}
          <button onClick={toggleMute} title={muted?"Unmute mic — let remote hear you":"Mute mic"} style={tbtn(muted?"#374151":"#059669")}>
            {muted
              ? <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/><line x1="3" y1="3" x2="21" y2="21" strokeWidth={2} strokeLinecap="round"/></svg>
              : <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
            }
            {muted?"Unmute":"Mute"}
          </button>
          <button onClick={toggleControl} style={tbtn(controlEnabled?"#dc2626":"#7c3aed")}>
            <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 6-5 2zm0 0l5 5"/></svg>
            {controlEnabled?"Release":"Request Control"}
          </button>
          {ibtn("Chat", toggleChat,
            <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>,
            unread
          )}
          <button onClick={()=>dispatch(setShowSessionDialog(true))} style={tbtn("#0284c7")}>
            <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            Info
          </button>
          <button onClick={handleDisconnect} style={tbtn("#dc2626")}>
            <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
            Disconnect
          </button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
        {/* VIDEO */}
        <div style={{ flex:1, position:"relative", background:"#000", overflow:"hidden" }}>
          {!videoPlaying && (
            <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"#111827", zIndex:5 }}>
              <svg style={{ width:48, height:48, color:"#38bdf8", marginBottom:16 }} viewBox="0 0 24 24" fill="none">
                <circle style={{opacity:0.25}} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path style={{opacity:0.75}} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              <p style={{ color:"#fff", fontSize:17, fontWeight:600, margin:0 }}>Connecting...</p>
              <p style={{ color:"#9ca3af", fontSize:13, marginTop:8 }}>Waiting for host to share</p>
              <button onClick={onDisconnect} style={{ marginTop:20, padding:"8px 22px", borderRadius:8, border:"1px solid #4b5563", background:"transparent", color:"#d1d5db", cursor:"pointer" }}>Cancel</button>
            </div>
          )}
          <video ref={videoRef} autoPlay playsInline muted
            style={{ width:"100%", height:"100%", objectFit:"contain", display:"block" }}
          />
          {hostMinimized && (
            <div style={{ position:"absolute", inset:0, zIndex:10, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.85)", backdropFilter:"blur(4px)" }}>
              <svg style={{ width:48, height:48, color:"#f59e0b", marginBottom:14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7"/></svg>
              <p style={{ color:"#fff", fontSize:16, fontWeight:700, margin:0 }}>Host minimized DeskViewer</p>
              <p style={{ color:"#9ca3af", fontSize:13, marginTop:6, textAlign:"center", maxWidth:280 }}>Ask the host to restore their window.</p>
            </div>
          )}
        </div>

        {/* CHAT PANEL */}
        {showChat && (
          <div style={{ width:300, display:"flex", flexDirection:"column", background:"#111827", borderLeft:"1px solid rgba(255,255,255,0.07)", flexShrink:0, position:"relative" }}>
            <div style={{ padding:"10px 14px", borderBottom:"1px solid rgba(255,255,255,0.07)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ color:"#e5e7eb", fontSize:13, fontWeight:600 }}>Chat</span>
              <button onClick={toggleChat} style={{ background:"none", border:"none", color:"#9ca3af", cursor:"pointer", padding:2 }}>
                <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div style={{ flex:1, overflowY:"auto", padding:"10px 10px 4px", display:"flex", flexDirection:"column" }}>
              {messages.length===0 && (
                <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:"#4b5563" }}>
                  <svg style={{width:36,height:36,marginBottom:8}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                  <span style={{ fontSize:12 }}>No messages yet</span>
                </div>
              )}
              {messages.map(m => <Bubble key={m.id} msg={m}/>)}
              <div ref={chatEndRef}/>
            </div>
            {uploading && (
              <div style={{ padding:"4px 14px", color:"#60a5fa", fontSize:11, display:"flex", alignItems:"center", gap:6 }}>
                <svg style={{width:11,height:11}} viewBox="0 0 24 24" fill="none"><circle style={{opacity:0.25}} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path style={{opacity:0.75}} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                Uploading...
              </div>
            )}
            {showEmoji && (
              <div style={{ position:"absolute", bottom:58, left:0, right:0, background:"#1f2937", borderTop:"1px solid rgba(255,255,255,0.08)", padding:"8px", display:"flex", flexWrap:"wrap", gap:2, maxHeight:150, overflowY:"auto", zIndex:10 }}>
                {EMOJIS.map(e => <button key={e} onClick={()=>insertEmoji(e)} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", padding:"3px 4px", borderRadius:4, lineHeight:1 }}>{e}</button>)}
              </div>
            )}
            <div style={{ padding:"8px 10px", borderTop:"1px solid rgba(255,255,255,0.07)", display:"flex", gap:5, alignItems:"flex-end" }}>
              <button onClick={()=>fileInputRef.current?.click()} title="Attach" style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:7, padding:"7px 8px", color:"#9ca3af", cursor:"pointer", flexShrink:0, display:"flex" }}>
                <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
              </button>
              <input ref={fileInputRef} type="file" style={{ display:"none" }} onChange={e=>{sendFile(e.target.files[0]);e.target.value="";}}/>
              <button onClick={()=>setShowEmoji(v=>!v)} title="Emoji" style={{ background:showEmoji?"rgba(124,58,237,0.3)":"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:7, padding:"7px 8px", cursor:"pointer", flexShrink:0, fontSize:14 }}>😊</button>
              <textarea ref={textareaRef} value={chatInput} onChange={e=>setChatInput(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendText();}}}
                placeholder="Message… (Enter)" rows={1}
                style={{ flex:1, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:7, padding:"7px 10px", color:"#e5e7eb", fontSize:12, resize:"none", outline:"none", fontFamily:"inherit", lineHeight:1.4, maxHeight:80, overflowY:"auto" }}
              />
              <button onClick={sendText} disabled={!chatInput.trim()}
                style={{ background:chatInput.trim()?"#7c3aed":"rgba(255,255,255,0.06)", border:"none", borderRadius:7, padding:"7px 10px", color:"#fff", cursor:chatInput.trim()?"pointer":"default", flexShrink:0, display:"flex", transition:"background 0.15s" }}>
                <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {showSessionDialog && !controlEnabled && (
        <SessionInfo socket={socketRef.current} onEndSession={onEndSession}/>
      )}
    </div>
  );
};

export default AppScreen;
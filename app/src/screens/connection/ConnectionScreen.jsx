// ConnectionScreen.jsx
// HOST SIDE — handles both the home/connect UI and the live session view.
//
// When a session is active (sessionMode === 0):
//   • Full-screen video preview of the host's own shared screen
//   • Annotation canvas overlay — HOST COLOR: #3b82f6 (blue)
//   • Receives viewer annotations (red) and renders them on the same canvas
//   • Record button — records localStream → downloads .webm
//   • Connection quality indicator
//   • Chat panel, mute button, clipboard sync, disconnect
//
// When idle: normal home screen with ID display, connect form, recent history.

import { useEffect, useRef, useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import SessionInfo from "../../components/SessionInfo";
import { setShowSessionDialog } from "../../states/connectionSlice";
import CONFIG from "../../config";

const { ipcRenderer } = window.require("electron");

// ── Color identity ─────────────────────────────────────────────────────────
const HOST_COLOR   = "#3b82f6";  // blue  — host draws in this color
const VIEWER_COLOR = "#ef4444";  // red   — shown on legend only (viewer draws on their side)

const fmtSize = (b) => {
  if (b < 1024)      return b + " B";
  if (b < 1048576)   return (b/1024).toFixed(1) + " KB";
  return (b/1048576).toFixed(1) + " MB";
};
const isImage = (t="") => t.startsWith("image/");
const msgId   = () => Math.random().toString(36).slice(2);

const EMOJIS = [
  "😀","😂","😍","🥰","😎","😭","😅","🤔","😮","😡",
  "👍","👎","❤️","🔥","✅","❌","🎉","🙏","💯","👀",
  "🤣","😊","😇","🥳","😴","🤯","🤝","💪","🎊","👋",
  "✌️","🫡","💬","📎","🖼️","🚀","⭐","💡","🔔","😆",
];

const ANNO_TOOLS = ["pen","arrow","rect","text","eraser"];
const ANNO_SIZES = [2,4,7,12];

// ── Recent connections helpers ────────────────────────────────────────────
const RECENT_KEY   = "dv_recent_connections";
const MAX_RECENT   = 8;
const loadRecent   = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; } };
const saveRecent   = (id) => { const u=[{id,ts:Date.now()},...loadRecent().filter(r=>r.id!==id)].slice(0,MAX_RECENT); localStorage.setItem(RECENT_KEY,JSON.stringify(u)); return u; };
const removeRecent = (id) => { const u=loadRecent().filter(r=>r.id!==id); localStorage.setItem(RECENT_KEY,JSON.stringify(u)); return u; };
const fmtRelTime   = (ts) => { const m=Math.floor((Date.now()-ts)/60000); if(m<1)return"just now"; if(m<60)return`${m}m ago`; const h=Math.floor(m/60); if(h<24)return`${h}h ago`; return`${Math.floor(h/24)}d ago`; };

// ─────────────────────────────────────────────────────────────────────────────
const ConnectionScreen = ({
  myId, socketRef, remoteIdRef, userIdRef, localMicTrackRef,
  hostMicGainRef,
  localStreamRef,    // NEW — ref to host's captured screen MediaStream
  callRef,           // NEW — ref to the active PeerJS call (for quality stats)
  incomingCall, incomingCallerId, acceptCall, rejectCall,
  startCall, onEndSession, callRejected, sessionReset,
}) => {
  const dispatch = useDispatch();

  // ── Home state ───────────────────────────────────────────────────────────
  const [remoteId,   setRemoteId]   = useState("");
  const [showCopied, setShowCopied] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [recentList, setRecentList] = useState(loadRecent);

  const showSessionDialog = useSelector((s) => s.connection.showSessionDialog);
  const sessionMode       = useSelector((s) => s.connection.sessionMode);
  const sessionActive     = sessionMode === 0;   // host session view — independent of Info modal

  // ── Session refs ─────────────────────────────────────────────────────────
  const videoRef        = useRef(null);
  const canvasRef       = useRef(null);
  const toolbarTimerRef = useRef(null);

  // ── Session UI state ─────────────────────────────────────────────────────
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [showToolbar,  setShowToolbar]  = useState(true);
  const [muted,        setMuted]        = useState(true);

  // ── Clipboard toast ───────────────────────────────────────────────────────
  const [clipToast,       setClipToast]       = useState("");
  const clipToastTimerRef = useRef(null);
  const showClipToast = useCallback((msg) => {
    setClipToast(msg);
    clearTimeout(clipToastTimerRef.current);
    clipToastTimerRef.current = setTimeout(() => setClipToast(""), 2500);
  }, []);

  // ── Chat ─────────────────────────────────────────────────────────────────
  const [showChat,  setShowChat]  = useState(false);
  const [messages,  setMessages]  = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [unread,    setUnread]    = useState(0);
  const [showEmoji, setShowEmoji] = useState(false);
  const chatEndRef   = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef  = useRef(null);

  // ── Recording ─────────────────────────────────────────────────────────────
  const [recording,   setRecording]   = useState(false);
  const [recDuration, setRecDuration] = useState(0);
  const recorderRef  = useRef(null);
  const recChunksRef = useRef([]);
  const recTimerRef  = useRef(null);

  // ── Connection quality ─────────────────────────────────────────────────────
  const [quality, setQuality] = useState(null);

  // ── Annotation ────────────────────────────────────────────────────────────
  const [annoMode,    setAnnoMode]    = useState(false);
  const [annoTool,    setAnnoTool]    = useState("pen");
  const [annoSize,    setAnnoSize]    = useState(4);
  const [annoTextVal, setAnnoTextVal] = useState("");
  const annoDrawingRef  = useRef(false);
  const annoStartRef    = useRef({ x:0, y:0 });
  const annoSnapshotRef = useRef(null);
  const annoTextPosRef  = useRef(null);
  const annoInputRef    = useRef(null);

  // ─────────────────────────────────────────────────────────────────────────
  // Attach local stream to host's own preview <video>
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionActive) return;
    const stream = localStreamRef?.current;
    if (!stream || !videoRef.current) return;
    videoRef.current.srcObject = stream;
    videoRef.current.muted     = true;
    videoRef.current.play()
      .then(() => { setVideoPlaying(true); setTimeout(syncCanvasSize, 100); })
      .catch(e  => console.warn("Host preview play():", e.message));
  }, [sessionActive]);

  // ── Toolbar auto-hide ─────────────────────────────────────────────────────
  const scheduleHide = useCallback(() => {
    clearTimeout(toolbarTimerRef.current);
    if (!annoMode)
      toolbarTimerRef.current = setTimeout(() => setShowToolbar(false), 3000);
  }, [annoMode]);

  useEffect(() => {
    if (!sessionActive) return;
    const onMove = () => { setShowToolbar(true); scheduleHide(); };
    window.addEventListener("mousemove", onMove);
    scheduleHide();
    return () => { window.removeEventListener("mousemove", onMove); clearTimeout(toolbarTimerRef.current); };
  }, [sessionActive, scheduleHide]);

  useEffect(() => {
    if (annoMode) { setShowToolbar(true); clearTimeout(toolbarTimerRef.current); }
  }, [annoMode]);

  // ── Session reset ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionReset) return;
    setMessages([]); setShowChat(false); setUnread(0);
    setChatInput(""); setConnecting(false); setMuted(true);
    setVideoPlaying(false); setAnnoMode(false); setQuality(null);
    stopRecording();
    const c = canvasRef.current;
    if (c) c.getContext("2d").clearRect(0,0,c.width,c.height);
  }, [sessionReset]);

  useEffect(() => { if (showCopied) { const t=setTimeout(()=>setShowCopied(false),2000); return ()=>clearTimeout(t); } }, [showCopied]);
  useEffect(() => { if (callRejected) setConnecting(false); }, [callRejected]);

  // ── CLIPBOARD: receive viewer's clipboard ─────────────────────────────────
  useEffect(() => {
    const socket = socketRef?.current; if (!socket) return;
    const onClip = ({ text }) => {
      if (!text) return;
      ipcRenderer.invoke("WRITE_CLIPBOARD", text)
        .catch(() => navigator.clipboard.writeText(text).catch(() => {}));
      showClipToast("📋 Viewer clipboard synced");
    };
    socket.on("clipboard-sync", onClip);
    return () => socket.off("clipboard-sync", onClip);
  }, [socketRef, showClipToast]);

  // ── CLIPBOARD: send host's clipboard on copy ──────────────────────────────
  useEffect(() => {
    if (!sessionActive) return;
    const onCopy = async () => {
      try {
        const text = await navigator.clipboard.readText(); if (!text) return;
        const s = socketRef?.current, rid = String(remoteIdRef?.current||"");
        if (s?.connected && rid) {
          s.emit("clipboard-sync", { remoteId:rid, text });
          showClipToast("📋 Clipboard sent to viewer");
        }
      } catch { /* permission denied */ }
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [sessionActive, socketRef, remoteIdRef, showClipToast]);

  // ── CHAT ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = socketRef?.current; if (!socket) return;
    const onMsg = (msg) => { setMessages(p=>[...p,msg]); if (!showChat) setUnread(p=>p+1); };
    socket.on("chat-message", onMsg);
    return () => socket.off("chat-message", onMsg);
  }, [showChat, socketRef]);

  useEffect(() => { if (showChat) chatEndRef.current?.scrollIntoView({behavior:"smooth"}); }, [messages, showChat]);
  const toggleChat = () => { setShowEmoji(false); setShowChat(v => { if (!v) setUnread(0); return !v; }); };

  const toggleMute = () => {
    const gain = hostMicGainRef?.current; if (!gain) return;
    const nowMuted = gain.gain.value === 0;
    gain.gain.value = nowMuted ? 1 : 0;
    setMuted(!nowMuted);
  };

  const insertEmoji = (emoji) => {
    const el=textareaRef.current; if(!el) { setChatInput(v=>v+emoji); return; }
    const s=el.selectionStart??chatInput.length, e=el.selectionEnd??chatInput.length;
    setChatInput(chatInput.slice(0,s)+emoji+chatInput.slice(e));
    setTimeout(()=>{ el.selectionStart=el.selectionEnd=s+emoji.length; el.focus(); },0);
  };

  const sendText = () => {
    const text=chatInput.trim(); if (!text) return;
    const s=socketRef?.current, rid=String(remoteIdRef?.current||""), uid=String(userIdRef?.current||"");
    if (!s?.connected||!rid) return;
    const msg={id:msgId(),from:"me",fromId:uid,text,ts:Date.now()};
    setMessages(p=>[...p,msg]);
    s.emit("chat-message",{remoteId:rid,msg:{...msg,from:"them"}});
    setChatInput(""); setShowEmoji(false);
  };

  const sendFile = async (file) => {
    if (!file) return;
    const s=socketRef?.current, rid=String(remoteIdRef?.current||""), uid=String(userIdRef?.current||"");
    if (!s?.connected||!rid) return; setUploading(true);
    try {
      const fd=new FormData(); fd.append("file",file);
      const res=await fetch(`${CONFIG.SOCKET_URL.replace(/\/$/,"")}/upload`,{method:"POST",body:fd});
      const data=await res.json();
      const msg={id:msgId(),from:"me",fromId:uid,file:data,ts:Date.now()};
      setMessages(p=>[...p,msg]);
      s.emit("chat-message",{remoteId:rid,msg:{...msg,from:"them"}});
    } catch(e) { console.error("Upload failed:",e); } finally { setUploading(false); }
  };

  // ── HOME: connect + recent ────────────────────────────────────────────────
  const handleConnect = (id=remoteId) => {
    const rid=String(id).trim();
    if (rid.length<10) { alert("Remote ID must be 10 digits"); return; }
    if (!rid.match(/^\d+$/)) { alert("Remote ID must be numeric"); return; }
    if (rid===String(myId)) { alert("Cannot connect to yourself"); return; }
    setConnecting(true); setRecentList(saveRecent(rid)); startCall(rid);
  };
  const handleRemoveRecent = (id,e) => { e.stopPropagation(); setRecentList(removeRecent(id)); };

  // ── RECORDING ─────────────────────────────────────────────────────────────
  const startRecording = useCallback(() => {
    const stream = localStreamRef?.current; if (!stream) { console.warn("No local stream to record"); return; }
    try {
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus" : "video/webm";
      const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond:3_000_000 });
      recChunksRef.current=[];
      rec.ondataavailable = e => { if(e.data.size>0) recChunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob=new Blob(recChunksRef.current,{type:mimeType});
        const url=URL.createObjectURL(blob);
        const a=document.createElement("a");
        const ts=new Date().toISOString().replace(/[:.]/g,"-").slice(0,-5);
        a.href=url; a.download=`DeskViewer-Host-${ts}.webm`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(()=>URL.revokeObjectURL(url),5000);
      };
      rec.start(1000);
      recorderRef.current=rec; setRecording(true); setRecDuration(0);
      recTimerRef.current=setInterval(()=>setRecDuration(d=>d+1),1000);
    } catch(e) { console.error("Host recording failed:",e); }
  }, [localStreamRef]);

  const stopRecording = useCallback(() => {
    clearInterval(recTimerRef.current);
    if (recorderRef.current && recorderRef.current.state!=="inactive") recorderRef.current.stop();
    recorderRef.current=null; setRecording(false); setRecDuration(0);
  }, []);

  const fmtDuration = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  // ── CONNECTION QUALITY ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionActive) return;
    let prevBytes=0, prevTs=0;
    const poll = async () => {
      const pc = callRef?.current?.peerConnection; if (!pc) return;
      try {
        const stats = await pc.getStats();
        let rtt=null, fps=null, kbps=null, lost=null;
        stats.forEach(r => {
          if (r.type==="candidate-pair"&&r.state==="succeeded"&&r.currentRoundTripTime!=null)
            rtt=Math.round(r.currentRoundTripTime*1000);
          if (r.type==="outbound-rtp"&&r.kind==="video") {
            fps=r.framesPerSecond??null;
            const now=Date.now();
            if (prevBytes&&prevTs) kbps=Math.round(((r.bytesSent-prevBytes)*8)/(now-prevTs));
            prevBytes=r.bytesSent; prevTs=now;
            if (r.packetsLost!=null&&r.packetsSent!=null&&r.packetsSent>0)
              lost=((r.packetsLost/(r.packetsLost+r.packetsSent))*100).toFixed(1);
          }
        });
        setQuality({rtt, fps:fps!=null?Math.round(fps):null, kbps, lost});
      } catch {}
    };
    const iv=setInterval(poll,2000); poll();
    return () => clearInterval(iv);
  }, [sessionActive, callRef]);

  const qualityColor = () => { if (!quality?.rtt) return "#9ca3af"; if (quality.rtt<80) return "#4ade80"; if (quality.rtt<200) return "#facc15"; return "#f87171"; };
  const qualityLabel = () => { if (!quality?.rtt) return "—"; if (quality.rtt<80) return "Good"; if (quality.rtt<200) return "Fair"; return "Poor"; };

  // ── ANNOTATION CANVAS ─────────────────────────────────────────────────────
  // Syncs size to video via ResizeObserver.
  // HOST draws in HOST_COLOR (blue).
  // Incoming annotation-frame from viewer is painted directly onto canvas.
  // annotation-clear from viewer → clear our canvas AND re-emit so viewer clears too.

  const syncCanvasSize = useCallback(() => {
    const v=videoRef.current, c=canvasRef.current; if (!v||!c) return;
    // Use offsetWidth/offsetHeight for real rendered pixel dimensions
    const w = v.offsetWidth, h = v.offsetHeight;
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) {
      // Preserve existing drawing content while resizing
      const tmp=document.createElement("canvas"); tmp.width=c.width; tmp.height=c.height;
      tmp.getContext("2d").drawImage(c,0,0);
      c.width=w; c.height=h;
      c.getContext("2d").drawImage(tmp,0,0);
    }
  }, []);

  useEffect(() => {
    const ro=new ResizeObserver(syncCanvasSize);
    if (videoRef.current) ro.observe(videoRef.current);
    return () => ro.disconnect();
  }, [syncCanvasSize]);

  // Receive annotation-frame from VIEWER — draw onto our canvas
  // The viewer emits with role:"viewer" — we only process those
  useEffect(() => {
    const socket=socketRef?.current; if (!socket) return;
    const onFrame = ({ role, dataUrl, clear }) => {
      if (role !== "viewer") return;   // ignore our own echoes from server
      const c=canvasRef.current; if (!c) return;
      if (clear) { c.getContext("2d").clearRect(0,0,c.width,c.height); return; }
      if (!dataUrl) return;
      const img=new Image();
      img.onload=()=>{ c.getContext("2d").clearRect(0,0,c.width,c.height); c.getContext("2d").drawImage(img,0,0,c.width,c.height); };
      img.src=dataUrl;
    };
    socket.on("annotation-frame", onFrame);
    return () => socket.off("annotation-frame", onFrame);
  }, [socketRef]);

  const getCanvasXY = (e) => {
    const c=canvasRef.current; if (!c) return {x:0,y:0};
    const r=c.getBoundingClientRect();
    return {x:e.clientX-r.left, y:e.clientY-r.top};
  };

  const annoPointerDown = useCallback((e) => {
    if (!annoMode) return;
    e.preventDefault(); e.stopPropagation();
    const {x,y}=getCanvasXY(e);
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d");
    if (annoTool==="text") { annoTextPosRef.current={x,y}; setAnnoTextVal(""); setTimeout(()=>annoInputRef.current?.focus(),30); return; }
    annoDrawingRef.current=true; annoStartRef.current={x,y};
    const snap=document.createElement("canvas"); snap.width=c.width; snap.height=c.height;
    snap.getContext("2d").drawImage(c,0,0); annoSnapshotRef.current=snap;
    if (annoTool==="pen") { ctx.beginPath(); ctx.moveTo(x,y); ctx.strokeStyle=HOST_COLOR; ctx.lineWidth=annoSize; ctx.lineCap="round"; ctx.lineJoin="round"; }
  }, [annoMode, annoTool, annoSize]);

  const annoPointerMove = useCallback((e) => {
    if (!annoDrawingRef.current||!annoMode) return;
    e.preventDefault();
    const {x,y}=getCanvasXY(e);
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d");
    const {x:sx,y:sy}=annoStartRef.current;
    if (annoTool==="pen") { ctx.lineTo(x,y); ctx.stroke(); }
    else if (annoTool==="eraser") { ctx.clearRect(x-annoSize*3,y-annoSize*3,annoSize*6,annoSize*6); }
    else {
      ctx.clearRect(0,0,c.width,c.height); ctx.drawImage(annoSnapshotRef.current,0,0);
      ctx.strokeStyle=HOST_COLOR; ctx.fillStyle=HOST_COLOR; ctx.lineWidth=annoSize; ctx.lineCap="round"; ctx.lineJoin="round";
      if (annoTool==="rect") { ctx.beginPath(); ctx.strokeRect(sx,sy,x-sx,y-sy); }
      else if (annoTool==="arrow") {
        const dx=x-sx,dy=y-sy,angle=Math.atan2(dy,dx),len=Math.sqrt(dx*dx+dy*dy);
        const hw=Math.min(len*0.35,18),ha=0.45;
        ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(x,y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x,y);
        ctx.lineTo(x-hw*Math.cos(angle-ha),y-hw*Math.sin(angle-ha));
        ctx.lineTo(x-hw*Math.cos(angle+ha),y-hw*Math.sin(angle+ha));
        ctx.closePath(); ctx.fill();
      }
    }
  }, [annoMode, annoTool, annoSize]);

  const annoPointerUp = useCallback(() => {
    if (!annoDrawingRef.current) return;
    annoDrawingRef.current=false; annoSnapshotRef.current=null;
    const c=canvasRef.current; if (!c) return;
    const s=socketRef?.current, rid=String(remoteIdRef?.current||""), uid=String(userIdRef?.current||"");
    if (s?.connected&&rid) s.emit("annotation-frame",{remoteId:rid,userId:uid,role:"host",dataUrl:c.toDataURL("image/png")});
  }, [socketRef, remoteIdRef, userIdRef]);

  const annoCommitText = () => {
    const text=annoTextVal.trim(); if (!text||!annoTextPosRef.current) { setAnnoTextVal(""); return; }
    const {x,y}=annoTextPosRef.current;
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d");
    ctx.font=`${Math.max(annoSize*4,16)}px sans-serif`; ctx.fillStyle=HOST_COLOR;
    ctx.fillText(text,x,y);
    setAnnoTextVal(""); annoTextPosRef.current=null;
    const s=socketRef?.current, rid=String(remoteIdRef?.current||""), uid=String(userIdRef?.current||"");
    if (s?.connected&&rid) s.emit("annotation-frame",{remoteId:rid,userId:uid,role:"host",dataUrl:c.toDataURL("image/png")});
  };

  const clearCanvas = () => {
    const c=canvasRef.current; if (!c) return;
    c.getContext("2d").clearRect(0,0,c.width,c.height);
    const s=socketRef?.current, rid=String(remoteIdRef?.current||""), uid=String(userIdRef?.current||"");
    // Use same protocol as AppScreen: annotation-frame with clear:true + role:"host"
    // This clears the viewer's "theirCanvas" (host strokes layer)
    if (s?.connected&&rid) s.emit("annotation-frame",{remoteId:rid,userId:uid,role:"host",clear:true});
  };

  // ── Disconnect ────────────────────────────────────────────────────────────
  const handleDisconnect = () => {
    if (!window.confirm("Stop sharing and end this session?")) return;
    stopRecording();
    const rid=remoteIdRef?.current;
    if (socketRef?.current&&rid) socketRef.current.emit("remotedisconnected",{remoteId:rid});
    onEndSession();
  };

  // ── Style helpers ─────────────────────────────────────────────────────────
  const tbtn = (bg, active) => ({
    display:"flex", alignItems:"center", gap:5, padding:"6px 12px", borderRadius:7,
    background:bg, border:active?"1.5px solid rgba(255,255,255,0.4)":"1.5px solid transparent",
    color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap",
  });
  const ibtn = (title,fn,icon,badge) => (
    <button title={title} onClick={fn} style={{position:"relative",background:"rgba(255,255,255,0.1)",border:"1.5px solid transparent",borderRadius:7,padding:"6px 10px",color:"#fff",cursor:"pointer",display:"flex",alignItems:"center"}}>
      {icon}{badge>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#ef4444",color:"#fff",fontSize:9,fontWeight:700,borderRadius:"50%",width:14,height:14,display:"flex",alignItems:"center",justifyContent:"center"}}>{badge>9?"9+":badge}</span>}
    </button>
  );

  const Bubble = ({ msg }) => {
    const mine=msg.from==="me", base=CONFIG.SOCKET_URL.replace(/\/$/,"");
    return (
      <div style={{display:"flex",justifyContent:mine?"flex-end":"flex-start",marginBottom:6}}>
        <div style={{maxWidth:"78%",boxShadow:"0 1px 4px rgba(0,0,0,0.3)",borderRadius:mine?"12px 12px 2px 12px":"12px 12px 12px 2px",background:mine?"#1d4ed8":"#1f2937",padding:msg.file?"6px":"8px 12px"}}>
          {msg.text&&<p style={{margin:0,color:"#fff",fontSize:13,wordBreak:"break-word",whiteSpace:"pre-wrap"}}>{msg.text}</p>}
          {msg.file&&isImage(msg.file.type)&&<a href={base+msg.file.url} target="_blank" rel="noreferrer"><img src={base+msg.file.url} alt={msg.file.name} style={{maxWidth:220,maxHeight:160,borderRadius:8,display:"block"}}/></a>}
          {msg.file&&!isImage(msg.file.type)&&<a href={base+msg.file.url} target="_blank" rel="noreferrer" style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",textDecoration:"none"}}><svg style={{width:22,height:22,flexShrink:0,color:"#93c5fd"}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><div><div style={{color:"#e5e7eb",fontSize:12,fontWeight:600,wordBreak:"break-all"}}>{msg.file.name}</div><div style={{color:"#9ca3af",fontSize:10}}>{fmtSize(msg.file.size)}</div></div></a>}
          <div style={{color:"rgba(255,255,255,0.45)",fontSize:10,marginTop:3,textAlign:"right",paddingRight:msg.file?8:0}}>{new Date(msg.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // SESSION VIEW — full screen host preview
  // ─────────────────────────────────────────────────────────────────────────
  if (sessionActive) {
    return (
      <div style={{width:"100vw",height:"100vh",background:"#0a0a0a",display:"flex",flexDirection:"column",overflow:"hidden"}}>

        {/* CLIPBOARD TOAST */}
        {clipToast&&(
          <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",zIndex:400,background:"#1e3a5f",color:"#fff",fontSize:12,fontWeight:600,borderRadius:8,padding:"8px 16px",boxShadow:"0 4px 16px rgba(0,0,0,0.4)",pointerEvents:"none",whiteSpace:"nowrap"}}>
            {clipToast}
          </div>
        )}

        {/* TOOLBAR */}
        <div style={{flexShrink:0,overflow:"hidden",height:showToolbar?54:0,transition:"height 0.2s ease",display:"flex",alignItems:"center",justifyContent:"space-between",padding:showToolbar?"0 14px":0,background:"rgba(10,20,40,0.98)",borderBottom:showToolbar?"1px solid rgba(59,130,246,0.2)":"none"}}>

          {/* LEFT */}
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:HOST_COLOR,boxShadow:`0 0 6px ${HOST_COLOR}`}}/>
            <span style={{color:"#d1d5db",fontSize:13,fontWeight:500}}>Sharing with: {remoteIdRef.current}</span>
            <span style={{background:"rgba(59,130,246,0.2)",color:"#93c5fd",fontSize:10,fontWeight:700,borderRadius:5,padding:"2px 8px",border:"1px solid rgba(59,130,246,0.3)"}}>HOST</span>

            {/* Recording badge */}
            {recording&&(
              <span style={{display:"flex",alignItems:"center",gap:5,background:"rgba(220,38,38,0.2)",border:"1px solid #ef4444",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700,color:"#fca5a5"}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:"#ef4444",animation:"pulse 1s infinite",display:"inline-block"}}/>
                REC {fmtDuration(recDuration)}
              </span>
            )}

            {/* Quality */}
            {quality&&(
              <span title={`RTT: ${quality.rtt??'—'}ms | FPS: ${quality.fps??'—'} | ${quality.kbps??'—'} kbps`}
                style={{display:"flex",alignItems:"center",gap:4,background:"rgba(255,255,255,0.05)",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:600,color:qualityColor(),cursor:"default",border:`1px solid ${qualityColor()}44`}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:qualityColor()}}/>
                {qualityLabel()}
                {quality.rtt!=null&&<span style={{opacity:0.75}}>{quality.rtt}ms</span>}
                {quality.fps!=null&&<span style={{opacity:0.6}}>{quality.fps}fps</span>}
              </span>
            )}

            {/* Annotation active */}
            {annoMode&&(
              <span style={{display:"flex",alignItems:"center",gap:4,background:"rgba(59,130,246,0.25)",border:"1px solid rgba(59,130,246,0.4)",borderRadius:5,padding:"2px 8px",fontSize:10,fontWeight:700,color:"#bfdbfe"}}>
                ✏️ ANNOTATING (blue)
              </span>
            )}
          </div>

          {/* RIGHT */}
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {ibtn("Minimize",()=>ipcRenderer.send("minimize-to-taskbar"),
              <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4"/></svg>
            )}

            {/* Mic */}
            <button onClick={toggleMute} style={tbtn(muted?"#374151":"#059669")}>
              {muted
                ? <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/><line x1="3" y1="3" x2="21" y2="21" strokeWidth={2} strokeLinecap="round"/></svg>
                : <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
              }
              {muted?"Unmute Mic":"Mute Mic"}
            </button>

            {/* Annotate */}
            <button onClick={()=>setAnnoMode(v=>!v)} style={tbtn(annoMode?"#1d4ed8":"#374151",annoMode)}>
              <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
              Annotate
            </button>

            {/* Record */}
            <button onClick={()=>recording?stopRecording():startRecording()} style={tbtn(recording?"#dc2626":"#374151",recording)}>
              {recording
                ? <svg style={{width:12,height:12}} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                : <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="8" strokeWidth={2}/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>
              }
              {recording?"Stop Rec":"Record"}
            </button>

            {/* Chat */}
            {ibtn("Chat",toggleChat,
              <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>,
              unread
            )}

            {/* Info */}
            <button onClick={()=>dispatch(setShowSessionDialog(true))} style={tbtn("#0284c7")}>
              <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              Info
            </button>

            {/* Stop sharing */}
            <button onClick={handleDisconnect} style={tbtn("#dc2626")}>
              <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              Stop Sharing
            </button>
          </div>
        </div>

        {/* ANNOTATION TOOLBAR */}
        {annoMode&&(
          <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:10,padding:"6px 14px",background:"rgba(10,20,50,0.97)",borderBottom:"1px solid rgba(59,130,246,0.15)",flexWrap:"wrap"}}>
            {/* Tools */}
            <div style={{display:"flex",gap:4}}>
              {ANNO_TOOLS.map(t=>(
                <button key={t} onClick={()=>setAnnoTool(t)}
                  style={{padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",border:`1.5px solid ${annoTool===t?HOST_COLOR:"transparent"}`,background:annoTool===t?"#1d4ed8":"rgba(255,255,255,0.07)",color:"#fff",transition:"background 0.12s"}}>
                  {t==="pen"?"✏️ Pen":t==="arrow"?"➡️ Arrow":t==="rect"?"▭ Rect":t==="text"?"T Text":"◻ Erase"}
                </button>
              ))}
            </div>
            <div style={{width:1,height:20,background:"rgba(255,255,255,0.15)"}}/>
            {/* Color legend */}
            <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:"#9ca3af"}}>
              <span style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{width:10,height:10,borderRadius:"50%",background:HOST_COLOR,display:"inline-block",border:"1.5px solid #fff"}}/>
                <span style={{color:"#93c5fd",fontWeight:600}}>You (blue)</span>
              </span>
              <span style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{width:10,height:10,borderRadius:"50%",background:VIEWER_COLOR,display:"inline-block",border:"1.5px solid rgba(255,255,255,0.4)"}}/>
                <span style={{color:"#fca5a5"}}>Viewer (red)</span>
              </span>
            </div>
            <div style={{width:1,height:20,background:"rgba(255,255,255,0.15)"}}/>
            {/* Stroke sizes */}
            <div style={{display:"flex",gap:4,alignItems:"center"}}>
              {ANNO_SIZES.map(sz=>(
                <button key={sz} onClick={()=>setAnnoSize(sz)}
                  style={{width:sz*2.5+10,height:sz*2.5+10,borderRadius:"50%",background:annoSize===sz?HOST_COLOR:"rgba(255,255,255,0.15)",border:annoSize===sz?`2px solid #93c5fd`:"2px solid transparent",cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <span style={{width:sz,height:sz,borderRadius:"50%",background:"#fff",display:"block"}}/>
                </button>
              ))}
            </div>
            {/* Text input */}
            {annoTool==="text"&&(
              <input ref={annoInputRef} value={annoTextVal} onChange={e=>setAnnoTextVal(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();annoCommitText();}if(e.key==="Escape")setAnnoTextVal("");}}
                placeholder="Type then click where to place…"
                style={{background:"rgba(255,255,255,0.1)",border:`1px solid ${HOST_COLOR}`,borderRadius:6,padding:"4px 8px",color:"#fff",fontSize:12,outline:"none",width:200}}
              />
            )}
            <button onClick={clearCanvas}
              style={{marginLeft:"auto",padding:"4px 12px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",background:"rgba(220,38,38,0.3)",border:"1px solid #ef4444",color:"#fca5a5"}}>
              🗑 Clear Both
            </button>
          </div>
        )}

        {/* MAIN */}
        <div style={{flex:1,display:"flex",overflow:"hidden"}}>

          {/* VIDEO + ANNOTATION CANVAS */}
          <div style={{flex:1,position:"relative",background:"#000",overflow:"hidden"}}>

            {/* Loading overlay */}
            {!videoPlaying&&(
              <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#0a0a0a",zIndex:5}}>
                <svg style={{width:48,height:48,color:HOST_COLOR,marginBottom:16}} viewBox="0 0 24 24" fill="none"><circle style={{opacity:0.25}} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path style={{opacity:0.75}} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                <p style={{color:"#fff",fontSize:16,fontWeight:600,margin:0}}>Loading screen preview…</p>
                <p style={{color:"#6b7280",fontSize:12,marginTop:8}}>The viewer is seeing your screen live</p>
              </div>
            )}

            <video ref={videoRef} autoPlay playsInline muted
              style={{width:"100%",height:"100%",objectFit:"contain",display:"block"}}
            />

            {/* Annotation canvas — absolute over video, same pixel size */}
            <canvas
              ref={canvasRef}
              onPointerDown={annoPointerDown}
              onPointerMove={annoPointerMove}
              onPointerUp={annoPointerUp}
              onPointerLeave={annoPointerUp}
              style={{
                position:"absolute", top:0, left:0,
                width:"100%", height:"100%",
                display:"block",
                cursor:annoMode?(annoTool==="eraser"?"cell":annoTool==="text"?"text":"crosshair"):"default",
                pointerEvents:annoMode?"all":"none",
                touchAction:"none",
                zIndex:3,
              }}
            />
          </div>

          {/* CHAT PANEL */}
          {showChat&&(
            <div style={{width:300,display:"flex",flexDirection:"column",background:"#111827",borderLeft:"1px solid rgba(59,130,246,0.15)",flexShrink:0,position:"relative"}}>
              <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span style={{color:"#e5e7eb",fontSize:13,fontWeight:600}}>Chat</span>
                <button onClick={toggleChat} style={{background:"none",border:"none",color:"#9ca3af",cursor:"pointer",padding:2}}>
                  <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>
              <div style={{flex:1,overflowY:"auto",padding:"10px 10px 4px",display:"flex",flexDirection:"column"}}>
                {messages.length===0&&(
                  <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#4b5563"}}>
                    <svg style={{width:36,height:36,marginBottom:8}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                    <span style={{fontSize:12}}>No messages yet</span>
                  </div>
                )}
                {messages.map(m=><Bubble key={m.id} msg={m}/>)}
                <div ref={chatEndRef}/>
              </div>
              {uploading&&<div style={{padding:"4px 14px",color:"#60a5fa",fontSize:11,display:"flex",alignItems:"center",gap:6}}>Uploading...</div>}
              {showEmoji&&(
                <div style={{borderTop:"1px solid rgba(255,255,255,0.08)",padding:"8px",display:"flex",flexWrap:"wrap",gap:2,maxHeight:150,overflowY:"auto",background:"#1f2937"}}>
                  {EMOJIS.map(e=><button key={e} onClick={()=>insertEmoji(e)} style={{background:"none",border:"none",fontSize:18,cursor:"pointer",padding:"3px 4px",borderRadius:4,lineHeight:1}}>{e}</button>)}
                </div>
              )}
              <div style={{padding:"8px 10px",borderTop:"1px solid rgba(255,255,255,0.07)",display:"flex",gap:5,alignItems:"flex-end"}}>
                <button onClick={()=>fileInputRef.current?.click()} style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:7,padding:"7px 8px",color:"#9ca3af",cursor:"pointer",flexShrink:0,display:"flex"}}>
                  <svg style={{width:13,height:13}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
                </button>
                <input ref={fileInputRef} type="file" style={{display:"none"}} onChange={e=>{sendFile(e.target.files[0]);e.target.value="";}}/>
                <button onClick={()=>setShowEmoji(v=>!v)} style={{background:showEmoji?"rgba(30,58,138,0.4)":"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:7,padding:"7px 8px",cursor:"pointer",flexShrink:0,fontSize:14}}>😊</button>
                <textarea ref={textareaRef} value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendText();}}} placeholder="Message… (Enter)" rows={1} style={{flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:7,padding:"7px 10px",color:"#e5e7eb",fontSize:12,resize:"none",outline:"none",fontFamily:"inherit",lineHeight:1.4,maxHeight:80,overflowY:"auto"}}/>
                <button onClick={sendText} disabled={!chatInput.trim()} style={{background:chatInput.trim()?"#1d4ed8":"rgba(255,255,255,0.06)",border:"none",borderRadius:7,padding:"7px 10px",color:"#fff",cursor:chatInput.trim()?"pointer":"default",flexShrink:0,display:"flex",transition:"background 0.15s"}}>
                  <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
                </button>
              </div>
            </div>
          )}
        </div>

        {showSessionDialog&&<SessionInfo socket={socketRef?.current} onEndSession={onEndSession}/>}
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HOME SCREEN
  // ─────────────────────────────────────────────────────────────────────────
  const hs = {
    page:  { height:"100vh", display:"flex", position:"relative", overflow:"hidden", fontFamily:"sans-serif" },
    left:  { flex:1, background:"#0ea5e9", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff" },
    right: { flex:1, background:"#fff", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 },
    field: { width:"75%" },
    label: { fontSize:13, fontWeight:600, color:"#4b5563", display:"block", marginBottom:6 },
    input: { width:"100%", fontSize:20, fontFamily:"monospace", border:"2px solid #e5e7eb", borderRadius:8, padding:"10px 12px", boxSizing:"border-box", outline:"none" },
    btn:   (bg,dis) => ({ width:"100%", padding:13, borderRadius:8, border:"none", background:dis?"#9ca3af":bg, color:"#fff", fontSize:15, fontWeight:700, cursor:dis?"not-allowed":"pointer" }),
  };

  return (
    <div style={hs.page}>

      {/* CLIPBOARD TOAST */}
      {clipToast&&(
        <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",zIndex:300,background:"#1f2937",color:"#fff",fontSize:12,fontWeight:600,borderRadius:8,padding:"8px 16px",boxShadow:"0 4px 16px rgba(0,0,0,0.3)",pointerEvents:"none",whiteSpace:"nowrap"}}>
          {clipToast}
        </div>
      )}

      {/* REJECTION BANNER */}
      {callRejected&&(
        <div style={{position:"fixed",top:20,left:"50%",transform:"translateX(-50%)",zIndex:100,background:"#fee2e2",border:"1px solid #fca5a5",borderRadius:10,padding:"12px 24px",display:"flex",alignItems:"center",gap:10,boxShadow:"0 4px 20px rgba(0,0,0,0.15)"}}>
          <span style={{fontSize:20}}>❌</span>
          <div><div style={{fontWeight:700,color:"#991b1b",fontSize:14}}>Connection Rejected</div><div style={{color:"#b91c1c",fontSize:12}}>The host declined your request.</div></div>
        </div>
      )}

      {/* INCOMING CALL */}
      {incomingCall&&(
        <div style={{position:"fixed",inset:0,zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.6)"}}>
          <div style={{background:"#fff",borderRadius:16,boxShadow:"0 25px 60px rgba(0,0,0,0.4)",width:400,overflow:"hidden"}}>
            <div style={{background:"#0284c7",padding:"24px",color:"#fff"}}>
              <div style={{display:"flex",alignItems:"center",gap:16}}>
                <div style={{width:56,height:56,borderRadius:"50%",background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <svg style={{width:28,height:28}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                </div>
                <div><div style={{fontSize:18,fontWeight:700}}>Incoming Request</div><div style={{fontSize:13,opacity:0.85}}>Someone wants to view your screen</div></div>
              </div>
            </div>
            <div style={{padding:"20px 24px"}}>
              <div style={{fontSize:11,color:"#9ca3af",textTransform:"uppercase",fontWeight:700,letterSpacing:1,marginBottom:8}}>Caller ID</div>
              <div style={{fontSize:24,fontFamily:"monospace",fontWeight:700,background:"#f3f4f6",borderRadius:10,padding:"12px 16px",textAlign:"center",border:"1px solid #e5e7eb",letterSpacing:4}}>{incomingCallerId}</div>
              <p style={{fontSize:12,color:"#6b7280",textAlign:"center",marginTop:12}}>They will see your screen if you accept.</p>
            </div>
            <div style={{padding:"0 24px 24px",display:"flex",gap:12}}>
              <button onClick={rejectCall} style={{flex:1,padding:12,borderRadius:10,border:"2px solid #ef4444",background:"transparent",color:"#ef4444",fontWeight:700,cursor:"pointer",fontSize:14}}>✕ Reject</button>
              <button onClick={acceptCall} style={{flex:1,padding:12,borderRadius:10,border:"none",background:"#22c55e",color:"#fff",fontWeight:700,cursor:"pointer",fontSize:14}}>✓ Accept</button>
            </div>
          </div>
        </div>
      )}

      {/* LEFT BRAND */}
      <div style={hs.left}>
        <div style={{textAlign:"center"}}>
          <img src="/img/deskviewer_logo_transparent.png" style={{width:100,marginBottom:12}} alt="logo" onError={e=>e.target.style.display="none"}/>
          <div style={{fontSize:28,fontWeight:800,letterSpacing:-0.5}}>DeskViewer</div>
          <div style={{fontSize:13,opacity:0.75,marginTop:4}}>Remote Desktop · Version 1.0</div>
        </div>
      </div>

      {/* RIGHT CONNECT */}
      <div style={hs.right}>
        <div style={hs.field}>
          <label style={hs.label}>Your Connection ID &nbsp;{showCopied&&<span style={{color:"#16a34a",fontWeight:400}}>✓ Copied!</span>}</label>
          <input readOnly value={myId||"Connecting..."} onClick={()=>{navigator.clipboard.writeText(String(myId));setShowCopied(true);}} style={{...hs.input,cursor:"pointer",background:"#f9fafb"}} title="Click to copy"/>
        </div>
        <div style={hs.field}>
          <label style={hs.label}>Remote Connection ID</label>
          <input type="text" placeholder="Enter 10-digit ID" value={remoteId} onChange={e=>setRemoteId(e.target.value.trim())} onKeyDown={e=>e.key==="Enter"&&!connecting&&handleConnect()} style={hs.input}/>
        </div>
        <div style={hs.field}>
          <button onClick={()=>handleConnect()} disabled={connecting} style={hs.btn("#dc2626",connecting)}>
            {connecting?"Waiting for host...":"Connect"}
          </button>
          {connecting&&<p style={{textAlign:"center",fontSize:12,color:"#6b7280",marginTop:8}}>Waiting for the host to accept...</p>}
        </div>

        {/* RECENT CONNECTIONS */}
        {recentList.length>0&&(
          <div style={{...hs.field,marginTop:4}}>
            <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",textTransform:"uppercase",letterSpacing:0.8,marginBottom:8,display:"flex",alignItems:"center",gap:5}}>
              <svg style={{width:11,height:11}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              Recent
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {recentList.map(r=>(
                <div key={r.id} onClick={()=>!connecting&&handleConnect(r.id)} title={`Connect · ${fmtRelTime(r.ts)}`}
                  style={{display:"flex",alignItems:"center",gap:5,background:"#f3f4f6",border:"1.5px solid #e5e7eb",borderRadius:20,padding:"4px 8px 4px 10px",cursor:connecting?"not-allowed":"pointer",fontSize:12,color:"#374151",fontFamily:"monospace",fontWeight:600,opacity:connecting?0.5:1,transition:"all 0.12s"}}
                  onMouseEnter={e=>{if(!connecting)Object.assign(e.currentTarget.style,{background:"#e0f2fe",borderColor:"#0284c7",color:"#0284c7"});}}
                  onMouseLeave={e=>Object.assign(e.currentTarget.style,{background:"#f3f4f6",borderColor:"#e5e7eb",color:"#374151"})}
                >
                  <span>{r.id}</span>
                  <span style={{fontSize:9,color:"#9ca3af",fontFamily:"sans-serif",fontWeight:400}}>{fmtRelTime(r.ts)}</span>
                  <span onClick={e=>handleRemoveRecent(r.id,e)} style={{marginLeft:1,color:"#9ca3af",fontSize:15,lineHeight:1,cursor:"pointer",padding:"0 1px"}} onMouseEnter={e=>e.currentTarget.style.color="#ef4444"} onMouseLeave={e=>e.currentTarget.style.color="#9ca3af"}>×</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionScreen;
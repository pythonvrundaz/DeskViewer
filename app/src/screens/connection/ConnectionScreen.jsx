// // ConnectionScreen.jsx
// import { useEffect, useRef, useState } from "react";
// import Loading from "../../components/Loading";
// import { useNavigate } from "react-router-dom";
// import SessionInfo from "../../components/SessionInfo";
// import { useDispatch, useSelector } from "react-redux";
// import { Peer } from "peerjs";
// import { setRemoteConnectionId, setSessionMode, setSessionStartTime, setShowSessionDialog, setUserConnectionId } from "../../states/connectionSlice";

// const { ipcRenderer } = window.require("electron");

// const ConnectionScreen = ({ callRef, socket }) => {
//   const [remoteConnecting, setRemoteConnecting] = useState(false);
//   const [showCopied, setShowCopied] = useState(false);

//   const navigate = useNavigate();
//   const dispatch = useDispatch();

//   const [userId, setUserId] = useState("");
//   const [remoteId, setRemoteId] = useState("");

//   let sourceId;

//   const peerInstance = useRef(null);

//   const remoteVideoRef = useRef();

//   const showSessionDialog = useSelector(
//     (state) => state.connection.showSessionDialog
//   );

//   const handleCopied = (e) => {
//     navigator.clipboard.writeText(e.target.value);
//     setShowCopied(true);
//   };

//   useEffect(() => {
//     if (showCopied) {
//       setTimeout(() => {
//         setShowCopied(false);
//       }, 2000);
//     }
//   }, [showCopied]);

//   useEffect(() => {
//     const max = 9999999999;
//     const min = 1000000000;
//     const uid = Math.floor(Math.random() * (max - min + 1)) + min;

//     setUserId(uid);
//     dispatch(setUserConnectionId(uid));

//     socket.emit("join", "User" + uid);

//     const peerOptions = {
//       // host: "127.0.0.1",
//       host: "localhost",

//       port: 5000,
//       path: "/peerjs",
//       config: {
//         iceServers: [
//           { url: "stun:stun01.sipphone.com" },
//           { url: "stun:stun.ekiga.net" },
//           { url: "stun:stunserver.org" },
//           { url: "stun:stun.softjoys.com" },
//           { url: "stun:stun.voiparound.com" },
//           { url: "stun:stun.voipbuster.com" },
//           { url: "stun:stun.voipstunt.com" },
//           { url: "stun:stun.voxgratia.org" },
//           { url: "stun:stun.xten.com" },
//           {
//             url: "turn:192.158.29.39:3478?transport=udp",
//             credential: "JZEOEt2V3Qb0y27GRntt2u2PAYA=",
//             username: "28224511:1379330808",
//           },
//           {
//             url: "turn:192.158.29.39:3478?transport=tcp",
//             credential: "JZEOEt2V3Qb0y27GRntt2u2PAYA=",
//             username: "28224511:1379330808",
//           },
//         ],
//       },
//     };
    
//     // FOR CUSTOM SERVER:
//     //  const peer = new Peer(uid,peerOptions);
//     const peer = new Peer(uid, {
//       host: "localhost",
//       port: 5000,
//       path: "/peerjs"
//     }
//   );
//       peer.on("open", (id) => {
//         console.log("PeerJS connected with id:", id);
//       });

//     // const peer = new Peer(uid);

//     // Receive call
//     peer.on("call", (call) => {
//       if (window.confirm("Incoming call from " + call.peer) === true) {
//         console.log("Source Id: " + sourceId);
//         navigator.mediaDevices
//           .getUserMedia({
//             audio: false,
//             video: {
//               mandatory: {
//                 chromeMediaSource: "desktop",
//                 chromeMediaSourceId: sourceId,
//                 minWidth: 1280,
//                 maxWidth: 1280,
//                 minHeight: 720,
//                 maxHeight: 720,
//               },
//             },
//           })
//           .then((mediaStream) => {
//             setRemoteId(call.peer);
//             dispatch(setRemoteConnectionId(call.peer));

//             // Answer call with screen's display data stream
//             call.answer(mediaStream);
//             dispatch(setSessionMode(0));
//             dispatch(setSessionStartTime(new Date()));
//             dispatch(setShowSessionDialog(true));

//             // FOR PLAYING AUDIO OF REMOTE
//             call.on("stream", function (remoteStream) {
//               remoteVideoRef.current.srcObject = remoteStream;
//               remoteVideoRef.current.play();
//             });
//           })
//           .catch((e) => console.log("Error: " + e));
//       }
//     });

//     ipcRenderer.on("SET_SOURCE", async (event, id) => {
//       console.log("Source Id Recieved: " + id);
//       sourceId = id;
//     });

//     peerInstance.current = peer;
//   }, []);

//   const connect = () => {
//     console.log(`Id: ${userId}\nRemote: ${remoteId}`);

//     if (!remoteId || remoteId.length < 10) {
//       alert("Invalid Remote ID");
//       return;
//     } else if (!remoteId.match(/^\d+$/)) {
//       alert("Remote ID cannot be a string");
//       return;
//     } else if (parseInt(remoteId) === parseInt(userId)) {
//       alert("User ID and Remote ID cannot be same");
//       return;
//     }

//     setRemoteConnecting(true);

//     // Do not share your video and audio if you are connecting to remote
//     navigator.mediaDevices
//       .getUserMedia({ video: true, audio: true })
//       .then((mediaStream) => {
//         // Make call to remote
//         const call = peerInstance.current.call(remoteId, mediaStream);

//         callRef.current = call;
//         navigate("/app");
//       })
//       .catch((e) => console.log("Error: " + e));
//   };

//   return (
//     <div className="h-screen flex">
//       <div className="bg-sky-500 text-white basis-1/2 flex items-center justify-center">
//         <div className="w-1/2 flex flex-col items-center justify-center">
//           <img
//             src="/img/deskviewer_logo_transparent.png"
//             className="w-1/2"
//             alt="logo"
//           />
//           <div className="font-semibold text-3xl mt-4">DeskViewer</div>
//           <div className="font-regular text-md">Version 1.0</div>
//         </div>
//       </div>
//       <div className="bg-white basis-1/2 flex flex-col items-center justify-center">
//         <div className="w-9/12">
//           <div className="w-full text-md font-regular text-gray-700">
//             Your Connection Id
//             {showCopied && (
//               <span className="ml-1 text-green-700 text-xs">(Copied)</span>
//             )}
//           </div>
//           <input
//             type="text"
//             placeholder="XXXXXXXXXX"
//             value={userId}
//             readOnly
//             className="w-full text-xl block overflow-hidden rounded-md text-gray-900 border border-gray-200 px-3 py-2 shadow-sm focus:outline-none cursor-pointer"
//             title="Click here to copy"
//             onClick={handleCopied}
//           />
//         </div>

//         <div className="w-9/12 mt-5">
//           <div className="w-full text-md font-regular text-gray-700">
//             Remote Connection Id
//           </div>
//           <input
//             type="text"
//             placeholder="9876543210"
//             className="w-full text-xl block overflow-hidden rounded-md text-gray-900 border border-gray-200 px-3 py-2 shadow-sm focus:outline-none"
//             value={remoteId}
//             onChange={(e) => {
//               setRemoteId(e.target.value);
//               dispatch(setRemoteConnectionId(e.target.value));
//             }}
//           />
//         </div>
//         <div className="w-9/12 mt-6">
//           <button
//             onClick={() => connect()}
//             disabled={remoteConnecting}
//             className="w-full flex items-center justify-center text-center rounded border border-red-600 bg-red-600 px-12 py-3 text-sm font-medium text-white enabled:hover:bg-red-500 enabled:cursor-pointer focus:outline-none disabled:bg-gray-400 disabled:border-gray-400"
//           >
//             <span className={remoteConnecting ? "mr-2" : ""}>
//               {remoteConnecting ? "Connecting" : "Connect"}
//             </span>
//             {remoteConnecting && <Loading />}
//           </button>
//         </div>
//       </div>
//       <div className="hidden">
//         <video ref={remoteVideoRef} />
//       </div>

//       {showSessionDialog && <SessionInfo socket={socket} />}
//     </div>
//   );
// };

// export default ConnectionScreen;

// ---------------------------------------------------------------------------------------------------------------------------------
// ConnectionScreen.jsx
import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import SessionInfo from "../../components/SessionInfo";
import CONFIG from "../../config";

// ── helpers (same as AppScreen) ───────────────────────────────────────────────
const fmtSize = (b) => {
  if (b < 1024)       return b + " B";
  if (b < 1024*1024)  return (b/1024).toFixed(1) + " KB";
  return (b/1024/1024).toFixed(1) + " MB";
};
const isImage = (t="") => t.startsWith("image/");
const msgId   = () => Math.random().toString(36).slice(2);

// ─────────────────────────────────────────────────────────────────────────────
const ConnectionScreen = ({
  myId, socketRef, remoteIdRef, userIdRef,
  incomingCall, incomingCallerId, acceptCall, rejectCall,
  startCall, onEndSession, callRejected,
}) => {
  const dispatch = useDispatch();
  const [remoteId,   setRemoteId]   = useState("");
  const [showCopied, setShowCopied] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const showSessionDialog = useSelector((s) => s.connection.showSessionDialog);
  const sessionMode       = useSelector((s) => s.connection.sessionMode); // 0 = hosting

  // chat state
  const [showChat,  setShowChat]  = useState(false);
  const [messages,  setMessages]  = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [unread,    setUnread]    = useState(0);
  const chatEndRef   = useRef(null);
  const fileInputRef = useRef(null);

  // ── misc effects ───────────────────────────────────────────────────────────
  useEffect(() => { if (callRejected) setConnecting(false); }, [callRejected]);
  useEffect(() => {
    if (showCopied) { const t = setTimeout(() => setShowCopied(false), 2000); return () => clearTimeout(t); }
  }, [showCopied]);

  // ── receive chat messages ──────────────────────────────────────────────────
  useEffect(() => {
    const socket = socketRef?.current;
    if (!socket) return;
    const onMsg = (msg) => {
      setMessages(prev => [...prev, msg]);
      if (!showChat) setUnread(prev => prev + 1);
    };
    socket.on("chat-message", onMsg);
    return () => socket.off("chat-message", onMsg);
  }, [showChat, socketRef]);

  // auto-scroll
  useEffect(() => {
    if (showChat) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, showChat]);

  const toggleChat = () => { setShowChat(v => { if (!v) setUnread(0); return !v; }); };

  // ── send text ──────────────────────────────────────────────────────────────
  const sendText = () => {
    const text = chatInput.trim();
    if (!text) return;
    const socket   = socketRef?.current;
    const remoteId = String(remoteIdRef?.current || "");
    const uid      = String(userIdRef?.current   || "");
    if (!socket?.connected || !remoteId) return;
    const msg = { id: msgId(), from: "me", fromId: uid, text, ts: Date.now() };
    setMessages(prev => [...prev, msg]);
    socket.emit("chat-message", { remoteId, msg: { ...msg, from: "them" } });
    setChatInput("");
  };

  // ── send file ──────────────────────────────────────────────────────────────
  const sendFile = async (file) => {
    if (!file) return;
    const socket   = socketRef?.current;
    const remoteId = String(remoteIdRef?.current || "");
    const uid      = String(userIdRef?.current   || "");
    if (!socket?.connected || !remoteId) return;
    setUploading(true);
    try {
      const fd = new FormData();
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

  const handleConnect = () => {
    if (!remoteId || remoteId.length < 10) { alert("Remote ID must be 10 digits"); return; }
    if (!remoteId.match(/^\d+$/))           { alert("Remote ID must be numeric"); return; }
    if (remoteId === String(myId))          { alert("Cannot connect to yourself"); return; }
    setConnecting(true);
    startCall(remoteId);
  };

  // ── Chat bubble ────────────────────────────────────────────────────────────
  const Bubble = ({ msg }) => {
    const mine = msg.from === "me";
    const base = CONFIG.SOCKET_URL.replace(/\/$/, "");
    return (
      <div style={{ display:"flex", justifyContent: mine?"flex-end":"flex-start", marginBottom:6 }}>
        <div style={{
          maxWidth:"75%",
          borderRadius: mine?"12px 12px 2px 12px":"12px 12px 12px 2px",
          background: mine?"#0284c7":"#f3f4f6",
          padding: msg.file?"6px":"8px 12px",
          boxShadow:"0 1px 3px rgba(0,0,0,0.08)",
        }}>
          {msg.text && (
            <p style={{ margin:0, color: mine?"#fff":"#111827", fontSize:13, wordBreak:"break-word" }}>{msg.text}</p>
          )}
          {msg.file && isImage(msg.file.type) && (
            <a href={base+msg.file.url} target="_blank" rel="noreferrer">
              <img src={base+msg.file.url} alt={msg.file.name}
                style={{ maxWidth:200, maxHeight:150, borderRadius:8, display:"block" }} />
            </a>
          )}
          {msg.file && !isImage(msg.file.type) && (
            <a href={base+msg.file.url} target="_blank" rel="noreferrer"
              style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", textDecoration:"none" }}>
              <svg style={{width:20,height:20,flexShrink:0,color: mine?"#bfdbfe":"#6b7280"}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              <div>
                <div style={{ color: mine?"#e0f2fe":"#111827", fontSize:12, fontWeight:600, wordBreak:"break-all" }}>{msg.file.name}</div>
                <div style={{ color: mine?"rgba(255,255,255,0.55)":"#6b7280", fontSize:10 }}>{fmtSize(msg.file.size)}</div>
              </div>
            </a>
          )}
          <div style={{ fontSize:10, marginTop:3, textAlign:"right",
            color: mine?"rgba(255,255,255,0.5)":"#9ca3af",
            paddingRight: msg.file ? 6 : 0 }}>
            {new Date(msg.ts).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}
          </div>
        </div>
      </div>
    );
  };

  // ── styles ─────────────────────────────────────────────────────────────────
  const s = {
    page:  { height:"100vh", display:"flex", position:"relative", overflow:"hidden", fontFamily:"sans-serif" },
    left:  { flex:1, background:"#0ea5e9", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff" },
    right: { flex:1, background:"#fff", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20 },
    field: { width:"75%" },
    label: { fontSize:13, fontWeight:600, color:"#4b5563", display:"block", marginBottom:6 },
    input: { width:"100%", fontSize:20, fontFamily:"monospace", border:"2px solid #e5e7eb", borderRadius:8, padding:"10px 12px", boxSizing:"border-box", outline:"none" },
    btn:   (bg, disabled) => ({ width:"100%", padding:13, borderRadius:8, border:"none", background:disabled?"#9ca3af":bg, color:"#fff", fontSize:15, fontWeight:700, cursor:disabled?"not-allowed":"pointer" }),
  };

  // only show chat button when a session is active (host is sharing)
  const sessionActive = showSessionDialog;

  return (
    <div style={s.page}>

      {/* REJECTION BANNER */}
      {callRejected && (
        <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", zIndex:100,
          background:"#fee2e2", border:"1px solid #fca5a5", borderRadius:10, padding:"12px 24px",
          display:"flex", alignItems:"center", gap:10, boxShadow:"0 4px 20px rgba(0,0,0,0.15)" }}>
          <span style={{ fontSize:20 }}>❌</span>
          <div>
            <div style={{ fontWeight:700, color:"#991b1b", fontSize:14 }}>Connection Rejected</div>
            <div style={{ color:"#b91c1c", fontSize:12 }}>The host declined your request.</div>
          </div>
        </div>
      )}

      {/* INCOMING CALL */}
      {incomingCall && (
        <div style={{ position:"fixed", inset:0, zIndex:50, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.6)" }}>
          <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 25px 60px rgba(0,0,0,0.4)", width:400, overflow:"hidden" }}>
            <div style={{ background:"#0284c7", padding:"24px", color:"#fff" }}>
              <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                <div style={{ width:56, height:56, borderRadius:"50%", background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <svg style={{ width:28, height:28 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize:18, fontWeight:700 }}>Incoming Request</div>
                  <div style={{ fontSize:13, opacity:0.85 }}>Someone wants to view your screen</div>
                </div>
              </div>
            </div>
            <div style={{ padding:"20px 24px" }}>
              <div style={{ fontSize:11, color:"#9ca3af", textTransform:"uppercase", fontWeight:700, letterSpacing:1, marginBottom:8 }}>Caller ID</div>
              <div style={{ fontSize:24, fontFamily:"monospace", fontWeight:700, background:"#f3f4f6", borderRadius:10, padding:"12px 16px", textAlign:"center", border:"1px solid #e5e7eb", letterSpacing:4 }}>
                {incomingCallerId}
              </div>
              <p style={{ fontSize:12, color:"#6b7280", textAlign:"center", marginTop:12 }}>They will see your screen if you accept.</p>
            </div>
            <div style={{ padding:"0 24px 24px", display:"flex", gap:12 }}>
              <button onClick={rejectCall} style={{ flex:1, padding:12, borderRadius:10, border:"2px solid #ef4444", background:"transparent", color:"#ef4444", fontWeight:700, cursor:"pointer", fontSize:14 }}>✕ Reject</button>
              <button onClick={acceptCall} style={{ flex:1, padding:12, borderRadius:10, border:"none", background:"#22c55e", color:"#fff", fontWeight:700, cursor:"pointer", fontSize:14 }}>✓ Accept</button>
            </div>
          </div>
        </div>
      )}

      {/* LEFT brand panel */}
      <div style={s.left}>
        <div style={{ textAlign:"center" }}>
          <img src="/img/deskviewer_logo_transparent.png" style={{ width:100, marginBottom:12 }} alt="logo" onError={(e) => e.target.style.display="none"} />
          <div style={{ fontSize:28, fontWeight:800, letterSpacing:-0.5 }}>DeskViewer</div>
          <div style={{ fontSize:13, opacity:0.75, marginTop:4 }}>Remote Desktop · Version 1.0</div>
        </div>
      </div>

      {/* RIGHT connect panel */}
      <div style={s.right}>
        <div style={s.field}>
          <label style={s.label}>
            Your Connection ID &nbsp;
            {showCopied && <span style={{ color:"#16a34a", fontWeight:400 }}>✓ Copied!</span>}
          </label>
          <input readOnly value={myId||"Connecting..."}
            onClick={() => { navigator.clipboard.writeText(String(myId)); setShowCopied(true); }}
            style={{ ...s.input, cursor:"pointer", background:"#f9fafb" }} title="Click to copy" />
        </div>
        <div style={s.field}>
          <label style={s.label}>Remote Connection ID</label>
          <input type="text" placeholder="Enter 10-digit ID"
            value={remoteId} onChange={(e) => setRemoteId(e.target.value.trim())}
            onKeyDown={(e) => e.key==="Enter" && !connecting && handleConnect()}
            style={s.input} />
        </div>
        <div style={s.field}>
          <button onClick={handleConnect} disabled={connecting} style={s.btn("#dc2626", connecting)}>
            {connecting ? "Waiting for host..." : "Connect"}
          </button>
          {connecting && <p style={{ textAlign:"center", fontSize:12, color:"#6b7280", marginTop:8 }}>Waiting for the host to accept...</p>}
        </div>
      </div>

      {/* SESSION INFO MODAL */}
      {showSessionDialog && <SessionInfo socket={socketRef?.current} onEndSession={onEndSession} />}

      {/* ── CHAT BUTTON (floating, only when session active) ────────────────── */}
      {sessionActive && (
        <button
          onClick={toggleChat}
          title="Chat"
          style={{
            position:"fixed", bottom:24, right: showChat ? 324 : 24,
            width:48, height:48, borderRadius:"50%",
            background:"#0284c7", border:"none",
            boxShadow:"0 4px 16px rgba(0,0,0,0.25)",
            color:"#fff", cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
            transition:"right 0.25s ease", zIndex:200,
          }}
        >
          <svg style={{width:20,height:20}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
          </svg>
          {unread > 0 && (
            <span style={{
              position:"absolute", top:-3, right:-3,
              background:"#ef4444", color:"#fff", fontSize:9, fontWeight:700,
              borderRadius:"50%", width:16, height:16,
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>{unread > 9 ? "9+" : unread}</span>
          )}
        </button>
      )}

      {/* ── CHAT PANEL (slides in from right) ───────────────────────────────── */}
      {showChat && (
        <div style={{
          position:"fixed", right:0, top:0, bottom:0, width:300, zIndex:199,
          display:"flex", flexDirection:"column",
          background:"#fff", borderLeft:"1px solid #e5e7eb",
          boxShadow:"-4px 0 20px rgba(0,0,0,0.1)",
        }}>
          {/* header */}
          <div style={{ padding:"12px 16px", borderBottom:"1px solid #e5e7eb", display:"flex", alignItems:"center", justifyContent:"space-between", background:"#f9fafb" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:7, height:7, borderRadius:"50%", background:"#22c55e", boxShadow:"0 0 5px #22c55e" }}/>
              <span style={{ fontSize:14, fontWeight:700, color:"#111827" }}>Chat</span>
            </div>
            <button onClick={toggleChat} style={{ background:"none", border:"none", color:"#6b7280", cursor:"pointer", padding:4, borderRadius:6 }}>
              <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          {/* messages */}
          <div style={{ flex:1, overflowY:"auto", padding:"12px 10px 4px", display:"flex", flexDirection:"column" }}>
            {messages.length === 0 && (
              <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:"#9ca3af" }}>
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

          {uploading && (
            <div style={{ padding:"4px 14px", color:"#0284c7", fontSize:11, display:"flex", alignItems:"center", gap:6 }}>
              <svg style={{width:11,height:11}} viewBox="0 0 24 24" fill="none">
                <circle style={{opacity:0.25}} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path style={{opacity:0.75}} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Uploading...
            </div>
          )}

          {/* input */}
          <div style={{ padding:"8px 10px", borderTop:"1px solid #e5e7eb", display:"flex", gap:6, alignItems:"flex-end", background:"#f9fafb" }}>
            <button onClick={() => fileInputRef.current?.click()} title="Attach file"
              style={{ background:"#fff", border:"1px solid #d1d5db", borderRadius:7, padding:"7px 8px", color:"#6b7280", cursor:"pointer", flexShrink:0, display:"flex", alignItems:"center" }}>
              <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/>
              </svg>
            </button>
            <input ref={fileInputRef} type="file" style={{ display:"none" }}
              onChange={(e) => { sendFile(e.target.files[0]); e.target.value=""; }} />

            <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); sendText(); } }}
              placeholder="Message… (Enter to send)"
              rows={1}
              style={{ flex:1, background:"#fff", border:"1px solid #d1d5db", borderRadius:7, padding:"7px 10px", color:"#111827", fontSize:12, resize:"none", outline:"none", fontFamily:"inherit", lineHeight:1.4, maxHeight:80, overflowY:"auto" }}
            />

            <button onClick={sendText} disabled={!chatInput.trim()}
              style={{ background:chatInput.trim()?"#0284c7":"#e5e7eb", border:"none", borderRadius:7, padding:"7px 10px", color:chatInput.trim()?"#fff":"#9ca3af", cursor:chatInput.trim()?"pointer":"default", flexShrink:0, display:"flex", alignItems:"center", transition:"background 0.15s" }}>
              <svg style={{width:14,height:14}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConnectionScreen;
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
  const screenSizeRef = useRef({ width: 1920, height: 1080 });
  const controlRef    = useRef(false);

  const showSessionDialog = useSelector((s) => s.connection.showSessionDialog);
  const userId = useSelector((s) => s.connection.userConnectionId);

  const [videoPlaying,   setVideoPlaying]   = useState(false);
  const [controlEnabled, setControlEnabled] = useState(false);
  const [muted,          setMuted]          = useState(false);
  const [showToolbar,    setShowToolbar]     = useState(true);
  const toolbarTimerRef = useRef(null);

  useEffect(() => {
    ipcRenderer.invoke("GET_SCREEN_SIZE").then((size) => {
      if (size) { screenSizeRef.current = size; console.log("Host screen:", size); }
    });
  }, []);

  const attachStream = useCallback((stream) => {
    if (!stream || !videoRef.current) return;
    const video = videoRef.current;
    video.srcObject = stream;
    video.muted = false;
    video.play()
      .then(() => setVideoPlaying(true))
      .catch(() => setTimeout(() => video.play().then(() => setVideoPlaying(true)).catch(console.error), 600));
  }, []);

  useEffect(() => { if (remoteStream)             attachStream(remoteStream);            }, [remoteStream]);
  useEffect(() => { if (remoteStreamRef?.current)  attachStream(remoteStreamRef.current); }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (videoRef.current) videoRef.current.muted = next;
  };

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

  const getScaledCoords = (e) => {
    const video = videoRef.current;
    if (!video) return { x: 0, y: 0 };
    const rect        = video.getBoundingClientRect();
    const hostW       = screenSizeRef.current.width;
    const hostH       = screenSizeRef.current.height;
    const videoAspect = hostW / hostH;
    const elemAspect  = rect.width / rect.height;
    let renderW, renderH, offsetX, offsetY;
    if (videoAspect > elemAspect) {
      renderW = rect.width; renderH = rect.width / videoAspect;
      offsetX = 0;          offsetY = (rect.height - renderH) / 2;
    } else {
      renderH = rect.height; renderW = rect.height * videoAspect;
      offsetY = 0;           offsetX = (rect.width - renderW) / 2;
    }
    const relX = Math.max(0, Math.min(e.clientX - rect.left - offsetX, renderW));
    const relY = Math.max(0, Math.min(e.clientY - rect.top  - offsetY, renderH));
    return {
      x: Math.round((relX / renderW) * hostW),
      y: Math.round((relY / renderH) * hostH),
    };
  };

  // ── Attach ALL listeners ONCE on mount ───────────────────────────────────────
  // Use refs for everything — zero stale closure issues
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Direct emit — reads refs at call time, never stale
    const emit = (eventName, data) => {
      const socket   = socketRef.current;
      const remoteId = String(remoteIdRef.current || "");
      const uid      = String(userId || "");

      // DEBUG — log every attempted emit
      console.log(`emit [${eventName}]`, { remoteId, uid, connected: socket?.connected, data });

      if (!socket?.connected) { console.warn("Socket not connected!"); return; }
      if (!remoteId)          { console.warn("remoteId is empty!");    return; }
      if (!uid)               { console.warn("userId is empty!");      return; }

      socket.emit(eventName, { userId: uid, remoteId, event: data });
    };

    const onMouseMove = (e) => {
      if (!controlRef.current) return;
      mousePosRef.current = getScaledCoords(e);
    };

    const onMouseDown = (e) => {
      if (!controlRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const coords = getScaledCoords(e);
      console.log("🖱️ MOUSEDOWN at", coords);
      emit("click",     { button: e.button, ...coords });
      emit("mousedown", { button: e.button, ...coords });
    };

    const onMouseUp = (e) => {
      if (!controlRef.current) return;
      emit("mouseup", { button: e.button, ...getScaledCoords(e) });
    };

    const onDblClick = (e) => {
      if (!controlRef.current) return;
      e.preventDefault();
      emit("dblclick", getScaledCoords(e));
    };

    const onWheel = (e) => {
      if (!controlRef.current) return;
      e.preventDefault();
      emit("scroll", { scroll: e.deltaY, ...getScaledCoords(e) });
    };

    const onKeyDown = (e) => {
      if (!controlRef.current) return;
      if (e.ctrlKey && e.shiftKey && e.key === "I") return;
      if (e.key === "Escape") {
        controlRef.current = false;
        setControlEnabled(false);
        if (video) video.style.cursor = "default";
        return;
      }
      e.preventDefault();
      console.log("⌨️ KEYDOWN:", e.key);
      emit("keydown", { keyCode: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
    };

    const onKeyUp = (e) => {
      if (!controlRef.current) return;
      emit("keyup", { keyCode: e.key });
    };

    // Throttled mousemove at ~30fps
    const interval = setInterval(() => {
      if (controlRef.current && mousePosRef.current) {
        const socket   = socketRef.current;
        const remoteId = String(remoteIdRef.current || "");
        const uid      = String(userId || "");
        if (socket?.connected && remoteId && uid) {
          socket.emit("mousemove", { userId: uid, remoteId, event: mousePosRef.current });
        }
        mousePosRef.current = null;
      }
    }, 33);

    video.addEventListener("mousemove", onMouseMove);
    video.addEventListener("mousedown", onMouseDown);
    video.addEventListener("mouseup",   onMouseUp);
    video.addEventListener("dblclick",  onDblClick);
    video.addEventListener("wheel",     onWheel,   { passive: false });
    window.addEventListener("keydown",  onKeyDown);
    window.addEventListener("keyup",    onKeyUp);

    return () => {
      clearInterval(interval);
      video.removeEventListener("mousemove", onMouseMove);
      video.removeEventListener("mousedown", onMouseDown);
      video.removeEventListener("mouseup",   onMouseUp);
      video.removeEventListener("dblclick",  onDblClick);
      video.removeEventListener("wheel",     onWheel);
      window.removeEventListener("keydown",  onKeyDown);
      window.removeEventListener("keyup",    onKeyUp);
    };
  }, []); // ← empty deps — attach once, forever. Refs handle fresh values.

  const toggleControl = () => {
    const next = !controlRef.current;
    controlRef.current = next;
    setControlEnabled(next);
    if (videoRef.current) videoRef.current.style.cursor = next ? "crosshair" : "default";

    // DEBUG on toggle
    console.log("🎮 Control toggled:", next ? "ON" : "OFF");
    console.log("   remoteIdRef:", remoteIdRef.current);
    console.log("   userId:", userId);
    console.log("   socket connected:", socketRef.current?.connected);
  };

  const handleDisconnect = () => {
    if (!window.confirm("End this session?")) return;
    const rid = remoteIdRef?.current;
    if (socketRef.current && rid) socketRef.current.emit("remotedisconnected", { remoteId: rid });
    if (callRef.current) { callRef.current.close(); callRef.current = null; }
    onDisconnect();
  };

  const btn = (bg, active) => ({
    display: "flex", alignItems: "center", gap: 6,
    padding: "7px 14px", borderRadius: 8,
    background: bg, border: active ? "2px solid rgba(255,255,255,0.8)" : "2px solid transparent",
    color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
  });

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#000", position: "relative", overflow: "hidden" }}>

      <video ref={videoRef} autoPlay playsInline
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
      />

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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 8px #4ade80" }} />
            <span style={{ color: "#fff", fontSize: 13, fontWeight: 500 }}>Connected · {remoteIdRef.current}</span>
            {controlEnabled && (
              <span style={{ background: "#dc2626", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4 }}>
                CONTROL ACTIVE
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={toggleMute} style={btn(muted ? "#4b5563" : "#0369a1", false)}>
              {muted
                ? <svg style={{width:15,height:15}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/></svg>
                : <svg style={{width:15,height:15}} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z"/></svg>
              }
              {muted ? "Unmute" : "Mute"}
            </button>

            <button onClick={toggleControl} style={btn(controlEnabled ? "#b91c1c" : "#7c3aed", controlEnabled)}>
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

      {controlEnabled && videoPlaying && (
        <div style={{
          position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
          background: "rgba(185,28,28,0.92)", color: "#fff",
          padding: "7px 20px", borderRadius: 20, fontSize: 12, fontWeight: 600,
          zIndex: 20, display: "flex", alignItems: "center", gap: 8, pointerEvents: "none",
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
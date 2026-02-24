// // SessionInfo.jsx
// import React, { useEffect, useState } from "react";
// import { BsFillCheckCircleFill } from "react-icons/bs";
// import { useDispatch, useSelector } from "react-redux";
// import { setShowSessionDialog } from "../states/connectionSlice";
// import moment from "moment";
// import { useNavigate } from "react-router-dom";

// const SessionInfo = ({ socket }) => {
//   const dispatch = useDispatch();
//   const navigate = useNavigate();

//   const userId = useSelector((state) => state.connection.userConnectionId);
//   const remoteId = useSelector((state) => state.connection.remoteConnectionId);
//   const sessionStart = useSelector(
//     (state) => state.connection.sessionStartTime
//   );

//   const sessionMode = useSelector((state) => state.connection.sessionMode);

//   const [timeElapsed, setTimeElapsed] = useState(false);

//   const formatNumber = (num) => {
//     if (num < 10) {
//       return "0" + num;
//     } else {
//       return num;
//     }
//   };

//   const closeSession = () => {
//     if (window.confirm("Are you sure you want to end this session")) {
//       dispatch(setShowSessionDialog(false));
//       socket.emit("remotedisconnected", { remoteId: remoteId });
//       if (sessionMode === 1) {
//         navigate("/");
//       }
//       window.location.reload();
//     }
//   };

//   useEffect(() => {
//     const interval = setInterval(() => {
//       const duration = moment.duration(
//         moment(new Date()).diff(moment(sessionStart))
//       );
//       const seconds = formatNumber(duration.seconds());
//       const minutes = formatNumber(duration.minutes());
//       const hours = formatNumber(duration.hours());

//       const timeDiff = `${hours}:${minutes}:${seconds}`;
//       setTimeElapsed(timeDiff);
//     }, 1000);
//     return () => clearTimeout(interval);
//   }, []);

//   return (
//     <div
//       onClick={(e) => {
//         e.preventDefault();

//         if (sessionMode === 0) {
//           return;
//         }

//         if (e.target === e.currentTarget) {
//           dispatch(setShowSessionDialog(false));
//         }
//       }}
//       className="fixed flex items-center justify-center inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full"
//     >
//       <div className="w-1/2 bg-white rounded-sm">
//         <div className=" bg-green-600 text-white text-7xl py-7 flex flex-col items-center justify-center">
//           <BsFillCheckCircleFill />
//           <div className="text-2xl font-bold mt-4">Session Started</div>
//         </div>

//         <div className="px-5">
//           <div className="overflow-x-auto mt-4">
//             <table className="min-w-full divide-y-2 divide-gray-200 text-sm">
//               <tbody className="divide-y divide-gray-200 text-center">
//                 <tr>
//                   <td className="whitespace-nowrap px-4 py-2 font-medium text-gray-900">
//                     User Connection Id
//                   </td>
//                   <td className="whitespace-nowrap px-4 py-2 text-gray-700">
//                     {userId}
//                   </td>
//                 </tr>

//                 <tr>
//                   <td className="whitespace-nowrap px-4 py-2 font-medium text-gray-900">
//                     Remote Connection Id
//                   </td>
//                   <td className="whitespace-nowrap px-4 py-2 text-gray-700">
//                     {remoteId}
//                   </td>
//                 </tr>

//                 <tr>
//                   <td className="whitespace-nowrap px-4 py-2 font-medium text-gray-900">
//                     Session Started
//                   </td>
//                   <td className="whitespace-nowrap px-4 py-2 text-gray-700">
//                     {moment(sessionStart).format("MMMM Do, h:mm:ss a")}
//                   </td>
//                 </tr>

//                 <tr>
//                   <td className="whitespace-nowrap px-4 py-2 font-medium text-gray-900">
//                     Time Elapsed
//                   </td>
//                   <td className="whitespace-nowrap px-4 py-2 text-gray-700">
//                     {timeElapsed}
//                   </td>
//                 </tr>
//               </tbody>
//             </table>
//           </div>
//           <div className="flex items-center justify-end my-4">
//             <button
//               onClick={() => closeSession()}
//               className="inline-block rounded border border-red-600 bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-500 focus:outline-none "
//             >
//               End Session
//             </button>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default SessionInfo;

// ---------------------------------------------------------------------------------------------------------------------------------


// SessionInfo.jsx — FIXED: removed useNavigate (not inside Router anymore)
import React, { useEffect, useState } from "react";
import { BsFillCheckCircleFill } from "react-icons/bs";
import { useDispatch, useSelector } from "react-redux";
import { setShowSessionDialog } from "../states/connectionSlice";
import moment from "moment";

const SessionInfo = ({ socket, onEndSession }) => {
  const dispatch = useDispatch();

  const userId       = useSelector((s) => s.connection.userConnectionId);
  const remoteId     = useSelector((s) => s.connection.remoteConnectionId);
  const sessionStart = useSelector((s) => s.connection.sessionStartTime);
  const sessionMode  = useSelector((s) => s.connection.sessionMode);

  const [timeElapsed, setTimeElapsed] = useState("00:00:00");

  const fmt = (n) => String(n).padStart(2, "0");

  useEffect(() => {
    const interval = setInterval(() => {
      const d = moment.duration(moment().diff(moment(sessionStart)));
      setTimeElapsed(`${fmt(d.hours())}:${fmt(d.minutes())}:${fmt(d.seconds())}`);
    }, 1000);
    return () => clearInterval(interval); // FIX: clearInterval not clearTimeout
  }, [sessionStart]);

  const closeSession = () => {
    if (!window.confirm("Are you sure you want to end this session?")) return;
    if (socket && remoteId) socket.emit("remotedisconnected", { remoteId });
    dispatch(setShowSessionDialog(false));
    // Instead of useNavigate, call the callback passed from App.js
    if (onEndSession) onEndSession();
  };

  return (
    <div
      onClick={(e) => {
        // Host (mode 0): backdrop click does nothing — dialog is permanent
        if (sessionMode === 0) return;
        // Viewer (mode 1): can dismiss by clicking backdrop
        if (e.target === e.currentTarget) dispatch(setShowSessionDialog(false));
      }}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(75,85,99,0.5)",
      }}
    >
      <div style={{ width: "460px", background: "#fff", borderRadius: 8, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>

        {/* Header */}
        <div style={{ background: "#16a34a", color: "#fff", padding: "28px 24px", textAlign: "center" }}>
          <BsFillCheckCircleFill style={{ fontSize: 56, margin: "0 auto 12px" }} />
          <div style={{ fontSize: 22, fontWeight: 700 }}>Session Active</div>
          <div style={{ fontSize: 14, opacity: 0.85, marginTop: 4 }}>
            {sessionMode === 0 ? "You are sharing your screen" : "You are viewing a remote screen"}
          </div>
        </div>

        {/* Info table */}
        <div style={{ padding: "0 20px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginTop: 12 }}>
            <tbody>
              {[
                ["Your ID",        <span style={{ fontFamily: "monospace" }}>{userId}</span>],
                ["Remote ID",      <span style={{ fontFamily: "monospace" }}>{remoteId}</span>],
                ["Started",        moment(sessionStart).format("MMM Do, h:mm:ss a")],
                ["Time Elapsed",   <span style={{ fontFamily: "monospace", fontSize: 16 }}>{timeElapsed}</span>],
                ["Mode",           sessionMode === 0 ? "🖥️ Hosting" : "👁️ Viewing"],
              ].map(([label, value]) => (
                <tr key={label} style={{ borderBottom: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600, color: "#111827", whiteSpace: "nowrap" }}>{label}</td>
                  <td style={{ padding: "10px 12px", color: "#374151", textAlign: "right" }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 20px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          {sessionMode === 1 && (
            <button
              onClick={() => dispatch(setShowSessionDialog(false))}
              style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", color: "#374151", cursor: "pointer", fontSize: 13 }}
            >
              Minimize
            </button>
          )}
          <button
            onClick={closeSession}
            style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#dc2626", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 }}
          >
            End Session
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionInfo;
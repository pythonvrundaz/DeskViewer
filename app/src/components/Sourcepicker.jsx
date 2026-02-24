// components/SourcePicker.jsx
// Lets the host choose WHICH screen or window to share
// This fixes the infinite mirror — host can pick a specific window instead of full desktop
import React from "react";

const SourcePicker = ({ sources, onSelect, onCancel }) => {
    const screens = sources.filter(s => s.id.startsWith("screen:"));
    const windows = sources.filter(s => s.id.startsWith("window:"));

    return (
        <div style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.75)",
            display: "flex", alignItems: "center", justifyContent: "center",
        }}>
            <div style={{
                background: "#1f2937", borderRadius: 16, padding: 24,
                width: 720, maxHeight: "85vh", overflow: "hidden",
                display: "flex", flexDirection: "column",
                boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <div>
                        <h2 style={{ color: "#fff", fontSize: 20, fontWeight: 700, margin: 0 }}>Choose what to share</h2>
                        <p style={{ color: "#9ca3af", fontSize: 13, margin: "4px 0 0" }}>
                            Pick a screen or window. Tip: pick a specific window to avoid the mirror effect.
                        </p>
                    </div>
                    <button onClick={onCancel} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>✕</button>
                </div>

                <div style={{ overflowY: "auto", flex: 1 }}>
                    {/* Screens */}
                    {screens.length > 0 && (
                        <>
                            <div style={{ color: "#6b7280", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                                Entire Screen
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                                {screens.map((src) => (
                                    <SourceCard key={src.id} src={src} onSelect={onSelect} />
                                ))}
                            </div>
                        </>
                    )}

                    {/* Windows */}
                    {windows.length > 0 && (
                        <>
                            <div style={{ color: "#6b7280", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                                Application Windows
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                                {windows.map((src) => (
                                    <SourceCard key={src.id} src={src} onSelect={onSelect} small />
                                ))}
                            </div>
                        </>
                    )}
                </div>

                <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
                    <button onClick={onCancel} style={{
                        padding: "9px 20px", borderRadius: 8,
                        border: "1px solid #4b5563", background: "transparent",
                        color: "#d1d5db", cursor: "pointer", fontSize: 14,
                    }}>
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

const SourceCard = ({ src, onSelect, small }) => (
    <button
        onClick={() => onSelect(src.id)}
        style={{
            background: "#111827", border: "2px solid #374151",
            borderRadius: 10, padding: 10, cursor: "pointer",
            textAlign: "left", transition: "border-color 0.15s",
            display: "flex", flexDirection: "column", gap: 8,
        }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = "#3b82f6"}
        onMouseLeave={(e) => e.currentTarget.style.borderColor = "#374151"}
    >
        <img
            src={src.thumb}
            alt={src.name}
            style={{
                width: "100%",
                height: small ? 80 : 120,
                objectFit: "cover",
                borderRadius: 6,
                background: "#000",
            }}
        />
        <span style={{
            color: "#e5e7eb", fontSize: small ? 11 : 12,
            fontWeight: 500, overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
            {src.name}
        </span>
    </button>
);

export default SourcePicker;
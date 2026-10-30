import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

// Mêmes couleurs et polices que l'application (public/style.css)
export const C = {
  bg: "#ffffff",
  surface: "#f6f7fb",
  text: "#14161c",
  muted: "#5b6272",
  line: "#d9dde6",
  accent: "#3b2bd6",
  accentSoft: "#eeecff",
  ok: "#12804a",
  okSoft: "#e4f6ec",
  ko: "#c2261b",
  koSoft: "#fdeceb",
};

export const TITLE = loadAnton().fontFamily;
export const SANS = loadMontserrat("normal", { weights: ["400", "500"], subsets: ["latin", "latin-ext"] }).fontFamily;

// La zone du haut (0 à 560 px) reste libre : le montage HyperFrames y pose les titres.
export const SAFE_TOP = 560;

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
export const ease = Easing.bezier(0.22, 1, 0.36, 1);

// Valeur 0 → 1 entre deux images, avec un ralenti de sortie
export const useRamp = (from, to, easing = ease) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, to], [0, 1], { ...clamp, easing });
};

export const useSpring = (delay = 0, config = { damping: 14, stiffness: 160 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config });
};

// Feuille de CV stylisée : barres grises en guise de texte
export const CvSheet = ({ width = 360, tint = "#fff", lineColor = C.line, accent = C.accent, highlight = [], style }) => {
  const h = width * 1.414;
  const rows = [0.62, 0.4, 0.86, 0.78, 0.9, 0.5, 0.82, 0.7, 0.88, 0.6, 0.76];
  return (
    <div
      style={{
        width,
        height: h,
        background: tint,
        borderRadius: width * 0.04,
        boxShadow: "0 18px 50px rgba(20,22,28,0.18)",
        padding: width * 0.09,
        display: "flex",
        flexDirection: "column",
        gap: width * 0.035,
        ...style,
      }}
    >
      <div style={{ display: "flex", gap: width * 0.05, alignItems: "center", marginBottom: width * 0.03 }}>
        <div style={{ width: width * 0.18, height: width * 0.18, borderRadius: "50%", background: accent, opacity: 0.85 }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: width * 0.025 }}>
          <div style={{ height: width * 0.045, width: "70%", background: C.text, borderRadius: 99 }} />
          <div style={{ height: width * 0.03, width: "45%", background: lineColor, borderRadius: 99 }} />
        </div>
      </div>
      {rows.map((w, i) => (
        <div
          key={i}
          style={{
            height: width * (i % 4 === 0 ? 0.04 : 0.026),
            width: `${w * 100}%`,
            borderRadius: 99,
            background: highlight.includes(i) ? C.ok : i % 4 === 0 ? accent : lineColor,
            opacity: i % 4 === 0 ? 0.8 : 1,
          }}
        />
      ))}
    </div>
  );
};

// Petite icône de fichier, reprise de la zone de dépôt de l'application
export const FileIcon = ({ size = 40, color = "currentColor" }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M12 18v-6" />
    <path d="m9 15 3-3 3 3" />
  </svg>
);

export const Check = ({ size = 28, color = "#fff" }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export const Cross = ({ size = 28, color = "#fff" }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

// Anneau de score, comme sur l'écran de résultat
export const ScoreRing = ({ value, size = 420, color = C.accent, label }) => {
  const r = 52;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke={C.line} strokeWidth="9" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          pathLength="100"
          strokeDasharray={`${value} 100`}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: TITLE, fontSize: size * 0.34, lineHeight: 1, color: C.text }}>
          {Math.round(value)}
          <span style={{ fontFamily: SANS, fontSize: size * 0.08, color: C.muted, fontWeight: 500 }}>/100</span>
        </div>
        {label}
      </div>
    </div>
  );
};

export const Badge = ({ children, color, soft, scale = 1 }) => (
  <div
    style={{
      fontFamily: SANS,
      fontWeight: 500,
      fontSize: 40,
      padding: "12px 34px",
      borderRadius: 99,
      color,
      background: soft,
      transform: `scale(${scale})`,
    }}
  >
    {children}
  </div>
);

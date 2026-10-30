import { AbsoluteFill, interpolate, interpolateColors, useCurrentFrame } from "remotion";
import { Badge, C, Check, Cross, CvSheet, FileIcon, SANS, SAFE_TOP, ScoreRing, TITLE, clamp, ease, useRamp, useSpring } from "./theme.jsx";

const Fill = ({ bg = C.bg, children }) => (
  <AbsoluteFill style={{ background: bg, fontFamily: SANS, color: C.text, overflow: "hidden" }}>{children}</AbsoluteFill>
);

// Fond discret : grille de points qui dérive, pour garder du mouvement sur les plans fixes
const Dots = ({ color = "rgba(59,43,214,0.12)", speed = 0.6 }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `radial-gradient(${color} 3px, transparent 3px)`,
        backgroundSize: "56px 56px",
        backgroundPosition: `0 ${-frame * speed}px`,
      }}
    />
  );
};

/* ---------- 1. Les robots trient les CV ---------- */

const BEAM = 1180;

const RejectedCv = ({ x, delay, rot }) => {
  const frame = useCurrentFrame();
  const t = frame - delay;
  const rise = useSpring(delay, { damping: 16, stiffness: 120 });
  const stamp = useSpring(delay + 16, { damping: 9, stiffness: 220 });
  const fall = Math.max(0, t - 26);
  const y = interpolate(rise, [0, 1], [2050, BEAM - 470]) + fall * fall * 1.1;
  const r = rot + fall * (rot > 0 ? 1.4 : -1.4);
  const tint = interpolateColors(Math.min(stamp, 1), [0, 1], ["#ffffff", "#ffe3e0"]);
  if (t < 0) return null;
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: `rotate(${r}deg)` }}>
      <CvSheet width={300} tint={tint} />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "42%",
          width: 130,
          height: 130,
          marginLeft: -65,
          marginTop: -65,
          borderRadius: "50%",
          background: C.ko,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${stamp})`,
          boxShadow: "0 10px 30px rgba(194,38,27,0.45)",
        }}
      >
        <Cross size={70} />
      </div>
    </div>
  );
};

export const SceneRobots = () => {
  const frame = useCurrentFrame();
  const cvs = [
    { x: 80, delay: 0, rot: -6 },
    { x: 700, delay: 10, rot: 7 },
    { x: 390, delay: 20, rot: -3 },
    { x: 120, delay: 42, rot: 5 },
    { x: 660, delay: 52, rot: -8 },
    { x: 390, delay: 64, rot: 4 },
  ];
  // Le faisceau rougit à chaque rejet
  const hits = cvs.map((c) => c.delay + 16);
  const flash = Math.max(...hits.map((h) => interpolate(frame, [h, h + 3, h + 12], [0, 1, 0], clamp)));
  const beamColor = interpolateColors(flash, [0, 1], ["#9d93ff", "#ff5a4e"]);
  const scan = (frame * 14) % 1080;
  return (
    <Fill bg={C.accent}>
      <Dots color="rgba(255,255,255,0.10)" speed={1.2} />
      {cvs.map((c, i) => (
        <RejectedCv key={i} {...c} />
      ))}
      {/* Faisceau de l'ATS */}
      <div style={{ position: "absolute", left: 0, right: 0, top: BEAM, height: 14, background: beamColor, boxShadow: `0 0 ${40 + flash * 60}px ${beamColor}` }} />
      <div style={{ position: "absolute", left: scan - 200, top: BEAM - 4, width: 200, height: 22, background: "linear-gradient(90deg, transparent, #fff)", opacity: 0.8, borderRadius: 99 }} />
      <div
        style={{
          position: "absolute",
          left: 60,
          top: BEAM + 40,
          padding: "14px 30px",
          borderRadius: 16,
          background: "#14161c",
          color: "#fff",
          fontFamily: TITLE,
          fontSize: 56,
          letterSpacing: "0.04em",
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        <span style={{ width: 22, height: 22, borderRadius: "50%", background: beamColor, boxShadow: `0 0 20px ${beamColor}` }} />
        Filtre ATS
      </div>
      {/* Bas de l'écran plus sombre pour faire disparaître les CV qui tombent */}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, transparent 72%, ${C.accent} 96%)` }} />
    </Fill>
  );
};

/* ---------- 2. Dépôt du CV et analyse ---------- */

const Cursor = ({ x, y, press = 0 }) => (
  <svg width="70" height="70" viewBox="0 0 24 24" style={{ position: "absolute", left: x, top: y, transform: `scale(${1 - press * 0.15})`, filter: "drop-shadow(0 4px 8px rgba(0,0,0,.3))" }}>
    <path d="M4 2l16 9-7 2-3 7z" fill="#14161c" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

export const SceneDrop = () => {
  const frame = useCurrentFrame();
  const fly = useRamp(0, 30);
  const over = interpolate(frame, [24, 30], [0, 1], clamp);
  const drop = useSpring(32, { damping: 12, stiffness: 200 });
  const toScan = useRamp(42, 50);
  const zoneScale = 1 + over * 0.03 - drop * 0.03;
  const fileX = interpolate(fly, [0, 1], [900, 390]);
  const fileY = interpolate(fly, [0, 1], [1850, 880]);
  const fileScale = interpolate(drop, [0, 1], [1, 0.2], clamp);
  const steps = ["Lecture du fichier comme un ATS", "Tests de lisibilité", "Mots-clés attendus", "Diagnostic de l'IA"];
  const doneAt = [62, 76, 90, 104];
  const progress = interpolate(frame, [58, 112], [0, 100], clamp);
  return (
    <Fill>
      <Dots />
      {/* Zone de dépôt */}
      <div
        style={{
          position: "absolute",
          left: 110,
          top: SAFE_TOP + 140,
          width: 860,
          height: 700,
          borderRadius: 36,
          border: `5px ${over > 0.5 && drop < 0.5 ? "solid" : "dashed"} ${C.accent}`,
          background: interpolateColors(over, [0, 1], ["#fbfbff", C.accentSoft]),
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 22,
          transform: `scale(${zoneScale})`,
          opacity: 1 - toScan,
        }}
      >
        <div style={{ width: 130, height: 130, borderRadius: "50%", background: C.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", color: C.accent }}>
          <FileIcon size={72} />
        </div>
        <div style={{ fontWeight: 500, fontSize: 52 }}>Glisse ton CV ici</div>
        <div style={{ fontSize: 34, color: C.muted }}>ou</div>
        <div style={{ background: C.accent, color: "#fff", fontWeight: 500, fontSize: 38, padding: "22px 48px", borderRadius: 18 }}>Choisir mon CV</div>
        <div style={{ fontSize: 30, color: C.muted }}>PDF ou Word (.docx)</div>
      </div>
      {/* Fichier glissé avec le curseur */}
      {drop < 0.98 && (
        <div style={{ position: "absolute", left: fileX, top: fileY, transform: `scale(${fileScale}) rotate(${(1 - fly) * 12}deg)`, transformOrigin: "50% 50%" }}>
          <CvSheet width={300} />
          <div style={{ position: "absolute", bottom: -64, left: 0, right: 0, textAlign: "center", fontWeight: 500, fontSize: 30 }}>mon_cv.pdf</div>
          <Cursor x={240} y={300} press={over} />
        </div>
      )}
      {/* Suivi de l'analyse */}
      <div
        style={{
          position: "absolute",
          left: 80,
          top: SAFE_TOP + 120,
          width: 920,
          padding: 56,
          borderRadius: 36,
          background: "#fff",
          boxShadow: "0 30px 80px rgba(20,22,28,0.14)",
          opacity: toScan,
          transform: `translateY(${(1 - toScan) * 80}px)`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontWeight: 500, fontSize: 46 }}>Analyse en cours</div>
          <div style={{ fontSize: 34, color: C.muted }}>{Math.round(progress)} %</div>
        </div>
        <div style={{ height: 18, borderRadius: 99, background: C.surface, margin: "28px 0 40px", overflow: "hidden" }}>
          <div style={{ width: `${progress}%`, height: "100%", background: C.accent, borderRadius: 99 }} />
        </div>
        {steps.map((s, i) => {
          const done = interpolate(frame, [doneAt[i], doneAt[i] + 6], [0, 1], clamp);
          const active = frame >= doneAt[i] - 14 && done < 1;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 28, padding: "18px 0", fontSize: 38, fontWeight: done > 0.5 || active ? 500 : 400, color: done > 0.5 || active ? C.text : C.muted }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  flexShrink: 0,
                  border: `4px solid ${done > 0.5 ? C.ok : active ? C.accent : C.line}`,
                  background: done > 0.5 ? C.ok : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transform: `scale(${1 + Math.sin(done * Math.PI) * 0.25})`,
                }}
              >
                {done > 0.5 && <Check size={34} />}
              </div>
              {s}
            </div>
          );
        })}
      </div>
    </Fill>
  );
};

/* ---------- 3. Note et diagnostic ---------- */

const Tile = ({ label, value, alert, delay }) => {
  const s = useSpring(delay);
  const fill = useRamp(delay + 4, delay + 30);
  return (
    <div
      style={{
        flex: 1,
        padding: "34px 30px",
        borderRadius: 28,
        background: alert ? C.koSoft : C.okSoft,
        transform: `translateY(${(1 - s) * 120}px)`,
        opacity: Math.min(1, s * 1.5),
      }}
    >
      <div style={{ fontSize: 30, fontWeight: 500, color: C.muted }}>{label}</div>
      <div style={{ fontFamily: TITLE, fontSize: 96, lineHeight: 1.1, color: alert ? C.ko : C.ok }}>{Math.round(value * fill)}</div>
      <div style={{ height: 12, borderRadius: 99, background: "rgba(20,22,28,0.08)" }}>
        <div style={{ height: "100%", width: `${value * fill}%`, borderRadius: 99, background: alert ? C.ko : C.ok }} />
      </div>
    </div>
  );
};

export const SceneScore = () => {
  const frame = useCurrentFrame();
  const v = interpolate(frame, [4, 50], [0, 62], { ...clamp, easing: ease });
  const badge = useSpring(48, { damping: 10, stiffness: 200 });
  const pop = useSpring(0);
  return (
    <Fill>
      <Dots />
      <div style={{ position: "absolute", top: SAFE_TOP + 40, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 36, transform: `scale(${0.8 + pop * 0.2})` }}>
        <ScoreRing value={v} size={520} color={interpolateColors(v, [0, 62], [C.accent, C.ko])} />
        <Badge color={C.ko} soft={C.koSoft} scale={badge}>
          Limite : risque de rejet
        </Badge>
      </div>
      <div style={{ position: "absolute", left: 60, right: 60, top: SAFE_TOP + 820, display: "flex", gap: 24 }}>
        <Tile label="Lisibilité" value={88} delay={58} />
        <Tile label="Mots-clés" value={41} alert delay={66} />
        <Tile label="Analyse IA" value={58} alert delay={74} />
      </div>
    </Fill>
  );
};

/* ---------- 4. L'offre et ses mots-clés ---------- */

const URL_TEXT = "welcometothejungle.com/fr/jobs/alternance-chef-de-projet";

const Chip = ({ label, present, delay, confirmAt }) => {
  const frame = useCurrentFrame();
  const s = useSpring(delay, { damping: 11, stiffness: 220 });
  const confirmed = confirmAt != null && frame >= confirmAt;
  const bump = confirmAt != null ? interpolate(frame, [confirmAt, confirmAt + 4, confirmAt + 10], [1, 1.12, 1], clamp) : 1;
  const bg = present ? C.okSoft : confirmed ? C.accent : "#fff";
  const color = present ? C.ok : confirmed ? "#fff" : C.text;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "20px 32px",
        borderRadius: 99,
        fontSize: 38,
        fontWeight: 500,
        background: bg,
        color,
        border: present || confirmed ? "4px solid transparent" : `4px dashed ${C.line}`,
        transform: `scale(${s * bump})`,
      }}
    >
      {present || confirmed ? <Check size={32} color={color} /> : <span style={{ fontSize: 44, lineHeight: 1, color: C.accent }}>+</span>}
      {label}
    </div>
  );
};

export const SceneOffer = () => {
  const frame = useCurrentFrame();
  const typed = Math.round(interpolate(frame, [4, 40], [0, URL_TEXT.length], clamp));
  const press = interpolate(frame, [44, 48, 54], [0, 1, 0], clamp);
  const panel = useSpring(56);
  const caret = Math.floor(frame / 8) % 2 === 0 && frame < 44;
  const cur = interpolate(frame, [72, 96], [0, 1], { ...clamp, easing: ease });
  return (
    <Fill>
      <Dots />
      <div style={{ position: "absolute", left: 60, right: 60, top: SAFE_TOP + 20 }}>
        <div style={{ fontSize: 32, fontWeight: 500, marginBottom: 16 }}>Lien de l'annonce</div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "26px 30px", borderRadius: 22, border: `4px solid ${C.accent}`, background: "#fff", fontSize: 31, boxShadow: "0 0 0 8px rgba(59,43,214,0.12)" }}>
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden" }}>
            {URL_TEXT.slice(0, typed)}
            <span style={{ opacity: caret ? 1 : 0, color: C.accent }}>|</span>
          </span>
        </div>
        <div
          style={{
            marginTop: 26,
            display: "inline-block",
            background: press > 0.2 ? "#2c1fb0" : C.accent,
            color: "#fff",
            fontWeight: 500,
            fontSize: 38,
            padding: "24px 48px",
            borderRadius: 18,
            transform: `scale(${1 - press * 0.06})`,
          }}
        >
          Importer l'annonce
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          top: SAFE_TOP + 400,
          padding: 48,
          borderRadius: 36,
          background: "#fff",
          boxShadow: "0 30px 80px rgba(20,22,28,0.14)",
          opacity: panel,
          transform: `translateY(${(1 - panel) * 100}px)`,
        }}
      >
        <div style={{ fontSize: 44, fontWeight: 500, marginBottom: 10 }}>Mots-clés de l'offre</div>
        <div style={{ fontSize: 30, color: C.muted, marginBottom: 34 }}>Ajoute seulement ce que tu maîtrises.</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
          <Chip label="Gestion de projet" present delay={60} />
          <Chip label="Excel" present delay={63} />
          <Chip label="Anglais" present delay={66} />
          <Chip label="SQL" delay={69} confirmAt={98} />
          <Chip label="Power BI" delay={72} />
          <Chip label="Méthode agile" delay={75} />
        </div>
      </div>
      {frame > 66 && <Cursor x={interpolate(cur, [0, 1], [900, 210])} y={interpolate(cur, [0, 1], [1700, SAFE_TOP + 760])} press={interpolate(frame, [96, 98, 104], [0, 1, 0], clamp)} />}
    </Fill>
  );
};

/* ---------- 5. Réécriture pour l'offre ---------- */

export const SceneAdapt = () => {
  const frame = useCurrentFrame();
  const sweep = useRamp(6, 56, (t) => t);
  const lit = [2, 4, 6, 8, 9].filter((_, i) => sweep > 0.18 + i * 0.16);
  const v = interpolate(frame, [58, 96], [62, 88], { ...clamp, easing: ease });
  const ringIn = useSpring(50);
  const badge = useSpring(94, { damping: 9, stiffness: 220 });
  const pill = useSpring(104);
  const sheetW = 480;
  const sheetH = sheetW * 1.414;
  return (
    <Fill>
      <Dots />
      <div style={{ position: "absolute", left: 300, top: SAFE_TOP, transform: `translateX(${-ringIn * 220}px) rotate(${-ringIn * 4}deg)` }}>
        <CvSheet width={sheetW} highlight={lit} />
        {/* Ligne de réécriture */}
        {sweep < 1 && (
          <div
            style={{
              position: "absolute",
              left: -20,
              right: -20,
              top: sweep * sheetH,
              height: 70,
              marginTop: -35,
              background: "linear-gradient(180deg, transparent, rgba(59,43,214,0.35), transparent)",
              borderTop: `4px solid ${C.accent}`,
            }}
          />
        )}
      </div>
      <div style={{ position: "absolute", right: 50, top: SAFE_TOP + 120, display: "flex", flexDirection: "column", alignItems: "center", gap: 28, opacity: ringIn, transform: `scale(${0.6 + ringIn * 0.4})` }}>
        <ScoreRing value={v} size={400} color={interpolateColors(v, [62, 75, 88], [C.ko, C.ko, C.ok])} />
        <Badge color={C.ok} soft={C.okSoft} scale={badge}>
          Passe
        </Badge>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: SAFE_TOP + 860,
          display: "flex",
          justifyContent: "center",
          transform: `translateY(${(1 - pill) * 80}px)`,
          opacity: pill,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "26px 44px", borderRadius: 99, background: C.text, color: "#fff", fontSize: 40, fontWeight: 500 }}>
          <span style={{ width: 54, height: 54, borderRadius: "50%", background: C.ok, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Check size={32} />
          </span>
          Aucune expérience inventée
        </div>
      </div>
    </Fill>
  );
};

/* ---------- 6. CV et lettre en PDF ---------- */

const Letter = ({ width }) => (
  <div style={{ width, height: width * 1.414, background: "#fff", borderRadius: width * 0.04, boxShadow: "0 18px 50px rgba(20,22,28,0.18)", padding: width * 0.1, display: "flex", flexDirection: "column", gap: width * 0.032 }}>
    <div style={{ height: width * 0.035, width: "40%", background: C.text, borderRadius: 99 }} />
    <div style={{ height: width * 0.025, width: "30%", background: C.line, borderRadius: 99, marginBottom: width * 0.06 }} />
    <div style={{ height: width * 0.035, width: "65%", background: C.accent, borderRadius: 99, marginBottom: width * 0.03 }} />
    {[0.95, 0.9, 0.97, 0.7, 0.93, 0.88, 0.96, 0.6, 0.9, 0.85].map((w, i) => (
      <div key={i} style={{ height: width * 0.024, width: `${w * 100}%`, background: C.line, borderRadius: 99, marginBottom: i === 3 || i === 7 ? width * 0.04 : 0 }} />
    ))}
  </div>
);

const DocCard = ({ children, name, delay, x, rot }) => {
  const s = useSpring(delay, { damping: 13, stiffness: 150 });
  return (
    <div style={{ position: "absolute", left: x, top: SAFE_TOP + 60, transform: `translateY(${(1 - s) * 1300}px) rotate(${rot * s}deg)` }}>
      {children}
      <div style={{ marginTop: 30, display: "flex", alignItems: "center", gap: 14, justifyContent: "center", fontSize: 32, fontWeight: 500 }}>
        <span style={{ background: C.ko, color: "#fff", fontSize: 24, padding: "6px 12px", borderRadius: 8 }}>PDF</span>
        {name}
      </div>
    </div>
  );
};

export const SceneDocs = () => {
  const frame = useCurrentFrame();
  const btn = useSpring(52);
  const pulse = 1 + Math.max(0, Math.sin((frame - 70) / 5)) * 0.04 * (frame > 70 ? 1 : 0);
  return (
    <Fill bg={C.accentSoft}>
      <Dots color="rgba(59,43,214,0.16)" />
      <DocCard name="CV adapté" delay={0} x={90} rot={-6}>
        <CvSheet width={430} highlight={[2, 4, 6, 8, 9]} />
      </DocCard>
      <DocCard name="Lettre de motivation" delay={10} x={560} rot={6}>
        <Letter width={430} />
      </DocCard>
      <div style={{ position: "absolute", left: 0, right: 0, top: SAFE_TOP + 900, display: "flex", justifyContent: "center", opacity: btn, transform: `translateY(${(1 - btn) * 60}px) scale(${pulse})` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22, background: C.accent, color: "#fff", fontSize: 42, fontWeight: 500, padding: "30px 56px", borderRadius: 22, boxShadow: "0 18px 40px rgba(59,43,214,0.35)" }}>
          <svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4v11" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 20h14" />
          </svg>
          Tout télécharger
        </div>
      </div>
    </Fill>
  );
};

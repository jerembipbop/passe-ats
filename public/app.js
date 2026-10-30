const $ = (sel) => document.querySelector(sel);
const state = { addedKeywords: new Set(), file: null, analysis: null, adapted: null, jobOffer: "", company: "", letterKey: "cover_letter" };

const VERDICT_LABEL = { passe: "Passe les ATS", limite: "Passage incertain", rejet_probable: "Rejet probable" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const lines = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean);

// ---------- Affichage et retours visuels ----------
function show(id, visible = true) {
  $(id).classList.toggle("hidden", !visible);
}
function scrollToEl(id) {
  const top = $(id).getBoundingClientRect().top + window.scrollY - $(".stepper").offsetHeight - 12;
  window.scrollTo({ top, behavior: "smooth" });
}
// Les étapes déjà atteintes restent cliquables pour y revenir.
function setStep(step) {
  state.maxStep = step === 1 ? 1 : Math.max(state.maxStep || 1, step);
  document.querySelectorAll(".stepper li").forEach((li) => {
    const n = Number(li.dataset.step);
    const btn = li.querySelector(".step-btn");
    li.classList.toggle("active", n === step);
    li.classList.toggle("done", n < step);
    li.toggleAttribute("aria-current", n === step);
    // L'étape 2 regroupe le résultat et l'affinage : depuis l'affinage, on peut revenir au résultat.
    btn.disabled = n > state.maxStep || (n === step && (n === 1 || btn.dataset.target === state.panel || !state.reachable.has(btn.dataset.target)));
  });
}
document.querySelectorAll(".step-btn").forEach((btn) => btn.addEventListener("click", () => {
  const target = btn.dataset.target;
  if (target === "#hero") window.scrollTo({ top: 0, behavior: "smooth" });
  else goTo(state.reachable.has(target) ? target : "#refine");
}));

// ---------- Écrans : un seul à la fois, qui glissent de droite à gauche ----------
// Le résultat s'affiche seul en haut de page : plus besoin de défiler pour le voir.
const PANELS = ["#results", "#refine", "#adapted"];
const PANEL_STEP = { "#results": 2, "#refine": 2, "#adapted": 3 };
state.reachable = new Set();

function goTo(id) {
  const from = state.panel;
  state.panel = id;
  PANELS.forEach((p) => show(p, p === id));
  const el = $(id);
  el.style.transform = "";
  el.classList.remove("slide-forward", "slide-back");
  if (from && from !== id) {
    void el.offsetWidth; // relance l'animation
    el.classList.add(PANELS.indexOf(id) > PANELS.indexOf(from) ? "slide-forward" : "slide-back");
  }
  setStep(PANEL_STEP[id]);
  window.scrollTo({ top: 0 });
}

// Écran voisin déjà débloqué, dans un sens (+1 suivant, -1 précédent).
function neighbour(dir) {
  for (let i = PANELS.indexOf(state.panel) + dir; i >= 0 && i < PANELS.length; i += dir) {
    if (state.reachable.has(PANELS[i])) return PANELS[i];
  }
  return null;
}

// Glisser au doigt : l'écran suit le doigt, puis on change d'écran au-delà d'un seuil.
// Les champs de saisie et l'aperçu gardent leur comportement normal.
(() => {
  const main = $("main");
  let start = null;
  let lock = null; // "x" si le geste est horizontal, "y" s'il est vertical
  const ignored = (t) => t.closest("input, textarea, select, pre, .preview, [contenteditable]");

  main.addEventListener("touchstart", (ev) => {
    if (!state.panel || ev.touches.length > 1 || ignored(ev.target) || !$("#overlay").classList.contains("hidden")) return;
    start = { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
    lock = null;
  }, { passive: true });

  main.addEventListener("touchmove", (ev) => {
    if (!start) return;
    const dx = ev.touches[0].clientX - start.x;
    const dy = ev.touches[0].clientY - start.y;
    if (!lock && Math.hypot(dx, dy) > 10) lock = Math.abs(dx) > Math.abs(dy) * 1.5 ? "x" : "y";
    if (lock !== "x") return;
    // Résistance quand il n'y a pas d'écran de ce côté.
    const blocked = !neighbour(dx < 0 ? 1 : -1);
    $(state.panel).style.transform = `translateX(${blocked ? dx / 5 : dx / 2}px)`;
  }, { passive: true });

  main.addEventListener("touchend", (ev) => {
    if (!start) return;
    const dx = ev.changedTouches[0].clientX - start.x;
    const panel = $(state.panel);
    const target = lock === "x" && Math.abs(dx) > 70 ? neighbour(dx < 0 ? 1 : -1) : null;
    start = null;
    if (target) return goTo(target);
    panel.classList.add("snap");
    panel.style.transform = "";
    setTimeout(() => panel.classList.remove("snap"), 220);
  });
  main.addEventListener("touchcancel", () => {
    if (start && state.panel) $(state.panel).style.transform = "";
    start = null;
  });
})();
function setLoading(btn, loading) {
  btn.classList.toggle("loading", loading);
  btn.disabled = loading;
}

// ---------- Attente : progression, étapes réelles et quiz ----------
const LOADS = {
  analyze: { expected: 60000 },
  adapt: {
    title: "Création de ton CV et de ta lettre",
    expected: 100000,
    stages: [
      [0, "Préparation de ton profil"],
      [10, "Réécriture de ton CV pour l'offre"],
      [35, "Intégration des mots-clés de l'offre"],
      [55, "Rédaction de ta lettre de motivation"],
      [75, "Création du modèle de lettre réutilisable"],
      [88, "Relecture de ton nouveau CV comme un ATS"],
    ],
  },
};

// Quiz « vrai ou faux » pour rendre l'attente utile : chaque réponse explique la règle.
const QUIZ = [
  { q: "Un CV en deux colonnes est toujours bien lu par les ATS.", a: false, why: "Certains ATS lisent ligne par ligne et mélangent les deux colonnes. Une seule colonne est le choix le plus sûr." },
  { q: "Ton e-mail placé dans l'en-tête du document Word peut devenir invisible pour un ATS.", a: true, why: "Beaucoup d'ATS ignorent les en-têtes et pieds de page. Mets tes coordonnées dans le corps du CV." },
  { q: "Les barres de niveau (★★★☆) aident l'ATS à comprendre tes compétences.", a: false, why: "Un ATS ne lit que du texte : écris plutôt « Anglais : B2 » ou « Excel : avancé »." },
  { q: "Reprendre l'intitulé exact de l'offre dans le titre de ton CV peut t'aider à passer le filtre.", a: true, why: "Le titre du poste fait souvent partie des premiers critères de recherche des recruteurs." },
  { q: "Un CV scanné en image est lu comme du texte par les ATS.", a: false, why: "Sans texte sélectionnable, la plupart des ATS voient une page presque vide. Exporte ton CV en PDF depuis ton logiciel." },
  { q: "« Expérience professionnelle » vaut mieux que « Mon aventure » comme titre de section.", a: true, why: "Les ATS rangent ton contenu grâce à des titres de section standards." },
  { q: "Un mot-clé gagne à apparaître aussi dans une expérience concrète, pas seulement dans une liste.", a: true, why: "L'ATS le trouve dans les deux cas, mais le recruteur est convaincu par l'usage concret que tu en as fait." },
  { q: "Envoyer le même CV à toutes les offres est la meilleure stratégie.", a: false, why: "Chaque offre a ses propres mots-clés : un CV adapté les reprend et monte dans le classement." },
  { q: "Le PDF exporté depuis Word ou Google Docs est en général bien lu par les ATS.", a: true, why: "Un PDF qui contient du vrai texte se lit bien. Ce sont les images et les mises en page complexes qui posent problème." },
  { q: "Pour une alternance, indiquer ton rythme et ta date de début est inutile.", a: false, why: "Ce sont les premières questions des entreprises : les afficher dès le titre te fait gagner du temps." },
  { q: "Une abréviation comme « GA4 » est toujours reconnue comme « Google Analytics 4 ».", a: false, why: "Pas forcément : écris les deux formes au moins une fois, par exemple « Google Analytics 4 (GA4) »." },
  { q: "Des icônes à la place des mots (téléphone, enveloppe) peuvent devenir des caractères illisibles.", a: true, why: "Les polices d'icônes ressortent souvent en symboles bizarres. Écris « Téléphone : » en toutes lettres." },
];

const quizState = { order: [...QUIZ.keys()].sort(() => Math.random() - 0.5), n: 0, right: 0, answered: 0 };
const quizScore = () => (quizState.answered ? `${quizState.right} bonne${quizState.right > 1 ? "s" : ""} réponse${quizState.right > 1 ? "s" : ""} sur ${quizState.answered}` : "");

function renderQuiz(el) {
  const q = QUIZ[quizState.order[quizState.n % QUIZ.length]];
  el.innerHTML = `
    <p class="quiz-label">En attendant : vrai ou faux ? <span>${quizScore()}</span></p>
    <p class="quiz-q">${esc(q.q)}</p>
    <div class="quiz-actions">
      <button type="button" class="btn secondary" data-answer="true">Vrai</button>
      <button type="button" class="btn secondary" data-answer="false">Faux</button>
    </div>`;
}

["#scanQuiz", "#loaderQuiz"].forEach((id) => $(id).addEventListener("click", (ev) => {
  const el = $(id);
  if (ev.target.closest("[data-next]")) {
    quizState.n++;
    return renderQuiz(el);
  }
  const btn = ev.target.closest("[data-answer]");
  if (!btn) return;
  const q = QUIZ[quizState.order[quizState.n % QUIZ.length]];
  const ok = (btn.dataset.answer === "true") === q.a;
  quizState.answered++;
  if (ok) quizState.right++;
  el.innerHTML = `
    <p class="quiz-label">En attendant : vrai ou faux ? <span>${quizScore()}</span></p>
    <p class="quiz-q">${esc(q.q)}</p>
    <p class="quiz-feedback ${ok ? "ok" : "ko"}"><strong>${ok ? "Bonne réponse" : "Pas tout à fait"} : c'est ${q.a ? "vrai" : "faux"}.</strong> ${esc(q.why)}</p>
    <button type="button" class="btn link" data-next>Question suivante →</button>`;
}));

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const loader = { timer: null };

function expectedDuration(kind) {
  try {
    const past = JSON.parse(localStorage.getItem(`duree_${kind}_v2`) || "[]");
    if (past.length) return past.reduce((a, b) => a + b, 0) / past.length;
  } catch {}
  return LOADS[kind].expected;
}
function rememberDuration(kind, ms) {
  try {
    const past = JSON.parse(localStorage.getItem(`duree_${kind}_v2`) || "[]");
    localStorage.setItem(`duree_${kind}_v2`, JSON.stringify([...past, ms].slice(-5)));
  } catch {}
}

const fmtTime = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
// Progression estimée : avance vite au début, ralentit à l'approche de la durée habituelle.
const easedPct = (elapsed, expected) => Math.min(97, Math.floor(97 * (1 - Math.exp((-2.4 * elapsed) / expected))));

function setProgress(pct) {
  $("#loaderPct").textContent = pct;
  $("#loaderBar").setAttribute("aria-valuenow", pct);
  $("#loaderBar .progress-fill").style.width = `${pct}%`;
}

// Fenêtre de chargement, utilisée pour l'adaptation (réponse d'un seul bloc).
function startLoader(kind) {
  const cfg = LOADS[kind];
  const expected = expectedDuration(kind);
  const started = Date.now();
  Object.assign(loader, { kind, started });
  $("#overlay").classList.remove("hidden", "finished");
  $("#loaderTitle").textContent = cfg.title;
  setProgress(0);
  renderQuiz($("#loaderQuiz"));

  const tick = () => {
    const elapsed = Date.now() - started;
    const pct = easedPct(elapsed, expected);
    setProgress(pct);
    $("#loaderStage").textContent = cfg.stages.filter(([from]) => pct >= from).at(-1)[1];
    $("#loaderMeta").textContent = elapsed > expected * 1.15
      ? `${fmtTime(elapsed)} écoulées · les modèles gratuits sont chargés, ça arrive…`
      : `${fmtTime(elapsed)} écoulées · environ ${fmtTime(Math.max(0, expected - elapsed))} restantes`;
  };
  tick();
  clearInterval(loader.timer);
  loader.timer = setInterval(tick, 400);
}

async function stopLoader(success) {
  clearInterval(loader.timer);
  if (success) {
    const ms = Date.now() - loader.started;
    if (ms > 3000) rememberDuration(loader.kind, ms); // une réponse déjà prête ne fausse pas l'estimation
    $("#overlay").classList.add("finished");
    setProgress(100);
    $("#loaderStage").textContent = "Terminé !";
    await new Promise((r) => setTimeout(r, 600));
  }
  $("#overlay").classList.add("hidden");
}

// Suivi de l'analyse, affiché dans la carte de résultat : les étapes cochées sont réelles.
const SCAN_WEIGHT = { read: 5, format: 10, keywords: 35, diagnosis: 50 };
const scan = { timer: null, started: 0, done: new Set(), tries: {} };

function scanStep(name, status) {
  const li = $(`[data-scan="${name}"]`);
  li.classList.remove("active", "done");
  li.classList.add(status);
  if (status === "done") scan.done.add(name);
}

function startScan() {
  Object.assign(scan, { started: Date.now(), done: new Set(), tries: {} });
  const expected = expectedDuration("analyze");
  $("#scan").className = "scan";
  $("#scanTitle").textContent = "Analyse en cours";
  show("#scanRetry", false);
  document.querySelectorAll("[data-scan]").forEach((li) => (li.className = ""));
  scanStep("read", "active");
  renderQuiz($("#scanQuiz"));
  const tick = () => {
    const elapsed = Date.now() - scan.started;
    const fromSteps = [...scan.done].reduce((s, k) => s + SCAN_WEIGHT[k], 0);
    const pct = Math.min(97, Math.max(fromSteps, easedPct(elapsed, expected)));
    $("#scanBar").setAttribute("aria-valuenow", pct);
    $("#scanBar .progress-fill").style.width = `${pct}%`;
    $("#scanTime").textContent = elapsed > expected * 1.2
      ? `${fmtTime(elapsed)} · les modèles gratuits sont chargés, ça arrive`
      : `${fmtTime(elapsed)} · environ ${fmtTime(Math.max(0, expected - elapsed))} restantes`;
  };
  tick();
  clearInterval(scan.timer);
  scan.timer = setInterval(tick, 400);
}

function finishScan({ cached }) {
  clearInterval(scan.timer);
  const ms = Date.now() - scan.started;
  if (!cached) rememberDuration("analyze", ms);
  $("#scan").className = "scan done";
  $("#scanTitle").textContent = cached ? "Résultat déjà calculé, affiché tout de suite" : `Analyse terminée en ${fmtTime(ms)}`;
  $("#scanTime").textContent = quizScore() ? `Quiz : ${quizScore()}` : "";
}

function failScan(message) {
  clearInterval(scan.timer);
  $("#scan").className = "scan failed";
  $("#scanTitle").textContent = "L'analyse n'a pas pu aboutir";
  $("#scanTime").textContent = message;
  show("#scanRetry", true);
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add("hidden"), 7000);
}

async function api(url, body, asBlob = false) {
  const res = await fetch(url, body instanceof FormData
    ? { method: "POST", body }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erreur ${res.status}`);
  }
  return asBlob ? res : res.json();
}

async function download(url, body) {
  try {
    const res = await api(url, body, true);
    const name = /filename="?([^";]+)"?/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "document";
    const blob = await res.blob();
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) {
    toast(e.message);
  }
}

// ---------- Hero : glisser-déposer du CV ----------
const fileInput = $("#cvFile");

function handleFile(file) {
  if (!file) return;
  if (!/\.(pdf|docx)$/i.test(file.name)) return toast("Format non supporté : dépose un fichier .pdf ou .docx.");
  if (file.size > 4 * 1024 * 1024) return toast("Fichier trop lourd (4 Mo maximum). Exporte ton CV en PDF plus léger.");
  state.file = file;
  state.adapted = null;
  state.addedKeywords.clear();
  runAnalysis();
}

fileInput.addEventListener("change", () => {
  handleFile(fileInput.files[0]);
  fileInput.value = "";
});

const drop = $("#drop");
drop.addEventListener("click", () => fileInput.click());
drop.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    fileInput.click();
  }
});

// Le CV peut être lâché n'importe où sur la page ; la zone de dépôt réagit pour le montrer.
let dragDepth = 0;
function setDragging(on) {
  document.body.classList.toggle("dragging", on);
  $("#dropTitle").textContent = on ? "Lâche ton CV ici" : "Glisse ton CV ici";
}
window.addEventListener("dragenter", (ev) => {
  if (!ev.dataTransfer?.types.includes("Files")) return;
  dragDepth++;
  setDragging(true);
});
window.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    setDragging(false);
  }
});
window.addEventListener("dragover", (ev) => ev.preventDefault());
window.addEventListener("drop", (ev) => {
  ev.preventDefault();
  dragDepth = 0;
  setDragging(false);
  handleFile(ev.dataTransfer.files[0]);
});

$("#changeCvBtn").addEventListener("click", () => fileInput.click());

function profile() {
  const p = {};
  document.querySelectorAll("[data-profile]").forEach((el) => { if (el.value.trim()) p[el.dataset.profile] = el.value.trim(); });
  if (state.addedKeywords.size) {
    p["Compétences maîtrisées, à ajouter au CV (confirmées par le candidat)"] = [...state.addedKeywords].join(", ");
  }
  return p;
}

async function runAnalysis() {
  const fd = new FormData();
  fd.append("cv", state.file);
  fd.append("jobOffer", $("#jobOffer").value.trim());
  fd.append("company", $("#company").value.trim());
  fd.append("profile", JSON.stringify(profile()));

  // Le résultat s'affiche tout de suite et se remplit au fil de l'analyse.
  const run = (state.analysisRun = (state.analysisRun || 0) + 1);
  const jobOffer = fd.get("jobOffer");
  $("#fileName").textContent = state.file.name;
  $("#hero").classList.add("compact");
  showPendingResult(!!jobOffer);
  startScan();
  state.reachable = new Set(["#results"]);
  goTo("#results");

  let analysis;
  let cached = true;
  try {
    const res = await fetch("/api/analyze", { method: "POST", body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erreur ${res.status}`);
    for await (const event of readEvents(res)) {
      if (run !== state.analysisRun) return false; // une analyse plus récente a pris le relais
      if (event.type === "local") {
        scanStep("read", "done");
        scanStep("format", "done");
        renderLocalResult(event);
      } else if (event.type === "stage") {
        cached = false;
        scan.tries[event.stage] = (scan.tries[event.stage] || 0) + 1;
        scanStep(event.stage, "active");
        if (scan.tries[event.stage] > 1) $("#scanTime").textContent = "Un modèle gratuit était saturé : bascule sur un autre…";
      } else if (event.type === "keywords") {
        scanStep("keywords", "done");
        renderKeywordsPartial(event);
      } else if (event.type === "done") {
        analysis = event.analysis;
      } else if (event.type === "error") {
        throw new Error(event.error);
      }
    }
    if (!analysis) throw new Error("L'analyse s'est interrompue. Relance-la.");
  } catch (e) {
    if (run !== state.analysisRun) return false;
    failScan(e.message);
    toast(e.message);
    return false;
  }

  scanStep("keywords", "done");
  scanStep("diagnosis", "done");
  finishScan({ cached });
  state.analysis = analysis;
  state.jobOffer = jobOffer;
  state.company = fd.get("company") || analysis.company || "";
  $("#results").classList.remove("pending");
  renderAnalysis(analysis);
  animateScore(analysis.score);
  renderRefine(analysis);
  $("#reanalyzeBtn").classList.replace("primary", "secondary");
  state.reachable = new Set(["#results", "#refine"]);
  state.maxStep = 2;
  setStep(2);
  if (analysis.hasOffer) prefetchAdapt();
  return true;
}

// Lit la réponse progressive du serveur : une ligne JSON par événement.
async function* readEvents(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line);
    }
    if (done) break;
  }
}

$("#scanRetry").addEventListener("click", () => runAnalysis());

// Carte de résultat « en attente » : chaque partie se remplit dès qu'elle est prête.
function showPendingResult(hasOffer) {
  $("#results").classList.add("pending");
  $(".ring").classList.remove("pass");
  $("#ringValue").setAttribute("stroke-dasharray", "0 100");
  $("#scoreValue").textContent = "–";
  $("#verdict").className = "badge waiting";
  $("#verdict").textContent = "Analyse en cours";
  $("#context").textContent = hasOffer ? `Comparé à l'offre${$("#company").value.trim() ? ` · ${$("#company").value.trim()}` : ""}` : "Analyse générale";
  $("#nextStep").textContent = "Ton diagnostic arrive. En attendant, tente le quiz juste au-dessus.";
  renderTiles({});
  $("#fixes").innerHTML = '<li class="skeleton"></li><li class="skeleton"></li><li class="skeleton"></li>';
  $("#keywordsHint").textContent = "Les mots-clés attendus arrivent…";
  $("#keywords").innerHTML = '<span class="chip skeleton"></span>'.repeat(8);
}

function renderLocalResult(ev) {
  const failed = ev.checks.filter((c) => !c.ok).length;
  state.partial = { format: ev.format, failed };
  renderTiles(state.partial);
  $("#checks").innerHTML = ev.checks.map((c) => `
    <li>${esc(c.label)} <span class="${c.ok ? "" : "flag"}">· ${c.ok ? "respecté" : "à revoir"}</span>${c.ok ? "" : `<small>${esc(c.detail)}</small>`}</li>`).join("");
  $("#rawText").textContent = ev.cvText || "(aucun texte extrait)";
}

function renderKeywordsPartial(ev) {
  const missing = ev.keywords.filter((k) => !k.present).length;
  Object.assign(state.partial, { motsCles: ev.score, missing, total: ev.keywords.length });
  renderTiles(state.partial);
  $("#keywordsHint").textContent = missing
    ? "Clique sur un mot-clé manquant si tu maîtrises la compétence : il sera ajouté à ton CV adapté."
    : "Tous les mots-clés attendus sont présents dans ton CV.";
  state.pendingKeywords = ev.keywords;
  renderKeywords(ev.keywords);
}

// Le score monte jusqu'à sa valeur, en même temps que l'anneau se remplit.
function animateScore(score) {
  const el = $("#scoreValue");
  if (reduceMotion) return void (el.textContent = score);
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 900);
    el.textContent = Math.round(score * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Adaptation lancée en arrière-plan : le clic sur « Adapter » récupère ce travail déjà commencé.
const adaptBody = () => ({
  cvText: state.analysis.cvText,
  jobOffer: state.jobOffer,
  company: state.company,
  analysis: { ...state.analysis.ai, keywords: state.analysis.keywords },
  profile: profile(),
});
function prefetchAdapt() {
  fetch("/api/adapt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(adaptBody()) }).catch(() => {});
}

// ---------- Résultat ----------
const ATS_STATE = { ok: "lu correctement", risque: "risque de mauvaise lecture", ko: "bloquant" };
const IMPACT_ORDER = { fort: 0, moyen: 1, faible: 2 };
const IMPORTANCE_ORDER = { essentiel: 0, important: 1, bonus: 2 };
const normKey = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Une tuile n'est mise en alerte que si son score demande une action.
const needsAction = (score) => score < 75;

// Les trois tuiles ; une valeur encore inconnue affiche une tuile en attente.
function renderTiles({ ia, format, failed, motsCles, missing, total }) {
  const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;
  const tiles = [
    { label: "Analyse IA", score: ia, value: `${ia}/100`, note: "Avis global sur ton CV" },
    {
      label: "Lisibilité", score: format, value: `${format}/100`,
      note: failed ? `${plural(failed, "point")} technique${failed > 1 ? "s" : ""} à revoir` : "Ton fichier est bien lu",
    },
    {
      label: "Mots-clés", score: motsCles, value: `${motsCles} %`,
      note: missing ? `${missing} sur ${total} manquant${missing > 1 ? "s" : ""}` : "Tous présents",
    },
  ];
  $("#tiles").innerHTML = tiles.map((t) => t.score == null
    ? `<div class="tile waiting"><p class="tile-label">${t.label}</p><p class="tile-value"><span class="skeleton-line"></span></p><p class="tile-note">En cours…</p></div>`
    : `<div class="tile${needsAction(t.score) ? " alert" : ""}">
        <p class="tile-label">${t.label}</p>
        <p class="tile-value">${t.value}</p>
        <p class="tile-note">${t.note}</p>
      </div>`).join("");
}

function renderAnalysis(a) {
  const pass = a.verdict === "passe";
  const company = state.company;

  $(".ring").classList.toggle("pass", pass);
  $("#ringValue").setAttribute("stroke-dasharray", `${a.score} 100`);
  $("#scoreValue").textContent = a.score;
  $("#verdict").className = `badge${pass ? " pass" : ""}`;
  $("#verdict").textContent = VERDICT_LABEL[a.verdict];
  $("#resultTitle").setAttribute("aria-label", `Score ATS ${a.score} sur 100 : ${VERDICT_LABEL[a.verdict]}`);
  $("#context").textContent = a.hasOffer
    ? `Comparé à l'offre${company ? ` · ${company}` : ""}`
    : `Analyse générale${a.ai.detected_job_title ? ` · ${a.ai.detected_job_title}` : ""}`;
  $("#nextStep").textContent = a.ai.next_step || a.ai.summary;
  // Verdict plafonné côté serveur quand un ATS bloque : on dit lesquels.
  if (a.cappedBy?.length) $("#context").textContent += ` · bloquant pour ${a.cappedBy.join(", ")}`;

  // Tuiles
  const missing = a.keywords.filter((k) => !k.present).length;
  renderTiles({
    ia: a.breakdown.ia,
    format: a.breakdown.format,
    failed: a.checks.filter((c) => !c.ok).length,
    motsCles: a.breakdown.motsCles,
    missing,
    total: a.keywords.length,
  });

  // Corrections : triées par impact, doublons retirés.
  const seen = new Set();
  const fixes = (a.ai.priority_fixes || [])
    .map((f, i) => ({ ...f, i }))
    .filter((f) => f.action.trim() && !seen.has(normKey(f.action)) && seen.add(normKey(f.action)))
    .sort((x, y) => IMPACT_ORDER[x.impact] - IMPACT_ORDER[y.impact] || x.i - y.i);
  $("#fixes").innerHTML = fixes.length
    ? fixes.map((f) => `<li>${esc(f.action)}</li>`).join("")
    : `<li class="empty">Rien d'urgent : ton CV est prêt pour les ATS.</li>`;

  // Mots-clés
  $("#keywordsHint").textContent = missing
    ? `Clique sur un mot-clé manquant si tu maîtrises la compétence : il sera ajouté à ton CV adapté.${a.hasOffer ? "" : " Ces mots-clés sont ceux habituellement attendus pour ce poste."}`
    : "Tous les mots-clés attendus sont présents dans ton CV.";
  renderKeywords(a.keywords);

  // Détails
  $("#sections").innerHTML = a.ai.section_feedback.map((s) => `<li><strong>${esc(s.section)}</strong><small>${esc(s.feedback)}</small></li>`).join("")
    || "<li>Aucun conseil particulier.</li>";
  $("#atsList").innerHTML = a.ai.ats_systems.map((s) => `
    <li><strong>${esc(s.name)}</strong> <span class="${s.verdict === "ok" ? "" : "flag"}">· ${ATS_STATE[s.verdict]}</span><small>${esc(s.reason)}</small></li>`).join("");
  $("#checks").innerHTML = a.checks.map((c) => `
    <li>${esc(c.label)} <span class="${c.ok ? "" : "flag"}">· ${c.ok ? "respecté" : "à revoir"}</span>${c.ok ? "" : `<small>${esc(c.detail)}</small>`}</li>`).join("");
  $("#rawText").textContent = a.cvText || "(aucun texte extrait)";

  $("#resultFoot").innerHTML = a.ai.model
    ? `Analyse réalisée par un <abbr title="${esc(a.ai.model)}">modèle d'IA gratuit</abbr> via OpenRouter.`
    : "";
}

function renderKeywords(keywords) {
  const sorted = [...keywords].sort((x, y) => (x.present - y.present) || IMPORTANCE_ORDER[x.importance] - IMPORTANCE_ORDER[y.importance]);
  const check = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>`;
  $("#keywords").innerHTML = sorted.map((k) => {
    if (k.present) return `<span class="chip found" title="Trouvé dans ton CV">${check}${esc(k.keyword)}</span>`;
    const added = state.addedKeywords.has(k.keyword);
    return `<button type="button" class="chip missing${added ? " added" : ""}" data-kw="${esc(k.keyword)}" aria-pressed="${added}"
      title="${added ? "Retirer de ton CV adapté" : "Je maîtrise cette compétence : l'ajouter à mon CV"}"><span class="plus" aria-hidden="true">${added ? "✓" : "+"}</span>${esc(k.keyword)}</button>`;
  }).join("");
}

// Un mot-clé manquant cliqué est confirmé par le candidat : il part dans le CV adapté.
$("#keywords").addEventListener("click", (ev) => {
  const chip = ev.target.closest("button.chip.missing");
  if (!chip) return;
  const kw = chip.dataset.kw;
  const added = !state.addedKeywords.has(kw);
  if (added) state.addedKeywords.add(kw);
  else state.addedKeywords.delete(kw);
  renderKeywords(state.analysis?.keywords || state.pendingKeywords || []);
  if (state.reachable.has("#adapted")) syncAddedSkill(kw, added);
});

// Si le CV adapté est déjà affiché, on met aussi à jour son éditeur.
function syncAddedSkill(kw, added) {
  const CATEGORY = "Compétences ajoutées";
  let item = [...document.querySelectorAll('[data-list="skills"] .item')].find((it) => it.querySelector('[data-k="category"]').value === CATEGORY);
  if (!item && added) {
    item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `${LIST_BLOCKS.skills.render({ category: CATEGORY, items: [] })}<button type="button" class="ghost remove">Retirer</button>`;
    $('[data-list="skills"] .items').appendChild(item);
  }
  if (!item) return;
  const input = item.querySelector('[data-k="items"]');
  const items = input.value.split(",").map((s) => s.trim()).filter(Boolean).filter((s) => s !== kw);
  if (added) items.push(kw);
  input.value = items.join(", ");
}

// ---------- Affinage selon le résultat ----------
function renderRefine(a) {
  let intro;
  if (!a.hasOffer) {
    intro = "Ajoute l'offre visée : c'est sur ses mots-clés que les ATS te filtrent.";
  } else if (a.verdict !== "passe") {
    intro = "Complète ce qui manque, puis relance l'analyse ou passe directement à l'adaptation.";
  } else {
    intro = "Ton CV passe pour cette offre. Ajoute tes infos d'alternance pour une lettre plus personnelle.";
  }
  $("#refineIntro").textContent = intro;
  const questions = a.ai.refine_suggestions || [];
  $("#suggestions").innerHTML = questions.map((s) => `<li>${esc(s)}</li>`).join("");
  show("#questionsBox", questions.length > 0);
  $("#refine").classList.toggle("highlight", !a.hasOffer || a.verdict !== "passe");
  if (a.verdict !== "passe") $("#profileBox").open = true;
  renderNextAction(a);
}

// Bloc « Prochaine étape » en bas du résultat : une action principale selon la situation.
function renderNextAction(a) {
  const toRefine = (focus) => () => {
    goTo("#refine");
    setTimeout(() => focus?.focus({ preventScroll: true }), 350);
  };
  const adapt = () => $("#adaptBtn").click();
  const config = a.hasOffer
    ? {
        text: "Adapte ton CV à cette offre et récupère ta lettre de motivation.",
        primary: ["Adapter mon CV et créer ma lettre", adapt],
        secondary: ["Ajouter des infos d'abord", () => {
          $("#profileBox").open = true;
          toRefine($("#profileBox summary"))();
          setTimeout(() => scrollToEl("#profileBox"), 350);
        }],
      }
    : {
        text: "Ajoute l'offre visée pour vérifier les mots-clés qui comptent vraiment.",
        primary: ["Ajouter l'offre visée", toRefine($("#offerUrl"))],
        secondary: ["Adapter sans offre", adapt],
      };
  $("#nextActionText").textContent = config.text;
  $("#nextPrimary").textContent = config.primary[0];
  $("#nextPrimary").onclick = config.primary[1];
  $("#nextSecondary").textContent = config.secondary[0];
  $("#nextSecondary").onclick = config.secondary[1];
}

$("#refineForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  runAnalysis();
});

// ---------- Import de l'annonce par son lien ----------
const urlInput = $("#offerUrl");
const importBtn = $("#importBtn");

function urlStatus(kind, html) {
  const el = $("#urlStatus");
  el.className = `status ${kind}`;
  el.innerHTML = html;
  urlInput.setAttribute("aria-invalid", kind === "error");
}

async function importOffer() {
  const url = urlInput.value.trim();
  if (!/^https?:\/\/\S+\.\S+/i.test(url)) {
    urlStatus("error", "Ce lien ne semble pas valide. Copie l'adresse complète de l'annonce, elle commence par https://");
    urlInput.focus();
    return;
  }
  setLoading(importBtn, true);
  urlStatus("loading", "Récupération de l'annonce en cours…");
  try {
    const offer = await api("/api/offer/import", { url });
    const textarea = $("#jobOffer");
    textarea.value = offer.text;
    textarea.classList.remove("just-filled");
    void textarea.offsetWidth;
    textarea.classList.add("just-filled");
    if (offer.company && !$("#company").value.trim()) $("#company").value = offer.company;
    const what = [offer.title, offer.company].filter(Boolean).map(esc).join(" · ") || "Annonce";
    urlStatus("ok", `✓ ${what} importée depuis ${esc(offer.source)}. Vérifie le texte ci-dessous, puis relance l'analyse.`);
    $("#reanalyzeBtn").classList.replace("secondary", "primary");
    prefetchKeywords();
  } catch (e) {
    urlStatus("error", esc(e.message));
  } finally {
    setLoading(importBtn, false);
  }
}

// Dès que l'offre est connue, ses mots-clés sont préparés en arrière-plan :
// la relance de l'analyse n'a plus qu'à attendre le diagnostic.
let lastPrefetchedOffer = "";
function prefetchKeywords() {
  const jobOffer = $("#jobOffer").value.trim();
  const key = `${jobOffer}|${$("#company").value.trim()}`;
  if (!state.file || jobOffer.length < 200 || key === lastPrefetchedOffer) return;
  lastPrefetchedOffer = key;
  fetch("/api/offer/keywords", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobOffer, company: $("#company").value.trim() }),
  }).catch(() => {});
}
let prefetchTimer;
["#jobOffer", "#company"].forEach((id) => $(id).addEventListener("input", () => {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(prefetchKeywords, 2000);
}));

importBtn.addEventListener("click", importOffer);
urlInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    importOffer();
  }
});
// Coller un lien lance l'import directement.
urlInput.addEventListener("paste", () => setTimeout(() => {
  if (/^https?:\/\//i.test(urlInput.value.trim())) importOffer();
}, 0));

$("#adaptBtn").addEventListener("click", async () => {
  // L'offre a changé depuis la dernière analyse : on réanalyse d'abord pour avoir les bons mots-clés.
  if ($("#jobOffer").value.trim() !== state.jobOffer && !(await runAnalysis())) return;
  startLoader("adapt");
  try {
    // Même demande que celle lancée en avance : le serveur renvoie ce travail déjà commencé.
    state.adapted = await api("/api/adapt", adaptBody());
  } catch (e) {
    await stopLoader(false);
    toast(e.message);
    return;
  }
  await stopLoader(true);
  renderAdapted();
  state.reachable.add("#adapted");
  goTo("#adapted");
  await recheck();
});

// ---------- Étape 3 : éditeur de CV ----------
const field = (label, key, value, type = "input", extra = "") =>
  `<label>${label}${type === "textarea"
    ? `<textarea data-k="${key}" rows="${extra || 3}">${esc(value)}</textarea>`
    : `<input type="text" data-k="${key}" value="${esc(value)}" />`}</label>`;

const LIST_BLOCKS = {
  experiences: {
    title: "Expérience professionnelle",
    empty: { title: "", company: "", location: "", start: "", end: "", bullets: [] },
    render: (e) => `
      <div class="grid2">${field("Intitulé du poste", "title", e.title)}${field("Entreprise", "company", e.company)}</div>
      <div class="grid3">${field("Lieu", "location", e.location)}${field("Début", "start", e.start)}${field("Fin", "end", e.end)}</div>
      ${field("Missions (une par ligne)", "bullets", (e.bullets || []).join("\n"), "textarea", 4)}`,
  },
  education: {
    title: "Formation",
    empty: { degree: "", school: "", location: "", start: "", end: "", details: "" },
    render: (e) => `
      <div class="grid2">${field("Diplôme", "degree", e.degree)}${field("École", "school", e.school)}</div>
      <div class="grid3">${field("Lieu", "location", e.location)}${field("Début", "start", e.start)}${field("Fin", "end", e.end)}</div>
      ${field("Détails", "details", e.details, "textarea", 2)}`,
  },
  skills: {
    title: "Compétences",
    empty: { category: "", items: [] },
    render: (s) => `<div class="grid2">${field("Catégorie", "category", s.category)}${field("Compétences (séparées par des virgules)", "items", (s.items || []).join(", "))}</div>`,
  },
};

function renderCvEditor(cv) {
  const c = cv.contact || {};
  const listBlock = (key) => {
    const def = LIST_BLOCKS[key];
    const items = (cv[key] || []).map((it) => `<div class="item">${def.render(it)}<button type="button" class="ghost remove">Retirer</button></div>`).join("");
    return `<div class="block" data-list="${key}"><p class="block-title">${def.title}</p><div class="items">${items}</div>
      <button type="button" class="ghost add" data-add="${key}">+ Ajouter</button></div>`;
  };

  $("#cvEditor").innerHTML = `
    <div class="block" data-single="identity"><p class="block-title">En-tête</p>
      <div class="grid2">${field("Nom complet", "full_name", cv.full_name)}${field("Titre du CV", "headline", cv.headline)}</div>
      <div class="grid3">${field("E-mail", "email", c.email)}${field("Téléphone", "phone", c.phone)}${field("Ville", "city", c.city)}</div>
      <div class="grid2">${field("LinkedIn", "linkedin", c.linkedin)}${field("Autre (permis, portfolio…)", "other", c.other)}</div>
      ${field("Profil / accroche", "summary", cv.summary, "textarea", 3)}
    </div>
    ${listBlock("experiences")}
    ${listBlock("education")}
    ${listBlock("skills")}
    <div class="block" data-single="others"><p class="block-title">Autres rubriques</p>
      ${field("Langues (une par ligne, « Langue : niveau »)", "languages", (cv.languages || []).map((l) => [l.language, l.level].filter(Boolean).join(" : ")).join("\n"), "textarea", 2)}
      ${field("Projets (un par ligne, « Nom : description »)", "projects", (cv.projects || []).map((p) => [p.name, p.description].filter(Boolean).join(" : ")).join("\n"), "textarea", 2)}
      ${field("Certifications (une par ligne)", "certifications", (cv.certifications || []).join("\n"), "textarea", 2)}
      ${field("Centres d'intérêt (séparés par des virgules)", "interests", (cv.interests || []).join(", "))}
    </div>`;
}

$("#cvEditor").addEventListener("click", (ev) => {
  if (ev.target.matches(".remove")) ev.target.closest(".item").remove();
  if (ev.target.matches("[data-add]")) {
    const key = ev.target.dataset.add;
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `${LIST_BLOCKS[key].render(LIST_BLOCKS[key].empty)}<button type="button" class="ghost remove">Retirer</button>`;
    ev.target.previousElementSibling.appendChild(div);
  }
});

function readCv() {
  const get = (root, k) => root.querySelector(`[data-k="${k}"]`)?.value.trim() ?? "";
  const id = $('[data-single="identity"]');
  const others = $('[data-single="others"]');
  const readList = (key, fn) => [...document.querySelectorAll(`[data-list="${key}"] .item`)].map((it) => fn((k) => get(it, k)));
  const splitPair = (l) => {
    const i = l.indexOf(":");
    return i < 0 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  };

  return {
    full_name: get(id, "full_name"),
    headline: get(id, "headline"),
    contact: { email: get(id, "email"), phone: get(id, "phone"), city: get(id, "city"), linkedin: get(id, "linkedin"), other: get(id, "other") },
    summary: get(id, "summary"),
    experiences: readList("experiences", (g) => ({ title: g("title"), company: g("company"), location: g("location"), start: g("start"), end: g("end"), bullets: lines(g("bullets")) })),
    education: readList("education", (g) => ({ degree: g("degree"), school: g("school"), location: g("location"), start: g("start"), end: g("end"), details: g("details") })),
    skills: readList("skills", (g) => ({ category: g("category"), items: g("items").split(",").map((s) => s.trim()).filter(Boolean) })),
    languages: lines(get(others, "languages")).map((l) => { const [language, level] = splitPair(l); return { language, level }; }),
    projects: lines(get(others, "projects")).map((l) => { const [name, description] = splitPair(l); return { name, description }; }),
    certifications: lines(get(others, "certifications")),
    interests: get(others, "interests").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

function renderAdapted() {
  const a = state.adapted;
  renderCvEditor(a.cv);
  $("#changes").innerHTML = a.changes.map((c) => `<li>${esc(c)}</li>`).join("");
  $("#changesSummary").textContent = `Ce qui a été modifié (${a.changes.length})`;

  // Anciennes réponses : de simples phrases « Compétence : explication ».
  state.checks = a.missing_not_added
    .map((m) => {
      if (typeof m !== "string") return m;
      const keyword = m.split(/\s[:(]/)[0].trim();
      return { keyword, reason: m.slice(keyword.length).replace(/^\s*[:(]\s*/, "").replace(/\)\s*$/, "") };
    })
    .filter((m) => m.keyword)
    .map((m) => ({ ...m, status: "pending" }));

  state.letters = { cover_letter: a.cover_letter, cover_letter_template: a.cover_letter_template };
  state.letterKey = null;
  $("#letterEditor").innerHTML = "";
  showLetter("cover_letter");
  renderChecklist();
  selectDoc("cv");
}

// Score « après » : uniquement ce qui se mesure sur le PDF, donc pas de verdict ATS ici.
async function recheck() {
  try {
    const r = await api("/api/cv/check", { cv: readCv(), keywords: state.analysis.ai.keywords });
    const b = state.analysis.breakdown;
    const before = Math.round((b.format + b.motsCles) / 2);
    $("#compare").innerHTML = `
      <p class="readability-label">Lisibilité ATS du CV</p>
      <p class="readability-scores"><span>${before}</span><span class="arrow" aria-hidden="true">→</span><b class="${r.score < 75 ? "low" : ""}">${r.score}</b><small>/100</small></p>
      <p class="compare-note">Mesure la lecture du fichier (${b.format} → ${r.breakdown.format}) et la présence des mots-clés de l'offre (${b.motsCles} % → ${r.breakdown.motsCles} %). Ce n'est pas une garantie d'entretien : c'est le fond de ton CV qui convaincra le recruteur.</p>`;
  } catch (e) {
    toast(e.message);
  }
}

// ---------- 1. Vérifier ce qui manque ----------
function renderChecklist() {
  const checks = state.checks;
  show("#checkStep", checks.length > 0);
  $("#reviewNum").textContent = checks.length ? "2" : "1";
  $("#sendNum").textContent = checks.length ? "3" : "2";
  $("#checklist").innerHTML = checks.map((c, i) => `
    <li class="check-item ${c.status}">
      <div class="check-text">
        <p class="check-keyword">${esc(c.keyword)}</p>
        ${(() => {
          const text = c.status === "added" ? "Ajouté à ton CV, dans « Compétences ajoutées »." : c.status === "ignored" ? "Ignoré." : c.reason;
          return text && text !== c.keyword ? `<p class="check-reason">${esc(text)}</p>` : "";
        })()}
      </div>
      <div class="check-actions">
        ${c.status === "pending"
          ? `<button type="button" class="btn secondary" data-check="${i}" data-action="add">Je maîtrise, l'ajouter</button>
             <button type="button" class="btn link" data-check="${i}" data-action="ignore">Ignorer</button>`
          : `<button type="button" class="btn link" data-check="${i}" data-action="undo">Annuler</button>`}
      </div>
    </li>`).join("");
  renderSendStatus();
}

$("#checklist").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-check]");
  if (!btn) return;
  const check = state.checks[Number(btn.dataset.check)];
  if (check.status === "added" || btn.dataset.action === "add") syncAddedSkill(check.keyword, btn.dataset.action === "add");
  check.status = { add: "added", ignore: "ignored", undo: "pending" }[btn.dataset.action];
  renderChecklist();
  if (state.doc === "cv") refreshPreview();
  recheck();
});

// ---------- 2. Relire et ajuster : aperçu, édition côte à côte en direct ----------
const DOCS = {
  cv: {
    name: "du CV",
    edit: "Modifier le CV",
    hint: () => "Ton CV tel qu'il sera téléchargé : une colonne et des titres standards, ce que les ATS lisent le mieux.",
  },
  cover_letter: {
    name: "de la lettre",
    edit: "Modifier la lettre",
    hint: () => `Lettre rédigée pour ${state.company || "cette offre"}. Relis-la et personnalise-la avant de l'envoyer.`,
  },
  cover_letter_template: {
    name: "du modèle de lettre",
    edit: "Modifier le modèle",
    hint: () => "Modèle pour tes prochaines candidatures : remplace chaque passage entre [crochets].",
  },
};
const isLetter = (doc) => doc !== "cv";
const isEditing = () => $("#workspace").classList.contains("editing");

const letterBody = () => ({ letter: readLetter(), cv: readCv(), company: state.company, template: state.letterKey === "cover_letter_template" });
// La lettre de cette candidature, même quand l'éditeur affiche le modèle.
const currentLetter = () => (state.letterKey === "cover_letter" ? readLetter() : state.letters.cover_letter);

async function refreshPreview() {
  const el = $("#preview");
  const doc = state.doc;
  const ticket = (state.previewTicket = (state.previewTicket || 0) + 1);
  el.setAttribute("aria-busy", "true");
  try {
    const body = isLetter(doc) ? { type: "letter", ...letterBody() } : { type: "cv", cv: readCv() };
    const { pages } = await api("/api/preview", body);
    if (ticket !== state.previewTicket) return; // une version plus récente est en cours
    el.innerHTML = pages.map((p, i) => `
      <img src="${p.src}" width="${p.width}" height="${p.height}" alt="Aperçu ${DOCS[doc].name}, page ${i + 1} sur ${pages.length}" />
      ${pages.length > 1 ? `<p class="page-label">Page ${i + 1} sur ${pages.length}</p>` : ""}`).join("");
  } catch (e) {
    el.innerHTML = `<p class="preview-empty">L'aperçu n'a pas pu être généré : ${esc(e.message)}</p>`;
  } finally {
    if (ticket === state.previewTicket) el.setAttribute("aria-busy", "false");
  }
}

function setEditing(on) {
  $("#workspace").classList.toggle("editing", on);
  show("#cvEditPanel", on && !isLetter(state.doc));
  show("#letterEditPanel", on && isLetter(state.doc));
  $("#editBtn").setAttribute("aria-expanded", on);
  $("#editBtn").classList.toggle("hidden", on);
}

function selectDoc(doc) {
  if (isEditing()) setEditing(false);
  state.doc = doc;
  document.querySelectorAll("[data-doc]").forEach((b) => {
    b.classList.toggle("active", b.dataset.doc === doc);
    b.setAttribute("aria-selected", b.dataset.doc === doc);
  });
  show('[data-doc="cover_letter_template"]', doc === "cover_letter_template");
  if (isLetter(doc)) showLetter(doc);
  $("#previewHint").textContent = DOCS[doc].hint();
  $("#editLabel").textContent = DOCS[doc].edit;
  $("#letterEditTitle").textContent = DOCS[doc].edit;
  refreshPreview();
}

document.querySelectorAll("[data-doc]").forEach((b) => b.addEventListener("click", () => selectDoc(b.dataset.doc)));

// L'édition garde une copie pour pouvoir tout annuler.
$("#editBtn").addEventListener("click", () => {
  state.editSnapshot = isLetter(state.doc) ? readLetter() : readCv();
  setEditing(true);
  scrollToEl("#previewTitle");
});

$("#doneEditBtn").addEventListener("click", () => {
  if (isLetter(state.doc)) state.letters[state.doc] = readLetter();
  setEditing(false);
  renderSendStatus();
  scrollToEl("#previewTitle");
});

$("#cancelEditBtn").addEventListener("click", () => {
  if (isLetter(state.doc)) {
    state.letters[state.doc] = state.editSnapshot;
    $("#letterEditor").innerHTML = "";
    showLetter(state.doc);
  } else {
    renderCvEditor(state.editSnapshot);
    recheck();
  }
  setEditing(false);
  refreshPreview();
  renderSendStatus();
});

// Aperçu mis à jour pendant la frappe (le rendu prend une fraction de seconde).
function debounce(fn, ms) {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}
const livePreview = debounce(() => {
  refreshPreview();
  renderSendStatus();
}, 450);
const liveRecheck = debounce(recheck, 1200);
$("#cvEditor").addEventListener("input", () => { livePreview(); liveRecheck(); });
$("#cvEditor").addEventListener("click", (ev) => { if (ev.target.matches(".remove, [data-add]")) { livePreview(); liveRecheck(); } });
$("#letterEditor").addEventListener("input", livePreview);

// ---------- 3. Télécharger et envoyer ----------
function renderSendStatus() {
  if (!state.checks) return;
  const pending = state.checks.filter((c) => c.status === "pending").length;
  const brackets = [...new Set(letterAsText(currentLetter()).match(/\[[^\]]{2,60}\]/g) || [])];
  const items = [];
  items.push(pending
    ? `<li class="warn">${pending} point${pending > 1 ? "s" : ""} à vérifier dans la liste ci-dessus.</li>`
    : `<li class="ok">Points à vérifier : tout est traité.</li>`);
  items.push(brackets.length
    ? `<li class="warn">Ta lettre contient encore ${brackets.map(esc).join(", ")} : remplace-${brackets.length > 1 ? "les" : "le"} avant d'envoyer.</li>`
    : `<li class="ok">Lettre complète, sans [crochets] à remplir.</li>`);
  $("#sendStatus").innerHTML = items.join("");
}

// Texte brut de la lettre, sans en-tête d'adresse : ce qu'on colle dans un formulaire.
function letterAsText(l) {
  return [l.greeting, ...l.paragraphs, l.closing, readCv().full_name].filter((s) => s && s.trim()).join("\n\n");
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = Object.assign(document.createElement("textarea"), { value: text });
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  const label = btn.querySelector("span") || btn;
  const previous = label.textContent;
  label.textContent = "Copiée ✓";
  setTimeout(() => (label.textContent = previous), 1800);
}

$("#bundleBtn").addEventListener("click", () => download("/api/bundle", { cv: readCv(), letter: currentLetter(), company: state.company }));
$("#cvPdfBtn").addEventListener("click", () => download("/api/cv/pdf", { cv: readCv() }));
$("#letterPdfBtn").addEventListener("click", () => download("/api/letter/pdf", { letter: currentLetter(), cv: readCv(), company: state.company }));
$("#copyLetterBtn").addEventListener("click", (ev) => copyText(letterAsText(currentLetter()), ev.currentTarget));

// ---------- Et ensuite ----------
const currentTemplate = () => (state.letterKey === "cover_letter_template" ? readLetter() : state.letters.cover_letter_template);
$("#templateViewBtn").addEventListener("click", () => {
  selectDoc("cover_letter_template");
  scrollToEl("#previewTitle");
});
$("#templatePdfBtn").addEventListener("click", () => download("/api/letter/pdf", { letter: currentTemplate(), cv: readCv(), template: true }));
$("#templateCopyBtn").addEventListener("click", (ev) => copyText(letterAsText(currentTemplate()), ev.currentTarget));

// Nouvelle offre : on garde le CV, les infos d'alternance et les compétences confirmées.
$("#anotherOfferBtn").addEventListener("click", () => {
  ["#jobOffer", "#company", "#offerUrl"].forEach((id) => ($(id).value = ""));
  $("#urlStatus").textContent = "";
  state.adapted = null;
  state.jobOffer = "";
  state.company = "";
  show("#questionsBox", false);
  $("#refineIntro").textContent = "Donne la nouvelle offre : ton CV sera analysé pour elle, avec tes infos d'alternance déjà remplies.";
  $("#refine").classList.add("highlight");
  $("#reanalyzeBtn").classList.replace("secondary", "primary");
  // L'ancien résultat ne correspond plus à la nouvelle offre : on ne peut plus y revenir.
  state.reachable = new Set(["#refine"]);
  state.maxStep = 2;
  goTo("#refine");
  setTimeout(() => $("#offerUrl").focus({ preventScroll: true }), 350);
});

// ---------- Lettre de motivation ----------
function showLetter(key) {
  if (state.letterKey && $("#letterEditor").innerHTML) state.letters[state.letterKey] = readLetter();
  state.letterKey = key;
  const l = state.letters[key];
  $("#letterHint").textContent = key === "cover_letter"
    ? `Lettre rédigée pour ${state.company || "cette entreprise"}.`
    : "Garde les passages entre [crochets] : tu les rempliras pour chaque candidature.";
  $("#letterEditor").innerHTML = `
    ${field("Objet", "subject", l.subject)}
    ${field("Formule d'appel", "greeting", l.greeting)}
    ${field("Corps de la lettre (une ligne vide entre chaque paragraphe)", "paragraphs", l.paragraphs.join("\n\n"), "textarea", 14)}
    ${field("Formule de politesse", "closing", l.closing, "textarea", 2)}`;
}

function readLetter() {
  const g = (k) => $(`#letterEditor [data-k="${k}"]`).value.trim();
  return { subject: g("subject"), greeting: g("greeting"), paragraphs: g("paragraphs").split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean), closing: g("closing") };
}

$("#backBtn").addEventListener("click", () => goTo(neighbour(-1) || "#refine"));
$("#refineBackBtn").addEventListener("click", () => goTo("#results"));

$("#restartBtn").addEventListener("click", () => {
  $("#refineForm").reset();
  Object.assign(state, { file: null, analysis: null, adapted: null, jobOffer: "", company: "", checks: null });
  state.addedKeywords.clear();
  $("#letterEditor").innerHTML = "";
  PANELS.forEach((id) => show(id, false));
  state.panel = null;
  state.reachable = new Set();
  $("#hero").classList.remove("compact");
  $("#urlStatus").textContent = "";
  $("#reanalyzeBtn").classList.replace("primary", "secondary");
  setStep(1);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

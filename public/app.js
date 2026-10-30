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
    li.classList.toggle("active", n === step);
    li.classList.toggle("done", n < step);
    li.toggleAttribute("aria-current", n === step);
    li.querySelector(".step-btn").disabled = n > state.maxStep || n === step;
  });
}
document.querySelectorAll(".step-btn").forEach((btn) => btn.addEventListener("click", () => {
  const target = btn.dataset.target;
  if (target === "#hero") window.scrollTo({ top: 0, behavior: "smooth" });
  else scrollToEl(target);
}));
function setLoading(btn, loading) {
  btn.classList.toggle("loading", loading);
  btn.disabled = loading;
}

// ---------- Chargement : progression estimée et astuces ----------
// L'IA répond en un seul bloc : la progression est une estimation fondée sur la durée
// des traitements précédents, qui ralentit à l'approche de la fin puis saute à 100 %.
const LOADS = {
  analyze: {
    title: "Analyse de ton CV",
    expected: 110000,
    stages: [
      [0, "Lecture de ton fichier comme le ferait un ATS"],
      [8, "Vérification de la lisibilité et des sections"],
      [18, "Repérage des mots-clés attendus"],
      [32, "Analyse approfondie par l'IA"],
      [65, "Verdict pour chaque logiciel de recrutement"],
      [85, "Calcul de ton score final"],
    ],
  },
  adapt: {
    title: "Création de ton CV et de ta lettre",
    expected: 130000,
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

const TIPS = [
  "La plupart des grandes entreprises trient les candidatures avec un ATS avant qu'un humain ne les lise.",
  "Un recruteur parcourt souvent un CV en moins de 10 secondes : mets l'essentiel en haut.",
  "Reprends le titre exact de l'offre dans l'intitulé de ton CV : c'est souvent le premier filtre de l'ATS.",
  "Les ATS lisent mal les CV en deux colonnes : une seule colonne, c'est le plus sûr.",
  "Évite les barres de niveau et les étoiles pour tes compétences : un ATS ne sait pas les lire.",
  "Ne mets jamais ton e-mail ou ton téléphone dans l'en-tête du document : beaucoup d'ATS l'ignorent.",
  "Utilise des titres de section classiques : « Expérience », « Formation », « Compétences ».",
  "Commence chaque mission par un verbe d'action : « Géré », « Rédigé », « Analysé »…",
  "Un chiffre vaut mieux qu'un adjectif : « 12 articles publiés » plutôt que « nombreux articles ».",
  "Pour une alternance, indique ton rythme (ex. 3 semaines / 1 semaine) dès le titre du CV.",
  "Précise ta date de début et la durée du contrat : c'est la première question des entreprises.",
  "Nomme ton fichier « CV_Prénom_Nom_Alternance.pdf » : c'est plus pro et plus facile à retrouver.",
  "Envoie toujours ton CV en PDF texte, jamais en image ou en scan.",
  "Une page suffit pour une alternance : les recruteurs préfèrent la clarté à l'exhaustivité.",
  "Adapte ton CV à chaque offre : c'est ce qui fait le plus monter ton score de mots-clés.",
  "Les mots-clés doivent apparaître dans tes expériences, pas seulement dans une liste de compétences.",
  "Relance l'entreprise une semaine après ta candidature : peu de candidats le font, ça se remarque.",
  "Ta lettre de motivation doit parler de l'entreprise avant de parler de toi.",
  "L'école peut t'aider : beaucoup de CFA ont des listes d'entreprises qui cherchent des alternants.",
  "Postule tôt : les offres d'alternance pour septembre sont souvent pourvues dès le printemps.",
  "Ton profil LinkedIn doit raconter la même histoire que ton CV : les recruteurs vérifient.",
  "Les fautes d'orthographe font partie des premiers motifs de rejet : fais-toi relire.",
];

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const loader = { timer: null, tipTimer: null };

function expectedDuration(kind) {
  try {
    const past = JSON.parse(localStorage.getItem(`duree_${kind}`) || "[]");
    if (past.length) return past.reduce((a, b) => a + b, 0) / past.length;
  } catch {}
  return LOADS[kind].expected;
}
function rememberDuration(kind, ms) {
  try {
    const past = JSON.parse(localStorage.getItem(`duree_${kind}`) || "[]");
    localStorage.setItem(`duree_${kind}`, JSON.stringify([...past, ms].slice(-5)));
  } catch {}
}

function setProgress(pct) {
  $("#loaderPct").textContent = pct;
  $("#loaderBar").setAttribute("aria-valuenow", pct);
  $("#loaderBar .progress-fill").style.width = `${pct}%`;
}

const fmtTime = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

// Astuces écrites lettre par lettre, l'une après l'autre, dans un ordre aléatoire.
function startTips() {
  const order = [...TIPS.keys()].sort(() => Math.random() - 0.5);
  let n = 0;
  const next = () => {
    const tip = TIPS[order[n % order.length]];
    $("#tipCount").textContent = `${(n % order.length) + 1}/${TIPS.length}`;
    n++;
    const el = $("#tipText");
    if (reduceMotion) {
      el.textContent = tip;
      loader.tipTimer = setTimeout(next, 7000);
      return;
    }
    let i = 0;
    const type = () => {
      el.textContent = tip.slice(0, ++i);
      loader.tipTimer = i < tip.length ? setTimeout(type, 24) : setTimeout(erase, 4500);
    };
    const erase = () => {
      el.textContent = el.textContent.slice(0, -3);
      loader.tipTimer = el.textContent ? setTimeout(erase, 10) : setTimeout(next, 250);
    };
    type();
  };
  next();
}

function startLoader(kind) {
  const cfg = LOADS[kind];
  const expected = expectedDuration(kind);
  const started = Date.now();
  Object.assign(loader, { kind, started });
  $("#overlay").classList.remove("hidden", "finished");
  $("#loaderTitle").textContent = cfg.title;
  setProgress(0);

  const tick = () => {
    const elapsed = Date.now() - started;
    const pct = Math.min(97, Math.floor(97 * (1 - Math.exp((-2.4 * elapsed) / expected))));
    setProgress(pct);
    $("#loaderStage").textContent = cfg.stages.filter(([from]) => pct >= from).at(-1)[1];
    $("#loaderMeta").textContent = elapsed > expected * 1.15
      ? `${fmtTime(elapsed)} écoulées · les modèles gratuits sont chargés, ça arrive…`
      : `${fmtTime(elapsed)} écoulées · environ ${fmtTime(Math.max(0, expected - elapsed))} restantes`;
  };
  tick();
  clearInterval(loader.timer);
  loader.timer = setInterval(tick, 400);
  clearTimeout(loader.tipTimer);
  startTips();
}

// Termine le chargement : en cas de succès, la barre se remplit avant de disparaître.
async function stopLoader(success) {
  clearInterval(loader.timer);
  if (success) {
    rememberDuration(loader.kind, Date.now() - loader.started);
    $("#overlay").classList.add("finished");
    setProgress(100);
    $("#loaderStage").textContent = "Terminé !";
    await new Promise((r) => setTimeout(r, 700));
  }
  clearTimeout(loader.tipTimer);
  $("#overlay").classList.add("hidden");
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
  if (file.size > 10 * 1024 * 1024) return toast("Fichier trop lourd (10 Mo maximum).");
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

  startLoader("analyze");
  let analysis;
  try {
    analysis = await api("/api/analyze", fd);
  } catch (e) {
    await stopLoader(false);
    toast(e.message);
    return false;
  }
  await stopLoader(true);
  state.analysis = analysis;
  state.jobOffer = fd.get("jobOffer");
  state.company = fd.get("company") || analysis.company || "";
  $("#fileName").textContent = state.file.name;
  $("#hero").classList.add("compact");
  renderAnalysis(analysis);
  renderRefine(analysis);
  $("#reanalyzeBtn").classList.replace("primary", "secondary");
  show("#results");
  show("#refine");
  show("#adapted", false);
  setStep(2);
  scrollToEl("#results");
  return true;
}

// ---------- Résultat ----------
const ATS_STATE = { ok: "lu correctement", risque: "risque de mauvaise lecture", ko: "bloquant" };
const IMPACT_ORDER = { fort: 0, moyen: 1, faible: 2 };
const IMPORTANCE_ORDER = { essentiel: 0, important: 1, bonus: 2 };
const normKey = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Une tuile n'est mise en alerte que si son score demande une action.
const needsAction = (score) => score < 75;

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

  // Tuiles
  const failed = a.checks.filter((c) => !c.ok).length;
  const missing = a.keywords.filter((k) => !k.present).length;
  const tiles = [
    { label: "Analyse IA", value: `${a.breakdown.ia}/100`, note: "Avis global sur ton CV", score: a.breakdown.ia },
    {
      label: "Lisibilité",
      value: `${a.breakdown.format}/100`,
      note: failed ? `${failed} point${failed > 1 ? "s" : ""} technique${failed > 1 ? "s" : ""} à revoir` : "Ton fichier est bien lu",
      score: a.breakdown.format,
    },
    {
      label: "Mots-clés",
      value: `${a.breakdown.motsCles} %`,
      note: missing ? `${missing} sur ${a.keywords.length} manquant${missing > 1 ? "s" : ""}` : "Tous présents",
      score: a.breakdown.motsCles,
    },
  ];
  $("#tiles").innerHTML = tiles.map((t) => `
    <div class="tile${needsAction(t.score) ? " alert" : ""}">
      <p class="tile-label">${t.label}</p>
      <p class="tile-value">${t.value}</p>
      <p class="tile-note">${t.note}</p>
    </div>`).join("");

  // Corrections : triées par impact, doublons retirés.
  const seen = new Set();
  const fixes = a.ai.priority_fixes
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
  renderKeywords(state.analysis.keywords);
  if (!$("#adapted").classList.contains("hidden")) syncAddedSkill(kw, added);
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
    scrollToEl("#refine");
    setTimeout(() => focus?.focus({ preventScroll: true }), 500);
  };
  const adapt = () => $("#adaptBtn").click();
  const config = a.hasOffer
    ? {
        text: "Adapte ton CV à cette offre et récupère ta lettre de motivation.",
        primary: ["Adapter mon CV et créer ma lettre", adapt],
        secondary: ["Ajouter des infos d'abord", () => { $("#profileBox").open = true; toRefine($("#profileBox summary"))(); }],
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
  } catch (e) {
    urlStatus("error", esc(e.message));
  } finally {
    setLoading(importBtn, false);
  }
}

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
    state.adapted = await api("/api/adapt", {
      cvText: state.analysis.cvText,
      jobOffer: state.jobOffer,
      company: state.company,
      analysis: { ...state.analysis.ai, keywords: state.analysis.keywords },
      profile: profile(),
    });
  } catch (e) {
    await stopLoader(false);
    toast(e.message);
    return;
  }
  await stopLoader(true);
  renderAdapted();
  show("#adapted");
  setStep(3);
  scrollToEl("#adapted");
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
  $("#missingBox").innerHTML = a.missing_not_added.length
    ? `<h3>À vérifier avant d'envoyer</h3>
       <p>Ces attentes de l'offre ne figurent pas dans ton parcours, donc rien n'a été ajouté. Ajoute-les dans l'éditeur seulement si tu les maîtrises.</p>
       <ul>${a.missing_not_added.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`
    : "";
  state.letters = { cover_letter: a.cover_letter, cover_letter_template: a.cover_letter_template };
  $("#letterEditor").innerHTML = "";
  showLetter("cover_letter");
}

async function recheck() {
  try {
    const r = await api("/api/cv/check", { cv: readCv(), keywords: state.analysis.ai.keywords });
    const b = state.analysis.breakdown;
    const before = Math.round((b.format + b.motsCles) / 2);
    $("#compare").innerHTML = `
      <div class="score-step"><small>Avant</small><b>${before}</b></div>
      <span class="arrow" aria-hidden="true">→</span>
      <div class="score-step after${r.score < 75 ? " low" : ""}"><small>Après</small><b>${r.score}</b></div>
      <div>
        <span class="verdict v-${r.verdict}">${VERDICT_LABEL[r.verdict]}</span>
        <p class="compare-note">Score technique sur 100, mesuré en relisant le PDF généré : lisibilité ${b.format} → ${r.breakdown.format}, mots-clés ${b.motsCles} % → ${r.breakdown.motsCles} %.</p>
      </div>`;
  } catch (e) {
    toast(e.message);
  }
}

$("#recheckBtn").addEventListener("click", recheck);
$("#cvPdfBtn").addEventListener("click", () => download("/api/cv/pdf", { cv: readCv() }));
$("#cvPdfTopBtn").addEventListener("click", () => download("/api/cv/pdf", { cv: readCv() }));
$("#toLetterBtn").addEventListener("click", () => scrollToEl("#letterTitle"));

// ---------- Lettre de motivation ----------
function showLetter(key) {
  if (state.letterKey && $("#letterEditor").innerHTML) state.letters[state.letterKey] = readLetter();
  state.letterKey = key;
  const l = state.letters[key];
  document.querySelectorAll("[data-letter]").forEach((b) => b.classList.toggle("active", b.dataset.letter === key));
  $("#letterHint").textContent = key === "cover_letter"
    ? `Lettre rédigée pour ${state.company || "cette entreprise"}. Relis-la et personnalise-la avant envoi.`
    : "Modèle à réutiliser : remplace chaque passage entre [crochets] pour chaque nouvelle candidature.";
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

document.querySelectorAll("[data-letter]").forEach((b) => b.addEventListener("click", () => showLetter(b.dataset.letter)));

const letterBody = () => ({ letter: readLetter(), cv: readCv(), company: state.company, template: state.letterKey === "cover_letter_template" });
$("#letterPdfBtn").addEventListener("click", () => download("/api/letter/pdf", letterBody()));
$("#letterTxtBtn").addEventListener("click", () => download("/api/letter/txt", letterBody()));

$("#backBtn").addEventListener("click", () => scrollToEl("#results"));

$("#restartBtn").addEventListener("click", () => {
  $("#refineForm").reset();
  Object.assign(state, { file: null, analysis: null, adapted: null, jobOffer: "", company: "" });
  state.addedKeywords.clear();
  $("#letterEditor").innerHTML = "";
  ["#results", "#refine", "#adapted"].forEach((id) => show(id, false));
  $("#hero").classList.remove("compact");
  $("#urlStatus").textContent = "";
  $("#reanalyzeBtn").classList.replace("primary", "secondary");
  setStep(1);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

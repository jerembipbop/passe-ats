const $ = (sel) => document.querySelector(sel);
const state = { file: null, analysis: null, adapted: null, jobOffer: "", company: "", letterKey: "cover_letter" };

const VERDICT_LABEL = { passe: "Passe les ATS", limite: "Passage incertain", rejet_probable: "Rejet probable" };
const ATS_LABEL = { ok: "OK", risque: "Risque", ko: "Bloquant" };

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
function setStep(step) {
  document.querySelectorAll(".stepper li").forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle("active", n === step);
    li.classList.toggle("done", n < step);
    li.toggleAttribute("aria-current", n === step);
  });
}
function setLoading(btn, loading) {
  btn.classList.toggle("loading", loading);
  btn.disabled = loading;
}

function busy(text) {
  $("#overlayText").textContent = text;
  $("#overlay").classList.toggle("hidden", !text);
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
  return p;
}

async function runAnalysis() {
  const fd = new FormData();
  fd.append("cv", state.file);
  fd.append("jobOffer", $("#jobOffer").value.trim());
  fd.append("company", $("#company").value.trim());
  fd.append("profile", JSON.stringify(profile()));

  busy(fd.get("jobOffer")
    ? "Comparaison de ton CV avec l'offre… (1 à 2 minutes avec les modèles gratuits)"
    : "Lecture de ton CV comme un ATS, puis analyse par l'IA… (1 à 2 minutes avec les modèles gratuits)");
  try {
    const analysis = await api("/api/analyze", fd);
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
  } catch (e) {
    toast(e.message);
    return false;
  } finally {
    busy(null);
  }
}

// ---------- Résultat ----------
function setGauge(el, score) {
  el.style.setProperty("--v", score);
  el.style.setProperty("--c", score >= 75 ? "var(--ok)" : score >= 55 ? "var(--warn)" : "var(--ko)");
}

function renderAnalysis(a) {
  setGauge($("#gauge"), a.score);
  $("#scoreValue").textContent = a.score;
  $("#verdict").className = `verdict v-${a.verdict}`;
  $("#verdict").textContent = VERDICT_LABEL[a.verdict];
  $("#context").textContent = a.hasOffer
    ? `comparé à l'offre${state.company ? ` · ${state.company}` : ""}`
    : `analyse générale${a.ai.detected_job_title ? ` · ${a.ai.detected_job_title}` : ""}`;
  $("#summary").textContent = a.ai.summary;
  $("#breakdown").innerHTML = `
    <span>Analyse IA <b>${a.breakdown.ia}</b></span>
    <span>Lisibilité du fichier <b>${a.breakdown.format}</b></span>
    <span>Mots-clés trouvés <b>${a.breakdown.motsCles}%</b></span>
    ${a.ai.model ? `<span>Modèle IA <b>${esc(a.ai.model.replace(/:free$/, ""))}</b></span>` : ""}`;

  $("#atsGrid").innerHTML = a.ai.ats_systems.map((s) => `
    <div class="ats ${s.verdict}"><span class="tag">${ATS_LABEL[s.verdict]}</span><strong>${esc(s.name)}</strong>${esc(s.reason)}</div>`).join("");

  $("#keywordsHint").textContent = a.hasOffer
    ? "Mots-clés de l'offre. En vert : trouvés dans ton CV. En rouge : absents (c'est sur eux que l'ATS te filtre)."
    : "Mots-clés habituellement attendus pour ce poste. Ajoute l'offre visée ci-dessous pour une vérification précise.";
  renderKeywords($("#keywords"), a.keywords);

  $("#checks").innerHTML = a.checks.map((c) => `
    <li class="${c.ok ? "" : "fail"}">${esc(c.label)}${c.ok ? "" : `<small>${esc(c.detail)}</small>`}</li>`).join("");

  $("#issues").innerHTML = a.ai.parsing_issues.length
    ? a.ai.parsing_issues.map((i) => `<li><span class="sev ${i.severity}">${i.severity}</span>${esc(i.issue)}<small>→ ${esc(i.fix)}</small></li>`).join("")
    : "<li>Aucun problème majeur détecté.</li>";

  $("#sections").innerHTML = a.ai.section_feedback.map((s) => `<li><strong>${esc(s.section)}</strong><small>${esc(s.feedback)}</small></li>`).join("");
  $("#rawText").textContent = a.cvText || "(aucun texte extrait)";
}

function renderKeywords(el, keywords) {
  const order = { essentiel: 0, important: 1, bonus: 2 };
  el.innerHTML = [...keywords]
    .sort((x, y) => (x.present - y.present) || (order[x.importance] - order[y.importance]))
    .map((k) => `<span class="chip ${k.present ? "yes" : "no"} ${k.importance}" title="${esc(k.importance)}">${esc(k.keyword)} <small>${k.importance === "essentiel" ? "★" : ""}</small></span>`)
    .join("");
}

// ---------- Affinage selon le résultat ----------
function renderRefine(a) {
  let intro;
  if (!a.hasOffer) {
    intro = "Ce résultat est général. Pour savoir si ton CV passe pour une entreprise précise, colle l'offre visée : l'ATS te filtre d'abord sur ses mots-clés.";
  } else if (a.verdict !== "passe") {
    intro = "Ton CV peut encore progresser. Réponds aux points ci-dessous si tu le peux, puis relance l'analyse ou passe directement à l'adaptation.";
  } else {
    intro = "Ton CV passe pour cette offre. Tu peux l'adapter tout de suite, ou compléter les infos pour une lettre plus personnalisée.";
  }
  $("#refineIntro").textContent = intro;
  $("#suggestions").innerHTML = (a.ai.refine_suggestions || []).map((s) => `<li>${esc(s)}</li>`).join("");
  $("#refine").classList.toggle("highlight", !a.hasOffer || a.verdict !== "passe");
  if (a.verdict !== "passe") $("#profileBox").open = true;
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
  busy("Réécriture de ton CV et rédaction de ta lettre de motivation… (2 à 3 minutes avec les modèles gratuits)");
  try {
    state.adapted = await api("/api/adapt", {
      cvText: state.analysis.cvText,
      jobOffer: state.jobOffer,
      company: state.company,
      analysis: { ...state.analysis.ai, keywords: state.analysis.keywords },
      profile: profile(),
    });
    renderAdapted();
    show("#adapted");
    setStep(3);
    scrollToEl("#adapted");
    await recheck();
  } catch (e) {
    toast(e.message);
  } finally {
    busy(null);
  }
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
  $("#missingBox").innerHTML = a.missing_not_added.length
    ? `<strong>Mots-clés non ajoutés car absents de ton parcours :</strong> ${a.missing_not_added.map(esc).join(", ")}.<br>Si tu les maîtrises vraiment, ajoute-les toi-même dans l'éditeur ci-dessous : ils feront monter ton score.`
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
    const color = (s) => (s >= 75 ? "v-passe" : s >= 55 ? "v-limite" : "v-rejet_probable");
    $("#compare").innerHTML = `
      <span>Score technique avant : <span class="pill ${color(before)}">${before}/100</span></span>
      <span>→ après : <span class="pill ${color(r.score)}">${r.score}/100</span></span>
      <span class="verdict v-${r.verdict}">${VERDICT_LABEL[r.verdict]}</span>
      <small class="hint" style="width:100%">Mesuré en relisant le PDF généré comme un ATS : lisibilité ${b.format} → ${r.breakdown.format}/100, mots-clés trouvés ${b.motsCles}% → ${r.breakdown.motsCles}%.</small>`;
  } catch (e) {
    toast(e.message);
  }
}

$("#recheckBtn").addEventListener("click", recheck);
$("#cvPdfBtn").addEventListener("click", () => download("/api/cv/pdf", { cv: readCv() }));

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
  $("#letterEditor").innerHTML = "";
  ["#results", "#refine", "#adapted"].forEach((id) => show(id, false));
  $("#hero").classList.remove("compact");
  $("#urlStatus").textContent = "";
  $("#reanalyzeBtn").classList.replace("primary", "secondary");
  setStep(1);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

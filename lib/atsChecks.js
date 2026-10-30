// Vérifications déterministes, indépendantes de l'IA : ce qu'un parseur ATS
// arrive (ou non) à lire dans le fichier.

export function normalize(str) {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Un titre de section n'est reconnu que s'il occupe une ligne courte : un mot comme
// « stage » au milieu d'une phrase ne fait pas une section aux yeux d'un ATS.
const SECTION_PATTERNS = {
  "Expérience": /\b(experiences?|parcours professionnel|emplois?)\b/,
  "Formation": /\b(formations?|education|diplomes?|etudes|cursus)\b/,
  "Compétences": /\b(competences|skills|savoir-faire|outils|technologies)\b/,
  "Langues": /\b(langues|languages)\b/,
};
const MAX_HEADING_LENGTH = 45;

// Mots courants qui commencent légitimement une ligne avant un mot en minuscules.
const SHORT_WORDS = new Set("le la les un une de des du en au aux et je il on ma mon ta ton sa son ce se ne sur par pour avec dans".split(" "));

// Titres écrits en lettres espacées (« c o m p é t e n c e s ») : un ATS lit des lettres isolées.
function spacedLetterRuns(text) {
  return text.match(/(?:^|\s)(?:\p{L} ){3,}\p{L}(?=\s|$)/gmu) || [];
}

// Premier mot coupé par une lettrine (« R elancer », « Opt imiser ») : le mot devient illisible.
function splitFirstWords(text) {
  return text.split("\n").filter((line) => {
    const m = line.trim().match(/^(\p{Lu}\p{Ll}{0,2}) (\p{Ll}{3,})/u);
    return m && !SHORT_WORDS.has(m[1].toLowerCase());
  });
}

// Correction concrète pour chaque test en échec. Elle est rédigée ici, une seule fois,
// pour que l'IA n'ait pas à la reformuler (et ne la répète pas sous une autre forme).
function fixFor(label, { spaced, split }) {
  if (label.startsWith("Texte lisible")) return "Exporte ton CV en PDF depuis ton logiciel (Word, Canva, Google Docs) au lieu d'un scan ou d'une image.";
  if (label.startsWith("Adresse e-mail")) return "Écris ton adresse e-mail en texte dans le corps du CV, pas dans une image ni dans l'en-tête du document.";
  if (label.startsWith("Numéro de téléphone")) return "Écris ton numéro de téléphone en texte, au format 06 12 34 56 78.";
  if (label.startsWith("Section")) return `Ajoute un titre « ${label.match(/« (.+) »/)[1]} » écrit normalement, sur sa propre ligne.`;
  if (label.startsWith("Titres écrits")) return `Écris tes titres de section sans espaces entre les lettres : « ${spaced[0].trim().replace(/ /g, "")} » au lieu de « ${spaced[0].trim()} ». Règle l'espacement dans la mise en forme.`;
  if (label.startsWith("Mots entiers")) return `Retire la lettrine qui coupe le premier mot de tes lignes (« ${split[0].trim().split(" ").slice(0, 2).join(" ")} » est lu comme deux mots).`;
  if (label.startsWith("Longueur")) return "Réduis ton CV à une page : c'est ce qu'attendent les recruteurs en alternance.";
  if (label.startsWith("Pas de tableaux")) return "Remplace les tableaux par du texte simple, sur une seule colonne.";
  return "Remplace les icônes et les polices spéciales par du texte, par exemple « Téléphone : » ou « E-mail : ».";
}

// Sujets des tests techniques : une correction de l'IA sur le même sujet ferait doublon.
const TEST_TOPICS = [
  { label: "Titres écrits", re: /espac|titres?\b[^.]*normal|lettres? (isolées|séparées)/i },
  { label: "Mots entiers", re: /lettrine|mots? coupés?|premier mot/i },
  { label: "Section", re: /(titre|section)s?\b[^.]*(«|intitul|unique|clair|propre ligne|sa ligne)|intitul/i },
  { label: "Adresse e-mail", re: /coordonn|e-mail|email/i },
  { label: "Numéro de téléphone", re: /coordonn|téléphone/i },
  { label: "Pas de tableaux", re: /tableau/i },
  { label: "Pas de caractères", re: /icône|police/i },
];

// Retire les corrections de l'IA qui répètent un test technique en échec.
export function withoutTestDuplicates(aiFixes, checks) {
  const failed = checks.filter((c) => !c.ok).map((c) => c.label);
  // Des titres en lettres espacées empêchent aussi de reconnaître les sections.
  if (failed.some((l) => l.startsWith("Titres écrits"))) failed.push("Section");
  const topics = TEST_TOPICS.filter((t) => failed.some((l) => l.startsWith(t.label)));
  return aiFixes.filter((f) => !topics.some((t) => t.re.test(f.action)));
}

// Corrections issues des tests techniques, à placer avant celles de l'IA. Quand les titres
// sont en lettres espacées, les sections « non reconnues » en découlent : une seule correction suffit.
export function technicalFixes(checks) {
  const failed = checks.filter((c) => !c.ok);
  const spacedTitles = failed.some((c) => c.label.startsWith("Titres écrits"));
  return failed
    .filter((c) => !(spacedTitles && c.label.startsWith("Section")))
    .map((c) => ({ action: c.fix, impact: c.severity === "mineur" ? "faible" : "fort", source: "test" }));
}

export function runFormatChecks(extracted) {
  const text = extracted.text || "";
  const checks = [];
  const add = (label, ok, severity, detail) => checks.push({ label, ok, severity, detail });

  const len = text.replace(/\s/g, "").length;
  add(
    "Texte lisible par une machine",
    len >= 300,
    "critique",
    len >= 300
      ? `${len} caractères extraits.`
      : `Seulement ${len} caractères extraits : le CV est probablement une image ou un scan. Un ATS le verra presque vide.`
  );

  add(
    "Adresse e-mail détectée",
    /[\w.+-]+@[\w-]+\.[\w.-]+/.test(text),
    "critique",
    "Les ATS remplissent ta fiche candidat à partir de l'e-mail trouvé dans le texte."
  );

  add(
    "Numéro de téléphone détecté",
    /(\+33|0033|\b0)\s*[1-9](?:[\s.-]*\d{2}){4}/.test(text) || /\+\d[\d\s.-]{8,}/.test(text),
    "important",
    "Format conseillé : 06 12 34 56 78 ou +33 6 12 34 56 78."
  );

  const shortLines = text.split("\n").map((l) => normalize(l).trim()).filter((l) => l && l.length <= MAX_HEADING_LENGTH);
  for (const [name, re] of Object.entries(SECTION_PATTERNS)) {
    add(
      `Section « ${name} » reconnue`,
      shortLines.some((l) => re.test(l)),
      name === "Langues" ? "mineur" : "important",
      "Les ATS classent le contenu grâce à des titres de section standards, écrits normalement sur leur propre ligne."
    );
  }

  const spaced = spacedLetterRuns(text);
  add(
    "Titres écrits normalement (sans lettres espacées)",
    spaced.length === 0,
    "important",
    spaced.length
      ? `${spaced.length} titre${spaced.length > 1 ? "s" : ""} en lettres espacées, par exemple « ${spaced[0].trim()} » : un ATS lit des lettres isolées et ne reconnaît pas la section. Écris-les normalement et règle l'espacement dans la mise en forme.`
      : "Aucun titre en lettres espacées."
  );

  const split = splitFirstWords(text);
  add(
    "Mots entiers (pas de lettrine qui coupe le premier mot)",
    split.length < 3,
    "important",
    split.length >= 3
      ? `${split.length} lignes commencent par un mot coupé, par exemple « ${split[0].trim().slice(0, 30)} » : l'ATS ne reconnaît pas ces mots. Retire la lettrine ou l'effet de première lettre.`
      : "Les premiers mots des lignes sont lus en entier."
  );

  if (extracted.pages != null) {
    add(
      "Longueur adaptée (1 à 2 pages)",
      extracted.pages <= 2,
      "mineur",
      `${extracted.pages} page(s). Pour une alternance, 1 page est idéale.`
    );
  }

  if (extracted.kind === "docx") {
    add(
      "Pas de tableaux",
      !extracted.hasTables,
      "important",
      "Les tableaux mélangent souvent l'ordre de lecture dans Taleo, iCIMS ou Workday."
    );
  }

  const weird = (text.match(/[-�]/g) || []).length;
  add(
    "Pas de caractères illisibles (icônes, polices spéciales)",
    weird < 5,
    "important",
    weird < 5 ? "Aucun symbole problématique." : `${weird} caractères illisibles trouvés (icônes ou polices non standard).`
  );

  for (const c of checks) if (!c.ok) c.fix = fixFor(c.label, { spaced, split });

  const weights = { critique: 30, important: 12, mineur: 5 };
  const penalty = checks.filter((c) => !c.ok).reduce((s, c) => s + weights[c.severity], 0);
  return { checks, score: Math.max(0, 100 - penalty) };
}

// Vérifie la présence des mots-clés de l'offre directement dans le texte extrait.
const tightenSymbols = (s) => s.replace(/\s*([/&+])\s*/g, "$1");

export function keywordCoverage(text, keywords) {
  const norm = ` ${tightenSymbols(normalize(text))} `;
  const weight = { essentiel: 3, important: 2, bonus: 1 };
  let total = 0;
  let found = 0;

  const results = keywords.map((k) => {
    const forms = [k.keyword, ...(k.variants || [])].map((f) => tightenSymbols(normalize(f)).trim()).filter(Boolean);
    const present = forms.some((f) => {
      const escaped = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(norm);
    });
    const w = weight[k.importance] || 1;
    total += w;
    if (present) found += w;
    return { ...k, present };
  });

  return { keywords: results, score: total ? Math.round((found / total) * 100) : 100 };
}

export function combinedScore(aiScore, formatScore, keywordScore) {
  return Math.round(aiScore * 0.4 + formatScore * 0.3 + keywordScore * 0.3);
}

// Un CV jugé bloquant par au moins un ATS ne peut pas recevoir le verdict « passe » :
// la note est ramenée juste sous le seuil pour rester cohérente avec ce verdict.
export function capForBlockingAts(report, atsSystems) {
  const blocking = (atsSystems || []).filter((s) => s.verdict === "ko").map((s) => s.name);
  if (!blocking.length || report.score < 75) return report;
  return { ...report, score: 74, verdict: verdictFor(74), cappedBy: blocking };
}

export function verdictFor(score) {
  if (score >= 75) return "passe";
  if (score >= 55) return "limite";
  return "rejet_probable";
}

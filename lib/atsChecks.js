// Vérifications déterministes, indépendantes de l'IA : ce qu'un parseur ATS
// arrive (ou non) à lire dans le fichier.

export function normalize(str) {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const SECTION_PATTERNS = {
  "Expérience": /(experience|parcours professionnel|emplois?|stages?)/,
  "Formation": /(formation|education|diplomes?|etudes|cursus)/,
  "Compétences": /(competences|skills|savoir-faire|outils|technologies)/,
  "Langues": /(langues|languages)/,
};

export function runFormatChecks(extracted) {
  const text = extracted.text || "";
  const norm = normalize(text);
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

  for (const [name, re] of Object.entries(SECTION_PATTERNS)) {
    add(
      `Section « ${name} » reconnue`,
      re.test(norm),
      name === "Langues" ? "mineur" : "important",
      "Les ATS classent le contenu grâce à des titres de section standards."
    );
  }

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

  const weights = { critique: 30, important: 12, mineur: 5 };
  const penalty = checks.filter((c) => !c.ok).reduce((s, c) => s + weights[c.severity], 0);
  return { checks, score: Math.max(0, 100 - penalty) };
}

// Vérifie la présence des mots-clés de l'offre directement dans le texte extrait.
export function keywordCoverage(text, keywords) {
  const norm = ` ${normalize(text)} `;
  const weight = { essentiel: 3, important: 2, bonus: 1 };
  let total = 0;
  let found = 0;

  const results = keywords.map((k) => {
    const forms = [k.keyword, ...(k.variants || [])].map(normalize).filter(Boolean);
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

export function verdictFor(score) {
  if (score >= 75) return "passe";
  if (score >= 55) return "limite";
  return "rejet_probable";
}

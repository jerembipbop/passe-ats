import { callLlm } from "./llm.js";

const str = { type: "string" };
const strArr = { type: "array", items: str };
const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const enumOf = (...values) => ({ type: "string", enum: values });

// L'analyse est découpée en deux appels lancés en parallèle : chacun produit moins de texte,
// donc répond plus vite, et la liste de mots-clés d'une offre peut être préparée à l'avance.
const KEYWORDS_SCHEMA = obj({
  detected_job_title: str,
  detected_company: str,
  keywords: {
    type: "array",
    items: obj({
      keyword: str,
      variants: strArr,
      category: enumOf("hard_skill", "soft_skill", "outil", "diplome", "langue", "autre"),
      importance: enumOf("essentiel", "important", "bonus"),
    }),
  },
});

const DIAGNOSIS_SCHEMA = obj({
  score: { type: "integer", description: "Note de compatibilité ATS globale de 0 à 100" },
  summary: str,
  next_step: {
    type: "string",
    description: "Une seule phrase à l'impératif qui dit au candidat la chose la plus utile à faire maintenant",
  },
  priority_fixes: {
    type: "array",
    description: "Corrections à faire, de la plus impactante à la moins impactante, sans doublon",
    items: obj({ action: str, impact: enumOf("fort", "moyen", "faible") }),
  },
  ats_systems: {
    type: "array",
    items: obj({ name: str, verdict: enumOf("ok", "risque", "ko"), reason: str }),
  },
  section_feedback: { type: "array", items: obj({ section: str, feedback: str }) },
  refine_suggestions: {
    type: "array",
    description: "Informations que le candidat devrait fournir pour affiner l'analyse et l'adaptation",
    items: str,
  },
});

const LETTER = obj({
  subject: str,
  greeting: str,
  paragraphs: strArr,
  closing: str,
});

const ADAPT_SCHEMA = obj({
  cv: obj({
    full_name: str,
    headline: str,
    contact: obj({ email: str, phone: str, city: str, linkedin: str, other: str }),
    summary: str,
    experiences: {
      type: "array",
      items: obj({ title: str, company: str, location: str, start: str, end: str, bullets: strArr }),
    },
    education: {
      type: "array",
      items: obj({ degree: str, school: str, location: str, start: str, end: str, details: str }),
    },
    skills: { type: "array", items: obj({ category: str, items: strArr }) },
    languages: { type: "array", items: obj({ language: str, level: str }) },
    certifications: strArr,
    projects: { type: "array", items: obj({ name: str, description: str }) },
    interests: strArr,
  }),
  changes: strArr,
  missing_not_added: { type: "array", items: obj({ keyword: str, reason: str }) },
  cover_letter: LETTER,
  cover_letter_template: LETTER,
});

const KEYWORDS_SYSTEM = `Tu es un expert du recrutement en France et des logiciels ATS (Applicant Tracking Systems).
Tu listes les mots-clés sur lesquels un ATS filtrera les candidatures pour une offre d'alternance.
- Donne 12 à 20 mots-clés réellement attendus : compétences, outils, diplôme visé, langues, savoir-être. Chaque mot-clé fait 1 à 4 mots.
- "variants" : 0 à 4 synonymes, abréviations, équivalences ou formes FR/EN qu'un ATS accepterait (ex. "Power BI" -> ["PowerBI"] ; "Bac+3" -> ["Bachelor", "Licence"] ; "Google Analytics 4" -> ["GA4"]).
- Ne liste pas les conditions du contrat (durée, rythme, type de contrat, lieu, date de début) : ce ne sont pas des compétences sur lesquelles un ATS classe les CV.
- "importance" : "essentiel" pour ce qui est exigé, "important" pour ce qui est demandé, "bonus" pour le reste.
- Sans offre fournie : déduis du CV le poste en alternance visé (dans detected_job_title) et liste les mots-clés que les recruteurs attendent habituellement pour ce poste.
- Si l'entreprise n'est pas nommée, mets "" dans detected_company.
Réponds en français, de façon concise.`;

const DIAGNOSIS_SYSTEM = `Tu es un expert du recrutement en France et des logiciels ATS : Workday, Taleo (Oracle), SAP SuccessFactors, iCIMS, Greenhouse, Lever, SmartRecruiters, Teamtailor, Welcome to the Jungle, Flatchr, Jobaffinity et Beetween.

Tu évalues si un CV passera le filtrage automatique pour une offre d'alternance précise.
- Tu reçois le texte brut tel qu'un parseur ATS l'extrait du fichier, et le résultat de tests techniques automatiques. Repère dans ce texte les signes de problèmes de lecture : phrases coupées ou mélangées (mise en page en colonnes), dates séparées de leur poste, coordonnées absentes (souvent placées dans un en-tête ou une image), symboles parasites, sections introuvables.
- "ats_systems" : un verdict réaliste pour chaque ATS listé, basé sur ses limites de parsing connues (ex. Taleo et iCIMS gèrent mal les colonnes et tableaux, Workday perd souvent les en-têtes de document, Greenhouse et Lever lisent bien les PDF simples). "reason" fait 12 mots au plus.
- "priority_fixes" : 3 à 6 corrections, triées par impact sur le passage des ATS (la plus importante en premier). Chaque ligne est UNE action concrète à l'impératif, en une phrase courte (ex. "Ajoute « HubSpot » dans tes compétences si tu l'as déjà utilisé"). Pas de doublon : regroupe ce qui se recoupe, et ne répète pas la même idée sous deux formes. Les tests techniques en échec sont déjà affichés au candidat avec leur correction : ne les reprends pas (titres en lettres espacées, lettrines, sections non reconnues, coordonnées, tableaux, icônes). Concentre-toi sur ce que les tests ne voient pas : ordre de lecture, contenu, mots-clés, cohérence. Chaque ligne traite un problème différent. Si le CV est déjà très bon, 1 ou 2 lignes suffisent.
- "next_step" : une seule phrase à l'impératif qui résume quoi faire maintenant (ex. "Ajoute les 4 mots-clés manquants de l'offre, puis adapte ton CV").
- "summary" : 2 phrases au plus.
- "section_feedback" : 2 à 4 sections, une phrase chacune.
- "refine_suggestions" : 2 à 4 informations concrètes que le candidat devrait ajouter pour affiner le résultat (ex. l'offre visée si elle manque, le rythme d'alternance, des outils maîtrisés qu'il ne cite pas, des résultats chiffrés). Formule-les comme des questions courtes qui s'adressent à lui.
- Sans offre fournie : évalue la compatibilité ATS générale du CV pour le type d'alternance qu'il vise.
- Ne propose jamais d'inventer un résultat : suggère de chiffrer une expérience seulement « si tu as les données », sans donner de chiffre en exemple.
- Ne signale jamais une date comme problème : une expérience terminée a une date de fin passée, une formation en cours a une date de fin future. La date du jour est fournie.
- Vérifie chaque correction avant de la donner : elle doit reposer sur ce que contient réellement le CV.
- Ne signale un problème de coordonnées (e-mail, téléphone) que si les tests techniques indiquent qu'elles ne sont pas détectées.
- "refine_suggestions" : ne pose jamais une question dont la réponse figure déjà dans le CV ou dans les infos fournies (poste visé, rythme, date de début, résultats chiffrés, outils…). Relis le CV avant de poser chaque question.
- Sois franc, concret et bref, en phrases à la casse normale (pas de majuscules pour insister).
Réponds en français.`;

const ADAPT_SYSTEM = `Tu es un expert en CV et en candidatures d'alternance en France. Tu réécris le CV d'un candidat pour qu'il passe les ATS et convainque le recruteur pour une offre précise.

Règles impératives :
- N'invente JAMAIS d'expérience, de diplôme, d'outil, de date, de chiffre ou de compétence absents du CV ou des informations fournies. Tu peux reformuler, réorganiser, regrouper, mettre en avant, et reprendre le vocabulaire exact de l'offre quand il décrit fidèlement ce que le candidat a fait.
- Les mots-clés de l'offre que le candidat ne peut pas justifier vont dans "missing_not_added" (pour qu'il les vérifie lui-même), pas dans le CV. Pour chacun : "keyword" = la compétence telle qu'elle apparaîtrait dans une liste de compétences, en 1 à 4 mots (ex. "Relations presse", "HubSpot", "Anglais courant") ; "reason" = une phrase courte qui explique ce qui manque.
- Exception : les compétences listées par le candidat comme « maîtrisées, à ajouter au CV » sont confirmées par lui. Ajoute-les dans les compétences, et dans une expérience seulement si le CV montre où il les a utilisées.
- CV optimisé ATS : titres de section standards, une colonne, puces courtes commençant par un verbe d'action, résultats chiffrés seulement s'ils existent déjà. Vise une page.
- "headline" : intitulé ciblé reprenant le poste de l'offre et le rythme d'alternance s'il est connu (ex. "Alternance Chargé de marketing digital — rythme 3 sem. / 1 sem.").
- "summary" : 2 à 3 lignes qui reprennent les mots-clés essentiels.
- Champs inconnus : chaîne vide "" ou liste vide. Dates au format "MM/AAAA" ou "AAAA".
- "changes" : liste courte de ce que tu as modifié et pourquoi.

Lettre de motivation d'alternance (structure Vous / Moi / Nous, 250 à 350 mots, ton professionnel et sincère, sans formules creuses) :
- "cover_letter" : lettre complète adaptée à cette offre et cette entreprise. Mentionne la formation préparée, l'école, le rythme et la date de début s'ils sont fournis.
- "cover_letter_template" : la même lettre transformée en modèle réutilisable pour d'autres candidatures d'alternance, avec des champs à remplir entre crochets : [Entreprise], [Poste], [Ce qui m'attire dans l'entreprise], [Mission ou projet de l'entreprise], [Nom du recruteur]. Garde tout ce qui concerne le candidat.
- "closing" : formule de politesse finale complète.
- "subject" : ligne d'objet (ex. "Candidature en alternance – Assistant RH").
Réponds en français.`;

function offerBlock(jobOffer, company) {
  if (!jobOffer) {
    return `<offre_alternance>(aucune offre précise fournie${company ? `, entreprise visée : ${company}` : ""})</offre_alternance>`;
  }
  return `<offre_alternance${company ? ` entreprise="${company}"` : ""}>
${jobOffer}
</offre_alternance>`;
}

function profileText(profile) {
  return (
    Object.entries(profile || {})
      .filter(([, v]) => v && String(v).trim())
      .map(([k, v]) => `- ${k} : ${v}`)
      .join("\n") || "(aucune)"
  );
}

export async function analyzeKeywords({ cvText, jobOffer, company, onAttempt }) {
  const user = jobOffer
    ? `${offerBlock(jobOffer, company)}\n\nListe les mots-clés de cette offre.`
    : `<cv>\n${cvText}\n</cv>\n\nAucune offre fournie : déduis le poste visé et liste les mots-clés habituellement attendus.`;
  const { result, model } = await callLlm({ system: KEYWORDS_SYSTEM, user, schema: KEYWORDS_SCHEMA, maxTokens: 8000, effort: "none", onAttempt });
  return { ...result, model };
}

// Le diagnostic rapide (sans réflexion) commet parfois deux erreurs malgré les consignes :
// signaler une date « passée » ou « future » et donner un chiffre en exemple, que le candidat
// pourrait recopier. On les retire ici, sans coût en temps.
function cleanFixes(fixes) {
  return fixes
    .filter((f) => !/dates?\b[^.]*(pass[ée]e?s?|dans le passé|futur|à venir)/i.test(f.action))
    .map((f) => ({ ...f, action: f.action.replace(/\s*\((?:ex|par ex)[^)]*\d[^)]*\)/gi, "").trim() }));
}

// Le mode rapide pose parfois des questions dont la réponse est déjà dans le CV.
// On retire celles des sujets qu'on sait repérer dans le texte.
const ANSWERED_TOPICS = [
  { question: /rythme/i, inCv: /rythme|semaines?\s+(?:école|ecole|entreprise)|jours?\s*\/\s*\d/i },
  { question: /date de début|disponib/i, inCv: /disponible|à partir d[eu]|a partir d[eu]|date de début/i },
  { question: /chiffr|mesurable|résultats? concrets?/i, inCv: /\d+\s*%|\d[,.]?\d*\s*\/\s*\d+|\d+e position|\+\s*\d+/i },
  { question: /poste visé|poste recherché|quel poste/i, inCv: /alternance|stage|recherche|growth|chargé|assistant|développeur|designer|marketing/i },
];
function cleanQuestions(questions, cvText) {
  return questions.filter((q) => !ANSWERED_TOPICS.some((t) => t.question.test(q) && t.inCv.test(cvText)));
}

export async function analyzeDiagnosis({ cvText, checks, jobOffer, company, profile, onAttempt }) {
  const testResults = (checks || []).map((c) => `- ${c.ok ? "OK" : "ÉCHEC"} : ${c.label}${c.ok ? "" : ` (${c.detail})`}`).join("\n");
  const user = `<texte_extrait_par_parseur_ats>
${cvText}
</texte_extrait_par_parseur_ats>

<tests_techniques_automatiques>
${testResults}
</tests_techniques_automatiques>

${offerBlock(jobOffer, company)}

<infos_alternance_fournies_par_le_candidat>
${profileText(profile)}
</infos_alternance_fournies_par_le_candidat>

Date du jour : ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.

${jobOffer ? "Analyse la compatibilité ATS de ce CV pour cette offre." : "Aucune offre fournie : analyse la compatibilité ATS générale de ce CV pour le poste en alternance qu'il vise."}`;
  const { result, model } = await callLlm({ system: DIAGNOSIS_SYSTEM, user, schema: DIAGNOSIS_SCHEMA, maxTokens: 10000, effort: "none", onAttempt });
  return {
    ...result,
    priority_fixes: cleanFixes(result.priority_fixes),
    refine_suggestions: cleanQuestions(result.refine_suggestions, `${cvText}\n${profileText(profile)}`),
    model,
  };
}

const OFFER_SCHEMA = obj({ found: { type: "boolean" }, title: str, company: str, location: str, description: str });

export async function extractOfferFromPage(pageText, url) {
  const { result } = await callLlm({
    system: `Tu reçois le texte brut d'une page web censée contenir une offre d'emploi ou d'alternance.
Si elle en contient une, recopie fidèlement l'intégralité de l'annonce dans "description" (missions, profil, compétences, conditions, rythme), sans le menu, les autres offres, les cookies ni le pied de page. Garde le texte d'origine, ne résume pas et n'ajoute rien.
Si la page ne contient pas d'annonce, mets found à false et les autres champs à "".`,
    user: `<page url="${url}">\n${pageText}\n</page>`,
    schema: OFFER_SCHEMA,
    maxTokens: 12000,
    effort: "none",
  });
  return result;
}

export async function adaptCv({ cvText, jobOffer, company, analysis, profile }) {
  const user = `<cv_actuel>
${cvText}
</cv_actuel>

${offerBlock(jobOffer, company)}

<infos_alternance_fournies_par_le_candidat>
${profileText(profile)}
</infos_alternance_fournies_par_le_candidat>

<diagnostic_ats>
${JSON.stringify(
  {
    corrections_prioritaires: analysis?.priority_fixes,
    mots_cles: analysis?.keywords?.map((k) => ({ mot: k.keyword, importance: k.importance, present: k.present })),
    retours_sections: analysis?.section_feedback,
  },
  null,
  1
)}
</diagnostic_ats>

${jobOffer
  ? "Réécris le CV pour cette offre et rédige la lettre de motivation et son modèle réutilisable."
  : "Sans offre précise : optimise le CV pour le poste en alternance qu'il vise. La lettre \"cover_letter\" reste générique pour ce poste, avec [Entreprise] à la place du nom de l'entreprise si elle n'est pas connue."}`;

  // La réflexion reste active ici : sans elle, l'adaptation est 4 fois plus rapide mais invente
  // des chiffres et des expériences (mesuré le 30/10/2026). Sa durée est masquée par le préchargement.
  const { result, model } = await callLlm({ system: ADAPT_SYSTEM, user, schema: ADAPT_SCHEMA, maxTokens: 16000 });
  return { ...result, model };
}

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

const ANALYSIS_SCHEMA = obj({
  score: { type: "integer", description: "Note de compatibilité ATS globale de 0 à 100" },
  summary: str,
  detected_job_title: str,
  detected_company: str,
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
  keywords: {
    type: "array",
    items: obj({
      keyword: str,
      variants: strArr,
      category: enumOf("hard_skill", "soft_skill", "outil", "diplome", "langue", "autre"),
      importance: enumOf("essentiel", "important", "bonus"),
    }),
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
  missing_not_added: strArr,
  cover_letter: LETTER,
  cover_letter_template: LETTER,
});

const ANALYSIS_SYSTEM = `Tu es un expert du recrutement en France et des logiciels ATS (Applicant Tracking Systems) : Workday, Taleo (Oracle), SAP SuccessFactors, iCIMS, Greenhouse, Lever, SmartRecruiters, Teamtailor, Welcome to the Jungle, Flatchr, Jobaffinity et Beetween.

Tu évalues si un CV passera le filtrage automatique pour une offre d'alternance précise.
- Tu reçois le texte brut tel qu'un parseur ATS l'extrait du fichier, et le résultat de tests techniques automatiques. Repère dans ce texte les signes de problèmes de lecture : phrases coupées ou mélangées (mise en page en colonnes), dates séparées de leur poste, coordonnées absentes (souvent placées dans un en-tête ou une image), symboles parasites, sections introuvables.
- Pour chaque ATS listé, donne un verdict réaliste basé sur ses limites de parsing connues (ex. Taleo et iCIMS gèrent mal les colonnes et tableaux, Workday perd souvent les en-têtes de document, Greenhouse et Lever lisent bien les PDF simples).
- Extrais 12 à 25 mots-clés réellement attendus par l'offre (compétences, outils, diplôme visé, langues, savoir-être). Donne dans "variants" les synonymes, abréviations et formes FR/EN qu'un ATS accepterait (ex. "Power BI" -> ["PowerBI"]).
- "priority_fixes" : 3 à 6 corrections, triées par impact sur le passage des ATS (la plus importante en premier). Chaque ligne est UNE action concrète à l'impératif, en une phrase courte (ex. "Ajoute « HubSpot » dans tes compétences si tu l'as déjà utilisé"). Pas de doublon : regroupe ce qui se recoupe, et ne répète pas la même idée sous deux formes (ex. un mot-clé manquant et la section qui le contiendrait). Inclus les tests techniques en échec s'ils pèsent sur le résultat. Si le CV est déjà très bon, 1 ou 2 lignes suffisent.
- "next_step" : une seule phrase à l'impératif qui résume quoi faire maintenant (ex. "Ajoute les 4 mots-clés manquants de l'offre, puis adapte ton CV").
- Sois franc et concret, et écris en phrases à la casse normale (pas de majuscules pour insister).
- Si l'entreprise n'est pas nommée dans l'offre, mets "" dans detected_company.
- Sans offre fournie : évalue la compatibilité ATS générale du CV pour le type d'alternance qu'il vise (déduis-le dans detected_job_title), et liste les mots-clés que les recruteurs et ATS attendent habituellement pour ce poste.
- "refine_suggestions" : 2 à 5 informations concrètes que le candidat devrait ajouter pour affiner le résultat (ex. l'offre visée si elle manque, le rythme d'alternance, l'école, des outils maîtrisés qu'il ne cite pas, des résultats chiffrés). Formule-les comme des questions courtes qui s'adressent à lui.
Réponds en français.`;

const ADAPT_SYSTEM = `Tu es un expert en CV et en candidatures d'alternance en France. Tu réécris le CV d'un candidat pour qu'il passe les ATS et convainque le recruteur pour une offre précise.

Règles impératives :
- N'invente JAMAIS d'expérience, de diplôme, d'outil, de date, de chiffre ou de compétence absents du CV ou des informations fournies. Tu peux reformuler, réorganiser, regrouper, mettre en avant, et reprendre le vocabulaire exact de l'offre quand il décrit fidèlement ce que le candidat a fait.
- Les mots-clés de l'offre que le candidat ne peut pas justifier vont dans "missing_not_added" (pour qu'il les vérifie lui-même), pas dans le CV.
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

export async function analyzeCv({ cvText, checks, jobOffer, company, profile }) {
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

${jobOffer ? "Analyse la compatibilité ATS de ce CV pour cette offre." : "Aucune offre fournie : analyse la compatibilité ATS générale de ce CV pour le poste en alternance qu'il vise."}`;

  const { result, model } = await callLlm({ system: ANALYSIS_SYSTEM, user, schema: ANALYSIS_SCHEMA, maxTokens: 16000 });
  return { ...result, model };
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

  const { result, model } = await callLlm({ system: ADAPT_SYSTEM, user, schema: ADAPT_SCHEMA, maxTokens: 16000 });
  return { ...result, model };
}

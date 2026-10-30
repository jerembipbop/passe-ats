import "dotenv/config";
import express from "express";
import multer from "multer";
import JSZip from "jszip";
import { extractCv } from "./lib/extract.js";
import { runFormatChecks, keywordCoverage, combinedScore, verdictFor, capForBlockingAts, technicalFixes, withoutTestDuplicates } from "./lib/atsChecks.js";
import { analyzeKeywords, analyzeDiagnosis, adaptCv } from "./lib/ai.js";
import { MemoryCache, fingerprint } from "./lib/cache.js";
import { renderCvPdf, renderLetterPdf, letterToText, renderPreview } from "./lib/pdf.js";
import { importOffer } from "./lib/jobOffer.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.use(express.json({ limit: "5mb" }));
app.use(express.static("public"));

const safeName = (s) => (s || "document").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "_");

function scoreReport(text, extracted, keywords, aiScore) {
  const format = runFormatChecks({ ...extracted, text });
  const coverage = keywordCoverage(text, keywords);
  // Sans note IA (CV régénéré), on garde uniquement la partie mesurable.
  const score = aiScore == null
    ? Math.round((format.score + coverage.score) / 2)
    : combinedScore(aiScore, format.score, coverage.score);
  return {
    score,
    verdict: verdictFor(score),
    breakdown: { ia: aiScore, format: format.score, motsCles: coverage.score },
    checks: format.checks,
    keywords: coverage.keywords,
  };
}

// Réponses de l'IA gardées en mémoire : une demande identique (même CV, même offre, mêmes
// infos) est servie tout de suite, et une demande en cours est partagée au lieu d'être relancée.
const keywordCache = new MemoryCache(100);
const analysisCache = new MemoryCache(50);
const adaptCache = new MemoryCache(20);

function cached(cache, key, run) {
  let pending = cache.get(key);
  if (!pending) {
    pending = run();
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
  }
  return pending;
}

// Les mots-clés ne dépendent que de l'offre (ou du CV quand il n'y a pas d'offre).
const keywordsFor = ({ cvText, jobOffer, company, onAttempt }) =>
  cached(keywordCache, jobOffer ? fingerprint("offre", jobOffer, company) : fingerprint("cv", cvText), () =>
    analyzeKeywords({ cvText, jobOffer, company, onAttempt })
  );

// Réponse progressive (une ligne JSON par étape) : les résultats calculés localement
// s'affichent en moins d'une seconde, puis les mots-clés, puis le diagnostic de l'IA.
app.post("/api/analyze", upload.single("cv"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Ajoute ton CV (PDF ou Word)." });
  const jobOffer = (req.body.jobOffer || "").trim();
  const company = (req.body.company || "").trim();
  if (jobOffer && jobOffer.length < 50) return res.status(400).json({ error: "L'offre est trop courte : colle le texte complet de l'annonce." });
  let profile = {};
  try {
    profile = JSON.parse(req.body.profile || "{}");
  } catch {}

  let extracted;
  try {
    extracted = await extractCv(req.file.buffer, req.file.originalname);
  } catch (e) {
    return res.status(400).json({ error: `Impossible de lire ce fichier (${e.message}). Vérifie qu'il s'agit bien d'un PDF ou d'un .docx non protégé.` });
  }
  const cvText = extracted.text;
  const format = runFormatChecks(extracted);

  res.type("application/x-ndjson").setHeader("Cache-Control", "no-store");
  const send = (event) => !res.writableEnded && !res.destroyed && res.write(`${JSON.stringify(event)}\n`);
  send({ type: "local", checks: format.checks, format: format.score, cvText, hasOffer: !!jobOffer });

  const key = fingerprint(cvText, jobOffer, company, profile);
  try {
    const analysis = await cached(analysisCache, key, async () => {
      const keywordsPromise = keywordsFor({ cvText, jobOffer, company, onAttempt: (model) => send({ type: "stage", stage: "keywords", model }) });
      const diagnosisPromise = analyzeDiagnosis({
        cvText, checks: format.checks, jobOffer, company, profile,
        onAttempt: (model) => send({ type: "stage", stage: "diagnosis", model }),
      });
      keywordsPromise.then((kw) => {
        const coverage = keywordCoverage(cvText, kw.keywords);
        send({ type: "keywords", keywords: coverage.keywords, score: coverage.score, detected_job_title: kw.detected_job_title });
      }, () => {});
      const [kw, diagnosis] = await Promise.all([keywordsPromise, diagnosisPromise]);
      const ai = {
        ...diagnosis,
        priority_fixes: [...technicalFixes(format.checks), ...withoutTestDuplicates(diagnosis.priority_fixes, format.checks)].slice(0, 7),
        detected_job_title: kw.detected_job_title,
        detected_company: kw.detected_company,
        keywords: kw.keywords,
        models: { keywords: kw.model, diagnosis: diagnosis.model },
      };
      return {
        ...capForBlockingAts(scoreReport(cvText, extracted, kw.keywords, diagnosis.score), diagnosis.ats_systems),
        ai,
        hasOffer: !!jobOffer,
        cvText,
        company: company || kw.detected_company,
      };
    });
    send({ type: "done", analysis });
  } catch (e) {
    console.error(e.message);
    send({ type: "error", error: e.message || "Erreur inattendue.", status: e.status || 500 });
  }
  res.end();
});

// Préparation anticipée : dès qu'une offre est connue, ses mots-clés sont calculés en arrière-plan.
app.post("/api/offer/keywords", (req, res) => {
  const jobOffer = (req.body.jobOffer || "").trim();
  if (jobOffer.length >= 50) keywordsFor({ jobOffer, company: (req.body.company || "").trim() }).catch(() => {});
  res.json({ ok: true });
});

app.post("/api/offer/import", async (req, res) => {
  if (!req.body.url?.trim()) return res.status(400).json({ error: "Colle le lien de l'annonce." });
  res.json(await importOffer(req.body.url));
});

// Le navigateur lance l'adaptation en avance dès l'analyse terminée ; le clic sur
// « Adapter » récupère alors la même demande, déjà en cours ou terminée.
app.post("/api/adapt", async (req, res) => {
  const { cvText, jobOffer, company, analysis, profile } = req.body;
  const key = fingerprint(cvText, jobOffer, company, profile, analysis?.priority_fixes, analysis?.keywords?.map((k) => [k.keyword, k.present]));
  res.json(await cached(adaptCache, key, () => adaptCv({ cvText, jobOffer, company, analysis, profile })));
});

// Régénère le PDF puis le relit comme un ATS pour confirmer le nouveau score.
app.post("/api/cv/check", async (req, res) => {
  const { cv, keywords } = req.body;
  const pdf = await renderCvPdf(cv);
  const extracted = await extractCv(pdf, "cv.pdf");
  res.json({ ...scoreReport(extracted.text, extracted, keywords || [], null), extractedText: extracted.text });
});

app.post("/api/cv/pdf", async (req, res) => {
  const pdf = await renderCvPdf(req.body.cv);
  res.type("application/pdf").attachment(`CV_${safeName(req.body.cv?.full_name)}.pdf`).send(pdf);
});

app.post("/api/letter/pdf", async (req, res) => {
  const { letter, cv, company, template } = req.body;
  const pdf = await renderLetterPdf(letter, cv, template ? "[Entreprise]" : company);
  const name = template ? "Modele_lettre_alternance" : `Lettre_${safeName(company)}`;
  res.type("application/pdf").attachment(`${name}.pdf`).send(pdf);
});

// CV et lettre ensemble, dans une archive .zip.
app.post("/api/bundle", async (req, res) => {
  const { cv, letter, company } = req.body;
  const zip = new JSZip();
  zip.file(`CV_${safeName(cv?.full_name)}.pdf`, await renderCvPdf(cv));
  zip.file(`Lettre_${safeName(company || "motivation")}.pdf`, await renderLetterPdf(letter, cv, company));
  const archive = await zip.generateAsync({ type: "nodebuffer" });
  res.type("application/zip").attachment(`Candidature_${safeName(company || cv?.full_name)}.zip`).send(archive);
});

// Aperçu du CV ou d'une lettre : le PDF exact qui sera téléchargé, en images.
app.post("/api/preview", async (req, res) => {
  const { type, cv, letter, company, template } = req.body;
  const pdf = type === "cv"
    ? await renderCvPdf(cv)
    : await renderLetterPdf(letter, cv, template ? "[Entreprise]" : company);
  res.json({ pages: await renderPreview(pdf) });
});

app.post("/api/letter/txt", (req, res) => {
  const { letter, cv, company, template } = req.body;
  const txt = letterToText(letter, cv, template ? "[Entreprise]" : company);
  const name = template ? "Modele_lettre_alternance" : `Lettre_${safeName(company)}`;
  res.type("text/plain; charset=utf-8").attachment(`${name}.txt`).send("﻿" + txt);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Erreur inattendue." });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Plateforme ATS alternance : http://localhost:${port}`);
  if (!process.env.OPENROUTER_API_KEY) console.warn("⚠ OPENROUTER_API_KEY manquante : ajoute-la dans le fichier .env");
});

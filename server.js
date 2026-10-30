import "dotenv/config";
import express from "express";
import multer from "multer";
import { extractCv } from "./lib/extract.js";
import { runFormatChecks, keywordCoverage, combinedScore, verdictFor } from "./lib/atsChecks.js";
import { analyzeCv, adaptCv } from "./lib/ai.js";
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

app.post("/api/analyze", upload.single("cv"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Ajoute ton CV (PDF ou Word)." });
  const jobOffer = (req.body.jobOffer || "").trim();
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
  const ai = await analyzeCv({
    cvText: extracted.text,
    checks: runFormatChecks(extracted).checks,
    jobOffer,
    company: req.body.company,
    profile,
  });

  res.json({
    ...scoreReport(extracted.text, extracted, ai.keywords, ai.score),
    ai,
    hasOffer: !!jobOffer,
    cvText: extracted.text,
    company: req.body.company || ai.detected_company,
  });
});

app.post("/api/offer/import", async (req, res) => {
  if (!req.body.url?.trim()) return res.status(400).json({ error: "Colle le lien de l'annonce." });
  res.json(await importOffer(req.body.url));
});

app.post("/api/adapt", async (req, res) => {
  const { cvText, jobOffer, company, analysis, profile } = req.body;
  const result = await adaptCv({ cvText, jobOffer, company, analysis, profile });
  res.json(result);
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

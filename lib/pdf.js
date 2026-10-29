import PDFDocument from "pdfkit";

// Mise en page volontairement simple : une colonne, polices standards, vrai texte,
// titres de section classiques. C'est ce que tous les ATS lisent sans erreur.

const ACCENT = "#1f3a5f";
const GREY = "#555555";
const MARGIN = 48;

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

const clean = (s) => (s || "").toString().trim();
const joinNonEmpty = (parts, sep) => parts.map(clean).filter(Boolean).join(sep);
const period = (start, end) => joinNonEmpty([start, end], " – ");

function section(doc, title) {
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(11.5).fillColor(ACCENT).text(title.toUpperCase(), { characterSpacing: 0.5 });
  const y = doc.y + 1;
  doc.moveTo(MARGIN, y).lineTo(doc.page.width - MARGIN, y).lineWidth(0.7).strokeColor(ACCENT).stroke();
  doc.moveDown(0.35);
  doc.fillColor("black");
}

function bullet(doc, text) {
  const width = doc.page.width - MARGIN * 2 - 12;
  const y = doc.y;
  doc.font("Helvetica").fontSize(10).text("•", MARGIN + 2, y);
  doc.text(clean(text), MARGIN + 12, y, { width, lineGap: 1 });
  doc.x = MARGIN;
}

export async function renderCvPdf(cv) {
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    info: { Title: `CV - ${clean(cv.full_name)}`, Author: clean(cv.full_name), Subject: clean(cv.headline) },
  });
  const width = doc.page.width - MARGIN * 2;

  doc.font("Helvetica-Bold").fontSize(20).fillColor("black").text(clean(cv.full_name));
  if (clean(cv.headline)) doc.font("Helvetica").fontSize(12).fillColor(ACCENT).text(clean(cv.headline));
  const c = cv.contact || {};
  const contactLine = joinNonEmpty([c.email, c.phone, c.city, c.linkedin, c.other], "  |  ");
  if (contactLine) doc.moveDown(0.2).font("Helvetica").fontSize(9.5).fillColor(GREY).text(contactLine, { width });

  if (clean(cv.summary)) {
    section(doc, "Profil");
    doc.font("Helvetica").fontSize(10).text(clean(cv.summary), { width, align: "justify", lineGap: 1 });
  }

  if (cv.experiences?.length) {
    section(doc, "Expérience professionnelle");
    cv.experiences.forEach((e, i) => {
      if (i) doc.moveDown(0.45);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor("black").text(joinNonEmpty([e.title, e.company], " — "), { width });
      const meta = joinNonEmpty([e.location, period(e.start, e.end)], "  |  ");
      if (meta) doc.font("Helvetica-Oblique").fontSize(9.5).fillColor(GREY).text(meta).fillColor("black");
      doc.moveDown(0.15);
      (e.bullets || []).filter(clean).forEach((b) => bullet(doc, b));
    });
  }

  if (cv.education?.length) {
    section(doc, "Formation");
    cv.education.forEach((e, i) => {
      if (i) doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor("black").text(joinNonEmpty([e.degree, e.school], " — "), { width });
      const meta = joinNonEmpty([e.location, period(e.start, e.end)], "  |  ");
      if (meta) doc.font("Helvetica-Oblique").fontSize(9.5).fillColor(GREY).text(meta).fillColor("black");
      if (clean(e.details)) doc.font("Helvetica").fontSize(10).text(clean(e.details), { width });
    });
  }

  if (cv.skills?.length) {
    section(doc, "Compétences");
    cv.skills.forEach((s) => {
      const items = (s.items || []).map(clean).filter(Boolean).join(", ");
      if (!items) return;
      if (clean(s.category)) {
        doc.font("Helvetica-Bold").fontSize(10).text(`${clean(s.category)} : `, { continued: true });
      }
      doc.font("Helvetica").text(items, { width });
    });
  }

  if (cv.projects?.length) {
    section(doc, "Projets");
    cv.projects.forEach((p) => {
      doc.font("Helvetica-Bold").fontSize(10).text(`${clean(p.name)} : `, { continued: true });
      doc.font("Helvetica").text(clean(p.description), { width });
    });
  }

  if (cv.languages?.length) {
    section(doc, "Langues");
    doc.font("Helvetica").fontSize(10).text(cv.languages.map((l) => joinNonEmpty([l.language, l.level], " : ")).join("  |  "), { width });
  }

  if (cv.certifications?.filter(clean).length) {
    section(doc, "Certifications");
    cv.certifications.filter(clean).forEach((cert) => bullet(doc, cert));
  }

  if (cv.interests?.filter(clean).length) {
    section(doc, "Centres d'intérêt");
    doc.font("Helvetica").fontSize(10).text(cv.interests.filter(clean).join(", "), { width });
  }

  return toBuffer(doc);
}

export async function renderLetterPdf(letter, cv, company) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 64,
    info: { Title: `Lettre de motivation - ${clean(cv?.full_name)}`, Author: clean(cv?.full_name) },
  });
  const width = doc.page.width - 128;
  const c = cv?.contact || {};

  doc.font("Helvetica-Bold").fontSize(11).text(clean(cv?.full_name));
  doc.font("Helvetica").fontSize(10);
  [c.city, c.email, c.phone, c.linkedin].map(clean).filter(Boolean).forEach((l) => doc.text(l));

  doc.moveDown(1.5);
  doc.text(clean(company) || "[Entreprise]", { align: "right" });
  const date = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  doc.text(`${clean(c.city) ? clean(c.city) + ", le " : "Le "}${date}`, { align: "right" });

  doc.moveDown(1.5);
  doc.font("Helvetica-Bold").text(`Objet : ${clean(letter.subject).replace(/^objet\s*:\s*/i, "")}`, { width });
  doc.moveDown(1);
  doc.font("Helvetica").fontSize(10.5).text(clean(letter.greeting), { width });
  doc.moveDown(0.7);
  (letter.paragraphs || []).filter(clean).forEach((p) => {
    doc.text(clean(p), { width, align: "justify", lineGap: 2 });
    doc.moveDown(0.7);
  });
  doc.text(clean(letter.closing), { width, align: "justify", lineGap: 2 });
  doc.moveDown(1.5);
  doc.font("Helvetica-Bold").text(clean(cv?.full_name), { align: "right" });

  return toBuffer(doc);
}

export function letterToText(letter, cv, company) {
  const c = cv?.contact || {};
  const head = [cv?.full_name, c.city, c.email, c.phone].map(clean).filter(Boolean).join("\n");
  return [
    head,
    "",
    clean(company) || "[Entreprise]",
    "",
    `Objet : ${clean(letter.subject).replace(/^objet\s*:\s*/i, "")}`,
    "",
    clean(letter.greeting),
    "",
    ...(letter.paragraphs || []).filter(clean).flatMap((p) => [clean(p), ""]),
    clean(letter.closing),
    "",
    clean(cv?.full_name),
  ].join("\r\n");
}

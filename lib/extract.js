import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

// Extrait le texte brut d'un CV, comme le ferait le parseur d'un ATS.
export async function extractCv(buffer, filename) {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".pdf")) {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return { kind: "pdf", text: result.text, pages: result.total, hasTables: false };
    } finally {
      await parser.destroy();
    }
  }

  if (lower.endsWith(".docx")) {
    const { value: text } = await mammoth.extractRawText({ buffer });
    const { value: html } = await mammoth.convertToHtml({ buffer });
    return { kind: "docx", text, pages: null, hasTables: html.includes("<table") };
  }

  throw new Error("Format non supporté : envoie un fichier .pdf ou .docx");
}

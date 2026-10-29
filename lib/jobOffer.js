import dns from "node:dns/promises";
import net from "node:net";
import * as cheerio from "cheerio";
import { extractOfferFromPage } from "./ai.js";

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export class OfferError extends Error {
  status = 400;
}

// Refuse les adresses internes : le serveur ne doit aller chercher que des pages publiques.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new OfferError("Ce lien n'est pas une adresse web valide. Copie l'URL complète, en commençant par https://");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new OfferError("Le lien doit commencer par http:// ou https://");
  const addresses = await dns.lookup(url.hostname, { all: true }).catch(() => {
    throw new OfferError(`Le site « ${url.hostname} » est introuvable. Vérifie le lien.`);
  });
  if (addresses.some((a) => isPrivateIp(a.address))) throw new OfferError("Ce lien pointe vers une adresse interne, il ne peut pas être importé.");
  return url;
}

async function fetchPage(raw) {
  let url = await assertPublicUrl(raw);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6",
      },
    }).catch((e) => {
      throw new OfferError(e.name === "TimeoutError" ? "Le site met trop de temps à répondre." : "Impossible de joindre ce site.");
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertPublicUrl(new URL(res.headers.get("location"), url).href);
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 999) {
      throw new OfferError(`${url.hostname} bloque la lecture automatique de ses annonces. Copie-colle le texte de l'offre dans le champ ci-dessous.`);
    }
    if (!res.ok) throw new OfferError(`La page n'a pas pu être chargée (erreur ${res.status}). L'annonce a peut-être expiré.`);
    if (!(res.headers.get("content-type") || "").includes("html")) throw new OfferError("Ce lien ne mène pas à une page web d'annonce.");

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new OfferError("La page est trop lourde pour être importée.");
    return { html: buf.toString("utf8"), url };
  }
  throw new OfferError("Trop de redirections sur ce lien.");
}

function htmlToText(html) {
  const $ = cheerio.load(`<div id="root">${html}</div>`);
  $("br").replaceWith("\n");
  $("li").each((_, el) => $(el).prepend("• ").append("\n"));
  $("p, div, h1, h2, h3, h4, ul, ol").each((_, el) => $(el).append("\n"));
  return $("#root").text().replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

// La plupart des sites d'emploi et des ATS publient l'offre au format schema.org JobPosting.
function findJobPosting($) {
  const nodes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const stack = [data];
      while (stack.length) {
        const n = stack.pop();
        if (Array.isArray(n)) stack.push(...n);
        else if (n && typeof n === "object") {
          const type = [].concat(n["@type"] || []);
          if (type.includes("JobPosting")) nodes.push(n);
          if (n["@graph"]) stack.push(n["@graph"]);
        }
      }
    } catch {}
  });
  return nodes.find((n) => n.description) || null;
}

// Sites générés en JavaScript (Greenhouse, Teamtailor…) : l'annonce est souvent dans un JSON intégré à la page.
function findEmbeddedDescription(html) {
  const re = /"(?:description|content|jobDescription|descriptionHtml|descriptionPlain)"\s*:\s*("(?:[^"\\]|\\.){400,}?")/g;
  let best = "";
  for (const m of html.matchAll(re)) {
    try {
      const text = htmlToText(JSON.parse(m[1]));
      if (text.length > best.length) best = text;
    } catch {}
  }
  return best.length >= 400 ? best : null;
}

function locationOf(job) {
  const loc = [].concat(job.jobLocation || [])[0];
  const a = loc?.address;
  if (!a) return job.jobLocationType === "TELECOMMUTE" ? "Télétravail" : "";
  return typeof a === "string" ? a : [a.addressLocality, a.postalCode, a.addressRegion].filter(Boolean).join(", ");
}

export async function importOffer(rawUrl) {
  const { html, url } = await fetchPage(rawUrl.trim());
  const $ = cheerio.load(html);

  const job = findJobPosting($);
  if (job) {
    const org = job.hiringOrganization;
    const meta = [
      job.title && `Poste : ${job.title}`,
      locationOf(job) && `Lieu : ${locationOf(job)}`,
      job.employmentType && `Contrat : ${[].concat(job.employmentType).join(", ")}`,
    ].filter(Boolean);
    return {
      title: job.title || "",
      company: (typeof org === "string" ? org : org?.name) || "",
      location: locationOf(job),
      text: [...meta, "", htmlToText(job.description)].join("\n").trim(),
      source: url.hostname,
    };
  }

  const embedded = findEmbeddedDescription(html);
  if (embedded) {
    const title = $('meta[property="og:title"]').attr("content")?.trim() || $("title").text().trim();
    return {
      title,
      company: $('meta[property="og:site_name"]').attr("content")?.trim() || "",
      location: "",
      text: [title && `Poste : ${title}`, "", embedded].filter((l) => l !== undefined).join("\n").trim(),
      source: url.hostname,
    };
  }

  // Pas de données structurées : on donne le texte visible de la page à l'IA pour isoler l'annonce.
  $("script, style, noscript, svg, iframe, nav, footer, form, header").remove();
  const main = $("main").length ? $("main") : $("article").length ? $("article") : $("body");
  const pageText = main.text().replace(/\s+/g, " ").trim().slice(0, 40000);
  if (pageText.length < 200) {
    throw new OfferError("La page ne contient pas le texte de l'annonce (elle est sans doute chargée par JavaScript ou réservée aux membres). Copie-colle le texte de l'offre.");
  }

  const offer = await extractOfferFromPage(pageText, url.href);
  if (!offer.found) throw new OfferError("Aucune annonce d'emploi n'a été trouvée sur cette page. Vérifie le lien ou copie-colle le texte.");
  return { title: offer.title, company: offer.company, location: offer.location, text: offer.description, source: url.hostname };
}

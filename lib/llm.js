// Client OpenRouter limité aux modèles gratuits, avec bascule automatique :
// si un modèle est saturé, indisponible ou répond mal, on passe au suivant.

const API = "https://openrouter.ai/api/v1";

// Classement par qualité attendue pour de la rédaction en français et du JSON fiable.
// Les modèles absents du catalogue gratuit du moment sont simplement ignorés.
const PREFERRED = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "thinkingmachines/inkling:free",
  "nvidia/nemotron-3.5-super-vl:free",
  "google/gemma-4-31b-it:free",
  "dots-studio/dots-3-note-preview:free",
  "xingchen-agi/xing4.0-29b-a4b:free",
  "google/gemma-4-26b-a4b-it:free",
  "thinkingmachines/inkling-small:free",
  "openrouter/free",
];
// Modèles gratuits inadaptés (musique, modération, code, trop petits).
const EXCLUDED = /lyria|content-safety|code|laguna-xs|lfm-2\.5-2\.6b/i;

export class LlmError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.status = status;
  }
}

const cooldown = new Map(); // modèle -> date jusqu'à laquelle on l'évite
let catalog = { at: 0, models: [] };

async function freeModels() {
  if (Date.now() - catalog.at < 60 * 60 * 1000 && catalog.models.length) return catalog.models;
  try {
    const res = await fetch(`${API}/models`, { signal: AbortSignal.timeout(15000) });
    const { data } = await res.json();
    const models = data
      .filter((m) => m.id.endsWith(":free") || m.id === "openrouter/free" || (+m.pricing?.prompt === 0 && +m.pricing?.completion === 0))
      .filter((m) => !EXCLUDED.test(m.id) && (m.architecture?.output_modalities || ["text"]).includes("text"));
    catalog = { at: Date.now(), models };
  } catch {
    // Catalogue injoignable : on garde l'ancien ou on part de la liste par défaut.
    if (!catalog.models.length) catalog.models = PREFERRED.map((id) => ({ id, supported_parameters: [] }));
  }
  return catalog.models;
}

async function modelChain() {
  const fromEnv = (process.env.OPENROUTER_MODELS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const available = await freeModels();
  const byId = new Map(available.map((m) => [m.id, m]));
  const rank = (id) => {
    const i = PREFERRED.indexOf(id);
    return i < 0 ? PREFERRED.length : i;
  };
  const ordered = fromEnv.length
    ? fromEnv.map((id) => byId.get(id) || { id, supported_parameters: [] })
    : [...available].sort((a, b) => rank(a.id) - rank(b.id) || (b.context_length || 0) - (a.context_length || 0));
  const now = Date.now();
  const ready = ordered.filter((m) => (cooldown.get(m.id) || 0) < now);
  return ready.length ? ready : ordered;
}

// Récupère le JSON même si le modèle l'entoure de texte ou de ```json.
function parseJson(text) {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("pas de JSON dans la réponse");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// Ramène la réponse au schéma attendu : champs manquants remplis, types corrigés,
// pour que l'interface ne casse jamais sur une réponse imparfaite.
export function conform(schema, value) {
  switch (schema.type) {
    case "object": {
      // Un modèle qui renvoie un simple texte à la place d'un objet : on le range dans le premier champ.
      const first = Object.keys(schema.properties)[0];
      const src = value && typeof value === "object" && !Array.isArray(value) ? value : typeof value === "string" ? { [first]: value } : {};
      return Object.fromEntries(Object.entries(schema.properties).map(([k, s]) => [k, conform(s, src[k])]));
    }
    case "array":
      return (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]).map((v) => conform(schema.items, v));
    case "integer": {
      const n = Math.round(Number(value));
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
    }
    case "boolean":
      return value === true || value === "true";
    default: {
      const s = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
      if (schema.enum) {
        const hit = schema.enum.find((e) => e.toLowerCase() === s.toLowerCase().trim());
        return hit || schema.enum[Math.floor(schema.enum.length / 2)];
      }
      return s;
    }
  }
}

// Vérifie que la réponse contient bien l'essentiel (sinon on essaie un autre modèle).
function looksUsable(schema, parsed) {
  const keys = Object.keys(schema.properties);
  const present = keys.filter((k) => parsed[k] !== undefined && parsed[k] !== null && parsed[k] !== "");
  return present.length >= Math.ceil(keys.length * 0.6);
}

export async function callLlm({ system, user, schema, maxTokens = 16000 }) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new LlmError("Clé OpenRouter absente. Renseigne OPENROUTER_API_KEY dans le fichier .env puis relance le serveur.", 400);
  }

  const chain = await modelChain();
  const failures = [];

  for (const model of chain.slice(0, 6)) {
    const params = model.supported_parameters || [];
    const body = {
      model: model.id,
      max_tokens: Math.min(maxTokens, model.top_provider?.max_completion_tokens || maxTokens),
      messages: [
        {
          role: "system",
          content: `${system}

FORMAT DE RÉPONSE : réponds uniquement avec un objet JSON valide, sans texte avant ni après, qui respecte exactement ce schéma JSON :
${JSON.stringify(schema)}`,
        },
        { role: "user", content: user },
      ],
    };
    if (params.includes("structured_outputs")) {
      body.response_format = { type: "json_schema", json_schema: { name: "reponse", strict: true, schema } };
    } else if (params.includes("response_format")) {
      body.response_format = { type: "json_object" };
    }

    let res;
    try {
      res = await fetch(`${API}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(240000),
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost",
          "X-Title": "Passe ATS",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      failures.push(`${model.id} : ${e.name === "TimeoutError" ? "trop lent" : "injoignable"}`);
      cooldown.set(model.id, Date.now() + 5 * 60 * 1000);
      continue;
    }

    const data = await res.json().catch(() => ({}));
    const errMsg = data.error?.message || data.error?.metadata?.raw || "";

    if (res.status === 401) throw new LlmError("Clé OpenRouter invalide ou révoquée. Vérifie OPENROUTER_API_KEY dans le fichier .env.", 400);
    if (/free-models-per-day|per day/i.test(errMsg)) {
      throw new LlmError(
        "Limite quotidienne de requêtes gratuites OpenRouter atteinte (50 par jour). Elle se réinitialise demain ; avec 10 $ de crédit sur ton compte OpenRouter, elle passe à 1000 par jour.",
        429
      );
    }
    if (!res.ok || data.error) {
      // 429 = modèle saturé, 402 = plus de crédit, 404/400 = modèle retiré ou paramètre refusé.
      const wait = res.status === 429 ? 2 * 60 * 1000 : 30 * 60 * 1000;
      cooldown.set(model.id, Date.now() + wait);
      failures.push(`${model.id} : ${res.status || ""} ${errMsg.slice(0, 120)}`);
      continue;
    }

    const content = data.choices?.[0]?.message?.content || "";
    try {
      const parsed = parseJson(content);
      if (!looksUsable(schema, parsed)) throw new Error("réponse incomplète");
      if (failures.length) console.warn(`[IA] modèles écartés :\n  ${failures.join("\n  ")}`);
      console.log(`[IA] réponse de ${model.id}`);
      return { result: conform(schema, parsed), model: model.id };
    } catch (e) {
      failures.push(`${model.id} : ${e.message}`);
      cooldown.set(model.id, Date.now() + 10 * 60 * 1000);
    }
  }

  console.error("[IA] échec de tous les modèles :\n" + failures.join("\n"));
  throw new LlmError("Les modèles gratuits sont saturés en ce moment. Réessaie dans quelques minutes.");
}

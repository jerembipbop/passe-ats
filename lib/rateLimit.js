// Limite les appels à l'IA par visiteur sur le site public : le quota gratuit OpenRouter
// (50 requêtes par jour) est partagé par tout le monde, une seule personne ne doit pas l'épuiser.
// Le compteur vit en mémoire : il protège bien sans être parfait, chaque instance a le sien.
export function aiRateLimit({ max, windowMs = 24 * 3600 * 1000, silent = false }) {
  const hits = new Map();
  return (req, res, next) => {
    if (!max) return next();
    const now = Date.now();
    const recent = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      // Pour les préparations en arrière-plan, on ne fait simplement rien.
      if (silent) return res.json({ ok: true });
      return res.status(429).json({
        error: `Tu as atteint la limite de ${max} analyses par jour sur ce site, pour que chacun puisse l'utiliser. Réessaie demain.`,
      });
    }
    recent.push(now);
    hits.set(req.ip, recent);
    next();
  };
}

# AGENTS.md

Instructions pour les agents de code qui travaillent sur **Passe ATS**. Pour la présentation destinée aux humains, voir `README.md`.

## Aperçu du projet

Application web locale pour la recherche d'alternance. L'utilisateur dépose son CV, et l'application :

1. Simule sa lecture par les ATS (logiciels de tri des candidatures) et donne une note sur 100.
2. Affine l'analyse avec l'offre visée, collée en texte ou importée depuis son lien.
3. Réécrit le CV pour l'offre, sans rien inventer, puis le génère en PDF lisible par les ATS.
4. Rédige une lettre de motivation et un modèle de lettre réutilisable.

Pile technique : Node.js 20+, Express 5, modules ES (`"type": "module"`), JavaScript sans framework côté navigateur. Il n'y a ni étape de build, ni TypeScript, ni bundler.

## Commandes

```bash
npm install          # installer les dépendances
npm start            # lancer le serveur sur http://localhost:3000
npm run dev          # lancer avec rechargement automatique (node --watch)
```

Il faut un fichier `.env` à la racine, construit sur le modèle de `.env.example` :

- `OPENROUTER_API_KEY` : obligatoire.
- `OPENROUTER_MODELS` : optionnel, pour imposer une liste de modèles.
- `PORT` : optionnel, 3000 par défaut.

## Structure

| Fichier | Rôle |
| --- | --- |
| `server.js` | Routes Express et gestionnaire d'erreurs |
| `lib/extract.js` | Extraction du texte d'un PDF (`pdf-parse` v2) ou d'un .docx (`mammoth`), comme un ATS |
| `lib/atsChecks.js` | Tests de lisibilité déterministes, couverture des mots-clés, calcul du score |
| `lib/ai.js` | Consignes et schémas JSON envoyés à l'IA (analyse, adaptation, extraction d'annonce) |
| `lib/llm.js` | Client OpenRouter : modèles gratuits uniquement, bascule automatique, `conform()` |
| `lib/jobOffer.js` | Import d'une annonce depuis son URL (JSON-LD, JSON intégré, puis IA en dernier recours) |
| `lib/pdf.js` | Génération du CV et de la lettre en PDF (`pdfkit`) |
| `public/` | Interface : `index.html`, `style.css`, `app.js` |

Routes (toutes en `POST`) :

- `/api/analyze` : envoi du fichier en multipart. Réponse progressive, une ligne JSON par événement : `local` (tests locaux, < 1 s), `stage`, `keywords`, `done`, `error`.
- `/api/offer/keywords` : prépare en arrière-plan les mots-clés d'une offre dès qu'elle est connue
- `/api/offer/import`
- `/api/adapt`
- `/api/cv/check`
- `/api/cv/pdf`
- `/api/letter/pdf`
- `/api/letter/txt`
- `/api/preview` : aperçu du CV ou d'une lettre, pages du PDF rendues en images
- `/api/bundle` : CV et lettre dans une archive .zip

## Règles sur l'IA

- **OpenRouter et modèles gratuits uniquement.** N'ajoute pas d'autre fournisseur ni de modèle payant sans demande explicite.
- Tout appel passe par `callLlm({ system, user, schema, maxTokens })` dans `lib/llm.js`. N'appelle jamais `fetch` vers OpenRouter ailleurs.
- **Schémas JSON** : construis-les avec les helpers `obj()`, `str`, `strArr` et `enumOf()` de `lib/ai.js`. Chaque objet a `required` sur toutes ses clés et `additionalProperties: false`.
- **Réponses de l'IA** : elles passent par `conform()`, qui remplit les champs manquants et corrige les types. Le front peut donc compter sur la présence de chaque champ du schéma.
- **Nouveau champ dans un schéma** : prévois une valeur de repli côté front, pour les analyses produites avant le changement (exemple : `a.ai.next_step || a.ai.summary`).
- **Consignes données à l'IA** : en français, en tutoyant le candidat. La règle « n'invente jamais d'expérience, de diplôme, d'outil, de chiffre ou de compétence » est non négociable. Seules les compétences confirmées par le candidat (chips cliqués) peuvent être ajoutées.
- **Vitesse** : l'analyse fait deux appels en parallèle (mots-clés, diagnostic) avec `effort: "none"`, donc sans réflexion interne (12 s au lieu de 50 à 80 s, qualité comparable). `cleanFixes()` retire les erreurs connues de ce mode (dates « passées » ou « futures », chiffres donnés en exemple). L'adaptation garde la réflexion : sans elle, l'IA invente des chiffres et des expériences.
- **Cache** (`lib/cache.js`) : analyses, mots-clés et adaptations identiques sont servis depuis la mémoire, et une demande en cours est partagée. Le navigateur lance l'adaptation en avance dès la fin d'une analyse avec offre.
- **Quota** : le compte gratuit est limité à **50 requêtes par jour**, tous modèles confondus. Une analyse ou une adaptation coûte au moins 1 requête (davantage si des modèles sont écartés). Ne lance pas de vrais appels en boucle pour tester.

## Score

Le score est calculé dans `lib/atsChecks.js` et `server.js` : 40 % note de l'IA, 30 % lisibilité, 30 % mots-clés. Le verdict est « passe » à partir de 75, « limite » à partir de 55.

- La couverture des mots-clés est **calculée localement** sur le texte extrait, à partir de la liste de l'IA (`keyword` et `variants`). Le champ `present` ne vient jamais de l'IA.
- Si au moins un ATS est jugé bloquant (`ko`), la note est plafonnée à 74 et le verdict ne peut pas être « passe » (`capForBlockingAts`).
- Les tests techniques en échec deviennent les premières corrections (`technicalFixes`) ; `withoutTestDuplicates` retire les corrections de l'IA qui portent sur le même sujet. Les titres de section ne comptent que sur une ligne courte, et les titres en lettres espacées ou les lettrines sont détectés.
- `/api/cv/check` régénère le PDF, le relit et note uniquement la partie mesurable (lisibilité et mots-clés), sans IA.

## Style de code

- Modules ES, `const` par défaut, fonctions courtes. Les commentaires sont en français et expliquent le « pourquoi ».
- Express 5 transmet tout seul les erreurs des fonctions `async` au gestionnaire d'erreurs. Lance une erreur avec un `status` (comme `OfferError` ou `LlmError`) et un message en français lisible par l'utilisateur.
- **Côté navigateur** :
  - Passe toute donnée insérée en HTML par `esc()`.
  - Utilise `$()` pour sélectionner et `api()` pour les appels.
  - Pas de bibliothèque externe.
- **Accès à `localStorage`** : toujours dans un `try/catch`.

## Interface et design

- **Textes** : en français, en tutoyant l'utilisateur, en casse normale (pas de majuscules pour insister). Pas de chiffres ni de statistiques inventés.
- **Thème clair uniquement** : fond blanc, accent `--accent` (#3b2bd6).
- **Polices** : titres en **Anton** (`--title`), texte en **Montserrat** (`--sans`), chargées depuis Google Fonts.
- **Hiérarchie** : deux graisses seulement (400 et 500) sur tout le site. Seul le grand titre `h1` est en majuscules ; tout le reste est en casse normale.
- **En-tête de chaque étape** (`.section-head`) : « Étape n sur 3 », titre `h2` qui décrit l'action, puis une phrase de sous-titre. Chaque écran se termine par une seule action principale.
- **Affordance** :
  - Tout ce qui est cliquable a l'air cliquable : bouton plein pour l'action principale, contour pour l'action secondaire, lien souligné.
  - Prévois un état de survol, un état de focus visible et un état de chargement (classe `.loading`).
  - Ce qui n'est pas cliquable ne doit pas ressembler à un bouton.
- **Écran de résultat** (`#results`, classe `.result`) :
  - Une seule couleur d'alerte (`--alert`) et deux graisses de texte seulement (400 et 500).
  - Une tuile n'est en alerte que si son score est sous 75. Les autres sont en vert pastel.
  - Les détails techniques restent dans des sections repliées.
  - Le nom technique du modèle n'apparaît qu'en info-bulle.
- **Attente** : l'analyse s'affiche dans la carte de résultat (`startScan`, `scanStep`, `finishScan`) avec des étapes réelles ; l'adaptation utilise la fenêtre `startLoader(kind)` / `stopLoader(success)`. Les deux proposent le quiz « vrai ou faux » (`renderQuiz`). Toute nouvelle attente longue doit réutiliser ces éléments.
- **Mise en page** : elle doit tenir à 375 px de large sans défilement horizontal.

## Vérifications avant de terminer

Il n'y a pas de tests automatisés. Avant de rendre la main :

```bash
for f in server.js lib/*.js public/app.js; do node --check "$f"; done
```

- Relance le serveur après toute modification côté serveur : `npm start` ne recharge pas tout seul.
- **Tester l'interface sans consommer le quota** : dans la console du navigateur, remplace `window.fetch` pour `/api/analyze` ou `/api/adapt` par une réponse simulée qui respecte le schéma (pour `/api/analyze`, des lignes JSON `local` puis `done`), puis déclenche un dépôt avec un `DragEvent("drop")`.
- **Génération PDF** : vérifie qu'elle se relit avec `extractCv()`, accents compris (ç, é, œ, ’).
- **Import d'annonce** : teste-le sur une vraie page publique (Greenhouse, Lever). Indeed et LinkedIn bloquent souvent la lecture, c'est un comportement attendu.

## Sécurité

- **Ne commite jamais `.env`.** Il est dans `.gitignore`. Ne copie jamais une clé dans le code, les logs, un README ou un message de commit.
- `lib/jobOffer.js` bloque les adresses internes (localhost, plages privées) et vérifie chaque redirection. Garde cette protection si tu modifies l'import.
- Les fichiers envoyés restent en mémoire (`multer.memoryStorage`, 4 Mo maximum, limite de Vercel) et ne sont jamais écrits sur disque.
- Sur le site public, `lib/rateLimit.js` limite les appels à l'IA par visiteur et par jour (`AI_LIMIT_PER_DAY`, 12 par défaut sur Vercel, désactivé en local) : le quota gratuit est partagé par tous les visiteurs.
- **Données sensibles** : le contenu des CV ne doit jamais apparaître dans les logs du serveur.

## Déploiement (Vercel)

- Le site est déployé sur Vercel à chaque push sur `main`. `server.js` exporte l'application (`export default app`) et n'écoute un port qu'en local (`process.env.VERCEL` absent).
- `express.static()` est ignoré par Vercel : les fichiers de `public/` sont servis directement par son CDN.
- Variables à définir dans le projet Vercel : `OPENROUTER_API_KEY` (obligatoire), `AI_LIMIT_PER_DAY` (optionnelle).
- Une requête ne peut pas dépasser 4,5 Mo ni durer plus de 300 s : garde les envois de fichiers sous 4 Mo.

## Commits et pull requests

- Messages de commit en français, à l'impératif, avec une ligne de résumé de 72 caractères maximum. Exemple : « Ajoute l'import d'annonce par URL ».
- Un commit par changement cohérent. Lance les vérifications ci-dessus avant de commiter.
- Mets `README.md` à jour quand le comportement visible, l'installation ou les limites changent. Mets ce fichier à jour quand une règle de travail change.

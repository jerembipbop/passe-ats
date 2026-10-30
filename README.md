# Passe ATS — CV et lettre d'alternance

Plateforme locale qui :

1. **Vérifie si ton CV passe les ATS** (Workday, Taleo, SuccessFactors, iCIMS, Greenhouse, Lever, SmartRecruiters, Teamtailor, Welcome to the Jungle…) : tu glisses ton CV dans la page d'accueil et l'analyse générale démarre aussitôt. Selon le résultat, tu l'affines ensuite avec l'offre visée (texte ou lien de l'annonce) et les infos de ton alternance.
2. **Adapte ton CV** à l'offre sans rien inventer. Les attentes de l'offre absentes de ton parcours sont listées à part : tu choisis de les ajouter seulement si tu les maîtrises.
3. **Montre un aperçu fidèle** du CV et de la lettre, avec une modification côte à côte et un aperçu qui se met à jour pendant la frappe.
4. **Génère le CV en PDF** lisible par tous les ATS, puis le relit comme un ATS pour mesurer sa lisibilité.
5. **Rédige ta lettre de motivation** pour l'offre, à télécharger en PDF ou à copier dans un formulaire, plus un **modèle réutilisable** avec des champs `[Entreprise]`, `[Poste]`…
6. **Prépare l'envoi** : CV et lettre ensemble dans un .zip, alerte s'il reste des [crochets] dans la lettre, et « Postuler à une autre offre » qui garde ton CV et tes infos.

## Installation

Il faut [Node.js](https://nodejs.org) 20 ou plus récent et une clé [OpenRouter](https://openrouter.ai/settings/keys) (gratuite).

1. Crée une clé sur https://openrouter.ai/settings/keys.
2. Ouvre le fichier `.env` et colle-la après `OPENROUTER_API_KEY=`.
3. Dans ce dossier :

```bash
npm install
npm start
```

4. Ouvre http://localhost:3000

## Mettre le site en ligne (Vercel, gratuit)

1. Crée un compte sur https://vercel.com avec « Continue with GitHub ».
2. Clique sur **Add New… → Project**, puis importe le dépôt `passe-ats`.
3. Dans **Environment Variables**, ajoute `OPENROUTER_API_KEY` avec ta clé OpenRouter.
4. Clique sur **Deploy**. Chaque push sur `main` mettra ensuite le site à jour.

Sur le site public, chaque visiteur est limité à 12 appels à l'IA par jour (variable `AI_LIMIT_PER_DAY`), car le quota gratuit d'OpenRouter est partagé entre tous les visiteurs. Les fichiers sont limités à 4 Mo.

## Comment le score est calculé

| Partie | Poids | Ce qui est mesuré |
| --- | --- | --- |
| Analyse IA | 40 % | L'IA étudie le texte extrait et les tests techniques, et juge chaque ATS selon ses limites connues |
| Lisibilité du fichier | 30 % | Tests automatiques : texte extractible, e-mail, téléphone, sections standards, tableaux, icônes, nombre de pages |
| Mots-clés | 30 % | Présence réelle des mots-clés de l'offre (et de leurs synonymes) dans le texte extrait |

75 et plus : passe. 55 à 74 : incertain. Moins de 55 : rejet probable.

Aucun outil n'a accès aux ATS réels des entreprises : le score est une simulation fondée sur leur fonctionnement connu.

## Modèles d'IA utilisés

Uniquement des modèles **gratuits** d'OpenRouter. La liste des modèles gratuits est relue toutes les heures, et ils sont essayés du plus rapide au plus lent à qualité comparable, d'après des mesures sur une même analyse (dots-3-note, Nemotron 3.5 Super, Nemotron 3 Ultra, Gemma 4…). Si un modèle est saturé, retiré ou répond mal, le suivant prend le relais automatiquement et le modèle défaillant est mis de côté quelques minutes.

Pour imposer ta propre liste : `OPENROUTER_MODELS=modele1:free,modele2:free` dans `.env`.

Limites des modèles gratuits :
- **50 requêtes par jour** sur un compte sans crédit (1000 par jour dès 10 $ de crédit sur OpenRouter). Une candidature complète en utilise 3 (2 pour l'analyse, 1 pour le CV et la lettre) ; une analyse identique déjà faite n'en consomme aucune.
- Analyse en 10 à 20 secondes : la lisibilité s'affiche tout de suite, puis les mots-clés, puis le diagnostic. Le CV et la lettre prennent 1 à 3 minutes, mais leur préparation démarre en arrière-plan dès la fin de l'analyse.
- Les fournisseurs de modèles gratuits peuvent conserver les données envoyées.

## Structure

- `server.js` : serveur Express et routes API
- `lib/extract.js` : extraction du texte (PDF, Word) comme un ATS
- `lib/atsChecks.js` : tests de lisibilité et couverture des mots-clés
- `lib/ai.js` : consignes données à l'IA (analyse, adaptation, extraction d'annonce)
- `lib/llm.js` : client OpenRouter et bascule entre modèles gratuits
- `lib/cache.js` : mémoire des réponses déjà calculées
- `lib/jobOffer.js` : import d'une annonce à partir de son lien
- `lib/pdf.js` : génération du CV et de la lettre en PDF
- `public/` : interface web

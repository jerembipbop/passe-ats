# Vidéo promo Passe ATS

Vidéo verticale de 29 s (1080 × 1920, 30 i/s) pour TikTok, Reels et Shorts.

- `remotion/` : les 6 plans animés en React avec [Remotion](https://www.remotion.dev/docs/) (robots ATS, dépôt du CV, note, mots-clés de l'offre, réécriture, PDF).
- `montage/` : le montage avec [HyperFrames](https://github.com/heygen-com/hyperframes) : enchaînement des plans, titres animés, volets de transition, barre de progression, écran final, musique et sons.

## Refaire la vidéo

```bash
cd remotion
npm install
npm run render      # rend les 6 plans dans montage/assets/
cd ../montage
npm run check       # contrôle du montage
npx hyperframes render -q delivery -o ../passe-ats-promo.mp4
```

Pour retoucher : `npm run studio` dans `remotion/` (plans) et `npm run dev` dans `montage/` (montage).

La musique (`montage/assets/music.wav`) et le souffle des transitions sont synthétisés avec ffmpeg : pas de droits à gérer, mais tu peux les remplacer par un morceau libre de droits.

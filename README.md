# Lumio — client mobile Seerr + catalogues Stremio

Appli native iOS / Android (Expo, React Native) qui parle directement à ton serveur **Seerr / Jellyseerr / Overseerr**
et affiche sur l'accueil les catalogues de n'importe quel **addon Stremio** (dernières sorties, tops, etc.).

## Fonctionnalités

- **Accueil** : une ligne par catalogue de chaque addon Stremio + la ligne « Tendances » de Seerr.
  Cinemeta (catalogue officiel Stremio) est préinstallé.
- **Recherche** films et séries via Seerr, avec badge de disponibilité (Disponible, Partiel, En cours, Demandé).
- **Fiche** : affiche, synopsis, genres, note, bouton « Ouvrir dans Jellyfin » si dispo.
- **Demandes** : film en un tap ; séries saison par saison ou tout d'un coup.
- **Suivi** des demandes (statut de la demande + statut du média).
- **Réglages** : URL + clé API Seerr avec test de connexion, clé TMDB optionnelle,
  ajout / retrait / réordonnancement des addons, activation catalogue par catalogue.

### Comment un élément Stremio devient une fiche Seerr

Les addons Stremio identifient les titres par leur id IMDb (`tt…`) ou `tmdb:…`. Lumio fait la correspondance :

1. id `tmdb:` fourni par l'addon → utilisé directement ;
2. id IMDb + clé TMDB renseignée → `/find` de l'API TMDB (instantané et fiable) ;
3. sinon → recherche par titre + année dans Seerr.

## Lancer en dev

```bash
npm install
npx expo run:android     # ou run:ios sur le Mac (Xcode requis)
```

## Build automatique (GitHub Actions)

Le workflow `.github/workflows/build.yml` tourne à chaque push sur `main` :

| Job | Sortie | Installation |
|---|---|---|
| android | `lumio.apk` (artefact `lumio-android`) | Installe l'APK directement sur le téléphone |
| ios | `lumio-unsigned.ipa` (artefact `lumio-ios`) | Resigne avec SideStore, AltStore ou Sideloadly (Apple ID gratuit = 7 jours) |

Pousse un tag `v1.0.0` pour publier automatiquement les deux fichiers dans une Release GitHub.

Aucun compte Expo ni compte développeur Apple n'est nécessaire.

## Réseau local

Le trafic HTTP en clair est autorisé (Android `usesCleartextTraffic`, iOS ATS), donc tu peux pointer
vers `http://192.168.x.x:5055` chez toi, ou vers ton domaine HTTPS de l'extérieur.

## Structure

```
src/app/(tabs)/       Accueil, Recherche, Demandes, Réglages
src/app/media/…       Fiche film / série
src/lib/seerr.ts      Client API Seerr
src/lib/stremio.ts    Client protocole addons Stremio
src/lib/resolve.ts    Correspondance Stremio → TMDB
src/lib/settings.tsx  Réglages persistés (AsyncStorage)
```

# Lumio — Radarr + Sonarr + catalogues Stremio dans ta poche

Design sombre « cinéma » inspiré de Nuvio : hero plein écran avec logos TMDB, boutons blancs, barre d’onglets flottante en verre dépoli, fiches avec casting. Aucun code ni asset de Nuvio (GPL-3.0) n’est repris.

Appli native iOS / Android (Expo, React Native) qui :

- cherche films et séries via **TMDB** ;
- affiche sur l'accueil les catalogues de tes **addons Stremio** (dernières sorties, tops…) ;
- envoie tout **directement à Radarr et Sonarr**, sans Seerr au milieu.

## Fonctionnalités

| Onglet | Ce qu'il fait |
|---|---|
| **Accueil** | Une ligne par catalogue de chaque addon Stremio, plus les tendances TMDB de la semaine |
| **Recherche** | Recherche TMDB (Tout / Films / Séries) avec badge de bibliothèque : Disponible, Partiel, Surveillé |
| **Fiche** | Film → « Ajouter à Radarr » ou « Relancer la recherche ». Série → choix des saisons, envoyées à Sonarr |
| **Activité** | Files d'attente Radarr + Sonarr en direct : progression, temps restant, erreurs (rafraîchi toutes les 8 s) |
| **Réglages** | TMDB, Radarr et Sonarr, accueil, addons Stremio |

### Configuration Radarr / Sonarr

1. Colle l'URL (ex. `http://192.168.1.71:7878`) et la clé API (*Paramètres → Général*).
2. Appuie sur **Connecter** : l'appli récupère tes profils de qualité et dossiers racine.
3. Choisis le profil (ex. ton profil VF), le dossier racine, et si la recherche doit partir dès l'ajout.
4. Côté Radarr, règle aussi la disponibilité minimale. Côté Sonarr, choisis si tu veux un dossier par saison.

Pour les séries, si la série existe déjà dans Sonarr, l'appli active seulement la surveillance des saisons cochées et lance un `SeasonSearch` pour chacune.

### Du catalogue Stremio à la fiche TMDB

Les addons identifient les titres par IMDb (`tt…`) ou `tmdb:…`. Lumio passe par :

1. l'id `tmdb:` s'il est fourni ;
2. sinon `/find` TMDB à partir de l'id IMDb ;
3. sinon une recherche par titre et année.

## Lancer en dev

```bash
npm install
npx expo run:android     # ou run:ios sur le Mac (Xcode requis)
```

## Build automatique (GitHub Actions)

`.github/workflows/build.yml` tourne à chaque push sur `main` :

| Job | Sortie | Installation |
|---|---|---|
| android | `lumio.apk` (artefact `lumio-android`) | Installation directe |
| ios | `lumio-unsigned.ipa` (artefact `lumio-ios`) | Resigner avec SideStore, AltStore ou Sideloadly (Apple ID gratuit) |

Un tag `v*` publie les deux fichiers dans une Release GitHub. Aucun compte Expo ni compte développeur Apple n'est nécessaire.

## Réseau

Le HTTP en clair est autorisé (Android `usesCleartextTraffic`, iOS ATS). Ça marche donc avec une IP locale chez toi.
Depuis l'extérieur, il faut que Radarr et Sonarr soient joignables : VPN, Tailscale ou reverse proxy **protégé**.

## Structure

```
src/app/(tabs)/            Accueil, Recherche, Activité, Réglages
src/app/media/[type]/[id]  Fiche film / série
src/lib/tmdb.ts            Client TMDB
src/lib/arr.ts             Clients Radarr / Sonarr + index de bibliothèque
src/lib/stremio.ts         Protocole addons Stremio
src/lib/resolve.ts         Correspondance Stremio → TMDB
src/lib/settings.tsx       Réglages persistés (AsyncStorage)
```

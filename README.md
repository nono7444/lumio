# Lumio — Radarr + Sonarr + catalogues Stremio dans ta poche

Design sombre « cinéma » inspiré de Nuvio : hero plein écran avec logos TMDB, boutons blancs, barre d’onglets flottante en verre dépoli, fiches avec casting. Lecture via **mpv** (comme Nuvio) grâce au module [expo-mpv](https://github.com/lonzzi/expo-mpv).

**Licence : GPL-3.0** (imposée par mpv / expo-mpv). Le code source reste public.

Appli native iOS / Android (Expo, React Native) qui :

- cherche films et séries via **TMDB** ;
- affiche sur l'accueil les catalogues de tes **addons Stremio** (dernières sorties, tops…) ;
- envoie tout **directement à Radarr et Sonarr**, sans Seerr au milieu.

## Fonctionnalités

| Écran | Ce qu'il fait |
|---|---|
| **Connexion** | Login Jellyfin (URL + utilisateur + mot de passe, via l'API). Passable : « Continuer sans Jellyfin » |
| **Accueil** | Hero TMDB, « Reprendre » Jellyfin, catalogues des addons Stremio, tendances |
| **Bibliothèque** | Ta bibliothèque Jellyfin : reprendre, à suivre, ajouts récents, grilles triables, fiches films et séries avec épisodes |
| **Recherche** | Recherche TMDB (Tout / Films / Séries) avec badges de bibliothèque |
| **Fiche** | **Un seul bouton « Lire »** : Jellyfin si le titre ou l'épisode y est. Sinon, lecture immédiate de la meilleure source (VF d'abord) via tes addons Stremio, et le titre part en même temps dans Radarr / Sonarr. Pour une série : premier épisode non vu, et la série entière se télécharge |
| **Lecteur** | **mpv** par défaut : lit tout (MKV, HEVC, DTS, TrueHD, sous-titres ASS), contrôles maison, choix des pistes audio et sous-titres, vitesse, zoom, piste FR auto. Le lecteur natif reste disponible (Profil, rubrique Lecture), et on peut basculer de l'un à l'autre en cas d'échec |
| **Activité** | Files Radarr + Sonarr en direct ; onglet **Demandes** (Seerr) avec validation / refus pour l'admin |
| **Réglages** | Jellyfin, affiches Better Posters, TMDB, Radarr, Sonarr, addons Stremio |

### Utilisateurs non-admins et demandes

Le rôle vient de Jellyfin (`Policy.IsAdministrator`). Un admin pilote Radarr et Sonarr directement. Les autres envoient des **demandes via Seerr / Jellyseerr** : connexion avec le même compte Jellyfin, et validation par l'admin dans l'onglet Activité.
Dans Profil, rubrique Demandes, **« Inviter quelqu'un »** génère un lien `lumio://invite?…` qui préremplit l'appli d'un proche : serveurs, clé TMDB et addons, jamais les clés Radarr ou Sonarr.

### Personnalisation

Bouton ⚙︎ en haut de l'accueil, ou Profil puis Personnalisation : ordre et visibilité de chaque rangée (Reprendre, À suivre, catalogues, ajouts récents, favoris, tendances) et des onglets.

### Épisode suivant

À la fin d'un épisode, un compte à rebours de 8 s lance le suivant, depuis Jellyfin ou en streaming. Désactivable dans Profil, rubrique Lecture.

### Lecture Jellyfin

L'appli envoie un profil d'appareil à `/Items/{id}/PlaybackInfo` : lecture directe quand le format est compatible, sinon transcodage HLS par le serveur. La progression est remontée (`/Sessions/Playing…`) : « Reprendre » marche aussi dans les autres clients Jellyfin.

### Regarder pendant le téléchargement

Ajoute un addon Stremio qui fournit des streams (ressource `stream`). Sur une fiche absente de Jellyfin, « Regarder maintenant » liste les sources lisibles (liens directs ou debrid), filtrables par FR / 4K / 1080p. En même temps, le film est ajouté à Radarr, ou la saison à Sonarr, et se télécharge en arrière-plan. Les sources torrent brutes (infoHash) ne sont pas lisibles dans l'appli.

### Affiches Better Posters

Affiches btttr.cc avec note et tags, à partir de l'id IMDb (récupéré via TMDB si besoin). Le style se règle dans Réglages, rubrique Affiches. En cas d'échec, l'appli revient à l'affiche TMDB.

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

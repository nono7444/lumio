# Lumio — Radarr + Sonarr + catalogues Stremio dans ta poche

Design sombre « cinéma » inspiré de Nuvio : hero plein écran avec logos TMDB, boutons blancs, barre d’onglets flottante en verre dépoli, fiches avec casting. Lecture via **mpv** (comme Nuvio) grâce au module [expo-mpv](https://github.com/lonzzi/expo-mpv).

**Licence : GPL-3.0** (imposée par mpv / expo-mpv). Le code source reste public.

Appli native iOS / Android (Expo, React Native) qui :

- cherche films et séries via **TMDB** ;
- affiche sur l'accueil les catalogues de tes **addons Stremio** (dernières sorties, tops…) ;
- gère les **demandes de films et séries façon Seerr**, envoyées à Radarr et Sonarr par le serveur Lumio.

## Fonctionnalités

| Écran | Ce qu'il fait |
|---|---|
| **Connexion** | Login Jellyfin (URL + utilisateur + mot de passe, via l'API). Passable : « Continuer sans Jellyfin » |
| **Accueil** | Hero TMDB, « Reprendre » Jellyfin, catalogues des addons Stremio, tendances |
| **Bibliothèque** | Ta bibliothèque Jellyfin : reprendre, à suivre, ajouts récents, grilles triables, fiches films et séries avec épisodes |
| **Recherche** | Recherche TMDB (Tout / Films / Séries) avec badges de bibliothèque |
| **Fiche** | « Lire » depuis Jellyfin (pour une série : premier épisode non vu). Statut façon Seerr (Disponible, Partiellement disponible, En cours, En attente) et bouton **Demander** |
| **Lecteur** | **mpv** par défaut : lit tout (MKV, HEVC, DTS, TrueHD, sous-titres ASS), contrôles maison, choix des pistes audio et sous-titres, vitesse, zoom, piste FR auto. Le lecteur natif reste disponible (Profil, rubrique Lecture), et on peut basculer de l'un à l'autre en cas d'échec |
| **Demandes** | Liste façon Seerr (filtres, statuts, demandeur), validation / refus par l'admin, et file de téléchargement |
| **Réglages** | Jellyfin, affiches Better Posters, TMDB, Radarr, Sonarr, addons Stremio |

### Réglages qui survivent à une réinstallation

Les réglages sont copiés dans le **trousseau iOS**, qui n'est pas effacé quand on supprime l'appli, et dans les **préférences Jellyfin** de l'utilisateur (`/DisplayPreferences/lumio`). Après une réinstallation, tout revient tout seul. Sur un nouvel appareil, tout revient dès la connexion Jellyfin.

### Calendrier

Onglet des sorties numériques à venir (films et séries), alimenté par l'addon *Digital Releases* (Releasio). Cet addon n'a pas de champ date : la date est lue dans l'URL de l'affiche (`?d=JJ/MM/AA`), sinon dans la description (« Sortie numérique : … (15 octobre 2026) »).

### Accueil et périodes

Par défaut, l'accueil montre : un hero des nouveautés du serveur, la **sélection de la période** (🎃 Halloween : films d'horreur, du plus récent au plus ancien, sur ton serveur et à découvrir ; 🎄 Noël, 💘 Saint-Valentin, 🐣 printemps, ☀️ été), puis les **derniers ajouts de chaque bibliothèque Jellyfin** (Films, Séries, Kids, Anime…). Le reste s'active depuis ⚙︎.
Le **thème de saison** (couleur d'accent, emoji, teinte du hero) suit la date. On peut le forcer ou le désactiver dans Profil, rubrique Thème.

### Serveur Lumio : chat famille et téléchargements pour tous

Un petit serveur Docker sans dépendance, qui s'authentifie avec le compte Jellyfin : voir [`server/lumio`](server/lumio/README.md).
- Onglet **Chat** pour les remarques et propositions, avec le bouton « Proposer » sur les fiches des titres pas encore disponibles.
- **Demandes façon Seerr**. Le serveur garde les clés Radarr et Sonarr (l'admin les envoie depuis Profil, rubrique Serveur Lumio). Il gère aussi la validation automatique ou par l'admin, les quotas, les demandes saison par saison, et les annonces dans le chat (demande, validation, refus, « disponible »).
- **État des serveurs** en haut de Profil : Jellyfin, Radarr, Sonarr, serveur Lumio et Seerr (en ligne ou non, version, latence, espace disque).

### Fenêtre « Demander »

Comme sur Seerr :
- Pour une série, on coche les saisons ; chaque saison affiche son statut (Disponible, En cours, En attente), et les saisons déjà disponibles ou demandées ne sont pas cochables.
- Le quota restant s'affiche, ainsi que le message « devra être validée » si l'utilisateur n'a pas la validation automatique.
- Dans les **Options**, l'appli propose le dossier racine le dossier racine de Radarr ou Sonarr (Films, Séries, Kids, Anime…) et en suggère un selon le genre : animation japonaise → Anime, animation ou famille → Kids. Dans un dossier « anime », Sonarr ajoute la série en type *anime*. 

### Chromecast

Bouton Cast dans le lecteur. Pour Jellyfin, un profil Chromecast est envoyé au serveur : lecture directe en MP4/H.264, sinon transcodage HLS.

### Utilisateurs non-admins et demandes

Le rôle vient de Jellyfin (`Policy.IsAdministrator`). Avec le serveur Lumio, l'admin règle dans Profil → **Utilisateurs et droits** :
- la validation automatique, par défaut ou par utilisateur ;
- les quotas (films et saisons sur N jours) ;
- si chacun voit les demandes des autres.

L'admin a le profil de qualité en plus dans les options.
Sans serveur Lumio, l'admin pilote Radarr et Sonarr directement, et les autres passent par Seerr / Jellyseerr.
Dans Profil, rubrique Demandes, **« Inviter quelqu'un »** génère un lien `lumio://invite?…` qui préremplit l'appli d'un proche : serveurs, clé TMDB et addons, jamais les clés Radarr ou Sonarr.

### Personnalisation

Bouton ⚙︎ en haut de l'accueil, ou Profil puis Personnalisation : ordre et visibilité de chaque rangée (Reprendre, À suivre, catalogues, ajouts récents, favoris, tendances) et des onglets.

### Épisode suivant

À la fin d'un épisode, un compte à rebours de 8 s lance le suivant, depuis Jellyfin. Désactivable dans Profil, rubrique Lecture.

### Lecture Jellyfin

L'appli envoie un profil d'appareil à `/Items/{id}/PlaybackInfo` : lecture directe quand le format est compatible, sinon transcodage HLS par le serveur. La progression est remontée (`/Sessions/Playing…`) : « Reprendre » marche aussi dans les autres clients Jellyfin.

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

## Android TV

L'appli TV est **Lumio TV**, un fork de NuvioTV (GPL-3.0) : https://github.com/nono7444/lumio-tv
Pour l'installer, ouvre `lumio.wawanono.lol/tv` dans Downloader : c'est un raccourci du serveur Lumio vers le dernier APK.

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

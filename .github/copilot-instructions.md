# Lumio — guide complet pour l'assistant de code (Copilot, Claude…)

Ce fichier explique **tout** ce qu'il faut savoir pour travailler sur Lumio comme le fait Claude : le projet, son architecture, les règles, la façon de livrer, et les pièges déjà rencontrés.
**Lis-le en entier avant toute modification.** Réponds toujours **en français**, simplement : le propriétaire (Norman) n'est pas développeur.

---

## 1. Le projet en une minute

Lumio est l'appli familiale de Norman pour regarder et demander des films / séries sur **son propre serveur** :

- **Jellyfin** (lecture), **Radarr** (films), **Sonarr** (séries), **rdt-client / AllDebrid** (téléchargements), **Prowlarr** (indexeurs).
- Un **serveur Lumio** (Node.js, dans ce dépôt : `server/lumio/server.js`) fait le lien : demandes façon Seerr, notes de la famille, chat, notifications, état des serveurs, sagas, Live TV… Les clés Radarr / Sonarr / AllDebrid **restent sur ce serveur**, jamais dans les applis.
- Domaine : `wawanono.lol` (Lumio : `https://lumio.wawanono.lol`, Jellyfin : `https://jellyfin.wawanono.lol`, en local `http://192.168.1.71:8096`).

Trois applis :

| Appli | Dépôt | Techno | Identifiant |
|---|---|---|---|
| iPhone, APK Android téléphone, Mac (Electron), ancienne APK TV | `nono7444/lumio` (ce dépôt) | Expo SDK 57 / React Native 0.86 / expo-router | `lol.wawanono.lumio` |
| **Lumio TV** (Android TV, la version recommandée) | `nono7444/lumio-tv` | **Fork de NuvioTV** — Kotlin, Jetpack Compose, TV Material 3, Media3/ExoPlayer + mpv | `lol.wawanono.lumio.tv` |
| Serveur Lumio | `nono7444/lumio` → `server/lumio/` | Node.js (un seul fichier `server.js`, sans framework) | — |

La famille utilise les applis **depuis l'extérieur** via le serveur public ; Norman, lui, est souvent sur le réseau local.

---

## 2. Règles absolues (sécurité et licence)

1. **Ne jamais écrire, stocker ni committer de secrets** : clés Radarr / Sonarr / TMDB / AllDebrid, jetons Jellyfin, jeton du tunnel Cloudflare, identifiants IPTV (compte Xtream), mots de passe. Ils vivent dans `/data/lumio-server/.env`, `/data/.env` ou dans la config du serveur Lumio — jamais dans le code ni dans le dépôt. Si Norman colle une clé dans la discussion, ne la recopie nulle part.
2. Les **liens d'invitation** ne contiennent jamais de clés.
3. La clé **AllDebrid** reste côté serveur (`ALLDEBRID_KEY` / `config.alldebridKey`) et n'est jamais renvoyée aux applis.
4. La **clé TMDB** est partagée par le serveur (`GET /api/config/tmdb`, utilisateur authentifié) — les applis la récupèrent, elle n'est pas compilée dans les applis.
5. **Licence** : `lumio-tv` est un fork de NuvioTV sous **GPL-3.0** → il reste GPL, public, avec les crédits dans `NOTICE.md` (à compléter à chaque modification notable). **Ne jamais copier de code de NuvioTV dans `nono7444/lumio`** (ce dépôt n'est pas GPL) : on peut s'inspirer du design, pas recopier.
6. Pas d'IPTV pirate, pas de scrapers de téléchargement direct pirates (wastream refusé). Les sources IPTV sont celles que Norman ajoute lui-même.
7. Ne pas annuler / relancer un build CI sans demander (exception : un nouveau push annule automatiquement le build précédent, c'est accepté).

---

## 3. Façon de travailler (à respecter)

Norman préfère qu'on **fasse directement** plutôt que d'expliquer. Cycle standard :

1. Implémenter.
2. Vérifier : `npx tsc --noEmit -p .` (appli Expo) / `node --check server/lumio/server.js` (serveur). Pour `lumio-tv`, pas de SDK Android en local : la compilation se vérifie sur GitHub Actions.
3. Ajouter une ligne en français simple sous `## À venir` dans `CHANGELOG.md` (dépôt `lumio`), ou dans `NOTICE.md` (dépôt `lumio-tv`).
4. Commit (auteur `Claude <noreply@anthropic.com>` si c'est un agent), puis :
   ```bash
   git pull --rebase          # en cas de conflit sur CHANGELOG.md : garder « À venir » en haut, au-dessus de la dernière version publiée
   git push origin main
   git push -qf origin main:next   # dépôt lumio uniquement
   ```
5. Suivre le build avec `gh api` (REST ; GraphQL n'est pas utilisé) et prévenir Norman quand c'est publié, en quelques lignes.
6. **Toujours dire à Norman la commande serveur à lancer** quand `server.js` change (voir §7).

Compte rendu : court, en français, sans jargon ; dire ce qui change pour lui, ce qu'il doit faire, et ce qui n'a pas pu être testé.

---

## 4. Appli Expo (`nono7444/lumio`)

### Stack
- Expo SDK 57, React Native 0.86.3, **expo-router** (fichiers dans `src/app/`), TypeScript strict.
- Lecteurs : **expo-mpv** (par défaut sur téléphone, lit tout) et **expo-video** (natif, AirPlay ; forcé sur TV avec `surfaceType="surfaceView"`).
- expo-image, expo-linear-gradient, expo-notifications, expo-background-task, expo-audio, expo-clipboard.
- **Installer un paquet** : `npm install pkg@~<version du tag sdk-57>` (le service `expo install` n'est pas joignable depuis l'environnement de Claude ; avec un accès normal, `npx expo install` reste préférable).
- `ios/` et `android/` sont générés (CNG) : on configure via `app.json` et les plugins de `plugins/`.

### Arborescence utile
- `src/app/(tabs)/` : onglets — `index.tsx` (accueil), `search.tsx`, `library.tsx`, `live.tsx`, `calendar.tsx`, `chat.tsx`, `activity.tsx` (Demandes), `settings.tsx` (Profil).
- `src/app/jellyfin/[id].tsx` : fiche d'un titre Jellyfin (admin : « Voir dans le disque », « Supprimer », « Corriger les infos »).
- `src/app/media/[type]/[id].tsx` : fiche TMDB (demande possible).
- `src/app/player.tsx` : lecteur ; `src/app/watch.tsx` ; `src/app/connect-tv.tsx` (ouvert par le QR code de Lumio TV) ; `src/app/files.tsx` (gestion des disques) ; `users.tsx`, `collections.tsx`, `live-sources.tsx`…
- `src/lib/` : `jellyfin.ts` (API Jellyfin, lecture, `playbackBase` = lecture en local sur TV), `tmdb.ts`, `requests.ts`, `ratings.ts`, `lumio-server.ts`, `chat.ts` (`serverCall`), `live.ts` (IPTV M3U / Xtream, `syncLiveSources`), `better-posters.ts`, `settings.tsx`, `tv-ui.tsx` (`TvScaleRoot`), `tv-focus.ts`…
- `src/components/` : `ui.tsx` (Button, Row, PosterCard, SegChip…), `jf-cards.tsx`, `tv.tsx` (`FocusPressable`), `tv-actions.tsx` (boutons façon Nuvio), `tv-backdrop.tsx`, `server-requests.tsx`, `metadata-editor.tsx`, `family-rating.tsx`…
- `targets/widget/` : widget iOS (Swift, style UptimeRobot).
- `plugins/with-cast-framework-version.js` : **force** `play-services-cast-framework` 22.1.0 et `androidx.mediarouter` **1.8.0** (1.7.0 → plantage au démarrage `NoSuchMethodError`, versions plus récentes → Kotlin 2.4 / SDK 37). Ne pas toucher sans raison.

### Particularités TV (ancienne appli TV en React Native)
- `TvScaleRoot` réduit toute l'interface (échelle 0,65–1). **Sur la route `/player`, pas de réduction** pour que la vidéo s'affiche en SurfaceView (sinon saccades / écran noir).
- `FocusPressable` ignore les appuis pendant 700 ms après l'apparition d'un écran (sinon l'appui « OK » qui ouvre le lecteur le refermait).
- Pas de `RefreshControl` sur TV (écrans noirs) ; listes TV en `ScrollView` simples.
- Tout ce qui est propre à la TV est derrière `Platform.isTV` — **ne pas changer le téléphone** quand Norman demande « pour la TV ».

### CI (`.github/workflows/build.yml`)
Jobs : `check` → `ios`, `android`, `android-tv`, `mac` → `android-smoke` (installe l'APK sur un émulateur API 34 et vérifie qu'elle ne plante pas au démarrage ; sinon l'APK est retirée de la release) → `release`.
- Chaque build de `main` = version `1.0.<n° de build>`, Release GitHub `build-<n>` avec `lumio-unsigned.ipa`, `lumio-android.apk`, `lumio-tv.apk`, `lumio-mac.dmg`, `altstore.json` (source FlareStore pour iPhone).
- Erreurs Xcode / Gradle remontées en **une** annotation `::error::` (GitHub n'en garde que 10). Garde-fou : IPA d'au moins 5 Mo.
- Le job macOS échoue parfois faute de machine disponible chez GitHub : ce n'est pas un bug du code.
- `[skip ci]` dans le message de commit évite un build (pour la doc uniquement).

---

## 5. Lumio TV (`nono7444/lumio-tv`, fork de NuvioTV)

### Principe
Le « mode Lumio » (`com.nuvio.tv.lumio.LumioMode.ENABLED = true`) transforme NuvioTV en appli 100 % Jellyfin + serveur Lumio. Tout le code ajouté est dans `app/src/main/java/com/nuvio/tv/lumio/` et dans des fichiers `Lumio*.kt` ; les modifications du code Nuvio sont **courtes et commentées « Lumio : … »**, toujours derrière `LumioMode.ENABLED`.

### Ce qui existe
- **Menu** : Accueil, Recherche, Bibliothèque, Live TV, Demandes, Paramètres (`MainActivity.kt`, `drawerItems` + `rootRoutes`).
- **Connexion** (`ui/screens/lumio/LumioSetupScreen.kt`) : adresse du serveur Lumio (défaut `lumio.wawanono.lol`) → `/tv/setup` donne l'adresse publique de Jellyfin → **QR code** (`/tvlink?code=…` → ouvre `lumio://connect-tv?code=…` sur le téléphone, qui valide le Quick Connect Jellyfin) ou code à taper, ou mot de passe.
- **Client serveur** : `lumio/LumioClient.kt` (authentifié avec le jeton Jellyfin dans `X-Jellyfin-Token`) : media, request, list, approve/decline/retry/cancel, `recheck`, notes (`rating`, `rate`, `ratingSummary`), `publicStatus`, `tmdbKey`, `collections`, `liveSources`.
- **Lecture en local** : `lumio/LumioLan.kt` — avant chaque lecture, si l'adresse locale de Jellyfin (`/tv/setup` → `localJellyfinUrl`, sinon `http://192.168.1.71:8096`) répond **et a le même identifiant de serveur**, la vidéo est lue en local (sinon par Internet). Branché dans `MediaBrowserProvider.preparePlayback`.
- **Qualité** dans le lecteur (`ui/screens/player/LumioQualityDialog.kt`) : le bouton « Sources » devient « Qualité » (Originale / 1080p 10 Mb/s / 720p 4 Mb/s / 480p) → `ServerPlayerCapabilities.maxBitrate` → transcodage Jellyfin ; `ServerPlayback.switchQuality` reprend à la même position.
- **TMDB** : `lumio/LumioTmdb.kt` récupère la clé sur le serveur et l'ajoute aux requêtes (intercepteur OkHttp ; v3 = `api_key`, jeton v4 = `Authorization: Bearer`). Enrichissement TMDB activé et en français. Fiches Jellyfin : image de fond + logo TMDB (`MetaDetailsViewModel.lumioTmdbArtwork`).
- **Recherche** : Jellyfin + TMDB (`lumio/LumioTmdbSearch.kt`, « addon » interne `lumio-tmdb://search`), plus Cinemeta.
- **Affiches** : Better Posters (`lumio/LumioPosters.kt`, motif `https://btttr.cc/poster-g/imdb/poster-default/{imdb_id}.jpg?lang=fr`), aussi pour les rangées Jellyfin (`CatalogRepositoryImpl`, `ServerCatalogViewModel`) ; l'identifiant IMDb est ajouté aux aperçus Jellyfin (`MediaBrowserMapper.preview`).
- **Notes de la famille** : bouton ⭐ sur la fiche (`ui/screens/detail/LumioRatingDialog.kt`, 1 à 10 étoiles) et pastille « ★ 8,5 · Top » sur les affiches (`lumio/LumioRatingBadges.kt`, dans `ContentCard`). Verdict : ≥ 7,5 Top, ≥ 5 Moyen, sinon Bouse.
- **Demandes** : bouton principal de la fiche (`LumioRequestButton.kt`) : Demander → barre de téléchargement en direct → Lire ; OK relance la recherche si ça bloque. Onglet Demandes (`LumioRequestsScreen.kt`) : cartes sélectionnables, % toutes les 3 s, Valider / Refuser / Relancer.
- **Bibliothèque** : grandes tuiles par bibliothèque Jellyfin (`ui/screens/library/LumioLibraryTiles.kt`) + tuile **Sagas** (`LumioSagas.kt`, `/api/collections`). La bibliothèque « Collections » de Jellyfin est masquée (`LumioMode.withoutCollections`).
- **Live TV** (`ui/screens/lumio/LumioLiveScreen.kt`) : sources M3U envoyées par le téléphone au serveur (`/api/live/sources`), groupes (France d'abord), favoris (appui long), lecture dans le lecteur.
- **Paramètres** : rubrique « Lumio » (`ui/screens/settings/LumioSettingsContent.kt` : état des serveurs en direct façon UptimeRobot, mise à jour, « Personnaliser l'accueil » → `CatalogOrder`), + Thème + Disposition. Le reste est masqué (`SettingsCatalog.visibleSettingsCategories`).
- **Décorations de saison** (`lumio/LumioSeasonalOverlay.kt`) : Halloween, Noël, Nouvel An, Saint-Valentin, Pâques — animations lues seulement au dessin (pas de recomposition par image).
- **Chargement** : pas de texte « Préparation du flux » (`showPlayerLoadingStatus` forcé à `false`).
- **Mises à jour** : l'appli lit les Releases de `nono7444/lumio-tv` (`BuildConfig.GITHUB_OWNER/REPO`).

### Pièges Kotlin déjà rencontrés
- Noms en double dans le package `com.nuvio.tv.lumio` (ex. `LumioSeason` existait déjà) → préfixer les nouveaux types.
- `when` sur une classe scellée (`PlayerEvent`) : ajouter la branche pour tout nouveau cas.
- `item { }` d'une grille Lazy est une méthode du scope : **ne pas l'importer**.
- Préférer des noms complets (`com.nuvio.tv.lumio.X`) dans le code Nuvio pour limiter les imports à ajouter.

### CI (`.github/workflows/build.yml`)
`./gradlew :app:assembleFullRelease -PlumioVersionCode=<n> -PlumioVersionName=1.0.<n>` (~25 min), Release `v1.0.<n>` avec `lumio-tv.apk` (universelle, ~130 Mo), `lumio-tv-armeabi-v7a.apk` (~50 Mo, **à installer par défaut**), `lumio-tv-arm64-v8a.apk`. Les erreurs de compilation apparaissent en annotations, **une par fichier**. Lire les annotations : `gh api repos/nono7444/lumio-tv/check-runs/<job_id>/annotations`.

---

## 6. Serveur Lumio (`server/lumio/server.js`, version actuelle 3.18.0)

Un seul fichier Node.js, pas de dépendances lourdes. Données JSON dans `DATA_DIR` (requests, users, ratings, ideas, messages, config, live-sources, collections). Incrémenter `const VERSION` à chaque changement.

Routes publiques (avant l'authentification) : `/health`, `/status/public`, `/tv/setup` (`jellyfinUrl` ← `PUBLIC_JELLYFIN_URL`, `localJellyfinUrl` ← `LOCAL_JELLYFIN_URL`), `/tvlink` (page du QR code), `/invite` (tutoriel FlareStore, `FLARESTORE_URL` optionnel), `/tv` (ancienne APK TV), `/tvnuvio` et `/tvnuvio64` (Lumio TV), `/android`, `/mac`, `/hooks/approve|decline` (boutons signés des notifications).

Routes `/api/…` (jeton Jellyfin dans `X-Jellyfin-Token`) : demandes (`/api/requests`, `/approve`, `/decline`, `/retry`, `/search` = relancer), `/api/media`, `/api/ratings` (+ `/summary` avec aussi des clés `imdb:tt…`, `/top`), `/api/collections` (sagas TMDB), `/api/live/sources` (GET/PUT, par utilisateur), `/api/config/tmdb`, `/api/status`, `/api/queue`, `/api/files/search|locate`, `/api/badge`, `/api/announcement`, `/api/notify/family`, chat, idées, utilisateurs / droits (`usersSeeAllRequests`), etc.

Notifications : ntfy (sujet admin + `config.familyTopic`).

---

## 7. Infrastructure de Norman et commandes à lui donner

- Serveur maison : Dell OptiPlex 3050 Micro, Ubuntu 26.04, IP `192.168.1.71`, utilisateur `norman`, pile Docker Compose dans `/data` (`/data/docker-compose.yaml`, secrets dans `/data/.env`). Services restants : jellyfin, sonarr, radarr, prowlarr, rdt-client, lumio, nginx-proxy-manager, cloudflared (tunnel par jeton).
- Le serveur Lumio est le service `lumio`, code dans `/data/lumio-server` (`server.js` + `Dockerfile` qui **copie** le fichier dans l'image), variables dans `/data/lumio-server/.env` (dont `LOCAL_JELLYFIN_URL=http://192.168.1.71:8096`).
- **Mettre à jour le serveur Lumio** (il faut reconstruire l'image, un simple redémarrage ne suffit pas) :
  ```bash
  cd /data/lumio-server && curl -fsSL -o server.js https://raw.githubusercontent.com/nono7444/lumio/main/server/lumio/server.js && cd /data && docker compose up -d --build --force-recreate lumio
  ```
  Vérifier : `curl -s https://lumio.wawanono.lol/tv/setup`.
- Installer sur la TV : appli *Downloader* → `lumio.wawanono.lol/tvnuvio` (ou `/tvnuvio64`).
- iPhone : FlareStore avec la source `https://github.com/nono7444/lumio/releases/latest/download/altstore.json`. Android : `lumio.wawanono.lol/android`.
- Disque de téléchargement unique monté pour les hardlinks (`/media/jellyfin1/downloads`, « Mapped path » de rdt-client) ; cache de transcodage Jellyfin déplacé pour ne pas remplir le disque système.

---

## 8. Historique des problèmes résolus (à ne pas réintroduire)

- **IPA vide (696 octets)** : la sortie de `xcodebuild` passait dans un `| tail` qui masquait l'échec → log dans un fichier + `|| exit 1` + garde-fou de taille.
- **APK qui plante au démarrage** (Samsung S22) : `androidx.mediarouter` 1.7.0 → forcé en 1.8.0 ; test `android-smoke` ajouté.
- **Lecteur TV qui démarre / s'arrête / redémarre** : lecture par le tunnel Cloudflare → lecture en local ; réserve de lecture trop grosse (60 s) → 30 s, seulement sur TV.
- **Lecteur TV « son sans image »** : SurfaceView sous une transformation d'échelle → pas de réduction sur la route du lecteur.
- **Lecteur qui se referme au premier appui** : l'appui OK finissait sur le bouton fermer → bouton retiré sur TV + délai de 700 ms.
- **Écrans TV noirs** (Demandes / Téléchargements) : `FlatList` + `RefreshControl` → listes simples.
- **Couverture noire après « Corriger les infos »** : l'appli télécharge elle-même l'affiche et le fond (`/Items/{id}/RemoteImages/Download`).
- **Demandes vides sur TV** : adresse du serveur Lumio absente → prise automatiquement ; un compte non admin ne voit que ses demandes (option `usersSeeAllRequests`).

---

## 9. Idées en attente / pistes

- Lumio TV : bouton « J'aime » (favori Jellyfin) sur la fiche ; vérifier les métadonnées encore coupées (demander une photo).
- Retirer l'ancienne APK TV (React Native) quand Lumio TV convient à Norman.
- Cours « Apprendre à coder une appli iPhone & Android » (document Claude Docs) : étapes 1 à 3 écrites, la suite quand Norman est prêt.

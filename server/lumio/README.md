# Serveur Lumio

Petit serveur, en un seul fichier et sans dépendance, qui sert trois choses dans l'appli :

- **Chat famille** : onglet Chat, et bouton « Proposer » sur les fiches.
- **Demandes façon Seerr** : statuts (en attente, approuvée, refusée, échec, disponible), demandes saison par saison, validation automatique ou par l'admin, quotas, choix du dossier (Films, Kids, Anime…). Les clés Radarr et Sonarr restent sur ce serveur, jamais sur les téléphones. L'admin reçoit une **notification push** (appli ntfy) pour chaque demande, avec les boutons Valider / Refuser, et quand un titre arrive dans Jellyfin. Le chat sert uniquement à discuter.
- **État des serveurs** : Jellyfin, Radarr et Sonarr (en ligne ou non, version, espace disque, file d'attente).

On se connecte avec son compte Jellyfin, sans mot de passe en plus. Les données sont dans `/data` : `messages.json`, `requests.json`, `users.json` et `config.json`.

## Installation (docker-compose, dans `/data/` sur le serveur)

```yaml
  lumio:
    build: ./lumio-server
    container_name: lumio
    restart: unless-stopped
    environment:
      - JELLYFIN_URL=http://jellyfin:8096
      # Facultatif : sinon l'appli de l'admin envoie la config (Profil → Serveur Lumio)
      # - RADARR_URL=http://radarr:7878
      # - RADARR_API_KEY=xxxx
      # - SONARR_URL=http://sonarr:8989
      # - SONARR_API_KEY=xxxx
      # Notifications (facultatif) : par défaut ntfy.sh avec un sujet aléatoire
      # - NTFY_SERVER=https://ntfy.sh
      # - NTFY_TOPIC=lumio-xxxx
      # - PUBLIC_URL=https://lumio.tondomaine
    volumes:
      - ./lumio-server/data:/data
    ports:
      - "3456:3456"
```

1. Copie `server.js` et `Dockerfile` dans `/data/lumio-server/` sur le serveur.
2. Ajoute le bloc ci-dessus à ton `docker-compose.yml`, puis lance `docker compose up -d --build lumio`.
3. Expose-le, par exemple sur `lumio.tondomaine`, via nginx-proxy-manager ou le tunnel Cloudflare (vers `lumio:3456`).
4. Dans Lumio, avec ton compte admin, va dans Profil, rubrique **Serveur Lumio**, renseigne `https://lumio.tondomaine` et touche **Envoyer la config Radarr/Sonarr**. Le lien « Inviter quelqu'un » transmet l'adresse aux autres.

Si Radarr, Sonarr et Jellyfin sont dans le même compose, utilise les noms des services (`http://radarr:7878`…). Sinon, utilise l'IP de la machine.

## API

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/health` | État du serveur, sans authentification |
| GET | `/api/me` | Droits et quotas de l'utilisateur |
| GET | `/api/media?type&tmdbId&tvdbId&seasons` | Statut d'un média et de ses saisons, et demandes en cours |
| GET | `/api/library` | Statuts pour les badges des affiches |
| GET | `/api/requests?filter&take&skip&sort&mine` | Liste des demandes (filtres all, pending, processing, available, declined, failed) |
| POST | `/api/requests` | `{ type, tmdbId, tvdbId?, seasons?, title, year, poster, backdrop, rootFolderPath?, qualityProfileId? }` |
| POST | `/api/requests/:id/approve` · `/retry` | Admin : valider (dossier et profil facultatifs), réessayer |
| POST | `/api/requests/:id/decline` | Admin : refuser `{ reason? }` |
| DELETE | `/api/requests/:id` | Le demandeur (si en attente) ou l'admin |
| GET | `/api/arr/options?type` | Dossiers racine, et profils de qualité pour l'admin |
| GET | `/api/queue` · `/api/status` | Téléchargements en cours · état des services |
| GET | `/status/public` | Sans jeton, pour le widget iOS : en ligne / hors ligne et compteurs (aucun titre) |
| GET / POST | `/api/ideas` | Mode développeur : idées et bugs proposés par la famille (notification à l'admin) |
| POST | `/api/ideas/:id/vote` | Voter (ou retirer son vote) |
| PUT / DELETE | `/api/ideas/:id` | Admin : statut (`new`, `planned`, `sent`, `done`, `rejected`) et réponse · suppression (auteur ou admin) |
| GET / PUT | `/api/admin/users` · `/api/admin/users/:id` | Admin : droits et quotas par utilisateur |
| PUT | `/api/admin/settings` | Admin : validation automatique et quotas par défaut, visibilité des demandes |
| POST | `/hooks/approve` · `/hooks/decline` | Boutons des notifications (lien signé HMAC) |
| POST | `/api/admin/notify-test` | Admin : notification de test |
| POST | `/api/admin/arr` | Admin : config Radarr / Sonarr |
| GET / PUT | `/api/secour` | Admin : état et config de Lumio Secour `{ url, key }` |
| GET | `/api/secour/links?type&imdb|tmdbId&season&episode` | Admin : liens trouvés par Lumio Secour |
| POST | `/api/secour/download` | Admin : `{ link, hoster, source, season, episode, type, root, folder, name }` → téléchargement sur un disque |
| GET / PUT | `/api/secour/settings` · DELETE `/api/secour/settings/:clé` | Admin : réglages de Lumio Secour (sources, TMDB, cache…) |
| GET | `/api/secour/health?refresh` | Admin : état des sources de Lumio Secour |
| GET | `/api/alldebrid?check=1` | Admin : clé AllDebrid configurée, et état du compte (Premium, date de fin) |
| GET / POST / DELETE | `/api/messages`… | Chat |

L'authentification passe par l'en-tête `X-Jellyfin-Token`. C'est le jeton de session Jellyfin, vérifié via `/Users/Me`.

## Disques et téléchargements AllDebrid (admin)

Pour gérer les disques depuis l'appli (parcourir, créer, renommer, déplacer, supprimer) et y télécharger des liens AllDebrid,
monte les disques dans le conteneur et liste-les dans `LUMIO_DISKS` (« Nom:/chemin », séparés par des virgules) :

```yaml
  lumio:
    environment:
      - LUMIO_DISKS=jellyfin1:/media/jellyfin1,jellyfin2:/media/jellyfin2,jellyfin3:/media/jellyfin3
    volumes:
      - ./lumio-server/data:/data
      - /media/norman/jellyfin1:/media/jellyfin1
      - /media/norman/jellyfin2:/media/jellyfin2
      - /media/norman/jellyfin3:/media/jellyfin3
```

La clé API AllDebrid se saisit dans l'appli (Accueil → icône Téléchargements) : elle est enregistrée sur le serveur seulement.
Tu peux aussi la mettre dans `.env` (`ALLDEBRID_KEY=…`).


## Lumio Secour (groupe de secours, intégré)

Lumio Secour est intégré au serveur Lumio : c'est un fork de WAStream (licence MIT, `secour/LICENSE`) transformé en
moteur interne. Ce n'est plus un addon Stremio : pas de manifest, pas de page de configuration, rien d'exposé.
`server.js` le lance dans le même conteneur (127.0.0.1:7010) et le relance s'il s'arrête.

**Groupe de secours** : quand Radarr ou Sonarr ne marchent plus (injoignable, délai dépassé, erreur 5xx, clé refusée),
une demande validée n'échoue plus : Lumio Secour prend le relais. Il cherche les liens, choisit le meilleur
(dispo AllDebrid, Multi / VF, 1080p), le convertit avec la clé AllDebrid du serveur, et range le fichier façon Jellyfin :

- films : `Films/Titre (année)/Titre (année).mkv`
- séries : `Séries/Titre (année)/Season 01/Titre (année) - S01E01.mkv` (épisodes déjà sortis des saisons demandées)

Un fichier à la fois. Si un lien échoue, le suivant est essayé. La demande affiche la progression, puis passe à « Terminée ».
Une notification part au début, à la fin, ou en cas d'échec.

Configuration :

- **Service de téléchargement** : TorBox (clé dans Lumio Secour, ou `TORBOX_KEY`) ou AllDebrid (`ALLDEBRID_KEY`). TorBox est choisi dès que sa clé est là
  (forcer avec `SECOUR_DEBRID=torbox|alldebrid`). La clé n'est jamais enregistrée par le moteur. TorBox ne prend pas en charge Wawacity.
- **Streaming (TorBox seulement)** : un titre pas encore sur Jellyfin se lit tout de suite (`POST /api/secour/stream`, toute la famille),
  pendant que Radarr / Sonarr le téléchargent. TorBox accepte plusieurs adresses IP. Désactivable : `PUT /api/secour/auto { stream: false }`.
- **Contrôle des sites** : une fois par nuit vers minuit (heure de Paris) ; un site qui redirige vers sa nouvelle adresse est mis à jour tout seul
  (notification à l'admin).
- **TMDB** : la clé TMDB du serveur Lumio est transmise automatiquement.
- **Sites** : aucun n'est fourni. Renseigne-les dans l'appli (Profil → Administration → Lumio Secour → réglages), ou dans le compose
  avec le préfixe `SECOUR_` : `SECOUR_WAWACITY_URL=https://…`, `SECOUR_ZONE_TELECHARGEMENT_URL=…`, `SECOUR_DARKI_API_URL=…`…
- **Dossiers** : réglés dans l'appli, ou `SECOUR_MOVIES=jellyfin1:Films` et `SECOUR_SERIES=jellyfin2:Séries`
  (sinon Lumio reprend le nom du dossier Radarr / Sonarr s'il existe sur un disque de `LUMIO_DISKS`).
- `LUMIO_SECOUR_EMBEDDED=0` désactive le moteur intégré. `LUMIO_SECOUR_URL` / `LUMIO_SECOUR_KEY` utilisent un service à part.

Les données du moteur (réglages, cache, liens morts) sont dans `/data/secour/`.


### Installation : rien à faire en SSH

Dans l'appli : Profil → Serveur → **Mettre à jour**. Le nouveau `server.js` voit que l'image (node:alpine) n'a pas Python :
il l'installe dans le conteneur (`apk`), télécharge le moteur Lumio Secour de la même version depuis GitHub, et l'installe dans
`/data/secour/venv` (compte quelques minutes la première fois, l'état s'affiche dans Profil → Lumio Secour).
Après une reconstruction du conteneur, Python est réinstallé tout seul au démarrage.

Plus tard, si tu es devant le serveur, tu peux passer à l'image avec Python déjà dedans (démarrage plus rapide) :

```sh
cd /data/lumio-server
curl -fsSL https://codeload.github.com/nono7444/lumio/tar.gz/refs/heads/main | tar -xz --strip-components=3 lumio-main/server/lumio
cd /data && docker compose up -d --build --force-recreate lumio
sudo sh /data/lumio-server/host/install-host-actions.sh   # le bouton « Mettre à jour » récupère alors tout le dossier
```

| Méthode | Route | Rôle |
|---|---|---|
| GET / PUT | `/api/secour/auto` | Admin : groupe de secours `{ enabled, movie: { root, folder }, tv: { root, folder } }` |
| POST | `/api/secour/requests/:id` | Admin : passer une demande par Lumio Secour à la main |
| GET / PUT | `/api/secour/debrid` | Admin : `{ service: 'torbox' \| 'alldebrid', torboxKey? }` (clé gardée sur le serveur) |
| POST | `/api/secour/stream` | Toute la famille (TorBox) : `{ type, tmdbId, season?, episode?, retry? }` → lien de lecture direct |
| POST | `/api/secour/grab` | Admin (bouton « LS ») : `{ type, tmdbId, tvdbId?, title, year, poster, seasons? }` → téléchargement direct par Lumio Secour |

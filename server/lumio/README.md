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


## Lumio Secour (liens d'hébergeurs, admin)

Lumio Secour (service à part, dans `/data/lumio-secour` sur le serveur) cherche des liens pour un film ou un épisode.
Dans l'appli, l'onglet **Lumio Secour** (admin) règle la connexion, la clé AllDebrid et les réglages du fork ;
sur une fiche, le bouton **Liens** les affiche ; un appui lance le téléchargement :
Lumio Secour convertit le lien avec la clé AllDebrid du serveur Lumio, puis le fichier arrive sur le disque choisi
et Jellyfin rescanne. Rien n'est lu en streaming dans l'appli.

```yaml
  lumio:
    environment:
      - LUMIO_SECOUR_URL=http://lumio-secour:7000   # ou depuis l'appli (Liens → Réglages)
      - LUMIO_SECOUR_KEY=${LUMIO_SECOUR_KEY}
```

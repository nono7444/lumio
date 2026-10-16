# Serveur Lumio

Petit serveur, en un seul fichier et sans dépendance, qui sert trois choses dans l'appli :

- **Chat famille** : onglet Chat, et bouton « Proposer » sur les fiches.
- **Demandes façon Seerr** : statuts (en attente, approuvée, refusée, échec, disponible), demandes saison par saison, validation automatique ou par l'admin, quotas, choix du dossier (Films, Kids, Anime…). Les clés Radarr et Sonarr restent sur ce serveur, jamais sur les téléphones. Chaque demande, validation ou arrivée dans Jellyfin est annoncée dans le chat.
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
| GET / PUT | `/api/admin/users` · `/api/admin/users/:id` | Admin : droits et quotas par utilisateur |
| PUT | `/api/admin/settings` | Admin : validation automatique et quotas par défaut, visibilité des demandes |
| POST | `/api/admin/arr` | Admin : config Radarr / Sonarr |
| GET / POST / DELETE | `/api/messages`… | Chat |

L'authentification passe par l'en-tête `X-Jellyfin-Token`. C'est le jeton de session Jellyfin, vérifié via `/Users/Me`.

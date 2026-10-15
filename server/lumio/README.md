# Serveur Lumio

Petit serveur, en un seul fichier et sans dépendance, qui sert trois choses dans l'appli :

- **Chat famille** : onglet Chat, et bouton « Proposer à la famille » sur les fiches.
- **Téléchargements pour tous** : un compte Jellyfin normal peut lancer un film ou une série dans Radarr ou Sonarr, en choisissant le dossier (Films, Kids, Anime…). Les clés Radarr et Sonarr restent sur ce serveur, jamais sur les téléphones. Chaque ajout est annoncé dans le chat.
- **État des serveurs** : Jellyfin, Radarr et Sonarr (en ligne ou non, version, espace disque, file d'attente).

On se connecte avec son compte Jellyfin, sans mot de passe en plus. Les données sont dans `/data` : `messages.json`, `history.json` et `config.json`.

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
| GET | `/api/status` | Jellyfin, Radarr, Sonarr : en ligne, version, disques, file |
| GET | `/api/messages?after=<id>` | Messages du chat |
| GET | `/api/latest` | Dernier message (pastille « non lu ») |
| POST | `/api/messages` | `{ text, media?: { type, tmdbId, title, year, poster } }` |
| DELETE | `/api/messages/:id` | Supprimer un message : l'auteur ou un admin |
| GET | `/api/arr/folders?type=movie\|tv` | Dossiers racine disponibles |
| POST | `/api/grab` | `{ type, tmdbId, tvdbId?, seasons?, rootFolderPath?, seriesType?, title, poster, askFolder? }`. Avec `askFolder` et sans dossier, le serveur renvoie `{ needFolder, folders }` si le titre est nouveau |
| GET | `/api/queue` | Téléchargements en cours |
| GET | `/api/history` | Qui a lancé quoi |
| POST | `/api/admin/arr` | Admin uniquement : `{ radarr: {url, apiKey, qualityProfileId…}, sonarr: {…} }` |

L'authentification passe par l'en-tête `X-Jellyfin-Token`. C'est le jeton de session Jellyfin, vérifié via `/Users/Me`.

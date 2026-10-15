# Lumio Chat

Serveur de discussion familiale pour l'onglet **Chat** de Lumio. Il tient en un seul fichier, sans dépendance. On se connecte avec son compte Jellyfin (aucun mot de passe en plus). Les messages sont stockés dans `/data/messages.json`.

## Installation (docker-compose, dans `/data/` sur le serveur)

```yaml
  lumio-chat:
    build: ./lumio-chat
    container_name: lumio-chat
    restart: unless-stopped
    environment:
      - JELLYFIN_URL=http://jellyfin:8096
    volumes:
      - ./lumio-chat/data:/data
    ports:
      - "3456:3456"
```

1. Copie `server.js` et `Dockerfile` dans `/data/lumio-chat/` sur le serveur.
2. Ajoute le bloc ci-dessus à ton `docker-compose.yml`, puis lance `docker compose up -d --build lumio-chat`.
3. Expose-le, par exemple sur `chat.tondomaine` via nginx-proxy-manager ou le tunnel Cloudflare (vers `lumio-chat:3456`).
4. Dans Lumio, va dans Profil, rubrique Chat, et renseigne `https://chat.tondomaine`. Le lien « Inviter quelqu'un » le transmet automatiquement.

`JELLYFIN_URL` doit être joignable depuis le conteneur. Si Jellyfin tourne dans le même compose, c'est le nom du service suivi de `:8096`.

## API

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/health` | État du serveur |
| GET | `/api/messages?after=<id>` | Messages (les nouveaux après `<id>`) |
| GET | `/api/latest` | Dernier message (pastille « non lu ») |
| POST | `/api/messages` | `{ text, media?: { type, tmdbId, title, year, poster } }` |
| DELETE | `/api/messages/:id` | Supprimer : l'auteur ou un admin Jellyfin |

L'authentification passe par l'en-tête `X-Jellyfin-Token` (jeton de session Jellyfin, vérifié via `/Users/Me`).

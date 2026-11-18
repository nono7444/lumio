# Moteur LooStream (addon de streaming, licence MIT : loostream/LICENSE), compilé à part puis copié dans l'image.
# Le code est pris dans le dépôt GitHub de Lumio (server/lumio/loostream) : la mise à jour depuis l'appli ne recopie que
# server.js, le Dockerfile, secour et host, donc l'image va chercher elle-même ce dossier.
FROM node:22-bookworm-slim AS loostream
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ADD https://codeload.github.com/nono7444/lumio/tar.gz/refs/heads/main /tmp/lumio.tgz
RUN mkdir -p /ls && tar -xzf /tmp/lumio.tgz -C /ls --strip-components=4 lumio-main/server/lumio/loostream && rm /tmp/lumio.tgz
WORKDIR /ls
RUN npm ci --no-audit --no-fund && npm run build && npm prune --omit=dev

# Serveur Lumio + Lumio Secour et LooStream intégrés (lancés par server.js, jamais exposés directement)
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Moteur Lumio Secour (fork de WAStream, licence MIT : secour/LICENSE)
COPY secour/ ./secour/
RUN python3 -m venv /opt/secour \
 && /opt/secour/bin/pip install --no-cache-dir ./secour \
 && rm -rf ./secour/build
# Moteur LooStream : code compilé, dépendances, réglages de départ (les réglages vivants sont dans /data/loostream)
COPY --from=loostream /ls/dist /opt/loostream/dist
COPY --from=loostream /ls/node_modules /opt/loostream/node_modules
COPY --from=loostream /ls/package.json /ls/LICENSE /ls/loostream.png /opt/loostream/
COPY --from=loostream /ls/config /opt/loostream/config
COPY server.js .
ENV PORT=3456 DATA_DIR=/data
VOLUME /data
EXPOSE 3456
CMD ["node", "server.js"]

# Serveur Lumio + Lumio Secour intégré (moteur Python lancé par server.js, écoute seulement sur 127.0.0.1)
FROM node:22-bookworm-slim
# ffmpeg + pilotes Intel (VAAPI) pour la conversion H.265 de nuit (dépôt non-free : encodage H.265 sur la puce graphique)
RUN sed -i 's/^Components: main$/Components: main non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates ffmpeg intel-media-va-driver-non-free i965-va-driver-shaders \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Moteur Lumio Secour (fork de WAStream, licence MIT : secour/LICENSE)
COPY secour/ ./secour/
RUN python3 -m venv /opt/secour \
 && /opt/secour/bin/pip install --no-cache-dir ./secour \
 && rm -rf ./secour/build
COPY server.js .
ENV PORT=3456 DATA_DIR=/data
VOLUME /data
EXPOSE 3456
CMD ["node", "server.js"]

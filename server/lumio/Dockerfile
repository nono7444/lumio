# Serveur Lumio + Lumio Secour intégré (lancé par server.js)
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
COPY server.js .
ENV PORT=3456 DATA_DIR=/data
VOLUME /data
EXPOSE 3456
CMD ["node", "server.js"]

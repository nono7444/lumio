#!/bin/sh
# Lumio : installe sur la machine le petit service qui permet, depuis l'appli (admin seulement),
# de redémarrer le PC et de mettre à jour le serveur Lumio.
# Le conteneur « lumio » dépose une demande dans son dossier de données (host-actions/reboot) ;
# systemd la voit, l'efface et redémarre le PC. À lancer une seule fois : sudo sh install-host-actions.sh
set -e
SRC=$(docker inspect lumio --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}')
if [ -z "$SRC" ]; then echo "Dossier de données du conteneur lumio introuvable (le conteneur tourne ?)"; exit 1; fi
DIR="$SRC/host-actions"
mkdir -p "$DIR"
touch "$DIR/.helper"
cat > /etc/systemd/system/lumio-reboot.path <<UNIT
[Unit]
Description=Lumio : demande de redémarrage depuis l'appli
[Path]
PathExists=$DIR/reboot
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/lumio-reboot.service <<UNIT
[Unit]
Description=Lumio : redémarrage de la machine demandé depuis l'appli
[Service]
Type=oneshot
ExecStart=/bin/sh -c 'rm -f "$DIR/reboot"; sleep 3; /usr/bin/systemctl reboot'
UNIT
# Mise à jour du serveur Lumio : server.js, Dockerfile et Lumio Secour depuis GitHub, puis reconstruction du conteneur
CODE=$(dirname "$SRC")
COMPOSE_DIR=$(docker inspect lumio --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}')
cat > "$CODE/update.sh" <<'SCRIPT'
#!/bin/sh
# Lumio : mise à jour demandée depuis l'appli (Profil → Serveur → Mettre à jour)
set -e
DIR="$1"; CODE="$2"; COMPOSE_DIR="$3"
rm -f "$DIR/update"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL https://codeload.github.com/nono7444/lumio/tar.gz/refs/heads/main | tar -xz -C "$TMP" --strip-components=3 lumio-main/server/lumio
test -s "$TMP/server.js"
cp "$TMP/server.js" "$CODE/server.js"
cp "$TMP/Dockerfile" "$CODE/Dockerfile"
rm -rf "$CODE/secour"
cp -R "$TMP/secour" "$CODE/secour"
cd "$COMPOSE_DIR" && docker compose up -d --build --force-recreate lumio
SCRIPT
chmod +x "$CODE/update.sh"
cat > /etc/systemd/system/lumio-update.path <<UNIT
[Unit]
Description=Lumio : demande de mise à jour depuis l'appli
[Path]
PathExists=$DIR/update
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/lumio-update.service <<UNIT
[Unit]
Description=Lumio : mise à jour du serveur demandée depuis l'appli
[Service]
Type=oneshot
ExecStart=/bin/sh $CODE/update.sh "$DIR" "$CODE" "$COMPOSE_DIR"
UNIT
# Redémarrage de Jellyfin (quand il ne sait pas se relancer seul dans Docker)
cat > /etc/systemd/system/lumio-jellyfin.path <<UNIT
[Unit]
Description=Lumio : demande de redémarrage de Jellyfin depuis l'appli
[Path]
PathExists=$DIR/restart-jellyfin
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/lumio-jellyfin.service <<UNIT
[Unit]
Description=Lumio : redémarrage de Jellyfin demandé depuis l'appli
[Service]
Type=oneshot
ExecStart=/bin/sh -c 'rm -f "$DIR/restart-jellyfin"; docker restart jellyfin'
UNIT
systemctl daemon-reload
systemctl enable --now lumio-reboot.path lumio-update.path lumio-jellyfin.path
echo "OK : boutons « Redémarrer le PC serveur », « Redémarrer Jellyfin » et « Mettre à jour le serveur Lumio » prêts (dossier surveillé : $DIR)."

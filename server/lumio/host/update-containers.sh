#!/bin/sh
# Lumio : mise à jour des conteneurs demandée depuis l'appli (Profil → Serveur → Mettre à jour les conteneurs).
# Lancé par le service lumio-containers de la machine. Écrit l'avancement (pourcentage) pour l'appli :
#   $DIR/containers-progress : « 42 Téléchargement de jellyfin (3/7) »
#   $DIR/containers-last.log : journal, terminé par LUMIO_EXIT=<code>
DIR="$1"; COMPOSE_DIR="$2"
rm -f "$DIR/update-containers"
LOG="$DIR/containers-last.log"
PROG="$DIR/containers-progress"
step() { echo "$1 $2" > "$PROG"; }
{
  echo "Début : $(date '+%d/%m/%Y %H:%M')"
  cd "$COMPOSE_DIR" || { echo "LUMIO_EXIT=1"; exit 1; }
  step 2 "Préparation"
  SERVICES=$(docker compose config --services 2>/dev/null)
  TOTAL=$(echo "$SERVICES" | grep -c .)
  [ "$TOTAL" -gt 0 ] || TOTAL=1
  i=0
  # Téléchargement des images, service par service (85 % de la barre) ; les images construites ici (lumio) sont ignorées
  for s in $SERVICES; do
    i=$((i + 1))
    step $((2 + i * 83 / TOTAL)) "Téléchargement de $s ($i/$TOTAL)"
    echo "== $s"
    docker compose pull --ignore-buildable "$s" 2>&1 || docker compose pull --ignore-pull-failures "$s" 2>&1
  done
  # Redémarrage des conteneurs dont l'image a changé
  step 88 "Redémarrage des conteneurs mis à jour"
  docker compose up -d 2>&1
  code=$?
  step 96 "Nettoyage des anciennes images"
  docker image prune -f 2>&1 | tail -n 1
  step 100 "Terminé"
  echo "Fin : $(date '+%d/%m/%Y %H:%M')"
  echo "LUMIO_EXIT=$code"
} > "$LOG" 2>&1

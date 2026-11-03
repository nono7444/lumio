# qBittorrent derrière ProtonVPN (Gluetun) pour Lumio Auto

Lumio Auto envoie les torrents des trackers (C411, TR4KER…) à **qBittorrent**. qBittorrent passe **uniquement**
par le VPN : si le VPN tombe, il n'a plus Internet, donc ton adresse IP ne fuite jamais.
Après le téléchargement, Lumio range le film par **lien dur** (même fichier, deux noms, aucune place en plus)
et qBittorrent **continue de partager** jusqu'au ratio ou à la durée choisis (Auto → Réglages → qBittorrent).
AllDebrid (rdt-client ou direct) reste disponible pour les autres sites.

## 1. Clé WireGuard ProtonVPN

1. Sur [account.proton.me/u/0/vpn/WireGuard](https://account.proton.me/u/0/vpn/WireGuard), crée une configuration :
   - plateforme : **Linux** ;
   - options : coche **NAT-PMP (Port Forwarding)** (indispensable pour bien partager) ;
   - serveur : un serveur **P2P** (icône ⇄), par exemple aux Pays-Bas ou en Suisse.
2. Copie la ligne `PrivateKey = …` et mets-la dans `/data/.env` sur le serveur (jamais dans Git, jamais dans un message) :

```sh
nano /data/.env
# ajoute :
PROTON_WG_KEY=la_clé_privée_ici
```

## 2. Dossiers de téléchargement (un par disque)

Le lien dur ne marche que sur un même disque. qBittorrent télécharge donc sur le disque où le film sera rangé :

```sh
mkdir -p /media/norman/jellyfin1/downloads/qbit /media/norman/jellyfin2/downloads/qbit /media/norman/jellyfin3/downloads/qbit
sudo chown -R 1000:1000 /media/norman/jellyfin*/downloads/qbit
```

Les noms `jellyfin1`, `jellyfin2`, `jellyfin3` doivent être **les mêmes que les noms des disques de Lumio**
(variable `LUMIO_DISKS` du service `lumio`).

## 3. Les deux services à ajouter dans `/data/docker-compose.yaml`

```yaml
  gluetun:
    image: qmcgaw/gluetun:v3.40.0
    container_name: gluetun
    restart: unless-stopped
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
    environment:
      - VPN_SERVICE_PROVIDER=protonvpn
      - VPN_TYPE=wireguard
      - WIREGUARD_PRIVATE_KEY=${PROTON_WG_KEY}
      - SERVER_COUNTRIES=Netherlands,Switzerland
      - PORT_FORWARD_ONLY=on
      - VPN_PORT_FORWARDING=on
      # Donne à qBittorrent le port ouvert par ProtonVPN (et le remet après une reconnexion)
      - VPN_PORT_FORWARDING_UP_COMMAND=/bin/sh -c 'wget -O- -nv --retry-connrefused --post-data "json={\"listen_port\":{{PORT}},\"current_network_interface\":\"{{VPN_INTERFACE}}\",\"random_port\":false,\"upnp\":false}" http://127.0.0.1:8080/api/v2/app/setPreferences'
      - VPN_PORT_FORWARDING_DOWN_COMMAND=/bin/sh -c 'wget -O- -nv --retry-connrefused --post-data "json={\"listen_port\":0,\"current_network_interface\":\"lo\"}" http://127.0.0.1:8080/api/v2/app/setPreferences'
      - TZ=Europe/Paris
    ports:
      - "8080:8080"   # interface web de qBittorrent (sur le réseau de la maison)

  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:5.0.3
    container_name: qbittorrent
    restart: unless-stopped
    network_mode: "service:gluetun"   # tout le trafic passe par le VPN
    depends_on:
      - gluetun
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Europe/Paris
      - WEBUI_PORT=8080
    volumes:
      - ./qbittorrent/config:/config
      - /media/norman/jellyfin1/downloads/qbit:/downloads/jellyfin1
      - /media/norman/jellyfin2/downloads/qbit:/downloads/jellyfin2
      - /media/norman/jellyfin3/downloads/qbit:/downloads/jellyfin3
```

Puis :

```sh
cd /data && docker compose up -d gluetun qbittorrent
docker logs gluetun 2>&1 | grep -i "port forward"   # doit afficher le port ouvert
docker logs qbittorrent 2>&1 | grep -i password      # mot de passe temporaire de l'interface web
```

## 4. Réglages de qBittorrent (http://192.168.1.71:8080)

Connecte-toi avec `admin` et le mot de passe temporaire, puis dans **Outils → Options** :

- **Interface web** : change le mot de passe ; coche **« Contourner l'authentification pour les clients sur localhost »**
  (Gluetun en a besoin pour donner le port) ;
- **Téléchargements** : dossier par défaut `/downloads/jellyfin3` ;
- **Vitesse** : limite d'envoi à environ la moitié de ton débit montant (pour que Jellyfin reste fluide) ;
- **BitTorrent** : décoche « Limite de partage » (c'est Lumio qui retire les torrents au bon moment).

Vérifie que l'IP vue par qBittorrent est bien celle du VPN :

```sh
docker exec gluetun wget -qO- https://ipinfo.io/ip
```

## 5. Dans Lumio (bêta → Auto → Réglages)

- **qBittorrent** :
  - adresse `http://gluetun:8080` ;
  - identifiant / mot de passe de l'interface web ;
  - dossier vu par qBittorrent `/downloads` ;
  - dossier sur le disque `downloads/qbit` ;
  - puis touche **Tester**. Le test doit afficher le port et l'interface `tun0`.
- **Partage** : ratio 1 ou 7 jours, à régler selon les règles de tes trackers.
- **Client par défaut** : qBittorrent. Pour AllDebrid, choisis-le sur l'indexeur concerné (onglet Indexeurs → Télécharger avec).

## 6. Retirer Radarr, Sonarr et Prowlarr

Quand Lumio Auto tourne bien :

```sh
cd /data
docker compose stop radarr sonarr prowlarr
# supprime leurs blocs dans docker-compose.yaml, puis :
docker compose up -d --remove-orphans
```

Leurs dossiers de configuration (`./radarr`, `./sonarr`, `./prowlarr`) peuvent être gardés quelques semaines, au cas où,
puis supprimés. Pense aussi à retirer `radarr.wawanono.lol` et `sonarr.wawanono.lol` de nginx-proxy-manager
et du tunnel Cloudflare.

#!/usr/bin/env python3
# Lumio : vérifie en une fois que le VPN protège bien qBittorrent et que le partage (seed) fonctionne.
# Sur le serveur :  curl -s https://raw.githubusercontent.com/nono7444/lumio/main/server/lumio/host/check-seed.py | python3
# (aucun mot de passe ni clé affichés ; qBittorrent est lu par l'intérieur du conteneur gluetun)
import json
import subprocess


def sh(c):
    try:
        return subprocess.run(c, shell=True, capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        return ''


def qb(p):
    out = sh(f'docker exec gluetun wget -qO- http://127.0.0.1:8080{p}')
    try:
        return json.loads(out)
    except Exception:
        return None


def go(b):
    return f'{(b or 0) / 1e9:.1f} Go'


def mo(b):
    return f'{(b or 0) / 1e6:.2f} Mo/s'


maison = sh('curl -s --max-time 10 https://ipinfo.io/ip')
vpn = sh('docker exec gluetun wget -qO- --timeout=10 https://ipinfo.io/ip')
print('── VPN')
print(f'  IP vue par qBittorrent : {vpn or "injoignable"}')
print('  ✅ protégé (ce n’est pas l’IP de la maison)' if vpn and vpn != maison else '  ❌ PROBLÈME : même IP que la maison ou VPN coupé')
port = sh('docker exec gluetun cat /tmp/gluetun/forwarded_port 2>/dev/null')
pref = qb('/api/v2/app/preferences')
if pref is None:
    print('  ⚠️ qBittorrent ne répond pas depuis gluetun (case « Contourner l’authentification pour localhost » décochée ?)')
    pref = {}
print(f'  Port ouvert par Proton : {port or "aucun"} · port de qBittorrent : {pref.get("listen_port", "?")} · interface : {pref.get("current_network_interface", "?")}')
print('  ✅ port OK' if port and str(pref.get('listen_port')) == port else '  ⚠️ ports différents (Lumio le corrige en 2 min) ou pas de port')

t = qb('/api/v2/transfer/info') or {}
print('── qBittorrent')
print(f'  Connexion : {t.get("connection_status", "?")}  (connected = parfait, firewalled = port fermé)')
print(f'  Vitesse maintenant : ↓ {mo(t.get("dl_info_speed"))} · ↑ {mo(t.get("up_info_speed"))}')
print(f'  Depuis le démarrage de qBittorrent : ↓ {go(t.get("dl_info_data"))} · ↑ {go(t.get("up_info_data"))}')

L = qb('/api/v2/torrents/info') or []
up = [x for x in L if x.get('state') in ('uploading', 'stalledUP', 'forcedUP')]
actif = [x for x in L if x.get('state') in ('uploading', 'forcedUP')]
file = [x for x in L if x.get('state') == 'queuedUP']
dl = [x for x in L if x.get('state', '').endswith('DL') or x.get('state') == 'downloading']
print('── Partage')
print(f'  {len(L)} torrents · {len(up)} en partage · {len(actif)} envoient en ce moment · {len(file)} en file d’attente · {len(dl)} en téléchargement')
print(f'  Total envoyé par ces torrents : {go(sum(x.get("uploaded", 0) for x in L))}')
if file:
    print('  ⚠️ des torrents attendent leur tour : Auto → qBit → Réglages du partage → « Partager un maximum »')
for x in sorted(L, key=lambda x: -x.get('uploaded', 0))[:5]:
    print(f'   · ratio {x.get("ratio", 0):.2f} · ↑ {go(x.get("uploaded"))} · {x.get("name", "")[:60]}')

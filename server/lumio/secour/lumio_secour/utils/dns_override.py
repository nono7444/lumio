"""Lumio : résolution des noms par 1.1.1.1 (DNS chiffré de Cloudflare).

Les DNS des fournisseurs d'accès français ne répondent pas pour certains sites (Movix, Wawacity…) : le moteur
ne trouvait alors aucun lien. Ici, chaque nom public est d'abord demandé à 1.1.1.1 (puis 1.0.0.1) en HTTPS ;
si ça échoue, le DNS habituel de la machine reprend la main. Les noms locaux (jellyfin, localhost, IP) ne
sont jamais envoyés à l'extérieur.
"""
import ipaddress
import json
import os
import socket
import ssl
import threading
import time
import urllib.request
from typing import Dict, List, Optional, Tuple

_RESOLVERS = ("1.1.1.1", "1.0.0.1")
_cache: Dict[str, Tuple[float, List[str]]] = {}
_lock = threading.Lock()
_original_getaddrinfo = socket.getaddrinfo
_installed = False
_ctx: Optional[ssl.SSLContext] = None


def _is_local(host: str) -> bool:
    h = host.strip(".").lower()
    if not h or "." not in h or h == "localhost" or h.endswith((".local", ".lan", ".internal", ".home", ".localhost")):
        return True
    try:
        ipaddress.ip_address(h)
        return True
    except ValueError:
        return False


def _query(host: str) -> List[str]:
    global _ctx
    if _ctx is None:
        _ctx = ssl.create_default_context()
    for resolver in _RESOLVERS:
        try:
            req = urllib.request.Request(
                f"https://{resolver}/dns-query?name={host}&type=A",
                headers={"accept": "application/dns-json"},
            )
            # Pas de proxy pour la question DNS elle-même
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=_ctx))
            with opener.open(req, timeout=4) as r:
                data = json.loads(r.read().decode("utf-8", "replace"))
            ips = [a.get("data") for a in data.get("Answer") or [] if a.get("type") == 1 and a.get("data")]
            if ips:
                ttl = min([int(a.get("TTL") or 300) for a in data.get("Answer") or [] if a.get("type") == 1] or [300])
                with _lock:
                    _cache[host] = (time.time() + max(60, min(ttl, 3600)), ips)
                return ips
        except Exception:
            continue
    # Rien obtenu : on n'insiste pas pendant 2 minutes, le DNS de la machine répond à la place
    with _lock:
        _cache[host] = (time.time() + 120, [])
    return []


def _resolve(host: str) -> List[str]:
    with _lock:
        hit = _cache.get(host)
    if hit and hit[0] > time.time():
        return hit[1]
    return _query(host)


def _getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    try:
        name = host.decode() if isinstance(host, bytes) else host
        if isinstance(name, str) and family in (0, socket.AF_INET) and not _is_local(name):
            ips = _resolve(name.strip(".").lower())
            if ips:
                out = []
                for ip in ips:
                    out.extend(_original_getaddrinfo(ip, port, socket.AF_INET, type, proto, flags))
                if out:
                    return out
    except Exception:
        pass
    return _original_getaddrinfo(host, port, family, type, proto, flags)


def install() -> bool:
    """Active la résolution par 1.1.1.1 (une seule fois). Coupée par LUMIO_SECOUR_DOH=0."""
    global _installed
    if _installed or os.environ.get("LUMIO_SECOUR_DOH", "1").lower() in ("0", "false", "no"):
        return _installed
    socket.getaddrinfo = _getaddrinfo
    _installed = True
    return True

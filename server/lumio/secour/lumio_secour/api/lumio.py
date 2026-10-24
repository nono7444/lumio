# ——— Lumio Secour : API privée pour le serveur Lumio ———
# Le serveur Lumio s'en sert quand Radarr / Sonarr ne répondent plus :
#   GET  /lumio/ping                      → version, sources configurées, TMDB
#   GET  /lumio/links?imdb&type&season&episode → liens d'hébergeurs triés (qualité, langue, taille, dispo AllDebrid)
#   POST /lumio/resolve {link, hoster, source, season, episode, type} → { url } (lien direct AllDebrid)
#   GET/PUT /lumio/settings · DELETE /lumio/settings/{KEY} → réglages du fork
#   GET  /lumio/health?refresh=true       → état des sources
# Sécurité : en-tête X-Lumio-Key = LUMIO_API_KEY (obligatoire). La clé AllDebrid arrive à chaque appel
# dans X-Debrid-Key : elle n'est jamais enregistrée ici. Le jeton TMDB peut venir de X-Tmdb-Key.

import hmac
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Header, HTTPException, Query, Request

from lumio_secour.config.settings import settings
from lumio_secour.services.health import check_sources_only, get_health_status
from lumio_secour.services.settings_manager import get_settings_view, reset_override, set_override
from lumio_secour.services.stream import stream_service
from lumio_secour.utils.database import DEAD_LINK_STATUS_CONFIRMED, get_dead_link_statuses_batch
from lumio_secour.utils.helpers import deduplicate_and_sort_results, parse_size_to_bytes
from lumio_secour.utils.logger import api_logger
from lumio_secour.utils.quality import quality_sort_key

router = APIRouter(prefix="/lumio", tags=["Lumio"])

SOURCE_KEYS = {
    "Wawacity": "WAWACITY_URL",
    "Free-Telecharger": "FREE_TELECHARGER_URL",
    "Darki-API": "DARKI_API_URL",
    "Movix": "MOVIX_URL",
    "Webshare": "WEBSHARE_URL",
    "Zone-Telechargement": "ZONE_TELECHARGEMENT_URL",
}


def _check_key(request: Request) -> None:
    expected = settings.LUMIO_API_KEY or ""
    given = request.headers.get("X-Lumio-Key", "")
    if not expected:
        raise HTTPException(status_code=503, detail="LUMIO_API_KEY n'est pas définie dans le docker-compose de Lumio Secour")
    if not hmac.compare_digest(given.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Clé Lumio Secour refusée")


def _debrid_key(request: Request) -> str:
    return (request.headers.get("X-Debrid-Key") or "").strip()


def _tmdb_token(request: Request) -> str:
    return (settings.TMDB_API_KEY or request.headers.get("X-Tmdb-Key") or "").strip()


def _config(debrid_key: str, tmdb: str) -> Dict[str, Any]:
    return {
        "debrid_services": [{"service": "alldebrid", "api_key": debrid_key}] if debrid_key else [],
        "tmdb_api_token": tmdb,
    }


def _sources() -> List[str]:
    out = [name for name, key in SOURCE_KEYS.items() if getattr(settings, key, None)]
    return out


def _int(v: Any) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


@router.get("/ping")
async def ping(request: Request):
    _check_key(request)
    return {
        "ok": True,
        "name": settings.ADDON_NAME,
        "version": settings.ADDON_MANIFEST["version"],
        "sources": _sources(),
        "tmdb": bool(_tmdb_token(request)),
        "debrid": bool(_debrid_key(request)),
    }


@router.get("/links")
async def links(
    request: Request,
    imdb: str = Query(..., pattern=r"^tt\d+$"),
    type: str = Query("movie"),
    season: Optional[int] = Query(None, ge=0),
    episode: Optional[int] = Query(None, ge=0),
):
    _check_key(request)
    started = time.time()
    content_type = "series" if type in ("series", "tv") else "movie"
    tmdb = _tmdb_token(request)
    if not tmdb:
        raise HTTPException(status_code=400, detail="Jeton TMDB manquant (réglage TMDB_API_KEY de Lumio Secour)")
    debrid_key = _debrid_key(request)
    config = _config(debrid_key, tmdb)

    metadata = await stream_service._get_metadata(imdb, tmdb)
    if not metadata:
        raise HTTPException(status_code=404, detail="Titre introuvable sur TMDB")

    s = str(season) if content_type == "series" and season is not None else None
    e = str(episode) if content_type == "series" and episode is not None else None
    results = await stream_service._search_content(
        metadata["title"], metadata.get("year"), content_type, s, e, metadata.get("enhanced"), config
    )
    results = deduplicate_and_sort_results(results or [], quality_sort_key)

    # Disponibilité AllDebrid (si la clé est là) : ajoute cache_status et le nom réel du fichier
    if debrid_key and results:
        remaining = max(3.0, settings.STREAM_REQUEST_TIMEOUT - (time.time() - started))
        try:
            results = await stream_service._check_cache_and_enrich(
                results, config["debrid_services"], config, remaining, s, e
            )
        except Exception as ex:  # la recherche reste utile sans la vérification
            api_logger.error(f"[Lumio] Vérification AllDebrid : {type(ex).__name__}: {ex}")

    # Liens morts connus : retirés
    all_links = [r["link"] for r in results if isinstance(r.get("link"), str) and r.get("link")]
    dead = await get_dead_link_statuses_batch(all_links) if all_links else {}

    out = []
    seen = set()
    for r in results:
        link = r.get("link")
        if not isinstance(link, str) or not link or link in seen:
            continue
        if int((dead.get(link) or {}).get("failure_count", 0)) >= DEAD_LINK_STATUS_CONFIRMED:
            continue
        if r.get("model_type") == "nzb":
            continue
        seen.add(link)
        name = r.get("debrid_filename") or r.get("display_name") or ""
        if name.startswith("Unknown") and name.endswith("Link"):
            name = r.get("display_name") or ""
        size = r.get("size") or "Unknown"
        size_bytes = parse_size_to_bytes(size) if size != "Unknown" else 0
        out.append({
            "link": link,
            "name": name if name != "Unknown" else "",
            "quality": r.get("quality") or "Unknown",
            "language": r.get("language") or "Unknown",
            "size": size,
            "sizeBytes": size_bytes or None,
            "hoster": r.get("hoster") or "Unknown",
            "source": r.get("source") or "",
            "cached": r.get("cache_status") == "cached",
            "season": _int(r.get("season")) if r.get("season") is not None else _int(s),
            "episode": _int(r.get("episode")) if r.get("episode") is not None else _int(e),
        })

    # Archives (.rar, .zip…) : inutilisables par Jellyfin
    out = [x for x in out if not any(x["name"].lower().endswith(ext) for ext in (".rar", ".zip", ".7z", ".iso"))]

    api_logger.info(f"[Lumio] {imdb} {content_type} S{s}E{e} : {len(out)} lien(s) en {time.time() - started:.1f}s")
    return {"title": metadata["title"], "year": metadata.get("year"), "debrid": bool(debrid_key), "links": out}


@router.post("/resolve")
async def resolve(request: Request, body: Dict[str, Any] = Body(...)):
    _check_key(request)
    debrid_key = _debrid_key(request)
    if not debrid_key:
        raise HTTPException(status_code=400, detail="Clé AllDebrid manquante")
    link = str(body.get("link") or "").strip()
    if not link.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Lien invalide")
    season = body.get("season")
    episode = body.get("episode")
    content_type = "series" if body.get("type") in ("series", "tv") else "movie"
    result = await stream_service.resolve_link(
        link,
        _config(debrid_key, _tmdb_token(request)),
        str(season) if season not in (None, "") else None,
        str(episode) if episode not in (None, "") else None,
        "alldebrid",
        content_type,
        None,
        body.get("source") or None,
        body.get("hoster") or None,
    )
    if result and isinstance(result, str) and result.startswith("http"):
        return {"url": result}
    messages = {
        "LINK_DOWN": "Lien mort",
        "LINK_SERVICE_DOWN": "Hébergeur indisponible chez AllDebrid",
        "LINK_UNSUPPORTED": "Hébergeur non pris en charge par AllDebrid",
        "LINK_UNCACHED": "Fichier pas encore prêt chez AllDebrid",
        "RETRY_ERROR": "AllDebrid ne répond pas, réessaie",
    }
    raise HTTPException(status_code=422, detail=messages.get(str(result), f"Conversion impossible ({result or 'erreur'})"))


@router.get("/settings")
async def get_settings(request: Request):
    _check_key(request)
    return {"categories": await get_settings_view()}


@router.put("/settings")
async def put_settings(request: Request, body: Dict[str, Any] = Body(...)):
    _check_key(request)
    updates = body.get("updates") or {}
    if not isinstance(updates, dict):
        raise HTTPException(status_code=400, detail="updates doit être un objet")
    results = {}
    for key, value in updates.items():
        if key == "LUMIO_API_KEY":
            results[key] = "not_editable"
            continue
        results[key] = await set_override(key, value)
    return {"success": all(v in ("ok", "skipped") for v in results.values()), "results": results}


@router.delete("/settings/{key}")
async def delete_setting(request: Request, key: str):
    _check_key(request)
    return {"result": await reset_override(key)}


@router.get("/health")
async def health(request: Request, refresh: bool = Query(False)):
    _check_key(request)
    data = await check_sources_only() if refresh else get_health_status()
    return {"sources": data.get("sources", []), "summary": data.get("summary", {}), "last_check": data.get("last_sources_check")}

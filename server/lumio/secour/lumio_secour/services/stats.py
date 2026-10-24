import time
from typing import Dict, Any

from lumio_secour.utils.database import database, get_cache_stats
from lumio_secour.utils.logger import database_logger
from lumio_secour.services.dead_links import get_dead_links_count


# ===========================
# Stats Summary
# ===========================
async def get_stats_summary() -> Dict[str, Any]:
    try:
        from lumio_secour.main import SERVER_START_TIME
        uptime_seconds = int(time.time()) - SERVER_START_TIME

        users_count = await database.fetch_val("SELECT COUNT(*) FROM users") or 0
        dead_links_count = await get_dead_links_count()

        cache_stats = await get_cache_stats()

        return {
            "uptime_seconds": uptime_seconds,
            "users": users_count,
            "dead_links": dead_links_count,
            "searches_cached": cache_stats.get("searches_cached", 0),
            "streams_total": cache_stats.get("streams_total", 0),
            "by_source_total": cache_stats.get("by_source_total", {}),
            "by_content_type_total": cache_stats.get("by_content_type_total", {})
        }

    except Exception as e:
        database_logger.error(f"[Stats] Failed to get stats: {type(e).__name__}: {e}")
        return {
            "uptime_seconds": 0,
            "users": 0,
            "dead_links": 0,
            "searches_cached": 0,
            "streams_total": 0,
            "by_source_total": {},
            "by_content_type_total": {}
        }

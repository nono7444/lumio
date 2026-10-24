import time
from asyncio import sleep
from typing import Optional, List, Dict
from urllib.parse import urlparse

from lumio_secour.config.settings import settings
from lumio_secour.debrid.base import BaseDebridService, HTTP_RETRY_ERRORS
from lumio_secour.services.hoster_status import mark_hoster_down, is_hoster_up, schedule_alldebrid_hoster_recheck
from lumio_secour.utils.http_client import http_client
from lumio_secour.utils.logger import debrid_logger, cache_logger
from lumio_secour.utils.quality import quality_sort_key
from lumio_secour.utils.urls import url_matches_host

# ===========================
# AllDebrid Error Constants
# ===========================
RETRY_ERRORS = [
    "LINK_HOST_UNAVAILABLE",
    "LINK_TEMPORARY_UNAVAILABLE",
    "LINK_TOO_MANY_DOWNLOADS",
    "LINK_HOST_FULL",
    "LINK_HOST_LIMIT_REACHED",
    "REDIRECTOR_ERROR",
]

UNSUPPORTED_LINK_ERRORS = [
    "LINK_PASS_PROTECTED",
]


# ===========================
# AllDebrid Service Class
# ===========================
class AllDebridService(BaseDebridService):
    AUTHORITATIVE_DEAD_LINK_RESULTS = frozenset({"LINK_DOWN"})

    def get_service_name(self) -> str:
        return "AllDebrid"

    @staticmethod
    def _is_direct_hoster_link(link: str) -> bool:
        return url_matches_host(link, settings.ALLDEBRID_SUPPORTED_HOSTS)

    @staticmethod
    def _link_info_is_available(info: Dict) -> bool:
        return bool(
            not info.get("error")
            and info.get("link")
            and (
                info.get("filename") is not None
                or info.get("host")
                or info.get("hostDomain")
            )
        )

    async def _request_hoster_link_infos(
        self,
        links: List[str],
        api_key: str,
    ) -> List[Dict]:
        links = list(dict.fromkeys(
            link for link in links if isinstance(link, str) and link
        ))
        if not links:
            return []

        response = await http_client.post(
            f"{settings.ALLDEBRID_API_URL}/link/infos",
            params={"agent": settings.ADDON_NAME, "apikey": api_key},
            data={"link[]": links},
            timeout=settings.DEBRID_CACHE_CHECK_HTTP_TIMEOUT,
        )
        if response.status_code != 200:
            return []

        data = response.json()
        if data.get("status") != "success":
            return []

        infos = data.get("data", {}).get("infos", [])
        if (
            not isinstance(infos, list)
            or len(infos) != len(links)
            or not all(isinstance(info, dict) for info in infos)
        ):
            return []
        return infos

    @staticmethod
    def _info_matches_hoster(info: Dict, hoster: Optional[str]) -> bool:
        if not hoster:
            return False
        for key in ("hostDomain", "host"):
            value = str(info.get(key) or "").strip()
            if not value:
                continue
            host_url = value if "://" in value else f"https://{value}"
            if url_matches_host(host_url, [hoster]):
                return True
        return False

    async def _select_redirected_link(
        self,
        links: List[str],
        api_key: str,
        hoster: Optional[str],
    ) -> Optional[str]:
        links = list(dict.fromkeys(
            link for link in links if isinstance(link, str) and link
        ))
        if not links:
            return None
        if len(links) == 1:
            return links[0]

        infos = await self._request_hoster_link_infos(links, api_key)
        if not infos:
            return links[0]

        available = [
            (link, info)
            for link, info in zip(links, infos)
            if self._link_info_is_available(info)
        ]
        if hoster:
            for link, info in available:
                if self._info_matches_hoster(info, hoster):
                    return link
        return available[0][0] if available else links[0]

    async def check_cache_and_enrich(self, results: List[Dict], api_key: str, config: Dict, timeout_remaining: float, user_season: Optional[str] = None, user_episode: Optional[str] = None, user_hosts: Optional[List[str]] = None) -> List[Dict]:
        start_time = time.time()

        if not api_key or not results:
            for result in results:
                result["cache_status"] = "uncached"
            return results

        supported_hosts = user_hosts if user_hosts else settings.ALLDEBRID_SUPPORTED_HOSTS

        initial_count = len(results)
        filtered_results = []
        for result in results:
            if result.get("model_type") == "nzb":
                continue
            hoster = result.get("hoster", "").lower()
            if any(supported_host in hoster for supported_host in supported_hosts):
                filtered_results.append(result)

        if len(filtered_results) < initial_count:
            debrid_logger.debug(f"[AllDebrid] Filtered: {initial_count} → {len(filtered_results)} links (doesn't support Usenet)")

        if not filtered_results:
            debrid_logger.debug("[AllDebrid] No supported hosts")
            return []

        # Filter out hosters marked as down (reactive detection)
        before_count = len(filtered_results)
        down_hosters = {}
        kept_results = []
        for r in filtered_results:
            hoster = r.get("hoster", "").lower()
            if is_hoster_up("alldebrid", hoster):
                kept_results.append(r)
            else:
                if hoster and hoster not in down_hosters:
                    down_hosters[hoster] = r.get("link", "")
        filtered_results = kept_results
        if len(filtered_results) < before_count:
            debrid_logger.debug(f"[AllDebrid] Hoster status: {before_count} → {len(filtered_results)}")

        # Background recheck: test one real link per DOWN host
        if down_hosters and config.get("recheck_hoster_status", False):
            for hoster_name, link in down_hosters.items():
                schedule_alldebrid_hoster_recheck(link, api_key, hoster_name)
                debrid_logger.debug(f"[AllDebrid] Background recheck scheduled for '{hoster_name}'")

        if not filtered_results:
            debrid_logger.debug("[AllDebrid] No available hosts")
            return []

        results = filtered_results

        for result in results:
            result["cache_status"] = "cached"

        deduplicate_results = config.get("deduplicate_results", False)

        if deduplicate_results:
            groups = self.group_identical_links(results)
            cached_results = []
            for group_key, group_links in groups.items():
                cached_results.append(group_links[0])
        else:
            cached_results = self.deduplicate_by_exact_link(results)

        cached_results.sort(key=quality_sort_key)

        elapsed = time.time() - start_time
        cache_logger.debug(f"[AllDebrid] Done in {elapsed:.1f}s: {len(cached_results)} results (all marked cached)")

        return cached_results

    async def convert_link(self, link: str, api_key: str, season: Optional[str] = None, episode: Optional[str] = None, hoster: Optional[str] = None) -> Optional[str]:
        if not api_key:
            debrid_logger.error("[AllDebrid] Empty API key")
            return None

        debrid_logger.debug("[AllDebrid] Converting link")

        is_direct_link = self._is_direct_hoster_link(link)
        http_error_count = 0

        for attempt in range(settings.DEBRID_MAX_RETRIES):
            try:
                if is_direct_link:
                    response1 = await http_client.get(
                        f"{settings.ALLDEBRID_API_URL}/link/unlock",
                        params={"agent": settings.ADDON_NAME, "apikey": api_key, "link": link}
                    )
                else:
                    response1 = await http_client.get(
                        f"{settings.ALLDEBRID_API_URL}/link/redirector",
                        params={"agent": settings.ADDON_NAME, "apikey": api_key, "link": link}
                    )

                should_retry, http_error_count = await self._handle_http_retry_error(
                    response1, http_error_count, "AllDebrid",
                    settings.DEBRID_HTTP_ERROR_RETRY_DELAY, settings.DEBRID_HTTP_ERROR_MAX_RETRIES
                )
                if should_retry:
                    continue
                elif response1.status_code in HTTP_RETRY_ERRORS:
                    debrid_logger.error(f"[AllDebrid] Max HTTP retries ({settings.DEBRID_HTTP_ERROR_MAX_RETRIES})")
                    return "RETRY_ERROR"

                http_error_count = 0

                if response1.status_code != 200:
                    debrid_logger.error(f"[AllDebrid] Redirector HTTP {response1.status_code}")
                    if attempt >= settings.DEBRID_MAX_RETRIES - 1:
                        return "FATAL_ERROR"
                    await sleep(settings.DEBRID_RETRY_DELAY)
                    continue

                data1 = response1.json()
                if data1.get("status") != "success":
                    error = data1.get("error", {})
                    error_code = error.get("code")

                    if error_code == "LINK_DOWN":
                        debrid_logger.debug(f"[AllDebrid] {error_code}")
                        return (
                            "LINK_DOWN"
                            if is_direct_link
                            else "LINK_SERVICE_DOWN"
                        )

                    if error_code in UNSUPPORTED_LINK_ERRORS:
                        debrid_logger.debug(f"[AllDebrid] {error_code} - link is password-protected")
                        return "LINK_UNSUPPORTED"

                    if error_code == "NO_SERVER":
                        debrid_logger.warning("[AllDebrid] NO_SERVER - server blocked by AllDebrid (VPN/datacenter detected)")
                        return "FATAL_ERROR"

                    if error_code in RETRY_ERRORS:
                        if error_code == "LINK_HOST_UNAVAILABLE":
                            hoster_name = hoster if hoster else urlparse(link).netloc.replace("www.", "")
                            mark_hoster_down("alldebrid", hoster_name)
                        debrid_logger.error(f"[AllDebrid] {error_code}")
                        if attempt >= settings.DEBRID_MAX_RETRIES - 1:
                            return "RETRY_ERROR"
                        await sleep(settings.DEBRID_RETRY_DELAY)
                        continue

                    debrid_logger.error(f"[AllDebrid] Fatal: {error_code}")
                    return "FATAL_ERROR"

                if is_direct_link:
                    if "delayed" in data1.get("data", {}):
                        debrid_logger.debug("[AllDebrid] Delayed - uncached")
                        return "LINK_UNCACHED"

                    direct_link = data1.get("data", {}).get("link")
                    if direct_link:
                        debrid_logger.debug("[AllDebrid] Converted")
                        return direct_link
                    else:
                        debrid_logger.error("[AllDebrid] No direct link")
                        await sleep(settings.DEBRID_RETRY_DELAY)
                        continue

                redirected_links = data1.get("data", {}).get("links", [])
                if not isinstance(redirected_links, list) or not redirected_links:
                    debrid_logger.error("[AllDebrid] No redirected links")
                    await sleep(settings.DEBRID_RETRY_DELAY)
                    continue

                selected_link = await self._select_redirected_link(
                    redirected_links,
                    api_key,
                    hoster,
                )
                if not selected_link:
                    debrid_logger.error("[AllDebrid] No usable redirected link")
                    return "LINK_UNSUPPORTED"
                response2 = await http_client.get(
                    f"{settings.ALLDEBRID_API_URL}/link/unlock",
                    params={
                        "agent": settings.ADDON_NAME,
                        "apikey": api_key,
                        "link": selected_link,
                    },
                )

                should_retry, http_error_count = await self._handle_http_retry_error(
                    response2, http_error_count, "AllDebrid",
                    settings.DEBRID_HTTP_ERROR_RETRY_DELAY, settings.DEBRID_HTTP_ERROR_MAX_RETRIES
                )
                if should_retry:
                    continue
                elif response2.status_code in HTTP_RETRY_ERRORS:
                    debrid_logger.error(f"[AllDebrid] Max HTTP retries ({settings.DEBRID_HTTP_ERROR_MAX_RETRIES})")
                    return "RETRY_ERROR"

                http_error_count = 0

                if response2.status_code != 200:
                    debrid_logger.error(f"[AllDebrid] Unlock HTTP {response2.status_code}")
                    if attempt >= settings.DEBRID_MAX_RETRIES - 1:
                        return "FATAL_ERROR"
                    await sleep(settings.DEBRID_RETRY_DELAY)
                    continue

                data2 = response2.json()
                if data2.get("status") != "success":
                    error = data2.get("error", {})
                    error_code2 = error.get("code")

                    if error_code2 == "LINK_DOWN":
                        debrid_logger.debug(f"[AllDebrid] {error_code2}")
                        return "LINK_SERVICE_DOWN"

                    if error_code2 in UNSUPPORTED_LINK_ERRORS:
                        debrid_logger.debug(f"[AllDebrid] {error_code2} - link is password-protected")
                        return "LINK_UNSUPPORTED"

                    if error_code2 == "NO_SERVER":
                        debrid_logger.warning("[AllDebrid] NO_SERVER - server blocked by AllDebrid (VPN/datacenter detected)")
                        return "FATAL_ERROR"

                    if error_code2 in RETRY_ERRORS:
                        if error_code2 == "LINK_HOST_UNAVAILABLE":
                            hoster_name = hoster if hoster else urlparse(link).netloc.replace("www.", "")
                            mark_hoster_down("alldebrid", hoster_name)
                        debrid_logger.error(f"[AllDebrid] {error_code2}")
                        if attempt >= settings.DEBRID_MAX_RETRIES - 1:
                            return "RETRY_ERROR"
                        await sleep(settings.DEBRID_RETRY_DELAY)
                        continue

                    debrid_logger.error(f"[AllDebrid] Fatal: {error_code2}")
                    return "FATAL_ERROR"

                if "delayed" in data2.get("data", {}):
                    debrid_logger.debug("[AllDebrid] Delayed - uncached")
                    return "LINK_UNCACHED"

                direct_link = data2.get("data", {}).get("link")
                if direct_link:
                    debrid_logger.debug("[AllDebrid] Converted")
                    return direct_link

            except Exception as e:
                debrid_logger.error(f"[AllDebrid] Attempt {attempt + 1} failed: {type(e).__name__}: {e}")
                if attempt < settings.DEBRID_MAX_RETRIES - 1:
                    await sleep(settings.DEBRID_RETRY_DELAY)

        debrid_logger.error(f"[AllDebrid] Failed after {settings.DEBRID_MAX_RETRIES} attempts")
        return "FATAL_ERROR"


# ===========================
# Singleton Instance
# ===========================
alldebrid_service = AllDebridService()

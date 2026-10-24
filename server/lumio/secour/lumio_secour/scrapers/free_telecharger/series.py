from typing import List, Dict, Optional
from lumio_secour.scrapers.free_telecharger.base import BaseFreeTelecharger
from lumio_secour.utils.logger import scraper_logger


# ===========================
# Series Scraper Class
# ===========================
class SeriesScraper(BaseFreeTelecharger):

    async def search(self, title: str, year: Optional[str] = None, metadata: Optional[Dict] = None) -> List[Dict]:
        scraper_logger.debug(f"[Free-Telecharger] Searching series: '{title}' ({year})")
        results = await self.search_content(title, year, metadata, "series")
        return results


# ===========================
# Singleton Instance
# ===========================
series_scraper = SeriesScraper()

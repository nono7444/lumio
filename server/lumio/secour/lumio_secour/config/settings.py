from typing import Optional, List, Dict, Any
from pydantic import AliasChoices, Field, computed_field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        validate_assignment=True
    )

    # ===========================
    # Addon Customization
    # ===========================
    ADDON_ID: str = "community.lumio-secour"
    ADDON_NAME: str = "Lumio Secour"

    # ===========================
    # Server Configuration
    # ===========================
    PORT: int = 7000

    # ===========================
    # Source Configuration
    # ===========================
    WAWACITY_URL: Optional[str] = None
    FREE_TELECHARGER_URL: Optional[str] = None
    DARKI_API_URL: Optional[str] = None
    DARKI_API_KEY: Optional[str] = None
    MOVIX_URL: Optional[str] = None
    WEBSHARE_URL: Optional[str] = None
    ZONE_TELECHARGEMENT_URL: Optional[str] = None
    DARKIMOVIX_KITSU_TMDB_MAPPING: List[str] = []
    KITSU_IMDB_OVERRIDE: List[str] = []

    # ===========================
    # Pagination Configuration
    # ===========================
    WAWACITY_MAX_SEARCH_PAGES: int = 3
    FREE_TELECHARGER_MAX_SEARCH_PAGES: int = 3
    WEBSHARE_MAX_SEARCH_PAGES: int = 3
    ZONE_TELECHARGEMENT_MAX_SEARCH_PAGES: int = 3
    ZONE_TELECHARGEMENT_MAX_CONCURRENCY: int = 16
    DARKI_API_MAX_LINK_PAGES: int = 5
    DARKIBOX_LINK_TIMEOUT: int = 2

    # ===========================
    # Database Configuration
    # ===========================
    DATABASE_VERSION: str = "1.0"
    DATABASE_TYPE: str = "sqlite"
    DATABASE_PATH: str = "/app/data/lumio_secour.db"
    DATABASE_URL: str = ""
    DATABASE_BUSY_TIMEOUT: int = Field(
        default=30,
        validation_alias=AliasChoices(
            "DATABASE_BUSY_TIMEOUT",
            "DATABASE_BUSY_TIMEOUT_SECONDS",
        ),
    )
    DATABASE_RETRY_MAX_ATTEMPTS: int = 8
    DATABASE_RETRY_DELAY: float = Field(
        default=0.25,
        validation_alias=AliasChoices(
            "DATABASE_RETRY_DELAY",
            "DATABASE_RETRY_DELAY_SECONDS",
        ),
    )

    # ===========================
    # Cache Configuration
    # ===========================
    CONTENT_CACHE_TTL: int = 3600
    CONTENT_CACHE_MODE: str = "background"
    DEAD_LINK_TTL: int = -1
    HOSTER_STATUS_CACHE_TTL: int = 3600
    HOSTER_STATUS_RECHECK_THRESHOLD: int = 3

    # ===========================
    # Lock Configuration
    # ===========================
    SCRAPE_LOCK_TTL: int = 300
    SCRAPE_WAIT_TIMEOUT: int = 30

    # ===========================
    # HTTP Timeout Configuration
    # ===========================
    HTTP_TIMEOUT: int = 15
    METADATA_TIMEOUT: int = 10
    HEALTH_CHECK_TIMEOUT: int = 5

    # ===========================
    # Debrid Services Configuration
    # ===========================
    DEBRID_SERVICES: List[str] = ["alldebrid", "torbox", "premiumize", "1fichier", "nzbdav"]
    DEBRID_MAX_RETRIES: int = 5
    DEBRID_RETRY_DELAY: int = Field(
        default=4,
        validation_alias=AliasChoices(
            "DEBRID_RETRY_DELAY",
            "DEBRID_RETRY_DELAY_SECONDS",
        ),
    )
    STREAM_REQUEST_TIMEOUT: int = 20
    DEBRID_CACHE_CHECK_HTTP_TIMEOUT: int = 3
    DEBRID_HTTP_ERROR_MAX_RETRIES: int = 5
    DEBRID_HTTP_ERROR_RETRY_DELAY: int = 1

    # ===========================
    # AllDebrid Configuration
    # ===========================
    ALLDEBRID_API_URL: str = "https://api.alldebrid.com/v4"
    ALLDEBRID_SUPPORTED_HOSTS: List[str] = ["1fichier", "turbobit", "rapidgator", "vidoza", "alldebrid"]
    ALLDEBRID_SUPPORTED_SOURCES: List[str] = ["wawacity", "free-telecharger", "darki-api", "wasource", "movix", "zone-telechargement"]

    # ===========================
    # TorBox Configuration
    # ===========================
    TORBOX_API_URL: str = "https://api.torbox.app/v1/api"
    TORBOX_SUPPORTED_HOSTS: List[str] = ["1fichier", "turbobit", "rapidgator", "sendcm", "send.now", "darkibox", "webshare"]
    TORBOX_SUPPORTED_SOURCES: List[str] = ["darki-api", "free-telecharger", "wasource", "movix", "webshare", "zone-telechargement"]

    # ===========================
    # Premiumize Configuration
    # ===========================
    PREMIUMIZE_API_URL: str = "https://www.premiumize.me/api"
    PREMIUMIZE_SUPPORTED_HOSTS: List[str] = ["1fichier", "turbobit", "rapidgator"]
    PREMIUMIZE_SUPPORTED_SOURCES: List[str] = ["darki-api", "free-telecharger", "wasource", "movix", "zone-telechargement"]

    # ===========================
    # 1fichier Configuration
    # ===========================
    ONEFICHIER_API_URL: str = "https://api.1fichier.com/v1"
    ONEFICHIER_SUPPORTED_HOSTS: List[str] = ["1fichier"]
    ONEFICHIER_SUPPORTED_SOURCES: List[str] = ["darki-api", "free-telecharger", "wasource", "movix", "zone-telechargement"]

    # ===========================
    # NZBDav Configuration
    # ===========================
    NZBDAV_SUPPORTED_SOURCES: List[str] = ["darki-api"]

    # ===========================
    # WASource Configuration
    # ===========================
    WASOURCE_SUPPORTED_HOSTS: List[str] = ["1fichier", "turbobit", "rapidgator", "sendcm", "darkibox", "alldebrid"]

    # ===========================
    # Resilient Playback Configuration
    # ===========================
    RESILIENT_MAX_FALLBACKS: int = 10
    RESILIENT_MAX_CONCURRENCY: int = 4
    RESILIENT_ATTEMPT_TIMEOUT_MAX: int = 60
    RESILIENT_TOKEN_MAX_BYTES: int = 3500

    # ===========================
    # Pastebin Scraper Configuration
    # ===========================
    PASTEBIN_SCRAPER_URLS: List[str] = []
    PASTEBIN_SCRAPER_INTERVAL: int = 86400
    PASTEBIN_SCRAPER_MAX_DEPTH: int = 5
    PASTEBIN_SCRAPER_MAX_PAGES: int = 1000

    # ===========================
    # Idrix Scraper Configuration
    # ===========================
    IDRIX_SCRAPER_URLS: List[str] = []
    IDRIX_SCRAPER_INTERVAL: int = 86400
    IDRIX_SCRAPER_MAX_DEPTH: int = 5
    IDRIX_SCRAPER_MAX_PAGES: int = 1000
    IDRIX_SCRAPER_RETRY_MAX_ATTEMPTS: int = 3
    IDRIX_SCRAPER_RETRY_DELAY: int = Field(
        default=2,
        validation_alias=AliasChoices(
            "IDRIX_SCRAPER_RETRY_DELAY",
            "IDRIX_SCRAPER_RETRY_DELAY_SECONDS",
        ),
    )
    IDRIX_SCRAPER_REQUEST_DELAY: float = Field(
        default=1.5,
        validation_alias=AliasChoices(
            "IDRIX_SCRAPER_REQUEST_DELAY",
            "IDRIX_SCRAPER_REQUEST_DELAY_SECONDS",
        ),
    )
    IDRIX_SCRAPER_MAX_RETRY_DELAY: float = Field(
        default=30.0,
        validation_alias=AliasChoices(
            "IDRIX_SCRAPER_MAX_RETRY_DELAY",
            "IDRIX_SCRAPER_MAX_RETRY_DELAY_SECONDS",
        ),
    )

    # ===========================
    # TMDB Configuration
    # ===========================
    TMDB_API_URL: str = "https://api.themoviedb.org/3"
    TMDB_API_KEY: Optional[str] = None

    # ===========================
    # Lumio Secour (API privée pour le serveur Lumio)
    # ===========================
    LUMIO_API_KEY: Optional[str] = None  # clé partagée avec le serveur Lumio (en-tête X-Lumio-Key)

    # ===========================
    # Kitsu Configuration
    # ===========================
    KITSU_API_URL: str = "https://kitsu.io/api/edge"
    KITSU_ALIAS_URL: str = "https://find-my-anime.dtimur.de/api"

    # ===========================
    # Proxy Configuration
    # ===========================
    PROXY_URL: Optional[str] = None

    # ===========================
    # Security Configuration
    # ===========================
    SECRET_KEY: str = ""
    ADDON_PASSWORD: str = ""

    # ===========================
    # Admin Configuration
    # ===========================
    ADMIN_PASSWORD: str = ""

    @field_validator("SECRET_KEY", mode="after")
    @classmethod
    def validate_secret_key(cls, v):
        if not v or len(v) < 32:
            raise ValueError("SECRET_KEY is required and must be at least 32 characters. Generate one with: openssl rand -hex 32")
        return v

    # ===========================
    # Logging Configuration
    # ===========================
    LOG_LEVEL: str = "DEBUG"

    # ===========================
    # Interface Customization
    # ===========================
    CUSTOM_HTML: str = ""

    # ===========================
    # HTTP Cache Configuration
    # ===========================
    HTTP_CACHE_ENABLED: bool = False
    HTTP_CACHE_STREAMS_TTL: int = 300
    HTTP_CACHE_MANIFEST_TTL: int = 86400
    HTTP_CACHE_CONFIGURE_TTL: int = 86400
    HTTP_CACHE_STALE_WHILE_REVALIDATE: int = 60

    # ===========================
    # Internal Configuration
    # ===========================
    CLEANUP_INTERVAL: int = 60

    # ===========================
    # Health Check Configuration
    # ===========================
    PUBLIC_HEALTH_PAGE_ENABLED: bool = False
    HEALTH_CHECK_INTERVAL: int = 60
    HEALTH_STATUS_HISTORY_RETENTION: int = 2592000
    LEGACY_HEALTH_STATUS_HISTORY_RETENTION: Optional[int] = Field(
        default=None,
        validation_alias="HEALTH_STATUS_HISTORY_RETENTION_DAYS",
        exclude=True,
        repr=False,
    )

    # ===========================
    # Domain Synchronization
    # ===========================
    DOMAIN_SYNC_ENABLED: bool = False
    DOMAIN_SYNC_INTERVAL: int = 7200
    DOMAIN_SYNC_RECHECK_ON_HEALTH_ERROR: bool = True
    DOMAIN_SYNC_HEALTH_ERROR_RECHECK_DELAY: int = Field(
        default=900,
        validation_alias=AliasChoices(
            "DOMAIN_SYNC_HEALTH_ERROR_RECHECK_DELAY",
            "DOMAIN_SYNC_HEALTH_ERROR_RECHECK_DELAY_SECONDS",
        ),
    )
    DOMAIN_SYNC_WAWACITY_TELEGRAM_URL: Optional[str] = None
    DOMAIN_SYNC_FREE_TELECHARGER_TELEGRAM_URL: Optional[str] = None
    DOMAIN_SYNC_MOVIX_TELEGRAM_URL: Optional[str] = None
    DOMAIN_SYNC_ZONE_TELECHARGEMENT_TELEGRAM_URL: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices(
            "DOMAIN_SYNC_ZONE_TELECHARGEMENT_TELEGRAM_URL",
            "DOMAIN_SYNC_ZT_TELEGRAM_URL",
        ),
    )

    # ===========================
    # Field Validators
    # ===========================
    @model_validator(mode="before")
    @classmethod
    def migrate_health_history_retention(cls, values):
        if (
            isinstance(values, dict)
            and "HEALTH_STATUS_HISTORY_RETENTION" not in values
            and "HEALTH_STATUS_HISTORY_RETENTION_DAYS" in values
        ):
            migrated = values.copy()
            migrated["HEALTH_STATUS_HISTORY_RETENTION"] = (
                int(values["HEALTH_STATUS_HISTORY_RETENTION_DAYS"]) * 86400
            )
            return migrated
        return values

    @field_validator(
        "WAWACITY_URL", "FREE_TELECHARGER_URL", "DARKI_API_URL", "MOVIX_URL",
        "WEBSHARE_URL", "ZONE_TELECHARGEMENT_URL", "PROXY_URL",
        "DOMAIN_SYNC_WAWACITY_TELEGRAM_URL", "DOMAIN_SYNC_FREE_TELECHARGER_TELEGRAM_URL",
        "DOMAIN_SYNC_MOVIX_TELEGRAM_URL", "DOMAIN_SYNC_ZONE_TELECHARGEMENT_TELEGRAM_URL"
    )
    @classmethod
    def normalize_urls(cls, v):
        if isinstance(v, str):
            return v.rstrip("/")
        return v

    @field_validator("LOG_LEVEL")
    @classmethod
    def normalize_log_level(cls, v):
        if isinstance(v, str):
            return v.upper()
        return v

    # ===========================
    # Computed Properties
    # ===========================
    @computed_field
    @property
    def MOVIX_API_URL(self) -> Optional[str]:
        if not self.MOVIX_URL:
            return None
        from urllib.parse import urlparse
        parsed = urlparse(self.MOVIX_URL)
        hostname = (parsed.hostname or "").removeprefix("www.")
        if not parsed.scheme or not hostname:
            return None
        netloc = f"api.{hostname}"
        if parsed.port is not None:
            netloc += f":{parsed.port}"
        return f"{parsed.scheme}://{netloc}"

    @computed_field
    @property
    def ADDON_MANIFEST(self) -> Dict[str, Any]:
        return {
            "id": self.ADDON_ID,
            "name": self.ADDON_NAME,
            "version": "3.9.1-lumio.1",
            "description": "Lumio Secour : liens de secours pour le serveur Lumio",
            "catalogs": [],
            "resources": ["stream"],
            "types": ["movie", "series", "anime"],
            "idPrefixes": ["tt", "kitsu"],
            "behaviorHints": {
                "configurable": True
            },
            "logo": "https://gitlab.com/10ho/wastream/-/raw/main/wastream/public/wastream-logo.jpg",
            "background": "https://gitlab.com/10ho/wastream/-/raw/main/wastream/public/wastream-background.png"
        }

    def get_database_url(self) -> str:
        if self.DATABASE_TYPE == "sqlite":
            return f"sqlite:///{self.DATABASE_PATH}"
        return f"postgresql://{self.DATABASE_URL}"


# ===========================
# Settings Instance
# ===========================
settings = Settings()


# ===========================
# Constants
# ===========================
DEBRID_ABBREVIATIONS = {
    "alldebrid": "AD",
    "torbox": "TB",
    "premiumize": "PM",
    "1fichier": "1F",
    "nzbdav": "ND"
}

SOURCE_DISPLAY_NAMES = {
    "wawacity": "Wawacity",
    "free-telecharger": "Free-Telecharger",
    "darki-api": "Darki-API",
    "wasource": "WASource",
    "movix": "Movix",
    "webshare": "Webshare",
    "zone-telechargement": "Zone-Telechargement"
}

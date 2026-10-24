import json
import re
import unicodedata
from base64 import b64encode, b64decode, urlsafe_b64encode, urlsafe_b64decode
from typing import Optional, Dict, Any
from urllib.parse import quote, quote_plus, urlparse, parse_qs, unquote

from lumio_secour.utils.urls import canonicalize_url


# ===========================
# Text Normalization
# ===========================
def normalize_text(text: str) -> str:
    if not text:
        return ""

    text = text.lower()
    text = "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")
    text = "".join(c if c.isalnum() or c.isspace() else " " for c in text)
    text = " ".join(text.split())

    return text.strip()


# ===========================
# Configuration Encoding
# ===========================
def encode_config_to_base64(config: Dict[str, Any]) -> str:
    return b64encode(json.dumps(config).encode()).decode()


def encode_playback_token(data: Dict[str, Any]) -> str:
    return urlsafe_b64encode(json.dumps(data, separators=(",", ":")).encode()).decode().rstrip("=")


def decode_playback_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        padding = 4 - len(token) % 4
        if padding != 4:
            token += "=" * padding
        return json.loads(urlsafe_b64decode(token).decode())
    except Exception:
        return None


# ===========================
# Cache Key Builder
# ===========================
def build_cache_key(cache_type: str, title: str, year: Optional[str] = None) -> str:
    cache_key = f"{cache_type}:{quote_plus(title.lower())}"
    if year:
        cache_key += f":{year}"
    return cache_key


# ===========================
# URL Formatting
# ===========================
def format_url(url: str, base_url: str) -> str:
    if not url:
        return ""

    if url.startswith("http://") or url.startswith("https://"):
        return url

    if url.startswith("/"):
        return f"{base_url}{url}"

    return f"{base_url}/{url}"


# ===========================
# URL Parameter Encoding
# ===========================
def quote_url_param(param: str) -> str:
    return quote_plus(param)


def quote_path_segment(param: str) -> str:
    return quote(param, safe="")


# ===========================
# Filename Extraction and Decoding
# ===========================
def extract_and_decode_filename(url: str) -> Optional[str]:
    try:
        parsed_url = urlparse(url)
        query_params = parse_qs(parsed_url.query)
        filename_encoded = query_params.get('fn', [None])[0]

        if filename_encoded:
            filename_unquoted = unquote(filename_encoded)
            decoded_filename = b64decode(filename_unquoted).decode('utf-8')
            return decoded_filename
    except Exception:
        pass
    return None


# ===========================
# Size Normalization
# ===========================
def normalize_size(raw_size: str) -> str:
    if not raw_size:
        return "Unknown"

    normalized = str(raw_size).strip()

    if normalized.upper() in ["N/A", "NULL", "UNKNOWN", "INCONNU", ""]:
        return "Unknown"

    normalized_upper = normalized.upper()
    normalized_upper = normalized_upper.replace(",", ".")
    normalized_upper = normalized_upper.replace(" GO", " GB")
    normalized_upper = normalized_upper.replace(" MO", " MB")
    normalized_upper = normalized_upper.replace(" KO", " KB")

    return normalized_upper


# ===========================
# Size Parsing to GB
# ===========================
def parse_size_to_gb(size_str: str) -> Optional[float]:
    if not size_str or size_str == "Unknown":
        return None

    size_upper = size_str.upper().strip()

    match = re.match(r"([\d.]+)\s*(GB|MB|KB)", size_upper)
    if not match:
        return None

    try:
        value = float(match.group(1))
        unit = match.group(2)

        if unit == "GB":
            return value
        elif unit == "MB":
            return value / 1024.0
        elif unit == "KB":
            return value / (1024.0 * 1024.0)
        else:
            return None

    except (ValueError, AttributeError):
        return None


# ===========================
# Size Parsing
# ===========================
def parse_size_to_bytes(size_str: str) -> int:
    if not size_str or size_str == "Unknown":
        return 0
    try:
        parts = size_str.strip().split()
        if len(parts) != 2:
            return 0
        value = float(parts[0])
        unit = parts[1].upper()
        if unit == "GB":
            return int(value * 1024 * 1024 * 1024)
        elif unit == "MB":
            return int(value * 1024 * 1024)
        elif unit == "KB":
            return int(value * 1024)
        return 0
    except (ValueError, IndexError):
        return 0


# ===========================
# Results Deduplication and Sorting
# ===========================
def deduplicate_and_sort_results(results: list, quality_sort_key_func) -> list:
    seen_links = set()
    deduplicated = []

    for result in results:
        link_key = canonicalize_url(result.get("link", ""))
        if link_key:
            result["link"] = link_key
        if link_key and link_key not in seen_links:
            seen_links.add(link_key)
            deduplicated.append(result)

    deduplicated.sort(key=quality_sort_key_func)
    return deduplicated


# ===========================
# Display Name Builder
# ===========================
def _clean_display_name(text: str) -> str:
    cleaned = re.sub(r'[^\w]+', '.', text)
    cleaned = cleaned.replace('_', '.')
    cleaned = re.sub(r'\.{2,}', '.', cleaned)
    return cleaned.strip('.')


def build_display_name(title: str, year: Optional[str] = None, language: str = "Unknown",
                       quality: str = "Unknown", season: Optional[str] = None,
                       episode: Optional[str] = None, raw_language: Optional[str] = None) -> str:
    display_name = _clean_display_name(title)

    if year and str(year) not in title:
        display_name += f".{year}"

    if season:
        if episode:
            season_padded = str(season).zfill(2)
            episode_padded = str(episode).zfill(2)
            display_name += f".S{season_padded}E{episode_padded}"
        else:
            season_padded = str(season).zfill(2)
            display_name += f".S{season_padded}"

    lang_for_display = raw_language if raw_language and raw_language != "Unknown" else language
    if lang_for_display and lang_for_display != "Unknown":
        if lang_for_display.startswith("Multi (") and lang_for_display.endswith(")"):
            langs_str = lang_for_display[7:-1]
            langs = [lang.strip() for lang in langs_str.split(",")]
            display_name += ".MULTi." + ".".join(langs)
        else:
            display_name += f".{_clean_display_name(lang_for_display)}"

    if quality and quality != "Unknown":
        display_name += f".{_clean_display_name(quality)}"

    return display_name


# ===========================
# Debrid Service Entry Retrieval
# ===========================
def get_debrid_service_entry(
    config: Dict[str, Any],
    service_name: str,
    service_index: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    debrid_services = config.get("debrid_services", [])
    normalized_service = (service_name or "").lower()

    if (
        isinstance(service_index, int)
        and not isinstance(service_index, bool)
        and 0 <= service_index < len(debrid_services)
    ):
        entry = debrid_services[service_index]
        if str(entry.get("service") or "").lower() == normalized_service:
            return entry

    for entry in debrid_services:
        if str(entry.get("service") or "").lower() == normalized_service:
            return entry
    return None


def get_debrid_api_key(
    config: Dict[str, Any],
    service_name: str,
    service_index: Optional[int] = None,
) -> str:
    entry = get_debrid_service_entry(config, service_name, service_index)
    return entry.get("api_key", "") if entry else ""


# ===========================
# Debrid Services Retrieval
# ===========================
def get_debrid_services(config: Dict[str, Any]) -> list:
    return config.get("debrid_services", [])


def should_enable_full_season(config: Dict[str, Any]) -> bool:
    debrid_services = config.get("debrid_services", [])
    for service_entry in debrid_services:
        service = service_entry.get("service", "")
        if service == "torbox":
            if service_entry.get("enable_nzb", False) and service_entry.get("enable_full_season", False):
                return True
        elif service == "nzbdav":
            if service_entry.get("enable_full_season", False):
                return True
    return False

from __future__ import annotations

import json
import os
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


ENTSOE_API_URL = "https://web-api.tp.entsoe.eu/api"
ECB_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
ENTSOE_PERIOD_FORMAT = "%Y%m%d%H%M"
OUTPUT_DIR = Path("data/spotprice")
USER_AGENT = "spotprice-fetcher/1.0 (+github-actions)"


@dataclass(frozen=True)
class AreaConfig:
    code: str
    eic_code: str


@dataclass(frozen=True)
class CountryConfig:
    slug: str
    country_code: str
    display_name: str
    timezone_name: str
    currency: str
    areas: tuple[AreaConfig, ...]


# Mirrored from Spotprice-Android RegionConfig country/area EIC mappings.
COUNTRIES: tuple[CountryConfig, ...] = (
    CountryConfig(
        slug="latvia",
        country_code="LV",
        display_name="Latvia",
        timezone_name="Europe/Riga",
        currency="EUR",
        areas=(AreaConfig(code="LV", eic_code="10YLV-1001A00074"),),
    ),
    CountryConfig(
        slug="lithuania",
        country_code="LT",
        display_name="Lithuania",
        timezone_name="Europe/Vilnius",
        currency="EUR",
        areas=(AreaConfig(code="LT", eic_code="10YLT-1001A0008Q"),),
    ),
    CountryConfig(
        slug="germany",
        country_code="DE",
        display_name="Germany",
        timezone_name="Europe/Berlin",
        currency="EUR",
        areas=(AreaConfig(code="DE-LU", eic_code="10Y1001A1001A82H"),),
    ),
    CountryConfig(
        slug="luxembourg",
        country_code="LU",
        display_name="Luxembourg",
        timezone_name="Europe/Luxembourg",
        currency="EUR",
        areas=(AreaConfig(code="LU", eic_code="10Y1001A1001A82H"),),
    ),
    CountryConfig(
        slug="estonia",
        country_code="EE",
        display_name="Estonia",
        timezone_name="Europe/Tallinn",
        currency="EUR",
        areas=(AreaConfig(code="EE", eic_code="10Y1001A1001A39I"),),
    ),
    CountryConfig(
        slug="poland",
        country_code="PL",
        display_name="Poland",
        timezone_name="Europe/Warsaw",
        currency="PLN",
        areas=(AreaConfig(code="PL", eic_code="10YPL-AREA-----S"),),
    ),
    CountryConfig(
        slug="serbia",
        country_code="RS",
        display_name="Serbia",
        timezone_name="Europe/Belgrade",
        currency="RSD",
        areas=(AreaConfig(code="RS", eic_code="10YCS-SERBIATSOV"),),
    ),
    CountryConfig(
        slug="bulgaria",
        country_code="BG",
        display_name="Bulgaria",
        timezone_name="Europe/Sofia",
        currency="BGN",
        areas=(AreaConfig(code="BG", eic_code="10YCA-BULGARIA-R"),),
    ),
    CountryConfig(
        slug="romania",
        country_code="RO",
        display_name="Romania",
        timezone_name="Europe/Bucharest",
        currency="RON",
        areas=(AreaConfig(code="RO", eic_code="10YRO-TEL------P"),),
    ),
    CountryConfig(
        slug="slovakia",
        country_code="SK",
        display_name="Slovakia",
        timezone_name="Europe/Bratislava",
        currency="EUR",
        areas=(AreaConfig(code="SK", eic_code="10YSK-SEPS-----K"),),
    ),
    CountryConfig(
        slug="hungary",
        country_code="HU",
        display_name="Hungary",
        timezone_name="Europe/Budapest",
        currency="HUF",
        areas=(AreaConfig(code="HU", eic_code="10YHU-MAVIR----U"),),
    ),
    CountryConfig(
        slug="croatia",
        country_code="HR",
        display_name="Croatia",
        timezone_name="Europe/Zagreb",
        currency="EUR",
        areas=(AreaConfig(code="HR", eic_code="10YHR-HEP------M"),),
    ),
    CountryConfig(
        slug="slovenia",
        country_code="SI",
        display_name="Slovenia",
        timezone_name="Europe/Ljubljana",
        currency="EUR",
        areas=(AreaConfig(code="SI", eic_code="10YSI-ELES-----O"),),
    ),
    CountryConfig(
        slug="greece",
        country_code="GR",
        display_name="Greece",
        timezone_name="Europe/Athens",
        currency="EUR",
        areas=(AreaConfig(code="GR", eic_code="10YGR-HTSO-----Y"),),
    ),
    CountryConfig(
        slug="austria",
        country_code="AT",
        display_name="Austria",
        timezone_name="Europe/Vienna",
        currency="EUR",
        areas=(AreaConfig(code="AT", eic_code="10YAT-APG------L"),),
    ),
    CountryConfig(
        slug="czech-republic",
        country_code="CZ",
        display_name="Czech Republic",
        timezone_name="Europe/Prague",
        currency="CZK",
        areas=(AreaConfig(code="CZ", eic_code="10YCZ-CEPS-----N"),),
    ),
    CountryConfig(
        slug="switzerland",
        country_code="CH",
        display_name="Switzerland",
        timezone_name="Europe/Zurich",
        currency="CHF",
        areas=(AreaConfig(code="CH", eic_code="10YCH-SWISSGRIDZ"),),
    ),
    CountryConfig(
        slug="italy",
        country_code="IT",
        display_name="Italy",
        timezone_name="Europe/Rome",
        currency="EUR",
        areas=(
            AreaConfig(code="IT-CNOR", eic_code="10Y1001A1001A70O"),
            AreaConfig(code="IT-CSUD", eic_code="10Y1001A1001A71M"),
            AreaConfig(code="IT-NORD", eic_code="10Y1001A1001A73I"),
            AreaConfig(code="IT-SARD", eic_code="10Y1001A1001A74G"),
            AreaConfig(code="IT-CAL", eic_code="10Y1001C--00096J"),
            AreaConfig(code="IT-SICI", eic_code="10Y1001A1001A75E"),
            AreaConfig(code="IT-SUD", eic_code="10Y1001A1001A788"),
        ),
    ),
    CountryConfig(
        slug="denmark",
        country_code="DK",
        display_name="Denmark",
        timezone_name="Europe/Copenhagen",
        currency="DKK",
        areas=(
            AreaConfig(code="DK1", eic_code="10YDK-1--------W"),
            AreaConfig(code="DK2", eic_code="10YDK-2--------M"),
        ),
    ),
    CountryConfig(
        slug="sweden",
        country_code="SE",
        display_name="Sweden",
        timezone_name="Europe/Stockholm",
        currency="SEK",
        areas=(
            AreaConfig(code="SE1", eic_code="10Y1001A1001A44P"),
            AreaConfig(code="SE2", eic_code="10Y1001A1001A45N"),
            AreaConfig(code="SE3", eic_code="10Y1001A1001A46L"),
            AreaConfig(code="SE4", eic_code="10Y1001A1001A47J"),
        ),
    ),
    CountryConfig(
        slug="netherlands",
        country_code="NL",
        display_name="Netherlands",
        timezone_name="Europe/Amsterdam",
        currency="EUR",
        areas=(AreaConfig(code="NL", eic_code="10YNL----------L"),),
    ),
    CountryConfig(
        slug="belgium",
        country_code="BE",
        display_name="Belgium",
        timezone_name="Europe/Brussels",
        currency="EUR",
        areas=(AreaConfig(code="BE", eic_code="10YBE----------2"),),
    ),
    CountryConfig(
        slug="portugal",
        country_code="PT",
        display_name="Portugal",
        timezone_name="Europe/Lisbon",
        currency="EUR",
        areas=(AreaConfig(code="PT", eic_code="10YPT-REN------W"),),
    ),
    CountryConfig(
        slug="spain",
        country_code="ES",
        display_name="Spain",
        timezone_name="Europe/Madrid",
        currency="EUR",
        areas=(AreaConfig(code="ES", eic_code="10YES-REE------0"),),
    ),
    CountryConfig(
        slug="finland",
        country_code="FI",
        display_name="Finland",
        timezone_name="Europe/Helsinki",
        currency="EUR",
        areas=(AreaConfig(code="FI", eic_code="10YFI-1--------U"),),
    ),
    CountryConfig(
        slug="norway",
        country_code="NO",
        display_name="Norway",
        timezone_name="Europe/Oslo",
        currency="NOK",
        areas=(
            AreaConfig(code="NO1", eic_code="10YNO-1--------2"),
            AreaConfig(code="NO2", eic_code="10YNO-2--------T"),
            AreaConfig(code="NO3", eic_code="10YNO-3--------J"),
            AreaConfig(code="NO4", eic_code="10YNO-4--------9"),
            AreaConfig(code="NO5", eic_code="10Y1001A1001A48H"),
        ),
    ),
    CountryConfig(
        slug="france",
        country_code="FR",
        display_name="France",
        timezone_name="Europe/Paris",
        currency="EUR",
        areas=(AreaConfig(code="FR", eic_code="10YFR-RTE------C"),),
    ),
)


def iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def xml_local_name(tag: str) -> str:
    return tag.split("}", 1)[-1]


def find_first_text(parent: ET.Element, local_name: str) -> str | None:
    for node in parent.iter():
        if xml_local_name(node.tag) == local_name and node.text:
            return node.text.strip()
    return None


def parse_duration(value: str) -> timedelta:
    match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?", value or "")
    if not match:
        raise ValueError(f"Unsupported ENTSOE resolution: {value}")
    return timedelta(hours=int(match.group(1) or 0), minutes=int(match.group(2) or 0))


def fetch_text(url: str, timeout: int) -> str:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8")


def fetch_exchange_rates() -> dict[str, float]:
    xml_text = fetch_text(url=ECB_RATES_URL, timeout=20)
    root = ET.fromstring(xml_text)

    rates: dict[str, float] = {"EUR": 1.0}
    for node in root.iter():
        currency = node.attrib.get("currency")
        rate = node.attrib.get("rate")
        if not currency or not rate:
            continue
        try:
            rates[currency.upper()] = float(rate)
        except ValueError:
            continue
    return rates


def convert_from_eur(amount_eur: float, target_currency: str, rates: dict[str, float]) -> float:
    normalized = target_currency.upper()
    if normalized == "EUR":
        return amount_eur
    rate = rates.get(normalized)
    if not rate or rate <= 0:
        return amount_eur
    return amount_eur * rate


def build_entsoe_url(api_key: str, eic_code: str, start_utc: datetime, end_utc: datetime) -> str:
    params = {
        "securityToken": api_key,
        "documentType": "A44",
        "processType": "A01",
        "in_Domain": eic_code,
        "out_Domain": eic_code,
        "periodStart": start_utc.strftime(ENTSOE_PERIOD_FORMAT),
        "periodEnd": end_utc.strftime(ENTSOE_PERIOD_FORMAT),
    }
    return f"{ENTSOE_API_URL}?{urlencode(params)}"


def parse_entsoe_prices(xml_text: str, zone: ZoneInfo, target_date: date) -> list[dict]:
    root = ET.fromstring(xml_text)
    prices: list[dict] = []

    for period in root.iter():
        if xml_local_name(period.tag) != "Period":
            continue

        start_str = find_first_text(period, "start")
        resolution_str = find_first_text(period, "resolution")
        if not start_str or not resolution_str:
            continue

        base_start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
        resolution = parse_duration(resolution_str)

        for point in period.iter():
            if xml_local_name(point.tag) != "Point":
                continue

            position_str = find_first_text(point, "position")
            price_str = find_first_text(point, "price.amount")
            if not position_str or not price_str:
                continue

            try:
                position = int(position_str)
                price_per_mwh_eur = float(price_str)
            except ValueError:
                continue

            period_start_utc = base_start + (max(position - 1, 0) * resolution)
            period_end_utc = period_start_utc + resolution
            period_start_local = period_start_utc.astimezone(zone)
            period_end_local = period_end_utc.astimezone(zone)

            if period_start_local.date() != target_date:
                continue

            prices.append(
                {
                    "start_utc": iso_z(period_start_utc),
                    "end_utc": iso_z(period_end_utc),
                    "start_local": period_start_local.isoformat(),
                    "end_local": period_end_local.isoformat(),
                    "price_per_mwh_eur": price_per_mwh_eur,
                    "price_per_kwh_eur": price_per_mwh_eur / 1000.0,
                }
            )

    prices.sort(key=lambda item: item["start_utc"])
    return prices


def parse_entsoe_error(xml_text: str) -> str | None:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None
    if xml_local_name(root.tag) != "Acknowledgement_MarketDocument":
        return None
    reason = find_first_text(root, "text") or "Unknown ENTSOE acknowledgement error."
    code = find_first_text(root, "code")
    return f"{code}: {reason}" if code else reason


def fetch_area_prices(
    api_key: str,
    area: AreaConfig,
    zone: ZoneInfo,
    target_date: date,
    start_utc: datetime,
    end_utc: datetime,
    currency: str,
    rates: dict[str, float],
) -> dict:
    url = build_entsoe_url(api_key=api_key, eic_code=area.eic_code, start_utc=start_utc, end_utc=end_utc)
    xml_text = fetch_text(url=url, timeout=30)

    prices_eur = parse_entsoe_prices(xml_text=xml_text, zone=zone, target_date=target_date)
    if not prices_eur:
        error = parse_entsoe_error(xml_text)
        if error:
            raise RuntimeError(error)
        raise RuntimeError("No ENTSOE price entries parsed.")

    prices_local = []
    for entry in prices_eur:
        prices_local.append(
            {
                **entry,
                "price_per_kwh": convert_from_eur(entry["price_per_kwh_eur"], target_currency=currency, rates=rates),
                "currency": currency,
            }
        )

    return {
        "area_code": area.code,
        "eic_code": area.eic_code,
        "prices": prices_local,
    }


def fetch_country_payload(country: CountryConfig, api_key: str, rates: dict[str, float]) -> dict:
    zone = ZoneInfo(country.timezone_name)
    target_date = datetime.now(zone).date()
    start_local = datetime.combine(target_date, time.min, zone)
    end_local = start_local + timedelta(days=1)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = end_local.astimezone(timezone.utc)

    rate = rates.get(country.currency.upper(), 1.0)
    area_results: list[dict] = []
    for area in country.areas:
        try:
            area_results.append(
                fetch_area_prices(
                    api_key=api_key,
                    area=area,
                    zone=zone,
                    target_date=target_date,
                    start_utc=start_utc,
                    end_utc=end_utc,
                    currency=country.currency,
                    rates=rates,
                )
            )
        except (HTTPError, URLError, RuntimeError, TimeoutError, ET.ParseError, ValueError) as exc:
            area_results.append(
                {
                    "area_code": area.code,
                    "eic_code": area.eic_code,
                    "prices": [],
                    "error": str(exc),
                }
            )

    successful_areas = [item for item in area_results if item.get("prices")]
    if not successful_areas:
        raise RuntimeError(f"No areas fetched successfully for {country.country_code}.")

    default_area_code = country.areas[0].code
    default_area = next((item for item in area_results if item["area_code"] == default_area_code), successful_areas[0])

    return {
        "country": country.slug,
        "country_code": country.country_code,
        "display_name": country.display_name,
        "timezone": country.timezone_name,
        "target_date_local": target_date.isoformat(),
        "fetched_at_utc": iso_z(datetime.now(timezone.utc)),
        "currency": country.currency,
        "exchange_rate": {
            "base": "EUR",
            "quote": country.currency,
            "rate": rate,
            "source": "ECB eurofxref-daily",
        },
        "default_area_code": default_area_code,
        # Backward-compatible top-level area/prices for single-area consumers.
        "area_code": default_area["area_code"],
        "eic_code": default_area["eic_code"],
        "prices": default_area["prices"],
        "areas": area_results,
    }


def write_payload(country_slug: str, payload: dict) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    destination = OUTPUT_DIR / f"{country_slug}.json"
    destination.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {destination}")


def main() -> None:
    api_key = os.environ.get("ENTSOE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ENTSOE_API_KEY is not set.")

    rates = fetch_exchange_rates()
    failures: list[str] = []

    for country in COUNTRIES:
        try:
            payload = fetch_country_payload(country=country, api_key=api_key, rates=rates)
            write_payload(country_slug=country.slug, payload=payload)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{country.country_code}: {exc}")

    if failures:
        raise RuntimeError("Failed countries: " + "; ".join(failures))


if __name__ == "__main__":
    main()

const elements = {
  regionButton: document.getElementById("detect-country-button"),
  countrySelect: document.getElementById("country-select"),
  areaSelect: document.getElementById("area-select"),
  areaField: document.getElementById("area-field"),
  selectionHint: document.getElementById("selection-hint"),
  priceLabel: document.getElementById("price-label"),
  countryName: document.getElementById("country-name"),
  priceValue: document.getElementById("price-value"),
  priceSubtitle: document.getElementById("price-subtitle"),
  statMin: document.getElementById("stat-min"),
  statMax: document.getElementById("stat-max"),
  chart: document.getElementById("chart"),
  futureList: document.getElementById("future-list"),
};

const STORAGE_KEY = "entsoe-selection";
const IP_LOOKUP_URL = "https://ipapi.co/json/";
const IP_LOOKUP_TIMEOUT_MS = 5000;
const DEVICE_LOCATION_TIMEOUT_MS = 8000;

const state = {
  countries: [],
  selectedSlug: "",
  selectedAreaCode: "",
  data: null,
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  elements.countrySelect.addEventListener("change", async (event) => {
    setSelectionHint("");
    await loadCountryData(event.target.value);
  });
  elements.areaSelect.addEventListener("change", () => {
    state.selectedAreaCode = elements.areaSelect.value;
    persistSelection();
    renderDashboard();
  });
  elements.regionButton.addEventListener("click", async () => {
    await detectRegionFromLocation();
  });

  try {
    state.countries = await fetchCountryList();
    renderCountryOptions(state.countries);

    if (!state.countries.length) {
      renderFatal("No country JSON files found in /data.");
      return;
    }

    const initialSelection = resolveInitialSelection(state.countries);
    elements.countrySelect.value = initialSelection.slug;
    await loadCountryData(initialSelection.slug, {
      preferredAreaCode: initialSelection.areaCode,
      useStoredArea: false,
    });
    void refineSelectionFromIp(getCurrentSelection());
  } catch (error) {
    console.error(error);
    renderFatal("Could not load country list.");
  }
}

async function fetchCountryList() {
  const response = await fetch("data/countries.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Country list failed (${response.status}).`);
  }
  const payload = await response.json();
  if (Array.isArray(payload)) {
    return payload;
  }
  return Array.isArray(payload.countries) ? payload.countries : [];
}

function renderCountryOptions(countries) {
  elements.countrySelect.innerHTML = "";
  for (const country of countries) {
    const option = document.createElement("option");
    option.value = country.slug;
    option.textContent = country.display_name || slugToTitle(country.slug);
    elements.countrySelect.appendChild(option);
  }
}

async function loadCountryData(slug, options = {}) {
  if (!slug) {
    return;
  }

  const preferredAreaCode =
    typeof options.preferredAreaCode === "string" ? options.preferredAreaCode : "";
  const useStoredArea = options.useStoredArea !== false;
  state.selectedSlug = slug;
  state.selectedAreaCode =
    preferredAreaCode || (useStoredArea ? getStoredAreaCode(slug) : "");
  elements.priceValue.textContent = "Loading...";
  elements.priceSubtitle.textContent = "Fetching latest values...";
  elements.futureList.innerHTML = "<li>Loading...</li>";

  try {
    const response = await fetch(`data/${slug}.json`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Data fetch failed (${response.status}).`);
    }

    state.data = await response.json();
    syncAreaOptions();
    persistSelection();
    renderDashboard();
  } catch (error) {
    console.error(error);
    renderFatal(`Could not load data/${slug}.json.`);
  }
}

function resolveInitialSelection(countries) {
  const browserCountry = detectCountryFromBrowser(countries);
  if (browserCountry) {
    setSelectionHint(`Defaulted to ${browserCountry.display_name} from browser settings.`);
    return { slug: browserCountry.slug, areaCode: "" };
  }

  const storedSelection = readStoredSelection();
  const storedCountry = countries.find(
    (country) => country.slug === storedSelection.slug
  );
  if (storedCountry) {
    const areaCode = getStoredAreaCode(storedCountry.slug);
    setSelectionHint(`Loaded saved region: ${storedCountry.display_name}.`);
    return { slug: storedCountry.slug, areaCode };
  }

  setSelectionHint("");
  return { slug: countries[0].slug, areaCode: "" };
}

function detectCountryFromBrowser(countries) {
  const regionCodes = getBrowserRegionCodes();
  for (const code of regionCodes) {
    const match = findCountryByCode(countries, code);
    if (match) {
      return match;
    }
  }

  const timezone = getBrowserTimezone();
  if (timezone) {
    return findCountryByTimezone(countries, timezone);
  }

  return null;
}

function getBrowserRegionCodes() {
  const locales = Array.isArray(navigator.languages)
    ? navigator.languages
    : [navigator.language];
  const codes = [];

  for (const locale of locales) {
    const match = String(locale || "")
      .trim()
      .match(/[-_]([A-Za-z]{2})(?:$|[-_])/);
    if (!match) {
      continue;
    }

    const code = match[1].toUpperCase();
    if (!codes.includes(code)) {
      codes.push(code);
    }
  }

  return codes;
}

function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch (error) {
    console.error(error);
    return "";
  }
}

async function refineSelectionFromIp(expectedSelection) {
  try {
    const payload = await fetchIpLookup();
    const selection = matchSelectionFromLocationPayload(payload, state.countries);

    if (
      !selection.country ||
      (expectedSelection &&
        !selectionExactlyMatches(expectedSelection, getCurrentSelection())) ||
      selectionMatchesCurrent(selection)
    ) {
      return;
    }

    await applyDetectedSelection(selection);
  } catch (error) {
    console.error(error);
  }
}

async function detectRegionFromLocation() {
  setRegionButtonState(true);

  try {
    setSelectionHint("Checking device GPS location...");
    const deviceCoords = await getDeviceCoordinates();
    const selection = matchSelectionFromCoordinates(deviceCoords, state.countries);

    if (!selection.country) {
      throw new Error("No supported country match found.");
    }

    await applyDetectedSelection(selection, { sourcePrefix: "Exact location" });
  } catch (error) {
    console.error(error);
    setSelectionHint("Could not determine an exact location from GPS.");
  } finally {
    setRegionButtonState(false);
  }
}

function selectionMatchesCurrent(selection) {
  if (!selection?.country) {
    return false;
  }

  return selectionMatchesLoosely(
    { slug: selection.country.slug, areaCode: selection.areaCode },
    getCurrentSelection()
  );
}

function selectionMatchesLoosely(left, right) {
  if (!left || !right || left.slug !== right.slug) {
    return false;
  }

  if (!left.areaCode || !right.areaCode) {
    return true;
  }

  return left.areaCode === right.areaCode;
}

function selectionExactlyMatches(left, right) {
  return Boolean(
    left &&
      right &&
      left.slug === right.slug &&
      (left.areaCode || "") === (right.areaCode || "")
  );
}

function getCurrentSelection() {
  return {
    slug: state.selectedSlug,
    areaCode: state.selectedAreaCode,
  };
}

function getDeviceCoordinates() {
  if (!("geolocation" in navigator)) {
    return Promise.reject(new Error("Geolocation is not available."));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          source: "device location",
        });
      },
      reject,
      {
        enableHighAccuracy: true,
        timeout: DEVICE_LOCATION_TIMEOUT_MS,
        maximumAge: 300000,
      }
    );
  });
}

async function fetchIpLookup() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), IP_LOOKUP_TIMEOUT_MS);

  try {
    const response = await fetch(IP_LOOKUP_URL, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`IP lookup failed (${response.status}).`);
    }

    return await response.json();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function matchSelectionFromLocationPayload(payload, countries) {
  const countryCode = String(
    payload?.country_code || payload?.country || payload?.countryCode || ""
  ).toUpperCase();
  const timezone = String(payload?.timezone || "");
  const coordinates = extractCoordinates(payload);
  const country =
    findCountryByCode(countries, countryCode) ||
    findCountryByTimezone(countries, timezone) ||
    null;

  if (!country) {
    return { country: null, areaCode: "", sourceLabel: "" };
  }

  const areaCode = coordinates
    ? inferAreaCodeFromCoordinates(
        country.slug,
        coordinates.latitude,
        coordinates.longitude
      )
    : "";

  return {
    country,
    areaCode,
    sourceLabel: areaCode ? "IP coordinates" : "IP lookup",
  };
}

function extractCoordinates(payload) {
  const latitude = Number(
    payload?.latitude ?? payload?.lat ?? payload?.location?.latitude ?? NaN
  );
  const longitude = Number(
    payload?.longitude ?? payload?.lon ?? payload?.lng ?? payload?.location?.longitude ?? NaN
  );

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function matchSelectionFromCoordinates(coordinates, countries) {
  if (!coordinates) {
    return { country: null, areaCode: "", sourceLabel: "" };
  }

  const countrySlug = inferCountrySlugFromCoordinates(
    coordinates.latitude,
    coordinates.longitude
  );
  if (!countrySlug) {
    return { country: null, areaCode: "", sourceLabel: "" };
  }

  const country = countries.find((entry) => entry.slug === countrySlug) || null;
  if (!country) {
    return { country: null, areaCode: "", sourceLabel: "" };
  }

  return {
    country,
    areaCode: inferAreaCodeFromCoordinates(
      country.slug,
      coordinates.latitude,
      coordinates.longitude
    ),
    sourceLabel: coordinates.source || "device location",
  };
}

function inferCountrySlugFromCoordinates(latitude, longitude) {
  if (isInsideNorwayBounds(latitude, longitude)) {
    return "norway";
  }

  if (isInsideSwedenBounds(latitude, longitude)) {
    return "sweden";
  }

  return "";
}

function inferAreaCodeFromCoordinates(slug, latitude, longitude) {
  switch (slug) {
    case "norway":
      return inferNorwayAreaCode(latitude, longitude);
    case "sweden":
      return inferSwedenAreaCode(latitude, longitude);
    default:
      return "";
  }
}

function isInsideNorwayBounds(latitude, longitude) {
  return latitude >= 57.5 && latitude <= 71.5 && longitude >= 4 && longitude <= 32;
}

function isInsideSwedenBounds(latitude, longitude) {
  return latitude >= 55 && latitude <= 69.5 && longitude >= 10.5 && longitude <= 24.5;
}

// Approximate bidding-zone inference for static hosting without GIS boundary data.
function inferNorwayAreaCode(latitude, longitude) {
  if (!isInsideNorwayBounds(latitude, longitude)) {
    return "";
  }

  if (latitude >= 65) {
    return "NO4";
  }

  if (latitude >= 62.8) {
    return "NO3";
  }

  if (longitude <= 6.8 && latitude >= 59.3) {
    return "NO5";
  }

  if (longitude <= 8.8 && latitude >= 60.9) {
    return "NO5";
  }

  if (latitude < 59.1) {
    return "NO2";
  }

  if (longitude < 8.2 && latitude < 60.9) {
    return "NO2";
  }

  return "NO1";
}

function inferSwedenAreaCode(latitude, longitude) {
  if (!isInsideSwedenBounds(latitude, longitude)) {
    return "";
  }

  if (latitude >= 65) {
    return "SE1";
  }

  if (latitude >= 62.2) {
    return "SE2";
  }

  if (latitude < 56.2) {
    return "SE4";
  }

  if (latitude < 58.2 && longitude > 12) {
    return "SE4";
  }

  return "SE3";
}

async function applyDetectedSelection(selection, options = {}) {
  const { country, areaCode, sourceLabel } = selection;
  if (!country) {
    throw new Error("No country available for detected selection.");
  }

  elements.countrySelect.value = country.slug;
  await loadCountryData(country.slug, { preferredAreaCode: areaCode });

  const sourcePrefix =
    typeof options.sourcePrefix === "string" && options.sourcePrefix
      ? options.sourcePrefix
      : "Detected";
  const label = areaCode
    ? `${sourcePrefix}: ${country.display_name} (${areaCode}) from ${sourceLabel}.`
    : `${sourcePrefix}: ${country.display_name} from ${sourceLabel}.`;
  setSelectionHint(label);
}

function findCountryByCode(countries, code) {
  if (!code) {
    return null;
  }

  return (
    countries.find(
      (country) => String(country.country_code || "").toUpperCase() === code
    ) || null
  );
}

function findCountryByTimezone(countries, timezone) {
  if (!timezone) {
    return null;
  }

  return (
    countries.find(
      (country) => String(country.timezone || "") === timezone
    ) || null
  );
}

function setRegionButtonState(isLoading) {
  elements.regionButton.disabled = isLoading;
  elements.regionButton.textContent = isLoading ? "Locating..." : "Use Exact Location";
}

function readStoredSelection() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { slug: "", areas: {} };
    }

    const parsed = JSON.parse(raw);
    return {
      slug: typeof parsed?.slug === "string" ? parsed.slug : "",
      areas:
        parsed?.areas && typeof parsed.areas === "object" ? parsed.areas : {},
    };
  } catch (error) {
    console.error(error);
    return { slug: "", areas: {} };
  }
}

function getStoredAreaCode(slug) {
  const { areas } = readStoredSelection();
  return typeof areas?.[slug] === "string" ? areas[slug] : "";
}

function persistSelection() {
  if (!state.selectedSlug) {
    return;
  }

  const existing = readStoredSelection();
  const next = {
    slug: state.selectedSlug,
    areas: {
      ...existing.areas,
    },
  };

  if (state.selectedAreaCode) {
    next.areas[state.selectedSlug] = state.selectedAreaCode;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.error(error);
  }
}

function setSelectionHint(message) {
  elements.selectionHint.textContent = message;
}

function normalizePoints(entries) {
  const grouped = new Map();

  for (const entry of entries) {
    const start = new Date(entry.start_local || entry.start_utc);
    const end = new Date(entry.end_local || entry.end_utc);
    const value = Number(
      entry.price_per_kwh ?? entry.price_per_kwh_eur ?? NaN
    );

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      !Number.isFinite(value)
    ) {
      continue;
    }

    const key = start.toISOString();
    if (!grouped.has(key)) {
      grouped.set(key, {
        start,
        end,
        values: [],
        currency: entry.currency || null,
      });
    }

    const bucket = grouped.get(key);
    bucket.values.push(value);
    if (end > bucket.end) {
      bucket.end = end;
    }
    if (!bucket.currency && entry.currency) {
      bucket.currency = entry.currency;
    }
  }

  return [...grouped.values()]
    .map((bucket) => ({
      start: bucket.start,
      end: bucket.end,
      value: avg(bucket.values),
      sourceCount: bucket.values.length,
      currency: bucket.currency || "EUR",
    }))
    .sort((a, b) => a.start - b.start);
}

function renderDashboard() {
  const selectedArea = getSelectedAreaData();
  const points = normalizePoints(selectedArea.prices || []);
  const countryName =
    state.data?.display_name || slugToTitle(state.selectedSlug) || "Unknown";
  const timezone = state.data?.timezone || "UTC";
  const currency = state.data?.currency || "EUR";

  elements.countryName.textContent = selectedArea.areaCode
    ? `${countryName} (${selectedArea.areaCode})`
    : countryName;

  if (!points.length) {
    renderFatal(`No usable price points in ${state.selectedSlug}.json.`);
    return;
  }

  const active = findActivePoint(points);
  const activePoint = points[active.index];
  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));

  elements.priceLabel.textContent = active.label;
  elements.priceValue.textContent = formatKwh(activePoint.value, currency);
  elements.priceSubtitle.textContent = formatInterval(activePoint, timezone);
  elements.statMin.textContent = formatKwh(min, currency);
  elements.statMax.textContent = formatKwh(max, currency);

  renderFutureList(points, active.index, timezone, currency);
  renderChart(points, active.index, timezone);
}

function renderFutureList(points, activeIndex, timezone, currency) {
  const start = Math.max(activeIndex, 0);
  const upcoming = points.slice(start);
  elements.futureList.innerHTML = "";

  if (!upcoming.length) {
    elements.futureList.innerHTML = "<li>No future intervals available.</li>";
    return;
  }

  for (let index = 0; index < upcoming.length; index += 1) {
    const point = upcoming[index];
    const item = document.createElement("li");
    if (index === 0) {
      item.classList.add("active");
    }

    item.innerHTML = `
      <span class="interval-time">${formatIntervalNoWeekday(point, timezone)}</span>
      <span class="interval-price">${formatKwh(point.value, currency)}</span>
    `;
    elements.futureList.appendChild(item);
  }
}

function renderChart(points, activeIndex, timezone) {
  if (points.length < 2) {
    elements.chart.innerHTML = "<p class='muted'>Not enough points to draw chart.</p>";
    return;
  }

  const width = 980;
  const height = 320;
  const margin = { top: 16, right: 20, bottom: 46, left: 58 };
  const drawWidth = width - margin.left - margin.right;
  const drawHeight = height - margin.top - margin.bottom;

  const values = points.map((point) => point.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = Math.max(rawMax - rawMin, Math.max(Math.abs(rawMax), 0.01) * 0.05);
  const min = rawMin >= 0 ? 0 : rawMin - spread * 0.1;
  let max = rawMax + spread * 0.1;
  if (max <= min) {
    max = min + 1;
  }

  const xAt = (index) => {
    if (points.length === 1) {
      return margin.left;
    }
    return margin.left + (index / (points.length - 1)) * drawWidth;
  };

  const yAt = (value) =>
    margin.top + ((max - value) / (max - min)) * drawHeight;

  const coords = points.map((point, index) => ({
    x: xAt(index),
    y: yAt(point.value),
    point,
  }));

  const linePath = coords
    .map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(2)} ${(margin.top + drawHeight).toFixed(2)} L ${coords[0].x.toFixed(2)} ${(margin.top + drawHeight).toFixed(2)} Z`;

  const yTicks = 6;
  const yGrid = [];
  for (let tick = 0; tick < yTicks; tick += 1) {
    const t = tick / (yTicks - 1);
    const y = margin.top + t * drawHeight;
    const value = max - t * (max - min);
    yGrid.push(
      `<line x1="${margin.left}" y1="${y.toFixed(2)}" x2="${(margin.left + drawWidth).toFixed(2)}" y2="${y.toFixed(2)}" />` +
        `<text x="${margin.left - 10}" y="${(y + 4).toFixed(2)}">${formatTick(value)}</text>`
    );
  }

  const xTicks = pickTickIndexes(points.length, 6);
  const xGrid = xTicks
    .map((index) => {
      const x = xAt(index);
      return `<line x1="${x.toFixed(2)}" y1="${margin.top}" x2="${x.toFixed(2)}" y2="${(margin.top + drawHeight).toFixed(2)}" />`;
    })
    .join("");
  const xLabels = xTicks
    .map((index) => {
      const x = xAt(index);
      const text = formatAxisTime(points[index].start, timezone);
      return `<text x="${x.toFixed(2)}" y="${(height - 10).toFixed(2)}">${text}</text>`;
    })
    .join("");

  let activeMarker = "";
  if (activeIndex >= 0 && activeIndex < coords.length) {
    const marker = coords[activeIndex];
    activeMarker = `
      <line class="active-line" x1="${marker.x.toFixed(2)}" y1="${margin.top}" x2="${marker.x.toFixed(2)}" y2="${(margin.top + drawHeight).toFixed(2)}" />
      <circle class="active-dot" cx="${marker.x.toFixed(2)}" cy="${marker.y.toFixed(2)}" r="4.5" />
    `;
  }

  elements.chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <g class="xgrid">${xGrid}</g>
      <g class="grid">${yGrid.join("")}</g>
      <path class="area" d="${areaPath}" />
      <path class="line" d="${linePath}" />
      ${activeMarker}
      <g class="xlabels">${xLabels}</g>
    </svg>
  `;
}

function renderFatal(message) {
  elements.priceLabel.textContent = "Unavailable";
  elements.countryName.textContent = "Data error";
  elements.priceValue.textContent = "--";
  elements.priceSubtitle.textContent = message;
  elements.statMin.textContent = "--";
  elements.statMax.textContent = "--";
  elements.chart.innerHTML = "<p class='muted'>No chart data.</p>";
  elements.futureList.innerHTML = `<li>${message}</li>`;
}

function findActivePoint(points) {
  const now = Date.now();
  let index = points.findIndex((point) => {
    const start = point.start.getTime();
    const end = point.end.getTime();
    return now >= start && now < end;
  });
  let label = "Current interval";

  if (index === -1) {
    index = points.findIndex((point) => point.start.getTime() > now);
    label = "Next interval";
  }

  if (index === -1) {
    index = points.length - 1;
    label = "Latest interval";
  }

  return { index, label };
}

function pickTickIndexes(length, count) {
  if (length <= count) {
    return [...Array(length).keys()];
  }

  const indexes = new Set([0, length - 1]);
  for (let step = 1; step < count - 1; step += 1) {
    indexes.add(Math.round((step / (count - 1)) * (length - 1)));
  }
  return [...indexes].sort((a, b) => a - b);
}

function formatInterval(point, timezone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
  return `${formatter.format(point.start)} - ${formatter.format(point.end)}`;
}

function formatIntervalNoWeekday(point, timezone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  });
  return `${formatter.format(point.start)} - ${formatter.format(point.end)}`;
}

function formatAxisTime(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
  return formatter.format(date).replace(",", "");
}

function formatKwh(value, currency) {
  return `${value.toFixed(5)} ${formatCurrencyPerKwh(currency)}`;
}

function formatCurrencyPerKwh(currencyCode) {
  const code = String(currencyCode || "").toUpperCase();
  const symbolMap = {
    EUR: "€/kWh",
    NOK: "kr/kWh",
    SEK: "kr/kWh",
    DKK: "kr/kWh",
    CHF: "Fr/kWh",
    CZK: "Kc/kWh",
    PLN: "zl/kWh",
    HUF: "Ft/kWh",
    RON: "lei/kWh",
    BGN: "lv/kWh",
    RSD: "din/kWh",
  };

  return symbolMap[code] || `${code || "EUR"}/kWh`;
}

function formatTick(value) {
  const abs = Math.abs(value);
  if (abs >= 10) {
    return value.toFixed(2);
  }
  if (abs >= 1) {
    return value.toFixed(3);
  }
  return value.toFixed(4);
}

function syncAreaOptions() {
  const areas = getAreaEntries(state.data);
  elements.areaSelect.innerHTML = "";

  if (!areas.length) {
    elements.areaField.hidden = true;
    elements.areaSelect.disabled = true;
    state.selectedAreaCode = "";
    return;
  }

  const preferred = state.selectedAreaCode;
  const fallback =
    state.data?.default_area_code || state.data?.area_code || areas[0].area_code;
  const selectedAreaCode = areas.some((area) => area.area_code === preferred)
    ? preferred
    : areas.some((area) => area.area_code === fallback)
      ? fallback
      : areas[0].area_code;

  for (const area of areas) {
    const option = document.createElement("option");
    option.value = area.area_code;
    option.textContent = area.area_code;
    elements.areaSelect.appendChild(option);
  }

  elements.areaField.hidden = areas.length <= 1;
  elements.areaSelect.value = selectedAreaCode;
  elements.areaSelect.disabled = areas.length <= 1;
  state.selectedAreaCode = selectedAreaCode;
}

function getAreaEntries(data) {
  if (Array.isArray(data?.areas) && data.areas.length) {
    return data.areas.filter(
      (area) => typeof area.area_code === "string" && Array.isArray(area.prices)
    );
  }

  if (Array.isArray(data?.prices)) {
    return [
      {
        area_code: data.area_code || data.default_area_code || "DEFAULT",
        prices: data.prices,
      },
    ];
  }

  return [];
}

function getSelectedAreaData() {
  const areas = getAreaEntries(state.data);
  if (!areas.length) {
    return { areaCode: "", prices: [] };
  }

  const selected =
    areas.find((area) => area.area_code === state.selectedAreaCode) || areas[0];

  return {
    areaCode: selected.area_code,
    prices: selected.prices,
  };
}

function slugToTitle(slug) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function avg(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

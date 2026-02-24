const elements = {
  countrySelect: document.getElementById("country-select"),
  areaSelect: document.getElementById("area-select"),
  areaField: document.getElementById("area-field"),
  rawJsonLink: document.getElementById("raw-json-link"),
  priceLabel: document.getElementById("price-label"),
  countryName: document.getElementById("country-name"),
  priceValue: document.getElementById("price-value"),
  priceSubtitle: document.getElementById("price-subtitle"),
  statMin: document.getElementById("stat-min"),
  statMax: document.getElementById("stat-max"),
  statPoints: document.getElementById("stat-points"),
  chart: document.getElementById("chart"),
  chartSummary: document.getElementById("chart-summary"),
  futureList: document.getElementById("future-list"),
};

const state = {
  countries: [],
  selectedSlug: "",
  selectedAreaCode: "",
  data: null,
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  elements.countrySelect.addEventListener("change", async (event) => {
    await loadCountryData(event.target.value);
  });
  elements.areaSelect.addEventListener("change", () => {
    state.selectedAreaCode = elements.areaSelect.value;
    renderDashboard();
  });

  try {
    state.countries = await fetchCountryList();
    renderCountryOptions(state.countries);

    if (!state.countries.length) {
      renderFatal("No country JSON files found in /data.");
      return;
    }

    const firstSlug = state.countries[0].slug;
    elements.countrySelect.value = firstSlug;
    await loadCountryData(firstSlug);
  } catch (error) {
    console.error(error);
    renderFatal("Could not load country list.");
  }
}

async function fetchCountryList() {
  const response = await fetch("/api/countries", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Country list failed (${response.status}).`);
  }
  const payload = await response.json();
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

async function loadCountryData(slug) {
  if (!slug) {
    return;
  }

  state.selectedSlug = slug;
  elements.rawJsonLink.href = `data/${slug}.json`;
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
    renderDashboard();
  } catch (error) {
    console.error(error);
    renderFatal(`Could not load data/${slug}.json.`);
  }
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
  elements.statPoints.textContent = String(points.length);

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
      <span class="interval-time">${formatInterval(point, timezone)}</span>
      <span class="interval-price">${formatKwh(point.value, currency)}</span>
    `;
    elements.futureList.appendChild(item);
  }
}

function renderChart(points, activeIndex, timezone) {
  if (points.length < 2) {
    elements.chart.innerHTML = "<p class='muted'>Not enough points to draw chart.</p>";
    elements.chartSummary.textContent = "";
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
  const min = rawMin - spread * 0.1;
  const max = rawMax + spread * 0.1;

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

  const first = points[0].start;
  const last = points[points.length - 1].end;
  elements.chartSummary.textContent =
    `${points.length} points from ${formatChartTime(first, timezone)} to ${formatChartTime(last, timezone)}.`;
}

function renderFatal(message) {
  elements.priceLabel.textContent = "Unavailable";
  elements.countryName.textContent = "Data error";
  elements.priceValue.textContent = "--";
  elements.priceSubtitle.textContent = message;
  elements.statMin.textContent = "--";
  elements.statMax.textContent = "--";
  elements.statPoints.textContent = "--";
  elements.chart.innerHTML = "<p class='muted'>No chart data.</p>";
  elements.chartSummary.textContent = "";
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

function formatChartTime(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
  return formatter.format(date);
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
  return `${value.toFixed(5)} ${currency}/kWh`;
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

/**
 * Korea Decode — "Korea right now"
 *
 * Live exchange rates and weather for the homepage strip. Both upstreams are
 * free and keyless; results are cached at the edge so a traffic spike does not
 * hammer them (FX moves daily, weather hourly).
 *
 * GET /api/korea-now
 *   { updated, fx: { base:'KRW', rates:[{code,label,krw,flag}] },
 *     weather: [{ city, cityKo, tempC, tempF, code, label, icon, high, low }] }
 *
 * Any upstream failure degrades to null for that half; the page hides what is
 * missing rather than showing a stale or invented number.
 */

const CITIES = [
  { city: 'Seoul',  cityKo: '서울', lat: 37.5665, lon: 126.9780 },
  { city: 'Busan',  cityKo: '부산', lat: 35.1796, lon: 129.0756 },
  { city: 'Jeju',   cityKo: '제주', lat: 33.4996, lon: 126.5312 },
];

// Currencies most Korea Decode readers arrive with.
const CURRENCIES = [
  { code: 'USD', label: '1 USD', flag: '🇺🇸' },
  { code: 'EUR', label: '1 EUR', flag: '🇪🇺' },
  { code: 'JPY', label: '100 JPY', flag: '🇯🇵', per: 100 },
  { code: 'GBP', label: '1 GBP', flag: '🇬🇧' },
];

export async function onRequest(context) {
  const { request } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    // 30 min at the edge, and serve stale for an hour while revalidating.
    'Cache-Control': 'public, max-age=900, s-maxage=1800, stale-while-revalidate=3600',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers });

  const [fx, weather] = await Promise.all([fetchFx(), fetchWeather()]);

  return new Response(JSON.stringify({
    updated: new Date().toISOString(),
    fx,
    weather,
  }), { headers });
}

/* ------------------------------------------------------------------ */
/* Exchange rates — how much KRW one unit of each currency buys        */
/* ------------------------------------------------------------------ */

async function fetchFx() {
  try {
    const resp = await withTimeout(fetch('https://open.er-api.com/v6/latest/USD'), 6000);
    if (!resp.ok) return null;
    const data = await resp.json();
    const r = data?.rates;
    if (!r?.KRW) return null;

    const krwPerUsd = r.KRW;
    const rates = CURRENCIES.map(c => {
      // r[code] is "code per 1 USD", so KRW per 1 code = KRW/USD ÷ code/USD
      const perUnit = c.code === 'USD' ? krwPerUsd : (r[c.code] ? krwPerUsd / r[c.code] : null);
      if (!perUnit || !isFinite(perUnit)) return null;
      const value = perUnit * (c.per || 1);
      return { code: c.code, label: c.label, flag: c.flag, krw: Math.round(value) };
    }).filter(Boolean);

    if (rates.length === 0) return null;
    return { base: 'KRW', rates, asOf: data.time_last_update_utc || null };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Weather — Open-Meteo, no key required                               */
/* ------------------------------------------------------------------ */

async function fetchWeather() {
  try {
    const lat = CITIES.map(c => c.lat).join(',');
    const lon = CITIES.map(c => c.lon).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
                `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min` +
                `&timezone=Asia%2FSeoul&forecast_days=1`;

    const resp = await withTimeout(fetch(url), 6000);
    if (!resp.ok) return null;

    const data = await resp.json();
    // Multi-location requests come back as an array; a single one as an object.
    const list = Array.isArray(data) ? data : [data];

    const out = CITIES.map((c, i) => {
      const d = list[i];
      const t = d?.current?.temperature_2m;
      if (t === undefined || t === null) return null;
      const code = d.current.weather_code;
      const w = describeWeather(code);
      return {
        city: c.city,
        cityKo: c.cityKo,
        tempC: Math.round(t),
        tempF: Math.round(t * 9 / 5 + 32),
        code,
        label: w.label,
        icon: w.icon,
        high: d?.daily?.temperature_2m_max?.[0] != null ? Math.round(d.daily.temperature_2m_max[0]) : null,
        low: d?.daily?.temperature_2m_min?.[0] != null ? Math.round(d.daily.temperature_2m_min[0]) : null,
      };
    }).filter(Boolean);

    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** WMO weather codes → a short English label and a Phosphor icon name. */
function describeWeather(code) {
  const map = {
    0:  ['Clear', 'sun'],
    1:  ['Mostly clear', 'sun'],
    2:  ['Partly cloudy', 'cloud-sun'],
    3:  ['Overcast', 'cloud'],
    45: ['Fog', 'cloud-fog'],
    48: ['Freezing fog', 'cloud-fog'],
    51: ['Light drizzle', 'cloud-rain'],
    53: ['Drizzle', 'cloud-rain'],
    55: ['Heavy drizzle', 'cloud-rain'],
    61: ['Light rain', 'cloud-rain'],
    63: ['Rain', 'cloud-rain'],
    65: ['Heavy rain', 'cloud-rain'],
    66: ['Freezing rain', 'cloud-rain'],
    67: ['Freezing rain', 'cloud-rain'],
    71: ['Light snow', 'cloud-snow'],
    73: ['Snow', 'cloud-snow'],
    75: ['Heavy snow', 'cloud-snow'],
    77: ['Snow grains', 'cloud-snow'],
    80: ['Showers', 'cloud-rain'],
    81: ['Showers', 'cloud-rain'],
    82: ['Heavy showers', 'cloud-rain'],
    85: ['Snow showers', 'cloud-snow'],
    86: ['Snow showers', 'cloud-snow'],
    95: ['Thunderstorm', 'cloud-lightning'],
    96: ['Thunderstorm', 'cloud-lightning'],
    99: ['Thunderstorm', 'cloud-lightning'],
  };
  const [label, icon] = map[code] || ['—', 'cloud'];
  return { label, icon };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

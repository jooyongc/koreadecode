/**
 * Korea Decode — "Korea right now" strip
 *
 * Renders live exchange rates and weather from /api/korea-now.
 * Whatever the API cannot supply is simply left out — the strip never shows a
 * placeholder number, because a wrong rate is worse than no rate.
 */

const ENDPOINT = '/api/korea-now';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderFx(fx) {
  const el = document.getElementById('fx-list');
  if (!el) return;

  if (!fx || !fx.rates?.length) {
    el.innerHTML = '<li class="now-empty">Rates unavailable right now.</li>';
    return;
  }

  el.innerHTML = fx.rates.map(r => `
    <li class="now-item">
      <span class="now-flag" aria-hidden="true">${esc(r.flag)}</span>
      <span class="now-label">${esc(r.label)}</span>
      <span class="now-value">${r.krw.toLocaleString()}<span class="now-unit">₩</span></span>
    </li>
  `).join('');
}

function renderWeather(weather) {
  const el = document.getElementById('weather-list');
  if (!el) return;

  if (!weather || !weather.length) {
    el.innerHTML = '<li class="now-empty">Weather unavailable right now.</li>';
    return;
  }

  el.innerHTML = weather.map(w => `
    <li class="now-item">
      <i class="ph ph-${esc(w.icon)} now-wicon" aria-hidden="true"></i>
      <span class="now-label">${esc(w.city)}<span class="now-ko">${esc(w.cityKo)}</span></span>
      <span class="now-value">${w.tempC}&deg;<span class="now-unit">C</span></span>
      <span class="now-sub">${esc(w.label)}${w.high != null ? ` &middot; ${w.high}&deg;/${w.low}&deg;` : ''}</span>
    </li>
  `).join('');
}

export async function initKoreaNow() {
  const section = document.getElementById('korea-now');
  if (!section) return;

  try {
    const resp = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();

    renderFx(data.fx);
    renderWeather(data.weather);

    const stamp = document.getElementById('now-updated');
    if (stamp) {
      stamp.textContent = new Date(data.updated).toLocaleString('en-US', {
        timeZone: 'Asia/Seoul', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      }) + ' KST';
    }
  } catch (err) {
    console.error('[KoreaNow] failed:', err);
    // Leave the section out entirely rather than showing broken tiles.
    section.style.display = 'none';
  }
}

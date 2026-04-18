/**
 * Korea Decode — Travel Deals Hub Page
 * Fetches hotel_deals via /api/travel-deals with city/checkin/points filters.
 */

import { trackEvent } from '/assets/js/analytics.js';

const DEALS_PER_PAGE = 12;

const state = {
  city: '',
  checkin: '',
  pointsOnly: false,
  page: 1,
  totalPages: 1,
};

function cityLabel(city) {
  const map = { seoul: 'Seoul', busan: 'Busan', jeju: 'Jeju', incheon: 'Incheon' };
  return map[city] || (city ? city.charAt(0).toUpperCase() + city.slice(1) : '');
}

function formatCash(v) {
  if (v == null) return null;
  return `$${Number(v).toLocaleString()}`;
}

function formatPoints(v) {
  if (v == null) return null;
  return `${Number(v).toLocaleString()} pts`;
}

function createDealCard(deal) {
  const city = cityLabel(deal.city);
  const cash = formatCash(deal.cash_price);
  const points = formatPoints(deal.points_price);
  const cpp = deal.cpp ? `${deal.cpp}¢/pt` : null;
  const safe = (s) => String(s || '').replace(/[<>"']/g, (m) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const priceLines = [];
  if (cash) priceLines.push(`<span class="deal-price-cash">${cash}<span class="deal-price-unit">/night</span></span>`);
  if (points) priceLines.push(`<span class="deal-price-points">${points}</span>`);

  return `
    <article class="card deal-card fade-in-up">
      <div class="deal-card-header">
        <div class="deal-city">${safe(city)}</div>
        ${deal.featured ? '<div class="deal-badge">Featured</div>' : ''}
      </div>
      <div class="card-body">
        <h3 class="deal-title">${safe(deal.hotel_name)}</h3>
        <div class="deal-meta">
          ${deal.check_in ? `<span><i class="ph ph-calendar-blank"></i> ${safe(deal.check_in)}</span>` : ''}
          <span><i class="ph ph-moon"></i> ${deal.nights || 1} night${(deal.nights || 1) > 1 ? 's' : ''}</span>
          ${deal.provider ? `<span><i class="ph ph-storefront"></i> ${safe(deal.provider)}</span>` : ''}
        </div>
        <div class="deal-price">${priceLines.join('<span class="deal-price-sep">·</span>')}</div>
        ${cpp ? `<div class="deal-cpp"><i class="ph ph-coins"></i> ${cpp}</div>` : ''}
        ${deal.deeplink ? `
          <a href="${deal.deeplink}" target="_blank" rel="noopener sponsored"
             class="btn btn-primary deal-cta"
             data-deal-id="${safe(deal.id)}"
             data-preset-id="${safe(deal.preset_id || '')}">
            <i class="ph ph-arrow-square-out"></i> Book this deal
          </a>
        ` : ''}
      </div>
    </article>
  `;
}

function renderDeals(deals) {
  const grid = document.getElementById('deals-grid');
  if (!deals.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <i class="ph ph-airplane-taxiing" style="font-size: 3rem; opacity: 0.4;"></i>
        <p>필터 조건에 맞는 딜이 없습니다. 조건을 완화해 보세요.</p>
      </div>
    `;
    return;
  }
  grid.innerHTML = deals.map(createDealCard).join('');
}

function renderPagination() {
  const el = document.getElementById('deals-pagination');
  if (state.totalPages <= 1) {
    el.innerHTML = '';
    return;
  }
  const pages = [];
  for (let i = 1; i <= state.totalPages; i++) {
    const active = i === state.page ? 'active' : '';
    pages.push(`<button class="pagination-btn ${active}" data-page="${i}">${i}</button>`);
  }
  el.innerHTML = pages.join('');
  el.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.page = parseInt(btn.dataset.page, 10);
      fetchAndRender();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function setCount(text) {
  document.getElementById('deals-count').textContent = text;
}

async function fetchAndRender() {
  const params = new URLSearchParams();
  params.set('page', state.page);
  params.set('limit', DEALS_PER_PAGE);
  if (state.city) params.set('city', state.city);
  if (state.checkin) params.set('checkin', state.checkin);
  if (state.pointsOnly) params.set('points_only', 'true');

  setCount('Loading deals...');

  try {
    const res = await fetch(`/api/travel-deals?${params.toString()}`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();

    state.totalPages = data.totalPages || 1;
    renderDeals(data.deals || []);
    renderPagination();

    const suffix = state.city ? ` in ${cityLabel(state.city)}` : '';
    setCount(`${data.total} deal${data.total === 1 ? '' : 's'}${suffix}`);
  } catch (err) {
    console.error('[travel-deals]', err);
    document.getElementById('deals-grid').innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <p>Failed to load deals. Please refresh.</p>
      </div>
    `;
    setCount('');
  }
}

function bindFilters() {
  const citySel = document.getElementById('deal-city');
  const checkinInp = document.getElementById('deal-checkin');
  const pointsChk = document.getElementById('deal-points-only');
  const resetBtn = document.getElementById('deal-reset');

  citySel.addEventListener('change', () => {
    state.city = citySel.value;
    state.page = 1;
    trackEvent('deal_filter_change', 'deals', `city:${state.city || 'all'}`);
    fetchAndRender();
  });

  checkinInp.addEventListener('change', () => {
    state.checkin = checkinInp.value;
    state.page = 1;
    trackEvent('deal_filter_change', 'deals', 'checkin');
    fetchAndRender();
  });

  pointsChk.addEventListener('change', () => {
    state.pointsOnly = pointsChk.checked;
    state.page = 1;
    trackEvent('deal_filter_change', 'deals', `points_only:${state.pointsOnly}`);
    fetchAndRender();
  });

  resetBtn.addEventListener('click', () => {
    citySel.value = '';
    checkinInp.value = '';
    pointsChk.checked = false;
    state.city = '';
    state.checkin = '';
    state.pointsOnly = false;
    state.page = 1;
    fetchAndRender();
  });
}

function bindClickTracking() {
  document.addEventListener('click', (e) => {
    const cta = e.target.closest && e.target.closest('.deal-cta');
    if (!cta) return;
    const presetId = cta.getAttribute('data-preset-id') || '';
    const dealId = cta.getAttribute('data-deal-id') || '';
    trackEvent('deal_cta_click', 'deals', presetId || dealId, undefined);
  }, true);
}

export function initTravelDeals() {
  bindFilters();
  bindClickTracking();
  fetchAndRender();
}

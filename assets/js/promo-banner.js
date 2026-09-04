/**
 * Korea Decode — Rotating promo banner
 *
 * The white strip above "Latest Guides". Each slot is a paid or partner
 * placement, so every one is labelled and its link carries rel="sponsored".
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  HOW TO EDIT THE BANNERS
 *  Change the SLOTS array below. Nothing else needs touching.
 *
 *    headline  — the hook, phrased as a question. Keep it under ~48 chars.
 *    blurb     — one supporting line. Keep it under ~90 chars.
 *    cta       — button label, 2-4 words.
 *    url       — where it goes (affiliate or partner link).
 *    partner   — small credit shown under the button. Optional.
 *    sponsored — true for paid placements (adds the SPONSORED tag and
 *                rel="sponsored"). Set false only for your own content.
 *
 *  To run one banner only: leave a single entry — the arrows and dots hide
 *  themselves. To switch the strip off entirely: empty the array.
 * ─────────────────────────────────────────────────────────────────────────
 */

const SLOTS = [
  {
    headline: 'How to book a train in Korea?',
    blurb: 'KTX seats sell out on weekends and holidays. Reserve before you fly.',
    cta: 'Check KTX passes',
    url: 'https://www.klook.com/',
    partner: 'Klook',
    sponsored: true,
  },
  {
    headline: 'Need a SIM before you land?',
    blurb: 'Pick up data at Incheon, or set up an eSIM before you leave home.',
    cta: 'Compare SIM deals',
    url: 'https://www.kkday.com/',
    partner: 'KKday',
    sponsored: true,
  },
  {
    headline: 'Worth booking a DMZ tour ahead?',
    blurb: 'Border tours need passport details in advance and fill up days early.',
    cta: 'See tour options',
    url: 'https://www.klook.com/',
    partner: 'Klook',
    sponsored: true,
  },
];

const ROTATE_MS = 7000;

let index = 0;
let timer = null;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function slideMarkup(slot, i) {
  const rel = slot.sponsored ? 'sponsored nofollow noopener' : 'noopener';
  return `
    <div class="promo-slide${i === 0 ? ' is-active' : ''}" data-slide="${i}" ${i === 0 ? '' : 'aria-hidden="true"'}>
      <div class="promo-text">
        ${slot.sponsored ? '<span class="promo-tag">Sponsored</span>' : ''}
        <p class="promo-headline">${esc(slot.headline)}</p>
        ${slot.blurb ? `<p class="promo-blurb">${esc(slot.blurb)}</p>` : ''}
      </div>
      <div class="promo-action">
        <a class="promo-cta" href="${esc(slot.url)}" target="_blank" rel="${rel}">
          ${esc(slot.cta)} &rarr;
        </a>
        ${slot.partner ? `<span class="promo-partner">via ${esc(slot.partner)}</span>` : ''}
      </div>
    </div>
  `;
}

function show(next) {
  const slides = document.querySelectorAll('.promo-slide');
  const dots = document.querySelectorAll('.promo-dot');
  if (slides.length === 0) return;

  index = (next + slides.length) % slides.length;

  slides.forEach((el, i) => {
    const on = i === index;
    el.classList.toggle('is-active', on);
    if (on) el.removeAttribute('aria-hidden');
    else el.setAttribute('aria-hidden', 'true');
  });
  dots.forEach((d, i) => {
    d.classList.toggle('is-active', i === index);
    d.setAttribute('aria-selected', i === index ? 'true' : 'false');
  });
}

function start() {
  stop();
  // Honour the reader's motion preference: no unattended movement.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (document.querySelectorAll('.promo-slide').length < 2) return;
  timer = setInterval(() => show(index + 1), ROTATE_MS);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

export function initPromoBanner() {
  const section = document.getElementById('promo-banner');
  if (!section) return;

  // No slots configured — remove the strip rather than leaving an empty band.
  if (SLOTS.length === 0) { section.remove(); return; }

  const track = section.querySelector('.promo-track');
  const nav = section.querySelector('.promo-nav');
  if (!track) return;

  track.innerHTML = SLOTS.map(slideMarkup).join('');

  if (SLOTS.length > 1) {
    nav.innerHTML = `
      <button class="promo-arrow" data-dir="-1" aria-label="Previous offer">&#8249;</button>
      <div class="promo-dots" role="tablist" aria-label="Offers">
        ${SLOTS.map((s, i) => `
          <button class="promo-dot${i === 0 ? ' is-active' : ''}" role="tab"
                  data-go="${i}" aria-selected="${i === 0}"
                  aria-label="Offer ${i + 1}: ${esc(s.headline)}"></button>
        `).join('')}
      </div>
      <button class="promo-arrow" data-dir="1" aria-label="Next offer">&#8250;</button>
    `;

    nav.addEventListener('click', (e) => {
      const arrow = e.target.closest('.promo-arrow');
      const dot = e.target.closest('.promo-dot');
      if (arrow) show(index + Number(arrow.dataset.dir));
      else if (dot) show(Number(dot.dataset.go));
      else return;
      start();   // restart the clock after a manual move
    });
  } else {
    nav.remove();
  }

  // Pause while someone is reading or tabbing through it.
  ['mouseenter', 'focusin'].forEach(ev => section.addEventListener(ev, stop));
  ['mouseleave', 'focusout'].forEach(ev => section.addEventListener(ev, start));
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());

  start();
}

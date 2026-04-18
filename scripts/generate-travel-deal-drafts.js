#!/usr/bin/env node
/**
 * generate-travel-deal-drafts.js
 *
 * hotel_deals에서 최신 레코드를 읽어 posts 테이블에 status='draft'로
 * Travel Deal 초안을 생성한다. 에디터는 검수 후 published 처리.
 *
 * 중복 방지: posts.source_deal_id = hotel_deals.id (unique partial index)
 *
 * 사용법:
 *   node scripts/generate-travel-deal-drafts.js [--limit N] [--dry-run]
 *
 * 선행 조건:
 *   1) create-hotel-deals.sql 실행 완료
 *   2) add-source-deal-id-to-posts.sql 실행 완료
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://agkkvtfwqmzgbrqhvohs.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFna2t2dGZ3cW16Z2JycWh2b2hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2MTU5MDIsImV4cCI6MjA4NjE5MTkwMn0.nZZ8Qrt0dU_v4CSeiVy4DM1IQLAEGBmKldtiotb6Oh8';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 10;

async function sbFetch(endpoint, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'return=representation',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${endpoint} ${res.status}: ${body}`);
  }
  return res.json();
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function cityLabel(city) {
  const map = { seoul: 'Seoul', busan: 'Busan', jeju: 'Jeju', incheon: 'Incheon' };
  return map[city] || city.charAt(0).toUpperCase() + city.slice(1);
}

function buildTitle(deal) {
  const city = cityLabel(deal.city);
  if (deal.points_price && deal.cpp && deal.cpp >= 1.0) {
    return `${city} · ${deal.hotel_name} — ${deal.cpp}¢/pt Point Deal`;
  }
  if (deal.cash_price) {
    return `${city} · ${deal.hotel_name} — $${Math.round(deal.cash_price)}/night Deal`;
  }
  return `${city} · ${deal.hotel_name} — Travel Deal`;
}

function buildExcerpt(deal) {
  const parts = [`${cityLabel(deal.city)} ${deal.hotel_name}`];
  if (deal.check_in) parts.push(`check-in ${deal.check_in}`);
  if (deal.nights) parts.push(`${deal.nights} night${deal.nights > 1 ? 's' : ''}`);
  if (deal.cash_price) parts.push(`$${deal.cash_price}/night`);
  if (deal.points_price) parts.push(`${deal.points_price.toLocaleString()} pts`);
  return parts.join(' · ');
}

function buildBody(deal) {
  const presetSlot = deal.preset_id
    ? `[affiliate preset="${deal.preset_id}"]`
    : `[affiliate preset="REPLACE_WITH_PRESET_ID"]`;
  const city = cityLabel(deal.city);
  const capturedDate = new Date().toISOString().slice(0, 10);

  return `<section class="travel-deal-hero">
  <h2>${city} · ${escapeHtml(deal.hotel_name)}</h2>
  <p class="deal-subtitle">${deal.check_in || 'Flexible dates'} · ${deal.nights || 1} night${(deal.nights || 1) > 1 ? 's' : ''} · ${escapeHtml(deal.provider || 'Partner')}</p>
</section>

<section class="travel-deal-spec">
  <h3>Deal Details</h3>
  <ul>
    ${deal.cash_price ? `<li><strong>Cash price:</strong> $${deal.cash_price} / night</li>` : ''}
    ${deal.points_price ? `<li><strong>Points price:</strong> ${deal.points_price.toLocaleString()} pts / night</li>` : ''}
    ${deal.cpp ? `<li><strong>Value (CPP):</strong> ${deal.cpp}¢ per point</li>` : ''}
    <li><strong>Captured:</strong> ${capturedDate}</li>
  </ul>
</section>

<section class="travel-deal-cta">
  <h3>Book this deal</h3>
  <p>${presetSlot}</p>
</section>

<section class="travel-deal-context">
  <h3>Why this deal stands out</h3>
  <p>[Editor note: Add context on seasonality, room type, loyalty value, or market comparison before publishing.]</p>
</section>

<aside class="affiliate-disclosure">
  <p><strong>Disclosure:</strong> 이 글은 어필리에이트 파트너십 링크를 포함합니다. 구매/예약 시 Korea Decode가 소정의 수수료를 받을 수 있으며, 가격 및 포인트 정보는 수집 시점 기준이므로 실제와 다를 수 있습니다.</p>
</aside>
`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function hasExistingDraft(dealId) {
  const rows = await sbFetch(
    `posts?source_deal_id=eq.${dealId}&select=id,slug,status&limit=1`
  );
  return rows[0] || null;
}

async function generateDraft(deal) {
  const existing = await hasExistingDraft(deal.id);
  if (existing) {
    return { skipped: true, reason: `already exists (${existing.status})`, dealId: deal.id };
  }

  const title = buildTitle(deal);
  const slug = `${slugify(title)}-${deal.id.slice(0, 8)}`;

  const post = {
    title,
    slug,
    category: 'Travel',
    content: buildBody(deal),
    excerpt: buildExcerpt(deal),
    status: 'draft',
    source_deal_id: deal.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (isDryRun) {
    return { skipped: false, dryRun: true, post };
  }

  const inserted = await sbFetch('posts', {
    method: 'POST',
    body: JSON.stringify(post),
  });
  return { skipped: false, post: inserted[0] };
}

async function main() {
  const deals = await sbFetch(
    `hotel_deals?status=eq.active&select=id,city,hotel_name,check_in,nights,cash_price,points_price,cpp,provider,deeplink,preset_id,featured,created_at&order=featured.desc,created_at.desc&limit=${limit}`
  );
  console.log(`[drafts] candidates: ${deals.length}`);

  let created = 0;
  let skipped = 0;
  for (const deal of deals) {
    try {
      const result = await generateDraft(deal);
      if (result.skipped) {
        console.log(`[drafts] skip ${deal.hotel_name}: ${result.reason}`);
        skipped++;
      } else if (result.dryRun) {
        console.log(`[drafts] (dry-run) would create: ${result.post.title}`);
        console.log(`  slug: ${result.post.slug}`);
        created++;
      } else {
        console.log(`[drafts] created: ${result.post.title} (id=${result.post.id})`);
        created++;
      }
    } catch (err) {
      console.error(`[drafts] failed for ${deal.hotel_name}:`, err.message);
    }
  }

  console.log(`[drafts] done: ${created} created, ${skipped} skipped`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

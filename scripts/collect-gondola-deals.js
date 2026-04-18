#!/usr/bin/env node
/**
 * collect-gondola-deals.js
 *
 * Gondola에서 수집한 호텔 딜 데이터를 Supabase hotel_deals에 upsert하고
 * deal_snapshots에 이력을 남긴다.
 *
 * Gondola MCP는 Claude 환경에서 실행되므로, 이 스크립트는 수집된 딜을
 * 다음 중 하나의 방식으로 받는다:
 *
 *   1) stdin으로 JSON 배열 파이프 (권장)
 *        claude-mcp-gondola search ... | node scripts/collect-gondola-deals.js
 *
 *   2) --input 파일 경로 지정
 *        node scripts/collect-gondola-deals.js --input deals.json
 *
 *   3) --dry-run  → DB 쓰기 없이 검증만 (필터 결과, upsert 플랜 출력)
 *
 * Deal JSON 스키마:
 *   { city, hotel_name, check_in, nights, cash_price, points_price,
 *     provider, deeplink, preset_id?, featured?, meta? }
 *
 * 환경변수:
 *   SUPABASE_URL, SUPABASE_ANON_KEY (wrangler.toml의 [vars]와 동일)
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://agkkvtfwqmzgbrqhvohs.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFna2t2dGZ3cW16Z2JycWh2b2hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2MTU5MDIsImV4cCI6MjA4NjE5MTkwMn0.nZZ8Qrt0dU_v4CSeiVy4DM1IQLAEGBmKldtiotb6Oh8';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const inputIdx = args.indexOf('--input');
const inputFile = inputIdx >= 0 ? args[inputIdx + 1] : null;

async function readInput() {
  if (inputFile) {
    const abs = path.resolve(inputFile);
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  }
  if (process.stdin.isTTY) {
    console.error('No input. Provide --input <file> or pipe JSON via stdin.');
    process.exit(2);
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function isValidDeal(d) {
  if (!d || typeof d !== 'object') return false;
  if (!d.city || !d.hotel_name) return false;
  if (d.cash_price != null && (d.cash_price <= 0 || d.cash_price > 100000)) return false;
  if (d.points_price != null && (d.points_price <= 0 || d.points_price > 10_000_000)) return false;
  if (d.deeplink && !/^https?:\/\//.test(d.deeplink)) return false;
  return true;
}

function dedupeKey(d) {
  return `${d.city.toLowerCase()}|${d.hotel_name.toLowerCase()}|${d.check_in || ''}|${d.nights || 1}`;
}

function normalize(d) {
  const cash = d.cash_price != null ? Number(d.cash_price) : null;
  const pts = d.points_price != null ? Number(d.points_price) : null;
  let cpp = null;
  if (cash && pts) cpp = Number(((cash * 100) / pts).toFixed(3));
  return {
    city: String(d.city).toLowerCase(),
    hotel_name: d.hotel_name,
    check_in: d.check_in || null,
    nights: d.nights || 1,
    cash_price: cash,
    points_price: pts,
    cpp,
    provider: d.provider || 'custom',
    deeplink: d.deeplink || null,
    preset_id: d.preset_id || null,
    featured: !!d.featured,
    source: 'gondola',
    meta: d.meta || {},
    status: 'active',
    updated_at: new Date().toISOString(),
  };
}

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

async function findExistingDeal(d) {
  const q = new URLSearchParams({
    city: `eq.${d.city}`,
    hotel_name: `eq.${d.hotel_name}`,
    select: 'id,cash_price,points_price,cpp',
  });
  if (d.check_in) q.append('check_in', `eq.${d.check_in}`);
  if (d.nights) q.append('nights', `eq.${d.nights}`);
  const rows = await sbFetch(`hotel_deals?${q.toString()}`);
  return rows[0] || null;
}

async function upsertDeal(d) {
  const existing = await findExistingDeal(d);
  if (existing) {
    await sbFetch(`hotel_deals?id=eq.${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify(d),
    });
    return { id: existing.id, action: 'updated', previous: existing };
  }
  const inserted = await sbFetch('hotel_deals', {
    method: 'POST',
    body: JSON.stringify(d),
  });
  return { id: inserted[0].id, action: 'inserted', previous: null };
}

async function recordSnapshot(dealId, d, previous) {
  const diff = previous
    ? {
        cash_price: [previous.cash_price, d.cash_price],
        points_price: [previous.points_price, d.points_price],
        cpp: [previous.cpp, d.cpp],
      }
    : {};
  await sbFetch('deal_snapshots', {
    method: 'POST',
    prefer: 'return=minimal',
    body: JSON.stringify({
      deal_id: dealId,
      cash_price: d.cash_price,
      points_price: d.points_price,
      cpp: d.cpp,
      diff,
      source: 'gondola',
    }),
  });
}

async function main() {
  const raw = await readInput();
  const deals = Array.isArray(raw) ? raw : raw.deals || [];
  console.log(`[collect] input: ${deals.length} deal(s)`);

  const valid = [];
  const seen = new Set();
  for (const d of deals) {
    if (!isValidDeal(d)) {
      console.warn('[collect] skipping invalid:', d?.hotel_name || '(unknown)');
      continue;
    }
    const k = dedupeKey(d);
    if (seen.has(k)) {
      console.warn('[collect] skipping duplicate:', d.hotel_name);
      continue;
    }
    seen.add(k);
    valid.push(normalize(d));
  }

  console.log(`[collect] valid: ${valid.length} / ${deals.length}`);

  if (isDryRun) {
    console.log('[collect] --dry-run; no DB writes');
    console.log(JSON.stringify(valid, null, 2));
    return;
  }

  let ok = 0;
  for (const d of valid) {
    try {
      const result = await upsertDeal(d);
      await recordSnapshot(result.id, d, result.previous);
      console.log(`[collect] ${result.action}: ${d.hotel_name} (${result.id})`);
      ok++;
    } catch (err) {
      console.error('[collect] failed:', d.hotel_name, err.message);
    }
  }

  console.log(`[collect] done: ${ok}/${valid.length} succeeded`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

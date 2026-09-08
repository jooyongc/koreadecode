/**
 * Korea Decode — Source Proxy
 *
 * Fetches the reference URLs an editor pastes into the AI Content Creator and
 * returns clean, readable text the model can be grounded on. The browser cannot
 * fetch third-party pages directly (CORS), so this runs at the edge.
 *
 * POST /source-proxy
 *   { "urls": ["https://...", "https://..."] }
 *
 * Response
 *   { "sources": [ { url, finalUrl, title, siteName, text, chars, lang, ok, error } ] }
 *
 * `lang` is "ko" when the extracted text is mostly Hangul, so the article prompt
 * knows it must translate rather than quote.
 */

const MAX_URLS = 4;              // matches the admin UI
const FETCH_TIMEOUT_MS = 12000;  // per URL
const MAX_BYTES = 1_500_000;     // stop reading a page after ~1.5 MB
const MAX_TEXT_CHARS = 12000;    // per source; Gemini's context is large, thin sources are the real risk

export async function onRequest(context) {
  const { request } = context;

  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: cors });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: cors });
  }

  const urls = Array.isArray(body?.urls) ? body.urls.slice(0, MAX_URLS) : [];
  if (urls.length === 0) {
    return new Response(JSON.stringify({ error: "Provide a 'urls' array" }), { status: 400, headers: cors });
  }

  const sources = await Promise.all(urls.map(u => fetchSource(u)));
  return new Response(JSON.stringify({ sources }), { headers: cors });
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

async function fetchSource(rawUrl) {
  const base = { url: String(rawUrl || ''), finalUrl: '', title: '', siteName: '', text: '', chars: 0, lang: 'en', ok: false, error: '' };

  const guard = validateUrl(rawUrl);
  if (!guard.ok) return { ...base, error: guard.error };

  const fetchUrl = rewriteForReadability(guard.url);

  try {
    const resp = await withTimeout(
      fetch(fetchUrl, {
        redirect: 'follow',
        headers: {
          // Some sites serve a stub to unknown agents; identify honestly but completely.
          'User-Agent': 'Mozilla/5.0 (compatible; KoreaDecodeBot/1.0; +https://koreadecode.com/)',
          'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        },
      }),
      FETCH_TIMEOUT_MS
    );

    if (!resp.ok) {
      return { ...base, finalUrl: resp.url || fetchUrl, error: `HTTP ${resp.status}` };
    }

    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('html') && !contentType.includes('text/plain') && !contentType.includes('xml')) {
      return { ...base, finalUrl: resp.url, error: `Unsupported content type (${contentType.split(';')[0] || 'unknown'})` };
    }

    const html = await readCapped(resp, MAX_BYTES);
    const extracted = extractReadable(html);

    if (!extracted.text || extracted.text.length < 120) {
      return {
        ...base,
        finalUrl: resp.url,
        title: extracted.title,
        error: 'Page returned almost no readable text (it may be JavaScript-rendered or blocked)',
      };
    }

    const text = extracted.text.slice(0, MAX_TEXT_CHARS);
    return {
      url: base.url,
      finalUrl: resp.url,
      title: extracted.title,
      siteName: safeHostname(resp.url || fetchUrl),
      text,
      chars: text.length,
      lang: detectLang(text),
      ok: true,
      error: '',
    };
  } catch (err) {
    const msg = /timed out/i.test(err?.message || '') ? 'Timed out' : (err?.message || 'Fetch failed');
    return { ...base, error: msg };
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), ms)),
  ]);
}

/** Read the body but stop once MAX_BYTES have arrived, so one huge page cannot stall the batch. */
async function readCapped(resp, maxBytes) {
  if (!resp.body) return await resp.text();

  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;

  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
  }
  try { await reader.cancel(); } catch { /* already closed */ }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    const room = merged.length - offset;
    merged.set(room >= c.length ? c : c.subarray(0, room), offset);
    offset += c.length;
    if (offset >= merged.length) break;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

/* ------------------------------------------------------------------ */
/* URL safety                                                          */
/* ------------------------------------------------------------------ */

function validateUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return { ok: false, error: 'Not a valid URL' };
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https URLs are supported' };
  }

  const host = u.hostname.toLowerCase();

  // Block loopback, link-local, and private ranges (defence in depth against SSRF).
  const blocked =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^0\./.test(host);

  if (blocked) return { ok: false, error: 'That host is not allowed' };

  return { ok: true, url: u.toString() };
}

function safeHostname(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/**
 * Some sites serve the article at a different address than the one people copy.
 * Rewriting to that address is the difference between a full page of source
 * material and nothing at all.
 *
 * Naver blogs are the big one: blog.naver.com/{id}/{logNo} is a shell whose real
 * content sits in an iframe, and this proxy strips iframes. The mobile host
 * serves the same post as a plain document.
 */
function rewriteForReadability(url) {
  let u;
  try { u = new URL(url); } catch { return url; }

  const host = u.hostname.toLowerCase().replace(/^www\./, '');

  // blog.naver.com/{blogId}/{logNo}  →  m.blog.naver.com/{blogId}/{logNo}
  if (host === 'blog.naver.com') {
    const m = u.pathname.match(/^\/([^/]+)\/(\d+)\/?$/);
    if (m) return `https://m.blog.naver.com/${m[1]}/${m[2]}`;
    // blog.naver.com/PostView.naver?blogId=..&logNo=..
    const blogId = u.searchParams.get('blogId');
    const logNo = u.searchParams.get('logNo');
    if (blogId && logNo) return `https://m.blog.naver.com/${blogId}/${logNo}`;
  }

  // Naver cafe and post share the same iframe pattern for cafe articles.
  if (host === 'cafe.naver.com') {
    const m = u.pathname.match(/^\/([^/]+)\/(\d+)\/?$/);
    if (m) return `https://m.cafe.naver.com/${m[1]}/${m[2]}`;
  }

  return url;
}

/* ------------------------------------------------------------------ */
/* Readability-lite extraction                                         */
/* ------------------------------------------------------------------ */

/**
 * Pull the main prose out of an HTML document without a DOM.
 * Prefers <article> / <main> / og-style containers, falls back to <body>.
 */
function extractReadable(html) {
  if (!html) return { title: '', text: '' };

  const title = decodeEntities(
    (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
     html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
     '').trim()
  ).slice(0, 200);

  // Strip everything that is never article prose.
  let cleaned = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe|form|select|button)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');

  // Every candidate container, scored by how much prose it yields.
  //
  // The old version took the FIRST regex match and kept it. Those patterns are
  // non-greedy, so a <div class="post-content"> containing other divs — which is
  // every modern page — matched only as far as the first inner </div>. A share
  // widget or a byline could win and the rest of the article was thrown away.
  // Picking the richest candidate instead of the first one is what keeps a long
  // page long.
  const bodyHTML = cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || cleaned;
  const bodyText = htmlToText(bodyHTML);

  const candidates = [
    cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1],
    cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1],
    // Naver, Tistory and WordPress content wrappers, in their usual class names.
    ...matchAllGroups(cleaned, /<div[^>]+(?:id|class)=["'][^"']*(?:se-main-container|post-view|postview|article|content|post|entry|body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi),
  ]
    .filter(Boolean)
    .map(htmlToText)
    .filter(t => t.length >= 400);

  const best = candidates.sort((a, b) => b.length - a.length)[0] || '';

  // A container is only worth preferring over the whole body when it holds most
  // of the prose. Otherwise it clipped the article, and the body is safer.
  const text = best.length >= Math.max(400, bodyText.length * 0.4) ? best : bodyText;
  return { title, text };
}

/** All first capture groups of a global regex, capped so a pathological page cannot stall. */
function matchAllGroups(s, re) {
  const out = [];
  for (const m of s.matchAll(re)) {
    if (m[1]) out.push(m[1]);
    if (out.length >= 8) break;
  }
  return out;
}

function htmlToText(fragment) {
  return decodeEntities(
    fragment
      // Keep list and heading structure as line breaks so the AI sees the shape.
      .replace(/<\/(p|div|li|h[1-6]|tr|section|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map(l => l.trim())
    .filter((l, i, arr) => l.length > 0 && !(l === arr[i - 1]))  // drop blanks and repeats
    .join('\n')
    .trim();
}

function decodeEntities(s) {
  if (!s) return '';
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
    mdash: '—', ndash: '–', hellip: '…', middot: '·',
    won: '₩', euro: '€', pound: '£', deg: '°', times: '×',
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] ?? m);
}

function safeChar(code) {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/** Rough language check: Hangul-heavy text is flagged so the prompt translates it. */
function detectLang(text) {
  const sample = text.slice(0, 3000);
  const hangul = (sample.match(/[가-힣]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  if (hangul > 40 && hangul > latin * 0.3) return 'ko';
  if ((sample.match(/[぀-ヿ]/g) || []).length > 40) return 'ja';
  if ((sample.match(/[一-鿿]/g) || []).length > 40) return 'zh';
  return 'en';
}

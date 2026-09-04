import { supabase } from '/assets/js/supabase-config.js';
import { normalizeCategory } from '/assets/js/categories.js';

/* Build stamp. If the module fails to parse this never runs, and the red warning
   baked into admin/index.html stays on screen — which is exactly how a stale or
   broken admin.js announces itself. */
const KD_ADMIN_BUILD = '2026-09-04c';
console.log('[Korea Decode] admin build ' + KD_ADMIN_BUILD);
document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('admin-build');
    if (el) {
        el.textContent = 'build ' + KD_ADMIN_BUILD + ' \u00b7 sources + affiliate slots active';
        el.style.color = 'var(--text-muted)';
    }
});

// --- AI CALL: via server-side proxy (functions/ai-proxy.js) ---
async function callAI(prompt, options = {}) {
    console.log("[AI] Calling AI via proxy...");
    try {
        const body = { prompt };
        const userKey = localStorage.getItem('gemini_key');
        if (userKey) body.userGeminiKey = userKey;
        if (options.model) body.model = options.model;
        if (options.generationConfig) body.generationConfig = options.generationConfig;

        const resp = await fetch('/ai-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        if (!data.text) throw new Error("Empty response from AI");
        console.log("[AI] Proxy success");
        // Ensure we always return a string
        return typeof data.text === 'string' ? data.text : JSON.stringify(data.text);
    } catch (e) {
        console.error("[AI] Proxy failed:", e);
        throw new Error("AI Error: " + e.message);
    }
}

/* ============================================================================
   KOREA DECODE — EDITORIAL ENGINE (2026)
   ----------------------------------------------------------------------------
   No personas. Every article is written in one house voice: Miss Park, a
   Korean writer who actually lives in Korea. Practical guide format, plain
   English, no slang, no invented life stories. Affiliate banners are inserted
   automatically at sensible points in the article body.
   ========================================================================== */

/** The four site categories. Stored on every new post. */
const KD_CATEGORIES = ['Book', 'Plan', 'Shop', 'Food'];

/**
 * The single byline for the whole site. Replaces the old per-post persona system.
 * These fields are what get written to the post's writer_* columns.
 */
const KD_AUTHOR = {
    name: 'Miss Park',
    job: 'Tour guide & Korean teacher, Seoul',
    bio: 'Born in Korea. Licensed tour guide and Korean language teacher, meeting travellers every week.',
    avatar: 'M',
};

/**
 * The house voice. Shared by every content prompt so manual and automated
 * posts read like the same publication.
 */
const MISS_PARK_VOICE = `
**WHO IS WRITING:** Korea Decode is written by "Miss Park" — a Korean writer who lives in Korea.
This is a house voice, not a character to act out. Do NOT invent a biography, a nationality other
than Korean, an age, a job title, a backstory, or personal anecdotes that did not happen. Do NOT
open with a self-introduction. Never write "Hello, I'm..." or "As a 27-year-old...".

**WHAT THE VOICE SOUNDS LIKE:**
- Calm, specific, and useful — like a knowledgeable local answering a friend's question by text.
- Korean perspective is expressed through FACTS, not personality: what locals actually do, what a
  thing really costs here, which option Koreans choose and why, what tourists routinely get wrong.
- First person is allowed but rare, and only for judgement calls ("I would book this one ahead" /
  "I would skip this"). Never for fabricated experiences.
- Confident recommendations. Say which option is better and why, rather than listing everything
  neutrally.
- Respectful about Korea and about the reader. No stereotypes, no "exotic" framing, no gushing.
`.trim();

/**
 * Hard style rules. The slang ban is the important one — the old persona system
 * produced Gen-Z filler that read as machine-written and aged badly.
 */
const KD_STYLE_RULES = `
**LANGUAGE RULES — STRICT:**
1. NO SLANG and NO internet speak. Banned outright: "vibe", "vibe check", "no cap", "low-key",
   "high-key", "obsessed", "iconic", "slay", "bestie", "girlie", "hits different", "living for it",
   "game-changer", "must-have", "literally" (as filler), "honestly" (as filler), "omg", "y'all",
   "insane", "crazy good", "chef's kiss", "unhinged", "rizz", "fire" (as praise), "goated".
2. NO hype adjectives as a substitute for information: "amazing", "incredible", "breathtaking",
   "hidden gem", "must-visit", "bucket list", "you won't believe". Replace each with a fact.
3. NO emoji anywhere in the article body.
4. NO exclamation marks except inside a direct quote.
5. NO AI throat-clearing: "In today's fast-paced world", "Whether you're a seasoned traveler or...",
   "Let's dive in", "In conclusion", "It's worth noting that".
6. NO fabricated specifics. If you are not confident about a price, an address, or an opening time,
   describe the range and say what it depends on, or tell the reader to check on the day. Never
   invent a phone number, a URL, or a review quote.
7. Plain international English. Short sentences. Contractions are fine. Korean terms are written in
   romanisation with Hangul in brackets on first use, e.g. sundubu-jjigae (순두부찌개).
8. Prices always in KRW with an approximate USD figure in brackets.
`.trim();

/** Affiliate partners available for in-article banners. */
const KD_AFFILIATE_PARTNERS = {
    klook: {
        label: 'Klook',
        cta: 'Check price on Klook',
        accent: '#cdff00',
        text: '#000000',
        url: 'https://www.klook.com/',
    },
    kkday: {
        label: 'KKday',
        cta: 'Check price on KKday',
        accent: '#ff6bdf',
        text: '#000000',
        url: 'https://www.kkday.com/',
    },
    trip: {
        label: 'Trip.com',
        cta: 'Check price on Trip.com',
        accent: '#5cc8ff',
        text: '#000000',
        url: 'https://www.trip.com/',
    },
    agoda: {
        label: 'Agoda',
        cta: 'Check price on Agoda',
        accent: '#b3a5ff',
        text: '#000000',
        url: 'https://www.agoda.com/',
    },
};

/**
 * Build one in-article affiliate banner.
 * The markup is self-contained (inline styles) so it survives the Quill editor
 * and renders identically on the live blog.
 *
 * @param {object} opts
 * @param {string} opts.provider - 'klook' | 'kkday'
 * @param {string} opts.text - One line explaining what the reader is booking
 * @param {string} [opts.cta] - Button label
 * @param {string} [opts.url] - Destination (affiliate link goes here)
 * @returns {string} HTML
 */
function buildAffiliateBanner({ provider = 'klook', text = '', cta = '', url = '' } = {}) {
    const p = KD_AFFILIATE_PARTNERS[provider] || KD_AFFILIATE_PARTNERS.klook;
    const body = text || 'Book this ahead — popular dates sell out.';
    const button = cta || p.cta;
    const href = url || p.url;
    return `<div class="affiliate-cta" data-provider="${provider}" style="background:#111;border:1px solid ${p.accent}33;border-left:4px solid ${p.accent};border-radius:12px;padding:18px 20px;margin:28px 0;">
<p style="color:#cfcfcf;margin:0 0 12px;font-size:0.95rem;line-height:1.6;">${body}</p>
<a href="${href}" target="_blank" rel="sponsored nofollow noopener" style="display:inline-block;background:${p.accent};color:${p.text};padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.9rem;">${button} &rarr;</a>
</div>`;
}

/* ============================================================================
   REFERENCE SOURCES
   The AI is weak on Korean local detail, so every article is grounded on pages
   the editor supplies. Fetched through /source-proxy (CORS blocks the browser).
   ========================================================================== */

const KD_MAX_SOURCES = 4;

/** Fetched source documents for the article currently being written. */
let aiSources = [];

/**
 * Fetch and cache the reference pages listed in the Step 1 textarea.
 * Renders per-URL status so the editor can see what actually came back.
 */
async function fetchReferenceSources() {
    const btn = document.getElementById('btn-fetch-sources');
    const statusEl = document.getElementById('source-status');
    const listEl = document.getElementById('source-list');

    const urls = (document.getElementById('ai-source-urls').value || '')
        .split(/[\n,\s]+/)
        .map(u => u.trim())
        .filter(u => /^https?:\/\//i.test(u))
        .slice(0, KD_MAX_SOURCES);

    if (urls.length === 0) {
        aiSources = [];
        listEl.innerHTML = '';
        statusEl.textContent = 'Paste at least one http(s) link first.';
        return;
    }

    const original = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-spinner spinner"></i> Reading...';
    btn.disabled = true;
    statusEl.textContent = `Fetching ${urls.length} page${urls.length > 1 ? 's' : ''}...`;
    listEl.innerHTML = '';

    try {
        const resp = await fetch('/source-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls })
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);

        aiSources = (data.sources || []).filter(s => s.ok);
        renderSourceList(data.sources || []);

        const okCount = aiSources.length;
        const totalChars = aiSources.reduce((n, s) => n + (s.chars || 0), 0);
        statusEl.textContent = okCount === 0
            ? 'No readable content — the article will fall back to general knowledge.'
            : `${okCount} of ${urls.length} read · ${totalChars.toLocaleString()} characters of source material.`;
    } catch (err) {
        console.error('[Sources] fetch failed:', err);
        aiSources = [];
        statusEl.textContent = 'Failed to read sources: ' + err.message;
    } finally {
        btn.innerHTML = original;
        btn.disabled = false;
    }
}

/** Render one status row per requested URL. */
function renderSourceList(sources) {
    const listEl = document.getElementById('source-list');
    if (!listEl) return;

    listEl.innerHTML = sources.map(s => {
        const host = escHtml(s.siteName || s.url);
        if (!s.ok) {
            return `<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
                <i class="ph ph-warning-circle" style="color:var(--danger);margin-top:2px;"></i>
                <div><strong style="color:var(--text-muted);">${host}</strong>
                <div style="color:var(--danger);">${escHtml(s.error || 'Could not read this page')}</div></div>
            </div>`;
        }
        const langTag = s.lang === 'ko'
            ? '<span style="color:var(--accent);">KO &rarr; will be translated</span>'
            : `<span style="color:var(--text-muted);">${escHtml((s.lang || 'en').toUpperCase())}</span>`;
        return `<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
            <i class="ph ph-check-circle" style="color:var(--accent);margin-top:2px;"></i>
            <div style="min-width:0;">
                <strong style="color:var(--text-primary);">${escHtml(s.title || host)}</strong>
                <div style="color:var(--text-muted);">${host} · ${(s.chars || 0).toLocaleString()} chars · ${langTag}</div>
            </div>
        </div>`;
    }).join('');
}

/**
 * Format the fetched sources for a prompt.
 * @param {number} perSource - Characters to include from each source
 * @returns {string} Prompt block, or '' when nothing was fetched
 */
function buildSourceBlock(perSource = 4500) {
    if (aiSources.length === 0) return '';

    const docs = aiSources.map((s, i) => {
        const langNote = s.lang === 'ko'
            ? ' [KOREAN — translate the facts into natural English, do not quote the Korean]'
            : '';
        return `--- SOURCE ${i + 1}: ${s.title || s.siteName} (${s.siteName})${langNote} ---
${s.text.slice(0, perSource)}`;
    }).join('\n\n');

    return `
**SOURCE MATERIAL — this is the ground truth for this article:**

${docs}

--- END OF SOURCES ---

**HOW TO USE THE SOURCES (critical — this is why they were provided):**
- Every specific fact comes from the sources: prices, opening hours, addresses, subway
  lines and exit numbers, durations, phone-ahead rules, what a ticket includes.
- Any source in Korean must be TRANSLATED into natural English. Never leave Korean
  sentences in the article and never translate word-for-word — rewrite it as English prose.
  Korean proper nouns keep romanisation with Hangul in brackets on first use.
- You may add general background, context and explanation from your own knowledge to make
  the guide readable — but NOT specific numbers, names, addresses or times. If a figure is
  not in the sources, either leave it out or say what it depends on.
- Where the sources disagree, prefer the most specific and most recent one.
- Never copy a source sentence verbatim. Rewrite everything in the house voice.
`;
}

/* ============================================================================
   AFFILIATE SLOTS
   The editor pastes up to 5 links before generation; the model places each one
   where it belongs in the article, so nothing has to be inserted by hand later.
   ========================================================================== */

const KD_MAX_AFFILIATE_SLOTS = 5;

/** Build the 5 empty slot rows in Step 2. */
function renderAffiliateSlots() {
    const wrap = document.getElementById('affiliate-slots');
    if (!wrap || wrap.dataset.built === '1') return;

    wrap.innerHTML = Array.from({ length: KD_MAX_AFFILIATE_SLOTS }, (_, i) => `
        <div class="affiliate-slot" style="display:grid;grid-template-columns:26px 1fr 1fr 110px;gap:8px;align-items:center;margin-bottom:8px;">
            <span style="font-size:12px;color:var(--text-muted);text-align:center;">${i + 1}</span>
            <input class="form-input aff-slot-url" data-slot="${i}" placeholder="https://affiliate-link..." style="font-size:12px;">
            <input class="form-input aff-slot-desc" data-slot="${i}" placeholder="What it is, e.g. Half-day DMZ tour" style="font-size:12px;">
            <select class="form-select aff-slot-provider" data-slot="${i}" style="font-size:12px;">
                ${Object.entries(KD_AFFILIATE_PARTNERS).map(([key, p]) =>
                    `<option value="${key}">${p.label}</option>`).join('')}
            </select>
        </div>
    `).join('');
    wrap.dataset.built = '1';
}

/**
 * Read the filled-in slots.
 * @returns {Array<{n:number, url:string, desc:string, provider:string}>}
 */
function readAffiliateSlots() {
    const slots = [];
    document.querySelectorAll('.aff-slot-url').forEach(input => {
        const i = input.dataset.slot;
        const url = input.value.trim();
        if (!/^https?:\/\//i.test(url)) return;
        const desc = document.querySelector(`.aff-slot-desc[data-slot="${i}"]`)?.value.trim() || '';
        const provider = document.querySelector(`.aff-slot-provider[data-slot="${i}"]`)?.value || 'klook';
        slots.push({ n: slots.length + 1, url, desc, provider });
    });
    return slots;
}

/** Prompt block describing the available affiliate placements. */
function buildAffiliateSlotBlock(slots) {
    if (slots.length === 0) return '';
    const list = slots.map(s => `- [[AFF:${s.n}]] — ${s.desc || 'a bookable tour or product related to this topic'}`).join('\n');
    return `
**AFFILIATE PLACEMENTS — ${slots.length} link${slots.length > 1 ? 's' : ''} to position:**
${list}

Place each marker on its own line, exactly as written (e.g. "[[AFF:2]]"), at the point in
the article where a reader would naturally want it — straight AFTER you have explained why
that thing is worth doing or what it costs. Rules:
- Use every marker exactly once. Do not invent markers beyond the list.
- Never put one in the intro, never two in a row, never one as the final line.
- Do not write your own booking button HTML; the marker becomes the button automatically.
`;
}

/**
 * Swap [[AFF:n]] markers for real banners, then place any the model skipped.
 * @param {string} html - Article body
 * @param {Array} slots - From readAffiliateSlots()
 * @returns {string}
 */
function applyAffiliateSlots(html, slots) {
    if (!slots || slots.length === 0) return html;

    let out = html;
    const placed = new Set();

    slots.forEach(slot => {
        const banner = buildAffiliateBanner({
            provider: slot.provider,
            text: slot.desc || 'Book this ahead — popular dates sell out.',
            url: slot.url,
        });
        // Tolerate <p>[[AFF:1]]</p>, [[AFF: 1]], [[aff:1]] and friends.
        const marker = new RegExp(`(?:<p[^>]*>\\s*)?\\[\\[\\s*AFF\\s*:\\s*${slot.n}\\s*\\]\\](?:\\s*</p>)?`, 'gi');
        if (marker.test(out)) {
            marker.lastIndex = 0;
            let first = true;
            out = out.replace(marker, () => {
                if (!first) return '';            // model repeated a marker — keep only the first
                first = false;
                placed.add(slot.n);
                return banner;
            });
        }
    });

    // Strip any stray markers the model invented, then place unused slots at section breaks.
    out = out.replace(/(?:<p[^>]*>\s*)?\[\[\s*AFF\s*:\s*\d+\s*\]\](?:\s*<\/p>)?/gi, '');

    const leftovers = slots.filter(s => !placed.has(s.n));
    if (leftovers.length > 0) {
        const banner = slot => buildAffiliateBanner({
            provider: slot.provider,
            text: slot.desc || 'Book this ahead — popular dates sell out.',
            url: slot.url,
        });

        const parts = out.split(/(?=<h2[\s>])/i);

        // Candidate insertion points sit before an <h2>. Start at the SECOND heading so a
        // banner never lands between the intro and the first section; fall back to the
        // first heading only when there are not enough sections to go round.
        const points = [];
        for (let i = parts.length > 2 ? 2 : 1; i < parts.length; i++) points.push(i);
        if (points.length > 0 && points.length < leftovers.length && parts.length > 1) points.unshift(1);

        const chosen = [];
        if (points.length > 0) {
            const stride = points.length / leftovers.length;
            for (let i = 0; i < leftovers.length; i++) {
                const idx = points[Math.min(points.length - 1, Math.floor(i * stride))];
                if (!chosen.includes(idx)) chosen.push(idx);
            }
        }

        // Pair slots to points, insert from the end so earlier indices stay valid.
        const targets = chosen.map((idx, i) => ({ idx, slot: leftovers[i] }))
                              .sort((a, b) => b.idx - a.idx);
        targets.forEach(({ idx, slot }) => parts.splice(idx, 0, banner(slot) + '\n'));
        out = parts.join('');

        // More links than usable section breaks — the remainder goes at the end.
        leftovers.slice(chosen.length).forEach(slot => { out += '\n' + banner(slot); });
    }

    if (!out.includes('affiliate-disclosure')) out += '\n' + KD_AFFILIATE_DISCLOSURE;
    return out;
}

/** Standard disclosure appended to every article that carries affiliate links. */
const KD_AFFILIATE_DISCLOSURE = `<aside class="affiliate-disclosure"><strong>Disclosure:</strong> some links in this guide are affiliate links. If you book through them, Korea Decode may earn a small commission at no extra cost to you. It never changes which options we recommend.</aside>`;

/**
 * Guarantee that an article body carries affiliate banners, spaced through the text.
 *
 * The model is asked to place them contextually; this is the safety net that runs
 * afterwards. It counts what the model produced and tops up to `min` by inserting
 * banners before evenly-spaced <h2> headings (never before the first one, never at
 * the very end), alternating between partners.
 *
 * @param {string} html - Article body HTML
 * @param {object} [opts]
 * @param {number} [opts.min=2] - Minimum banners in the article
 * @param {number} [opts.max=4] - Never exceed this many
 * @param {string} [opts.topic] - Used for the banner copy
 * @returns {string} HTML with banners and disclosure
 */
function injectAffiliateBanners(html, opts = {}) {
    const { min = 2, max = 4, topic = '' } = opts;
    if (!html) return html;

    const existing = (html.match(/class="affiliate-cta"/g) || []).length;

    // Too many? Leave it — trimming risks breaking the model's markup.
    if (existing >= min) {
        return html.includes('affiliate-disclosure') ? html : html + '\n' + KD_AFFILIATE_DISCLOSURE;
    }

    const needed = Math.min(min - existing, max - existing);
    if (needed <= 0) return html;

    // Split on <h2> so banners land at natural section breaks.
    const parts = html.split(/(?=<h2[\s>])/i);
    if (parts.length < 3) {
        // Not enough headings to space them out — fall back to paragraph breaks.
        const paras = html.split(/(?=<p[\s>])/i);
        if (paras.length < 4) {
            return html + '\n' + buildAffiliateBanner({
                provider: 'klook',
                text: topic
                    ? `Planning ${topic}? Compare tours and tickets before you go — booking ahead is usually cheaper than buying on the day.`
                    : 'Compare tours and tickets before you go — booking ahead is usually cheaper than buying on the day.',
            }) + '\n' + KD_AFFILIATE_DISCLOSURE;
        }
        const at = Math.floor(paras.length / 2);
        paras.splice(at, 0, buildAffiliateBanner({
            provider: 'klook',
            text: topic
                ? `Booking ${topic} in advance usually costs less than buying at the counter, and popular time slots go first.`
                : 'Booking in advance usually costs less than buying at the counter, and popular time slots go first.',
        }));
        return paras.join('') + '\n' + KD_AFFILIATE_DISCLOSURE;
    }

    // Candidate slots: every <h2> except the first section and the last.
    const slots = [];
    for (let i = 1; i < parts.length; i++) slots.push(i);
    const chosen = [];
    const step = Math.max(1, Math.floor(slots.length / (needed + 1)));
    for (let n = 1; n <= needed; n++) {
        const idx = slots[Math.min(slots.length - 1, n * step)];
        if (idx !== undefined && !chosen.includes(idx)) chosen.push(idx);
    }

    const providers = ['klook', 'kkday'];
    const copy = [
        topic
            ? `Booking ${topic} ahead is usually cheaper than paying at the gate, and the popular time slots go first.`
            : 'Booking ahead is usually cheaper than paying at the gate, and the popular time slots go first.',
        'Prefer a guided version with hotel pickup? Compare what each operator actually includes before you pay.',
        'Short on time? A skip-the-line ticket saves the queue on weekends and public holidays.',
        'Travelling as a group? Per-person prices usually drop once you book together.',
    ];

    // Insert from the end so earlier indices stay valid.
    chosen.sort((a, b) => b - a).forEach((idx, n) => {
        parts.splice(idx, 0, buildAffiliateBanner({
            provider: providers[n % providers.length],
            text: copy[n % copy.length],
        }) + '\n');
    });

    let out = parts.join('');
    if (!out.includes('affiliate-disclosure')) out += '\n' + KD_AFFILIATE_DISCLOSURE;
    return out;
}

/**
 * Last-resort cleanup for slang the model slipped in anyway.
 * Only removes filler that is safe to delete or swap without changing meaning.
 * @param {string} html
 * @returns {string}
 */
function scrubSlang(html) {
    if (!html) return html;
    const swaps = [
        [/\bvibe check\b/gi, 'atmosphere'],
        // Plural forms first so subject-verb agreement survives the swap
        [/\bthe vibes are\b/gi, 'the atmosphere is'],
        [/\bvibes were\b/gi, 'atmosphere was'],
        [/\bvibes\b/gi, 'atmosphere'],
        [/\bvibe\b/gi, 'atmosphere'],
        [/\bno cap\b/gi, ''],
        [/\blow-?key\b/gi, ''],
        [/\bhigh-?key\b/gi, ''],
        [/\bI'?m obsessed\b/gi, 'I rate it highly'],
        [/\bhits different\b/gi, 'stands out'],
        [/\bgame-?changer\b/gi, 'a genuine improvement'],
        [/\bhidden gem\b/gi, 'lesser-known spot'],
        [/\bmust-?visit\b/gi, 'worth the trip'],
        [/\bbucket list\b/gi, 'trip highlight'],
        [/\bchef'?s kiss\b/gi, ''],
        [/\bbestie\b/gi, ''],
        [/\bslay(s|ed)?\b/gi, ''],
        [/\bliterally\s+/gi, ''],
        [/\bhonestly,\s*/gi, ''],
        [/\byou won'?t believe\b/gi, 'here is'],
    ];
    let out = html;
    swaps.forEach(([re, to]) => { out = out.replace(re, to); });
    // Tidy double spaces introduced by deletions
    return out.replace(/ {2,}/g, ' ').replace(/\s+([,.])/g, '$1');
}

function cleanJSONResponse(text) {
    if (typeof text !== 'string') text = JSON.stringify(text);
    text = text.trim();
    if (text.startsWith("```json")) {
        text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (text.startsWith("```")) {
        text = text.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }
    return text;
}

/**
 * Attempt to repair truncated JSON from AI responses.
 * Fixes unterminated strings, missing brackets/braces, trailing commas.
 */
function repairJSON(text) {
    if (typeof text !== 'string') text = JSON.stringify(text);
    text = text.trim();

    // Remove trailing comma before attempting to close
    text = text.replace(/,\s*$/, '');

    // Count open/close brackets and braces
    let inString = false;
    let escape = false;
    let openBraces = 0;
    let openBrackets = 0;
    let lastCharWasBackslash = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') openBraces++;
        if (ch === '}') openBraces--;
        if (ch === '[') openBrackets++;
        if (ch === ']') openBrackets--;
    }

    // If we're inside an unterminated string, close it
    if (inString) {
        text += '"';
    }

    // Remove trailing comma after fixing string
    text = text.replace(/,\s*$/, '');

    // Close any open brackets and braces
    for (let i = 0; i < openBrackets; i++) text += ']';
    for (let i = 0; i < openBraces; i++) text += '}';

    return text;
}

/**
 * Parse JSON from AI with automatic repair on failure.
 */
function parseAIJSON(rawText) {
    const cleaned = cleanJSONResponse(rawText);
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        console.warn("[AI] JSON parse failed, attempting repair:", e.message);
        const repaired = repairJSON(cleaned);
        return JSON.parse(repaired);
    }
}

// --- SLUG GENERATION ---
function generateSlug(title) {
    if (!title) return '';
    return title
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')      // Remove non-word chars except spaces and hyphens
        .replace(/\s+/g, '-')           // Replace spaces with hyphens
        .replace(/-+/g, '-')            // Collapse multiple hyphens
        .replace(/^-+|-+$/g, '')        // Trim leading/trailing hyphens
        .substring(0, 80);              // Limit length
}



let quill;
let activeImage = '';
let currentUser = null;
let editingPostId = null;
let editingPersonaId = null;
let availablePersonas = [];
let unsplashMode = 'featured'; // 'featured' | 'body'
let affiliateCodes = {}; // Map of aff-id → raw HTML code
let pendingUploadFile = null; // File object waiting to be uploaded
let imgSearchPage = 1; // current image search page

// --- CORE INITIALIZATION ---
async function init() {
    // Reference sources + affiliate slots first: they depend on nothing else, so a
    // later failure (blocked CDN, Quill hiccup) cannot stop them from being wired up.
    document.getElementById('btn-fetch-sources')?.addEventListener('click', fetchReferenceSources);
    renderAffiliateSlots();
    initAdManager();

    // Initialize Quill Editor
    quill = new Quill('#editor-container', {
        theme: 'snow',
        modules: {
            toolbar: [
                [{ 'header': [1, 2, 3, false] }],
                ['bold', 'italic', 'underline', 'blockquote'],
                [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                ['link', 'clean']
            ]
        }
    });
    quill.on('text-change', calculateSEOScore);
    initImageResizer();

    // Auto-generate slug when title changes
    const titleInput = document.getElementById('ai-suggested-title');
    if (titleInput) {
        titleInput.addEventListener('input', () => {
            const slugInput = document.getElementById('ai-slug');
            if (slugInput && !editingPostId) {
                slugInput.value = generateSlug(titleInput.value);
            }
        });
    }

    // Supabase Auth: Check existing session
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        currentUser = session.user;
        document.getElementById('login-section').style.display = 'none';
        restoreGeminiKeyFromCloud(session.user);
        loadDashboard();
        loadPersonas();
        ensureStorageBucket();
    } else {
        document.getElementById('login-section').style.display = 'flex';
    }

    // Supabase Auth State Listener
    supabase.auth.onAuthStateChange((event, session) => {
        if (session) {
            currentUser = session.user;
            document.getElementById('login-section').style.display = 'none';
            restoreGeminiKeyFromCloud(session.user);
            loadDashboard();
            loadPersonas();
            ensureStorageBucket();
        } else {
            currentUser = null;
            document.getElementById('login-section').style.display = 'flex';
        }
    });

    // --- STATIC EVENT LISTENERS ---
    document.querySelectorAll('.nav-item[data-view]').forEach(el => {
        el.addEventListener('click', () => switchView(el.dataset.view));
    });

    document.getElementById('btn-login').addEventListener('click', doLogin);
    document.getElementById('login-email').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const pw = document.getElementById('login-password');
            if (!pw.value) pw.focus();
            else doLogin();
        }
    });
    document.getElementById('login-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doLogin();
    });
    document.getElementById('btn-logout').addEventListener('click', async () => {
        await supabase.auth.signOut();
    });

    document.getElementById('btn-reset-ai').addEventListener('click', resetAI);
    document.getElementById('btn-seo-polish').addEventListener('click', runSEOPolish);
    document.getElementById('btn-run-ai-phase1').addEventListener('click', runAIPhase1);
    document.getElementById('btn-run-ai-phase2').addEventListener('click', runAIPhase2);
    document.getElementById('btn-search-unsplash').addEventListener('click', searchUnsplashAI);
    document.getElementById('btn-save-post').addEventListener('click', publishPost);
    document.getElementById('btn-show-preview').addEventListener('click', showMobilePreview);
    document.getElementById('btn-toggle-html').addEventListener('click', toggleHtmlSource);

    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-save-hero').addEventListener('click', saveHeroSettings);
    document.getElementById('btn-hero-search-img').addEventListener('click', searchHeroImages);
    document.getElementById('hero-img-query').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchHeroImages();
    });
    // Live preview update
    ['hero-label', 'hero-title-before', 'hero-title-highlight', 'hero-title-after', 'hero-bg-image'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateHeroPreview);
    });
    document.getElementById('btn-remove-duplicates').addEventListener('click', removeDuplicates);
    document.getElementById('btn-generate-persona').addEventListener('click', generateRandomPersona);
    document.getElementById('btn-save-persona').addEventListener('click', saveOrUpdatePersona);
    document.getElementById('btn-cancel-persona').addEventListener('click', resetPersonaForm);

    document.getElementById('btn-run-automation').addEventListener('click', runAutomation);
    document.getElementById('btn-save-auto-profile').addEventListener('click', saveAutoProfile);
    document.getElementById('btn-delete-auto-profile').addEventListener('click', deleteAutoProfile);
    document.getElementById('auto-profile-select').addEventListener('change', loadAutoProfile);
    document.getElementById('btn-batch-publish').addEventListener('click', batchPublishDrafts);
    document.getElementById('btn-batch-delete').addEventListener('click', batchDeleteDrafts);
    document.getElementById('auto-select-all').addEventListener('change', (e) => {
        document.querySelectorAll('.auto-draft-check').forEach(cb => cb.checked = e.target.checked);
    });
    document.querySelectorAll('.auto-queue-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auto-queue-tab').forEach(t => {
                t.classList.remove('active');
                t.style.borderBottomColor = 'transparent';
            });
            tab.classList.add('active');
            tab.style.borderBottomColor = 'var(--accent)';
            const tabName = tab.dataset.tab;
            document.getElementById('auto-tab-drafts').style.display = tabName === 'drafts' ? 'block' : 'none';
            document.getElementById('auto-tab-scheduled').style.display = tabName === 'scheduled' ? 'block' : 'none';
            document.getElementById('auto-batch-actions').style.display = tabName === 'drafts' ? 'flex' : 'none';
        });
    });
    document.getElementById('btn-start-migration').addEventListener('click', startMigration);

    document.getElementById('btn-insert-body-img').addEventListener('click', openUnsplashForBody);
    document.getElementById('btn-unsplash-modal-search').addEventListener('click', searchUnsplashModal);
    document.getElementById('unsplash-modal-search').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchUnsplashModal();
    });
    document.getElementById('btn-close-unsplash').addEventListener('click', () => { resetUploadUI(); closeModal('modal-unsplash'); });
    document.getElementById('btn-close-preview').addEventListener('click', () => closeModal('modal-preview'));

    // Image modal tab switching
    document.querySelectorAll('.img-modal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.img-modal-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            document.getElementById('img-tab-search').style.display = tabName === 'search' ? 'block' : 'none';
            document.getElementById('img-tab-upload').style.display = tabName === 'upload' ? 'block' : 'none';
        });
    });

    // Upload file input
    document.getElementById('upload-file-input').addEventListener('change', (e) => {
        if (e.target.files[0]) handleUploadFile(e.target.files[0]);
    });

    // Drag & drop
    const dropZone = document.getElementById('upload-drop-zone');
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) handleUploadFile(e.dataTransfer.files[0]);
    });

    // Upload confirm / cancel
    document.getElementById('btn-confirm-upload').addEventListener('click', confirmUpload);
    document.getElementById('btn-cancel-upload').addEventListener('click', resetUploadUI);

    // Featured image upload button
    document.getElementById('btn-upload-featured').addEventListener('click', () => {
        unsplashMode = 'featured';
        document.getElementById('unsplash-modal-title').innerText = 'Featured Image';
        resetUploadUI();
        // Switch to Upload tab
        document.querySelectorAll('.img-modal-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.img-modal-tab[data-tab="upload"]').classList.add('active');
        document.getElementById('img-tab-search').style.display = 'none';
        document.getElementById('img-tab-upload').style.display = 'block';
        document.getElementById('modal-unsplash').style.display = 'flex';
    });
    document.getElementById('btn-insert-affiliate').addEventListener('click', openAffiliateModal);
    document.getElementById('btn-insert-travel-deal').addEventListener('click', insertTravelDealTemplate);
    document.getElementById('btn-confirm-affiliate').addEventListener('click', insertAffiliateCode);
    document.getElementById('btn-save-aff-preset').addEventListener('click', saveAffiliatePresetLegacy);
    document.getElementById('btn-close-affiliate').addEventListener('click', () => closeModal('modal-affiliate'));
    // New: DB-backed preset UI
    document.getElementById('btn-insert-shortcode').addEventListener('click', insertAffiliateShortcode);
    document.getElementById('btn-aff-preset-save').addEventListener('click', saveAffiliatePresetToDB);
    document.getElementById('btn-aff-preset-delete').addEventListener('click', deleteAffiliatePresetFromDB);
    document.getElementById('aff-preset-select').addEventListener('change', onPresetSelectChange);
    document.querySelectorAll('.aff-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchAffiliateTab(btn.dataset.affTab));
    });

    const personaList = document.getElementById('persona-list');
    personaList.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        const action = button.dataset.action;
        const id = button.dataset.id;
        if (action === 'edit') editPersona(id);
        else if (action === 'delete') deletePersona(id);
    });

    const savedKey = localStorage.getItem('gemini_key');
    document.getElementById('setting-gemini-key').value = savedKey || '';
    document.getElementById('setting-gemini-key').placeholder = 'AIzaSy...';

    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('auto-start-date').value = now.toISOString().slice(0, 16);

    loadAutoProfiles();
}


// --- VIEW SWITCHING ---
const switchView = (viewName) => {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`.nav-item[data-view="${viewName}"]`).classList.add('active');

    if (viewName === 'posts') loadPosts();
    if (viewName === 'dashboard') loadDashboard();
    if (viewName === 'automation') loadQueue();
    if (viewName === 'personas') loadPersonas();
    if (viewName === 'settings') loadPersonas();
    if (viewName === 'site-settings') loadHeroSettings();
    if (viewName === 'ads') loadAdSlots();
    if (viewName === 'ai-writer') {
        if (!editingPostId) resetAI();
        refreshPersonaSelect();
    }
};
// Expose switchView globally for onclick handlers in HTML
window.switchView = switchView;

// --- AUTHENTICATION ---
async function doLogin() {
    const e = document.getElementById('login-email').value;
    const p = document.getElementById('login-password').value;
    try {
        const { error } = await supabase.auth.signInWithPassword({ email: e, password: p });
        if (error) throw error;
    } catch (err) {
        document.getElementById('login-error').innerText = err.message;
    }
}

// --- SETTINGS ---
const saveSettings = async () => {
    const k = document.getElementById('setting-gemini-key').value.trim();
    if (!k) return alert('Gemini API Key를 입력해주세요.');
    localStorage.setItem('gemini_key', k);
    // Cloud save to Supabase user metadata
    try {
        await supabase.auth.updateUser({ data: { gemini_key: k } });
        updateKeyStatusIndicator(true);
    } catch (e) {
        console.warn('Cloud sync failed:', e);
        updateKeyStatusIndicator(false);
    }
    alert('Gemini API Key 저장 완료! (Cloud synced)');
};

function restoreGeminiKeyFromCloud(user) {
    const cloudKey = user?.user_metadata?.gemini_key;
    if (cloudKey && !localStorage.getItem('gemini_key')) {
        localStorage.setItem('gemini_key', cloudKey);
        const input = document.getElementById('setting-gemini-key');
        if (input) input.value = cloudKey;
        console.log('[Settings] Gemini key restored from cloud');
    }
    updateKeyStatusIndicator(!!cloudKey);
}

function updateKeyStatusIndicator(synced) {
    let indicator = document.getElementById('key-sync-status');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'key-sync-status';
        indicator.style.cssText = 'font-size: 12px; margin-top: 8px; display: flex; align-items: center; gap: 6px;';
        const btn = document.getElementById('btn-save-settings');
        if (btn) btn.insertAdjacentElement('afterend', indicator);
    }
    if (synced) {
        indicator.innerHTML = '<i class="ph ph-cloud-check" style="color: var(--success);"></i> <span style="color: var(--success);">Cloud synced</span>';
    } else {
        indicator.innerHTML = '<i class="ph ph-cloud-slash" style="color: var(--text-muted);"></i> <span style="color: var(--text-muted);">Local only</span>';
    }
}

/* ============================================================================
   AD MANAGER
   The homepage feature strip is stored in site_settings under the key
   'feature_strip', so editing an ad is a save here — no deploy, no code change.
   ========================================================================== */

const AD_SETTINGS_KEY = 'feature_strip';
const AD_MAX_SLOTS = 6;

/** Working copy of the placements while the editor is open. */
let adSlots = [];

function blankAdSlot() {
    return { active: true, sponsored: true, headline: '', blurb: '', cta: '', url: '', partner: '' };
}

/** Shipped defaults, used the first time the Ad Manager is opened. */
function defaultAdSlots() {
    return [{
        active: true, sponsored: true,
        headline: 'How to book a train in Korea?',
        blurb: 'KTX seats sell out on weekends and holidays. Reserve before you fly.',
        cta: 'Check KTX passes', url: 'https://www.klook.com/', partner: 'Klook',
    }];
}

async function loadAdSlots() {
    const status = document.getElementById('ad-save-status');
    try {
        const { data, error } = await supabase
            .from('site_settings')
            .select('value')
            .eq('key', AD_SETTINGS_KEY)
            .single();
        if (error && error.code !== 'PGRST116') throw error;

        const stored = data?.value?.slots;
        adSlots = Array.isArray(stored) && stored.length ? stored.map(s => ({ ...blankAdSlot(), ...s }))
                                                         : defaultAdSlots();
        if (status) status.innerHTML = '';
    } catch (e) {
        console.error('[Ads] load failed:', e);
        adSlots = defaultAdSlots();
        if (status) status.innerHTML = `<span style="color:var(--danger);">Could not load saved ads (${e.message}). Showing defaults.</span>`;
    }
    renderAdRows();
}

function renderAdRows() {
    const list = document.getElementById('ad-list');
    if (!list) return;

    // A validation message about row #3 is misleading once row #3 is gone.
    const status = document.getElementById('ad-save-status');
    if (status && status.dataset.sticky !== '1') status.innerHTML = '';

    if (adSlots.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:14px 0;">No placements yet. The strip is hidden on the homepage until you add one.</p>';
        updateAdPreview();
        return;
    }

    list.innerHTML = adSlots.map((s, i) => `
        <div class="ad-row" data-i="${i}" style="border:1px solid var(--border);border-radius:8px;padding:14px;margin:10px 0;${s.active ? '' : 'opacity:.55;'}">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                <strong style="font-size:12px;color:var(--text-muted);">#${i + 1}</strong>
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
                    <input type="checkbox" class="ad-active" ${s.active ? 'checked' : ''}> Active
                </label>
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
                    <input type="checkbox" class="ad-sponsored" ${s.sponsored ? 'checked' : ''}> Paid / sponsored
                </label>
                <span style="flex:1;"></span>
                <button class="btn btn-outline btn-sm ad-up"   ${i === 0 ? 'disabled' : ''} title="Move up"><i class="ph ph-arrow-up"></i></button>
                <button class="btn btn-outline btn-sm ad-down" ${i === adSlots.length - 1 ? 'disabled' : ''} title="Move down"><i class="ph ph-arrow-down"></i></button>
                <button class="btn btn-outline btn-sm ad-del" style="color:var(--danger);border-color:var(--danger);" title="Delete"><i class="ph ph-trash"></i></button>
            </div>
            <div class="grid-2" style="gap:10px;">
                <div class="form-group" style="margin:0;">
                    <label class="form-label">Headline</label>
                    <input class="form-input ad-headline" maxlength="60" value="${escHtml(s.headline)}" placeholder="How to book a train in Korea?">
                </div>
                <div class="form-group" style="margin:0;">
                    <label class="form-label">Button label</label>
                    <input class="form-input ad-cta" maxlength="28" value="${escHtml(s.cta)}" placeholder="Check KTX passes">
                </div>
            </div>
            <div class="form-group" style="margin:10px 0 0;">
                <label class="form-label">Supporting line</label>
                <input class="form-input ad-blurb" maxlength="110" value="${escHtml(s.blurb)}" placeholder="KTX seats sell out on weekends. Reserve before you fly.">
            </div>
            <div class="grid-2" style="gap:10px;margin-top:10px;">
                <div class="form-group" style="margin:0;">
                    <label class="form-label">Link URL</label>
                    <input class="form-input ad-url" value="${escHtml(s.url)}" placeholder="https://...">
                </div>
                <div class="form-group" style="margin:0;">
                    <label class="form-label">Partner name (optional)</label>
                    <input class="form-input ad-partner" maxlength="24" value="${escHtml(s.partner)}" placeholder="Klook">
                </div>
            </div>
        </div>
    `).join('');

    updateAdPreview();
}

/** Pull the current field values back into adSlots. */
function syncAdSlotsFromDOM() {
    document.querySelectorAll('.ad-row').forEach(row => {
        const i = Number(row.dataset.i);
        if (!adSlots[i]) return;
        adSlots[i] = {
            active:    row.querySelector('.ad-active').checked,
            sponsored: row.querySelector('.ad-sponsored').checked,
            headline:  row.querySelector('.ad-headline').value.trim(),
            blurb:     row.querySelector('.ad-blurb').value.trim(),
            cta:       row.querySelector('.ad-cta').value.trim(),
            url:       row.querySelector('.ad-url').value.trim(),
            partner:   row.querySelector('.ad-partner').value.trim(),
        };
    });
}

function updateAdPreview() {
    const box = document.getElementById('ad-preview');
    if (!box) return;

    const live = adSlots.filter(s => s.active && s.headline && s.url);
    if (live.length === 0) {
        box.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Nothing to show &mdash; the strip will be hidden on the homepage.</p>';
        return;
    }

    box.innerHTML = live.map(s => `
        <div style="background:#f6f6ef;color:#14140f;border-radius:14px;padding:18px 22px;margin-bottom:10px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
            <div style="flex:1;min-width:200px;">
                ${s.sponsored ? '<span style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6c6c60;border:1px solid #cfcfc2;border-radius:4px;padding:2px 7px;margin-bottom:6px;">Sponsored</span>' : ''}
                <div style="font-size:20px;font-weight:800;">${escHtml(s.headline)}</div>
                ${s.blurb ? `<div style="font-size:13px;color:#4a4a40;margin-top:4px;">${escHtml(s.blurb)}</div>` : ''}
            </div>
            <div style="text-align:center;">
                <span style="display:inline-block;background:#14140f;color:#f6f6ef;padding:12px 22px;border-radius:8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${escHtml(s.cta || 'Learn more')} &rarr;</span>
                ${s.partner ? `<div style="font-size:11px;color:#6c6c60;margin-top:5px;">via ${escHtml(s.partner)}</div>` : ''}
            </div>
        </div>
    `).join('');
}

async function saveAdSlots() {
    syncAdSlotsFromDOM();

    const status = document.getElementById('ad-save-status');
    const btn = document.getElementById('btn-ad-save');

    // Only complete rows are worth publishing.
    const bad = adSlots.findIndex(s => s.active && (!s.headline || !s.url));
    if (bad !== -1) {
        status.innerHTML = `<span style="color:var(--danger);">Placement #${bad + 1} needs a headline and a link before it can go live.</span>`;
        return;
    }
    const badUrl = adSlots.findIndex(s => s.url && !/^https?:\/\//i.test(s.url));
    if (badUrl !== -1) {
        status.innerHTML = `<span style="color:var(--danger);">Placement #${badUrl + 1}: the link must start with http:// or https://</span>`;
        return;
    }

    btn.disabled = true;
    status.innerHTML = '<span style="color:var(--text-muted);">Saving...</span>';

    try {
        const payload = { slots: adSlots };
        const { data: existing } = await supabase
            .from('site_settings').select('id').eq('key', AD_SETTINGS_KEY).single();

        if (existing) {
            const { error } = await supabase.from('site_settings')
                .update({ value: payload, updated_at: new Date().toISOString() })
                .eq('key', AD_SETTINGS_KEY);
            if (error) throw error;
        } else {
            const { error } = await supabase.from('site_settings')
                .insert({ key: AD_SETTINGS_KEY, value: payload });
            if (error) throw error;
        }

        const liveCount = adSlots.filter(s => s.active && s.headline && s.url).length;
        status.dataset.sticky = '1';
        status.innerHTML = `<span style="color:var(--success);"><i class="ph ph-check-circle"></i> Published &mdash; ${liveCount} placement${liveCount === 1 ? '' : 's'} live on the homepage.</span>`;
        setTimeout(() => { status.innerHTML = ''; status.dataset.sticky = '0'; }, 5000);
    } catch (e) {
        console.error('[Ads] save failed:', e);
        status.innerHTML = `<span style="color:var(--danger);"><i class="ph ph-warning-circle"></i> ${e.message}</span>`;
    }
    btn.disabled = false;
}

function initAdManager() {
    const list = document.getElementById('ad-list');
    if (!list) return;

    document.getElementById('btn-ad-add').addEventListener('click', () => {
        syncAdSlotsFromDOM();
        if (adSlots.length >= AD_MAX_SLOTS) {
            document.getElementById('ad-save-status').innerHTML =
                `<span style="color:var(--danger);">${AD_MAX_SLOTS} placements is the maximum &mdash; more than that and nobody sees the last ones.</span>`;
            return;
        }
        adSlots.push(blankAdSlot());
        renderAdRows();
    });

    document.getElementById('btn-ad-save').addEventListener('click', saveAdSlots);
    document.getElementById('btn-ad-reload').addEventListener('click', loadAdSlots);

    // Row buttons
    list.addEventListener('click', (e) => {
        const row = e.target.closest('.ad-row');
        if (!row) return;
        const i = Number(row.dataset.i);

        if (e.target.closest('.ad-del')) {
            syncAdSlotsFromDOM();
            adSlots.splice(i, 1);
            renderAdRows();
        } else if (e.target.closest('.ad-up') && i > 0) {
            syncAdSlotsFromDOM();
            [adSlots[i - 1], adSlots[i]] = [adSlots[i], adSlots[i - 1]];
            renderAdRows();
        } else if (e.target.closest('.ad-down') && i < adSlots.length - 1) {
            syncAdSlotsFromDOM();
            [adSlots[i], adSlots[i + 1]] = [adSlots[i + 1], adSlots[i]];
            renderAdRows();
        }
    });

    // Live preview as you type.
    list.addEventListener('input', () => { syncAdSlotsFromDOM(); updateAdPreview(); });

    // Only the checkboxes change how a row looks, so only they redraw the list —
    // redrawing on a text field's change event would yank focus while editing.
    list.addEventListener('change', (e) => {
        syncAdSlotsFromDOM();
        if (e.target.matches('.ad-active, .ad-sponsored')) renderAdRows();
        else updateAdPreview();
    });
}

// --- SITE SETTINGS: HERO ---
async function loadHeroSettings() {
    try {
        const { data, error } = await supabase
            .from('site_settings')
            .select('value')
            .eq('key', 'hero')
            .single();
        if (error && error.code !== 'PGRST116') throw error;
        const hero = data?.value || {};
        document.getElementById('hero-label').value = hero.label || '';
        document.getElementById('hero-title-before').value = hero.title_before || '';
        document.getElementById('hero-title-highlight').value = hero.title_highlight || '';
        document.getElementById('hero-title-after').value = hero.title_after || '';
        document.getElementById('hero-description').value = hero.description || '';
        document.getElementById('hero-bg-image').value = hero.bg_image || '';
        document.getElementById('hero-cta1-text').value = hero.cta_primary_text || '';
        document.getElementById('hero-cta1-url').value = hero.cta_primary_url || '';
        document.getElementById('hero-cta2-text').value = hero.cta_secondary_text || '';
        document.getElementById('hero-cta2-url').value = hero.cta_secondary_url || '';
        updateHeroPreview();
    } catch (e) {
        console.error('[Site Settings] Failed to load hero:', e);
    }
}

function updateHeroPreview() {
    const bgUrl = document.getElementById('hero-bg-image').value;
    const label = document.getElementById('hero-label').value;
    const before = document.getElementById('hero-title-before').value;
    const highlight = document.getElementById('hero-title-highlight').value;
    const after = document.getElementById('hero-title-after').value;

    const img = document.getElementById('hero-preview-img');
    if (img) img.src = bgUrl || '';

    const labelEl = document.getElementById('hero-preview-label');
    if (labelEl) labelEl.textContent = label;

    const titleEl = document.getElementById('hero-preview-title');
    if (titleEl) titleEl.innerHTML = `${escHtml(before)} <span class="hl">${escHtml(highlight)}</span>${escHtml(after)}`;
}

function escHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function saveHeroSettings() {
    const statusEl = document.getElementById('hero-save-status');
    const btn = document.getElementById('btn-save-hero');
    btn.disabled = true;
    statusEl.innerHTML = '<span style="color:var(--text-muted);">Saving...</span>';

    const heroData = {
        label: document.getElementById('hero-label').value.trim(),
        title_before: document.getElementById('hero-title-before').value.trim(),
        title_highlight: document.getElementById('hero-title-highlight').value.trim(),
        title_after: document.getElementById('hero-title-after').value.trim(),
        description: document.getElementById('hero-description').value.trim(),
        bg_image: document.getElementById('hero-bg-image').value.trim(),
        cta_primary_text: document.getElementById('hero-cta1-text').value.trim(),
        cta_primary_url: document.getElementById('hero-cta1-url').value.trim(),
        cta_secondary_text: document.getElementById('hero-cta2-text').value.trim(),
        cta_secondary_url: document.getElementById('hero-cta2-url').value.trim(),
    };

    try {
        // Upsert: try update first, then insert
        const { data: existing } = await supabase
            .from('site_settings')
            .select('id')
            .eq('key', 'hero')
            .single();

        if (existing) {
            const { error } = await supabase
                .from('site_settings')
                .update({ value: heroData, updated_at: new Date().toISOString() })
                .eq('key', 'hero');
            if (error) throw error;
        } else {
            const { error } = await supabase
                .from('site_settings')
                .insert({ key: 'hero', value: heroData });
            if (error) throw error;
        }

        statusEl.innerHTML = '<span style="color:var(--success);"><i class="ph ph-check-circle"></i> Saved successfully!</span>';
        setTimeout(() => { statusEl.innerHTML = ''; }, 3000);
    } catch (e) {
        console.error('[Site Settings] Save failed:', e);
        statusEl.innerHTML = `<span style="color:var(--danger);"><i class="ph ph-warning-circle"></i> Error: ${e.message}</span>`;
    }
    btn.disabled = false;
}

async function searchHeroImages() {
    const query = document.getElementById('hero-img-query').value.trim();
    if (!query) return;

    const container = document.getElementById('hero-img-results');
    container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:16px;">Searching...</div>';

    try {
        const resp = await fetch(`/image-proxy?source=unsplash&query=${encodeURIComponent(query)}&count=8&orientation=landscape`);
        const data = await resp.json();
        if (!data.images || data.images.length === 0) {
            container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:16px;">No images found</div>';
            return;
        }
        container.innerHTML = data.images.map(img => `
            <div class="image-grid-item" data-url="${img.url}">
                <img src="${img.thumb}" alt="${img.alt || query}" loading="lazy">
            </div>
        `).join('');

        // Click to select
        container.querySelectorAll('.image-grid-item').forEach(item => {
            item.addEventListener('click', () => {
                const url = item.dataset.url;
                document.getElementById('hero-bg-image').value = url;
                updateHeroPreview();
                container.innerHTML = '';
            });
        });
    } catch (e) {
        container.innerHTML = `<div style="color:var(--danger); padding:16px;">${e.message}</div>`;
    }
}

// --- MODALS ---
const closeModal = (id) => document.getElementById(id).style.display = 'none';


// --- PERSONA MANAGEMENT ---
async function loadPersonas() {
    const list = document.getElementById('persona-list');
    list.innerHTML = 'Loading...';
    try {
        const { data, error } = await supabase.from('personas').select('*');
        if (error) throw error;

        availablePersonas = data || [];
        list.innerHTML = '';
        availablePersonas.forEach(p => {
            list.innerHTML += `
                <div class="persona-card">
                    <div style="display:flex; align-items:center;">
                        <div class="persona-avatar">${p.name[0]}</div>
                        <div class="persona-details">
                            <div class="persona-name">${p.name} (${p.age})</div>
                            <div class="persona-role">${p.nationality} • ${p.job}</div>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn btn-outline" data-action="edit" data-id="${p.id}" style="padding: 4px 8px; font-size:12px;"><i class="ph ph-pencil"></i></button>
                        <button class="btn btn-outline" data-action="delete" data-id="${p.id}" style="color:var(--danger); border-color:var(--danger); padding: 4px 8px; font-size:12px;"><i class="ph ph-trash"></i></button>
                    </div>
                </div>
            `;
        });
        if (availablePersonas.length === 0) list.innerHTML = '<div style="color:var(--text-muted); padding:10px;">No personas created yet.</div>';
        refreshPersonaSelect();
        refreshAutoPersonaSelect();
    } catch (e) {
        console.error(e);
        list.innerHTML = 'Failed to load personas.';
    }
}

const editPersona = (id) => {
    const p = availablePersonas.find(item => item.id === id);
    if (!p) return;

    editingPersonaId = id;
    document.getElementById('p-name').value = p.name;
    document.getElementById('p-age').value = p.age;
    document.getElementById('p-gender').value = p.gender;
    document.getElementById('p-nationality').value = p.nationality;
    document.getElementById('p-job').value = p.job;
    document.getElementById('p-likes').value = p.likes;
    document.getElementById('p-bio').value = p.bio;

    document.getElementById('persona-form-title').innerText = "Edit Persona";
    document.getElementById('btn-save-persona').innerText = "Update Persona";
    document.getElementById('btn-cancel-persona').style.display = 'block';

    document.getElementById('persona-form-title').scrollIntoView({ behavior: "smooth" });
};

const resetPersonaForm = () => {
    editingPersonaId = null;
    document.getElementById('p-name').value = '';
    document.getElementById('p-likes').value = '';
    document.getElementById('p-bio').value = '';
    document.getElementById('persona-form-title').innerText = "Create New Persona";
    document.getElementById('btn-save-persona').innerText = "Add Persona";
    document.getElementById('btn-cancel-persona').style.display = 'none';
};

function generateRandomPersona() {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];

    // --- First Names by region/gender ---
    const firstNames = {
        western_f: ["Emma", "Olivia", "Sophia", "Ava", "Isabella", "Mia", "Charlotte", "Harper", "Amelia", "Ella", "Chloe", "Grace", "Lily", "Zoe", "Hannah", "Natalie", "Victoria", "Audrey", "Claire", "Scarlett", "Lucy", "Nora", "Stella", "Violet", "Ruby"],
        western_m: ["Liam", "Noah", "James", "William", "Oliver", "Benjamin", "Lucas", "Henry", "Alexander", "Daniel", "Matthew", "Sebastian", "Jack", "Owen", "Ethan", "Ryan", "Nathan", "Dylan", "Samuel", "Caleb", "Leo", "Max", "Theo", "Miles", "Finn"],
        korean_f: ["Jiyeon", "Minji", "Soojin", "Yuna", "Haeun", "Soyeon", "Dahyun", "Eunbi", "Chaeyoung", "Nayeon", "Seulgi", "Jisoo", "Yeji", "Hyejin", "Subin"],
        korean_m: ["Minjun", "Jiwoo", "Seohan", "Hyunwoo", "Taeyang", "Dongwook", "Junhyuk", "Siwon", "Jaehyun", "Seojun", "Doyoon", "Yoonho", "Jihoon", "Wonjin", "Hajun"],
        japanese_f: ["Yuki", "Sakura", "Hana", "Aoi", "Mei", "Rin", "Mio", "Saki", "Nanami", "Koharu"],
        japanese_m: ["Haruto", "Ren", "Sota", "Yuto", "Kaito", "Riku", "Hinata", "Takumi", "Kenta", "Daichi"],
        chinese_f: ["Mei Lin", "Xiao Wei", "Li Na", "Jing Yi", "Xin Yue", "Yan Yan", "Zi Han", "Yu Xin", "Shu Qi", "Wen Xin"],
        chinese_m: ["Wei", "Jun", "Hao", "Zhi Yuan", "Yi Fan", "Tian Yu", "Chen Xi", "Ming Hao", "Zi Xuan", "Bo Wen"],
        southeast_asian_f: ["Priya", "Ananya", "Nurul", "Putri", "Mai", "Thao", "Arisa", "Kamala", "Siti", "Nadia"],
        southeast_asian_m: ["Arjun", "Raj", "Ahmad", "Rizky", "Duc", "Minh", "Kiran", "Ravi", "Budi", "Tariq"],
        european_f: ["Léa", "Camille", "Lena", "Freya", "Elsa", "Chiara", "Marta", "Ingrid", "Katya", "Petra", "Amelie", "Bianca", "Sofie", "Astrid", "Elena"],
        european_m: ["Hugo", "Louis", "Matteo", "Lars", "Erik", "Marco", "Pablo", "Andrei", "Niklas", "Felix", "Anton", "Luca", "Sven", "Pierre", "Dmitri"],
        latin_f: ["Valentina", "Camila", "Luciana", "Gabriela", "Mariana", "Fernanda", "Daniela", "Renata", "Isabela", "Paloma"],
        latin_m: ["Santiago", "Mateo", "Diego", "Alejandro", "Carlos", "Miguel", "Rafael", "Andrés", "Gabriel", "Felipe"],
        african_f: ["Amara", "Zara", "Nia", "Aisha", "Fatima", "Kemi", "Thandiwe", "Amina", "Chioma", "Naledi"],
        african_m: ["Kwame", "Emeka", "Tariq", "Jabari", "Kofi", "Chidi", "Oluwaseun", "Tendai", "Amadi", "Sekou"]
    };

    // --- Last Names by region ---
    const lastNames = {
        western: ["Smith", "Johnson", "Williams", "Brown", "Jones", "Davis", "Miller", "Wilson", "Moore", "Taylor", "Anderson", "Clark", "Harris", "Lewis", "Walker", "Hall", "Allen", "Young", "King", "Wright"],
        korean: ["Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Yoon", "Jang", "Lim", "Han", "Oh", "Seo", "Shin", "Kwon", "Hwang", "Song", "Ahn", "Ryu", "Bae", "Moon"],
        japanese: ["Tanaka", "Suzuki", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Sato", "Kato", "Yoshida"],
        chinese: ["Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Wu", "Zhou", "Xu"],
        european: ["Müller", "Schmidt", "Dubois", "Martin", "García", "Rossi", "Silva", "Andersen", "Johansson", "Petrov", "Larsson", "Bernard", "Meyer", "Moreau", "Ferreira"],
        latin: ["García", "Rodríguez", "Martínez", "López", "Hernández", "González", "Pérez", "Sánchez", "Ramírez", "Torres"],
        southeast_asian: ["Patel", "Sharma", "Nguyen", "Tran", "Pham", "Rahman", "Singh", "Tan", "Wong", "Das"],
        african: ["Okafor", "Mensah", "Adeyemi", "Nkosi", "Diallo", "Osei", "Kamara", "Mwangi", "Abara", "Dlamini"]
    };

    // --- Jobs (expanded) ---
    const jobs = [
        "Travel Blogger", "K-Beauty Editor", "Food Critic", "K-Pop Journalist", "Digital Nomad",
        "Expat Living in Seoul", "Culture Columnist", "Lifestyle Vlogger", "Skincare Researcher",
        "Korean Food Recipe Developer", "K-Drama Reviewer", "Language Learning Coach",
        "Photography Enthusiast", "Fashion & Style Writer", "Hallyu Culture Analyst",
        "Freelance Journalist", "Study Abroad Student", "ESL Teacher in Korea",
        "Seoul City Guide", "Wellness & Health Writer", "K-Pop Fan Community Leader",
        "Travel Photographer", "Street Food Explorer", "Cultural Anthropologist",
        "Korean History Researcher", "Sustainable Travel Advocate"
    ];

    // --- Countries (expanded) ---
    const countries = [
        "USA", "UK", "Canada", "Australia", "France", "Germany", "Singapore", "Japan",
        "South Korea", "Philippines", "Indonesia", "India", "Vietnam", "Thailand", "Malaysia",
        "Brazil", "Mexico", "Colombia", "Spain", "Italy", "Netherlands", "Sweden", "Norway",
        "Nigeria", "South Africa", "Kenya", "Ghana", "New Zealand", "Ireland", "Portugal",
        "Poland", "Turkey", "UAE", "Saudi Arabia", "Argentina", "Chile", "Taiwan", "Hong Kong"
    ];

    // --- Likes (expanded) ---
    const likesList = [
        "Spicy tteokbokki", "Hidden cafes in Hongdae", "Indie Korean music", "Skincare routines",
        "Korean history", "Street food markets", "K-Drama binge watching", "Soju tastings",
        "Temple stays", "Korean BBQ", "Jeju Island hikes", "Hanbok fashion", "Night markets",
        "Korean pottery and ceramics", "Bukchon Hanok Village walks", "Seoul subway exploration",
        "Korean language learning", "Vintage shopping in Itaewon", "PC bang culture",
        "Makgeolli brewing", "Cherry blossom season", "Korean fried chicken", "Jimjilbang spa days",
        "K-Pop album collecting", "Traditional tea ceremonies", "Busan beach culture",
        "Korean calligraphy", "Seoul rooftop bars", "Korean cooking classes"
    ];

    // --- Ages ---
    const ages = ["20", "22", "24", "25", "27", "28", "30", "32", "33", "35", "38", "40", "42", "45", "50", "55"];
    const genders = ["Female", "Male", "Non-binary"];

    // Pick a random region group
    const regionGroups = [
        { first_f: 'western_f', first_m: 'western_m', last: 'western' },
        { first_f: 'korean_f', first_m: 'korean_m', last: 'korean' },
        { first_f: 'japanese_f', first_m: 'japanese_m', last: 'japanese' },
        { first_f: 'chinese_f', first_m: 'chinese_m', last: 'chinese' },
        { first_f: 'european_f', first_m: 'european_m', last: 'european' },
        { first_f: 'latin_f', first_m: 'latin_m', last: 'latin' },
        { first_f: 'southeast_asian_f', first_m: 'southeast_asian_m', last: 'southeast_asian' },
        { first_f: 'african_f', first_m: 'african_m', last: 'african' }
    ];

    const region = pick(regionGroups);
    const gender = pick(genders);
    const isFemale = gender === 'Female';
    const firstKey = isFemale ? region.first_f : (gender === 'Male' ? region.first_m : pick([region.first_f, region.first_m]));
    const firstName = pick(firstNames[firstKey]);
    const lastName = pick(lastNames[region.last]);
    const rName = `${firstName} ${lastName}`;
    const rJob = pick(jobs);
    const rCountry = pick(countries);
    const rAge = pick(ages);
    const rLikes = pick(likesList);

    document.getElementById('p-name').value = rName;
    document.getElementById('p-job').value = rJob;
    document.getElementById('p-nationality').value = rCountry;
    document.getElementById('p-likes').value = rLikes;
    document.getElementById('p-age').value = rAge;
    document.getElementById('p-gender').value = gender;

    const bio = `Hi, I'm ${rName}! I'm a ${rAge}-year-old ${rJob} from ${rCountry} currently exploring every corner of Korea. I'm obsessed with ${rLikes} and love sharing my honest experiences. Follow along for my local tips!`;
    document.getElementById('p-bio').value = bio;
}

async function saveOrUpdatePersona() {
    const name = document.getElementById('p-name').value;
    const age = document.getElementById('p-age').value;
    const gender = document.getElementById('p-gender').value;
    const nationality = document.getElementById('p-nationality').value;
    const job = document.getElementById('p-job').value;
    const likes = document.getElementById('p-likes').value;
    const bio = document.getElementById('p-bio').value;

    if (!name || !job) return alert('Name and Job are required');

    const personaData = { name, age, gender, nationality, job, likes, bio };

    if (editingPersonaId) {
        const { error } = await supabase.from('personas').update(personaData).eq('id', editingPersonaId);
        if (error) return alert('Error: ' + error.message);
        alert('Persona Updated!');
    } else {
        const { error } = await supabase.from('personas').insert(personaData);
        if (error) return alert('Error: ' + error.message);
        alert('Persona Created!');
    }

    resetPersonaForm();
    loadPersonas();
}

const deletePersona = async (id) => {
    if (confirm('Are you sure you want to delete this persona?')) {
        await supabase.from('personas').delete().eq('id', id);
        loadPersonas();
    }
};

function refreshPersonaSelect() {
    const sel = document.getElementById('ai-persona-select');
    const currentVal = sel.value;
    sel.innerHTML = '<option value="default">Default AI (Generic)</option>';
    availablePersonas.forEach(p => {
        sel.innerHTML += `<option value="${p.id}">${p.name} - ${p.job} (${p.nationality})</option>`;
    });
    if (currentVal) sel.value = currentVal;
}


// --- DASHBOARD ANALYTICS ---
const SOURCE_COLORS = ['var(--accent)', '#E1306C', '#f59e0b', '#10b981', '#8b5cf6', 'var(--text-muted)'];

async function loadDashboard() {
    // 1. Supabase stats (posts count, scheduled)
    const { data: posts, error } = await supabase.from('posts').select('title, views, status');
    if (error) { console.error(error); return; }

    let scheduled = 0;
    (posts || []).forEach(d => { if (d.status === 'scheduled') scheduled++; });

    document.getElementById('stat-posts').innerText = (posts || []).length;
    document.getElementById('stat-scheduled').innerText = scheduled;

    // 2. Fetch real GA4 data
    try {
        const gaRes = await fetch('/ga-proxy', { method: 'POST' });
        if (!gaRes.ok) throw new Error('GA proxy returned ' + gaRes.status);
        const ga = await gaRes.json();
        if (ga.error) throw new Error(ga.error);

        // Overview stats
        document.getElementById('stat-views').innerText = (ga.pageViews || 0).toLocaleString();
        document.getElementById('stat-users').innerText = (ga.totalUsers || 0).toLocaleString();

        // Traffic sources
        renderTrafficSources(ga.sources || []);

        // Top pages
        renderTopPages(ga.topPages || []);

        // Daily trend chart
        renderDailyTrend(ga.dailyTrend || []);

    } catch (e) {
        console.warn("GA4 Fetch Failed:", e);
        // Fallback to Supabase views
        let totalViews = 0;
        (posts || []).forEach(d => { totalViews += (d.views || 0); });
        document.getElementById('stat-views').innerText = totalViews.toLocaleString();
        document.getElementById('stat-users').innerText = '-';
        document.getElementById('traffic-sources-container').innerHTML = '<div style="color:var(--text-muted); padding:10px;">GA4 연결 실패 - Supabase 조회수 표시 중</div>';

        // Fallback top posts from Supabase
        const postList = (posts || []).map(d => ({ title: d.title, views: d.views || 0 }));
        postList.sort((a, b) => b.views - a.views);
        const tbody = document.querySelector('#dashboard-top-posts tbody');
        tbody.innerHTML = '';
        postList.slice(0, 10).forEach(p => {
            tbody.innerHTML += `<tr><td>${p.title}</td><td style="text-align:right; font-weight:bold;">${p.views.toLocaleString()}</td></tr>`;
        });
    }
}

function renderTrafficSources(sources) {
    const container = document.getElementById('traffic-sources-container');
    if (!sources.length) {
        container.innerHTML = '<div style="color:var(--text-muted); padding:10px;">No traffic data yet</div>';
        return;
    }
    container.innerHTML = '';
    sources.forEach((s, i) => {
        const color = SOURCE_COLORS[i % SOURCE_COLORS.length];
        container.innerHTML += `
            <div class="stat-row"><span>${s.name}</span> <span>${s.percent}% (${s.sessions.toLocaleString()})</span></div>
            <div class="stat-bar"><div class="stat-bar-fill" style="width: ${s.percent}%; background-color: ${color};"></div></div>
        `;
    });
}

function renderTopPages(pages) {
    const tbody = document.querySelector('#dashboard-top-posts tbody');
    tbody.innerHTML = '';
    if (!pages.length) {
        tbody.innerHTML = '<tr><td colspan="2" style="color:var(--text-muted);">No page data yet</td></tr>';
        return;
    }
    pages.forEach(p => {
        const displayPath = p.path === '/' ? 'Homepage' : decodeURIComponent(p.path);
        tbody.innerHTML += `<tr><td style="max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${displayPath}</td><td style="text-align:right; font-weight:bold;">${p.views.toLocaleString()}</td></tr>`;
    });
}

function renderDailyTrend(trend) {
    const chart = document.getElementById('daily-trend-chart');
    const labels = document.getElementById('daily-trend-labels');
    if (!trend.length) {
        chart.innerHTML = '<div style="color:var(--text-muted);">No trend data</div>';
        return;
    }
    const maxViews = Math.max(...trend.map(d => d.views), 1);
    chart.innerHTML = '';
    labels.innerHTML = '';
    trend.forEach(d => {
        const height = Math.max((d.views / maxViews) * 100, 4);
        const dateStr = d.date.substring(4, 6) + '/' + d.date.substring(6, 8);
        chart.innerHTML += `
            <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:4px;">
                <span style="font-size:11px; color:var(--text-muted);">${d.views}</span>
                <div style="width:100%; height:${height}px; background:var(--accent); border-radius:4px 4px 0 0; min-height:4px;" title="${d.views} views, ${d.users} users"></div>
            </div>
        `;
        labels.innerHTML += `<div style="flex:1; text-align:center;">${dateStr}</div>`;
    });
}

async function removeDuplicates() {
    if (!confirm("This will delete duplicate posts (keeping oldest). Continue?")) return;
    const btn = document.getElementById('btn-remove-duplicates');
    btn.innerText = "Processing...";
    btn.disabled = true;
    try {
        const { data, error } = await supabase.from('posts').select('id, title, created_at').order('created_at', { ascending: true });
        if (error) throw error;

        const seen = new Set();
        let count = 0;
        for (const d of (data || [])) {
            if (seen.has(d.title)) {
                await supabase.from('posts').delete().eq('id', d.id);
                count++;
            } else {
                seen.add(d.title);
            }
        }
        alert(`Deleted ${count} duplicates.`);
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.innerText = "Remove Duplicate Posts";
        btn.disabled = false;
    }
}

window.editPost = async (id) => {
    editingPostId = id;
    switchView('ai-writer');
    document.getElementById('writer-heading').innerText = "Edit Post";
    document.getElementById('btn-save-post').innerHTML = '<i class="ph ph-floppy-disk"></i> Update';

    // Reset HTML mode if active
    if (isHtmlMode) {
        toggleHtmlSource();
    }

    const { data: p, error } = await supabase.from('posts').select('*').eq('id', id).single();
    if (error || !p) return;

    document.getElementById('ai-suggested-title').value = p.title;
    // Legacy posts still carry old labels (K-Food, Travel...) — map them onto Book/Plan/Shop/Eat
    document.getElementById('ai-category').value = normalizeCategory(p.category);

    // Load slug field
    const slugInput = document.getElementById('ai-slug');
    if (slugInput) {
        slugInput.value = p.slug || generateSlug(p.title);
    }

    // Clear editor before loading new content
    quill.setContents([]);

    // Pre-process affiliate blocks before loading into Quill
    const editorContent = processContentForEdit(p.content || '');
    quill.clipboard.dangerouslyPasteHTML(editorContent);
    activeImage = p.image;
    if (activeImage) {
        document.getElementById('selected-ai-img').src = activeImage;
        document.getElementById('selected-ai-img').style.display = 'block';
        document.getElementById('ai-img-placeholder').style.display = 'none';
    }
    document.getElementById('step-1').classList.remove('active');
    document.getElementById('step-2').style.opacity = '1';
    document.getElementById('step-2').style.pointerEvents = 'auto';
    document.getElementById('step-2').classList.remove('active');
    document.getElementById('step-3').style.opacity = '1';
    document.getElementById('step-3').style.pointerEvents = 'auto';
    document.getElementById('step-3').classList.add('active');
};

window.resetAI = () => {
    editingPostId = null;
    affiliateCodes = {}; // Clear affiliate codes
    document.getElementById('writer-heading').innerText = "AI Content Creator";
    document.getElementById('btn-save-post').innerHTML = '<i class="ph ph-paper-plane-right"></i> Publish';

    // Reset HTML mode if active
    if (isHtmlMode) {
        toggleHtmlSource();
    }

    document.getElementById('step-1').classList.add('active');
    document.getElementById('step-2').style.opacity = '0.5';
    document.getElementById('step-2').style.pointerEvents = 'none';
    document.getElementById('step-2').classList.remove('active');
    document.getElementById('step-3').style.opacity = '0.5';
    document.getElementById('step-3').style.pointerEvents = 'none';
    document.getElementById('step-3').classList.remove('active');
    document.getElementById('ai-topic').value = '';
    document.getElementById('ai-suggested-title').value = '';
    document.getElementById('ai-slug').value = '';
    document.getElementById('ai-img-query').value = '';
    document.getElementById('ai-category').selectedIndex = 0;
    document.getElementById('post-schedule').value = '';

    // Clear reference sources and affiliate slots
    aiSources = [];
    document.getElementById('ai-source-urls').value = '';
    document.getElementById('source-list').innerHTML = '';
    document.getElementById('source-status').textContent = '';
    document.querySelectorAll('.aff-slot-url, .aff-slot-desc').forEach(el => { el.value = ''; });
    document.getElementById('ai-keywords-container').innerHTML = '';
    const titleOptions = document.getElementById('ai-title-options-container');
    if (titleOptions) titleOptions.innerHTML = '';
    quill.setText('');
    activeImage = '';
    imgSearchPage = 1;
    document.getElementById('selected-ai-img').style.display = 'none';
    document.getElementById('ai-img-placeholder').style.display = 'block';
};

window.runAIPhase1 = async () => {
    const topic = document.getElementById('ai-topic').value;
    if (!topic) return alert('Please enter a topic');

    const btn = document.querySelector('#step-1 .btn-ai');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-spinner spinner"></i> Brainstorming SEO Plan...';
    btn.disabled = true;

    try {
        const sourceBlock = buildSourceBlock(2500);

        const prompt = `
You are the editor of 'Korea Decode', a practical English-language guide to Korea written from Seoul.

Topic: "${topic}"

${MISS_PARK_VOICE}
${sourceBlock}
Produce an SEO plan for a practical guide on this topic.${aiSources.length ? `

Base the titles and keywords on what the SOURCE MATERIAL above actually covers — the real
place names, the real options, the angle the sources support. Do not promise anything the
sources cannot back up.` : ''}

**TITLE RULES:**
- Titles describe what the reader will be able to DO or DECIDE after reading. Search-intent first.
- Preferred shapes: "How to ...", "... : What It Costs and How to Book", "Is ... Worth It?",
  "Where to ... in Seoul (and What to Skip)", "... Guide for First-Time Visitors".
- Include the primary keyword naturally. Aim for 50-60 characters.
- NO slang, NO clickbait, NO "hidden gem", "must-visit", "ultimate", "you won't believe",
  "amazing", "epic", "bucket list". NO emoji. NO exclamation marks.
- Do not promise specifics you cannot support (no invented prices in the title).

Return clean JSON only, in exactly this shape:
{
  "suggested_titles": [
    "Practical, search-led title 1",
    "Practical, search-led title 2",
    "Practical, search-led title 3"
  ],
  "seo_keywords": [
    "primary keyword",
    "secondary keyword",
    "long-tail keyword 1",
    "semantic keyword",
    "related topic"
  ]
}
`;

        let rawText = await callAI(prompt, {
            generationConfig: { temperature: 0.4, topP: 0.85 }
        });
        const data = parseAIJSON(rawText);

        document.getElementById('ai-suggested-title').value = data.suggested_titles[0] || `Guide to ${topic}`;

        // Auto-generate slug from the selected title
        document.getElementById('ai-slug').value = generateSlug(data.suggested_titles[0] || topic);

        const kwContainer = document.getElementById('ai-keywords-container');
        kwContainer.innerHTML = '';
        data.seo_keywords.forEach(k => kwContainer.innerHTML += `<span class="suggestion-chip selected">${k}</span>`);

        const titleContainer = document.getElementById('ai-title-options-container') || document.createElement('div');
        if (!titleContainer.id) {
            titleContainer.id = 'ai-title-options-container';
            document.querySelector('#step-2 .form-group').insertAdjacentElement('afterend', titleContainer);
        }
        titleContainer.innerHTML = '<label class="form-label" style="margin-top:15px;">Title Suggestions</label>';
        data.suggested_titles.forEach(title => {
            const chip = document.createElement('span');
            chip.className = 'suggestion-chip';
            chip.innerText = title;
            chip.onclick = () => {
                document.getElementById('ai-suggested-title').value = title;
                document.getElementById('ai-slug').value = generateSlug(title);
                document.querySelectorAll('#ai-title-options-container .suggestion-chip').forEach(c => c.classList.remove('selected'));
                chip.classList.add('selected');
            };
            titleContainer.appendChild(chip);
        });

        document.getElementById('step-1').classList.remove('active');
        document.getElementById('step-2').style.opacity = '1';
        document.getElementById('step-2').style.pointerEvents = 'auto';
        document.getElementById('step-2').classList.add('active');
        document.getElementById('ai-img-query').value = topic + " aesthetic";

    } catch (e) {
        alert("AI Error: " + e.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

window.runAIPhase2 = async () => {
    const title = document.getElementById('ai-suggested-title').value;
    const topic = document.getElementById('ai-topic').value;
    const keywords = Array.from(document.querySelectorAll('#ai-keywords-container .suggestion-chip')).map(el => el.innerText);

    if (!title) return alert('Please generate or select a title first.');

    const btn = document.querySelector('#step-2 .btn-primary');
    btn.innerHTML = '<i class="ph ph-spinner spinner"></i> Writing the guide...';
    btn.disabled = true;

    // Single house byline — no personas.
    const persona = KD_AUTHOR;

    // Images are NOT fetched automatically any more: stock photos were often a poor
    // match for the topic. Use "Insert Image" in step 3 to place your own, and the
    // image picker in step 2 for the featured image.

    // 2. Generate Content with AI
    let content = '';

    const affiliateSlots = readAffiliateSlots();

    try {
        const prompt = `
**Task:** Write a practical guide for 'Korea Decode'.

${MISS_PARK_VOICE}

**Title:** "${title}"
**Core Subject:** "${topic}"
**Target Keywords:** ${keywords.join(', ')}
${buildSourceBlock()}
${KD_STYLE_RULES}
${buildAffiliateSlotBlock(affiliateSlots)}

**ARTICLE FORMAT — PRACTICAL GUIDE, NOT AN ESSAY:**

1. **Opening (2-3 sentences max):** Start with the reader's decision or problem, e.g. "Trying to work
   out whether X is worth booking? Here is what it costs and how it actually works." No self-
   introduction, no scene-setting, no history lesson.

2. **Quick Answer box** immediately after the intro:
   <div class="quick-answer" style="background:#111;border-left:4px solid #cdff00;padding:16px 20px;border-radius:8px;margin:24px 0;">
   <strong style="color:#cdff00;">Quick answer:</strong>
   <p style="color:#ccc;margin:6px 0 0;">[One or two sentences for the reader who will not read the rest]</p>
   </div>

3. **Comparison table:** at least one HTML <table> comparing the real options — price, time needed,
   who it suits, what is included. Keep it to 3-5 rows.

4. **Practical specifics throughout:** prices in KRW with an approximate USD figure, opening hours,
   the nearest subway line/station and exit number, how long things take, what to book ahead and what
   to buy on the day. Where a figure varies, give the range and say what it depends on.

5. **Structure:** 4-6 sections using <h2> (and <h3> where a section needs sub-points). Use
   <ul><li> for checklists, <strong> for the numbers that matter, <blockquote> for a single practical
   tip per section.

6. **Affiliate placements:** see the AFFILIATE PLACEMENTS list above. Drop each "[[AFF:n]]" marker
   on its own line at the right point in the article. If no list was given, do not write any
   booking buttons at all.

7. **NO IMAGES:** do not write any <img>, <figure> or image placeholder of any kind.
   Illustrations are added by the editor afterwards.

8. **Ending:** a short "What to do next" section — the recommended option, the runner-up, and the one
   thing to sort out before arriving. No motivational sign-off.

9. **HTML only.** No <html>, <body>, <h1>, or markdown. Use <p>, <h2>, <h3>, <ul>, <table>, <blockquote>.

**TEST BEFORE YOU FINISH:** every paragraph must help the reader decide or act. If a paragraph does
not answer "what should I do?", "how much is it?", "how do I get there?" or "is it worth it?",
delete it or replace it with a fact.

**Output:** Only the article HTML body. No explanations before or after.`;

        let rawContent = await callAI(prompt, {
            generationConfig: { temperature: 0.55, topP: 0.9 }
        });

        // Clean markdown code blocks from response
        rawContent = rawContent.trim();
        if (rawContent.startsWith('```html')) {
            rawContent = rawContent.replace(/^```html\s*/, '').replace(/\s*```$/, '');
        } else if (rawContent.startsWith('```')) {
            rawContent = rawContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        // Strip any image placeholder the model wrote anyway.
        rawContent = rawContent
            .replace(/<p>\s*\[IMG\]\s*<\/p>/gi, '')
            .replace(/\[IMG\]/gi, '')
            .replace(/\[INSERT_IMAGE_HERE\]/gi, '');

        // House style, then real affiliate links in place of the markers
        rawContent = scrubSlang(rawContent);
        rawContent = affiliateSlots.length > 0
            ? applyAffiliateSlots(rawContent, affiliateSlots)
            : injectAffiliateBanners(rawContent, { min: 2, max: 4, topic });
        content = rawContent;

    } catch (e) {
        alert("AI Error: " + e.message + "\nFalling back to template.");
        content = generateTemplateContent(persona, topic, title, '');
    }

    quill.clipboard.dangerouslyPasteHTML(content);

    document.getElementById('step-2').classList.remove('active');
    document.getElementById('step-3').style.opacity = '1';
    document.getElementById('step-3').style.pointerEvents = 'auto';
    document.getElementById('step-3').classList.add('active');
    document.getElementById('ai-img-query').value = topic;
    btn.innerHTML = '<i class="ph ph-pen-nib"></i> Write Full Article';
    btn.disabled = false;
};

/**
 * Fallback skeleton used when the AI call fails. Deliberately empty of claims —
 * it is a structure for the editor to fill in, not publishable copy.
 */
function generateTemplateContent(persona, topic, title, imgHtml) {
    return `
                <p><em>Draft skeleton — AI generation failed, fill this in before publishing.</em></p>
                <div class="quick-answer" style="background:#111;border-left:4px solid #cdff00;padding:16px 20px;border-radius:8px;margin:24px 0;">
                    <strong style="color:#cdff00;">Quick answer:</strong>
                    <p style="color:#ccc;margin:6px 0 0;">[One or two sentences: what should the reader do about ${topic}?]</p>
                </div>
                <h2>What it costs</h2>
                <p>[Price in KRW with an approximate USD figure. Note what the price depends on.]</p>
                ${imgHtml}
                <h2>How to get there</h2>
                <p>[Subway line, station, exit number. How long it takes from central Seoul.]</p>
                <h2>What to book ahead</h2>
                <p>[What sells out, what can be bought on the day.]</p>
                ${buildAffiliateBanner({ provider: 'klook', text: `Booking ${topic} ahead is usually cheaper than paying at the gate.` })}
                <h2>What to do next</h2>
                <ul>
                    <li><strong>Best option:</strong> [recommendation]</li>
                    <li><strong>Runner-up:</strong> [alternative and who it suits]</li>
                    <li><strong>Sort out first:</strong> [the one thing to arrange before arriving]</li>
                </ul>
                ${KD_AFFILIATE_DISCLOSURE}
            `;
}

window.runSEOPolish = () => {
    const btn = document.getElementById('btn-seo-polish');
    btn.innerHTML = '<i class="ph ph-spinner spinner"></i> Polishing...';
    setTimeout(() => {
        let title = document.getElementById('ai-suggested-title').value;
        if (!title.includes("2026")) title += " (Updated 2026)";
        if (!title.includes("Guide") && !title.includes("Review")) title = "Ultimate Guide: " + title;
        document.getElementById('ai-suggested-title').value = title;
        // Update slug after SEO polish
        document.getElementById('ai-slug').value = generateSlug(title);
        let content = quill.root.innerHTML;
        if (!content.includes("In this article")) {
            content = `<p><em>In this article, we'll explore ${title} and why it's a must-visit.</em></p>` + content;
            quill.clipboard.dangerouslyPasteHTML(content);
        }
        alert("SEO Polish Complete!");
        calculateSEOScore();
        btn.innerHTML = '<i class="ph ph-sparkle"></i> AI SEO Polish';
    }, 1000);
};

window.searchUnsplashAI = async () => {
    unsplashMode = 'featured';
    const q = document.getElementById('ai-img-query').value;
    document.getElementById('unsplash-modal-search').value = q;
    document.getElementById('unsplash-modal-title').innerText = 'Featured Image';
    resetUploadUI();
    switchImageModalTab('search');
    searchUnsplashModal();
};

function openUnsplashForBody() {
    unsplashMode = 'body';
    document.getElementById('unsplash-modal-title').innerText = 'Insert Image into Body';
    document.getElementById('unsplash-modal-search').value = document.getElementById('ai-topic')?.value || '';
    document.getElementById('unsplash-results').innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);">Search for an image to insert</div>';
    resetUploadUI();
    switchImageModalTab('search');
    document.getElementById('modal-unsplash').style.display = 'flex';
    document.getElementById('unsplash-modal-search').focus();
}

function switchImageModalTab(tabName) {
    document.querySelectorAll('.img-modal-tab').forEach(t => t.classList.remove('active'));
    const activeTab = document.querySelector(`.img-modal-tab[data-tab="${tabName}"]`);
    if (activeTab) activeTab.classList.add('active');
    document.getElementById('img-tab-search').style.display = tabName === 'search' ? 'block' : 'none';
    document.getElementById('img-tab-upload').style.display = tabName === 'upload' ? 'block' : 'none';
}

async function searchUnsplashModal(loadMore = false) {
    const q = document.getElementById('unsplash-modal-search').value.trim();
    if (!q) return;
    const container = document.getElementById('unsplash-results');

    if (!loadMore) {
        imgSearchPage = 1;
        container.innerHTML = '<div style="grid-column:1/-1;text-align:center;">Searching...</div>';
    } else {
        // Remove existing load-more button
        const existingBtn = container.querySelector('.load-more-btn');
        if (existingBtn) {
            existingBtn.textContent = 'Loading...';
            existingBtn.disabled = true;
        }
    }

    document.getElementById('modal-unsplash').style.display = 'flex';
    try {
        const [unsplashRes, pexelsRes] = await Promise.all([
            fetch(`/image-proxy?source=unsplash&query=${encodeURIComponent(q)}&count=12&page=${imgSearchPage}`).then(r => r.json()).catch(() => ({ images: [], totalPages: 0 })),
            fetch(`/image-proxy?source=pexels&query=${encodeURIComponent(q)}&count=6&page=${imgSearchPage}`).then(r => r.json()).catch(() => ({ images: [], totalPages: 0 }))
        ]);

        // Interleave: 2 unsplash, 1 pexels, repeat
        const combined = [];
        const uImgs = unsplashRes.images || [];
        const pImgs = pexelsRes.images || [];
        let ui = 0, pi = 0;
        while (ui < uImgs.length || pi < pImgs.length) {
            if (ui < uImgs.length) combined.push(uImgs[ui++]);
            if (ui < uImgs.length) combined.push(uImgs[ui++]);
            if (pi < pImgs.length) combined.push(pImgs[pi++]);
        }

        if (!loadMore) container.innerHTML = '';
        else {
            const oldBtn = container.querySelector('.load-more-btn');
            if (oldBtn) oldBtn.remove();
        }

        if (combined.length === 0 && !loadMore) {
            container.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);">No results found</div>';
            return;
        }

        combined.forEach(img => {
            const el = document.createElement('img');
            el.src = img.thumb || img.url;
            el.className = 'modal-img-item';
            el.title = `${img.user} (${img.source === 'pexels' ? 'Pexels' : 'Unsplash'})`;
            el.onclick = () => {
                if (unsplashMode === 'body') {
                    insertImageIntoBody({
                        url: img.url,
                        alt: img.alt || q,
                        user: img.user,
                        user_link: img.user_link,
                        source: img.source
                    });
                } else {
                    activeImage = img.url;
                    document.getElementById('selected-ai-img').src = activeImage;
                    document.getElementById('selected-ai-img').style.display = 'block';
                    document.getElementById('ai-img-placeholder').style.display = 'none';
                }
                document.getElementById('modal-unsplash').style.display = 'none';
            };
            container.appendChild(el);
        });

        // Add Load More button if there are more pages
        const hasMore = (unsplashRes.totalPages || 0) > imgSearchPage || (pexelsRes.totalPages || 0) > imgSearchPage;
        if (hasMore && combined.length > 0) {
            const loadMoreBtn = document.createElement('button');
            loadMoreBtn.className = 'btn btn-outline load-more-btn';
            loadMoreBtn.style.cssText = 'grid-column:1/-1; margin-top:8px; padding:10px;';
            loadMoreBtn.innerHTML = '<i class="ph ph-arrow-down"></i> Load More';
            loadMoreBtn.onclick = () => {
                imgSearchPage++;
                searchUnsplashModal(true);
            };
            container.appendChild(loadMoreBtn);
        }
    } catch (e) {
        if (!loadMore) {
            container.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--danger);">API Error</div>';
        }
    }
}

function selectFeaturedImage(img) {
    activeImage = img.urls.regular;
    document.getElementById('selected-ai-img').src = activeImage;
    document.getElementById('selected-ai-img').style.display = 'block';
    document.getElementById('ai-img-placeholder').style.display = 'none';
}

function insertImageIntoBody(img) {
    const range = quill.getSelection(true);
    const index = range ? range.index : quill.getLength() - 1;
    const sourceName = img.source === 'pexels' ? 'Pexels' : 'Unsplash';
    const sourceUrl = img.source === 'pexels'
        ? 'https://www.pexels.com/'
        : 'https://unsplash.com/?utm_source=korea_decode&utm_medium=referral';
    const userLink = img.source === 'pexels'
        ? img.user_link
        : `${img.user_link}?utm_source=korea_decode&utm_medium=referral`;
    const figureHtml = `<figure><img src="${img.url}" alt="${img.alt}" style="width:100%;border-radius:8px;"><figcaption>Photo by <a href="${userLink}" target="_blank">${img.user}</a> on <a href="${sourceUrl}" target="_blank">${sourceName}</a></figcaption></figure>`;
    quill.insertText(index, '\n');
    quill.clipboard.dangerouslyPasteHTML(index + 1, figureHtml);
    quill.setSelection(index + 2);
}

/* --- SHARED VOICE GUIDE FUNCTIONS ---
   Removed in the 2026 redesign. The old per-nationality / per-job voice guides
   generated slang-heavy copy ("vibe check", "no cap", "low-key") and invented
   personal anecdotes. Everything now runs through the single house voice defined
   at the top of this file: MISS_PARK_VOICE + KD_STYLE_RULES. */

// --- AUTOMATION PROFILES ---
function loadAutoProfiles() {
    const profiles = JSON.parse(localStorage.getItem('auto_profiles') || '[]');
    const sel = document.getElementById('auto-profile-select');
    sel.innerHTML = '<option value="">New Profile</option>';
    profiles.forEach((p, i) => {
        sel.innerHTML += `<option value="${i}">${p.name}</option>`;
    });
}

function saveAutoProfile() {
    const name = document.getElementById('auto-profile-name').value.trim();
    if (!name) return alert('Enter a profile name');
    const profile = {
        name,
        persona: document.getElementById('auto-persona').value,
        category: document.getElementById('auto-category').value,
        wordcount: document.getElementById('auto-wordcount').value,
        imgCount: document.getElementById('auto-img-count').value,
        outputStatus: document.getElementById('auto-output-status').value,
        tone: document.getElementById('auto-tone').value,
        interval: document.getElementById('auto-interval').value
    };
    const profiles = JSON.parse(localStorage.getItem('auto_profiles') || '[]');
    const selVal = document.getElementById('auto-profile-select').value;
    if (selVal !== '') {
        profiles[parseInt(selVal)] = profile;
    } else {
        profiles.push(profile);
    }
    localStorage.setItem('auto_profiles', JSON.stringify(profiles));
    loadAutoProfiles();
    document.getElementById('auto-profile-select').value = selVal !== '' ? selVal : String(profiles.length - 1);
    alert('Profile saved!');
}

function deleteAutoProfile() {
    const idx = document.getElementById('auto-profile-select').value;
    if (idx === '') return;
    if (!confirm('Delete this profile?')) return;
    const profiles = JSON.parse(localStorage.getItem('auto_profiles') || '[]');
    profiles.splice(parseInt(idx), 1);
    localStorage.setItem('auto_profiles', JSON.stringify(profiles));
    loadAutoProfiles();
    document.getElementById('auto-profile-name').value = '';
}

function loadAutoProfile() {
    const idx = document.getElementById('auto-profile-select').value;
    if (idx === '') {
        document.getElementById('auto-profile-name').value = '';
        return;
    }
    const profiles = JSON.parse(localStorage.getItem('auto_profiles') || '[]');
    const p = profiles[parseInt(idx)];
    if (!p) return;
    document.getElementById('auto-profile-name').value = p.name;
    document.getElementById('auto-persona').value = p.persona || 'default';
    document.getElementById('auto-category').value = p.category || 'News';
    document.getElementById('auto-wordcount').value = p.wordcount || '1200';
    document.getElementById('auto-img-count').value = p.imgCount || '2';
    document.getElementById('auto-output-status').value = p.outputStatus || 'draft';
    document.getElementById('auto-tone').value = p.tone || '';
    document.getElementById('auto-interval').value = p.interval || '24';
}

function refreshAutoPersonaSelect() {
    const sel = document.getElementById('auto-persona');
    const currentVal = sel.value;
    sel.innerHTML = '<option value="default">Default AI (Generic)</option>';
    availablePersonas.forEach(p => {
        sel.innerHTML += `<option value="${p.id}">${p.name} - ${p.job} (${p.nationality})</option>`;
    });
    if (currentVal) sel.value = currentVal;
}

// --- AUTOMATION AI GENERATION ---
async function generateAutomationSEOPlan(topic, persona) {
    const prompt = `Generate an SEO plan for a Korea Decode practical guide.
Topic: "${topic}"

Korea Decode is an English guide to Korea written from Seoul. Titles describe what the reader will
be able to do or decide after reading — search intent first. Aim for 50-60 characters, include the
primary keyword naturally.

Banned in titles: slang, emoji, exclamation marks, and the words "ultimate", "hidden gem",
"must-visit", "amazing", "epic", "bucket list", "you won't believe".

Also classify the topic into exactly one Korea Decode category:
- "Book" — tours, tickets, passes, experiences worth reserving ahead
- "Plan" — itineraries, transport, timing, etiquette, city logistics
- "Shop" — K-Beauty, skincare, fashion, souvenirs, tax refunds
- "Food" — restaurants, dishes, ordering, cafes, drinking

Return JSON only: { "title": "practical, search-led title", "category": "Book|Plan|Shop|Food", "keywords": ["kw1","kw2","kw3","kw4","kw5"] }`;
    const raw = await callAI(prompt, {
        generationConfig: { temperature: 0.4, topP: 0.85 }
    });
    return parseAIJSON(raw);
}

async function fetchAutomationImages(topic, keywords, count) {
    const images = [];
    const q1 = `${topic} ${(keywords || []).slice(0, 2).join(' ')} korea`;
    const q2 = topic + ' korea';
    try {
        // Fetch from Unsplash and Pexels in parallel via proxy
        const [unsplashRes, pexelsRes] = await Promise.all([
            fetch(`/image-proxy?source=unsplash&query=${encodeURIComponent(q1)}&count=${count}`).then(r => r.json()).catch(() => ({ images: [] })),
            fetch(`/image-proxy?source=pexels&query=${encodeURIComponent(q2)}&count=${Math.ceil(count / 2)}`).then(r => r.json()).catch(() => ({ images: [] }))
        ]);
        const seenUrls = new Set();
        // Interleave: 2 unsplash, 1 pexels
        const uImgs = unsplashRes.images || [];
        const pImgs = pexelsRes.images || [];
        let ui = 0, pi = 0;
        while (images.length < count + 1 && (ui < uImgs.length || pi < pImgs.length)) {
            if (ui < uImgs.length && !seenUrls.has(uImgs[ui].url)) { seenUrls.add(uImgs[ui].url); images.push(uImgs[ui]); }
            ui++;
            if (ui < uImgs.length && !seenUrls.has(uImgs[ui].url)) { seenUrls.add(uImgs[ui].url); images.push(uImgs[ui]); }
            ui++;
            if (pi < pImgs.length && !seenUrls.has(pImgs[pi].url)) { seenUrls.add(pImgs[pi].url); images.push(pImgs[pi]); }
            pi++;
        }
    } catch (e) {
        console.error('Automation image fetch error:', e);
    }
    return images;
}

async function generateAutomationArticle(topic, title, keywords, persona, wordCount, imgCount, toneOverride, images) {
    const contentImages = images.slice(1, imgCount + 1);
    const actualImgCount = contentImages.length;

    const prompt = `
**Task:** Write a ~${wordCount}-word PRACTICAL GUIDE for 'Korea Decode'.

${MISS_PARK_VOICE}
${toneOverride ? `\n**TONE NOTE (still within the rules above):** ${toneOverride}\n` : ''}
**Title:** "${title}"
**Core Subject:** "${topic}"
**Target Keywords:** ${keywords.join(', ')}

${KD_STYLE_RULES}

**ARTICLE FORMAT — PRACTICAL GUIDE, NOT AN ESSAY:**

1. **Opening (2-3 sentences max):** the reader's decision or problem, then what this guide settles.
   No self-introduction, no scene-setting.

2. **Quick Answer box** straight after the intro:
   <div class="quick-answer" style="background:#111;border-left:4px solid #cdff00;padding:16px 20px;border-radius:8px;margin:24px 0;">
   <strong style="color:#cdff00;">Quick answer:</strong>
   <p style="color:#ccc;margin:6px 0 0;">[One or two sentences for the reader who will not read the rest]</p>
   </div>

3. **Comparison table:** at least one HTML <table> comparing the real options — price, time needed,
   who it suits, what is included. 3-5 rows.

4. **Affiliate placements:** insert this block 2-3 times, always AFTER explaining why the thing is
   worth doing, never at the very top and never two in a row:
   <div class="affiliate-cta" data-provider="klook" style="background:#111;border:1px solid #cdff0033;border-left:4px solid #cdff00;border-radius:12px;padding:18px 20px;margin:28px 0;">
   <p style="color:#cfcfcf;margin:0 0 12px;font-size:0.95rem;line-height:1.6;">[One line saying what the reader is booking and why booking ahead helps]</p>
   <a href="#affiliate" target="_blank" rel="sponsored nofollow noopener" style="display:inline-block;background:#cdff00;color:#000;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.9rem;">Check price on Klook &rarr;</a>
   </div>
   The provider, colour and button label are applied automatically from the marker &mdash;
   just place the marker.

5. **Structure:** 4-6 sections with <h2> (and <h3> where needed). <ul><li> for checklists,
   <strong> for the numbers that matter, <blockquote> for one practical tip per section.

6. Place exactly **${actualImgCount}** image markers: <p>[IMG]</p>, each alone on its own line,
   spaced evenly through the article.

7. **Practical specifics:** prices in KRW with an approximate USD figure, opening hours, nearest
   subway line/station and exit number, how long things take, what to book ahead. Where a figure
   varies, give the range and what it depends on. Never invent a number you are unsure of.

8. **Ending:** a short "What to do next" section — recommended option, runner-up, and the one thing
   to sort out before arriving. No motivational sign-off.

9. HTML only. No <html>, <body>, <h1>, or markdown.

**TEST BEFORE YOU FINISH:** every paragraph must help the reader decide or act. If a paragraph does
not answer "what should I do?", "how much is it?", "how do I get there?" or "is it worth it?",
delete it or replace it with a fact.

**Output:** Only the article HTML body.`;

    let rawContent = await callAI(prompt, {
        generationConfig: { temperature: 0.55, topP: 0.9 }
    });
    rawContent = rawContent.trim();
    if (rawContent.startsWith('```html')) rawContent = rawContent.replace(/^```html\s*/, '').replace(/\s*```$/, '');
    else if (rawContent.startsWith('```')) rawContent = rawContent.replace(/^```\s*/, '').replace(/\s*```$/, '');

    // Replace [IMG] with actual images (multi-source attribution)
    contentImages.forEach(img => {
        const sourceName = img.source === 'pexels' ? 'Pexels' : 'Unsplash';
        const sourceUrl = img.source === 'pexels'
            ? 'https://www.pexels.com/'
            : 'https://unsplash.com/?utm_source=korea_decode&utm_medium=referral';
        const userLink = img.source === 'pexels'
            ? img.user_link
            : `${img.user_link}?utm_source=korea_decode&utm_medium=referral`;
        const imgHtml = `<figure><img src="${img.url}" alt="${img.alt}" style="width:100%;border-radius:8px;"><figcaption>Photo by <a href="${userLink}" target="_blank">${img.user}</a> on <a href="${sourceUrl}" target="_blank">${sourceName}</a></figcaption></figure>`;
        if (rawContent.includes('<p>[IMG]</p>')) rawContent = rawContent.replace('<p>[IMG]</p>', imgHtml);
        else if (rawContent.includes('[IMG]')) rawContent = rawContent.replace('[IMG]', imgHtml);
    });
    rawContent = rawContent.replace(/<p>\[IMG\]<\/p>/g, '').replace(/\[IMG\]/g, '');

    // House style + guaranteed affiliate placements
    rawContent = scrubSlang(rawContent);
    rawContent = injectAffiliateBanners(rawContent, { min: 2, max: 4, topic });

    return rawContent;
}

async function runAutomation() {
    const topics = document.getElementById('auto-topics').value.split('\n').filter(t => t.trim() !== '');
    const category = document.getElementById('auto-category').value;
    const startStr = document.getElementById('auto-start-date').value;
    const intervalHours = parseInt(document.getElementById('auto-interval').value);
    const wordCount = parseInt(document.getElementById('auto-wordcount').value);
    const imgCount = parseInt(document.getElementById('auto-img-count').value);
    const outputStatus = document.getElementById('auto-output-status').value;
    const toneOverride = document.getElementById('auto-tone').value.trim();

    if (topics.length === 0) return alert('Enter topics (one per line)');
    if (!startStr) return alert('Select start date');

    // Single house byline — no personas.
    const persona = KD_AUTHOR;

    const btn = document.getElementById('btn-run-automation');
    btn.innerHTML = '<i class="ph ph-spinner spinner"></i> Generating...';
    btn.disabled = true;

    // Show progress card
    const progressCard = document.getElementById('auto-progress-card');
    const progressBar = document.getElementById('auto-progress-bar');
    const progressText = document.getElementById('auto-progress-text');
    const progressLog = document.getElementById('auto-progress-log');
    progressCard.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.innerText = `0/${topics.length}`;
    progressLog.innerHTML = '';

    const logMsg = (msg) => {
        progressLog.innerHTML += `> ${msg}\n`;
        progressLog.scrollTop = progressLog.scrollHeight;
    };

    let currentDate = new Date(startStr);
    let completed = 0;

    for (const topic of topics) {
        const topicTrimmed = topic.trim();
        logMsg(`Processing: "${topicTrimmed}"...`);

        try {
            // Step 1: Generate SEO Plan
            logMsg('  -> Generating SEO plan...');
            const seoPlan = await generateAutomationSEOPlan(topicTrimmed, persona);
            const title = seoPlan.title || `${topicTrimmed} - Korea Decode`;
            const keywords = seoPlan.keywords || [];
            // 'auto' (or an unset select) lets the AI classify into Book/Plan/Shop/Eat
            const postCategory = (!category || category === 'auto')
                ? (KD_CATEGORIES.includes(seoPlan.category) ? seoPlan.category : 'Plan')
                : category;
            logMsg(`  -> Title: "${title}"`);

            // Step 2: Fetch Images
            logMsg('  -> Fetching images...');
            const images = await fetchAutomationImages(topicTrimmed, keywords, imgCount + 1);
            logMsg(`  -> Found ${images.length} images`);

            // Step 3: Generate Full Article
            logMsg('  -> Writing article (~' + wordCount + ' words)...');
            const content = await generateAutomationArticle(topicTrimmed, title, keywords, persona, wordCount, imgCount, toneOverride, images);

            // Step 4: Save to Supabase (with auto-generated slug)
            const slug = generateSlug(title);
            const postData = {
                title,
                slug,
                category: postCategory,
                content,
                image: images.length > 0 ? images[0].url : '',
                views: 0,
                status: outputStatus === 'scheduled' ? 'scheduled' : 'draft',
                created_at: new Date(currentDate).toISOString(),
                writer_name: persona.name,
                writer_job: persona.job,
                writer_bio: persona.bio || KD_AUTHOR.bio,
                writer_avatar: KD_AUTHOR.avatar
            };

            const { error } = await supabase.from('posts').insert(postData);
            if (error) throw error;

            logMsg(`  [OK] Saved as ${postData.status}`);
            currentDate.setHours(currentDate.getHours() + intervalHours);

        } catch (e) {
            logMsg(`  [ERR] ${e.message} - skipping`);
            console.error('Automation error for topic:', topicTrimmed, e);
        }

        completed++;
        const pct = Math.round((completed / topics.length) * 100);
        progressBar.style.width = pct + '%';
        progressText.innerText = `${completed}/${topics.length}`;
    }

    logMsg(`\nDone! ${completed}/${topics.length} topics processed.`);
    btn.innerHTML = '<i class="ph ph-robot"></i> Generate All with AI';
    btn.disabled = false;
    loadQueue();
}

async function loadQueue() {
    const draftsTbody = document.getElementById('auto-drafts-list');
    const schedTbody = document.getElementById('auto-queue-list');
    draftsTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Loading...</td></tr>';
    schedTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Loading...</td></tr>';

    const { data, error } = await supabase.from('posts').select('id, title, category, status, created_at').order('created_at', { ascending: false });
    if (error) { console.error(error); return; }

    const drafts = (data || []).filter(p => p.status === 'draft');
    const scheduled = (data || []).filter(p => p.status === 'scheduled');

    // Update counts
    document.getElementById('auto-draft-count').innerText = drafts.length;
    document.getElementById('auto-sched-count').innerText = scheduled.length;

    // Render drafts
    draftsTbody.innerHTML = '';
    if (drafts.length === 0) {
        draftsTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No drafts to review</td></tr>';
    } else {
        drafts.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="checkbox" class="auto-draft-check" value="${p.id}"></td>
                <td style="max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.title}</td>
                <td>${p.category || '-'}</td>
                <td style="white-space:nowrap;">
                    <button class="btn btn-primary" style="padding:4px 10px; font-size:12px;" onclick="publishDraft('${p.id}')">Publish</button>
                    <button class="btn btn-outline" style="padding:4px 10px; font-size:12px; color:var(--accent); border-color:var(--accent);" onclick="editPost('${p.id}')">Edit</button>
                    <button class="btn btn-outline" style="padding:4px 10px; font-size:12px; color:var(--danger); border-color:var(--danger);" onclick="deletePost('${p.id}')">Delete</button>
                </td>
            `;
            draftsTbody.appendChild(tr);
        });
    }

    // Render scheduled
    schedTbody.innerHTML = '';
    if (scheduled.length === 0) {
        schedTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No scheduled posts</td></tr>';
    } else {
        scheduled.forEach(p => {
            const pDate = new Date(p.created_at);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="status-badge status-scheduled">Scheduled</span></td>
                <td style="max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.title}</td>
                <td>${pDate.toLocaleString()}</td>
                <td><button class="btn btn-outline" style="padding:4px 8px; font-size:12px;" onclick="deletePost('${p.id}')">Cancel</button></td>
            `;
            schedTbody.appendChild(tr);
        });
    }

    // Refresh persona select for automation
    refreshAutoPersonaSelect();
}

window.deletePost = async (id) => {
    if (confirm('Delete this post?')) {
        await supabase.from('posts').delete().eq('id', id);
        loadQueue();
        loadPosts();
    }
};

window.publishDraft = async (id) => {
    const { error } = await supabase.from('posts').update({ status: 'published' }).eq('id', id);
    if (error) return alert('Error: ' + error.message);
    loadQueue();
};

async function batchPublishDrafts() {
    const checked = Array.from(document.querySelectorAll('.auto-draft-check:checked'));
    if (checked.length === 0) return alert('Select drafts to publish');
    if (!confirm(`Publish ${checked.length} draft(s)?`)) return;
    for (const cb of checked) {
        await supabase.from('posts').update({ status: 'published' }).eq('id', cb.value);
    }
    alert(`Published ${checked.length} posts!`);
    loadQueue();
}

async function batchDeleteDrafts() {
    const checked = Array.from(document.querySelectorAll('.auto-draft-check:checked'));
    if (checked.length === 0) return alert('Select drafts to delete');
    if (!confirm(`Delete ${checked.length} draft(s)? This cannot be undone.`)) return;
    for (const cb of checked) {
        await supabase.from('posts').delete().eq('id', cb.value);
    }
    alert(`Deleted ${checked.length} drafts.`);
    loadQueue();
}

function calculateSEOScore() {
    let score = 0;
    const text = quill.getText();
    const title = document.getElementById('ai-suggested-title').value;
    if (text.trim().split(/\s+/).length > 300) score += 50;
    if (title.length >= 10) score += 50;
    document.getElementById('seo-bar').style.width = score + '%';
    document.getElementById('seo-score-text').innerText = score + '%';
}

// --- AFFILIATE WIDGET FUNCTIONS ---

// In-memory cache of DB presets (refreshed on modal open)
let dbAffiliatePresets = [];

function openAffiliateModal() {
    // Reset manual tab fields
    document.getElementById('aff-label').value = 'Klook Widget';
    document.getElementById('aff-code-input').value = '';
    // Reset manage fields
    document.getElementById('aff-manage-id').value = '';
    document.getElementById('aff-manage-label').value = '';
    document.getElementById('aff-manage-code').value = '';
    document.getElementById('aff-manage-provider').value = 'custom';
    document.getElementById('aff-manage-category').value = '';
    // Default to presets tab
    switchAffiliateTab('presets');
    // Load DB presets
    loadAffiliatePresetsFromDB();
    document.getElementById('modal-affiliate').style.display = 'flex';
}

// --- Tab switching ---
function switchAffiliateTab(tabName) {
    document.querySelectorAll('.aff-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.affTab === tabName));
    document.getElementById('aff-tab-presets').style.display = tabName === 'presets' ? 'block' : 'none';
    document.getElementById('aff-tab-manual').style.display = tabName === 'manual' ? 'block' : 'none';
}

// --- DB-backed Preset Functions ---

async function loadAffiliatePresetsFromDB() {
    const select = document.getElementById('aff-preset-select');
    select.innerHTML = '<option value="">-- Loading... --</option>';
    try {
        const { data, error } = await supabase
            .from('affiliate_presets')
            .select('*')
            .eq('is_active', true)
            .order('label', { ascending: true });
        if (error) throw error;
        dbAffiliatePresets = data || [];
        select.innerHTML = '<option value="">-- Select a preset --</option>';
        dbAffiliatePresets.forEach(p => {
            const providerIcon = { klook: '🎫', coupang: '🛒', amazon: '📦', custom: '🔗' }[p.provider] || '🔗';
            select.innerHTML += `<option value="${escHtml(p.id)}">${providerIcon} ${escHtml(p.label)}</option>`;
        });
    } catch (err) {
        console.error('[Affiliate] Failed to load presets:', err);
        select.innerHTML = '<option value="">-- Failed to load --</option>';
    }
}

function onPresetSelectChange() {
    const presetId = document.getElementById('aff-preset-select').value;
    const previewEl = document.getElementById('aff-preset-preview');
    if (!presetId) {
        previewEl.style.display = 'none';
        return;
    }
    const preset = dbAffiliatePresets.find(p => p.id === presetId);
    if (preset) {
        previewEl.textContent = preset.code;
        previewEl.style.display = 'block';
        // Fill manage fields for easy editing
        document.getElementById('aff-manage-id').value = preset.id;
        document.getElementById('aff-manage-label').value = preset.label;
        document.getElementById('aff-manage-provider').value = preset.provider || 'custom';
        document.getElementById('aff-manage-category').value = preset.category || '';
        document.getElementById('aff-manage-code').value = preset.code;
    }
}

function insertTravelDealTemplate() {
    const template = `<section class="travel-deal-hero">
  <h2>City · Hotel Name — Deal Title</h2>
  <p class="deal-subtitle">Check-in date · N nights · Provider</p>
</section>

<section class="travel-deal-spec">
  <h3>Deal Details</h3>
  <ul>
    <li><strong>Cash price:</strong> $XXX / night</li>
    <li><strong>Points price:</strong> XX,XXX pts / night</li>
    <li><strong>Value (CPP):</strong> X.X¢ per point</li>
    <li><strong>Captured:</strong> YYYY-MM-DD</li>
  </ul>
</section>

<section class="travel-deal-cta">
  <h3>Book this deal</h3>
  <p>[affiliate preset="REPLACE_WITH_PRESET_ID"]</p>
</section>

<section class="travel-deal-context">
  <h3>Why this deal stands out</h3>
  <p>Explain the context — seasonality, room type, loyalty program value, or comparison with typical market pricing.</p>
</section>

<aside class="affiliate-disclosure">
  <p><strong>Disclosure:</strong> 이 글은 어필리에이트 파트너십 링크를 포함합니다. 구매/예약 시 Korea Decode가 소정의 수수료를 받을 수 있으며, 가격 및 포인트 정보는 수집 시점 기준이므로 실제와 다를 수 있습니다.</p>
</aside>
`;

    if (isHtmlMode) {
        const ta = document.getElementById('html-source-editor');
        const start = ta.selectionStart;
        ta.value = ta.value.substring(0, start) + template + ta.value.substring(ta.selectionEnd);
    } else {
        const range = quill.getSelection(true);
        const index = range ? range.index : quill.getLength();
        quill.insertText(index, '\n');
        quill.clipboard.dangerouslyPasteHTML(index + 1, template);
    }
}

function insertAffiliateShortcode() {
    const presetId = document.getElementById('aff-preset-select').value;
    if (!presetId) return alert('Please select a preset first.');
    const preset = dbAffiliatePresets.find(p => p.id === presetId);
    const label = preset ? preset.label : presetId;

    const shortcode = `[affiliate preset="${presetId}"]`;

    if (isHtmlMode) {
        const ta = document.getElementById('html-source-editor');
        const start = ta.selectionStart;
        ta.value = ta.value.substring(0, start) + shortcode + ta.value.substring(ta.selectionEnd);
    } else {
        // In Quill visual mode: insert shortcode as plain text (safe, no script issues)
        const range = quill.getSelection();
        const pos = range ? range.index : quill.getLength() - 1;
        quill.insertText(pos, '\n' + shortcode + '\n');
    }

    closeModal('modal-affiliate');
}

async function saveAffiliatePresetToDB() {
    const id = document.getElementById('aff-manage-id').value.trim();
    const label = document.getElementById('aff-manage-label').value.trim();
    const code = document.getElementById('aff-manage-code').value.trim();
    const provider = document.getElementById('aff-manage-provider').value;
    const category = document.getElementById('aff-manage-category').value;

    if (!id || !label || !code) return alert('ID, Label, and Code are all required.');

    // Validate ID is slug-friendly
    if (!/^[a-z0-9-]+$/.test(id)) return alert('Preset ID must be lowercase letters, numbers, and hyphens only.');

    try {
        const { error } = await supabase
            .from('affiliate_presets')
            .upsert({
                id,
                label,
                provider,
                category: category || null,
                code,
                is_active: true,
                updated_at: new Date().toISOString()
            }, { onConflict: 'id' });
        if (error) throw error;
        alert('Preset saved to database!');
        loadAffiliatePresetsFromDB();
    } catch (err) {
        console.error('[Affiliate] Save preset error:', err);
        alert('Failed to save preset: ' + err.message);
    }
}

async function deleteAffiliatePresetFromDB() {
    const id = document.getElementById('aff-manage-id').value.trim();
    if (!id) return alert('Select or enter a preset ID to delete.');
    if (!confirm(`Delete preset "${id}"? This will not remove shortcodes from existing posts, but they will stop rendering.`)) return;

    try {
        const { error } = await supabase
            .from('affiliate_presets')
            .delete()
            .eq('id', id);
        if (error) throw error;
        alert('Preset deleted.');
        document.getElementById('aff-manage-id').value = '';
        document.getElementById('aff-manage-label').value = '';
        document.getElementById('aff-manage-code').value = '';
        loadAffiliatePresetsFromDB();
    } catch (err) {
        console.error('[Affiliate] Delete preset error:', err);
        alert('Failed to delete: ' + err.message);
    }
}

// --- Legacy localStorage Preset Functions (backward compat for manual tab) ---

function getAffiliatePresetsLegacy() {
    return JSON.parse(localStorage.getItem('aff_presets') || '[]');
}

function saveAffiliatePresetLegacy() {
    const label = document.getElementById('aff-label').value.trim();
    const code = document.getElementById('aff-code-input').value.trim();
    if (!label || !code) return alert('Label and code are both required to save a preset.');
    const presets = getAffiliatePresetsLegacy();
    const idx = presets.findIndex(p => p.label === label);
    if (idx >= 0) presets[idx].code = code;
    else presets.push({ label, code });
    localStorage.setItem('aff_presets', JSON.stringify(presets));
    alert('Preset saved locally!');
}

function insertAffiliateCode() {
    const code = document.getElementById('aff-code-input').value.trim();
    const label = document.getElementById('aff-label').value.trim() || 'Affiliate Widget';
    if (!code) return alert('Please paste the affiliate HTML code.');

    const affId = 'aff-' + Date.now();
    affiliateCodes[affId] = code;

    // Build placeholder HTML
    const placeholderHTML = `<div class="affiliate-placeholder" data-aff-id="${affId}" contenteditable="false"><span class="aff-icon">📦</span><span class="aff-label">${escHtml(label)}</span><span class="aff-hint">Affiliate widget — renders on live blog</span></div>`;

    if (isHtmlMode) {
        // In HTML mode, insert at cursor position in textarea
        const ta = document.getElementById('html-source-editor');
        const start = ta.selectionStart;
        const before = ta.value.substring(0, start);
        const after = ta.value.substring(ta.selectionEnd);
        ta.value = before + placeholderHTML + after;
    } else {
        // In visual mode, insert at end of content
        const len = quill.getLength();
        quill.clipboard.dangerouslyPasteHTML(len - 1, placeholderHTML);
    }

    closeModal('modal-affiliate');
}

/**
 * Process editor content for saving: replace affiliate placeholders with real code.
 * Wraps each affiliate block in HTML comments for roundtrip identification.
 */
function processContentForSave(html) {
    // Replace placeholder divs with actual affiliate code wrapped in comment markers
    return html.replace(/<div class="affiliate-placeholder"[^>]*data-aff-id="([^"]+)"[^>]*>[\s\S]*?<\/div>/g, (match, affId) => {
        const code = affiliateCodes[affId];
        if (code) {
            return `<!--AFFILIATE_START-->\n<div class="affiliate-widget">\n${code}\n</div>\n<!--AFFILIATE_END-->`;
        }
        return match; // Keep placeholder if no code found
    });
}

/**
 * Process content from DB before loading into Quill:
 * Find affiliate blocks (wrapped in comment markers) and convert to placeholders.
 */
function processContentForEdit(html) {
    affiliateCodes = {}; // Reset
    return html.replace(/<!--AFFILIATE_START-->\s*<div class="affiliate-widget">\s*([\s\S]*?)\s*<\/div>\s*<!--AFFILIATE_END-->/g, (match, code) => {
        const affId = 'aff-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
        affiliateCodes[affId] = code.trim();
        // Extract label from code (try to detect provider)
        let label = 'Affiliate Widget';
        if (code.includes('klk-aff-widget') || code.includes('klook.com')) label = 'Klook Widget';
        else if (code.includes('amazon')) label = 'Amazon Widget';
        else if (code.includes('coupang')) label = 'Coupang Widget';
        return `<div class="affiliate-placeholder" data-aff-id="${affId}" contenteditable="false"><span class="aff-icon">📦</span><span class="aff-label">${escHtml(label)}</span><span class="aff-hint">Affiliate widget — renders on live blog</span></div>`;
    });
}

// --- HTML Source Toggle ---
let isHtmlMode = false;
window.toggleHtmlSource = () => {
    const btn = document.getElementById('btn-toggle-html');
    const quillContainer = document.querySelector('#editor-container');
    const htmlEditor = document.getElementById('html-source-editor');

    if (!isHtmlMode) {
        // Switch to HTML source mode
        htmlEditor.value = quill.root.innerHTML;
        quillContainer.style.display = 'none';
        htmlEditor.style.display = 'block';
        btn.classList.add('active');
        btn.innerHTML = '<i class="ph ph-eye"></i> Visual';
        isHtmlMode = true;
    } else {
        // Warn if HTML contains script tags that Quill will strip
        const htmlContent = htmlEditor.value;
        if (/<script[\s>]/i.test(htmlContent)) {
            if (!confirm('Warning: Switching to Visual mode will strip <script> tags (affiliate widgets, embeds). Your content will be saved correctly if you publish while staying in HTML mode.\n\nSwitch anyway?')) {
                return;
            }
        }
        // Switch back to visual mode
        quill.root.innerHTML = htmlContent;
        htmlEditor.style.display = 'none';
        quillContainer.style.display = 'flex';
        btn.classList.remove('active');
        btn.innerHTML = '<i class="ph ph-code"></i> HTML';
        isHtmlMode = false;
        calculateSEOScore();
    }
};

// Helper: get current editor content (works in both visual and HTML mode)
// Processes affiliate placeholders into real code for saving.
function getEditorContent() {
    let html;
    if (isHtmlMode) {
        html = document.getElementById('html-source-editor').value;
    } else {
        html = quill.root.innerHTML;
    }
    // Replace affiliate placeholders with actual code
    return processContentForSave(html);
}

window.showMobilePreview = () => {
    document.getElementById('prev-cat').innerText = document.getElementById('ai-category').value;
    document.getElementById('prev-title').innerText = document.getElementById('ai-suggested-title').value;
    document.getElementById('prev-img').src = activeImage;
    document.getElementById('prev-img').style.display = activeImage ? 'block' : 'none';
    document.getElementById('prev-content').innerHTML = getEditorContent();
    document.getElementById('modal-preview').style.display = 'flex';
};

window.publishPost = async () => {
    const title = document.getElementById('ai-suggested-title').value;
    const slug = document.getElementById('ai-slug').value || generateSlug(title);
    const category = document.getElementById('ai-category').value;
    const content = getEditorContent();
    const scheduleStr = document.getElementById('post-schedule').value;

    if (!title) return alert("Title is required");

    // Single house byline — no personas.
    const persona = KD_AUTHOR;

    try {
        if (editingPostId) {
            const updateData = {
                title,
                slug,
                category,
                content,
                image: activeImage || '',
                writer_name: persona.name,
                writer_job: persona.job,
                writer_bio: persona.bio || KD_AUTHOR.bio,
                writer_avatar: KD_AUTHOR.avatar
            };
            if (scheduleStr) {
                updateData.status = 'scheduled';
                updateData.created_at = new Date(scheduleStr).toISOString();
            }
            const { error } = await supabase.from('posts').update(updateData).eq('id', editingPostId);
            if (error) throw error;
            alert('Post Updated!');
        } else {
            const postData = {
                title,
                slug,
                category,
                content,
                image: activeImage || '',
                views: 0,
                status: scheduleStr ? 'scheduled' : 'published',
                writer_name: persona.name,
                writer_job: persona.job,
                writer_bio: persona.bio || KD_AUTHOR.bio,
                writer_avatar: KD_AUTHOR.avatar
            };
            if (scheduleStr) {
                postData.created_at = new Date(scheduleStr).toISOString();
            }
            const { error } = await supabase.from('posts').insert(postData);
            if (error) throw error;
            alert('Post Published!');
        }
        resetAI();
        loadDashboard();
    } catch (e) {
        console.error("Publish Error:", e);
        alert("Error publishing post: " + e.message);
    }
};

async function loadPosts() {
    const grid = document.getElementById('posts-grid');
    grid.innerHTML = 'Loading...';

    const { data, error } = await supabase.from('posts').select('id, title, slug, category, views, status, writer_name').order('created_at', { ascending: false });
    if (error) { console.error(error); grid.innerHTML = 'Error loading posts.'; return; }

    grid.innerHTML = '';
    (data || []).forEach(p => {
        const statusClass = p.status === 'published' ? 'status-published' : p.status === 'scheduled' ? 'status-scheduled' : 'status-draft';
        const statusLabel = p.status || 'draft';
        const postSlug = p.slug || generateSlug(p.title);
        const viewUrl = `/blog/${postSlug}`;

        const div = document.createElement('div');
        div.className = 'card';
        div.style.padding = '16px';
        div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:700; font-size:16px;">${p.title}</div>
                            <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">
                                <span class="status-badge ${statusClass}">${statusLabel}</span>
                                ${p.category} | ${p.views || 0} views | ${p.writer_name || 'Admin'}
                            </div>
                            <div style="font-size:11px; color:var(--accent); margin-top:4px; font-family:monospace; opacity:0.7; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                /blog/${postSlug}
                            </div>
                        </div>
                        <div style="display:flex; gap: 8px; flex-shrink:0; margin-left:12px;">
                            <a href="${viewUrl}" target="_blank" class="btn btn-outline" style="padding:6px 12px; font-size:12px;">View</a>
                            <button class="btn btn-outline" style="padding:6px 12px; font-size:12px; color:var(--accent); border-color:var(--accent);" onclick="editPost('${p.id}')">Edit</button>
                            <button class="btn btn-outline" style="padding:6px 12px; font-size:12px; color:var(--danger); border-color:var(--danger);" onclick="deletePost('${p.id}')">Delete</button>
                        </div>
                    </div>
                `;
        grid.appendChild(div);
    });
    if ((data || []).length === 0) {
        grid.innerHTML = '<div class="card" style="padding:20px; text-align:center; color:var(--text-muted);">No posts yet. Create your first post with AI Writer!</div>';
    }
}


// Mock migrationList if migration-list.js is not loaded
const migrationList = self.migrationList || [];

window.startMigration = async () => {
    const logBox = document.getElementById('migration-log');
    logBox.style.display = 'block';
    logBox.innerHTML = 'Starting... (Check console for full details)';
    const parser = new DOMParser();
    for (const path of migrationList) {
        try {
            const res = await fetch(path);
            if (!res.ok) continue;
            const html = await res.text();
            const d = parser.parseFromString(html, 'text/html');
            let title = d.querySelector('title')?.innerText.split(' - ')[0] || "Untitled";
            let contentEl = d.querySelector('.elementor-widget-theme-post-content') || d.querySelector('article') || d.body;
            let content = contentEl.innerHTML;

            content = content.replace(/http:\/\/koreadecode.mycafe24.com/g, '');
            content = content.replace(/https:\/\/koreadecode.mycafe24.com/g, '');
            content = content.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gm, "");
            content = content.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gm, "");

            const slug = generateSlug(title);
            await supabase.from('posts').insert({
                title,
                slug,
                category: 'Archive',
                content,
                image: 'https://images.unsplash.com/photo-1576085898323-218337e3e43c?w=800',
                views: 0,
                status: 'published',
                writer_name: "Korea Decode Archive",
                writer_job: "System",
                writer_bio: "Legacy content from our previous blog.",
                writer_avatar: "K"
            });
            logBox.innerHTML += `> Imported ${title}\n`;
        } catch (e) {}
    }
    alert('Migration Done');
};

// --- IMAGE RESIZER ---
function initImageResizer() {
    let toolbar = null;
    let selectedImg = null;

    const sizes = [
        { label: '25%', value: '25%' },
        { label: '50%', value: '50%' },
        { label: '75%', value: '75%' },
        { label: '100%', value: '100%' },
    ];

    function removeToolbar() {
        if (toolbar) { toolbar.remove(); toolbar = null; }
        if (selectedImg) { selectedImg.classList.remove('img-selected'); selectedImg = null; }
    }

    function applySize(img, width) {
        img.style.width = width;
        toolbar.querySelectorAll('button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.size === width);
        });
    }

    function showToolbar(img) {
        removeToolbar();
        selectedImg = img;
        img.classList.add('img-selected');

        toolbar = document.createElement('div');
        toolbar.className = 'img-resize-toolbar';

        sizes.forEach(s => {
            const btn = document.createElement('button');
            btn.textContent = s.label;
            btn.dataset.size = s.value;
            if (img.style.width === s.value) btn.classList.add('active');
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                applySize(img, s.value);
            });
            toolbar.appendChild(btn);
        });

        const delBtn = document.createElement('button');
        delBtn.innerHTML = '<i class="ph ph-trash"></i>';
        delBtn.title = 'Remove image';
        delBtn.style.color = 'var(--danger)';
        delBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const figure = img.closest('figure');
            if (figure) figure.remove();
            else img.remove();
            removeToolbar();
        });
        toolbar.appendChild(delBtn);

        const editorEl = document.querySelector('.ql-editor');
        const editorRect = editorEl.getBoundingClientRect();
        const imgRect = img.getBoundingClientRect();
        toolbar.style.left = (imgRect.left + imgRect.width / 2 - editorRect.left) + 'px';
        toolbar.style.top = (imgRect.top - editorRect.top - 44) + 'px';

        editorEl.style.position = 'relative';
        editorEl.appendChild(toolbar);
    }

    document.querySelector('.ql-editor').addEventListener('click', (e) => {
        if (e.target.tagName === 'IMG') {
            e.preventDefault();
            showToolbar(e.target);
        } else if (!e.target.closest('.img-resize-toolbar')) {
            removeToolbar();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') removeToolbar();
    });
}


// --- STORAGE BUCKET ---
async function ensureStorageBucket() {
    try {
        const { data, error } = await supabase.storage.getBucket('images');
        if (error && error.message.includes('not found')) {
            console.warn('[Storage] "images" bucket does not exist. Please create it in Supabase Dashboard → Storage → New Bucket (name: images, public: true).');
        } else if (data) {
            console.log('[Storage] images bucket ready');
        }
    } catch (e) {
        console.warn('[Storage] Bucket check failed:', e.message);
    }
}

// --- IMAGE UPLOAD FUNCTIONS ---
function handleUploadFile(file) {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.type)) {
        alert('Only JPG, PNG, GIF, WebP images are allowed.');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        alert('File too large. Max 5MB.');
        return;
    }
    pendingUploadFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('upload-preview-img').src = e.target.result;
        document.getElementById('upload-file-name').textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        document.getElementById('upload-preview-area').style.display = 'block';
        document.getElementById('upload-drop-zone').style.display = 'none';
        const actions = document.getElementById('upload-actions');
        actions.style.display = 'flex';
    };
    reader.readAsDataURL(file);
}

async function confirmUpload() {
    if (!pendingUploadFile) return;
    const btn = document.getElementById('btn-confirm-upload');
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner spinner"></i> Uploading...';

    document.getElementById('upload-progress-area').style.display = 'block';
    document.getElementById('upload-progress-bar').style.width = '30%';

    try {
        const ext = pendingUploadFile.name.split('.').pop().toLowerCase();
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const filePath = `uploads/${fileName}`;

        document.getElementById('upload-progress-bar').style.width = '60%';

        const { data, error } = await supabase.storage
            .from('images')
            .upload(filePath, pendingUploadFile, {
                cacheControl: '3600',
                upsert: false
            });

        if (error) throw error;

        document.getElementById('upload-progress-bar').style.width = '90%';

        const { data: urlData } = supabase.storage
            .from('images')
            .getPublicUrl(filePath);

        const publicUrl = urlData.publicUrl;

        document.getElementById('upload-progress-bar').style.width = '100%';
        document.getElementById('upload-progress-text').textContent = 'Done!';

        if (unsplashMode === 'body') {
            insertUploadedImageIntoBody(publicUrl, pendingUploadFile.name);
        } else {
            activeImage = publicUrl;
            document.getElementById('selected-ai-img').src = publicUrl;
            document.getElementById('selected-ai-img').style.display = 'block';
            document.getElementById('ai-img-placeholder').style.display = 'none';
        }

        setTimeout(() => {
            resetUploadUI();
            closeModal('modal-unsplash');
        }, 500);

    } catch (e) {
        console.error('[Upload]', e);
        document.getElementById('upload-progress-text').textContent = 'Upload failed: ' + e.message;
        document.getElementById('upload-progress-bar').style.width = '0%';
        btn.disabled = false;
        btn.innerHTML = '<i class="ph ph-check"></i> Use This Image';
    }
}

function insertUploadedImageIntoBody(url, fileName) {
    const range = quill.getSelection(true);
    const index = range ? range.index : quill.getLength() - 1;
    const alt = fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    const figureHtml = `<figure><img src="${url}" alt="${alt}" style="width:100%;border-radius:8px;"><figcaption>${alt}</figcaption></figure>`;
    quill.insertText(index, '\n');
    quill.clipboard.dangerouslyPasteHTML(index + 1, figureHtml);
    quill.setSelection(index + 2);
}

function resetUploadUI() {
    pendingUploadFile = null;
    document.getElementById('upload-preview-area').style.display = 'none';
    document.getElementById('upload-preview-img').src = '';
    document.getElementById('upload-file-name').textContent = '';
    document.getElementById('upload-progress-area').style.display = 'none';
    document.getElementById('upload-progress-bar').style.width = '0%';
    document.getElementById('upload-progress-text').textContent = 'Uploading...';
    document.getElementById('upload-drop-zone').style.display = 'flex';
    const actions = document.getElementById('upload-actions');
    actions.style.display = 'none';
    const btn = document.getElementById('btn-confirm-upload');
    btn.disabled = false;
    btn.innerHTML = '<i class="ph ph-check"></i> Use This Image';
    document.getElementById('upload-file-input').value = '';
}

init();

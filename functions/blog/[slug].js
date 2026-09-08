export async function onRequest(context) {
  const { params, env } = context;
  const slug = params.slug;

  const SUPABASE_URL = env.SUPABASE_URL || 'https://agkkvtfwqmzgbrqhvohs.supabase.co';
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFna2t2dGZ3cW16Z2JycWh2b2hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2MTU5MDIsImV4cCI6MjA4NjE5MTkwMn0.nZZ8Qrt0dU_v4CSeiVy4DM1IQLAEGBmKldtiotb6Oh8';

  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };

  // --- Fetch post by slug ---
  const postRes = await fetch(
    `${SUPABASE_URL}/rest/v1/posts?slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=*&limit=1`,
    { headers }
  );

  if (!postRes.ok) {
    return new Response(notFoundHTML(), {
      status: 404,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  }

  const posts = await postRes.json();
  if (!posts || posts.length === 0) {
    return new Response(notFoundHTML(), {
      status: 404,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  }

  const post = posts[0];

  // --- Increment views (fire-and-forget) ---
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_views`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ post_id: post.id }),
    });
  } catch (_) {
    // Non-critical — do not block response
  }

  // --- Fetch related posts (same category, exclude current, limit 3) ---
  let relatedPosts = [];
  try {
    const relatedRes = await fetch(
      `${SUPABASE_URL}/rest/v1/posts?category=eq.${encodeURIComponent(post.category)}&id=neq.${post.id}&status=eq.published&select=id,title,slug,category,image,views,created_at,writer_name,writer_avatar&order=created_at.desc&limit=3`,
      { headers }
    );
    if (relatedRes.ok) {
      relatedPosts = await relatedRes.json();
    }
  } catch (_) {
    // Non-critical
  }

  // --- Render affiliate shortcodes ---
  post.content = await renderAffiliateShortcodes(post.content || '', SUPABASE_URL, headers);

  // --- "Before you go" box: edited in admin, shown inside every article ---
  try {
    const essRes = await fetch(
      `${SUPABASE_URL}/rest/v1/site_settings?key=eq.essentials&select=value&limit=1`,
      { headers }
    );
    if (essRes.ok) {
      const rows = await essRes.json();
      post.content = insertEssentials(post.content, rows?.[0]?.value, slug);
    }
  } catch (_) {
    // Non-critical: the article still reads fine without the box.
  }

  // --- Pinned note: one of three notepads, chosen per article in admin ---
  let pinnedNoteHTML = '';
  if (post.pinned_note) {
    try {
      const noteRes = await fetch(
        `${SUPABASE_URL}/rest/v1/site_settings?key=eq.notes&select=value&limit=1`,
        { headers }
      );
      if (noteRes.ok) {
        const rows = await noteRes.json();
        pinnedNoteHTML = buildPinnedNote(rows?.[0]?.value, post.pinned_note);
      }
    } catch (_) {
      // Non-critical: the article renders without the note.
    }
  }

  // --- Build HTML ---
  const html = buildPostHTML(post, relatedPosts, pinnedNoteHTML);

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}

// ------------------------------------------------------------------
// Affiliate shortcode renderer: [affiliate preset="preset-id"]
// Fetches preset HTML from affiliate_presets table and replaces shortcodes
// ------------------------------------------------------------------
async function renderAffiliateShortcodes(content, supabaseUrl, headers) {
  const shortcodeRegex = /\[affiliate preset="([^"]+)"\]/g;
  const matches = [...content.matchAll(shortcodeRegex)];
  if (matches.length === 0) return content;

  // Collect unique preset IDs
  const presetIds = [...new Set(matches.map(m => m[1]))];

  // Fetch only needed presets in one query
  try {
    const idFilter = presetIds.map(id => `"${id}"`).join(',');
    const res = await fetch(
      `${supabaseUrl}/rest/v1/affiliate_presets?id=in.(${encodeURIComponent(presetIds.join(','))})&is_active=eq.true&select=id,code`,
      { headers }
    );
    if (!res.ok) return content; // On error, leave shortcodes as-is (invisible to reader)

    const presets = await res.json();
    const presetMap = {};
    for (const p of presets) {
      presetMap[p.id] = p.code;
    }

    return content.replace(shortcodeRegex, (match, presetId) => {
      const code = presetMap[presetId];
      if (!code) return ''; // Preset not found or inactive — remove shortcode silently
      return `<div class="affiliate-widget" data-preset="${presetId.replace(/"/g, '&quot;')}">${code}</div>`;
    });
  } catch (err) {
    console.error('[Affiliate SSR] Error fetching presets:', err);
    return content; // Graceful fallback
  }
}

// ------------------------------------------------------------------
// "Before you go" — the pinned Essentials box
//
// Readers arrive from search on one specific article and never see the
// homepage, so the things nobody can skip (eSIM, airport transfer, transit
// card) have to travel with every article. The list is edited in admin and
// stored in site_settings, so publishing a change is a save, not a deploy.
// ------------------------------------------------------------------
function insertEssentials(content, setting, currentSlug) {
  const html = buildEssentialsHTML(setting, currentSlug);
  if (!html) return content;

  const body = content || '';

  // Preferred spot: after the section that follows the second H2. By then the
  // reader has committed to the article, and there is still article left after
  // the box, so it does not read as the end of the page.
  const h2s = [...body.matchAll(/<h2\b[^>]*>/gi)];
  if (h2s.length >= 3) {
    const at = h2s[2].index;
    return body.slice(0, at) + html + body.slice(at);
  }
  // Short article: put it at the end, where it becomes the next thing to read.
  return body + html;
}

// ------------------------------------------------------------------
// Pinned note
//
// Three notepads live in site_settings under 'notes'; a post stores which one
// it wants in posts.pinned_note (1, 2, 3, or null). Because the text lives in
// settings rather than in the article, editing a note updates every article
// using it without republishing any of them.
// ------------------------------------------------------------------
function buildPinnedNote(setting, index) {
  const notes = Array.isArray(setting?.notes) ? setting.notes : [];
  const n = notes[Number(index) - 1];
  if (!n || n.active === false) return '';

  const html = sanitizeNote(n.html || '');
  if (!html.trim()) return '';

  return `
  <aside class="pinned-note">
    ${html}
  </aside>`;
}

/**
 * The note is written by the site's own editor, so this is not a defence
 * against an attacker — it is a guard against a paste from elsewhere dragging
 * a script tag or an inline handler onto every article that uses the note.
 */
function sanitizeNote(html) {
  return String(html)
    // Paired dangerous elements go with their contents, so a stripped <script>
    // does not leave its code behind as visible text on the article.
    .replace(/<(script|style|iframe|object|embed|form)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|form|input|meta|link|base)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

/* Icons are drawn inline rather than pulled from an icon font: the article page
   is where readers convert, and it should not wait on another network request
   for four small pictures. */
const ESS_ICON_PATHS = {
  'sim-card':        '<path d="M6 3h8l4 4v14H6z"/><rect x="9" y="12" width="6" height="6" rx="1"/>',
  'airplane-tilt':   '<path d="M3 13l18-8-6 16-3-6-6-2z"/>',
  'train':           '<rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10h14M8 20l-2 2M16 20l2 2"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/>',
  'credit-card':     '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  'wifi-high':       '<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16.5a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r="1"/>',
  'translate':       '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
  'map-trifold':     '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  'suitcase-rolling':'<rect x="4" y="7" width="16" height="12" rx="2"/><path d="M9 7V4h6v3M8 19v2M16 19v2"/>',
  'first-aid-kit':   '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M12 11v5M9.5 13.5h5"/>',
  'compass':         '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
};

function essIcon(name) {
  const paths = ESS_ICON_PATHS[name] || ESS_ICON_PATHS.compass;
  return `<svg class="ess-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
         `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function buildEssentialsHTML(setting, currentSlug) {
  const items = Array.isArray(setting?.items) ? setting.items : [];

  const live = items.filter(s =>
    s && s.active !== false && s.title && s.url &&
    // Never link an article to itself.
    !(currentSlug && String(s.url).replace(/\/+$/, '').endsWith(`/blog/${currentSlug}`))
  );
  if (live.length === 0) return '';

  const heading = setting?.heading || 'Before you go';
  const sub = setting?.subheading || '';

  const cards = live.map(s => {
    const external = /^https?:\/\//i.test(s.url);
    const rel = external ? ' rel="noopener"' : '';
    const target = external ? ' target="_blank"' : '';
    return `<a class="ess-card" href="${escAttr(s.url)}"${target}${rel}>
      ${essIcon(s.icon)}
      <span class="ess-text">
        <strong>${escAttr(s.title)}</strong>
        ${s.blurb ? `<em>${escAttr(s.blurb)}</em>` : ''}
      </span>
    </a>`;
  }).join('\n');

  return `
<aside class="essentials-box" aria-label="${escAttr(heading)}">
  <div class="essentials-label">${escAttr(heading)}</div>
  ${sub ? `<p class="essentials-sub">${escAttr(sub)}</p>` : ''}
  <div class="essentials-grid">${cards}</div>
</aside>
`;
}

// ------------------------------------------------------------------
// Helper: strip HTML for meta description
// ------------------------------------------------------------------
function stripHTML(html) {
  return (html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------------
// Helper: format date
// ------------------------------------------------------------------
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ------------------------------------------------------------------
// Helper: escape HTML for attribute values
// ------------------------------------------------------------------
function escAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ------------------------------------------------------------------
// Helper: escape for JSON-LD
// ------------------------------------------------------------------
function escJSON(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '');
}

// ------------------------------------------------------------------
// 404 page
// ------------------------------------------------------------------
function notFoundHTML() {
  return `<!DOCTYPE html>
<html lang="en-US">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Post Not Found - Korea Decode</title>
<link href="https://fonts.googleapis.com/css2?family=Syncopate:wght@700&family=Space+Grotesk:wght@300;500;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--bg-main:#000;--bg-sec:#111;--text-white:#fff;--text-gray:#888;--accent:#CCFF00;--border:1px solid rgba(255,255,255,0.15)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Space Grotesk',sans-serif;background:var(--bg-main);color:var(--text-white);min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 20px}
h1{font-family:'Syncopate',sans-serif;font-size:6rem;color:var(--accent);margin-bottom:20px}
p{font-size:1.2rem;color:var(--text-gray);margin-bottom:30px}
a{display:inline-block;padding:14px 32px;border:1px solid var(--accent);color:var(--accent);font-weight:700;text-decoration:none;text-transform:uppercase;letter-spacing:1px;transition:0.3s}
a:hover{background:var(--accent);color:#000}
</style>
</head>
<body>
<h1>404</h1>
<p>The article you're looking for doesn't exist or has been removed.</p>
<a href="/">Back to Korea Decode</a>
</body>
</html>`;
}

// ------------------------------------------------------------------
// Full post page HTML
// ------------------------------------------------------------------
function buildPostHTML(post, relatedPosts, pinnedNoteHTML = '') {
  const description = stripHTML(post.content).slice(0, 160);
  const canonicalURL = `https://koreadecode.com/blog/${post.slug}`;
  const date = formatDate(post.created_at);
  const isoDate = post.created_at ? new Date(post.created_at).toISOString() : '';
  const isoModified = post.updated_at ? new Date(post.updated_at).toISOString() : isoDate;
  const views = post.views || 0;
  const writerName = post.writer_name || 'Korea Decode Editorial';
  const writerJob = post.writer_job || 'Editor';
  const writerBio = post.writer_bio || 'Sharing the best of Korea.';
  const writerAvatar = post.writer_avatar || (writerName ? writerName[0] : 'K');

  // --- JSON-LD ---
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": post.title,
    "datePublished": isoDate,
    "dateModified": isoModified,
    "author": {
      "@type": "Person",
      "name": writerName
    },
    "publisher": {
      "@type": "Organization",
      "name": "Korea Decode",
      "url": "https://koreadecode.com/"
    },
    "description": description,
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": canonicalURL
    }
  };
  if (post.image) jsonLd.image = post.image;
  if (post.category) jsonLd.articleSection = post.category;

  // --- Related posts HTML ---
  let relatedHTML = '';
  if (relatedPosts && relatedPosts.length > 0) {
    const cards = relatedPosts.map(r => {
      const rDate = formatDate(r.created_at);
      return `<a href="/blog/${escAttr(r.slug)}" class="related-card">
        ${r.image ? `<img src="${escAttr(r.image)}" alt="${escAttr(r.title)}" class="related-img" loading="lazy">` : '<div class="related-img related-img-placeholder"></div>'}
        <div class="related-meta">${escAttr(r.category)} &mdash; ${rDate}</div>
        <div class="related-title">${escAttr(r.title)}</div>
      </a>`;
    }).join('\n');

    relatedHTML = `
    <section class="related-section">
      <div class="section-label">RELATED ARTICLES</div>
      <div class="related-grid">${cards}</div>
    </section>`;
  }

  return `<!DOCTYPE html>
<html lang="en-US">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escAttr(post.title)} - Korea Decode</title>
<meta name="description" content="${escAttr(description)}">
<link rel="canonical" href="${canonicalURL}">

<!-- Open Graph -->
<meta property="og:locale" content="en_US">
<meta property="og:type" content="article">
<meta property="og:title" content="${escAttr(post.title)} - Korea Decode">
<meta property="og:description" content="${escAttr(description)}">
<meta property="og:url" content="${canonicalURL}">
<meta property="og:site_name" content="Korea Decode">
${post.image ? `<meta property="og:image" content="${escAttr(post.image)}">` : ''}
<meta property="article:published_time" content="${isoDate}">
<meta property="article:modified_time" content="${isoModified}">
${post.category ? `<meta property="article:section" content="${escAttr(post.category)}">` : ''}

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(post.title)} - Korea Decode">
<meta name="twitter:description" content="${escAttr(description)}">
${post.image ? `<meta name="twitter:image" content="${escAttr(post.image)}">` : ''}

<!-- JSON-LD -->
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>

<!-- GA4 + AdSense: loaded only after cookie consent -->
<script>
(function(){
  if(localStorage.getItem('cookie_consent')!=='accepted') return;
  var gs=document.createElement('script');gs.async=true;
  gs.src='https://www.googletagmanager.com/gtag/js?id=G-487F519VEM';
  document.head.appendChild(gs);
  window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
  window.gtag=gtag;gtag('js',new Date());gtag('config','G-487F519VEM');
  var as=document.createElement('script');as.async=true;as.crossOrigin='anonymous';
  as.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6660181512354238';
  document.head.appendChild(as);
})();
</script>

<!-- Fonts -->
<link href="https://fonts.googleapis.com/css2?family=Syncopate:wght@700&family=Space+Grotesk:wght@300;500;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">

<style>
/* --- Variables --- */
:root {
  --bg-main: #000000;
  --bg-sec: #111111;
  --text-white: #FFFFFF;
  --text-gray: #888888;
  --accent: #CCFF00;
  --accent-glow: 0 0 20px rgba(204,255,0,0.4);
  --border: 1px solid rgba(255,255,255,0.15);
}

/* --- Reset --- */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(--bg-main); }
::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }

body {
  font-family: 'Space Grotesk', sans-serif;
  background: var(--bg-main);
  color: var(--text-white);
  -webkit-font-smoothing: antialiased;
  line-height: 1.6;
}
a { text-decoration: none; color: inherit; }

/* --- Header --- */
.site-header {
  position: sticky; top: 0; z-index: 100;
  background: rgba(0,0,0,0.92);
  backdrop-filter: blur(12px);
  border-bottom: var(--border);
  padding: 0 40px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.header-logo {
  font-family: 'Syncopate', sans-serif;
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--text-white);
}
.header-logo span { color: var(--accent); }
.header-nav {
  display: flex;
  gap: 28px;
  align-items: center;
}
.header-nav a {
  color: var(--text-gray);
  font-size: 0.85rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 1px;
  transition: color 0.2s;
}
.header-nav a:hover { color: var(--accent); }

/* --- Hero Image --- */
.hero-image-wrap {
  width: 100%;
  max-height: 520px;
  overflow: hidden;
  position: relative;
}
.hero-image-wrap img {
  width: 100%;
  height: 520px;
  object-fit: cover;
  display: block;
  filter: brightness(0.85);
}
.hero-image-overlay {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 160px;
  background: linear-gradient(transparent, var(--bg-main));
}

/* --- Article Container --- */
.article-container {
  max-width: 780px;
  margin: 0 auto;
  padding: 0 24px 80px;
}

/* --- Post Meta --- */
.post-meta-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 32px;
  margin-bottom: 20px;
}
.meta-category {
  background: var(--accent);
  color: #000;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  padding: 5px 14px;
}
.meta-date, .meta-views {
  color: var(--text-gray);
  font-size: 0.85rem;
}
.meta-views::before {
  content: '';
  display: inline-block;
  width: 4px; height: 4px;
  background: var(--text-gray);
  border-radius: 50%;
  margin-right: 10px;
  vertical-align: middle;
}

/* --- Post Title --- */
.post-title {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 2.8rem;
  font-weight: 700;
  line-height: 1.15;
  margin-bottom: 40px;
  color: var(--text-white);
}

/* --- Post Content --- */
.post-content {
  font-family: 'Inter', sans-serif;
  font-size: 1.12rem;
  line-height: 1.9;
  color: #ccc;
}
.post-content h2 {
  font-family: 'Space Grotesk', sans-serif;
  color: var(--accent);
  font-size: 1.6rem;
  margin-top: 48px;
  margin-bottom: 16px;
  line-height: 1.3;
}
.post-content h3 {
  font-family: 'Space Grotesk', sans-serif;
  color: var(--text-white);
  font-size: 1.3rem;
  margin-top: 36px;
  margin-bottom: 12px;
}
.post-content p {
  margin-bottom: 20px;
}
.post-content img {
  max-width: 100%;
  height: auto;
  margin: 32px 0;
  border: 1px solid rgba(255,255,255,0.1);
  display: block;
}
.post-content a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.post-content a:hover {
  text-decoration-color: var(--accent);
}
.post-content ul, .post-content ol {
  margin-bottom: 20px;
  padding-left: 24px;
}
.post-content li {
  margin-bottom: 8px;
}
.post-content blockquote {
  border-left: 3px solid var(--accent);
  padding: 16px 24px;
  margin: 28px 0;
  background: var(--bg-sec);
  color: #ddd;
  font-style: italic;
}
/* --- Affiliate Widgets --- */
.affiliate-widget {
  margin: 32px 0;
  padding: 16px;
  text-align: center;
  min-height: 80px;
  background: rgba(255,255,255,0.02);
  border-radius: 8px;
}
.affiliate-widget ins {
  display: block;
}
.affiliate-placeholder {
  display: none; /* Hide admin placeholders if they leak through */
}

.post-content table {
  width: 100%;
  border-collapse: collapse;
  margin: 28px 0;
}
.post-content th, .post-content td {
  border: 1px solid rgba(255,255,255,0.15);
  padding: 12px 16px;
  text-align: left;
}
.post-content th {
  background: var(--bg-sec);
  color: var(--accent);
  font-weight: 700;
  text-transform: uppercase;
  font-size: 0.85rem;
  letter-spacing: 0.5px;
}

/* --- Pinned note: sits between the headline and the first paragraph --- */
.pinned-note {
  margin: 28px 0 36px;
  padding: 20px 24px;
  background: var(--bg-sec);
  border: 1px solid rgba(255,255,255,0.12);
  border-left: 3px solid var(--accent);
  border-radius: 4px;
  font-size: 1.02rem;
  line-height: 1.75;
  color: #d6d6d6;
}
.pinned-note > *:first-child { margin-top: 0; }
.pinned-note > *:last-child { margin-bottom: 0; }
.pinned-note p { margin: 0 0 12px; }
.pinned-note h2, .pinned-note h3 {
  font-family: 'Space Grotesk', sans-serif;
  color: var(--text-white);
  margin: 0 0 10px;
  line-height: 1.3;
}
.pinned-note h2 { font-size: 1.25rem; }
.pinned-note h3 { font-size: 1.08rem; }
.pinned-note strong { color: var(--text-white); }
.pinned-note a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
.pinned-note ul, .pinned-note ol { margin: 0 0 12px; padding-left: 22px; }
.pinned-note li { margin-bottom: 6px; }
.pinned-note blockquote {
  margin: 12px 0;
  padding-left: 14px;
  border-left: 2px solid rgba(255,255,255,0.2);
  color: var(--text-gray);
}
.pinned-note img { max-width: 100%; height: auto; border-radius: 4px; }

/* --- "Before you go" essentials box --- */
.essentials-box {
  margin: 48px 0;
  padding: 26px 28px;
  background: var(--bg-sec);
  border: 1px solid rgba(255,255,255,0.12);
  border-left: 3px solid var(--accent);
  border-radius: 4px;
}
.essentials-label {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent);
}
.essentials-sub {
  font-size: 0.92rem;
  color: var(--text-gray);
  margin: 8px 0 0;
  line-height: 1.55;
}
.essentials-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
  margin-top: 18px;
}
/* These cards sit inside .post-content, where every <a> is neon and underlined.
   Undo that here: a card is a block to click, not a link inside a sentence. */
.post-content .ess-card,
.post-content .ess-card:hover {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 4px;
  background: rgba(255,255,255,0.02);
  text-decoration: none;
  color: var(--text-white);
  transition: border-color 0.2s, background 0.2s, transform 0.2s;
}
.post-content .ess-card:hover {
  border-color: var(--accent);
  background: rgba(204,255,0,0.06);
  transform: translateY(-2px);
}
.post-content .ess-card:hover strong { color: var(--accent); }
.ess-icon {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  color: var(--accent);
  margin-top: 1px;
}
.ess-text { display: block; }
.post-content .ess-card strong {
  display: block;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.35;
  color: var(--text-white);
  text-decoration: none;
  transition: color 0.2s;
}
.post-content .ess-card em {
  display: block;
  font-style: normal;
  font-size: 0.82rem;
  color: var(--text-gray);
  line-height: 1.5;
  margin-top: 4px;
  text-decoration: none;
}

/* --- Writer Card --- */
.writer-card {
  margin-top: 60px;
  padding: 32px;
  border: var(--border);
  background: var(--bg-sec);
  display: flex;
  align-items: flex-start;
  gap: 20px;
}
.writer-avatar {
  width: 56px; height: 56px;
  border-radius: 50%;
  background: var(--accent);
  color: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.4rem;
  font-weight: 700;
  flex-shrink: 0;
}
.writer-info { flex: 1; }
.writer-role {
  color: var(--accent);
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  margin-bottom: 4px;
}
.writer-name {
  font-size: 1.15rem;
  font-weight: 700;
  margin-bottom: 6px;
}
.writer-bio {
  font-size: 0.9rem;
  color: var(--text-gray);
  line-height: 1.5;
  font-family: 'Inter', sans-serif;
}

/* --- AdSense Slot --- */
.ad-slot {
  margin: 50px 0;
  padding: 20px;
  border: var(--border);
  background: var(--bg-sec);
  text-align: center;
  min-height: 120px;
}
.ad-slot-label {
  font-size: 0.65rem;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 2px;
  margin-bottom: 10px;
}

/* --- Related Posts --- */
.related-section {
  margin-top: 70px;
  padding-top: 40px;
  border-top: var(--border);
}
.section-label {
  font-family: 'Syncopate', sans-serif;
  font-size: 1rem;
  color: var(--accent);
  letter-spacing: 2px;
  margin-bottom: 28px;
}
.related-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  border-top: var(--border);
  border-left: var(--border);
}
.related-card {
  border-right: var(--border);
  border-bottom: var(--border);
  padding: 20px;
  transition: background 0.3s;
  display: block;
}
.related-card:hover {
  background: #1a1a1a;
}
.related-card:hover .related-title {
  color: var(--accent);
}
.related-img {
  width: 100%;
  aspect-ratio: 4/3;
  object-fit: cover;
  display: block;
  margin-bottom: 14px;
  filter: brightness(0.8);
  transition: filter 0.3s;
}
.related-card:hover .related-img {
  filter: brightness(1.1);
}
.related-img-placeholder {
  background: var(--bg-sec);
}
.related-meta {
  font-size: 0.75rem;
  color: var(--text-gray);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}
.related-title {
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.35;
  transition: color 0.3s;
}

/* --- Footer --- */
.site-footer {
  background: var(--bg-sec);
  color: var(--text-gray);
  padding: 40px 20px;
  text-align: center;
  font-size: 0.85rem;
  border-top: var(--border);
  margin-top: 60px;
}
.footer-links {
  margin-bottom: 16px;
  display: flex;
  justify-content: center;
  gap: 24px;
  flex-wrap: wrap;
}
.footer-links a {
  color: #aaa;
  transition: color 0.2s;
}
.footer-links a:hover { color: var(--accent); }

/* --- Back to top --- */
.back-top {
  position: fixed;
  bottom: 30px;
  right: 30px;
  width: 44px; height: 44px;
  background: var(--accent);
  color: #000;
  border: none;
  border-radius: 50%;
  font-size: 1.3rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s, transform 0.3s;
  z-index: 50;
}
.back-top.show {
  opacity: 1;
  pointer-events: auto;
}
.back-top:hover {
  transform: translateY(-3px);
  box-shadow: var(--accent-glow);
}

/* --- Responsive --- */
@media (max-width: 1024px) {
  .related-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 768px) {
  .site-header { padding: 0 20px; }
  .header-nav { gap: 16px; }
  .header-nav a { font-size: 0.75rem; }
  .hero-image-wrap img { height: 300px; }
  .post-title { font-size: 2rem; }
  .post-content { font-size: 1.05rem; }
  .related-grid { grid-template-columns: 1fr; border-left: none; }
  .related-card { border-left: none; }
  .writer-card { flex-direction: column; align-items: center; text-align: center; }
  .article-container { padding: 0 16px 60px; }
  .essentials-box { padding: 20px 18px; margin: 36px 0; }
  .essentials-grid { grid-template-columns: 1fr; }
  .pinned-note { padding: 16px 18px; margin: 22px 0 28px; font-size: 0.98rem; }
}
@media (max-width: 480px) {
  .post-title { font-size: 1.65rem; }
  .header-nav { gap: 10px; }
  .header-nav a { font-size: 0.7rem; letter-spacing: 0.5px; }
}
</style>
</head>
<body>

<!-- Header -->
<header class="site-header">
  <a href="/" class="header-logo">KOREA DECODE<span>.</span></a>
  <nav class="header-nav">
    <a href="/">Home</a>
    <a href="/blog">Blog</a>
    <a href="/about">About</a>
    <a href="/contact">Contact</a>
  </nav>
</header>

<!-- Hero Image -->
${post.image ? `
<div class="hero-image-wrap">
  <img src="${escAttr(post.image)}" alt="${escAttr(post.title)}">
  <div class="hero-image-overlay"></div>
</div>` : ''}

<!-- Article -->
<main class="article-container">

  <!-- Meta -->
  <div class="post-meta-bar">
    ${post.category ? `<span class="meta-category">${escAttr(post.category)}</span>` : ''}
    <span class="meta-date">${date}</span>
    <span class="meta-views">${views.toLocaleString('en-US')} views</span>
  </div>

  <!-- Title -->
  <h1 class="post-title">${escAttr(post.title)}</h1>

  ${pinnedNoteHTML}

  <!-- Content -->
  <article class="post-content">
    ${post.content || ''}
  </article>

  <!-- Writer Card -->
  <div class="writer-card">
    <div class="writer-avatar">${escAttr(writerAvatar)}</div>
    <div class="writer-info">
      <div class="writer-role">${escAttr(writerJob)}</div>
      <div class="writer-name">${escAttr(writerName)}</div>
      <div class="writer-bio">${escAttr(writerBio)}</div>
    </div>
  </div>

  <!-- AdSense Ad Slot -->
  <div class="ad-slot">
    <div class="ad-slot-label">Advertisement</div>
    <ins class="adsbygoogle"
         style="display:block"
         data-ad-client="ca-pub-6660181512354238"
         data-ad-slot="auto"
         data-ad-format="auto"
         data-full-width-responsive="true"></ins>
    <script>if(localStorage.getItem('cookie_consent')==='accepted'){(adsbygoogle = window.adsbygoogle || []).push({});}</script>
  </div>

  ${relatedHTML}

</main>

<!-- Footer -->
<footer class="site-footer">
  <div class="footer-links">
    <a href="/about">About Us</a>
    <a href="/contact">Contact</a>
    <a href="/privacy-policy">Privacy Policy</a>
    <a href="/terms">Terms of Service</a>
  </div>
  <p>&copy; 2026 Korea Decode. All rights reserved.</p>
</footer>

<!-- Cookie Consent Banner -->
<div id="cookie-banner" style="display:none;position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#111;border-top:1px solid #333;padding:20px 24px;">
  <div style="max-width:780px;margin:0 auto;display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
    <div style="flex:1;min-width:250px;">
      <p style="font-family:Inter,sans-serif;font-size:0.85rem;color:#aaa;line-height:1.6;margin:0;">We use cookies for analytics and personalized ads. By clicking "Accept All," you consent to our use of cookies. See our <a href="/privacy-policy" style="color:#CCFF00;text-decoration:underline;">Privacy Policy</a>. Learn about <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener" style="color:#CCFF00;text-decoration:underline;">how Google uses your data</a>.</p>
    </div>
    <div style="display:flex;gap:10px;flex-shrink:0;">
      <button id="ck-accept" style="padding:10px 20px;background:#CCFF00;color:#000;font-weight:600;border:none;cursor:pointer;font-family:Space Grotesk,sans-serif;font-size:0.85rem;">Accept All</button>
      <button id="ck-reject" style="padding:10px 20px;background:transparent;color:#aaa;border:1px solid #444;cursor:pointer;font-family:Space Grotesk,sans-serif;font-size:0.85rem;">Reject</button>
    </div>
  </div>
</div>
<script>
(function(){
  var b=document.getElementById('cookie-banner');
  if(!localStorage.getItem('cookie_consent')){b.style.display='block';}
  document.getElementById('ck-accept').addEventListener('click',function(){
    localStorage.setItem('cookie_consent','accepted');b.style.display='none';
    // Load GA4 + AdSense after consent
    var gs=document.createElement('script');gs.async=true;
    gs.src='https://www.googletagmanager.com/gtag/js?id=G-487F519VEM';
    document.head.appendChild(gs);
    window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
    window.gtag=gtag;gtag('js',new Date());gtag('config','G-487F519VEM');
    var as=document.createElement('script');as.async=true;as.crossOrigin='anonymous';
    as.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6660181512354238';
    document.head.appendChild(as);
  });
  document.getElementById('ck-reject').addEventListener('click',function(){
    localStorage.setItem('cookie_consent','rejected');b.style.display='none';
  });
})();
</script>

<!-- Affiliate click tracking (GA4 outbound events) -->
<script src="/assets/js/affiliate-tracking.js" defer></script>

<!-- Back to top -->
<button class="back-top" id="backTop" aria-label="Back to top">&uarr;</button>
<script>
(function(){
  var btn=document.getElementById('backTop');
  window.addEventListener('scroll',function(){
    btn.classList.toggle('show',window.scrollY>400);
  });
  btn.addEventListener('click',function(){
    window.scrollTo({top:0,behavior:'smooth'});
  });
})();
</script>

</body>
</html>`;
}

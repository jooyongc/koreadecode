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

  // --- Build HTML ---
  const html = buildPostHTML(post, relatedPosts);

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
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
function buildPostHTML(post, relatedPosts) {
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

<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-487F519VEM"></script>
<script>
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());gtag('config','G-487F519VEM');
</script>

<!-- Google AdSense -->
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6660181512354238" crossorigin="anonymous"></script>

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
    <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
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

const fs = require('fs');
const path = require('path');

const WP_URL = 'https://koreadecode.mycafe24.com';
const API_URL = `${WP_URL}/wp-json/wp/v2/posts?_embed&per_page=100`;

// CSS from index.html to maintain the look
const STYLES = `
    /* --- [1. Neo Trend Variables (Acid & Dark)] --- */
    :root {
        --bg-main: #000000;
        --bg-sec: #111111;
        --text-white: #FFFFFF;
        --text-gray: #888888;
        --accent: #CCFF00; 
        --accent-glow: 0 0 20px rgba(204, 255, 0, 0.4);
        --border: 1px solid rgba(255, 255, 255, 0.15);
        --border-accent: 1px solid var(--accent);
        --nav-width: 80px;
        --header-height: 50px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    ::-webkit-scrollbar { width: 0px; background: transparent; }

    body {
        font-family: 'Space Grotesk', sans-serif;
        background-color: var(--bg-main);
        color: var(--text-white);
        overflow-x: hidden;
        -webkit-font-smoothing: antialiased;
    }

    a { text-decoration: none; color: inherit; cursor: pointer; }

    .post-wrapper {
        max-width: 900px;
        margin: 0 auto;
        padding: 80px 20px;
    }

    .back-btn {
        display: inline-flex; align-items: center; gap: 10px;
        color: var(--text-gray); font-size: 1.2rem; margin-bottom: 40px;
        transition: 0.3s;
    }
    .back-btn:hover { color: var(--accent); }

    .post-cat {
        color: var(--accent); border: 1px solid var(--accent);
        padding: 5px 15px; border-radius: 50px; font-weight: 700;
        display: inline-block; margin-bottom: 20px;
        text-transform: uppercase;
    }

    .post-title {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 3rem; line-height: 1.2; font-weight: 700; margin-bottom: 20px;
    }

    .post-date { color: #666; margin-bottom: 40px; }

    .post-img {
        width: 100%; height: auto; border-radius: 20px; margin-bottom: 50px;
        border: 1px solid #333;
    }

    .post-content {
        font-family: 'Inter', sans-serif; font-size: 1.2rem; line-height: 1.8; color: #ddd;
    }
    .post-content h2 { color: var(--accent); margin-top: 50px; font-family: 'Space Grotesk'; font-size: 2rem; }
    .post-content h3 { color: #fff; margin-top: 40px; font-size: 1.5rem; }
    .post-content p { margin-bottom: 20px; }
    .post-content img { max-width: 100%; height: auto; margin: 30px 0; border-radius: 10px; }
    .post-content ul, .post-content ol { margin-bottom: 20px; padding-left: 20px; }
    .post-content li { margin-bottom: 10px; }
    
    .responsive-iframe {
        width: 100%; 
        height: 200px; 
        border: none;
        margin-top: 60px;
    }

    @media (max-width: 768px) {
        .post-title { font-size: 2rem; }
        .post-wrapper { padding: 40px 20px; }
    }
`;

async function fetchPosts() {
    console.log('Fetching posts from WordPress...');
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`Failed to fetch posts: ${res.statusText}`);
    return await res.json();
}

async function fetchCategories() {
    console.log('Fetching categories...');
    const res = await fetch(`${WP_URL}/wp-json/wp/v2/categories`);
    if (!res.ok) return {}; 
    const cats = await res.json();
    const map = {};
    cats.forEach(c => map[c.id] = c.name);
    return map;
}

function getImg(p) { 
    return p._embedded?.['wp:featuredmedia']?.[0]?.source_url || 'https://images.unsplash.com/photo-1550424683-1498c8c52d8e?w=800'; 
}

function generateHtml(post, catName) {
    const title = post.title.rendered;
    const content = post.content.rendered;
    const date = new Date(post.date).toDateString();
    const imgUrl = getImg(post);
    const slug = post.slug;
    
    // SEO description (stripped content)
    const excerpt = post.excerpt.rendered.replace(/<[^>]*>?/gm, '').slice(0, 160).trim();

    return `<!DOCTYPE html>
<html lang="en-US">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} | Korea Decode</title>
    <meta name="description" content="${excerpt}">
    <link rel="canonical" href="https://koreadecode.com/posts/${slug}.html">
    
    <!-- Open Graph -->
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${excerpt}">
    <meta property="og:image" content="${imgUrl}">
    <meta property="og:type" content="article">
    
    <!-- Google Fonts & Icons -->
    <link href="https://fonts.googleapis.com/css2?family=Syncopate:wght@700&family=Space+Grotesk:wght@300;500;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/@phosphor-icons/web"></script>

    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-487F519VEM"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-487F519VEM');
    </script>
    
    <!-- Google AdSense -->
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6660181512354238" crossorigin="anonymous"></script>

    <style>
        ${STYLES}
    </style>
</head>
<body>

    <div class="post-wrapper">
        <a href="/" class="back-btn"><i class="ph ph-arrow-left"></i> BACK TO FEED</a>
        
        <div>
            <span class="post-cat">${catName}</span>
            <h1 class="post-title">${title}</h1>
            <div class="post-date">${date}</div>
        </div>

        <img src="${imgUrl}" class="post-img" alt="${title}">

        <div class="post-content">
            ${content}
        </div>

        <!-- Ad Banner -->
        <iframe class="responsive-iframe" src="https://www.trip.com/partners/ad/S9752059?Allianceid=4817513&amp;SID=76470416&amp;trip_sub1=" frameborder="0" scrolling="no"></iframe>
        
        <!-- Footer -->
        <div style="margin-top: 80px; border-top: 1px solid #333; padding-top: 40px; text-align: center; color: #666;">
            <p>&copy; 2026 Korea Decode. <a href="/" style="color:#aaa">Home</a></p>
        </div>
    </div>

</body>
</html>`;
}

async function run() {
    try {
        const [posts, catMap] = await Promise.all([fetchPosts(), fetchCategories()]);
        
        console.log(`Found ${posts.length} posts.`);
        
        if (!fs.existsSync('posts')){
            fs.mkdirSync('posts');
        }

        for (const post of posts) {
            const catId = post.categories && post.categories.length ? post.categories[0] : null;
            const catName = catMap[catId] || 'NEWS';
            
            const html = generateHtml(post, catName);
            const fileName = `posts/${post.slug}.html`;
            
            fs.writeFileSync(fileName, html);
            console.log(`Generated: ${fileName}`);
        }
        
        console.log('All posts generated successfully.');

    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

run();

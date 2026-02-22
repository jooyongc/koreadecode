const fs = require('fs');
const path = require('path');

const POSTS_DIR = path.join(__dirname, '..', 'posts');

const FULL_FOOTER = `
        <!-- Footer -->
        <div style="margin-top: 80px; border-top: 1px solid #333; padding-top: 40px; text-align: center; color: #666;">
            <div style="margin-bottom: 20px;">
                <a href="/" style="color: #ccc; margin: 0 10px; text-decoration: none;">Home</a>
                <a href="/about.html" style="color: #ccc; margin: 0 10px; text-decoration: none;">About Us</a>
                <a href="/contact.html" style="color: #ccc; margin: 0 10px; text-decoration: none;">Contact</a>
                <a href="/privacy-policy.html" style="color: #ccc; margin: 0 10px; text-decoration: none;">Privacy Policy</a>
                <a href="/terms.html" style="color: #ccc; margin: 0 10px; text-decoration: none;">Terms of Service</a>
            </div>
            <p>&copy; 2026 Korea Decode. All rights reserved.</p>
        </div>`;

function extractMeta(html) {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch ? titleMatch[1].replace(' | Korea Decode', '').trim() : '';

    const descMatch = html.match(/<meta name="description" content="([^"]*)">/);
    const description = descMatch ? descMatch[1] : '';

    const canonicalMatch = html.match(/<link rel="canonical" href="([^"]*)">/);
    const canonical = canonicalMatch ? canonicalMatch[1] : '';

    const imageMatch = html.match(/<meta property="og:image" content="([^"]*)">/);
    const image = imageMatch ? imageMatch[1] : '';

    const catMatch = html.match(/<span class="post-cat">([^<]+)<\/span>/);
    const category = catMatch ? catMatch[1] : 'News';

    const dateMatch = html.match(/<div class="post-date">([^<]+)<\/div>/);
    const dateStr = dateMatch ? dateMatch[1].trim() : '';

    let isoDate = '';
    if (dateStr) {
        try {
            isoDate = new Date(dateStr).toISOString();
        } catch (e) {
            isoDate = new Date().toISOString();
        }
    }

    return { title, description, canonical, image, category, isoDate };
}

function buildJsonLd(meta) {
    const schema = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": meta.title,
        "description": meta.description,
        "datePublished": meta.isoDate,
        "dateModified": meta.isoDate,
        "author": {
            "@type": "Organization",
            "name": "Korea Decode"
        },
        "publisher": {
            "@type": "Organization",
            "name": "Korea Decode",
            "url": "https://koreadecode.com/"
        },
        "mainEntityOfPage": {
            "@type": "WebPage",
            "@id": meta.canonical
        },
        "articleSection": meta.category
    };
    if (meta.image) {
        schema.image = meta.image;
    }
    return JSON.stringify(schema, null, 8);
}

function patchFile(filePath) {
    let html = fs.readFileSync(filePath, 'utf8');
    const meta = extractMeta(html);

    if (!meta.title) {
        console.log(`  SKIP (no title): ${path.basename(filePath)}`);
        return false;
    }

    // 1. Add JSON-LD if not present
    if (!html.includes('application/ld+json')) {
        const jsonLd = buildJsonLd(meta);
        const schemaTag = `\n    <!-- Article JSON-LD -->\n    <script type="application/ld+json">\n    ${jsonLd}\n    </script>\n`;
        // Insert before </head>
        html = html.replace('</head>', schemaTag + '</head>');
    }

    // 2. Add loading="lazy" to Trip.com iframe if not present
    if (html.includes('trip.com/partners/ad') && !html.includes('loading="lazy"')) {
        html = html.replace(
            /(<iframe[^>]*trip\.com\/partners\/ad[^>]*)(>)/,
            '$1 loading="lazy"$2'
        );
    }

    // 3. Replace minimal footer with full footer
    const minimalFooterPattern = /<!-- Footer -->\s*<div style="margin-top: 80px; border-top: 1px solid #333; padding-top: 40px; text-align: center; color: #666;">\s*<p>&copy; 2026 Korea Decode\. <a href="\/" style="color:#aaa">Home<\/a><\/p>\s*<\/div>/;
    if (minimalFooterPattern.test(html)) {
        html = html.replace(minimalFooterPattern, FULL_FOOTER.trim());
    }

    fs.writeFileSync(filePath, html);
    return true;
}

function run() {
    const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.html'));
    console.log(`Found ${files.length} post files to patch.\n`);

    let patched = 0;
    let skipped = 0;

    for (const file of files) {
        const filePath = path.join(POSTS_DIR, file);
        console.log(`Processing: ${file}`);
        if (patchFile(filePath)) {
            patched++;
            console.log(`  OK`);
        } else {
            skipped++;
        }
    }

    console.log(`\nDone. Patched: ${patched}, Skipped: ${skipped}`);
}

run();

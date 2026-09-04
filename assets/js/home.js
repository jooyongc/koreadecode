/**
 * Korea Decode — Home Page JavaScript
 * Fetches latest posts, renders cards, handles category filtering, populates stats.
 *
 * 2026 redesign: categories are now Book / Plan / Shop / Eat.
 * Legacy posts (K-Food, K-Beauty, Travel, K-Pop, Culture) are mapped on the fly,
 * so nothing in Supabase has to be migrated for the filters to work.
 */

import { supabase } from '/assets/js/supabase-config.js';
import { normalizeCategory, categoryFilterValues } from '/assets/js/categories.js';

export { CATEGORIES, normalizeCategory, categoryFilterValues } from '/assets/js/categories.js';

const POSTS_LIMIT = 6;
const DEFAULT_IMAGE = 'https://images.unsplash.com/photo-1550424683-1498c8c52d8e?w=800&q=80';

/* ============================================================
   HELPERS
   ============================================================ */

/**
 * Format a date string into a human-readable format.
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date like "Jan 15, 2026"
 */
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

/**
 * Escape a string for safe insertion into HTML.
 * @param {string} str
 * @returns {string}
 */
function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Get the post URL. Uses slug if available, falls back to id-based URL.
 * @param {object} post
 * @returns {string}
 */
function getPostUrl(post) {
    if (post.slug) {
        return `/blog/${post.slug}`;
    }
    return `/post.html?id=${post.id}`;
}

/**
 * Create an HTML string for a post card.
 * @param {object} post - Post object from Supabase
 * @returns {string} HTML string
 */
function createPostCard(post) {
    const image = post.image || DEFAULT_IMAGE;
    const category = normalizeCategory(post.category);
    const title = post.title || 'Untitled';
    const date = formatDate(post.created_at);
    const views = post.views || 0;
    const url = getPostUrl(post);

    // Extract a short excerpt from content if available
    let excerpt = '';
    if (post.excerpt) {
        excerpt = post.excerpt;
    } else if (post.content) {
        const stripped = post.content.replace(/<[^>]*>/g, '');
        excerpt = stripped.substring(0, 120).trim();
        if (stripped.length > 120) excerpt += '...';
    }

    return `
        <a href="${esc(url)}" class="card fade-in-up" data-cat="${esc(category)}" style="text-decoration:none;color:inherit;">
            <div class="card-image">
                <img src="${esc(image)}" alt="${esc(title)}" loading="lazy">
            </div>
            <div class="card-body">
                <div class="card-category">${esc(category)}</div>
                <h3 class="card-title">${esc(title)}</h3>
                ${excerpt ? `<p class="card-excerpt">${esc(excerpt)}</p>` : ''}
                <div class="card-meta">
                    <span class="card-meta-item">
                        <i class="ph ph-calendar-blank"></i>
                        ${date}
                    </span>
                    <span class="card-meta-item">
                        <i class="ph ph-eye"></i>
                        ${views.toLocaleString()}
                    </span>
                </div>
            </div>
        </a>
    `;
}

/* ============================================================
   DATA
   ============================================================ */

/**
 * Fetch the latest published posts from Supabase.
 * @param {string|null} category - 'all' or one of CATEGORIES
 * @param {number} limit - Number of posts to fetch
 * @returns {Promise<Array>}
 */
async function fetchLatestPosts(category = null, limit = POSTS_LIMIT) {
    let query = supabase
        .from('posts')
        .select('id, title, slug, category, image, content, views, status, created_at')
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(limit);

    if (category && category !== 'all') {
        query = query.in('category', categoryFilterValues(category));
    }

    const { data, error } = await query;
    if (error) {
        console.error('[Home] Error fetching posts:', error);
        return [];
    }
    return data || [];
}

/**
 * Fetch total count of published posts.
 * @returns {Promise<number>}
 */
async function fetchPostCount() {
    const { count, error } = await supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'published');

    if (error) {
        console.error('[Home] Error fetching post count:', error);
        return 0;
    }
    return count || 0;
}

/* ============================================================
   RENDER
   ============================================================ */

function skeletonMarkup(count = 3) {
    return Array(count).fill(`
        <div class="card skeleton-card">
            <div class="card-image skeleton"></div>
            <div class="card-body">
                <div class="skeleton" style="height:14px;width:60px;margin-bottom:8px;"></div>
                <div class="skeleton" style="height:20px;width:100%;margin-bottom:8px;"></div>
                <div class="skeleton" style="height:14px;width:80%;"></div>
            </div>
        </div>
    `).join('');
}

/**
 * Render post cards into the grid.
 * @param {Array} posts
 */
function renderPosts(posts) {
    const grid = document.getElementById('posts-grid');
    if (!grid) return;

    if (posts.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1;">
                <p class="hand-note">Nothing here yet &mdash; I&rsquo;m working on it.</p>
                <p>No guides in this category so far. Try another one, or check back soon.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = posts.map((post, idx) => {
        const card = createPostCard(post);
        return card.replace('class="card fade-in-up"', `class="card fade-in-up delay-${(idx % 4) + 1}"`);
    }).join('');
}

/**
 * Set up category filter chip click handlers.
 */
function setupCategoryFilter() {
    const chipsContainer = document.getElementById('category-chips');
    if (!chipsContainer) return;

    chipsContainer.addEventListener('click', async (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;

        const category = chip.dataset.category;

        chipsContainer.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        const grid = document.getElementById('posts-grid');
        if (grid) grid.innerHTML = skeletonMarkup(3);

        const posts = await fetchLatestPosts(category, POSTS_LIMIT);
        renderPosts(posts);
    });
}

/**
 * Populate the stats strip with real data.
 */
async function populateStats() {
    const count = await fetchPostCount();

    const statArticles = document.getElementById('stat-articles');
    if (statArticles && count > 0) {
        statArticles.textContent = count.toLocaleString();
    }

    const { data, error } = await supabase
        .from('posts')
        .select('views')
        .eq('status', 'published');

    if (!error && data) {
        const totalViews = data.reduce((sum, p) => sum + (p.views || 0), 0);
        const statReaders = document.getElementById('stat-readers');
        if (statReaders) {
            statReaders.textContent = totalViews > 0 ? totalViews.toLocaleString() : '--';
        }
    }
}

/* ============================================================
   HERO — CMS overrides (optional)
   ============================================================ */

/**
 * Load hero settings from site_settings and apply them over the markup defaults.
 * The HTML already ships with the finished copy, so anything missing from the
 * CMS simply leaves the designed default in place — no blank hero, ever.
 */
async function loadHeroSettings() {
    try {
        const { data, error } = await supabase
            .from('site_settings')
            .select('value')
            .eq('key', 'hero')
            .single();

        if (error || !data || !data.value) {
            if (error) console.warn('[Home] No hero settings found, using page defaults:', error.message);
            return;
        }

        const h = data.value;

        // Handwritten greeting
        if (h.label) {
            const el = document.getElementById('hero-label');
            if (el) el.textContent = h.label;
        }

        // Big display title: "DECODE" / "Korea."
        const titleEl = document.getElementById('hero-title');
        if (titleEl && (h.title_top || h.title_bottom)) {
            const top = esc(h.title_top || 'DECODE');
            const bottom = esc(h.title_bottom || 'Korea');
            titleEl.innerHTML =
                `<span class="line word-decode">${top}</span>` +
                `<span class="line word-korea">${bottom}<span class="dot">.</span></span>`;
        }

        if (h.description) {
            const el = document.getElementById('hero-description');
            if (el) el.textContent = h.description;
        }

        const primary = document.getElementById('hero-cta-primary');
        if (primary) {
            if (h.cta_primary_text) primary.textContent = h.cta_primary_text;
            if (h.cta_primary_url) primary.href = h.cta_primary_url;
        }

        const secondary = document.getElementById('hero-cta-secondary');
        if (secondary) {
            if (h.cta_secondary_text) secondary.textContent = h.cta_secondary_text;
            if (h.cta_secondary_url) secondary.href = h.cta_secondary_url;
        }

        // Miss Park portrait can be swapped from the CMS
        if (h.miss_park_image) {
            const img = document.getElementById('miss-park-photo');
            if (img) img.src = h.miss_park_image;
        }

    } catch (err) {
        console.error('[Home] Failed to load hero settings:', err);
    }
}

/* ============================================================
   INIT
   ============================================================ */

export async function initHome() {
    setupCategoryFilter();
    loadHeroSettings();

    try {
        const posts = await fetchLatestPosts(null, POSTS_LIMIT);
        renderPosts(posts);
    } catch (err) {
        console.error('[Home] Failed to load posts:', err);
        const grid = document.getElementById('posts-grid');
        if (grid) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column:1/-1;">
                    <p>Unable to load guides right now. Please try again later.</p>
                </div>
            `;
        }
    }

    populateStats();
}

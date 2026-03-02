/**
 * Korea Decode — Home Page JavaScript
 * Fetches latest posts, renders cards, handles category filtering, populates stats.
 */

import { supabase } from '/assets/js/supabase-config.js';

const POSTS_LIMIT = 6;
const DEFAULT_IMAGE = 'https://images.unsplash.com/photo-1550424683-1498c8c52d8e?w=800&q=80';

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
 * Generate a URL-safe slug from a title (fallback if slug is missing).
 * @param {string} title
 * @returns {string}
 */
function generateSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
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
    const category = post.category || 'Culture';
    const title = post.title || 'Untitled';
    const date = formatDate(post.created_at);
    const views = post.views || 0;
    const url = getPostUrl(post);

    // Extract a short excerpt from content if available
    let excerpt = '';
    if (post.excerpt) {
        excerpt = post.excerpt;
    } else if (post.content) {
        // Strip HTML tags and take first 120 chars
        const stripped = post.content.replace(/<[^>]*>/g, '');
        excerpt = stripped.substring(0, 120).trim();
        if (stripped.length > 120) excerpt += '...';
    }

    return `
        <a href="${url}" class="card fade-in-up" style="text-decoration:none;color:inherit;">
            <div class="card-image">
                <img src="${image}" alt="${title}" loading="lazy">
            </div>
            <div class="card-body">
                <div class="card-category">${category}</div>
                <h3 class="card-title">${title}</h3>
                ${excerpt ? `<p class="card-excerpt">${excerpt}</p>` : ''}
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

/**
 * Fetch the latest published posts from Supabase.
 * @param {string|null} category - Optional category filter
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
        query = query.eq('category', category);
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
                <p>No posts found in this category yet. Check back soon!</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = posts.map((post, idx) => {
        const card = createPostCard(post);
        // Add stagger delay class
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

        // Update active state
        chipsContainer.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        // Show loading skeletons
        const grid = document.getElementById('posts-grid');
        if (grid) {
            grid.innerHTML = Array(3).fill(`
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

        // Fetch and render
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

    // Estimate monthly readers based on total views (rough heuristic)
    const { data, error } = await supabase
        .from('posts')
        .select('views')
        .eq('status', 'published');

    if (!error && data) {
        const totalViews = data.reduce((sum, p) => sum + (p.views || 0), 0);
        const statReaders = document.getElementById('stat-readers');
        if (statReaders) {
            // Display total views as a proxy metric
            statReaders.textContent = totalViews > 0 ? totalViews.toLocaleString() : '--';
        }
    }
}

/**
 * Load hero settings from site_settings and apply to the hero section.
 */
async function loadHeroSettings() {
    try {
        const { data, error } = await supabase
            .from('site_settings')
            .select('value')
            .eq('key', 'hero')
            .single();

        if (error || !data) return; // Use static defaults if no settings found

        const h = data.value;

        // Apply hero background image with fade-in
        const heroImg = document.querySelector('.hero-bg img');
        if (heroImg && h.bg_image) {
            heroImg.onload = () => { heroImg.style.opacity = '1'; };
            heroImg.src = h.bg_image;
        }

        // Apply hero label
        const heroLabel = document.querySelector('.hero-label');
        if (heroLabel && h.label) {
            heroLabel.textContent = h.label;
        }

        // Apply hero title
        const heroH1 = document.querySelector('.hero-content h1');
        if (heroH1 && (h.title_before || h.title_highlight || h.title_after)) {
            heroH1.innerHTML = `${h.title_before || ''} <span class="highlight">${h.title_highlight || ''}</span>${h.title_after || ''}`;
        }

        // Apply hero description
        const heroDesc = document.querySelector('.hero-description');
        if (heroDesc && h.description) {
            heroDesc.textContent = h.description;
        }

        // Apply CTA buttons
        const actions = document.querySelector('.hero-actions');
        if (actions) {
            const primaryBtn = actions.querySelector('.btn-primary');
            const secondaryBtn = actions.querySelector('.btn-outline');
            if (primaryBtn && h.cta_primary_text) {
                primaryBtn.textContent = h.cta_primary_text;
                if (h.cta_primary_url) primaryBtn.href = h.cta_primary_url;
            }
            if (secondaryBtn && h.cta_secondary_text) {
                secondaryBtn.textContent = h.cta_secondary_text;
                if (h.cta_secondary_url) secondaryBtn.href = h.cta_secondary_url;
            }
        }
    } catch (err) {
        console.error('[Home] Failed to load hero settings:', err);
    }
}

/**
 * Initialize the home page.
 */
export async function initHome() {
    // Set up category filter
    setupCategoryFilter();

    // Load hero settings from CMS
    loadHeroSettings();

    // Fetch and render latest posts
    try {
        const posts = await fetchLatestPosts(null, POSTS_LIMIT);
        renderPosts(posts);
    } catch (err) {
        console.error('[Home] Failed to load posts:', err);
        const grid = document.getElementById('posts-grid');
        if (grid) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column:1/-1;">
                    <p>Unable to load posts. Please try again later.</p>
                </div>
            `;
        }
    }

    // Populate stats
    populateStats();
}

/**
 * Korea Decode — Blog List Page JavaScript
 * Handles fetching posts with pagination, category filtering, and URL state management.
 */

import { supabase } from '/assets/js/supabase-config.js';
import { normalizeCategory, categoryFilterValues } from '/assets/js/categories.js';

const POSTS_PER_PAGE = 9;
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

    // Extract excerpt
    let excerpt = '';
    if (post.excerpt) {
        excerpt = post.excerpt;
    } else if (post.content) {
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
 * Read current filter state from URL parameters.
 * @returns {{ page: number, category: string|null }}
 */
function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const page = parseInt(params.get('page'), 10) || 1;
    const category = params.get('category') || null;
    return { page, category };
}

/**
 * Update URL parameters without a full page reload.
 * @param {number} page
 * @param {string|null} category
 */
function updateUrl(page, category) {
    const params = new URLSearchParams();
    if (page > 1) params.set('page', page);
    if (category && category !== 'all') params.set('category', category);

    const qs = params.toString();
    const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.pushState({}, '', newUrl);
}

/**
 * Fetch posts from Supabase with pagination and optional category filter.
 * @param {number} page
 * @param {string|null} category
 * @returns {Promise<{ posts: Array, totalCount: number }>}
 */
async function fetchPosts(page = 1, category = null) {
    const from = (page - 1) * POSTS_PER_PAGE;
    const to = from + POSTS_PER_PAGE - 1;

    // First, get the total count
    let countQuery = supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'published');

    if (category && category !== 'all') {
        countQuery = countQuery.in('category', categoryFilterValues(category));
    }

    const { count, error: countError } = await countQuery;
    if (countError) {
        console.error('[BlogList] Count error:', countError);
    }

    // Then fetch the actual posts
    let dataQuery = supabase
        .from('posts')
        .select('id, title, slug, category, image, content, views, status, created_at')
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .range(from, to);

    if (category && category !== 'all') {
        dataQuery = dataQuery.in('category', categoryFilterValues(category));
    }

    const { data, error } = await dataQuery;
    if (error) {
        console.error('[BlogList] Fetch error:', error);
        return { posts: [], totalCount: 0 };
    }

    return {
        posts: data || [],
        totalCount: count || 0,
    };
}

/**
 * Render post cards into the blog grid.
 * @param {Array} posts
 */
function renderPosts(posts) {
    const grid = document.getElementById('blog-grid');
    if (!grid) return;

    if (posts.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1;">
                <p>No posts found. Try a different category or check back soon!</p>
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
 * Update the post count display.
 * @param {number} showing - Number of posts currently displayed
 * @param {number} total - Total number of matching posts
 * @param {string|null} category - Current category filter
 */
function updatePostCount(showing, total, category) {
    const countEl = document.getElementById('blog-count');
    if (!countEl) return;

    const catLabel = (category && category !== 'all') ? ` in ${category}` : '';
    countEl.textContent = `Showing ${showing} of ${total} posts${catLabel}`;
}

/**
 * Render pagination controls.
 * @param {number} currentPage
 * @param {number} totalCount
 * @param {string|null} category
 */
function renderPagination(currentPage, totalCount, category) {
    const paginationEl = document.getElementById('blog-pagination');
    if (!paginationEl) return;

    const totalPages = Math.ceil(totalCount / POSTS_PER_PAGE);

    if (totalPages <= 1) {
        paginationEl.innerHTML = '';
        return;
    }

    let html = '';

    // Previous button
    html += `<button ${currentPage <= 1 ? 'disabled' : ''} data-page="${currentPage - 1}">
        <i class="ph ph-caret-left"></i>
    </button>`;

    // Page numbers
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);

    // Adjust start if we're near the end
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (startPage > 1) {
        html += `<button data-page="1">1</button>`;
        if (startPage > 2) {
            html += `<button disabled>...</button>`;
        }
    }

    for (let i = startPage; i <= endPage; i++) {
        html += `<button data-page="${i}" ${i === currentPage ? 'class="active"' : ''}>${i}</button>`;
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            html += `<button disabled>...</button>`;
        }
        html += `<button data-page="${totalPages}">${totalPages}</button>`;
    }

    // Next button
    html += `<button ${currentPage >= totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">
        <i class="ph ph-caret-right"></i>
    </button>`;

    paginationEl.innerHTML = html;

    // Attach click handlers
    paginationEl.querySelectorAll('button[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = parseInt(btn.dataset.page, 10);
            if (page && !btn.disabled) {
                loadPage(page, category);
                // Scroll to top of grid
                document.querySelector('.blog-header')?.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });
}

/**
 * Show loading skeletons in the blog grid.
 */
function showLoadingState() {
    const grid = document.getElementById('blog-grid');
    if (!grid) return;

    grid.innerHTML = Array(POSTS_PER_PAGE).fill(`
        <div class="card skeleton-card">
            <div class="card-image skeleton"></div>
            <div class="card-body">
                <div class="skeleton" style="height:14px;width:60px;margin-bottom:8px;"></div>
                <div class="skeleton" style="height:20px;width:100%;margin-bottom:8px;"></div>
                <div class="skeleton" style="height:14px;width:80%;"></div>
            </div>
        </div>
    `).join('');

    const countEl = document.getElementById('blog-count');
    if (countEl) countEl.textContent = 'Loading posts...';
}

/**
 * Load a specific page of posts.
 * @param {number} page
 * @param {string|null} category
 */
async function loadPage(page, category) {
    showLoadingState();
    updateUrl(page, category);

    const { posts, totalCount } = await fetchPosts(page, category);

    renderPosts(posts);
    updatePostCount(posts.length, totalCount, category);
    renderPagination(page, totalCount, category);
}

/**
 * Set up category filter chip click handlers.
 */
function setupCategoryFilter() {
    const chipsContainer = document.getElementById('blog-category-chips');
    if (!chipsContainer) return;

    // Set initial active state from URL
    const { category } = getUrlParams();
    if (category) {
        chipsContainer.querySelectorAll('.chip').forEach(c => {
            c.classList.remove('active');
            if (c.dataset.category === category) {
                c.classList.add('active');
            }
        });
    }

    chipsContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;

        const selectedCategory = chip.dataset.category;

        // Update active state
        chipsContainer.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        // Reset to page 1 and load with new category
        const cat = selectedCategory === 'all' ? null : selectedCategory;
        loadPage(1, cat);
    });
}

/**
 * Handle browser back/forward navigation.
 */
function setupPopState() {
    window.addEventListener('popstate', () => {
        const { page, category } = getUrlParams();
        loadPage(page, category);
    });
}

/**
 * Initialize the blog list page.
 */
export async function initBlogList() {
    setupCategoryFilter();
    setupPopState();

    // Load initial page from URL params
    const { page, category } = getUrlParams();
    await loadPage(page, category);
}

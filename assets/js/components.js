/**
 * Korea Decode — Shared Header/Footer/Navigation
 * Injects common UI into all pages
 */

const SITE_NAME = 'Korea Decode';
const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/blog', label: 'Blog' },
  { href: '/decode', label: 'Decode' },
  { href: '/about', label: 'About' },
];

function getCurrentPath() {
  const path = window.location.pathname.replace(/\/index\.html$/, '/');
  return path === '' ? '/' : path;
}

function isActive(href) {
  const current = getCurrentPath();
  if (href === '/') return current === '/';
  return current.startsWith(href);
}

export function injectHeader() {
  const header = document.getElementById('site-header');
  if (!header) return;

  const navHtml = NAV_LINKS.map(link =>
    `<a href="${link.href}" ${isActive(link.href) ? 'class="active"' : ''}>${link.label}</a>`
  ).join('');

  header.innerHTML = `
    <div class="header-inner">
      <a href="/" class="site-logo">Korea <span class="logo-accent">Decode</span></a>
      <nav class="site-nav" id="site-nav">${navHtml}</nav>
      <button class="menu-toggle" id="menu-toggle" aria-label="Toggle menu">
        <span></span><span></span><span></span>
      </button>
    </div>
  `;

  // Mobile menu toggle
  const toggle = document.getElementById('menu-toggle');
  const nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      nav.classList.toggle('open');
    });
    // Close on nav link click
    nav.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        toggle.classList.remove('open');
        nav.classList.remove('open');
      });
    });
  }

  // Hide header on scroll down, show on scroll up
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const current = window.scrollY;
    if (current > 100 && current > lastScroll) {
      header.classList.add('hidden');
    } else {
      header.classList.remove('hidden');
    }
    lastScroll = current;
  }, { passive: true });
}

export function injectFooter() {
  const footer = document.getElementById('site-footer');
  if (!footer) return;

  const year = new Date().getFullYear();

  footer.innerHTML = `
    <div class="footer-inner">
      <div class="footer-grid">
        <div class="footer-brand">
          <a href="/" class="site-logo">Korea <span class="logo-accent">Decode</span></a>
          <p>Your AI-powered guide to Korean culture, food, travel, and trends. Decoding Korea, one story at a time.</p>
        </div>
        <div class="footer-section">
          <h4>Explore</h4>
          <a href="/blog">Blog</a>
          <a href="/decode">Decode This</a>
        </div>
        <div class="footer-section">
          <h4>Categories</h4>
          <a href="/blog?category=K-Food">K-Food</a>
          <a href="/blog?category=K-Beauty">K-Beauty</a>
          <a href="/blog?category=Travel">Travel</a>
          <a href="/blog?category=K-Pop">K-Pop</a>
        </div>
        <div class="footer-section">
          <h4>Info</h4>
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
          <a href="/privacy-policy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
        </div>
      </div>
      <div class="footer-bottom">
        <span>&copy; ${year} ${SITE_NAME}. All rights reserved.</span>
        <span>Powered by AI</span>
      </div>
    </div>
  `;
}

export function initPage() {
  injectHeader();
  injectFooter();
}

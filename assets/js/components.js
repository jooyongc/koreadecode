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
        <span>Powered by <a href="https://localcontentslab.kr" target="_blank" rel="noopener">LocalContentsLab</a></span>
      </div>
    </div>
  `;
}

export function injectCookieBanner() {
  if (localStorage.getItem('cookie_consent')) return;

  const banner = document.createElement('div');
  banner.id = 'cookie-banner';
  banner.innerHTML = `
    <div class="cookie-banner-inner">
      <div class="cookie-text">
        <p>We use cookies and similar technologies to analyze traffic, personalize content, and serve targeted advertisements. By clicking "Accept All," you consent to our use of cookies. For more details, see our <a href="/privacy-policy">Privacy Policy</a>.</p>
        <p class="cookie-subtext">Third-party services include Google Analytics and Google AdSense. Learn more about <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">how Google uses data when you use our site</a>.</p>
      </div>
      <div class="cookie-actions">
        <button class="cookie-btn cookie-btn-accept" id="cookie-accept">Accept All</button>
        <button class="cookie-btn cookie-btn-reject" id="cookie-reject">Reject Non-Essential</button>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #cookie-banner {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 9999;
      background: #111;
      border-top: 1px solid #333;
      padding: 20px 24px;
      animation: slideUp 0.3s ease;
    }
    @keyframes slideUp {
      from { transform: translateY(100%); }
      to { transform: translateY(0); }
    }
    .cookie-banner-inner {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 24px;
      flex-wrap: wrap;
    }
    .cookie-text {
      flex: 1;
      min-width: 280px;
    }
    .cookie-text p {
      font-family: 'Inter', sans-serif;
      font-size: 0.85rem;
      color: #aaa;
      line-height: 1.6;
      margin: 0;
    }
    .cookie-text .cookie-subtext {
      font-size: 0.78rem;
      color: #666;
      margin-top: 6px;
    }
    .cookie-text a {
      color: #CCFF00;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .cookie-actions {
      display: flex;
      gap: 10px;
      flex-shrink: 0;
    }
    .cookie-btn {
      padding: 10px 20px;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 0.85rem;
      font-weight: 600;
      border: none;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s;
    }
    .cookie-btn-accept {
      background: #CCFF00;
      color: #000;
    }
    .cookie-btn-accept:hover {
      background: #e0ff4d;
    }
    .cookie-btn-reject {
      background: transparent;
      color: #aaa;
      border: 1px solid #444;
    }
    .cookie-btn-reject:hover {
      color: #fff;
      border-color: #666;
    }
    @media (max-width: 600px) {
      .cookie-banner-inner { flex-direction: column; }
      .cookie-actions { width: 100%; }
      .cookie-btn { flex: 1; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(banner);

  document.getElementById('cookie-accept').addEventListener('click', () => {
    localStorage.setItem('cookie_consent', 'accepted');
    banner.remove();
    // Initialize analytics now that consent is given
    import('/assets/js/analytics.js').then(m => {
      m.initGA();
      m.initAdSense();
    });
  });

  document.getElementById('cookie-reject').addEventListener('click', () => {
    localStorage.setItem('cookie_consent', 'rejected');
    banner.remove();
  });
}

export function initPage() {
  injectHeader();
  injectFooter();
  injectCookieBanner();
}

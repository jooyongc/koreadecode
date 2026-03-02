/**
 * Korea Decode — GA4 + AdSense Initialization
 */

const GA_ID = 'G-487F519VEM';
const ADSENSE_PUB = 'ca-pub-6660181512354238';

export function initGA() {
  if (window.location.hostname === 'localhost') return;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA_ID);
}

export function initAdSense() {
  if (window.location.hostname === 'localhost') return;

  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_PUB}`;
  document.head.appendChild(script);
}

export function trackEvent(action, category, label, value) {
  if (window.gtag) {
    window.gtag('event', action, {
      event_category: category,
      event_label: label,
      value: value,
    });
  }
}

export function initAnalytics() {
  initGA();
  initAdSense();
}

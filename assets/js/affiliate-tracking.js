(function () {
  function getPostSlug() {
    var m = window.location.pathname.match(/^\/blog\/([^\/?#]+)/);
    return m ? m[1] : '';
  }

  function track(presetId, href) {
    if (typeof window.gtag !== 'function') return;
    var slug = getPostSlug();
    window.gtag('event', 'affiliate_outbound_click', {
      event_category: 'deal',
      event_label: presetId || 'unknown',
      post_slug: slug,
      link_url: href || ''
    });
  }

  document.addEventListener('click', function (e) {
    var widget = e.target.closest && e.target.closest('.affiliate-widget');
    if (!widget) return;
    var link = e.target.closest('a');
    if (!link) return;
    var presetId = widget.getAttribute('data-preset') || '';
    track(presetId, link.href);
  }, true);
})();

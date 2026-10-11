// Moved out of index.html so the Content-Security-Policy can forbid inline script (P12).
  (function() {
    var hash = window.location.hash;
    var map = {
      '#services': '/services',
      '#about': '/about',
      '#regulatory': '/regulatory',
      '#resources': '/resources',
      '#faq': '/faq',
      '#contact': '/contact'
    };
    if (map[hash]) {
      window.location.replace(map[hash]);
    }
  })();

// Moved out of success.html so the Content-Security-Policy can forbid inline script (P12).
  // Read the product tier from the URL and show the correct product name
  const PRODUCT_NAMES = {
    au_compliance_core: 'AU Compliance Core',
    full_toolkit:       'Full Responsible AI Toolkit',
  };

  const params      = new URLSearchParams(window.location.search);
  const tier        = params.get('tier');
  const productName = PRODUCT_NAMES[tier] || 'Your purchase';

  document.getElementById('productName').textContent       = productName;
  document.getElementById('productNameInline').textContent = productName;

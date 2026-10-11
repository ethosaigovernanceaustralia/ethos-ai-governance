// Moved out of contact.html so the Content-Security-Policy can forbid inline script (P12).
  function toggleGeneralEnquiry() {
    var accordion = document.querySelector('.general-enquiry-accordion');
    var body = document.getElementById('generalEnquiryBody');
    var btn = document.querySelector('.general-enquiry-toggle');
    var isOpen = accordion.classList.toggle('open');
    btn.setAttribute('aria-expanded', isOpen);
    body.hidden = !isOpen;
  }

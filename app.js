/* ===================================================
   ETHOS AI GOVERNANCE — Interactive App
   Vanilla JS SPA — 7 pages, GSAP + AOS + CountUp
=================================================== */

'use strict';

// ─── State ────────────────────────────────────────
let currentPage = 'home';
const PAGES = ['home', 'services', 'about', 'regulatory', 'resources', 'faq', 'contact'];

// ─── Page Navigation ─────────────────────────────
function navigate(page) {
  if (!PAGES.includes(page)) return;

  const oldPage = document.getElementById(`page-${currentPage}`);
  const newPage = document.getElementById(`page-${page}`);
  if (!newPage) return;

  // Fade out old page
  if (oldPage && page !== currentPage) {
    oldPage.style.opacity = '0';
    oldPage.style.transform = 'translateY(10px)';
    oldPage.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    setTimeout(() => {
      oldPage.classList.remove('active');
      oldPage.style.opacity = '';
      oldPage.style.transform = '';
      oldPage.style.transition = '';
    }, 240);
  }

  // Show new page
  setTimeout(() => {
    newPage.classList.add('active');
    newPage.classList.add('page-transition-enter');
    setTimeout(() => newPage.classList.remove('page-transition-enter'), 600);

    currentPage = page;
    updateNavActive(page);
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Refresh AOS for new page
    setTimeout(() => {
      AOS.refresh();
      initBentoTilt();
      initSubnavHighlight();
      if (page === 'home') {
        initCountUp();
      }
    }, 100);
  }, page === currentPage ? 0 : 230);

  history.pushState(null, '', `#${page}`);
}

// ─── Nav Active State ─────────────────────────────
function updateNavActive(page) {
  document.querySelectorAll('[data-page]').forEach(link => {
    link.classList.remove('active');
    if (link.dataset.page === page) link.classList.add('active');
  });
}

// ─── Mobile Nav ──────────────────────────────────
function toggleMobileNav() {
  document.getElementById('mobileNav').classList.toggle('open');
}

function closeMobileNav() {
  document.getElementById('mobileNav').classList.remove('open');
}

// ─── Services sub-nav smooth scroll ──────────────
function scrollToSection(sectionId) {
  const el = document.getElementById(sectionId);
  if (!el) return;
  const subnavHeight = document.getElementById('servicesSubnav')
    ? document.getElementById('servicesSubnav').offsetHeight : 0;
  const navHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) || 80;
  const top = el.getBoundingClientRect().top + window.scrollY - navHeight - subnavHeight - 12;
  window.scrollTo({ top, behavior: 'smooth' });
  updateSubnavActive(sectionId);
}

// ─── Sub-nav active highlight on scroll ──────────
function initSubnavHighlight() {
  if (currentPage !== 'services') return;
  const sections = ['audit', 'toolkit', 'retainer', 'iso42001'];
  const navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) || 80;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        updateSubnavActive(entry.target.id);
      }
    });
  }, {
    rootMargin: `-${navH + 60}px 0px -55% 0px`,
    threshold: 0
  });

  sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });
}

function updateSubnavActive(sectionId) {
  document.querySelectorAll('.subnav-link').forEach(link => {
    link.classList.remove('active-sub');
    if (link.dataset.section === sectionId) link.classList.add('active-sub');
  });
}

// ─── FAQ Accordion ────────────────────────────────
function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  const isOpen = item.classList.contains('open');

  // Close all
  document.querySelectorAll('.faq-item.open').forEach(el => {
    el.classList.remove('open');
    el.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
  });

  // Open clicked (if it was closed)
  if (!isOpen) {
    item.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
  }
}

// ─── Contact form type switcher ───────────────────
function showContactForm(type) {
  const titleEl = document.getElementById('contactFormTitle');
  const typeInput = document.getElementById('enquiryType');
  if (!titleEl || !typeInput) return;

  const titles = {
    audit: 'Request a Free Governance Audit',
    call: 'Book a Discovery Call',
    general: 'Send an Enquiry'
  };

  titleEl.textContent = titles[type] || 'Send an Enquiry';
  typeInput.value = type;

  const form = document.getElementById('contactFormWrap');
  if (form) {
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ─── Form Handling ───────────────────────────────
function handleFormSubmit(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const successEl = document.getElementById('formSuccess');

  btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1rem;animation:spin 0.8s linear infinite;vertical-align:middle">refresh</span> Sending...';
  btn.disabled = true;

  setTimeout(() => {
    btn.innerHTML = 'Send Enquiry <span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle">arrow_forward</span>';
    btn.disabled = false;
    if (successEl) successEl.style.display = 'flex';
    e.target.reset();
  }, 1800);
}

// ─── Custom Cursor ───────────────────────────────
function initCursor() {
  const cursor = document.getElementById('cursor');
  if (!cursor || window.matchMedia('(pointer: coarse)').matches) {
    if (cursor) cursor.style.display = 'none';
    return;
  }

  let mouseX = 0, mouseY = 0;
  let cursorX = 0, cursorY = 0;

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  function animateCursor() {
    cursorX += (mouseX - cursorX) * 0.15;
    cursorY += (mouseY - cursorY) * 0.15;
    cursor.style.left = cursorX + 'px';
    cursor.style.top = cursorY + 'px';
    requestAnimationFrame(animateCursor);
  }
  animateCursor();

  const interactiveSelector = 'a, button, .service-card, .bento-card, .problem-card, .ladder-card, .guarantee-card, .faq-question, .resource-card, .philosophy-card';

  document.addEventListener('mouseover', (e) => {
    if (e.target.closest(interactiveSelector)) {
      cursor.style.width = '40px';
      cursor.style.height = '40px';
      cursor.style.borderColor = 'rgba(168,131,58,0.8)';
      cursor.style.backgroundColor = 'rgba(168,131,58,0.05)';
    }
  });

  document.addEventListener('mouseout', (e) => {
    if (e.target.closest(interactiveSelector)) {
      cursor.style.width = '24px';
      cursor.style.height = '24px';
      cursor.style.borderColor = 'rgba(168,131,58,0.5)';
      cursor.style.backgroundColor = '';
    }
  });
}

// ─── Nav Scroll Behavior ─────────────────────────
function initNavScroll() {
  const nav = document.getElementById('nav');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 60) {
      nav.style.background = 'rgba(248, 247, 245, 0.98)';
      nav.style.boxShadow = '0 2px 20px rgba(13,37,69,0.08)';
    } else {
      nav.style.background = 'rgba(248, 247, 245, 0.92)';
      nav.style.boxShadow = '';
    }
  }, { passive: true });
}

// ─── Particles ───────────────────────────────────
function initParticles() {
  const container = document.getElementById('particles');
  if (!container) return;

  const colors = ['rgba(168,131,58,0.25)', 'rgba(201,176,128,0.18)', 'rgba(168,131,58,0.12)', 'rgba(255,255,255,0.06)'];
  const sizes = [3, 5, 4, 6, 3];

  for (let i = 0; i < 10; i++) {
    const p = document.createElement('div');
    p.classList.add('particle');
    const size = sizes[i % sizes.length];
    p.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      background: ${colors[i % colors.length]};
      left: ${8 + Math.random() * 84}%;
      top: ${10 + Math.random() * 75}%;
      animation-delay: ${Math.random() * 5}s;
      animation-duration: ${7 + Math.random() * 5}s;
    `;
    container.appendChild(p);
  }
}

// ─── Bento Card Tilt ─────────────────────────────
function initBentoTilt() {
  document.querySelectorAll('.bento-card, .ladder-card, .philosophy-card').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const rotX = ((y - cy) / cy) * -3;
      const rotY = ((x - cx) / cx) * 3;
      card.style.transform = `perspective(900px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-4px)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transition = 'transform 0.5s ease';
      card.style.transform = '';
      setTimeout(() => { card.style.transition = ''; }, 500);
    });
  });
}

// ─── GSAP Hero Animation ─────────────────────────
function initGSAPHero() {
  if (typeof gsap === 'undefined') return;

  gsap.registerPlugin(ScrollTrigger);

  const tl = gsap.timeline({ delay: 0.1 });

  tl.fromTo('#hero-eyebrow',
    { opacity: 0, y: 16 },
    { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }
  )
  .fromTo('#hero-h1',
    { opacity: 0, y: 30 },
    { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' },
    '-=0.3'
  )
  .fromTo('#hero-sub',
    { opacity: 0, y: 20 },
    { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' },
    '-=0.4'
  )
  .fromTo('#hero-ctas',
    { opacity: 0, y: 16 },
    { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' },
    '-=0.35'
  )
  .fromTo('#hero-visual',
    { opacity: 0, x: 40 },
    { opacity: 1, x: 0, duration: 0.9, ease: 'power3.out' },
    '-=0.7'
  );

  // Subtle letter-spacing on h1
  const h1 = document.querySelector('#hero-h1');
  if (h1) {
    h1.style.letterSpacing = '-0.05em';
    h1.style.transition = 'letter-spacing 1.4s cubic-bezier(0.4, 0, 0.2, 1)';
    setTimeout(() => { h1.style.letterSpacing = '-0.02em'; }, 500);
  }
}

// ─── CountUp Stat Counters ────────────────────────
let countUpInitialised = false;

function initCountUp() {
  if (countUpInitialised) return;
  const el = document.getElementById('stat-controls');
  if (!el) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !countUpInitialised) {
        countUpInitialised = true;
        if (typeof countUp !== 'undefined') {
          const cu = new countUp.CountUp('stat-controls', 38, {
            duration: 2,
            useEasing: true,
            useGrouping: false
          });
          if (!cu.error) cu.start();
        }
        observer.disconnect();
      }
    });
  }, { threshold: 0.5 });

  observer.observe(el);
}

// ─── Hash-based Routing ──────────────────────────
function handleHash() {
  const hash = window.location.hash.replace('#', '');
  if (PAGES.includes(hash)) {
    currentPage = hash;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const targetPage = document.getElementById(`page-${hash}`);
    if (targetPage) targetPage.classList.add('active');
    updateNavActive(hash);
  }
}

// ─── Page Initialisation ─────────────────────────
function initPage() {
  // Default active page
  const hash = window.location.hash.replace('#', '');
  const startPage = PAGES.includes(hash) ? hash : 'home';

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const activePage = document.getElementById(`page-${startPage}`);
  if (activePage) activePage.classList.add('active');
  currentPage = startPage;
  updateNavActive(startPage);

  // Init AOS
  AOS.init({
    duration: 700,
    easing: 'ease-out-cubic',
    once: true,
    offset: 60
  });

  // Init all interactive elements
  initCursor();
  initNavScroll();
  initParticles();
  initBentoTilt();
  initSubnavHighlight();

  // GSAP hero animation (home only)
  if (startPage === 'home') {
    initGSAPHero();
    initCountUp();
  }

  // Browser back/forward
  window.addEventListener('popstate', () => {
    const h = window.location.hash.replace('#', '') || 'home';
    if (PAGES.includes(h) && h !== currentPage) {
      const oldEl = document.getElementById(`page-${currentPage}`);
      if (oldEl) oldEl.classList.remove('active');
      currentPage = h;
      const newEl = document.getElementById(`page-${h}`);
      if (newEl) {
        newEl.classList.add('active');
        newEl.classList.add('page-transition-enter');
        setTimeout(() => newEl.classList.remove('page-transition-enter'), 600);
      }
      updateNavActive(h);
      window.scrollTo({ top: 0, behavior: 'instant' });
      setTimeout(() => {
        AOS.refresh();
        initBentoTilt();
        initSubnavHighlight();
        if (h === 'home') initCountUp();
      }, 100);
    }
  });
}

// ─── Hero Panoramic Carousel ─────────────────────
(function() {
  const CIRC = 2 * Math.PI * 26;

  const animConfigs = {
    0: {
      run() {
        const ring = document.getElementById('auditRing');
        if (!ring) return;
        ring.style.transition = 'stroke-dashoffset 1.4s ease';
        ring.style.strokeDashoffset = CIRC - (0.42 * CIRC);
        document.querySelectorAll('[data-c0]').forEach((r, i) => {
          r.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
          setTimeout(() => r.classList.add('pano-anim-in'), 200 + i * 130);
        });
        const sum = document.getElementById('auditSummary');
        if (sum) { sum.style.transition = 'opacity 0.5s ease, transform 0.5s ease'; setTimeout(() => sum.classList.add('pano-anim-in'), 1100); }
      },
      reset() {
        const ring = document.getElementById('auditRing');
        if (ring) { ring.style.transition = 'none'; ring.style.strokeDashoffset = CIRC; }
        document.querySelectorAll('[data-c0]').forEach(r => { r.style.transition = 'none'; r.classList.remove('pano-anim-in'); });
        const sum = document.getElementById('auditSummary');
        if (sum) { sum.style.transition = 'none'; sum.classList.remove('pano-anim-in'); }
      }
    },
    1: {
      run() {
        document.querySelectorAll('[data-c1]').forEach((item, i) => {
          item.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
          setTimeout(() => item.classList.add('pano-anim-in'), 200 + i * 210);
        });
        const bars = [['cb1', '65%', 700], ['cb2', '35%', 1000], ['cb3', '6%', 1250]];
        bars.forEach(([id, w, delay]) => {
          const el = document.getElementById(id);
          if (el) { el.style.transition = 'width 1.2s ease'; setTimeout(() => { el.style.width = w; }, delay); }
        });
      },
      reset() {
        document.querySelectorAll('[data-c1]').forEach(item => { item.style.transition = 'none'; item.classList.remove('pano-anim-in'); });
        ['cb1','cb2','cb3'].forEach(id => { const el = document.getElementById(id); if (el) { el.style.transition = 'none'; el.style.width = '0%'; } });
      }
    },
    2: {
      run() {
        document.querySelectorAll('[data-c2]').forEach((r, i) => {
          r.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
          setTimeout(() => r.classList.add('pano-anim-in'), 200 + i * 140);
        });
        const alert = document.getElementById('rrAlert');
        if (alert) { alert.style.transition = 'opacity 0.5s ease, transform 0.5s ease'; setTimeout(() => alert.classList.add('pano-anim-in'), 1000); }
      },
      reset() {
        document.querySelectorAll('[data-c2]').forEach(r => { r.style.transition = 'none'; r.classList.remove('pano-anim-in'); });
        const alert = document.getElementById('rrAlert');
        if (alert) { alert.style.transition = 'none'; alert.classList.remove('pano-anim-in'); }
      }
    }
  };

  let pOrder = [0, 1, 2]; // [left, center, right]
  let pCenter = 1;
  let pLoopTimer = null;
  let pAnimTimer = null;

  function setPanoPositions() {
    const cards = [document.getElementById('pcard0'), document.getElementById('pcard1'), document.getElementById('pcard2')];
    const dots  = [document.getElementById('pdot0'),  document.getElementById('pdot1'),  document.getElementById('pdot2')];
    if (!cards[0]) return;
    cards.forEach(c => c.classList.remove('pos-left', 'pos-center', 'pos-right'));
    dots.forEach(d => d.classList.remove('active'));
    cards[pOrder[0]].classList.add('pos-left');
    cards[pOrder[1]].classList.add('pos-center');
    cards[pOrder[2]].classList.add('pos-right');
    dots[pOrder[1]].classList.add('active');
  }

  function pStartLoop() {
    clearTimeout(pLoopTimer);
    clearTimeout(pAnimTimer);
    pLoopTimer = setTimeout(() => {
      Object.values(animConfigs).forEach(c => c.reset());
      void document.body.offsetWidth;
      pAnimTimer = setTimeout(() => {
        Object.values(animConfigs).forEach(c => c.run());
        pStartLoop();
      }, 600);
    }, 5200);
  }

  window.focusPCard = function(cardIndex) {
    if (cardIndex === pCenter) return;
    clearTimeout(pLoopTimer);
    clearTimeout(pAnimTimer);
    Object.values(animConfigs).forEach(c => c.reset());
    void document.body.offsetWidth;
    if (cardIndex === pOrder[0]) {
      pOrder = [pOrder[2], pOrder[0], pOrder[1]];
    } else if (cardIndex === pOrder[2]) {
      pOrder = [pOrder[1], pOrder[2], pOrder[0]];
    }
    pCenter = pOrder[1];
    setPanoPositions();
    setTimeout(() => Object.values(animConfigs).forEach(c => c.run()), 400);
    pStartLoop();
  };

  function initPanorama() {
    setPanoPositions();
    setTimeout(() => Object.values(animConfigs).forEach(c => c.run()), 350);
    pStartLoop();
  }

  const panoEl = document.getElementById('heroPanorama');
  if (panoEl) {
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) { initPanorama(); obs.disconnect(); }
    }, { threshold: 0.1 });
    obs.observe(panoEl);
  }
})();

// ─── Boot ────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage);
} else {
  initPage();
}

/* ===================================================
   ETHOS AI GOVERNANCE — Interactive App
   Multi-page vanilla JS — GSAP (home) + AOS + CountUp
=================================================== */

'use strict';

// ─── Motion / Input Preferences ──────────────────
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE_POINTER = window.matchMedia('(pointer: coarse)').matches;

// ─── Nav Active State ─────────────────────────────
function updateNavActive() {
  const path = window.location.pathname;
  document.querySelectorAll('[data-page]').forEach(link => {
    link.classList.remove('active');
    const href = link.getAttribute('href');
    if (path === '/' && href === '/') {
      link.classList.add('active');
    } else if (path !== '/' && href && href !== '/' && path.startsWith(href)) {
      link.classList.add('active');
    }
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
  if (!document.getElementById('servicesSubnav')) return;
  const sections = ['free-audit', 'compare-tiers', 'iso-42001'];
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

// ─── Character count ──────────────────────────────
function updateCharCount(textarea) {
  const counter = document.getElementById('charCountNum');
  if (counter) counter.textContent = textarea.value.length;
}

// ─── Form Submission ──────────────────────────────
async function handleFormSubmit(e) {
  e.preventDefault();

  // Validate at least one interest pill is selected
  const pills = document.querySelectorAll('input[name="interested_in"]:checked');
  if (pills.length === 0) {
    const pillGroup = document.getElementById('interestPills');
    if (pillGroup) {
      pillGroup.style.outline = '2px solid rgba(168,131,58,0.5)';
      pillGroup.style.borderRadius = '8px';
      setTimeout(() => { pillGroup.style.outline = 'none'; }, 2500);
    }
    return;
  }

  const btn = document.getElementById('formSubmitBtn');
  const successEl = document.getElementById('formSuccess');
  const originalBtnHTML = btn.innerHTML;

  btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1rem;animation:spin 0.8s linear infinite;vertical-align:middle">refresh</span> Sending...';
  btn.disabled = true;

  const data = {
    name: (document.getElementById('contactName')?.value || '').trim(),
    company: (document.getElementById('contactCompany')?.value || '').trim(),
    email: (document.getElementById('contactEmail')?.value || '').trim(),
    company_builds: (document.getElementById('contactBuilds')?.value || '').trim(),
    enquiry_prompt: document.getElementById('contactPrompt')?.value || '',
    team_size: document.getElementById('contactTeamSize')?.value || '',
    interested_in: Array.from(pills).map(p => p.value),
    existing_governance: document.getElementById('contactGovDocs')?.value || null,
    additional_notes: (document.getElementById('contactMessage')?.value || '').trim() || null,
  };

  try {
    await submitEnquiryToSupabase(data);
  } catch (err) {
    console.error('Form submission error:', err);
  }

  fetch('/api/notify-enquiry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(() => {});

  btn.innerHTML = originalBtnHTML;
  btn.disabled = false;
  if (successEl) successEl.style.display = 'flex';
  e.target.reset();
  const counter = document.getElementById('charCountNum');
  if (counter) counter.textContent = '0';
}

// ─── Supabase Enquiry Submit ──────────────────────
async function submitEnquiryToSupabase(data) {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg || cfg.url.includes('YOUR_PROJECT_REF')) {
    return new Promise(resolve => setTimeout(resolve, 1200));
  }

  const sb = window.supabase.createClient(cfg.url, cfg.anonKey);
  const { error } = await sb.from('enquiries').insert(data);
  if (error) throw error;
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
  if (!container || REDUCED_MOTION || COARSE_POINTER) return;

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
  if (REDUCED_MOTION || COARSE_POINTER) return;
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

// ─── GSAP Hero Animation (home only) ─────────────
function initGSAPHero() {
  if (typeof gsap === 'undefined' || REDUCED_MOTION) return;

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
  .fromTo('#heroPanorama',
    { opacity: 0, x: 40 },
    { opacity: 1, x: 0, duration: 0.9, ease: 'power3.out' },
    '-=0.7'
  );

  const h1 = document.querySelector('#hero-h1');
  if (h1) {
    h1.style.letterSpacing = '-0.05em';
    h1.style.transition = 'letter-spacing 1.4s cubic-bezier(0.4, 0, 0.2, 1)';
    setTimeout(() => { h1.style.letterSpacing = '-0.02em'; }, 500);
  }
}

// ─── CountUp Stat Counters (home only) ───────────
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

// ─── Hero Panoramic Carousel (home only) ─────────
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

  let pOrder = [0, 1, 2];
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

  function pStopLoop() {
    clearTimeout(pLoopTimer);
    clearTimeout(pAnimTimer);
  }

  function pStartLoop() {
    clearTimeout(pLoopTimer);
    clearTimeout(pAnimTimer);
    if (REDUCED_MOTION) return;
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
    let panoStarted = false;
    let panoInView = false;

    const obs = new IntersectionObserver(entries => {
      panoInView = entries[0].isIntersecting;
      if (panoInView && !panoStarted) {
        panoStarted = true;
        initPanorama();
        return;
      }
      if (!panoStarted) return;
      if (panoInView && !document.hidden) pStartLoop();
      else pStopLoop();
    }, { threshold: 0.1 });
    obs.observe(panoEl);

    document.addEventListener('visibilitychange', () => {
      if (!panoStarted) return;
      if (document.hidden) pStopLoop();
      else if (panoInView) pStartLoop();
    });
  }
})();

// ─── Path-specific Form Submission ───────────────
async function handlePathFormSubmit(e, pathType) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('[type="submit"]');
  const successEl = form.querySelector('.form-success-inline');
  if (!submitBtn) return;

  const requiredFields = form.querySelectorAll('[required]');
  let valid = true;
  requiredFields.forEach(f => {
    if (!f.value.trim()) {
      f.style.borderColor = 'rgba(168,131,58,0.6)';
      setTimeout(() => { f.style.borderColor = ''; }, 2500);
      valid = false;
    }
  });
  if (!valid) return;

  const originalHTML = submitBtn.innerHTML;
  submitBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1rem;animation:spin 0.8s linear infinite;vertical-align:middle">refresh</span> Sending...';
  submitBtn.disabled = true;

  const fd = new FormData(form);
  const data = {};
  fd.forEach((val, key) => { data[key] = val; });
  data.enquiry_type = pathType;

  try {
    await submitEnquiryToSupabase(data);
  } catch (err) {
    console.error('Form submission error:', err);
  }

  fetch('/api/notify-enquiry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(() => {});

  submitBtn.innerHTML = originalHTML;
  submitBtn.disabled = false;
  form.reset();
  if (successEl) successEl.style.display = 'flex';
}

// ─── Bonus Secondary Card Toggle ─────────────────
function toggleBonusSecondary(summaryEl) {
  const card = summaryEl.closest('.bonus-secondary-card');
  if (!card) return;
  card.classList.toggle('open');
}

// ─── Stripe Checkout ─────────────────────────────
async function startCheckout(productTier, btn) {
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Loading...';

  const prev = btn.parentElement.querySelector('.checkout-error');
  if (prev) prev.remove();

  try {
    const res  = await fetch('/api/create-checkout-session', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ productTier }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not start checkout');

    window.location.href = data.url;
  } catch (err) {
    console.error('[checkout]', err);
    btn.disabled  = false;
    btn.innerHTML = originalHTML;

    const errEl = document.createElement('p');
    errEl.className = 'checkout-error';
    errEl.style.cssText = 'color:#dc2626;font-size:0.8125rem;margin-top:0.5rem;text-align:center';
    errEl.textContent = 'Something went wrong. Please try again.';
    btn.insertAdjacentElement('afterend', errEl);
    setTimeout(() => errEl.remove(), 5000);
  }
}

// ─── Scroll FX: ISO timeline, divider draw, counters ───
function initScrollFx() {
  if (!('IntersectionObserver' in window)) return;

  // ISO 42001 timeline draw (services page)
  const isoWrap = document.querySelector('.iso-ht-wrap');
  if (isoWrap && !REDUCED_MOTION) {
    isoWrap.classList.add('iso-anim');
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) { isoWrap.classList.add('in-view'); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(isoWrap);
  }

  // Section divider rule draw
  if (!REDUCED_MOTION) {
    document.querySelectorAll('.section-divider').forEach(divider => {
      divider.classList.add('divider-anim');
      const io = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) { divider.classList.add('in-view'); io.disconnect(); }
      }, { threshold: 0 });
      io.observe(divider);
    });
  }

  // Generic count-up for [data-countup] (vanilla, no library needed)
  document.querySelectorAll('[data-countup]').forEach(el => {
    const target = parseInt(el.dataset.countup, 10);
    if (isNaN(target)) return;
    const io = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      if (REDUCED_MOTION) return;
      const prefix = el.dataset.countupPrefix || '';
      const suffix = el.dataset.countupSuffix || '';
      const duration = 1800;
      const start = performance.now();
      (function tick(now) {
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = prefix + Math.round(eased * target) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      })(start);
    }, { threshold: 0.5 });
    io.observe(el);
  });
}

// ─── Magnetic Buttons ────────────────────────────
function initMagneticButtons() {
  if (REDUCED_MOTION || COARSE_POINTER) return;
  document.querySelectorAll('.hero-cta-btn, .btn-primary, .fa-cta').forEach(btn => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 8;
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * 6;
      btn.style.transform = `translate(${x}px, ${y - 2}px)`;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = '';
    });
  });
}

// ─── Sticky Mobile CTA Bar ───────────────────────
function initMobileCtaBar() {
  const path = window.location.pathname;
  if (path.startsWith('/free-audit') || path.startsWith('/portal') || path.startsWith('/success')) return;
  if (sessionStorage.getItem('ethosCtaBarDismissed') === '1') return;

  const bar = document.createElement('div');
  bar.className = 'mobile-cta-bar';
  bar.innerHTML =
    '<div class="mobile-cta-bar-text"><strong>Free AI governance audit</strong> — 3 slots/month</div>' +
    '<a href="/free-audit" class="mobile-cta-bar-btn">Claim yours →</a>' +
    '<button class="mobile-cta-bar-close" aria-label="Dismiss"><span class="material-symbols-outlined" style="font-size:1.25rem">close</span></button>';
  document.body.appendChild(bar);

  bar.querySelector('.mobile-cta-bar-close').addEventListener('click', () => {
    bar.classList.remove('visible');
    sessionStorage.setItem('ethosCtaBarDismissed', '1');
  });

  let shown = false;
  window.addEventListener('scroll', () => {
    if (shown) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max > 0 && window.scrollY / max > 0.55) {
      shown = true;
      bar.classList.add('visible');
    }
  }, { passive: true });
}

// ─── Page Initialisation ─────────────────────────
function initPage() {
  AOS.init({
    duration: 700,
    easing: 'ease-out-cubic',
    once: true,
    offset: 60,
    disable: REDUCED_MOTION
  });

  updateNavActive();
  initCursor();
  initNavScroll();
  initParticles();
  initBentoTilt();
  initSubnavHighlight();
  initScrollFx();
  initMagneticButtons();
  initMobileCtaBar();

  // GSAP and CountUp only on home page (scripts only loaded there)
  if (document.getElementById('hero-h1')) {
    initGSAPHero();
    initCountUp();
  }

  // On services page: if hash on load, scroll with nav offset
  if (document.getElementById('servicesSubnav') && window.location.hash) {
    const targetId = window.location.hash.replace('#', '');
    setTimeout(() => scrollToSection(targetId), 300);
  }
}

// ─── Boot ────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage);
} else {
  initPage();
}

/* ===================================================
   ETHOS AI GOVERNANCE — Interactive App
   Vanilla JS SPA with smooth routing & animations
=================================================== */

'use strict';

// ─── State ────────────────────────────────────────
let currentPage = 'home';

// ─── Page Navigation ─────────────────────────────
function navigate(page) {
  if (page === currentPage) return;

  const oldPage = document.getElementById(`page-${currentPage}`);
  const newPage = document.getElementById(`page-${page}`);

  if (!newPage) return;

  // Fade out old
  if (oldPage) {
    oldPage.style.opacity = '0';
    oldPage.style.transform = 'translateY(10px)';
    setTimeout(() => {
      oldPage.classList.remove('active');
      oldPage.style.opacity = '';
      oldPage.style.transform = '';
    }, 250);
  }

  // Show new after brief pause
  setTimeout(() => {
    newPage.classList.add('active');
    newPage.classList.add('page-transition-enter');
    setTimeout(() => newPage.classList.remove('page-transition-enter'), 600);

    currentPage = page;
    updateNavActive(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Trigger reveal animations for the new page
    setTimeout(() => initReveal(), 100);
  }, 220);

  // Update URL hash without scroll
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
  const nav = document.getElementById('mobileNav');
  nav.classList.toggle('open');
}

function closeMobileNav() {
  document.getElementById('mobileNav').classList.remove('open');
}

// ─── Methodology Accordion ────────────────────────
function toggleStep(index) {
  const steps = document.querySelectorAll('.method-step');
  steps.forEach((step, i) => {
    if (i === index) {
      step.classList.toggle('open');
    } else {
      step.classList.remove('open');
    }
  });
}

// ─── Industry Tabs ────────────────────────────────
function switchTab(tabId) {
  // Update buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('onclick').includes(tabId)) btn.classList.add('active');
  });

  // Animate panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    if (panel.id === `tab-${tabId}`) {
      panel.style.opacity = '0';
      panel.classList.add('active');
      setTimeout(() => {
        panel.style.transition = 'opacity 0.3s ease';
        panel.style.opacity = '1';
      }, 20);
    } else {
      panel.classList.remove('active');
      panel.style.opacity = '';
      panel.style.transition = '';
    }
  });
}

// ─── Jurisdiction Tabs ────────────────────────────
function switchJurisdiction(code) {
  // Update buttons
  document.querySelectorAll('.jurisdiction-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('onclick').includes(`'${code}'`)) btn.classList.add('active');
  });

  // Switch panels with animation
  document.querySelectorAll('.jurisdiction-panel').forEach(panel => {
    if (panel.id === `panel-${code}`) {
      panel.style.opacity = '0';
      panel.classList.add('active');
      // Trigger reflow
      panel.offsetHeight;
      panel.style.transition = 'opacity 0.4s ease';
      panel.style.opacity = '1';

      // Re-init stagger for this panel
      setTimeout(() => {
        const staggerEl = panel.querySelector('.stagger-children');
        if (staggerEl) {
          staggerEl.classList.remove('visible');
          setTimeout(() => staggerEl.classList.add('visible'), 50);
        }
      }, 50);
    } else {
      panel.classList.remove('active');
      panel.style.opacity = '';
      panel.style.transition = '';
    }
  });
}

// ─── Scroll Reveal ───────────────────────────────
function initReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  // Observe all reveal elements in active page
  const activePage = document.getElementById(`page-${currentPage}`);
  if (!activePage) return;

  activePage.querySelectorAll('.reveal, .reveal-left, .reveal-right, .stagger-children').forEach(el => {
    // Reset if previously visible (re-navigation)
    el.classList.remove('visible');
    observer.observe(el);
  });
}

// ─── Form Handling ───────────────────────────────
function handleFormSubmit(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const statusEl = e.target.closest('.contact-form-wrap').querySelector('#formSuccess');

  // Loading state
  btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1rem;animation:spin 0.8s linear infinite">refresh</span> Sending...';
  btn.disabled = true;

  // Simulate async submission
  setTimeout(() => {
    btn.innerHTML = 'Submit Inquiry <span class="material-symbols-outlined" style="font-size:1rem">arrow_forward</span>';
    btn.disabled = false;
    statusEl.style.display = 'block';
    statusEl.style.animation = 'pageIn 0.4s ease forwards';

    // Reset form
    e.target.reset();
    document.querySelector('.form-status').innerHTML = `
      <span class="status-dot" style="background:#22c55e"></span>
      Inquiry Submitted
    `;
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

  // Smooth follow
  function animateCursor() {
    cursorX += (mouseX - cursorX) * 0.15;
    cursorY += (mouseY - cursorY) * 0.15;
    cursor.style.left = cursorX + 'px';
    cursor.style.top = cursorY + 'px';
    requestAnimationFrame(animateCursor);
  }
  animateCursor();

  // Hover states
  document.addEventListener('mouseover', (e) => {
    if (e.target.matches('a, button, .service-card, .bento-card, .compliance-card, .method-step, .tab-btn, .jurisdiction-btn')) {
      cursor.style.width = '40px';
      cursor.style.height = '40px';
      cursor.style.borderColor = 'rgba(168,131,58,0.8)';
      cursor.style.backgroundColor = 'rgba(168,131,58,0.05)';
    }
  });

  document.addEventListener('mouseout', (e) => {
    if (e.target.matches('a, button, .service-card, .bento-card, .compliance-card, .method-step, .tab-btn, .jurisdiction-btn')) {
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
  let lastScroll = 0;

  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;

    if (scrollY > 80) {
      nav.style.background = 'rgba(248, 247, 245, 0.97)';
    } else {
      nav.style.background = 'rgba(248, 247, 245, 0.88)';
    }

    lastScroll = scrollY;
  }, { passive: true });
}

// ─── Counter Animation ───────────────────────────
function animateCounter(el, target, suffix = '') {
  const duration = 1200;
  const start = performance.now();
  const startVal = 0;

  function update(time) {
    const elapsed = time - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(startVal + (target - startVal) * eased);
    el.textContent = current + suffix;
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

// ─── Hash-based routing ──────────────────────────
function handleHash() {
  const hash = window.location.hash.replace('#', '');
  const pages = ['home', 'services', 'compliance', 'contact'];
  if (pages.includes(hash)) {
    // Direct load
    currentPage = hash;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const targetPage = document.getElementById(`page-${hash}`);
    if (targetPage) targetPage.classList.add('active');
    updateNavActive(hash);
  }
}

// ─── Particles (subtle hero decoration) ──────────
function initParticles() {
  const hero = document.querySelector('#page-home .hero');
  if (!hero) return;

  const colors = ['rgba(168,131,58,0.3)', 'rgba(13,37,69,0.15)', 'rgba(168,131,58,0.15)'];
  const sizes = [4, 6, 3, 5];

  for (let i = 0; i < 8; i++) {
    const p = document.createElement('div');
    p.classList.add('particle');
    const size = sizes[i % sizes.length];
    p.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      background: ${colors[i % colors.length]};
      left: ${10 + Math.random() * 80}%;
      top: ${10 + Math.random() * 70}%;
      animation-delay: ${Math.random() * 4}s;
      animation-duration: ${6 + Math.random() * 4}s;
    `;
    hero.appendChild(p);
  }
}

// ─── Typing effect for hero heading ──────────────
function initHeroTyping() {
  // Subtle letter-spacing animation on hero h1
  const h1 = document.querySelector('#page-home .hero h1');
  if (!h1) return;

  h1.style.letterSpacing = '-0.05em';
  h1.style.transition = 'letter-spacing 1.2s cubic-bezier(0.4, 0, 0.2, 1)';
  setTimeout(() => {
    h1.style.letterSpacing = '-0.02em';
  }, 500);
}

// ─── Spin keyframe for loading ───────────────────
const spinStyle = document.createElement('style');
spinStyle.textContent = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(spinStyle);

// ─── Number stat animation on Compliance page ────
function initStatCounters() {
  const stats = document.querySelectorAll('.stat-val');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const text = el.textContent.trim();
        if (text.includes('%')) {
          animateCounter(el, parseInt(text), '%');
        }
        observer.unobserve(el);
      }
    });
  }, { threshold: 0.5 });

  stats.forEach(s => observer.observe(s));
}

// ─── Bento card tilt effect ───────────────────────
function initBentoTilt() {
  document.querySelectorAll('.bento-card, .service-card').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = ((y - centerY) / centerY) * -3;
      const rotateY = ((x - centerX) / centerX) * 3;
      card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      card.style.transition = 'transform 0.5s ease';
      setTimeout(() => { card.style.transition = ''; }, 500);
    });
  });
}

// ─── Smooth page entry ───────────────────────────
function initPage() {
  // Ensure home is active by default
  const homeEl = document.getElementById('page-home');
  if (homeEl) homeEl.classList.add('active');

  // Check hash for direct links
  handleHash();

  // Init all interactive elements
  initCursor();
  initNavScroll();
  initParticles();
  initStatCounters();

  // Initial reveal with slight delay
  setTimeout(() => {
    initReveal();
    initHeroTyping();
    initBentoTilt();
    initJourneyDashboard();
  }, 100);

  // Handle browser back/forward
  window.addEventListener('popstate', () => {
    const hash = window.location.hash.replace('#', '') || 'home';
    if (hash !== currentPage) {
      const pages = ['home', 'services', 'compliance', 'contact'];
      if (pages.includes(hash)) {
        // Direct switch without history push
        document.querySelectorAll('.page').forEach(p => {
          p.style.transition = 'opacity 0.3s ease';
          p.classList.remove('active');
        });
        setTimeout(() => {
          currentPage = hash;
          const newPage = document.getElementById(`page-${hash}`);
          if (newPage) {
            newPage.classList.add('active');
            newPage.style.transition = '';
          }
          updateNavActive(hash);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          setTimeout(() => initReveal(), 100);
        }, 250);
      }
    }
  });

  // Re-init tilt when navigating to services
  const origNavigate = window.navigate;
  window.navigate = function(page) {
    origNavigate(page);
    setTimeout(() => {
      initBentoTilt();
      initStatCounters();
    }, 400);
  };
}

// ─── Override navigate to re-init effects ────────
const _navigate = navigate;
window.navigate = function(page) {
  _navigate(page);
  setTimeout(() => {
    initBentoTilt();
    initStatCounters();
  }, 500);
};

// ─── Journey Dashboard Animation ─────────────────
function initJourneyDashboard() {
  const progressBar = document.getElementById('implProgress');
  if (!progressBar) return;

  // Observe the dashboard — animate progress bar when visible
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        // Animate progress bar to 65%
        setTimeout(() => {
          progressBar.style.width = '65%';
        }, 400);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.4 });

  const dashboard = document.querySelector('.journey-dashboard');
  if (dashboard) observer.observe(dashboard);

  // Step hover interactivity
  document.querySelectorAll('.jd-step').forEach(step => {
    step.addEventListener('mouseenter', () => {
      if (!step.classList.contains('pending')) {
        step.querySelector('.jd-node').style.transform = 'scale(1.1)';
      }
    });
    step.addEventListener('mouseleave', () => {
      const node = step.querySelector('.jd-node');
      if (node) node.style.transform = '';
    });
  });
}

// ─── Boot ────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage);
} else {
  initPage();
}

// ─── Ethos — Self-Hosted Booking Modal ───────────────────────────────────────
// Replaces the Cal.com embed. Hooks every [data-cal-link] trigger, opens a
// branded modal: pick a day → pick a time → details → confirmation.
//
// Data layer: GET /api/booking?action=slots and POST /api/booking (action:
// 'book'). On localhost only, falls back to generated mock availability when
// the API is unreachable, so the static preview still demos the full flow.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  var CONFIG = {
    durationMins: 30,
    minNoticeHours: 24,
    maxDaysAhead: 30,
    hostTimezone: 'Australia/Sydney',
    dayStartHour: 10,   // first slot 10:00 Sydney
    dayEndHour: 16,     // last slot starts 15:30 Sydney
  };

  var state = {
    viewYear: null,
    viewMonth: null,      // 0-indexed
    selectedDayKey: null, // 'YYYY-MM-DD' in host tz
    selectedSlot: null,   // Date (UTC instant)
    slotsByDay: {},       // dayKey -> [Date, ...]
    monthCache: {},       // 'y-m' -> slotsByDay
    open: false,
    lastFocus: null,
  };

  function isLocalDev() {
    return ['localhost', '127.0.0.1'].indexOf(window.location.hostname) !== -1;
  }

  var visitorTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney';

  // ── Timezone helpers ────────────────────────────────────────────────────────

  // What does `instant` read as in `tz`? Returns {y, m, d, h, min}.
  function partsInTz(instant, tz) {
    var parts = new Intl.DateTimeFormat('en-AU', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(instant);
    var out = {};
    parts.forEach(function (p) { out[p.type] = p.value; });
    return { y: +out.year, m: +out.month, d: +out.day, h: +out.hour % 24, min: +out.minute };
  }

  // UTC instant for wall-clock y/m/d h:min in `tz` (two-pass converge).
  function zonedToUtc(y, m, d, h, min, tz) {
    var guess = Date.UTC(y, m - 1, d, h, min);
    for (var i = 0; i < 2; i++) {
      var p = partsInTz(new Date(guess), tz);
      var asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
      guess += Date.UTC(y, m - 1, d, h, min) - asUtc;
    }
    return new Date(guess);
  }

  function dayKeyInHostTz(instant) {
    var p = partsInTz(instant, CONFIG.hostTimezone);
    return p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0');
  }

  // ── Data layer ──────────────────────────────────────────────────────────────

  // Month slots from the API, cached per month. Localhost falls back to mock.
  function fetchMonthSlots(year, month /* 0-indexed */) {
    var key = year + '-' + month;
    if (state.monthCache[key]) return Promise.resolve(state.monthCache[key]);
    return fetch('/api/booking?action=slots&year=' + year + '&month=' + (month + 1))
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (data.durationMins) CONFIG.durationMins = data.durationMins;
        var byDay = {};
        Object.keys(data.days || {}).forEach(function (k) {
          byDay[k] = data.days[k].map(function (iso) { return new Date(iso); });
        });
        state.monthCache[key] = byDay;
        return byDay;
      })
      .catch(function (err) {
        if (isLocalDev()) {
          console.warn('[booking] API unreachable, using mock availability:', err.message);
          var byDay = getMockSlotsForMonth(year, month);
          state.monthCache[key] = byDay;
          return byDay;
        }
        throw err;
      });
  }

  // ── Mock availability (localhost preview only) ──────────────────────────────

  function mockSlotsForDay(y, m, d) {
    var probe = zonedToUtc(y, m, d, 12, 0, CONFIG.hostTimezone);
    var dow = partsInTz(probe, CONFIG.hostTimezone) && new Date(probe).getUTCDay();
    // Weekday in host tz: derive from a local-noon instant formatted in host tz
    var wk = new Intl.DateTimeFormat('en-AU', { timeZone: CONFIG.hostTimezone, weekday: 'short' }).format(probe);
    if (wk === 'Sat' || wk === 'Sun' || wk === 'Fri') return []; // Mon–Thu only in mock

    var slots = [];
    var seed = y * 10000 + m * 100 + d;
    var i = 0;
    for (var h = CONFIG.dayStartHour; h < CONFIG.dayEndHour; h++) {
      [0, 30].forEach(function (min) {
        i++;
        // Deterministic thinning so the grid looks realistically patchy
        if (((seed * 31 + i * 17) % 10) < 4) return;
        slots.push(zonedToUtc(y, m, d, h, min, CONFIG.hostTimezone));
      });
    }
    return slots;
  }

  function getMockSlotsForMonth(year, month /* 0-indexed */) {
    var now = Date.now();
    var earliest = now + CONFIG.minNoticeHours * 3600 * 1000;
    var latest = now + CONFIG.maxDaysAhead * 24 * 3600 * 1000;
    var byDay = {};
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    for (var d = 1; d <= daysInMonth; d++) {
      var slots = mockSlotsForDay(year, month + 1, d).filter(function (s) {
        return s.getTime() >= earliest && s.getTime() <= latest;
      });
      if (slots.length) byDay[year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')] = slots;
    }
    return byDay;
  }

  // POST the booking. Resolves { ok, status, body }; never rejects.
  function submitBooking(payload) {
    payload.action = 'book';
    payload.tz = visitorTz;
    return fetch('/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        // Static dev servers answer POST with 404/405/501: no API deployed
        if ([404, 405, 501].indexOf(r.status) !== -1 && isLocalDev()) {
          console.warn('[booking] API unreachable, simulating a successful booking');
          return { ok: true, status: 200, body: { ok: true, mock: true } };
        }
        return r.json()
          .catch(function () { return {}; })
          .then(function (body) { return { ok: r.ok, status: r.status, body: body }; });
      })
      .catch(function (err) {
        if (isLocalDev()) {
          console.warn('[booking] API unreachable, simulating a successful booking:', err.message);
          return { ok: true, status: 200, body: { ok: true, mock: true } };
        }
        return { ok: false, status: 0, body: {} };
      });
  }

  // ── Formatting ──────────────────────────────────────────────────────────────

  function fmtTime(instant) {
    return instant.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: visitorTz }).replace(/\s/g, '').toLowerCase();
  }
  function fmtDayLong(instant) {
    return instant.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: visitorTz });
  }
  function fmtDayShort(dayKey) {
    var bits = dayKey.split('-');
    var probe = zonedToUtc(+bits[0], +bits[1], +bits[2], 12, 0, CONFIG.hostTimezone);
    return probe.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: CONFIG.hostTimezone });
  }
  function tzLabel() {
    return visitorTz.replace(/_/g, ' ').split('/').pop();
  }

  // ── Markup ──────────────────────────────────────────────────────────────────

  function buildModal() {
    var el = document.createElement('div');
    el.className = 'booking-overlay';
    el.id = 'bookingOverlay';
    el.hidden = true;
    el.innerHTML =
      '<div class="booking-modal" role="dialog" aria-modal="true" aria-labelledby="bookingTitle">' +
        '<button class="booking-close" id="bookingClose" aria-label="Close booking window">&times;</button>' +

        '<div class="booking-head">' +
          '<p class="booking-eyebrow">Ethos AI Governance</p>' +
          '<h2 class="booking-title" id="bookingTitle">Book a discovery call</h2>' +
          '<p class="booking-meta">' +
            '<span class="material-symbols-outlined">schedule</span> 30 minutes' +
            '<span class="booking-meta-dot">&middot;</span>' +
            '<span class="material-symbols-outlined">videocam</span> Video call' +
            '<span class="booking-meta-dot">&middot;</span> No obligation' +
          '</p>' +
        '</div>' +

        '<div class="booking-step" id="bookingStepSlots">' +
          '<div class="booking-picker">' +
            '<div class="booking-calendar">' +
              '<div class="booking-cal-head">' +
                '<button class="booking-cal-nav" id="bookingPrev" aria-label="Previous month">&#8249;</button>' +
                '<div class="booking-cal-month" id="bookingMonthLabel"></div>' +
                '<button class="booking-cal-nav" id="bookingNext" aria-label="Next month">&#8250;</button>' +
              '</div>' +
              '<div class="booking-cal-grid" id="bookingCalGrid"></div>' +
            '</div>' +
            '<div class="booking-times">' +
              '<div class="booking-times-head" id="bookingTimesHead">Pick a day</div>' +
              '<div class="booking-times-tz"><span class="material-symbols-outlined">public</span> Times shown in <span id="bookingTzName"></span> time</div>' +
              '<div class="booking-times-list" id="bookingTimesList">' +
                '<p class="booking-times-empty">Choose an available day on the calendar and the open times will appear here.</p>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="booking-step" id="bookingStepForm" hidden>' +
          '<button class="booking-back" id="bookingBack"><span class="material-symbols-outlined">arrow_back</span> Change time</button>' +
          '<div class="booking-summary" id="bookingSummary"></div>' +
          '<form class="booking-form" id="bookingForm" novalidate>' +
            '<div class="booking-field"><label for="bookingName">Name<span class="booking-req">*</span></label>' +
              '<input type="text" id="bookingName" name="name" autocomplete="name" required></div>' +
            '<div class="booking-field"><label for="bookingEmail">Work email<span class="booking-req">*</span></label>' +
              '<input type="email" id="bookingEmail" name="email" autocomplete="email" required></div>' +
            '<div class="booking-field"><label for="bookingCompany">Company</label>' +
              '<input type="text" id="bookingCompany" name="company" autocomplete="organization"></div>' +
            '<div class="booking-field"><label for="bookingNotes">Anything you would like to cover?</label>' +
              '<textarea id="bookingNotes" name="notes" rows="3" placeholder="Optional. A sentence or two is plenty."></textarea></div>' +
            '<p class="booking-error" id="bookingError" hidden></p>' +
            '<button type="submit" class="btn-primary booking-confirm" id="bookingConfirm">Confirm booking</button>' +
            '<p class="booking-fineprint">You will receive an email confirmation, and a calendar invite will follow shortly.</p>' +
          '</form>' +
        '</div>' +

        '<div class="booking-step booking-done" id="bookingStepDone" hidden>' +
          '<div class="booking-done-mark"><span class="material-symbols-outlined">check</span></div>' +
          '<h3 class="booking-done-title">You&rsquo;re booked</h3>' +
          '<p class="booking-done-text">Thank you. Your discovery call is confirmed, a confirmation email is on its way, and a calendar invite for the meeting will follow shortly.</p>' +
          '<div class="booking-summary" id="bookingDoneSummary"></div>' +
          '<button class="btn-outline booking-done-close" id="bookingDoneClose">Done</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    return el;
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  function windowBounds() {
    var now = new Date();
    var last = new Date(now.getTime() + CONFIG.maxDaysAhead * 24 * 3600 * 1000);
    return { minYm: now.getFullYear() * 12 + now.getMonth(), maxYm: last.getFullYear() * 12 + last.getMonth() };
  }

  function renderCalendar() {
    var grid = document.getElementById('bookingCalGrid');
    var label = document.getElementById('bookingMonthLabel');
    var y = state.viewYear, m = state.viewMonth;

    label.textContent = new Date(y, m, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

    var bounds = windowBounds();
    var ym = y * 12 + m;
    document.getElementById('bookingPrev').disabled = ym <= bounds.minYm;
    document.getElementById('bookingNext').disabled = ym >= bounds.maxYm;

    grid.innerHTML = '<p class="booking-cal-loading">Loading availability&hellip;</p>';

    fetchMonthSlots(y, m).then(function (byDay) {
      if (state.viewYear !== y || state.viewMonth !== m || !state.open) return;
      state.slotsByDay = byDay;
      drawCalGrid(y, m);
    }).catch(function () {
      if (state.viewYear !== y || state.viewMonth !== m || !state.open) return;
      grid.innerHTML = '<p class="booking-cal-loading">Availability is temporarily unavailable. Please email <a href="mailto:mike@ethosaigovernance.com.au" style="color:var(--brass)">mike@ethosaigovernance.com.au</a> and we will find a time.</p>';
    });
  }

  function drawCalGrid(y, m) {
    var grid = document.getElementById('bookingCalGrid');
    grid.innerHTML = '';
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(function (wd) {
      var c = document.createElement('div');
      c.className = 'booking-cal-wd';
      c.textContent = wd;
      grid.appendChild(c);
    });

    var firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // Monday-first
    for (var i = 0; i < firstDow; i++) grid.appendChild(document.createElement('div'));

    var daysInMonth = new Date(y, m + 1, 0).getDate();
    for (var d = 1; d <= daysInMonth; d++) {
      var key = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'booking-cal-day';
      cell.textContent = d;
      if (state.slotsByDay[key]) {
        cell.classList.add('available');
        if (key === state.selectedDayKey) cell.classList.add('selected');
        cell.dataset.key = key;
        cell.addEventListener('click', function (e) { selectDay(e.currentTarget.dataset.key); });
      } else {
        cell.disabled = true;
      }
      grid.appendChild(cell);
    }
  }

  function selectDay(key) {
    state.selectedDayKey = key;
    var cells = document.querySelectorAll('.booking-cal-day.available');
    for (var i = 0; i < cells.length; i++) {
      cells[i].classList.toggle('selected', cells[i].dataset.key === key);
    }
    var head = document.getElementById('bookingTimesHead');
    var list = document.getElementById('bookingTimesList');
    head.textContent = fmtDayShort(key);
    list.innerHTML = '';
    state.slotsByDay[key].forEach(function (slot) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'booking-time';
      b.textContent = fmtTime(slot);
      b.addEventListener('click', function () { selectSlot(slot); });
      list.appendChild(b);
    });
  }

  function summaryHtml(slot) {
    var end = new Date(slot.getTime() + CONFIG.durationMins * 60000);
    return '<span class="material-symbols-outlined">event</span>' +
      '<div><strong>Discovery call &ndash; 30 minutes</strong><br>' +
      fmtDayLong(slot) + '<br>' + fmtTime(slot) + ' &ndash; ' + fmtTime(end) + ' (' + tzLabel() + ' time)</div>';
  }

  function selectSlot(slot) {
    state.selectedSlot = slot;
    document.getElementById('bookingSummary').innerHTML = summaryHtml(slot);
    showStep('bookingStepForm');
    document.getElementById('bookingName').focus();
  }

  function showStep(id) {
    ['bookingStepSlots', 'bookingStepForm', 'bookingStepDone'].forEach(function (s) {
      document.getElementById(s).hidden = s !== id;
    });
  }

  // ── Open / close ────────────────────────────────────────────────────────────

  function openModal() {
    var overlay = document.getElementById('bookingOverlay') || buildModal();
    state.lastFocus = document.activeElement;
    state.open = true;
    var now = new Date();
    state.viewYear = now.getFullYear();
    state.viewMonth = now.getMonth();
    state.selectedDayKey = null;
    state.selectedSlot = null;
    document.getElementById('bookingTzName').textContent = tzLabel();
    document.getElementById('bookingTimesHead').textContent = 'Pick a day';
    document.getElementById('bookingTimesList').innerHTML =
      '<p class="booking-times-empty">Choose an available day on the calendar and the open times will appear here.</p>';
    document.getElementById('bookingForm').reset();
    document.getElementById('bookingError').hidden = true;
    showStep('bookingStepSlots');
    renderCalendar();
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { overlay.classList.add('open'); });
    document.getElementById('bookingClose').focus();
  }

  function closeModal() {
    var overlay = document.getElementById('bookingOverlay');
    if (!overlay || !state.open) return;
    state.open = false;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(function () { overlay.hidden = true; }, 250);
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  }

  // ── Wiring ──────────────────────────────────────────────────────────────────

  function init() {
    buildModal();

    // Capture-phase so we beat (and can fully replace) the Cal.com embed
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest && e.target.closest('[data-cal-link]');
      if (!trigger) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openModal();
    }, true);

    document.getElementById('bookingClose').addEventListener('click', closeModal);
    document.getElementById('bookingDoneClose').addEventListener('click', closeModal);
    document.getElementById('bookingOverlay').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.open) closeModal();
    });

    document.getElementById('bookingPrev').addEventListener('click', function () {
      state.viewMonth--;
      if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
      renderCalendar();
    });
    document.getElementById('bookingNext').addEventListener('click', function () {
      state.viewMonth++;
      if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
      renderCalendar();
    });

    document.getElementById('bookingBack').addEventListener('click', function () {
      showStep('bookingStepSlots');
    });

    document.getElementById('bookingForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = document.getElementById('bookingName').value.trim();
      var email = document.getElementById('bookingEmail').value.trim();
      var error = document.getElementById('bookingError');
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        error.textContent = 'Please add your name and a valid email address.';
        error.hidden = false;
        return;
      }
      error.hidden = true;
      var btn = document.getElementById('bookingConfirm');
      btn.disabled = true;
      btn.textContent = 'Confirming…';
      submitBooking({
        starts_at: state.selectedSlot.toISOString(),
        name: name,
        email: email,
        company: document.getElementById('bookingCompany').value.trim(),
        notes: document.getElementById('bookingNotes').value.trim(),
      }).then(function (result) {
        btn.disabled = false;
        btn.textContent = 'Confirm booking';
        if (result.ok) {
          document.getElementById('bookingDoneSummary').innerHTML = summaryHtml(state.selectedSlot);
          showStep('bookingStepDone');
          document.getElementById('bookingDoneClose').focus();
          return;
        }
        if (result.status === 409) {
          // Slot taken between selection and confirm: refresh and repick
          state.monthCache = {};
          state.selectedDayKey = null;
          document.getElementById('bookingTimesHead').textContent = 'Pick a day';
          document.getElementById('bookingTimesList').innerHTML =
            '<p class="booking-times-empty">Sorry, that time was booked by someone else just now. Please choose another time.</p>';
          showStep('bookingStepSlots');
          renderCalendar();
          return;
        }
        error.textContent = (result.body && result.body.error && result.body.error !== 'slot_taken')
          ? result.body.error
          : 'Something went wrong saving your booking. Please try again, or email mike@ethosaigovernance.com.au.';
        error.hidden = false;
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

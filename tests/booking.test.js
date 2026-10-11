'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadHandler, response } = require('./helpers');

const settings = { id: 1, meeting_duration_mins: 30, buffer_mins: 0, min_notice_hours: 0, max_days_ahead: 365, timezone: 'Australia/Sydney' };

function fakeDb({ rulesError = null, overridesError = null, rules = [] } = {}) {
  return {
    from(table) {
      const q = {
        select() { return q; }, eq() { return q; }, gte() { return q; }, lte() { return q; },
        single: async () => ({ data: settings, error: null }),
        then(resolve) {
          if (table === 'availability_rules') return resolve({ data: rulesError ? null : rules, error: rulesError });
          if (table === 'availability_overrides') return resolve({ data: overridesError ? null : [], error: overridesError });
          return resolve({ data: [], error: null });
        },
      };
      return q;
    },
  };
}

function call(db, url = '/api/booking?action=slots&year=2030&month=6') {
  const handler = loadHandler('booking.js', { env: {}, mocks: { '@supabase/supabase-js': { createClient: () => db } } });
  const res = response();
  res.setHeader = () => {};
  return handler({ method: 'GET', url, headers: {} }, res).then(() => res);
}

test('unreadable overrides or rules fail closed instead of widening availability', async () => {
  const weekday = [{ day_of_week: 1, start_time: '09:00', end_time: '17:00' }];
  for (const opts of [{ overridesError: { message: 'down' }, rules: weekday }, { rulesError: { message: 'down' } }]) {
    const res = await call(fakeDb(opts));
    assert.equal(res.code, 500, JSON.stringify(opts));
    assert.equal(res.body.days, undefined);
  }
});

test('overlapping availability windows do not duplicate slots', async () => {
  const res = await call(fakeDb({ rules: [
    { day_of_week: 1, start_time: '09:00', end_time: '11:00' },
    { day_of_week: 1, start_time: '10:00', end_time: '12:00' },
  ] }));
  assert.equal(res.code, 200);
  for (const slots of Object.values(res.body.days)) assert.equal(new Set(slots).size, slots.length);
});

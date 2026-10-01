import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimerCalendarSource } from '../js/timer-calendar.js';

function fixture({ role = 'coach', userId = 'coach', read = async () => ({ sessions: [] }) } = {}) {
  const user = { id: userId };
  const athlete = (id, user_id = `${id}-user`) => ({ id, user_id, first_name: id, last_name: 'Exemple' });
  const relation = (athlete_id, changes = {}) => ({ athlete_id, coach_id: 'coach', status: 'accepted', can_view_calendar: true, ...changes });
  const account = {
    profile: { account_type: role }, planningAvailable: true,
    athletes: [athlete('allowed'), athlete('self', userId), athlete('pending'), athlete('revoked'), athlete('denied'), athlete('sheet', null), athlete('other-coach'), athlete('unrelated')],
    relations: [relation('allowed'), relation('pending', { status: 'pending' }), relation('revoked', { status: 'revoked' }), relation('denied', { can_view_calendar: false }), relation('sheet'), relation('other-coach', { coach_id: 'someone-else' })],
  };
  let active = true;
  const calls = [];
  const source = createTimerCalendarSource({ user, account, isCurrent: () => active, loadCalendar: async (...args) => { calls.push(args); return read(...args); } });
  return { user, account, source, calls, invalidate: () => { active = false; } };
}
const period = { calendarId: 'allowed', start: '2026-10-01', end: '2026-10-31' };

test('calendar source lists personal calendar first and only linked calendars explicitly accessible to this coach', () => {
  const { source } = fixture();
  assert.equal(source.ownerId, 'coach');
  assert.deepEqual(source.calendars, [{ id: 'self', label: 'Mon calendrier' }, { id: 'allowed', label: 'allowed Exemple' }]);
  assert.deepEqual(Object.keys(source).sort(), ['calendars', 'loadSessions', 'ownerId']);
});

test('athlete can load their own calendar, but cannot use coach relationships to read another calendar', async () => {
  const f = fixture({ role: 'athlete', userId: 'athlete-user' });
  assert.deepEqual(f.source.calendars, [{ id: 'self', label: 'Mon calendrier' }]);
  await f.source.loadSessions({ ...period, calendarId: 'self' });
  await assert.rejects(f.source.loadSessions(period), /pas accessible/);
  assert.deepEqual(f.calls, [['self', period.start, period.end]]);
});

test('pending, revoked, denied, unlinked, other-coach and unknown calendars never trigger a read', async () => {
  const f = fixture();
  for (const calendarId of ['pending', 'revoked', 'denied', 'sheet', 'other-coach', 'unrelated', 'unknown']) {
    await assert.rejects(f.source.loadSessions({ ...period, calendarId }), /pas accessible/);
  }
  assert.deepEqual(f.calls, []);
});

test('unavailable planning and signed-out users expose no calendars and cannot load sessions', async () => {
  const f = fixture();
  f.account.planningAvailable = false;
  assert.deepEqual(f.source.calendars, []);
  await assert.rejects(f.source.loadSessions(period), /pas accessible/);
  assert.deepEqual(f.calls, []);
  const signedOut = createTimerCalendarSource({ user: null, account: f.account, loadCalendar: () => assert.fail('No read after sign-out') });
  assert.deepEqual(signedOut.calendars, []);
  await assert.rejects(signedOut.loadSessions(period), { name: 'AbortError' });
});

test('calendar reads are scoped to the requested athlete and valid period, with a detached minimal payload', async () => {
  const original = {
    id: 'session1', athlete_id: 'allowed', date: '2026-10-02', title: 'Intervalles', sport: 'running',
    blocks: [{ type: 'interval', duration_seconds: 60, zone: 3 }],
    workout_document: { version: 1, text: '- 1m @ Z3', marks: [] },
    notes: 'Session notes excluded', description: 'Description excluded', private_notes: 'Private notes excluded',
    author_name: 'Excluded', feedback: { comment: 'Excluded' },
  };
  const f = fixture({ read: async () => ({ sessions: [original, { ...original, id: 'wrong-athlete', athlete_id: 'self' }, { ...original, id: 'wrong-date', date: '2026-09-30' }], events: [{ notes: 'Excluded' }], feedback: [{ comment: 'Excluded' }] }) });
  const sessions = await f.source.loadSessions(period);
  assert.deepEqual(f.calls, [['allowed', '2026-10-01', '2026-10-31']]);
  assert.equal(sessions.length, 1);
  assert.deepEqual(Object.keys(sessions[0]).sort(), ['blocks', 'date', 'id', 'sport', 'title', 'workout_document']);
  sessions[0].blocks[0].duration_seconds = 300;
  sessions[0].workout_document.text = 'Changed copy';
  assert.equal(original.blocks[0].duration_seconds, 60);
  assert.equal(original.workout_document.text, '- 1m @ Z3');
});

test('period validation rejects malformed and impossible dates, backwards ranges and more than 62 inclusive days', async () => {
  const f = fixture();
  for (const [start, end] of [['2026-1-01', '2026-01-31'], ['2026-02-29', '2026-03-01'], ['2026-04-31', '2026-05-01'], ['2026-10-31', '2026-10-01'], ['2026-10-01', '2026-12-02'], ['', ''], ['2026-10-01T00:00:00', '2026-10-31']]) {
    await assert.rejects(f.source.loadSessions({ calendarId: 'allowed', start, end }), /62 jours maximum/);
  }
  assert.deepEqual(f.calls, []);
  await f.source.loadSessions({ ...period, end: '2026-12-01' });
  await f.source.loadSessions({ ...period, end: '2026-10-01' });
  await f.source.loadSessions({ ...period, start: '2028-02-29', end: '2028-02-29' });
  assert.equal(f.calls.length, 3);
});

test('changed access is checked again before each request and after an in-flight response', async () => {
  let release;
  const f = fixture({ read: () => new Promise(resolve => { release = resolve; }) });
  const pending = f.source.loadSessions(period);
  f.account.relations[0].status = 'revoked';
  release({ sessions: [{ athlete_id: 'allowed', date: '2026-10-02', id: 'session1' }] });
  await assert.rejects(pending, /pas accessible/);
  await assert.rejects(f.source.loadSessions(period), /pas accessible/);
  assert.deepEqual(f.source.calendars, [{ id: 'self', label: 'Mon calendrier' }]);
  assert.equal(f.calls.length, 1);
});

test('invalidation discards in-flight responses and prevents later calendar reads', async () => {
  let release;
  const f = fixture({ read: () => new Promise(resolve => { release = resolve; }) });
  const pending = f.source.loadSessions(period);
  f.invalidate();
  release({ sessions: [{ athlete_id: 'allowed', date: '2026-10-02', id: 'session1' }] });
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(f.source.loadSessions(period), { name: 'AbortError' });
  assert.deepEqual(f.source.calendars, []);
  assert.equal(f.calls.length, 1);
});

test('changing the current identity invalidates the calendar source', async () => {
  const f = fixture();
  f.user.id = 'another-user';
  assert.deepEqual(f.source.calendars, []);
  await assert.rejects(f.source.loadSessions(period), { name: 'AbortError' });
  assert.deepEqual(f.calls, []);
});

test('read errors propagate and a failed read does not cache old sessions', async () => {
  const error = new Error('Impossible de charger le calendrier.');
  let attempts = 0;
  const f = fixture({ read: async () => { if (!attempts++) throw error; return { sessions: [] }; } });
  await assert.rejects(f.source.loadSessions(period), caught => caught === error);
  assert.deepEqual(await f.source.loadSessions(period), []);
  assert.equal(f.calls.length, 2);
});

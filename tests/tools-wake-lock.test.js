import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { mountTools } from '../js/tools.js';

const html = await readFile(new URL('../tools.html', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const configs = {
  boxing: { rounds: 2, work: 120, rest: 30, preparation: 5, warning: false },
  intervals: { rounds: 2, work: 3, rest: 2, preparation: 1, warning: false, series: 1, seriesRest: 5 },
};

function fixture({ request, available = true } = {}) {
  const window = new Window({ url: 'https://example.test/tools.html', settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  const doc = window.document;
  doc.write(html); window.confirm = () => true;
  window.localStorage.setItem('gestionboxeur:tools:v1', JSON.stringify({ sound: false, ...configs }));
  let time = 0, visibility = 'visible', closed = false;
  Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => visibility });
  const requests = [], sentinels = [];
  function sentinel() {
    const lock = new window.EventTarget();
    lock.released = false; lock.releaseCalls = 0;
    lock.releaseByBrowser = () => {
      if (lock.released) return;
      lock.released = true; lock.dispatchEvent(new window.Event('release'));
    };
    lock.release = async () => { lock.releaseCalls++; lock.releaseByBrowser(); };
    sentinels.push(lock); return lock;
  }
  Object.defineProperty(window.navigator, 'wakeLock', { configurable: true, value: available ? {
    request(type) {
      const entry = { type, visibility }; requests.push(entry);
      return request ? request({ entry, sentinel, index: requests.length - 1 }) : Promise.resolve(sentinel());
    },
  } : undefined });
  const ui = mountTools(doc.getElementById('toolsApp'), { now: () => time, autoTick: false });
  return {
    window, ui, requests, sentinels, sentinel, $: id => doc.getElementById(id),
    advance(ms) { time += ms; ui.tick(); },
    visibility(value) { visibility = value; doc.dispatchEvent(new window.Event('visibilitychange')); },
    async close() { if (!closed) { closed = true; ui.destroy(); await settle(); await window.happyDOM.abort(); } },
  };
}

for (const kind of ['boxing', 'intervals']) {
  test(`${kind} holds one screen wake lock throughout preparation, work and rest, then releases at completion`, async () => {
    const app = fixture(), config = configs[kind];
    try {
      app.ui.select(kind); assert.equal(app.requests.length, 0, 'idle timers do not keep the screen awake');
      app.$('timerStart').click(); await settle();
      assert.deepEqual(app.requests.map(row => row.type), ['screen']);
      const lock = app.sentinels[0];
      assert.equal(app.$('timerBoard').dataset.phase, 'prepare'); assert.equal(lock.released, false);
      app.advance(config.preparation * 1000); await settle();
      assert.equal(app.$('timerBoard').dataset.phase, 'work'); assert.equal(lock.released, false);
      app.advance(config.work * 1000); await settle();
      assert.equal(app.$('timerBoard').dataset.phase, 'rest'); assert.equal(lock.released, false);
      app.advance(config.rest * 1000); await settle();
      assert.equal(app.$('timerBoard').dataset.phase, 'work'); assert.equal(lock.released, false);
      assert.equal(app.requests.length, 1, 'phase transitions reuse the same active lock');
      app.advance(config.work * 1000); await settle();
      assert.equal(app.$('timerBoard').dataset.status, 'done'); assert.equal(lock.releaseCalls, 1);
      app.advance(10000); await settle(); assert.equal(app.requests.length, 1);
    } finally { await app.close(); }
  });
}

test('pause, reset, leaving the timer and destruction release held locks; resume acquires a fresh lock', async () => {
  const app = fixture();
  try {
    app.ui.select('boxing'); app.$('timerStart').click(); await settle();
    app.$('timerStart').click(); await settle();
    assert.equal(app.$('timerBoard').dataset.status, 'paused'); assert.equal(app.sentinels[0].releaseCalls, 1);
    app.visibility('hidden'); app.visibility('visible'); await settle();
    assert.equal(app.requests.length, 1, 'visibility cannot reacquire while paused');
    app.$('timerStart').click(); await settle();
    assert.equal(app.requests.length, 2); assert.equal(app.sentinels[1].released, false);
    app.$('timerReset').click(); await settle(); assert.equal(app.sentinels[1].releaseCalls, 1);
    app.$('timerStart').click(); await settle(); app.ui.select('steps'); await settle();
    assert.equal(app.sentinels[2].releaseCalls, 1);
    app.ui.select('boxing');
    assert.equal(app.$('timerBoard').dataset.status, 'paused'); assert.equal(app.requests.length, 3);
    app.$('timerStart').click(); await settle(); assert.equal(app.requests.length, 4);
    await app.close(); assert.equal(app.sentinels[3].releaseCalls, 1);
    app.visibility('visible'); await settle(); assert.equal(app.requests.length, 4);
  } finally { await app.close(); }
});

test('visibility loss releases the lock and returning reacquires only while the timer is still running', async () => {
  const app = fixture();
  try {
    app.ui.select('intervals'); app.$('timerStart').click(); await settle();
    app.visibility('hidden'); await settle();
    assert.equal(app.sentinels[0].releaseCalls, 1); assert.equal(app.requests.length, 1);
    app.advance(2000); await settle(); assert.equal(app.requests.length, 1, 'hidden execution never requests screen wake lock');
    app.visibility('visible'); await settle();
    assert.equal(app.requests.length, 2); assert.equal(app.sentinels[1].released, false);
    app.visibility('visible'); await settle(); assert.equal(app.requests.length, 2, 'duplicate events do not duplicate an active lock');
    app.visibility('hidden'); app.advance(20000); await settle();
    assert.equal(app.$('timerBoard').dataset.status, 'done');
    app.visibility('visible'); await settle(); assert.equal(app.requests.length, 2);
  } finally { await app.close(); }
});

test('a browser-released sentinel is replaced on return to the visible running timer', async () => {
  const app = fixture();
  try {
    app.ui.select('boxing'); app.$('timerStart').click(); await settle();
    const first = app.sentinels[0]; first.releaseByBrowser();
    app.visibility('hidden'); await settle();
    assert.equal(first.releaseCalls, 0, 'the app does not release an already browser-released handle again');
    app.visibility('visible'); await settle();
    assert.equal(app.requests.length, 2); assert.equal(app.sentinels[1].released, false);
  } finally { await app.close(); }
});

test('pagehide pauses the timer and releases its lock without promising background execution', async () => {
  const app = fixture();
  try {
    app.ui.select('boxing'); app.$('timerStart').click(); await settle(); app.advance(1000);
    app.window.dispatchEvent(new app.window.Event('pagehide')); await settle();
    assert.equal(app.sentinels[0].releaseCalls, 1);
    app.advance(200000); app.visibility('visible'); await settle();
    assert.equal(app.$('timerBoard').dataset.status, 'paused'); assert.equal(app.$('timerDigits').textContent, '00:04');
    assert.equal(app.requests.length, 1);
  } finally { await app.close(); }
});

test('missing or rejected wake lock API never blocks timer start, rest, pause or completion', async () => {
  for (const available of [false, true]) {
    const app = fixture({ available, request: () => Promise.reject(new Error('NotAllowedError')) });
    try {
      app.ui.select('intervals'); app.$('timerStart').click(); await settle();
      assert.equal(app.$('timerBoard').dataset.status, 'running');
      app.advance(4000); assert.equal(app.$('timerBoard').dataset.phase, 'rest');
      app.$('timerStart').click(); await settle(); assert.equal(app.$('timerBoard').dataset.status, 'paused');
      app.$('timerStart').click(); await settle(); app.advance(5000); await settle();
      assert.equal(app.$('timerBoard').dataset.status, 'done');
      assert.equal(app.requests.length, available ? 2 : 0, 'refusal is not retried in a loop');
    } finally { await app.close(); }
  }
});

test('a lock acquired after pause, reset or teardown is immediately released without stale retention', async () => {
  for (const action of ['pause', 'reset', 'destroy']) {
    const gate = deferred();
    const app = fixture({ request: () => gate.promise });
    try {
      app.ui.select('boxing'); app.$('timerStart').click();
      app.visibility('visible'); app.visibility('visible'); assert.equal(app.requests.length, 1, 'concurrent acquisition is deduplicated');
      if (action === 'pause') app.$('timerStart').click();
      else if (action === 'reset') app.$('timerReset').click();
      else await app.close();
      const late = app.sentinel(); gate.resolve(late); await settle();
      assert.equal(late.releaseCalls, 1, `${action} discards the late acquired handle`);
      assert.equal(app.requests.length, 1);
    } finally { await app.close(); }
  }
});

test('returning to visibility during a pending rejected acquisition triggers one fresh request', async () => {
  const gate = deferred();
  const app = fixture({ request: ({ index, sentinel }) => index === 0 ? gate.promise : Promise.resolve(sentinel()) });
  try {
    app.ui.select('boxing'); app.$('timerStart').click();
    app.visibility('hidden'); app.visibility('visible');
    gate.reject(new Error('The document was hidden during acquisition')); await settle();
    assert.equal(app.requests.length, 2, 'the visible transition must not be lost while the old request settles');
    assert.equal(app.sentinels[0].released, false);
  } finally { await app.close(); }
});

test('a visibility-triggered retry does not loop if the browser refuses again or releases the lock itself', async () => {
  const gate = deferred();
  const app = fixture({ request: ({ index }) => index === 0 ? gate.promise : Promise.reject(new Error('NotAllowedError')) });
  try {
    app.ui.select('boxing'); app.$('timerStart').click();
    app.visibility('hidden'); app.visibility('visible');
    gate.reject(new Error('The document was hidden')); await settle(); await settle();
    assert.equal(app.requests.length, 2, 'only the newer visibility transition authorizes a retry');
    app.advance(1000); await settle(); assert.equal(app.requests.length, 2);
  } finally { await app.close(); }
  const released = fixture();
  try {
    released.ui.select('boxing'); released.$('timerStart').click(); await settle();
    released.sentinels[0].releaseByBrowser(); await settle(); released.advance(1000); await settle();
    assert.equal(released.requests.length, 1, 'system release alone must not start a retry loop');
  } finally { await released.close(); }
});

test('destroy discards a queued visibility retry and releases a retry that was already requested', async () => {
  for (const afterRetryStarts of [false, true]) {
    const first = deferred(), second = deferred();
    const app = fixture({ request: ({ index }) => index === 0 ? first.promise : second.promise });
    try {
      app.ui.select('boxing'); app.$('timerStart').click();
      app.visibility('hidden'); app.visibility('visible');
      if (afterRetryStarts) {
        first.reject(new Error('Hidden document')); await settle(); assert.equal(app.requests.length, 2);
        await app.close();
        const late = app.sentinel(); second.resolve(late); await settle();
        assert.equal(late.releaseCalls, 1);
      } else {
        await app.close(); first.reject(new Error('Hidden document')); await settle();
        assert.equal(app.requests.length, 1, 'destroyed timers never launch the queued retry');
      }
      app.visibility('visible'); await settle();
      assert.equal(app.requests.length, afterRetryStarts ? 2 : 1);
    } finally { await app.close(); }
  }
});

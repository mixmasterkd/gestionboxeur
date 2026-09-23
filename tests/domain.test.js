import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { makeBlock, summarizeBlocks, flattenBlocks, validateBlocks, formatDuration, addDays, weekStart, monthDates, WORKOUT_LIMITS } from '../js/domain.js';

const step = (values = {}) => ({ ...makeBlock('interval'), ...values });
const loop = (repeat_count, children) => ({ ...makeBlock('repeat'), repeat_count, children });

test('running repeats preserve work/recovery order and compute exact total', () => {
  const blocks = [step({ title: 'Warm-up', duration_seconds: 600, zone: 1 }), loop(4, [step({ title: 'Effort', duration_seconds: 300, zone: 3 }), step({ title: 'Récupération', duration_seconds: 120, zone: 1 })]), step({ title: 'Cooldown', duration_seconds: 600, zone: 1 })];
  const summary = summarizeBlocks(blocks);
  assert.equal(summary.duration_seconds, 2880);
  assert.equal(summary.distance_m, 0);
  assert.deepEqual(summary.segments.map(block => block.title), ['Warm-up', 'Effort', 'Récupération', 'Effort', 'Récupération', 'Effort', 'Récupération', 'Effort', 'Récupération', 'Cooldown']);
  assert.deepEqual(summary.errors, []);
});

test('nested circuits multiply their sequences and distance without inventing pace', () => {
  const blocks = [loop(3, [loop(2, [step({ distance_m: 400, zone: 5 }), step({ duration_seconds: 90, zone: 1 })])])];
  const summary = summarizeBlocks(blocks);
  assert.equal(summary.distance_m, 2400);
  assert.equal(summary.duration_seconds, 540);
  assert.equal(summary.hasDistanceOnly, true);
  assert.equal(summary.mixed, true);
  assert.equal(summary.segments[0].duration_seconds, 0);
  assert.equal(summary.segments.length, 12);
});

test('rounds have recovery only between rounds and do not double-count overall duration', () => {
  const summary = summarizeBlocks([step({ rounds: 4, work_seconds: 120, rest_seconds: 60, duration_seconds: 999, repetitions: 8, distance_m: 400 })]);
  assert.equal(summary.duration_seconds, 660);
  assert.equal(summary.distance_m, 400);
  assert.deepEqual(summary.segments.map(block => block.phase), ['work', 'rest', 'work', 'rest', 'work', 'rest', 'work']);
  assert.equal(summary.segments[1].zone, 1);
});

test('movement repetitions are descriptive and free instructions report unknown time', () => {
  const summary = summarizeBlocks([step({ repetitions: 12, duration_seconds: 30 }), step({ description: 'Technique libre' })]);
  assert.equal(summary.duration_seconds, 30);
  assert.equal(summary.hasUnquantified, true);
  assert.equal(summary.hasDistanceOnly, false);
});

test('distance-only and mixed quantified steps are distinguished', () => {
  const distance = summarizeBlocks([step({ distance_m: 5000 })]);
  assert.equal(distance.hasTime, false);
  assert.equal(distance.duration_seconds, 0);
  assert.equal(distance.hasDistanceOnly, true);
  const both = summarizeBlocks([step({ distance_m: 5000, duration_seconds: 1500 })]);
  assert.equal(both.hasDistanceOnly, false);
  assert.equal(both.duration_seconds, 1500);
});

test('fractional seconds accumulate before display rounding', () => {
  const summary = summarizeBlocks([loop(3, [step({ duration_seconds: 1.25, distance_m: 33.3 })])]);
  assert.equal(summary.duration_seconds, 3.75);
  assert.equal(summary.distance_m, 99.9);
  assert.equal(formatDuration(summary.duration_seconds), '4 s');
  assert.equal(formatDuration(3599.8), '1 h');
  assert.equal(formatDuration(90), '1 min 30 s');
  assert.equal(formatDuration(0), '0 min');
});

test('invalid values are rejected before expansion', () => {
  for (const value of [-1, Infinity, NaN, '60']) assert.ok(validateBlocks([step({ duration_seconds: value })]).length);
  for (const zone of [0, 8, 1.5]) assert.ok(validateBlocks([step({ zone })]).length);
  assert.ok(validateBlocks([loop(0, [step()])]).length);
  assert.ok(validateBlocks([loop(101, [step()])]).length);
  assert.ok(validateBlocks([loop(2, [])]).length);
  assert.ok(validateBlocks([step({ repetitions: 1.5 })]).length);
  assert.ok(summarizeBlocks([step({ duration_seconds: -1 })]).errors.length);
  assert.throws(() => flattenBlocks([step({ zone: 8 })]), RangeError);
});

test('cycles, excessive depth and excessive expansion are bounded', () => {
  const circular = loop(2, []); circular.children.push(circular);
  assert.match(validateBlocks([circular]).join(' '), /circulaire/);
  assert.ok(summarizeBlocks([circular]).errors.length);
  const tooDeep = loop(2, [loop(2, [loop(2, [loop(2, [step()])])])]);
  assert.match(validateBlocks([tooDeep]).join(' '), /niveaux/);
  const huge = [loop(100, [loop(100, [step({ duration_seconds: 1 }), step({ duration_seconds: 1 })])])];
  assert.throws(() => flattenBlocks(huge), /intervalles/);
  assert.ok(validateBlocks(Array.from({ length: WORKOUT_LIMITS.blocks + 1 }, () => step())).length);
});

test('summaries and flattening do not mutate source blocks', () => {
  const original = [loop(2, [step({ duration_seconds: 10, zone: 2 })])];
  const before = structuredClone(original);
  summarizeBlocks(original); flattenBlocks(original);
  assert.deepEqual(original, before);
});

test('calendar arithmetic handles leap years, week boundaries and complete month grids', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(weekStart('2026-09-27'), '2026-09-21');
  assert.equal(weekStart('2026-09-21'), '2026-09-21');
  const dates = monthDates('2026-09-21');
  assert.equal(dates.length, 42);
  assert.equal(dates[0], '2026-08-31');
  assert.equal(dates[41], '2026-10-11');
  assert.throws(() => addDays('2026-02-30', 1), RangeError);
  assert.throws(() => addDays('2026-09-21T00:00:00Z', 1), TypeError);
});

test('calendar dates remain stable across timezones and daylight-saving boundaries', () => {
  const module = new URL('../js/domain.js', import.meta.url).href;
  const script = `import { addDays, weekStart } from ${JSON.stringify(module)}; console.log(JSON.stringify([addDays('2026-03-07',1),addDays('2026-03-08',1),addDays('2026-11-01',1),weekStart('2026-03-08')]));`;
  for (const TZ of ['America/Toronto', 'Pacific/Honolulu', 'Pacific/Kiritimati', 'Europe/Paris']) {
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' }));
    assert.deepEqual(result, ['2026-03-08', '2026-03-09', '2026-11-02', '2026-03-02'], TZ);
  }
});

test('block editor creates nested blocks, keeps accessible ordering, edits doses and renders safe previews', async () => {
  const { Window } = await import('happy-dom');
  const window = new Window();
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'CustomEvent', 'getComputedStyle'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'getComputedStyle' ? window.getComputedStyle.bind(window) : name === 'window' ? window : window[name] });
  try {
    const { BlockEditor, renderWorkout } = await import('../js/editor.js');
    const mount = document.createElement('div'); document.body.append(mount);
    const suspiciousTitle = '<img src=x onerror=alert(1)>';
    let changes = 0;
    const editor = new BlockEditor(mount, { blocks: [step({ title: suspiciousTitle, duration_seconds: 600, zone: 1 })], onChange() { changes++; } });
    assert.equal(mount.querySelectorAll('.be-card').length, 1);
    assert.equal(mount.querySelector('img'), null);
    mount.querySelector('[data-action="duplicate"]').click();
    assert.equal(editor.getValue().length, 2);
    assert.notEqual(editor.getValue()[0].id, editor.getValue()[1].id);
    mount.querySelector(':scope > .be-addbar [data-action="add-repeat"]').click();
    assert.equal(editor.getValue()[2].children.length, 1);
    const input = mount.querySelector('[data-field="duration_seconds"]'); input.value = '1.5';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(editor.getValue()[0].duration_seconds, 90);
    mount.querySelector('[data-action="down"]').click();
    assert.equal(editor.getValue()[1].duration_seconds, 90);
    assert.equal(document.activeElement.getAttribute('aria-label'), 'Descendre ce bloc');
    mount.querySelector('[data-action="delete"]').click();
    assert.equal(editor.getValue().length, 2);
    const preview = document.createElement('div'); renderWorkout(preview, editor.getValue(), { sport: 'running' });
    assert.ok(preview.querySelector('svg[role="group"]'));
    assert.equal(preview.querySelector('img'), null);
    assert.ok(preview.textContent.includes(suspiciousTitle));
    assert.ok(changes >= 5);
    const independentCopy = editor.getValue(); independentCopy[0].title = 'Changed outside';
    assert.equal(editor.getValue()[0].title, suspiciousTitle);
    editor.destroy(); assert.equal(mount.childElementCount, 0);
    renderWorkout(preview, [step({ title:'400 m',distance_m:400,zone:4 }),step({title:'200 m récupération',distance_m:200,zone:1})], {sport:'running'});
    assert.equal(preview.querySelectorAll('svg rect').length,2);
    preview.querySelector('svg rect').dispatchEvent(new window.Event('click'));
    assert.match(preview.querySelector('.chart-tooltip').textContent,/400 m.*Z4/);
    assert.match(preview.querySelector('svg desc').textContent,/distance/);
    renderWorkout(preview,[step({distance_m:1000,duration_seconds:300,zone:3}),step({duration_seconds:120,zone:1})],{sport:'running',chartOnly:true});
    document.body.append(preview);
    assert.equal(preview.querySelectorAll('svg rect').length,2);
    preview.querySelectorAll('.chart-axis button')[1].click();
    assert.equal(preview.querySelectorAll('svg rect').length,1);
    assert.match(preview.querySelector('.workout-chart-note').textContent,/Profil partiel/);
    assert.equal(preview.querySelectorAll('.workout-step').length,0);
  } finally {
    await window.happyDOM.abort();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
});

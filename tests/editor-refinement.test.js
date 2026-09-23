import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { makeBlock, summarizeBlocks, WORKOUT_LIMITS } from '../js/domain.js';

const window = new Window({ url: 'http://localhost/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'CustomEvent']) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
const { BlockEditor } = await import('../js/editor.js');
const editors = new Set();
function fixture(options = {}) {
  const mount = document.createElement('div'); document.body.append(mount);
  let changes = 0;
  const editor = new BlockEditor(mount, { ...options, onChange() { changes++; } });
  editors.add(editor);
  return { editor, mount, changes: () => changes };
}
function change(node, value) {
  node.value = String(value);
  node.dispatchEvent(new window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}
function draft(mount, values) {
  for (const [key, value] of Object.entries(values)) change(mount.querySelector(`[data-interval="${key}"]`), value);
}
test.afterEach(() => { for (const editor of editors) editor.destroy(); editors.clear(); document.body.replaceChildren(); });
test.after(async () => { await window.happyDOM.abort(); });

test('running sessions default new top-level and nested steps to timed running', () => {
  const { editor, mount } = fixture({ sport: 'running' });
  mount.querySelector(':scope > .be-addbar [data-action="add-step"]').click();
  mount.querySelector(':scope > .be-addbar [data-action="add-repeat"]').click();
  mount.querySelector('.be-children .be-addbar [data-action="add-step"]').click();
  const [step, repeat] = editor.getValue();
  for (const block of [step, ...repeat.children]) {
    assert.equal(block.type, 'run'); assert.equal(block.duration_seconds, 300);
  }
  assert.equal(repeat.children.length, 2);
  assert.equal(mount.querySelector('[data-field="mode"]').value, 'time');
  assert.deepEqual(summarizeBlocks(editor.getValue()).errors, []);
});

test('changing sport affects future steps without rewriting existing blocks or library content', () => {
  const boxing = { ...makeBlock('bag'), title: 'Puissance', rounds: 3, work_seconds: 120, rest_seconds: 60 };
  const { editor, mount, changes } = fixture({ blocks: [boxing], sport: 'boxing' });
  assert.equal(mount.querySelector('.be-interval-builder'), null);
  editor.setSport('running');
  assert.ok(mount.querySelector('.be-interval-builder'));
  assert.deepEqual(editor.getValue(), [boxing]); assert.equal(changes(), 0);
  mount.querySelector(':scope > .be-addbar [data-action="add-step"]').click();
  editor.appendBlock({ ...makeBlock('mobility'), title: 'Étirements' });
  editor.setSport('boxing');
  mount.querySelector(':scope > .be-addbar [data-action="add-step"]').click();
  assert.deepEqual(editor.getValue().map(block => block.type), ['bag', 'run', 'mobility', 'other']);
  assert.deepEqual(editor.getValue()[0], boxing);
});

test('express intervals generate one editable sequence and correct duration and effort zones', () => {
  const { editor, mount, changes } = fixture({ sport: 'running' });
  mount.querySelector('[data-action="add-intervals"]').click();
  const [repeat] = editor.getValue();
  assert.equal(changes(), 1); assert.equal(repeat.kind, 'repeat'); assert.equal(repeat.repeat_count, 6);
  assert.equal(repeat.children.length, 2);
  assert.deepEqual(repeat.children.map(block => [block.type, block.duration_seconds, block.zone]), [['run', 120, 4], ['recovery', 60, 1]]);
  const summary = summarizeBlocks(editor.getValue());
  assert.equal(summary.duration_seconds, 1080); assert.equal(summary.segments.length, 12);
  assert.deepEqual(summary.errors, []);
  assert.equal(mount.querySelectorAll('.be-card').length, 3);
  assert.equal(document.activeElement.dataset.field, 'title');
});

test('express intervals support distance and seconds without inferring pace or duplicating forms', () => {
  const { editor, mount } = fixture({ sport: 'running' });
  draft(mount, { repeat_count: 8, effort: 400, effort_unit: 'm', recovery: 45, recovery_unit: 's', zone: 5 });
  mount.querySelector('[data-action="add-intervals"]').click();
  let summary = summarizeBlocks(editor.getValue());
  assert.equal(summary.distance_m, 3200); assert.equal(summary.duration_seconds, 360);
  assert.equal(summary.hasDistanceOnly, true); assert.equal(summary.segments.length, 16);
  const effort = editor.getValue()[0].children[0];
  assert.equal(effort.duration_seconds, null); assert.equal(effort.zone, 5);
  draft(mount, { repeat_count: 2, effort: 200, effort_unit: 'm', recovery: 100, recovery_unit: 'm', zone: '' });
  mount.querySelector('[data-action="add-intervals"]').click();
  summary = summarizeBlocks(editor.getValue());
  assert.equal(summary.distance_m, 3800); assert.equal(summary.duration_seconds, 360);
  assert.equal(editor.getValue()[1].children[0].zone, null);
});

test('zero recovery removes the recovery step and French decimal input remains precise', () => {
  const { editor, mount } = fixture({ sport: 'running' });
  draft(mount, { repeat_count: 3, effort: '1,5', effort_unit: 'min', recovery: 0 });
  mount.querySelector('[data-action="add-intervals"]').click();
  assert.equal(editor.getValue()[0].children.length, 1);
  assert.equal(summarizeBlocks(editor.getValue()).duration_seconds, 270);
});

test('Enter in interval inputs adds the sequence instead of submitting the surrounding session form', () => {
  const { editor, mount } = fixture({ sport: 'running' });
  const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  mount.querySelector('[data-interval="effort"]').dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(editor.getValue().length, 1);
  assert.equal(editor.getValue()[0].repeat_count, 6);
});

test('invalid interval drafts leave workout and callbacks unchanged with a visible error', () => {
  const original = { ...makeBlock('run'), title: 'Échauffement', duration_seconds: 600 };
  const { editor, mount, changes } = fixture({ blocks: [original], sport: 'running' });
  for (const invalid of [
    { repeat_count: 0 }, { repeat_count: 101 }, { repeat_count: 1.5 },
    { effort: 0 }, { effort: '' }, { effort: 'abc' }, { effort: 20000, effort_unit: 'min' },
    { recovery: -1 }, { recovery: 1000001, recovery_unit: 'm' },
  ]) {
    draft(mount, { repeat_count: 6, effort: 2, effort_unit: 'min', recovery: 1, recovery_unit: 'min', zone: 4, ...invalid });
    mount.querySelector('[data-action="add-intervals"]').click();
    assert.deepEqual(editor.getValue(), [original], JSON.stringify(invalid));
    assert.equal(changes(), 0);
    assert.equal(mount.querySelector('.be-interval-error').hidden, false);
    assert.ok(mount.querySelector('.be-interval-error').textContent.length);
  }
});

test('interval generator respects structural limits without partially appending a repeat', () => {
  const blocks = Array.from({ length: WORKOUT_LIMITS.siblings }, () => ({ ...makeBlock('run'), duration_seconds: 60 }));
  const { editor, mount, changes } = fixture({ blocks, sport: 'running' });
  mount.querySelector('[data-action="add-intervals"]').click();
  assert.deepEqual(editor.getValue(), blocks); assert.equal(changes(), 0);
  assert.equal(mount.querySelector('.be-interval-error').hidden, false);
});

test('compact cards keep instructions and tools collapsed and preserve disclosure choices through edits', () => {
  const original = { ...makeBlock('run'), title: 'Footing', description: 'Rester souple', duration_seconds: 600, notes: 'Terrain plat', intensity: 'easy' };
  const { editor, mount } = fixture({ blocks: [original], sport: 'running' });
  const id = original.id;
  const card = () => mount.querySelector(`[data-id="${id}"]`);
  const details = () => card().querySelector('.be-advanced');
  assert.equal(details().open, false);
  assert.equal(card().querySelector('[data-field="duration_seconds"]').closest('details'), null);
  for (const selector of ['[data-field="description"]', '[data-field="notes"]', '[data-action="duplicate"]']) assert.equal(card().querySelector(selector).closest('details'), details());
  assert.match(details().textContent, /Intensité cible/);
  assert.doesNotMatch(mount.textContent, /ressenti|RPE/i);
  details().open = true;
  change(card().querySelector('[data-field="mode"]'), 'mixed');
  assert.equal(details().open, true);
  change(card().querySelector('[data-field="distance_m"]'), 2000);
  mount.querySelector(':scope > .be-addbar [data-action="add-step"]').click();
  card().querySelector('[data-action="down"]').click();
  assert.equal(details().open, true);
  details().open = false;
  editor.setSport('boxing');
  assert.equal(details().open, false);
  const block = editor.getValue().find(block => block.id === id);
  assert.equal(block.duration_seconds, 600); assert.equal(block.distance_m, 2000);
  assert.equal(block.description, original.description); assert.equal(block.notes, original.notes);
});

test('interval draft survives card rearrangement and switching disciplines', () => {
  const { editor, mount } = fixture({ sport: 'running' });
  draft(mount, { repeat_count: 10, effort: 400, effort_unit: 'm', recovery: 90, recovery_unit: 's' });
  mount.querySelector(':scope > .be-addbar [data-action="add-step"]').click();
  editor.setSport('boxing'); editor.setSport('running');
  assert.equal(mount.querySelector('[data-interval="effort"]').value, '400');
  assert.equal(mount.querySelector('[data-interval="effort_unit"]').value, 'm');
  mount.querySelector('[data-action="add-intervals"]').click();
  assert.equal(editor.getValue()[1].repeat_count, 10);
  assert.equal(summarizeBlocks(editor.getValue()).distance_m, 4000);
});

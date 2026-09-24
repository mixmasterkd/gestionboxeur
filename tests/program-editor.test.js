import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { makeBlock, summarizeBlocks } from '../js/domain.js';

const window = new Window({ url: 'http://localhost/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'CustomEvent']) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
const { ProgramEditor } = await import('../js/program-editor.js');
const editors = new Set();
function fixture(options = {}) {
  const mount = document.createElement('div'); document.body.append(mount);
  let changes = 0;
  const editor = new ProgramEditor(mount, { ...options, onChange() { changes++; } }); editors.add(editor);
  return { editor, mount, changes: () => changes };
}
function change(node, value) { node.value = String(value); node.dispatchEvent(new window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }
const click = (mount, action) => mount.querySelector(`[data-action="${action}"]`).click();
const textMode = mount => mount.querySelector('[data-mode="text"]').click();
const fill = (mount, field, value) => change(mount.querySelector(`.pe-mini [data-field="${field}"]`), value);
test.afterEach(() => { for (const editor of editors) editor.destroy(); editors.clear(); document.body.replaceChildren(); });
test.after(async () => { await window.happyDOM.abort(); });

test('program is readable rows, one mini form at a time, and editing preserves advanced fields', () => {
  const original = { ...makeBlock('shadow'), title: 'Shadow', rounds: 3, work_seconds: 60, rest_seconds: 60, description: 'Faire du 8/16', notes: 'Note avancée', intensity: 'hard', repetitions: 12, future: { value: 7 } };
  const { editor, mount, changes } = fixture({ blocks: [original], sport: 'boxing' });
  assert.equal(mount.querySelectorAll('input,select,textarea').length, 0);
  assert.match(mount.querySelector('.pe-line').textContent, /Shadow.*3 × 1 min.*repos 1 min.*Faire du 8\/16/);
  click(mount, 'edit');
  assert.equal(mount.querySelectorAll('.pe-mini').length, 1);
  assert.equal(mount.querySelector('.pe-mini-advanced').open, false);
  assert.throws(() => editor.getValue(), /Valide ou annule/);
  fill(mount, 'work', '30s'); click(mount, 'apply-mini');
  const updated = editor.getValue()[0];
  assert.deepEqual(updated, { ...original, work_seconds: 30 });
  assert.equal(summarizeBlocks(editor.getValue()).duration_seconds, 210);
  assert.equal(changes(), 1);
});

test('new running steps and repeated effort use running by default; repeated recovery is explicit', () => {
  const { editor, mount } = fixture({ sport: 'running' });
  click(mount, 'add-step'); click(mount, 'apply-mini');
  assert.equal(editor.getValue()[0].type, 'run'); assert.equal(editor.getValue()[0].duration_seconds, 300);
  click(mount, 'add-repeat'); fill(mount, 'repeat_count', '6'); fill(mount, 'effort', '2m'); fill(mount, 'recovery', '1m'); click(mount, 'apply-mini');
  const repeat = editor.getValue()[1]; assert.equal(repeat.repeat_count, 6);
  assert.deepEqual(repeat.children.map(b => [b.type, b.duration_seconds]), [['run', 120], ['recovery', 60]]);
  assert.equal(summarizeBlocks([repeat]).duration_seconds, 1080);
  const nestedAdd = mount.querySelector('.pe-repeat > .pe-addbar [data-action="add-step"]'); nestedAdd.click(); click(mount, 'apply-mini');
  assert.equal(editor.getValue()[1].children[2].type, 'run');
});

test('mini form errors and cancellation never silently commit a partial block', () => {
  const { editor, mount, changes } = fixture(); click(mount, 'add-rounds'); fill(mount, 'rounds', '2.5'); click(mount, 'apply-mini');
  assert.match(mount.querySelector('.pe-mini .form-error').textContent, /entier/);
  assert.equal(changes(), 0); assert.throws(() => editor.getValue());
  [...mount.querySelectorAll('.pe-mini button')].find(b => b.textContent === 'Annuler').click();
  assert.deepEqual(editor.getValue(), []);
  click(mount, 'add-step'); fill(mount, 'duration', '400 mètres'); click(mount, 'apply-mini');
  assert.match(mount.querySelector('.pe-mini .form-error').textContent, /durée/);
});

test('text parses zones, rounds and recovery; invalid text keeps draft and last valid preview, and blocks saving', () => {
  const { editor, mount, changes } = fixture({ sport: 'running' }); textMode(mount);
  const text = mount.querySelector('.pe-text-input');
  const valid = 'Course\n2x\n  1m @ Z2\n  1m @ Z1 - Marcher\n\nShadow\n3 rounds 1m/1m - Faire du 8/16';
  change(text, valid); const blocks = editor.getValue();
  assert.equal(blocks.length, 2); assert.equal(blocks[0].kind, 'repeat'); assert.equal(blocks[1].description, 'Faire du 8/16');
  assert.equal(summarizeBlocks(blocks).duration_seconds, 540); assert.equal(changes(), 1);
  change(text, `${valid}\n1banane`);
  assert.throws(() => editor.getValue(), /ligne/); assert.equal(changes(), 1);
  assert.match(mount.querySelector('.pe-text-status').textContent, /dernier programme valide.*Ligne/s);
  assert.equal(text.getAttribute('aria-invalid'), 'true'); assert.equal(text.value, `${valid}\n1banane`);
  mount.querySelector('[data-mode="program"]').click(); assert.ok(mount.querySelector('.pe-text-input'));
  mount.querySelector('.pe-revert').click(); assert.deepEqual(editor.getValue(), blocks); assert.equal(mount.querySelector('.pe-text-input'), null);
});

test('mode switches preserve rich block data and changing sport does not rewrite the program', () => {
  const original = { ...makeBlock('bag'), title: 'Sac puissant', rounds: 4, work_seconds: 120, rest_seconds: 60, distance_m: 400, duration_seconds: 700, notes: 'A\nB', description: 'Ajuster', repetitions: 8, intensity: 'hard', future: { target: true } };
  const { editor, mount } = fixture({ blocks: [original], sport: 'boxing' });
  textMode(mount); const text = mount.querySelector('.pe-text-input'); change(text, text.value);
  const { id, ...actual } = editor.getValue()[0]; const { id: oldId, ...expected } = original;
  assert.deepEqual(actual, expected);
  mount.querySelector('[data-mode="program"]').click(); const before = editor.getValue(); editor.setSport('running'); assert.deepEqual(editor.getValue(), before);
});

test('pending mini input survives sport change and prevents appending a template unnoticed', () => {
  const { editor, mount } = fixture({ sport: 'running' }); click(mount, 'add-step'); fill(mount, 'title', 'Ma saisie');
  editor.setSport('boxing'); assert.equal(mount.querySelector('[data-field="title"]').value, 'Ma saisie');
  assert.throws(() => editor.appendBlock(makeBlock('bag')), /Valide ou annule/);
  click(mount, 'apply-mini'); assert.equal(editor.getValue()[0].title, 'Ma saisie'); assert.equal(editor.getValue()[0].type, 'run');
});

test('move and duplicate keep values while copies get independent IDs and repeats cannot be left empty', () => {
  const original = { ...makeBlock('repeat'), children: [{ ...makeBlock('run'), duration_seconds: 60 }] };
  const { editor, mount } = fixture({ blocks: [original, { ...makeBlock('bag'), title: 'Sac', duration_seconds: 120 }] });
  mount.querySelector('.pe-repeat > .pe-list [data-action="delete"]').click(); assert.match(mount.querySelector('.pe-error').textContent, /garder une étape/);
  click(mount, 'duplicate'); let blocks = editor.getValue(); assert.equal(blocks.length, 3);
  assert.notEqual(blocks[0].id, blocks[1].id); assert.notEqual(blocks[0].children[0].id, blocks[1].children[0].id);
  mount.querySelectorAll(':scope > .pe-list > .pe-row')[2].querySelector('[data-action="up"]').click();
  blocks = editor.getValue(); assert.equal(blocks[1].title, 'Sac');
});

test('nomenclature help covers units, nesting, notes and final-rest distinction without interpreting markup', () => {
  const { mount } = fixture({ blocks: [{ ...makeBlock('run'), title: '<img src=x>', description: '<script>bad()</script>', duration_seconds: 60 }] });
  const help = mount.querySelector('.pe-help'); assert.equal(help.open, false);
  assert.match(help.textContent, /m signifie toujours minutes/); assert.match(help.textContent, /sans repos après le dernier/);
  assert.match(help.textContent, /même la dernière/); assert.match(help.textContent, /pas d’intervalles automatiquement/);
  assert.equal(mount.querySelector('img,script'), null);
});

test('Tab inserts two spaces in text while Shift Tab remains available to leave the editor', () => {
  const { mount } = fixture(); textMode(mount); const text = mount.querySelector('.pe-text-input');
  change(text, '2x\n1m'); text.setSelectionRange(3, 3);
  const event = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }); text.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true); assert.equal(text.value, '2x\n  1m');
  const backward = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }); text.dispatchEvent(backward); assert.equal(backward.defaultPrevented, false);
});

test('distance format is an explicit choice and does not manufacture a duration', () => {
  const { editor, mount } = fixture({ sport: 'running' }); click(mount, 'add-step');
  change(mount.querySelector('[name="block_format"]'), 'distance'); fill(mount, 'distance', '400'); click(mount, 'apply-mini');
  assert.equal(editor.getValue()[0].duration_seconds, null); assert.equal(editor.getValue()[0].distance_m, 400);
  assert.equal(summarizeBlocks(editor.getValue()).hasDistanceOnly, true);
});

test('missing and duplicate block IDs are normalized so each row edits the intended block', () => {
  const first = { ...makeBlock('run'), title: 'Premier', duration_seconds: 60 }; delete first.id;
  const second = { ...first, title: 'Deuxième' };
  const { editor, mount } = fixture({ blocks: [first, second] });
  const values = editor.getValue(); assert.equal(new Set(values.map(b => b.id)).size, 2);
  mount.querySelectorAll('[data-action="edit"]')[1].click(); assert.equal(mount.querySelector('[data-field="title"]').value, 'Deuxième');
  click(mount, 'apply-mini'); editor.setValue([values[0], { ...values[0], title: 'Copie' }]);
  assert.equal(new Set(editor.getValue().map(b => b.id)).size, 2);
});

test('new repetitions apply type and zone only to their effort steps', () => {
  const { editor, mount } = fixture({ sport: 'boxing' }); click(mount, 'add-repeat');
  change(mount.querySelector('[name="block_type"]'), 'bag'); assert.equal(mount.querySelector('[name="block_intensity"]'), null);
  change(mount.querySelector('[name="block_zone"]'), '4'); click(mount, 'apply-mini');
  const effort = editor.getValue()[0].children[0]; assert.equal(effort.type, 'bag'); assert.equal(effort.intensity, null); assert.equal(editor.getValue()[0].zone, null); assert.equal(effort.zone, 4);
  mount.querySelector('[data-action="edit"]').click();
  assert.equal(mount.querySelector('[name="block_zone"]'), null, 'a repeat container has no second zone control');
});

test('session prose survives both editor views and invalid drafts without changing chart totals', () => {
  const { editor, mount } = fixture({ notes: 'Apporter les gants.\n\nRendez-vous à 18 h.', blocks: [{ ...makeBlock('run'), duration_seconds: 600 }] });
  textMode(mount);
  assert.match(mount.querySelector('.pe-text-input').value, /# Apporter les gants/);
  change(mount.querySelector('.pe-text-input'), '# Séance technique\nSparing 3 rounds 2m/1m');
  assert.equal(editor.getNotes(), 'Séance technique');
  assert.equal(editor.getValue()[0].type, 'sparring');
  assert.equal(summarizeBlocks(editor.getValue()).duration_seconds, 480);
  mount.querySelector('[data-mode="program"]').click();
  assert.equal(mount.querySelector('.pe-narrative').textContent, 'Séance technique');
  textMode(mount); change(mount.querySelector('.pe-text-input'), '# Nouveau brouillon\n3 rounds invalides');
  assert.throws(() => editor.getNotes(), /Corrige/);
  mount.querySelector('.pe-revert').click();
  assert.equal(editor.getNotes(), 'Séance technique');
});

test('editing a legacy zero dose or extra advanced timing preserves existing values', () => {
  for (const block of [
    { ...makeBlock('run'), duration_seconds: 0, rounds: 3, rest_seconds: 42 },
    { ...makeBlock('bag'), rounds: 3, work_seconds: 0, rest_seconds: null },
  ]) {
    const { editor, mount } = fixture({ blocks: [block] }); click(mount, 'edit'); click(mount, 'apply-mini');
    assert.deepEqual(editor.getValue(), [block]);
  }
});

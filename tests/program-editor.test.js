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
  const editor = new ProgramEditor(mount, { ...options, onChange() { changes++; } }); editors.add(editor); editor.switchMode('program');
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

test('a pyramid repeats every line in order with an explicit final recovery', () => {
  const { editor, mount } = fixture({ sport: 'running' });
  click(mount, 'add-repeat'); fill(mount, 'repeat_count', '5');
  assert.equal(mount.querySelector('.pe-mini input').name, 'block_count');
  assert.equal(mount.querySelector('[name="repeat_type"]').value, 'run');
  for (let i=0;i<3;i++) click(mount, 'add-repeat-line');
  const rows=[...mount.querySelectorAll('.pe-sequence-row')];
  ['2m','1m','30s','3m'].forEach((value,i)=>change(rows[i].querySelector('[data-field="duration"]'),value));
  ['2','3','4',''].forEach((value,i)=>change(rows[i].querySelector('[data-field="zone"]'),value));
  change(rows[3].querySelector('[data-field="phase"]'),'recovery');
  click(mount,'apply-mini');
  const repeat=editor.getValue()[0];
  assert.equal(repeat.repeat_count,5);assert.equal(repeat.zone,null);
  assert.deepEqual(repeat.children.map(b=>[b.type,b.duration_seconds,b.zone]),[['run',120,2],['run',60,3],['run',30,4],['recovery',180,null]]);
  const summary=summarizeBlocks([repeat]);assert.equal(summary.duration_seconds,1950);assert.equal(summary.segments.length,20);
  for(let i=0;i<5;i++)assert.deepEqual(summary.segments.slice(i*4,i*4+4).map(b=>b.duration_seconds),[120,60,30,180]);
  textMode(mount);const text=mount.querySelector('.pe-text-input');change(text,text.value);
  assert.equal(summarizeBlocks(editor.getValue()).duration_seconds,1950);
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

test('hybrid repetition requires explicit types and keeps each line zone and measurement', () => {
  const { editor, mount }=fixture({sport:'boxing'});click(mount,'add-repeat');
  change(mount.querySelector('[name="repeat_type"]'),'hybrid');click(mount,'add-repeat-line');
  const rows=[...mount.querySelectorAll('.pe-sequence-row')];
  change(rows[0].querySelector('[data-field="type"]'),'bag');change(rows[0].querySelector('[data-field="duration"]'),'2m');
  change(rows[1].querySelector('[data-field="duration"]'),'30s');click(mount,'apply-mini');
  assert.match(mount.querySelector('.pe-mini .form-error').textContent,/Étape 2.*type/);assert.throws(()=>editor.getValue());
  change(rows[1].querySelector('[data-field="type"]'),'burpees');change(rows[1].querySelector('[data-field="zone"]'),'5');click(mount,'apply-mini');
  assert.deepEqual(editor.getValue()[0].children.map(b=>b.type),['bag','burpees']);
  click(mount,'edit');assert.equal(mount.querySelector('[name="repeat_type"]').value,'hybrid');
  const second=mount.querySelectorAll('.pe-sequence-row')[1];change(second.querySelector('[data-field="format"]'),'distance');change(second.querySelector('[data-field="distance"]'),'400');
  change(second.querySelector('[data-field="type"]'),'run');click(mount,'apply-mini');
  assert.equal(editor.getValue()[0].children[1].duration_seconds,null);assert.equal(editor.getValue()[0].children[1].distance_m,400);assert.equal(editor.getValue()[0].children[1].zone,5);
});

test('repeat line ordering, removal and cancellation preserve drafts without partial writes',()=>{
 const {editor,mount,changes}=fixture({sport:'running'});click(mount,'add-repeat');
 change(mount.querySelector('.pe-sequence-row [data-field="duration"]'),'2m');click(mount,'add-repeat-line');
 let rows=mount.querySelectorAll('.pe-sequence-row');change(rows[1].querySelector('[data-field="duration"]'),'30s');
 rows[1].querySelector('[aria-label="Monter cette ligne"]').click();
 rows=mount.querySelectorAll('.pe-sequence-row');assert.equal(rows[0].querySelector('[data-field="duration"]').value,'30s');
 rows[1].querySelector('[aria-label="Supprimer cette ligne"]').click();assert.equal(mount.querySelector('[aria-label="Supprimer cette ligne"]').disabled,true);
 fill(mount,'repeat_count','2.5');click(mount,'apply-mini');assert.equal(changes(),0);assert.match(mount.querySelector('.pe-mini .form-error').textContent,/entier/);
 [...mount.querySelectorAll('.pe-mini-actions button')].find(b=>b.textContent==='Annuler').click();assert.deepEqual(editor.getValue(),[]);
});

test('editing repeat count preserves legacy rich and nested children',()=>{
 const repeat={...makeBlock('repeat'),children:[{...makeBlock('bag'),title:'Sac technique',rounds:3,work_seconds:60,rest_seconds:null,duration_seconds:240,distance_m:500,repetitions:12,intensity:'hard',future:{x:1}}, {...makeBlock('repeat'),children:[{...makeBlock('run'),duration_seconds:30}]}]};
 const {editor,mount}=fixture({blocks:[repeat]});click(mount,'edit');fill(mount,'repeat_count','7');click(mount,'apply-mini');
 assert.deepEqual(editor.getValue(),[{...repeat,repeat_count:7}]);
});

test('grouped step choices include boxing equipment and round trip through text',()=>{
 for(const type of ['jump_rope','speed_ball','double_end_bag','jog','burpees']){
  const {editor,mount}=fixture();click(mount,'add-step');const select=mount.querySelector('[name="block_type"]');
  assert.equal(select.querySelectorAll('optgroup').length,4);change(select,type);click(mount,'apply-mini');
  textMode(mount);const text=mount.querySelector('.pe-text-input');change(text,text.value);assert.equal(editor.getValue()[0].type,type);
 }
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

test('new editor opens with blank text on the left and hides movement repetition controls without erasing legacy values',()=>{
 const mount=document.createElement('div');document.body.append(mount);const editor=new ProgramEditor(mount);editors.add(editor);
 assert.equal(editor.mode,'text');assert.equal(mount.querySelector('.pe-text-input').value,'');
 assert.deepEqual([...mount.querySelectorAll('[data-mode]')].map(n=>n.dataset.mode),['text','program']);
 editor.switchMode('program');click(mount,'add-step');assert.equal(mount.querySelector('[name=block_repetitions]'),null);
});

 test('repeat changes preserve empty names, zero doses and unknown fields in existing steps',()=>{
 const repeat={...makeBlock('repeat'),title:'',future:'keep',children:[{...makeBlock('run'),duration_seconds:0,notes:'Note',future:{x:2}}]};
 const {editor,mount}=fixture({blocks:[repeat]});click(mount,'edit');fill(mount,'repeat_count','3');click(mount,'apply-mini');assert.deepEqual(editor.getValue(),[{...repeat,repeat_count:3}]);
});

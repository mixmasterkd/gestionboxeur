import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { getStarterTemplates } from '../js/starter-templates.js';
import { makeBlock } from '../js/domain.js';

const window = new Window({ url: 'http://localhost/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'CustomEvent']) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
const nativeTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...args) => { const timer = nativeTimeout(...args); timer.unref?.(); return timer; };
const { createLibraryUI } = await import('../js/library.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const ownTemplate = (id = 'personal-1', kind = 'session') => ({ id, coach_id: 'coach1', title: kind === 'block' ? 'Bloc personnel' : 'Course personnelle', sport: 'running', description: '', notes: '', blocks: [{ ...makeBlock('run'), duration_seconds: 1200 }], kind });
function fixture({ athlete = false, templates = [], canAdd = () => true, api = {}, onUseTemplate, onCreateTemplate } = {}) {
  document.body.innerHTML = '<dialog id="libraryDialog"><div id="libraryContent"></div></dialog><dialog id="confirmDialog"><h2 id="confirmTitle"></h2><p id="confirmText"></p><button id="confirmYes"></button></dialog><div id="toast" hidden></div>';
  const state = { user: { id: athlete ? 'athlete1' : 'coach1' }, profile: { account_type: athlete ? 'athlete' : 'coach' }, selectedAthlete: { id: 'a1' } };
  const calls = [], backend = {
    getLibraryFolders: async()=>[],
    getTemplates: async () => { calls.push(['get']); return structuredClone(templates); },
    saveTemplate: async payload => { calls.push(['save', payload]); return { ...payload, id: 'saved-1' }; },
    deleteTemplate: async id => { calls.push(['delete', id]); }, ...api,
  };
  const ui = createLibraryUI({ getState: () => state, canAdd, onCreateTemplate, onUseTemplate: onUseTemplate || (copy => calls.push(['use', copy])), api: backend });
  return { ui, state, calls, backend };
}
const source = value => {const select=document.querySelector('[name=library_folder]');select.value=value==='starter'?'base:running':value;select.dispatchEvent(new window.Event('change'));};
const card = id => document.querySelector(`.template-card[data-template-id="${id}"]`);
const action = (id, name) => card(id).querySelector(`[data-action="${name}"]`);
const confirm = value => document.getElementById('confirmDialog').close(value ? 'confirm' : 'cancel');
test.afterEach(() => { document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); });
test.after(async () => { await window.happyDOM.abort(); });

test('coach library separates private models and the starter kit without automatic saves', async () => {
  const { ui, calls } = fixture({ templates: [ownTemplate(), { ...ownTemplate('foreign'), coach_id: 'other' }] });
  await ui.open();
  assert.equal(document.querySelectorAll('.template-card').length, 1);
  assert.equal(card('foreign'), null);
  source('starter');
  assert.equal(document.querySelectorAll('.template-card').length, getStarterTemplates().filter(t=>t.sport==='running').length);
  assert.equal(document.querySelectorAll('[data-action="delete-template"]').length, 0);
  assert.deepEqual(calls, [['get']]);
});

test('kit remains usable while private models load or fail', async () => {
  const pending = deferred();
  const { ui, calls } = fixture({ api: { getTemplates: () => pending.promise } });
  const opening = ui.open(); await tick(); source('starter');
  assert.equal(document.querySelectorAll('.template-card').length, getStarterTemplates().filter(t=>t.sport==='running').length);
  pending.reject(new Error('Service indisponible')); await opening;
  assert.match(document.querySelector('[role="alert"]').textContent, /dossiers de base restent disponibles/);
  action('starter-jog-10', 'use-template').click();
  assert.equal(calls[0][0], 'use');
});

test('using a kit session makes a fresh editable copy without saving or changing its source', async () => {
  const copies = [], { ui, calls } = fixture({ onUseTemplate: copy => copies.push(copy) });
  await ui.open(); source('starter'); action('starter-jog-10', 'use-template').click();
  copies[0].blocks[0].duration_seconds = 999;
  await ui.open(); source('starter'); action('starter-jog-10', 'use-template').click();
  assert.equal(copies[1].blocks[0].duration_seconds, 600);
  assert.notEqual(copies[0].blocks[0].id, copies[1].blocks[0].id);
  assert.equal(calls.some(call => call[0] === 'save'), false);
});

test('explicit keep saves sanitized content once and gives per-model feedback', async () => {
  const saving = deferred(), writes = [];
  const { ui } = fixture({ api: { saveTemplate: async payload => { writes.push(payload); await saving.promise; return { ...payload, id: 'copy1' }; } } });
  await ui.open(); source('starter'); action('starter-jog-10', 'keep-template').click(); await tick();
  source('personal'); source('starter'); action('starter-jog-10', 'keep-template').click();
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]).sort(), ['blocks', 'coach_id', 'description', 'kind', 'notes', 'sport', 'title', 'workout_document']);
  assert.equal(writes[0].coach_id, 'coach1');
  saving.resolve(); await tick();
  assert.equal(action('starter-jog-10', 'keep-template').disabled, true);
  assert.match(card('starter-jog-10').querySelector('[role="status"]').textContent, /Ajouté/);
  source('personal'); assert.ok(card('copy1'));
});

test('identical existing personal copies are detected regardless of fresh block IDs', async () => {
  const saved = { ...getStarterTemplates()[0], id: 'existing-copy', coach_id: 'coach1' }; delete saved.source;
  const { ui, calls } = fixture({ templates: [saved] });
  await ui.open(); source('starter');
  assert.equal(action('starter-jog-10', 'keep-template').disabled, true);
  assert.match(action('starter-jog-10', 'keep-template').textContent, /Déjà/);
  assert.equal(calls.some(call => call[0] === 'save'), false);
});

test('closing and reopening while a kit save is pending cannot create duplicate copies', async () => {
  const saving = deferred(); let writes = 0;
  const { ui } = fixture({ api: { saveTemplate: async payload => { writes++; await saving.promise; return { ...payload, id: 'delayed-copy' }; } } });
  await ui.open(); source('starter'); action('starter-jog-10', 'keep-template').click(); await tick();
  document.getElementById('libraryDialog').close(); await ui.open(); source('starter');
  assert.equal(action('starter-jog-10', 'keep-template').disabled, true);
  action('starter-jog-10', 'keep-template').click(); assert.equal(writes, 1);
  saving.resolve(); await tick();
  assert.match(action('starter-jog-10', 'keep-template').textContent, /Déjà/);
  source('personal'); assert.ok(card('delayed-copy'));
});

test('deleting a copied model enables saving it again, without reviving it from late list results', async () => {
  const loading = deferred();
  const { ui, calls } = fixture({ api: { getTemplates: () => loading.promise } });
  const opening = ui.open(); await tick(); source('starter'); action('starter-jog-10', 'keep-template').click(); await tick();
  const saved = { ...calls.find(call => call[0] === 'save')[1], id: 'saved-1' };
  source('personal'); action('saved-1', 'delete-template').click(); await tick(); confirm(true); await tick();
  loading.resolve([saved]); await opening;
  assert.equal(card('saved-1'), null);
  source('starter'); assert.equal(action('starter-jog-10', 'keep-template').disabled, false);
});

test('keep failure stays beside the affected model and permits a retry', async () => {
  let saves = 0;
  const { ui } = fixture({ api: { saveTemplate: async payload => { if (++saves === 1) throw new Error('Connexion interrompue'); return { ...payload, id: 'retry-copy' }; } } });
  await ui.open(); source('starter'); action('starter-jog-10', 'keep-template').click(); await tick();
  assert.match(card('starter-jog-10').querySelector('[role="alert"]').textContent, /Connexion interrompue/);
  assert.equal(action('starter-jog-10', 'keep-template').disabled, false);
  action('starter-jog-10', 'keep-template').click(); await tick();
  assert.equal(saves, 2); assert.equal(action('starter-jog-10', 'keep-template').disabled, true);
});

test('search and session/block filters remain active across library sources', async () => {
  const { ui } = fixture({ templates: [ownTemplate(), ownTemplate('block1', 'block')] });
  await ui.open(); document.querySelector('[data-kind="block"]').click();
  assert.equal(document.querySelectorAll('.template-card').length, 1);
  source('starter'); assert.equal(document.querySelectorAll('.template-card').length, 0);
  document.querySelector('[data-kind="session"]').click();
  const search = document.querySelector('input[type="search"]'); search.value = 'JOG 25'; search.dispatchEvent(new window.Event('input'));
  assert.equal(document.querySelectorAll('.template-card').length, 1); assert.ok(card('starter-jog-25'));
});

test('block selection copies blocks even when adding calendar sessions is not permitted', async () => {
  let selected;
  const { ui } = fixture({ templates: [ownTemplate('block1', 'block')], canAdd: () => false });
  await ui.open({ kind: 'block', onSelect: template => { selected = template; } });
  action('block1', 'use-template').click();
  assert.equal(selected.kind, 'block'); assert.equal(document.getElementById('libraryDialog').open, false);
});

test('athletes use their own library and cannot see another owner’s models', async () => {
  const document={version:1,text:'Ma consigne personnalisée',marks:[{start:0,end:2,bold:true}]};
  const own={...ownTemplate('athlete-template'),coach_id:'athlete1',workout_document:document};
  const { ui, calls } = fixture({ athlete: true,templates:[own,ownTemplate('coach-template')] });
  await ui.open(); assert.ok(card('athlete-template')); assert.equal(card('coach-template'),null);
  action('athlete-template','use-template').click();
  const copied=calls.find(call=>call[0]==='use')[1];
  assert.deepEqual(copied.workout_document,document);
  copied.workout_document.marks[0].end=5;
  assert.equal(document.marks[0].end,2);
});

test('model preview displays authored text safely and its chart, including sessions without structured steps',async()=>{
 const workout_document={version:1,text:'<script>texte libre</script>',marks:[{start:0,end:8,bold:true,color:'lavender'}]};
 const {ui}=fixture({templates:[{...ownTemplate(),blocks:[],workout_document}]});await ui.open();
 const preview=card('personal-1').querySelector('details');preview.open=true;preview.dispatchEvent(new window.Event('toggle'));
 const body=preview.querySelector('.template-preview');assert.equal(body.querySelector('script'),null);
 assert.equal(body.querySelector('.training-document')?.textContent ?? body.childNodes[0]?.textContent,workout_document.text);
 assert.ok(body.querySelector('[data-color="lavender"]'));assert.ok(body.querySelector('.session-chart'));
});

test('permission and account changes are checked again when using or saving a model', async () => {
  let allowed = true;
  const { ui, state, calls } = fixture({ canAdd: () => allowed });
  await ui.open(); source('starter'); allowed = false; action('starter-jog-10', 'use-template').click();
  assert.equal(document.getElementById('libraryDialog').open, true);
  state.user.id = 'coach2'; action('starter-jog-10', 'keep-template').click(); await tick();
  assert.equal(calls.some(call => ['save', 'use'].includes(call[0])), false);
});

test('late loads from a previous account or opening do not overwrite the current view', async () => {
  const oldLoad = deferred(); let requests = 0;
  const { ui, state } = fixture({ api: { getTemplates: () => ++requests === 1 ? oldLoad.promise : Promise.resolve([{ ...ownTemplate('new-owner'), coach_id: 'coach2', title: 'Nouveau compte' }]) } });
  const oldOpening = ui.open(); await tick(); state.user.id = 'coach2'; await ui.open();
  oldLoad.resolve([ownTemplate('stale')]); await oldOpening;
  assert.ok(card('new-owner')); assert.equal(card('stale'), null);
});

test('only owned personal models may be deleted and cancellation preserves them', async () => {
  const { ui, calls } = fixture({ templates: [ownTemplate()] });
  await ui.open(); action('personal-1', 'delete-template').click(); await tick();
  assert.equal(document.getElementById('confirmDialog').open, true);
  confirm(false); await tick(); assert.equal(calls.some(call => call[0] === 'delete'), false);
  action('personal-1', 'delete-template').click(); await tick(); confirm(true); await tick();
  assert.deepEqual(calls.filter(call => call[0] === 'delete'), [['delete', 'personal-1']]);
  assert.equal(card('personal-1'), null);
});

test('changing accounts during deletion confirmation prevents the write', async () => {
  const { ui, state, calls } = fixture({ templates: [ownTemplate()] });
  await ui.open(); action('personal-1', 'delete-template').click(); await tick(); state.user.id = 'coach2';
  confirm(true); await tick(); assert.equal(calls.some(call => call[0] === 'delete'), false);
});


test('library creates workouts without a selected athlete and keeps block selection scoped', async () => {
  let creates = 0;
  const { ui, state } = fixture({ canAdd: () => false, onCreateTemplate: () => { creates++; } });
  state.selectedAthlete = null;
  await ui.open();
  [...document.querySelectorAll('button')].find(button => button.textContent.includes('Créer un entraînement')).click();
  assert.equal(creates, 1); assert.equal(document.getElementById('libraryDialog').open, false);
  for (const options of [{ kind: 'block' }, { kind: 'session', onSelect: () => {} }]) {
    await ui.open(options);
    assert.equal([...document.querySelectorAll('button')].some(button => button.textContent.includes('Créer un entraînement')), false);
  }
});

test('library shows base folders and persists custom folder creation and template moves',async()=>{
 const folder={id:'f1',owner_id:'coach1',name:'Combat'},moves=[];
 const {ui}=fixture({templates:[ownTemplate()],api:{getLibraryFolders:async()=>[folder],saveLibraryFolder:async name=>({id:'f2',owner_id:'coach1',name}),moveTemplate:async(t,id)=>{moves.push(id);return {...t,folder_id:id};}}});
 await ui.open();assert.doesNotMatch(document.getElementById('libraryContent').textContent,/Kit de départ/i);
 assert.match(document.querySelector('[name=library_folder]').textContent,/Jog - Base.*Boxe - Base/);
 const move=document.querySelector('[name=template_folder]');move.value='f1';move.dispatchEvent(new window.Event('change'));await tick();assert.deepEqual(moves,['f1']);
 source('f1');assert.ok(card('personal-1'));
 [...document.querySelectorAll('button')].find(b=>b.textContent==='＋ Dossier').click();document.querySelector('[name=folder_name]').value='Technique';[...document.querySelectorAll('button')].find(b=>b.textContent==='Enregistrer').click();await tick();assert.equal(document.querySelector('[name=library_folder]').value,'f2');
});

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
function fixture({ athlete = false, templates = [], canAdd = () => true, api = {}, onUseTemplate, onCreateTemplate, onEditTemplate } = {}) {
  document.body.innerHTML = '<dialog id="libraryDialog"><div id="libraryContent"></div></dialog><dialog id="confirmDialog"><h2 id="confirmTitle"></h2><p id="confirmText"></p><button id="confirmYes"></button></dialog><div id="toast" hidden></div>';
  const state = { user: { id: athlete ? 'athlete1' : 'coach1' }, profile: { account_type: athlete ? 'athlete' : 'coach' }, selectedAthlete: { id: 'a1' } };
  let initialized=false,records=structuredClone(templates);const baseFolders=[];
  const calls = [], backend = {
    initializeLibrary:async()=>{if(initialized)return;initialized=true;for(const t of getStarterTemplates()){const id=t.sport==='running'?'base:running':'base:boxing';if(!baseFolders.some(f=>f.id===id))baseFolders.push({id,owner_id:state.user.id,name:t.sport==='running'?'Jog - Base':'Boxe - Base'});const copy={...t,coach_id:state.user.id,folder_id:id,updated_at:'v1'};delete copy.source;records.push(copy);}},
    getLibraryFolders: async()=>baseFolders,
    getTemplates: async () => { calls.push(['get']); return structuredClone(records); },
    saveTemplate: async payload => { calls.push(['save', payload]); return { ...payload, id: 'saved-1' }; },
    deleteTemplate: async id => { calls.push(['delete', id]);records=records.filter(t=>t.id!==id); },
    deleteLibraryFolder:async(folder,contents)=>{calls.push(['deleteFolder',folder,contents]);records=records.filter(t=>t.folder_id!==folder.id);const i=baseFolders.findIndex(f=>f.id===folder.id);if(i>=0)baseFolders.splice(i,1);}, ...api,
    getLibraryFolders:async()=>[...baseFolders,...(await api.getLibraryFolders?.()||[])],
  };
  const ui = createLibraryUI({ getState: () => state, canAdd, onCreateTemplate, onEditTemplate, onUseTemplate: onUseTemplate || (copy => calls.push(['use', copy])), api: backend });
  return { ui, state, calls, backend };
}
const source = value => {const select=document.querySelector('[name=library_folder]');select.value=value==='starter'?'base:running':value;select.dispatchEvent(new window.Event('change'));};
const card = id => document.querySelector(`.template-card[data-template-id="${id}"]`);
const action = (id, name) => card(id).querySelector(`[data-action="${name}"]`);
const confirm = value => document.getElementById('confirmDialog').close(value ? 'confirm' : 'cancel');
test.afterEach(() => { document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); });
test.after(async () => { await window.happyDOM.abort(); });

test('bases become owned library workouts with the same delete action', async () => {
  const { ui, calls } = fixture({ templates: [ownTemplate(), { ...ownTemplate('foreign'), coach_id: 'other' }] });
  await ui.open();
  assert.equal(document.querySelectorAll('.template-card').length, getStarterTemplates().length+1);
  assert.equal(card('foreign'), null);
  source('starter');
  assert.equal(document.querySelectorAll('.template-card').length, getStarterTemplates().filter(t=>t.sport==='running').length);
  assert.equal(document.querySelectorAll('[data-action="delete-template"]').length, 11);
  assert.deepEqual(calls, [['get']]);
});

test('loading failures do not show temporary bases that could undo a previous deletion',async()=>{
 const pending=deferred();const {ui}=fixture({api:{getTemplates:()=>pending.promise}});const opening=ui.open();await tick();
 assert.equal(document.querySelectorAll('.template-card').length,0);pending.reject(new Error('Indisponible'));await opening;
 assert.match(document.querySelector('[role=alert]').textContent,/bibliothèque n’a pas pu être chargée/);assert.equal(document.querySelectorAll('.template-card').length,0);
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

test('discipline filters combine with folders and search, including historical sparring',async()=>{
 const templates=[ownTemplate(),{...ownTemplate('b1'),sport:'boxing',folder_id:'f1'},{...ownTemplate('b2'),sport:'sparring',folder_id:'f1'},{...ownTemplate('r1'),sport:'running',folder_id:'f1'}];
 const {ui}=fixture({templates,api:{getLibraryFolders:async()=>[{id:'f1',owner_id:'coach1',name:'Test'}]}});
 await ui.open();const filter=document.querySelector('[name=library_discipline]');assert.equal(document.querySelector('[name=library_type]'),null);
 filter.value='boxing';filter.dispatchEvent(new window.Event('change'));assert.equal(document.querySelectorAll('.template-card').length,4);
 source('f1');assert.equal(document.querySelectorAll('.template-card').length,2);
 filter.value='running';filter.dispatchEvent(new window.Event('change'));assert.equal(document.querySelectorAll('.template-card').length,1);assert.ok(card('r1'));
 source('all');const search=document.querySelector('input[type=search]');search.value='JOG 25';search.dispatchEvent(new window.Event('input'));assert.equal(document.querySelectorAll('.template-card').length,1);assert.ok(card('starter-jog-25'));
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
  const { ui, state, calls } = fixture({ canAdd: () => allowed,onEditTemplate:()=>calls.push(['edit']) });
  await ui.open(); source('starter'); allowed = false; action('starter-jog-10', 'use-template').click();
  assert.equal(document.getElementById('libraryDialog').open, true);
  state.user.id = 'coach2'; action('starter-jog-10', 'edit-template').click(); await tick();
  assert.equal(calls.some(call => ['save', 'use','edit'].includes(call[0])), false);
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
 const folder={id:'f1',owner_id:'coach1',name:'Combat'};
 const {ui}=fixture({templates:[{...ownTemplate(),folder_id:'f1'}],api:{getLibraryFolders:async()=>[folder],saveLibraryFolder:async name=>({id:'f2',owner_id:'coach1',name})}});
 await ui.open();assert.doesNotMatch(document.getElementById('libraryContent').textContent,/Kit de départ/i);
 assert.match(document.querySelector('[name=library_folder]').textContent,/Jog - Base.*Boxe - Base/);
 source('f1');assert.ok(card('personal-1'));
 [...document.querySelectorAll('button')].find(b=>b.textContent==='＋ Dossier').click();document.querySelector('[name=folder_name]').value='Technique';[...document.querySelectorAll('button')].find(b=>b.textContent==='Enregistrer').click();await tick();assert.equal(document.querySelector('[name=library_folder]').value,'f1');assert.ok(card('personal-1'));assert.match(document.querySelector('.library-notice').textContent,/Dossier ajouté/);
});


test('global search finds bases and private folder content; the folder and type can narrow it',async()=>{
 const folders=[{id:'f1',owner_id:'coach1',name:'Technique'}];
 const {ui}=fixture({templates:[{...ownTemplate(),folder_id:'f1',title:'Jog technique'}],api:{getLibraryFolders:async()=>folders}});
 await ui.open();assert.equal(document.querySelector('[name=library_folder]').value,'all');
 const search=document.querySelector('input[type=search]');search.value='jog';search.dispatchEvent(new window.Event('input'));
 assert.equal(document.querySelectorAll('.template-card').length,12);assert.ok(document.querySelector('.library-search svg'));
 source('f1');assert.equal(document.querySelectorAll('.template-card').length,1);
 search.value='technique';search.dispatchEvent(new window.Event('input'));assert.ok(card('personal-1'));assert.equal(document.querySelector('[name=library_folder]').value,'f1');
 source('unfiled');assert.equal(document.querySelectorAll('.template-card').length,0);
});

test('editing and cancelling return to the same filtered library and creating defaults to its folder',async()=>{
 let options,edited;
 const folders=[{id:'f1',owner_id:'coach1',name:'Technique'}];
 const {ui}=fixture({templates:[{...ownTemplate(),folder_id:'f1'}],api:{getLibraryFolders:async()=>folders},onEditTemplate:(t,o)=>{edited=t;options=o;},onCreateTemplate:o=>{options=o;}});
 await ui.open();source('f1');const search=document.querySelector('input[type=search]');search.value='personnelle';search.dispatchEvent(new window.Event('input'));
 action('personal-1','edit-template').click();assert.equal(edited.id,'personal-1');assert.equal(options.folderId,'f1');
 options.onClose();await tick();await tick();assert.equal(document.querySelector('[name=library_folder]').value,'f1');assert.equal(document.querySelector('input[type=search]').value,'personnelle');assert.ok(card('personal-1'));
 document.querySelector('[data-action=create-template]').click();assert.equal(options.folderId,'f1');options.onClose();await tick();await tick();assert.equal(document.getElementById('libraryDialog').open,true);
});

test('editing an owned base opens an independent draft and obsolete returns cannot reopen the library',async()=>{
 let options,draft;const {ui,state,calls}=fixture({onEditTemplate:(t,o)=>{draft=t;options=o;}});
 await ui.open();action('starter-jog-10','edit-template').click();assert.equal(draft.source,undefined);assert.equal(draft.coach_id,'coach1');assert.equal(calls.some(c=>c[0]==='save'),false);
 draft.workout_document.text='Changed';draft.blocks[0].duration_seconds=1;assert.equal(getStarterTemplates()[0].blocks[0].duration_seconds,600);
 state.user.id='other';options.onClose();await tick();assert.equal(document.getElementById('libraryDialog').open,false);
});


test('deleted base workouts and folders stay gone after reopening',async()=>{
 const {ui}=fixture();await ui.open();action('starter-jog-10','delete-template').click();await tick();confirm(true);await tick();
 document.getElementById('libraryDialog').close();await ui.open();assert.equal(card('starter-jog-10'),null);
 source('base:boxing');document.querySelector('[data-action=delete-folder]').click();await tick();assert.match(document.getElementById('confirmText').textContent,/2 éléments/);confirm(true);await tick();
 document.getElementById('libraryDialog').close();await ui.open();assert.equal(card('starter-sparring'),null);assert.equal(card('starter-boxing-fundamentals'),null);assert.equal(document.querySelector('[name=library_folder] option[value="base:boxing"]'),null);
});

test('folder confirmation counts hidden workouts and cancellation or account replacement prevents deletion',async()=>{
 const folder={id:'f1',owner_id:'coach1',name:'Mon dossier'},templates=[{...ownTemplate('run'),folder_id:'f1'},{...ownTemplate('box'),folder_id:'f1',sport:'boxing'},ownTemplate('outside')];
 const {ui,state,calls}=fixture({templates,api:{getLibraryFolders:async()=>[folder]}});await ui.open();source('f1');const filter=document.querySelector('[name=library_discipline]');filter.value='running';filter.dispatchEvent(new window.Event('change'));
 assert.equal(document.querySelectorAll('.template-card').length,1);document.querySelector('[data-action=delete-folder]').click();await tick();
 assert.match(document.getElementById('confirmText').textContent,/2 éléments.*tous filtres.*TOUS.*définitivement/s);confirm(false);await tick();assert.equal(calls.some(c=>c[0]==='deleteFolder'),false);
 document.querySelector('[data-action=delete-folder]').click();await tick();state.user.id='other';confirm(true);await tick();assert.equal(calls.some(c=>c[0]==='deleteFolder'),false);
});

test('empty folders can be deleted and a concurrent change preserves the folder with an error',async()=>{
 const folder={id:'f1',owner_id:'coach1',name:'Vide'};
 const {ui,calls,backend}=fixture({api:{getLibraryFolders:async()=>[folder]}});await ui.open();source('f1');document.querySelector('[data-action=delete-folder]').click();await tick();assert.match(document.getElementById('confirmText').textContent,/dossier vide/);
 confirm(true);await tick();assert.equal(calls.find(c=>c[0]==='deleteFolder')[2].length,0);assert.equal(document.querySelector('[name=library_folder]').value,'all');
 await ui.open();source('f1');backend.deleteLibraryFolder=async()=>{throw new Error('Le contenu du dossier a changé.');};document.querySelector('[data-action=delete-folder]').click();await tick();confirm(true);await tick();assert.match(document.querySelector('[role=alert]').textContent,/contenu du dossier a changé/);assert.equal(document.querySelector('[name=library_folder]').value,'f1');
});

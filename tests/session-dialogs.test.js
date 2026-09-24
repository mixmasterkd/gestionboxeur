import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'CustomEvent']) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
// Keep UI notification timers from holding the Node test process open.
const nativeTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...args) => { const timer = nativeTimeout(...args); timer.unref?.(); return timer; };
const { createSessionUI } = await import('../js/session-dialogs.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const session = () => ({ id: 's1', athlete_id: 'a1', created_by: 'coach1', author_name: 'Eric', title: 'Intervalles', sport: 'running', date: '2026-09-21', sort_order: 2048, description: 'Consignes', notes: '', blocks: [], completed_at:null, updated_at: 'version1' });
function fixture({ athlete = false, api = {}, canEdit = () => true, canAdd = () => true, openLibrary, onRefresh } = {}) {
  document.body.replaceChildren();
  for (const [dialogId, contentId] of [['sessionDialog', 'sessionDialogContent'], ['detailDialog', 'detailContent'], ['eventDialog', 'eventDialogContent']]) {
    const dialog = document.createElement('dialog'); dialog.id = dialogId;
    const content = document.createElement('div'); content.id = contentId; dialog.append(content); document.body.append(dialog);
  }
  const toast = document.createElement('div'); toast.id = 'toast'; document.body.append(toast);
  const state = { user: { id: athlete ? 'athlete1' : 'coach1' }, profile: { account_type: athlete ? 'athlete' : 'coach' }, selectedAthlete: { id: 'a1', user_id: 'athlete1', first_name: 'Martin', last_name: 'Test' }, relation: { can_view_feedback: true }, sessions: [session()], events: [], feedback: [] };
  let refreshed = 0;
  const ui = createSessionUI({ getState: () => state, refresh: async () => { refreshed++; await onRefresh?.(); }, openLibrary, canEdit, canAdd, api: { loadCalendar: async () => ({ sessions: state.sessions }), ...api } });
  return { ui, state, refreshed: () => refreshed };
}
function submit(dialogId) { document.querySelector(`#${dialogId} form`).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }
function writeTraining(text) {
  const editor=document.querySelector('.pe-text-input'); editor.textContent=text;
  editor.dispatchEvent(new window.Event('input',{bubbles:true})); return editor;
}

test('a coach can create a reusable workout without an athlete or calendar write permission', async () => {
  let payload;
  const { ui, state } = fixture({ canAdd: () => false, api: { saveTemplate: async data => { payload = data; } } });
  state.selectedAthlete = null;
  ui.editTemplate();
  document.querySelector('[name="title"]').value = 'Sparring technique';
  assert.equal(document.querySelector('[name="sport"]').value, 'boxing');
  assert.equal(document.querySelector('[name="sport"] option').value, 'boxing');
  assert.equal(document.querySelector('[name="sport"] option[value="sparring"]'), null);
  writeTraining('Travail léger, détails à préciser');
  assert.equal(document.querySelector('[name="date"]'), null);
  submit('sessionDialog'); await tick();
  assert.equal(payload.kind, 'session'); assert.equal(payload.sport, 'boxing'); assert.equal(payload.coach_id, 'coach1');
  assert.equal(payload.notes, ''); assert.equal(payload.workout_document.text, 'Travail léger, détails à préciser'); assert.deepEqual(payload.blocks, []);
  assert.equal(payload.athlete_id, undefined);
});

test('legacy description and shared notes are edited in the single program text surface', async () => {
  let payload;
  const { ui } = fixture({ api: { saveSession: async data => { payload = data; } } });
  ui.editSession({ ...session(), description: 'Objectif technique', notes: 'Apporter les gants' });
  assert.equal(document.querySelector('[name="description"]'), null);
  assert.equal(document.querySelector('[name="notes"]'), null);
  assert.match(document.querySelector('.pe-text-input').textContent, /Objectif technique/);
  submit('sessionDialog'); await tick();
  assert.equal(payload.description, ''); assert.equal(payload.notes, '');
  assert.match(payload.workout_document.text, /Objectif technique/); assert.match(payload.workout_document.text, /Apporter les gants/);
});

test('note color choices have accessible names without visible labels and the selected color is saved', async () => {
  let payload;
  const { ui } = fixture({ api: { saveEvent: async data => { payload = data; } } });
  const event = { id: 'e1', athlete_id: 'a1', created_by: 'coach1', title: 'Note', date: '2026-09-24', category: 'note', color: 'lavender', notes: 'Détails' };
  ui.editEvent(event);
  assert.equal(document.getElementById('eventDialogTitle').textContent, 'Modifier la note');
  assert.equal(document.querySelector('.event-colors legend').textContent, 'Couleur');
  for (const choice of document.querySelectorAll('.event-colors label')) {
    assert.equal(choice.textContent, '');
    assert.ok(choice.querySelector('input').getAttribute('aria-label'));
    assert.equal(choice.querySelector('span').getAttribute('aria-hidden'), 'true');
  }
  assert.equal(document.querySelector('[name="event_color"]:checked').value, 'lavender');
  document.querySelector('[name="event_color"][value="coral"]').click(); submit('eventDialog'); await tick();
  assert.equal(payload.color, 'coral');
  assert.equal(document.getElementById('toast').textContent, 'Note mise à jour.');
  ui.showEvent({ ...event, ...payload });
  assert.equal(document.querySelector('.note-box').dataset.color, 'coral');
  assert.equal(document.querySelector('.note-box').style.getPropertyValue('--event-bg'), '#fbe2dc');
  assert.doesNotMatch(document.querySelector('#detailDialog').textContent, /événement/i);
});

test('session update sends only editable fields, preserves order and optimistic version', async () => {
  let payload, previous;
  const { ui, refreshed } = fixture({ api: { saveSession: async (p, s) => { payload = p; previous = s; } } });
  ui.editSession(session());
  document.querySelector('[name="title"]').value = ' Nouveau titre ';
  submit('sessionDialog'); await tick();
  assert.deepEqual(Object.keys(payload).sort(), ['blocks', 'date', 'description', 'notes', 'sort_order', 'sport', 'title', 'workout_document']);
  assert.equal(payload.title, 'Nouveau titre'); assert.equal(payload.sort_order, 2048);
  assert.equal(previous.updated_at, 'version1'); assert.equal(refreshed(), 1);
  assert.equal(document.getElementById('sessionDialog').open, false);
});

test('new sessions and duplicates fetch destination order and reject simultaneous submissions', async () => {
  let calls = 0, payload, release, loaded;
  const pending = new Promise(resolve => { release = resolve; });
  const { ui } = fixture({ api: { loadCalendar: async (...args) => { loaded = args; return { sessions: [{ id: 'remote', date: '2026-10-04', sort_order: 8192 }] }; }, saveSession: async p => { calls++; payload = p; await pending; } } });
  ui.editSession(session(), '2026-10-04', true);
  submit('sessionDialog'); submit('sessionDialog'); await tick();
  assert.equal(calls, 1); assert.deepEqual(loaded, ['a1', '2026-10-04', '2026-10-04']);
  assert.equal(payload.sort_order, 9216); assert.equal(payload.athlete_id, 'a1'); assert.equal(payload.created_by, 'coach1');
  assert.equal(payload.title, 'Intervalles (copie)');
  release(); await tick();
});

test('stale session errors keep entered content and dialog visible', async () => {
  const { ui } = fixture({ api: { saveSession: async () => { throw new Error('Cet élément a changé. Actualise le calendrier.'); } } });
  ui.editSession(session()); submit('sessionDialog'); await tick();
  assert.equal(document.getElementById('sessionDialog').open, true);
  assert.match(document.querySelector('#sessionDialog .form-error:not([hidden])').textContent, /a changé/);
  assert.equal(document.querySelector('#sessionDialog [name="title"]').value, 'Intervalles');
  document.getElementById('sessionDialog').close();
});

test('planning a reusable session template creates a session for the selected athlete', async () => {
  let payload, previous;
  const { ui } = fixture({ api: { saveSession: async (p, s) => { payload = p; previous = s; } } });
  const template = { id: 'template1', coach_id: 'coach1', title: 'Jog léger', sport: 'running', blocks: [], kind: 'session' };
  ui.editSession(template, '2026-09-21', true); submit('sessionDialog'); await tick();
  assert.equal(payload.athlete_id, 'a1'); assert.equal(payload.created_by, 'coach1'); assert.equal(previous, null);
  assert.equal(payload.date, '2026-09-21');
});

test('coach without edit or add permission cannot open an editor; details remain safe', () => {
  const { ui } = fixture({ canEdit: () => false, canAdd: () => false });
  ui.editSession(session()); assert.equal(document.getElementById('sessionDialog').open, false);
  ui.editEvent(); assert.equal(document.getElementById('eventDialog').open, false);
  ui.showSession({ ...session(), title: '<img src=x>', description: '<script>bad()</script>' });
  assert.equal(document.querySelector('#detailDialog img'), null); assert.equal(document.querySelector('#detailDialog script'), null);
  assert.ok(document.querySelector('#detailDialog').textContent.includes('<script>bad()</script>'));
  assert.ok(![...document.querySelectorAll('#detailDialog button')].some(node => node.textContent === 'Modifier'));
});

test('athlete feedback restores values and saves the bounded scores through the RPC', async () => {
  let call;
  const { ui, state } = fixture({ athlete: true, api: { rpc: async (...args) => { call = args; } } });
  state.feedback = [{ session_id: 's1', rpe: 8, feeling: 2, comment: 'Mollets lourds' }];
  state.sessions[0].completed_at='2026-09-21T20:00:00Z';ui.showSession(state.sessions[0]);
  assert.equal(document.querySelector('[name="rpe"]').value, '8');
  assert.equal(document.querySelector('[name="feeling"]:checked').value, '2');
  assert.equal(document.querySelector('[name="comment"]').value, 'Mollets lourds');
  document.querySelector('[name="rpe"]').value = '7';
  submit('detailDialog'); await tick();
  assert.deepEqual(call, ['save_session_feedback', { p_session_id: 's1', p_rpe: 7, p_feeling: 2, p_comment: 'Mollets lourds' }]);
});

test('feedback permissions prevent displaying loaded comments to a restricted coach', () => {
  const { ui, state } = fixture(); state.relation.can_view_feedback = false;
  state.feedback = [{ session_id: 's1', rpe: 9, feeling: 1, comment: 'PRIVATE_FEEDBACK' }];
  ui.showSession({...session(),completed_at:'2026-09-21T20:00:00Z'}); assert.ok(!document.getElementById('detailContent').textContent.includes('PRIVATE_FEEDBACK'));
});

test('event edits validate date range and never send identity columns', async () => {
  let payload;
  const { ui } = fixture({ athlete: true, api: { saveEvent: async p => { payload = p; } } });
  const event = { id: 'e1', athlete_id: 'a1', created_by: 'athlete1', title: 'Examen', category: 'exam', date: '2026-09-22', end_date: null, notes: '', sort_order: 1024, updated_at: 'version' };
  ui.editEvent(event);
  document.querySelector('[name="end_date"]').value = '2026-09-21';
  submit('eventDialog'); await tick(); assert.equal(payload, undefined);
  document.querySelector('[name="end_date"]').value = '2026-09-23';
  submit('eventDialog'); await tick();
  assert.deepEqual(Object.keys(payload).sort(), ['category', 'color', 'date', 'end_date', 'notes', 'sort_order', 'title']);
  assert.equal(payload.end_date, '2026-09-23');
});

test('athlete creates a structured unlocked workout with own author identity and no coach template controls',async()=>{
  let payload;
  const {ui}=fixture({athlete:true,api:{saveSession:async p=>{payload=p;}}});
  ui.editSession();document.querySelector('[name="title"]').value='Ma course';
  assert.equal(document.querySelector('[name="is_locked"]').checked,false);
  assert.equal(document.querySelector('[data-action="save"]'),null);
  submit('sessionDialog');await tick();
  assert.equal(payload.created_by,'athlete1');assert.equal(payload.athlete_id,'a1');assert.equal(payload.is_locked,false);
});

test('a collaborator edits unlocked content without changing the lock or gaining deletion',async()=>{
  let payload;
  const {ui}=fixture({athlete:true,api:{saveSession:async p=>{payload=p;}}});
  const shared={...session(),is_locked:false};ui.showSession(shared);
  assert.ok(![...document.querySelectorAll('#detailDialog button')].some(button=>button.textContent==='Supprimer'));
  document.getElementById('detailDialog').close();ui.editSession(shared);
  assert.equal(document.querySelector('[name="is_locked"]').disabled,true);
  document.querySelector('[name="is_locked"]').checked=true;
  submit('sessionDialog');await tick();
  assert.ok(!Object.hasOwn(payload,'is_locked'));
  assert.ok(!Object.hasOwn(payload,'created_by'));
});

test('only the creator sends a changed lock state',async()=>{
  let payload;const {ui}=fixture({api:{saveSession:async p=>{payload=p;}}});
  ui.editSession({...session(),is_locked:false});document.querySelector('[name="is_locked"]').checked=true;
  submit('sessionDialog');await tick();assert.equal(payload.is_locked,true);
});

test('athlete marks a locked coach workout done without RPE then sees the whole-session review in the same section',async()=>{
  const calls=[];const doneAt='2026-09-21T21:00:00Z';
  const {ui,state}=fixture({athlete:true,canEdit:()=>false,api:{rpc:async(...args)=>{calls.push(args);return doneAt;}}});
  state.sessions[0].is_locked=true;ui.showSession(state.sessions[0]);
  assert.equal(document.querySelector('[name="rpe"]'),null);
  document.querySelector('.completion-button').click();await tick();
  assert.deepEqual(calls,[['set_session_completed',{p_session_id:'s1',p_completed:true}]]);
  assert.equal(state.sessions[0].completed_at,doneAt);
  assert.equal(document.querySelector('.completion-button').getAttribute('aria-pressed'),'true');
  const review=document.querySelector('.post-session-review');assert.equal(review.tagName,'SECTION');
  assert.ok(review.closest('.session-completion'));assert.ok(review.querySelector('[name="rpe"]'));
  assert.equal(review.querySelector('summary'),null);assert.doesNotMatch(review.textContent,/Partager mon retour/);
});

test('completion is athlete-only, prevents duplicate pending saves and undo keeps previous feedback',async()=>{
  let calls=0,release;
  const pending=new Promise(resolve=>{release=resolve;});
  let f=fixture({api:{rpc:async()=>{calls++;}}});
  await assert.rejects(f.ui.setCompleted(session(),true),/Seul l’athlète/);assert.equal(calls,0);
  f=fixture({athlete:true,api:{rpc:async()=>{calls++;await pending;return null;}}});
  f.state.sessions[0].completed_at='2026-09-21T21:00:00Z';f.state.feedback=[{session_id:'s1',rpe:7,feeling:4,comment:'À conserver'}];
  const saving=f.ui.setCompleted(f.state.sessions[0],false);
  await tick();assert.equal(await f.ui.setCompleted(f.state.sessions[0],false),null);assert.equal(calls,1);
  release();await saving;
  assert.equal(f.state.sessions[0].completed_at,null);assert.equal(f.state.feedback[0].comment,'À conserver');
  f.ui.showSession(f.state.sessions[0]);assert.equal(document.querySelector('[name="rpe"]'),null);
  await assert.rejects(f.ui.setCompleted({...session(),athlete_id:'another-athlete'},true),/Seul l’athlète/);
});

test('failed completion keeps status unchanged and feedback cannot save after completion was undone',async()=>{
  const {ui,state}=fixture({athlete:true,api:{rpc:async()=>{throw new Error('Connexion interrompue');}}});
  ui.showSession(state.sessions[0]);document.querySelector('.completion-button').click();await tick();
  assert.equal(state.sessions[0].completed_at,null);assert.equal(document.querySelector('.completion-button').disabled,false);
  assert.match(document.querySelector('.session-completion .form-error').textContent,/Connexion interrompue/);
  state.sessions[0].completed_at='2026-09-21T21:00:00Z';ui.showSession({...state.sessions[0]});
  document.querySelector('[name="rpe"]').value='6';document.querySelector('[name="feeling"][value="4"]').checked=true;
  state.sessions[0].completed_at=null;submit('detailDialog');await tick();
  assert.match(document.querySelector('.post-session-review .form-error').textContent,/Marque d’abord/);
});

test('completion result cannot reopen a different session or restore another account context',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const {ui,state}=fixture({athlete:true,api:{rpc:async()=>{await pending;return '2026-09-21T21:00:00Z';}}});
  ui.showSession(state.sessions[0]);document.querySelector('.completion-button').click();await tick();
  const other={...session(),id:'s2',title:'Autre séance'};ui.showSession(other);
  release();await tick();assert.equal(document.getElementById('detailTitle').textContent,'Autre séance');
  state.user={id:'someone-else'};await assert.rejects(ui.setCompleted(other,true),/Seul l’athlète/);
});

test('saved completion with a failed reload closes the stale detail and asks to refresh without repeating the write',async()=>{
  let calls=0;
  const {ui,state}=fixture({athlete:true,api:{rpc:async()=>{calls++;return '2026-09-21T21:00:00Z';}},onRefresh:async()=>{throw new Error('Hors ligne');}});
  ui.showSession(state.sessions[0]);document.querySelector('.completion-button').click();await tick();
  assert.equal(calls,1);assert.ok(state.sessions[0].completed_at);
  assert.equal(document.getElementById('detailDialog').open,false);
  assert.match(document.getElementById('toast').textContent,/Statut enregistré.*Actualise/);
});

test('free text and malformed effort stay saved alongside the valid structured steps',async()=>{
  let payload;
  const {ui}=fixture({api:{saveSession:async p=>{payload=p;}}}); ui.editSession();
  document.querySelector('[name="title"]').value='Course texte';
  document.querySelector('[name="sport"]').value='running';document.querySelector('[name="sport"]').dispatchEvent(new window.Event('change'));
  const source='Course\n- Jog 10m @ Z2\n\n2x\n- Course 1m @ Z4\n- Marche 1m @ Z1 - Marcher\n\nConsigne libre\n- Sac 2m @ Z9';
  writeTraining(source);
  submit('sessionDialog');await tick();assert.equal(payload.blocks.length,2);assert.equal(payload.blocks[1].children[1].description,'Marcher');
  assert.equal(payload.workout_document.text,source);
  assert.equal(payload.sport,'running');assert.equal(payload.blocks[0].duration_seconds,600);
});

test('coach can save a model without scheduling and program actions reenable the model save',async()=>{
  let model,scheduled=0;
  const {ui}=fixture({api:{saveTemplate:async p=>{model=p;},saveSession:async()=>{scheduled++;}}});
  ui.editSession();document.querySelector('[name="title"]').value='Mon modèle';
  writeTraining('Shadow\n3 rounds\n- Shadow 1m @ RPE 6 - Faire du 8/16\n- Repos 1m');
  const keep=[...document.querySelectorAll('button')].find(b=>b.textContent==='Garder comme modèle');
  keep.click();await tick();assert.equal(scheduled,0);assert.equal(model.kind,'session');assert.equal(model.coach_id,'coach1');assert.equal(model.blocks[0].repeat_count,3);
  assert.equal(keep.disabled,true);assert.equal(document.getElementById('sessionDialog').open,true);
  writeTraining(model.workout_document.text+'\n\nConsigne supplémentaire');
  assert.equal(keep.disabled,false);assert.equal(keep.textContent,'Garder comme modèle');
});

test('late destination lookup cannot save an obsolete draft or close a replacement editor',async()=>{
  let release,calls=0;
  const waiting=new Promise(resolve=>{release=resolve;});
  const {ui}=fixture({api:{loadCalendar:async()=>{await waiting;return {sessions:[]};},saveSession:async()=>{calls++;}}});
  ui.editSession();document.querySelector('[name="title"]').value='Ancien';submit('sessionDialog');await tick();
  document.getElementById('sessionDialog').close();ui.editSession();document.querySelector('[name="title"]').value='Nouveau';
  release();await tick();assert.equal(calls,0);assert.equal(document.querySelector('[name="title"]').value,'Nouveau');assert.equal(document.getElementById('sessionDialog').open,true);
});

test('late model save cannot disable or label another editor and ignores duplicate clicks',async()=>{
  let release,calls=0;
  const waiting=new Promise(resolve=>{release=resolve;});
  const {ui}=fixture({api:{saveTemplate:async()=>{calls++;await waiting;}}});
  ui.editSession();document.querySelector('[name="title"]').value='Ancien';
  let keep=[...document.querySelectorAll('button')].find(b=>b.textContent==='Garder comme modèle');keep.click();keep.click();await tick();assert.equal(calls,1);
  document.getElementById('sessionDialog').close();ui.editSession();document.querySelector('[name="title"]').value='Nouveau';release();await tick();
  keep=[...document.querySelectorAll('button')].find(b=>b.textContent==='Garder comme modèle');assert.ok(keep);assert.equal(keep.disabled,false);assert.equal(document.querySelector('[name="title"]').value,'Nouveau');
});

test('one library inserts blocks or replaces a session while keeping date and header lock',async()=>{
 let options,payload;
 const {ui}=fixture({openLibrary:value=>{options=value;},api:{saveSession:async value=>{payload=value;}}});
 ui.editSession(null,'2026-09-23');
 const libraries=[...document.querySelectorAll('#sessionDialog button')].filter(button=>button.textContent.trim()==='Bibliothèque');
 assert.equal(libraries.length,1);const library=libraries[0];assert.ok(library.querySelector('svg'));
 assert.ok(document.querySelector('.session-basics [name=is_locked]'));assert.ok(document.querySelector('.session-basics [name=title]'));assert.equal(document.querySelector('.dialog-body > .lock-control'),null);
 library.click();assert.equal(options.kind,undefined);
 const step={id:'first',kind:'step',type:'shadow',title:'Shadow',duration_seconds:60,children:[]};
 await options.onSelect({title:'Séance de base',sport:'boxing',kind:'session',blocks:[step]});
 assert.equal(document.querySelector('[name=title]').value,'Séance de base');
 await options.onSelect({title:'Bloc',sport:'boxing',kind:'block',blocks:[{...step,id:'second',type:'bag',title:'Sac',duration_seconds:120}]});
 document.querySelector('[name=is_locked]').checked=true;submit('sessionDialog');await tick();await tick();
 assert.equal(payload.blocks.length,2);assert.deepEqual(payload.blocks.map(b=>b.type),['shadow','bag']);assert.equal(payload.date,'2026-09-23');assert.equal(payload.is_locked,true);
});

test.after(async () => { await window.happyDOM.abort(); });

test('review saves changed feeling and comment automatically and stays open',async()=>{
 const calls=[];const {ui,state}=fixture({athlete:true,api:{rpc:async(...args)=>{calls.push(args);}}});
 state.sessions[0].completed_at='2026-09-21T20:00:00Z';ui.showSession(state.sessions[0]);
 const rpe=document.querySelector('[name=rpe]');rpe.value='6';rpe.dispatchEvent(new window.Event('change',{bubbles:true}));await tick();assert.equal(calls.length,0);
 document.querySelector('[name=feeling][value="4"]').click();await tick();
 assert.equal(calls.length,1);assert.equal(calls[0][1].p_feeling,4);assert.equal(document.getElementById('detailDialog').open,true);
 const comment=document.querySelector('[name=comment]');comment.value='Bien récupéré';comment.dispatchEvent(new window.Event('change',{bubbles:true}));await tick();
 assert.equal(calls[1][1].p_comment,'Bien récupéré');assert.equal(state.feedback[0].comment,'Bien récupéré');
 assert.match(document.querySelector('.feedback-save-status').textContent,/Bilan enregistré/);
});

test('automatic review queues the latest values and locks completion during a save',async()=>{
 const calls=[];let release;const pending=new Promise(resolve=>{release=resolve;});
 const {ui,state}=fixture({athlete:true,api:{rpc:async(...args)=>{calls.push(args);if(calls.length===1)await pending;}}});
 state.sessions[0].completed_at='2026-09-21T20:00:00Z';ui.showSession(state.sessions[0]);
 document.querySelector('[name=rpe]').value='5';document.querySelector('[name=feeling][value="3"]').click();await tick();
 assert.equal(document.querySelector('.completion-button').disabled,true);
 for(const radio of document.querySelectorAll('[name=feeling]'))radio.checked=radio.value==='5';
 document.querySelector('[name=feeling][value="5"]').dispatchEvent(new window.Event('change',{bubbles:true}));const comment=document.querySelector('[name=comment]');comment.value='Dernier choix';comment.dispatchEvent(new window.Event('change',{bubbles:true}));
 release();await tick();await tick();assert.equal(calls.length,2);assert.equal(calls[1][1].p_feeling,5);assert.equal(calls[1][1].p_comment,'Dernier choix');assert.equal(document.querySelector('.completion-button').disabled,false);
});

test('failed automatic review keeps the draft and offers retry without claiming success',async()=>{
 let calls=0;const {ui,state}=fixture({athlete:true,api:{rpc:async()=>{if(++calls===1)throw new Error('Hors ligne');}}});
 state.sessions[0].completed_at='2026-09-21T20:00:00Z';ui.showSession(state.sessions[0]);
 document.querySelector('[name=rpe]').value='9';document.querySelector('[name=feeling][value="2"]').click();await tick();
 assert.match(document.querySelector('.feedback-save-status').textContent,/non enregistré/);assert.equal(document.querySelector('[name=rpe]').value,'9');
 const retry=[...document.querySelectorAll('.post-session-review button')].find(b=>b.textContent==='Réessayer');assert.equal(retry.hidden,false);retry.click();await tick();
 assert.equal(calls,2);assert.equal(retry.hidden,true);assert.match(document.querySelector('.feedback-save-status').textContent,/Bilan enregistré/);
});


test('historical sparring sessions reopen under boxing while retaining their title and blocks', async () => {
 let payload;
 const {ui}=fixture({api:{saveSession:async data=>{payload=data;}}});
 const blocks=[{id:'spar-step',kind:'step',type:'sparring',title:'',duration_seconds:180,children:[]}];
 ui.editSession({...session(),sport:'sparring',title:'Sparring technique',blocks});
 assert.equal(document.querySelector('[name="sport"]').value,'boxing');
 assert.equal(document.querySelector('[name="sport"] option[value="sparring"]'),null);
 submit('sessionDialog');await tick();
 assert.equal(payload.sport,'boxing');assert.equal(payload.title,'Sparring technique');assert.equal(payload.blocks[0].type,'sparring');assert.equal(payload.blocks[0].duration_seconds,180);
});

test('formatted source survives duplication, scheduling, detail display and saving a model',async()=>{
 let payload,model;
 const {ui}=fixture({api:{saveSession:async value=>{payload=value;},saveTemplate:async value=>{model=value;}}});
 const document={version:1,text:'Travail libre\n\n<img src=x onerror=alert(1)>',marks:[{start:0,end:7,bold:true,color:'mint'},{start:8,end:13,underline:true}]};
 const original={...session(),workout_document:document,description:'Ancien contenu remplacé',notes:'Ancienne note remplacée'};
 ui.editSession(original,'2026-10-05',true);submit('sessionDialog');await tick();await tick();
 assert.deepEqual(payload.workout_document,document); assert.equal(payload.notes,''); assert.equal(payload.description,'');
 ui.showSession({...original,...payload});
 const view=globalThis.document.querySelector('#detailDialog .training-document');
 assert.equal(view.textContent,document.text);assert.equal(view.querySelector('img'),null);
 assert.ok(view.querySelector('[data-bold="true"][data-color="mint"]'));assert.ok(view.querySelector('[data-underline="true"]'));
 assert.doesNotMatch(globalThis.document.querySelector('#detailDialog').textContent,/Ancien contenu remplacé|Ancienne note remplacée/);
 assert.ok(globalThis.document.querySelector('#detailDialog .session-chart'));
 [...globalThis.document.querySelectorAll('#detailDialog button')].find(button=>button.textContent==='Enregistrer comme modèle').click();await tick();
 assert.deepEqual(model.workout_document,document);assert.equal(model.coach_id,'coach1');
});

test('library replacement retains formatting and free text when the model has no structured steps',async()=>{
 let options,payload;
 const {ui}=fixture({openLibrary:value=>{options=value;},api:{saveSession:async value=>{payload=value;}}});
 ui.editSession(null,'2026-09-24');
 [...document.querySelectorAll('#sessionDialog button')].find(button=>button.textContent.trim()==='Bibliothèque').click();
 const source={version:1,text:'Technique au choix\n\nObserver les déplacements',marks:[{start:0,end:18,color:'blue',bold:true}]};
 await options.onSelect({title:'Travail personnel',sport:'boxing',kind:'session',blocks:[],workout_document:source});
 submit('sessionDialog');await tick();await tick();
 assert.deepEqual(payload.workout_document,source);assert.deepEqual(payload.blocks,[]);assert.equal(payload.title,'Travail personnel');
});

test('replacing only free text still asks before discarding the draft',async()=>{
 let options;
 const {ui}=fixture({openLibrary:value=>{options=value;}});ui.editSession();writeTraining('Mes consignes à garder');
 const confirmation=document.createElement('dialog');confirmation.id='confirmDialog';
 confirmation.innerHTML='<h2 id="confirmTitle"></h2><p id="confirmText"></p><button id="confirmYes"></button>';document.body.append(confirmation);
 [...document.querySelectorAll('#sessionDialog button')].find(button=>button.textContent.trim()==='Bibliothèque').click();
 const replacing=options.onSelect({title:'Modèle',sport:'boxing',kind:'session',blocks:[],workout_document:{version:1,text:'Autres consignes',marks:[]}});
 await tick();assert.equal(confirmation.open,true);confirmation.close('cancel');await replacing;
 assert.equal(document.querySelector('.pe-text-input').textContent,'Mes consignes à garder');assert.equal(document.querySelector('[name=title]').value,'');
});

test('athletes may create their own reusable document without calendar access',async()=>{
 let payload;
 const {ui,state}=fixture({athlete:true,canAdd:()=>false,api:{saveTemplate:async value=>{payload=value;}}});state.selectedAthlete=null;
 ui.editTemplate();document.querySelector('[name=title]').value='Mon entraînement';writeTraining('Consignes personnelles');
 submit('sessionDialog');await tick();
 assert.equal(payload.coach_id,'athlete1');assert.equal(payload.workout_document.text,'Consignes personnelles');assert.equal(payload.athlete_id,undefined);
});

test('calendar note privacy and edit lock are independent accessible icon controls', async () => {
  let payload;
  const {ui}=fixture({api:{saveEvent:async p=>{payload=p;}}});
  ui.editEvent();
  const privateControl=document.querySelector('[name=is_private]'),lock=document.querySelector('[name=is_locked]');
  assert.equal(privateControl.checked,false);assert.equal(lock.checked,false);
  assert.match(privateControl.getAttribute('aria-label'),/Privé/);
  assert.ok(privateControl.closest('label').querySelector('svg'));
  assert.ok(lock.closest('label').querySelector('svg'));
  assert.equal(lock.closest('label').textContent,'');
  document.querySelector('#eventDialog [name=title]').value='Suivi technique';
  document.querySelector('#eventDialog [name=notes]').value='À revoir ensemble';
  privateControl.checked=true;privateControl.dispatchEvent(new window.Event('change',{bubbles:true}));
  assert.match(document.querySelector('.event-visibility').textContent,/visible seulement par toi/);
  assert.equal(lock.checked,false);
  submit('eventDialog');await tick();
  assert.equal(payload.is_private,true);assert.equal(payload.is_locked,false);assert.equal(payload.created_by,'coach1');
});

test('only the author may change privacy and a private event never opens for another viewer', async () => {
  let payload;
  const {ui}=fixture({api:{saveEvent:async p=>{payload=p;}}});
  const event={id:'e1',athlete_id:'a1',created_by:'athlete1',title:'Disponibilité',category:'note',date:'2026-09-22',is_private:false,is_locked:false,notes:'',updated_at:'v1'};
  ui.editEvent(event);const privacy=document.querySelector('[name=is_private]');assert.equal(privacy.disabled,true);
  privacy.checked=true;submit('eventDialog');await tick();
  assert.equal(Object.hasOwn(payload,'is_private'),false);
  ui.showEvent({...event,is_private:true,notes:'NEVER_RENDER_THIS'});
  assert.equal(document.getElementById('detailDialog').open,false);
  assert.ok(!document.body.textContent.includes('NEVER_RENDER_THIS'));
  ui.editEvent({...event,is_private:true});assert.equal(document.getElementById('eventDialog').open,false);
});

test('author can make a private note public without changing its lock or identity', async () => {
  let payload;
  const {ui}=fixture({api:{saveEvent:async p=>{payload=p;}}});
  const event={id:'e1',athlete_id:'a1',created_by:'coach1',title:'Suivi',category:'note',date:'2026-09-22',end_date:'2026-09-25',is_private:true,is_locked:true,notes:'Texte conservé',updated_at:'v1'};
  ui.editEvent(event);document.querySelector('[name=is_private]').checked=false;
  document.querySelector('[name=is_private]').dispatchEvent(new window.Event('change',{bubbles:true}));
  assert.match(document.querySelector('.event-visibility').textContent,/Partagé/);
  submit('eventDialog');await tick();assert.equal(payload.is_private,false);
  assert.equal(Object.hasOwn(payload,'is_locked'),false);assert.equal(Object.hasOwn(payload,'created_by'),false);
  assert.equal(payload.end_date,'2026-09-25');assert.equal(payload.notes,'Texte conservé');
});

test('an event draft cannot be saved under a replacement account', async () => {
  let writes=0;
  const {ui,state}=fixture({api:{saveEvent:async()=>{writes++;}}});
  ui.editEvent();document.querySelector('#eventDialog [name=title]').value='Mon brouillon';
  state.user={id:'other-account'};submit('eventDialog');await tick();assert.equal(writes,0);
});

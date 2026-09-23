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

test('session update sends only editable fields, preserves order and optimistic version', async () => {
  let payload, previous;
  const { ui, refreshed } = fixture({ api: { saveSession: async (p, s) => { payload = p; previous = s; } } });
  ui.editSession(session());
  document.querySelector('[name="title"]').value = ' Nouveau titre ';
  submit('sessionDialog'); await tick();
  assert.deepEqual(Object.keys(payload).sort(), ['blocks', 'date', 'description', 'notes', 'sort_order', 'sport', 'title']);
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
  const template = { id: 'template1', coach_id: 'coach1', title: 'Footing léger', sport: 'running', blocks: [], kind: 'session' };
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
  assert.deepEqual(Object.keys(payload).sort(), ['category', 'date', 'end_date', 'notes', 'sort_order', 'title']);
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

test('athlete marks a locked coach workout done without RPE then can open the optional whole-session review',async()=>{
  const calls=[];const doneAt='2026-09-21T21:00:00Z';
  const {ui,state}=fixture({athlete:true,canEdit:()=>false,api:{rpc:async(...args)=>{calls.push(args);return doneAt;}}});
  state.sessions[0].is_locked=true;ui.showSession(state.sessions[0]);
  assert.equal(document.querySelector('[name="rpe"]'),null);
  document.querySelector('.completion-button').click();await tick();
  assert.deepEqual(calls,[['set_session_completed',{p_session_id:'s1',p_completed:true}]]);
  assert.equal(state.sessions[0].completed_at,doneAt);
  assert.equal(document.querySelector('.completion-button').getAttribute('aria-pressed'),'true');
  const review=document.querySelector('.post-session-review');assert.equal(review.open,false);
  assert.ok(review.querySelector('[name="rpe"]'));assert.match(review.textContent,/séance complète/);
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

test('text program saves the shared structure but invalid lines block the session save',async()=>{
  let payload;
  const {ui}=fixture({api:{saveSession:async p=>{payload=p;}}}); ui.editSession();
  document.querySelector('[name="title"]').value='Course texte';
  document.querySelector('[data-mode="text"]').click();
  const text=document.querySelector('.pe-text-input');
  text.value='Course\n10m @ Z2\n2x\n  1m @ Z4\n  1m @ Z1 - Marcher\ninvalid';text.dispatchEvent(new window.Event('input',{bubbles:true}));
  submit('sessionDialog');await tick();assert.equal(payload,undefined);
  assert.match(document.querySelector('#sessionDialog .dialog-body > .form-error').textContent,/ligne/);
  text.value=text.value.replace('\ninvalid','');text.dispatchEvent(new window.Event('input',{bubbles:true}));
  submit('sessionDialog');await tick();assert.equal(payload.blocks.length,2);assert.equal(payload.blocks[1].children[1].description,'Marcher');
  assert.equal(payload.sport,'running');assert.equal(payload.blocks[0].duration_seconds,600);
});

test('coach can save a model without scheduling and program actions reenable the model save',async()=>{
  let model,scheduled=0;
  const {ui}=fixture({api:{saveTemplate:async p=>{model=p;},saveSession:async()=>{scheduled++;}}});
  ui.editSession();document.querySelector('[name="title"]').value='Mon modèle';
  document.querySelector('[data-mode="text"]').click();const text=document.querySelector('.pe-text-input');
  text.value='Shadow\n3rounds 1m/1m - Faire du 8/16';text.dispatchEvent(new window.Event('input',{bubbles:true}));
  const keep=[...document.querySelectorAll('button')].find(b=>b.textContent==='Garder comme modèle');
  keep.click();await tick();assert.equal(scheduled,0);assert.equal(model.kind,'session');assert.equal(model.coach_id,'coach1');assert.equal(model.blocks[0].rounds,3);
  assert.equal(keep.disabled,true);assert.equal(document.getElementById('sessionDialog').open,true);
  document.querySelector('[data-mode="program"]').click();document.querySelector('[data-action="duplicate"]').click();
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

test.after(async () => { await window.happyDOM.abort(); });

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';

const initialCoach = () => ({
  user: { id: 'coach-id' }, profile: { account_type: 'coach' }, coach: { join_code: 'ab12cd34' },
  relations: [
    { athlete_id: 'pending-athlete', status: 'pending', private_notes: 'Secret coach note' },
    { athlete_id: 'roster-athlete', status: 'accepted', private_notes: 'Another private note' },
    { athlete_id: 'linked-athlete', status: 'accepted' },
  ],
  athletes: [
    { id: 'pending-athlete', first_name: '<img src=x onerror=alert(1)>', last_name: '', user_id: 'pending-user' },
    { id: 'roster-athlete', first_name: 'Martin', last_name: '', user_id: null },
    { id: 'linked-athlete', first_name: 'Alex', last_name: '', user_id: 'alex-user' },
  ],
  selectedAthlete: 'roster-athlete',
});
const initialAthlete = () => ({
  user: { id: 'athlete-user' }, profile: { account_type: 'athlete' }, coach: null, relations: [],
  athletes: [{ id: 'own-athlete', first_name: 'Martin', user_id: 'athlete-user' }], selectedAthlete: 'own-athlete',
});
const coaches = () => [
  { coach_id: 'one-coach', display_name: 'Coach Camille', status: 'accepted', can_view_calendar: true, can_add_sessions: true, can_edit_own_sessions: true, can_view_feedback: false },
  { coach_id: 'two-coach', display_name: 'Coach Jade', status: 'pending', can_view_calendar: true, can_add_sessions: true, can_edit_own_sessions: true, can_view_feedback: true },
  { coach_id: 'old-coach', display_name: 'Ancien coach', status: 'revoked' },
];
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}
async function setup(state, responder = async name => name === 'athlete_coaches' ? coaches() : null) {
  const window = new Window({ url: 'https://gestionboxeur.example/project/index.html', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  window.document.write('<dialog id="connectionsDialog"><div id="connectionsContent"></div></dialog>');
  const calls = [];
  const refreshed = [];
  const copied = [];
  Object.defineProperty(window.navigator, 'clipboard', { value: { async writeText(value) { copied.push(value); } } });
  window.__rpc = async (name, args) => { if(name!=='my_coaching_invitations')calls.push({ name, args }); return responder(name, args); };
  window.__state = state;
  window.__confirmResult = true;
  window.__confirmCalls = [];
  window.__refreshAccount = async () => { refreshed.push('account'); };
  window.__refreshCalendar = async () => { refreshed.push('calendar'); };
  const ui = (await readFile(new URL('../js/ui.js', import.meta.url), 'utf8')).replace(/^export /gm, '').replace('function confirmAction(', 'function originalConfirmAction(');
  const source = (await readFile(new URL('../js/connections.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '').replace('export function createConnectionsUI', 'function createConnectionsUI');
  window.eval(`${ui}\nconst rpc = window.__rpc;\nconst confirmAction = async (...args) => { window.__confirmCalls.push(args); return window.__confirmResult; };\n${source}\nwindow.__connections = createConnectionsUI({ getState: () => window.__state, refreshAccount: window.__refreshAccount, refreshCalendar: window.__refreshCalendar });`);
  const content = window.document.getElementById('connectionsContent');
  return {
    window, state, calls, refreshed, copied, content, api: window.__connections,
    button(text, scope = content) { return [...scope.querySelectorAll('button')].find(button => button.textContent === text); },
    async click(text, scope = content) { const button = this.button(text, scope); assert.ok(button, `Button ${text} is present`); button.click(); await settle(); },
    async submit(form) { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle(); },
    close: () => window.happyDOM.abort(),
  };
}

test('coach view lists pending and accepted connections without private notes or unescaped HTML', async () => {
  const ui = await setup(initialCoach());
  try {
    await ui.api.open();
    assert.match(ui.content.textContent, /ab12cd34/);
    assert.match(ui.content.textContent, /Demandes à valider \(1\)/);
    assert.match(ui.content.textContent, /Compte lié/);
    assert.match(ui.content.textContent, /Fiche sans compte/);
    assert.match(ui.content.textContent, /Nouveau compte.*invitation.*conservant cette fiche/);
    assert.match(ui.content.textContent, /Compte déjà actif.*code coach.*acceptation.*Rattacher.*conserver son calendrier/);
    assert.equal(ui.content.querySelector('.permission-help a').href, 'https://gestionboxeur.example/project/roster.html');
    assert.doesNotMatch(ui.content.textContent, /Secret coach note|Another private note/);
    assert.equal(ui.content.querySelector('img'), null);
    assert.equal(ui.calls.length, 0);
    await ui.click('Copier le code');
    assert.deepEqual(ui.copied, ['ab12cd34']);
  } finally { await ui.close(); }
});

test('coach accepts only requested athlete and refreshes account before calendar', async () => {
  let resolveAction;
  const gate = new Promise(resolve => { resolveAction = resolve; });
  const ui = await setup(initialCoach(), name => name === 'respond_coach_request' ? gate : null);
  try {
    await ui.api.open();
    const accept = ui.button('Accepter');
    accept.click(); accept.click();
    assert.equal(ui.calls.length, 1);
    assert.equal(ui.calls[0].name, 'respond_coach_request');
    assert.equal(ui.calls[0].args.p_athlete_id, 'pending-athlete');
    assert.equal(ui.calls[0].args.p_accept, true);
    assert.equal(accept.disabled, true);
    resolveAction(); await settle();
    assert.deepEqual(ui.refreshed, ['account', 'calendar']);
    assert.match(ui.content.textContent, /Demande acceptée/);
  } finally { await ui.close(); }
});

test('invitation is generated explicitly for selected roster athlete and copied as a canonical token link', async () => {
  const ui = await setup(initialCoach(), async name => name === 'create_invitation' ? { token: 'opaque+token', expires_at: '2026-09-28T12:00:00Z' } : null);
  try {
    await ui.api.open();
    assert.equal(ui.calls.length, 0);
    await ui.api.inviteAthlete();
    assert.equal(ui.calls[0].name, 'create_invitation');
    assert.equal(ui.calls[0].args.p_athlete_id, 'roster-athlete');
    assert.match(ui.content.textContent, /valide 7 jours/);
    assert.match(ui.content.textContent, /remplace ton précédent lien/);
    assert.match(ui.content.textContent, /Aucun courriel n’est envoyé/);
    assert.match(ui.content.textContent, /Compte déjà actif.*code coach.*acceptation.*Rattacher/);
    await ui.click('Copier le lien');
    assert.equal(ui.copied[0], 'https://gestionboxeur.example/project/login.html?invite=opaque%2Btoken');
  } finally { await ui.close(); }
});

test('connected athlete does not generate another invitation', async () => {
  const state = initialCoach(); state.selectedAthlete = 'linked-athlete';
  const ui = await setup(state);
  try {
    await ui.api.inviteAthlete();
    assert.equal(ui.calls.length, 0);
    assert.match(ui.content.textContent, /possède déjà un compte lié/);
    assert.match(ui.content.textContent, /ab12cd34/);
    assert.match(ui.content.textContent, /Rattacher.*conserver son calendrier/);
  } finally { await ui.close(); }
});

test('athlete updates exact coach permissions without affecting another coach', async () => {
  const ui = await setup(initialAthlete());
  try {
    await ui.api.open();
    const card = ui.content.querySelector('[data-coach-id="one-coach"]');
    assert.ok(card);
    assert.doesNotMatch(ui.content.textContent, /uniquement modifier les séances qu’il a lui-même créées/);
    assert.match(card.textContent, /élément verrouillé.*uniquement par son créateur/);
    assert.equal(ui.content.querySelector('[data-coach-id="old-coach"]'), null);
    const feedback = card.querySelector('[name="can_view_feedback"]');
    const edit = card.querySelector('[name="can_edit_own_sessions"]');
    feedback.checked = true; edit.checked = false;
    await ui.submit(card.querySelector('form'));
    const call = ui.calls.find(call => call.name === 'set_coach_permissions');
    assert.deepEqual(JSON.parse(JSON.stringify(call.args)), { p_athlete_id: 'own-athlete', p_coach_id: 'one-coach', p_can_view_calendar: true, p_can_add_sessions: true, p_can_edit_own_sessions: false, p_can_view_feedback: true });
    assert.equal(ui.calls.filter(call => call.name === 'athlete_coaches').length, 2);
    assert.deepEqual(ui.refreshed, ['account', 'calendar']);
  } finally { await ui.close(); }
});

test('athlete submits normalized coach code and sees pending request feedback', async () => {
  const ui = await setup(initialAthlete());
  try {
    await ui.api.open();
    const code = ui.content.querySelector('[name="coach_code"]');
    code.value = '  AB12cD34  ';
    await ui.submit(code.closest('form'));
    const call = ui.calls.find(call => call.name === 'request_coach');
    assert.equal(call.args.p_code, 'ab12cd34');
    assert.match(ui.content.textContent, /La liaison sera active après acceptation du coach/);
  } finally { await ui.close(); }
});

test('athlete revocation needs confirmation and targets relation only', async () => {
  const ui = await setup(initialAthlete());
  try {
    await ui.api.open();
    ui.window.__confirmResult = false;
    let card = ui.content.querySelector('[data-coach-id="one-coach"]');
    await ui.click('Retirer ce coach', card);
    assert.equal(ui.calls.some(call => call.name === 'revoke_coach_relation'), false);
    ui.window.__confirmResult = true;
    await ui.click('Retirer ce coach', card);
    const call = ui.calls.find(call => call.name === 'revoke_coach_relation');
    assert.equal(call.args.p_athlete_id, 'own-athlete');
    assert.equal(call.args.p_coach_id, 'one-coach');
    assert.match(ui.window.__confirmCalls[0][1], /séances.*conservés/);
    assert.equal(ui.calls.some(call => /delete|archive/.test(call.name)), false);
    assert.match(ui.content.textContent, /Ton profil et tes séances sont conservés/);
  } finally { await ui.close(); }
});

test('RPC error stays safe, restores controls, and performs no account refresh', async () => {
  const ui = await setup(initialCoach(), async name => { if (name === 'respond_coach_request') throw new Error('<img src=x onerror=alert(1)>'); });
  try {
    await ui.api.open(); await ui.click('Refuser');
    assert.equal(ui.content.querySelector('img'), null);
    const error = [...ui.content.querySelectorAll('[role="alert"]')].find(item => !item.hidden);
    assert.equal(error.textContent, '<img src=x onerror=alert(1)>');
    assert.equal(ui.button('Accepter').disabled, false);
    assert.deepEqual(ui.refreshed, []);
  } finally { await ui.close(); }
});

test('closing invitation during request prevents the token from appearing in stale dialog content', async () => {
  let resolveInvitation;
  const gate = new Promise(resolve => { resolveInvitation = resolve; });
  const ui = await setup(initialCoach(), () => gate);
  try {
    const creating = ui.api.inviteAthlete();
    const duplicate = ui.api.inviteAthlete();
    assert.equal(ui.calls.length, 1);
    ui.window.document.getElementById('connectionsDialog').close();
    await settle();
    resolveInvitation({ token: 'must-not-remain-visible', expires_at: '2026-09-28T12:00:00Z' });
    await Promise.all([creating, duplicate]);
    assert.equal(ui.content.textContent, '');
    assert.equal(ui.window.document.getElementById('connectionsDialog').open, false);
  } finally { await ui.close(); }
});

test('successful mutation with failed refresh reports saved status without repeating mutation', async () => {
  const ui = await setup(initialCoach());
  try {
    ui.window.__refreshAccount = async () => { throw new Error('Network interrupted'); };
    // The factory captured the previous callback; instantiate with the failing callback.
    ui.window.eval('window.__connections = createConnectionsUI({getState: () => window.__state, refreshAccount: window.__refreshAccount, refreshCalendar: window.__refreshCalendar});');
    await ui.window.__connections.open();
    await ui.click('Accepter');
    assert.equal(ui.calls.length, 1);
    assert.match(ui.content.textContent, /Modification enregistrée/);
    assert.match(ui.content.textContent, /Network interrupted/);
    assert.equal(ui.button('Accepter'), undefined);
    assert.ok(ui.button('Actualiser'));
    await ui.click('Actualiser');
    assert.equal(ui.calls.length, 1);
    assert.equal(ui.button('Accepter'), undefined);
    assert.match(ui.content.textContent, /Modification enregistrée/);
  } finally { await ui.close(); }
});


test('coach personal connections always use their own profile even when viewing another athlete',async()=>{
 const state=initialCoach();state.athletes.push({id:'personal',user_id:'coach-id',first_name:'Coach'});
 const ui=await setup(state);
 try{
   await ui.api.open({personal:true});
   assert.ok(ui.calls.some(call=>call.name==='athlete_coaches'&&call.args.p_athlete_id==='personal'));
 }finally{await ui.close();}
});

test('incoming coach invitation is visible and acceptance targets only that invitation',async()=>{
 let accepted=false;
 const ui=await setup(initialAthlete(),async(name)=>name==='my_coaching_invitations'?(accepted?[]:[{id:'invite-1',direction:'incoming',coach_name:'Camille'}]):name==='athlete_coaches'?[]:name==='respond_coaching_invitation'?(accepted=true):null);
 try {
  await ui.api.open();const section=ui.content.querySelector('.incoming-coaching-invitations');assert.ok(section);assert.match(section.textContent,/calendrier et tes bilans/);
  await ui.click('Accepter ce coach',section);
  const write=ui.calls.find(c=>c.name==='respond_coaching_invitation');assert.deepEqual(JSON.parse(JSON.stringify(write.args)),{p_invitation_id:'invite-1',p_accept:true});
  assert.equal(ui.content.querySelector('.incoming-coaching-invitations'),null);
 }finally{await ui.close();}
});

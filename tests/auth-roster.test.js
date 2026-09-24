import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { createRosterStore } from '../js/roster-store.js';
import { createRosterAttachmentUI } from '../js/roster-attachment.js';

async function settle() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}
async function surface(html, script, client, url = 'https://gestionboxeur.example/login.html', { pendingInvite } = {}) {
  const window = new Window({ url, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  if (pendingInvite) window.sessionStorage.setItem('pendingInvite', pendingInvite);
  window.document.write(await readFile(new URL(`../${html}`, import.meta.url), 'utf8'));
  const navigations = [];
  window.__navigate = value => navigations.push(new URL(value, window.location.href).href);
  window.__client = client;
  window.__createRosterStore = createRosterStore;
  if(script==='roster.js') {
    const uiSource=(await readFile(new URL('../js/ui.js',import.meta.url),'utf8')).replace(/^export /gm,'');
    const addSource=(await readFile(new URL('../js/roster-add.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'').replace(/^export /gm,'');
    window.eval(`${uiSource}\n${addSource}\nwindow.__createAthleteAddUI=createAthleteAddUI;`);
  }
  window.__createRosterAttachmentUI = createRosterAttachmentUI;
  window.confirm = () => true;
  const source = (await readFile(new URL(`../js/${script}`, import.meta.url), 'utf8')).replace(/^import \{ createRosterStore \} from ['"].\/roster-store.js['"];?/m, 'const createRosterStore = window.__createRosterStore; const createAthleteAddUI = window.__createAthleteAddUI;').replace(/^import \{ mountNavigation \}.*$/m, 'const mountNavigation = () => {};').replace(/^import \{ beginTestSession \}.*$/m, 'const beginTestSession = async () => {};').replace(/^import \{ isTestSession \}.*$/m, 'const isTestSession = () => false;').replace(/^import \{ returnFromTestSession \}.*$/m, 'const returnFromTestSession = async () => {};').replaceAll('location.replace(', 'window.__navigate(');
  window.eval(source.replace(/^import \{ createAthleteAddUI \}.*$/m, '').replace(/^import \{ createRosterAttachmentUI \}.*$/m, 'const createRosterAttachmentUI = window.__createRosterAttachmentUI;').replace(/^import \{ client(?: as supabase)? \} from ['"].\/config.js['"];?/m,
    script === 'roster.js' ? 'const supabase = window.__client;' : 'const client = window.__client;'));
  await settle();
  return { window, navigations, $: id => window.document.getElementById(id), close: () => window.happyDOM.abort() };
}
function authMock(session = null) {
  const calls = [];
  let callback;
  const client = { from: () => ({select(){return this;},async order(){return {data:[],error:null};}}), auth: {
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: fn => { callback = fn; },
    signUp: async payload => { calls.push(['signup', payload]); return { data: { session: null }, error: null }; },
    signInWithPassword: async payload => { calls.push(['login', payload]); return { error: null }; },
    resetPasswordForEmail: async (...args) => { calls.push(['reset', ...args]); return { error: null }; },
    updateUser: async payload => { calls.push(['update', payload]); return { error: null }; },
  } };
  return { client, calls, emit: (...args) => callback(...args) };
}
function submit(ui, id) {
  ui.$(id).dispatchEvent(new ui.window.Event('submit', { bubbles: true, cancelable: true }));
}

test('athlete signup preserves invitation across confirmation and omits coach gym metadata', async () => {
  const mock = authMock();
  const ui = await surface('login.html', 'auth.js', mock.client, 'https://gestionboxeur.example/sub/login.html?invite=opaque-token');
  try {
    assert.equal(ui.window.sessionStorage.getItem('pendingInvite'), 'opaque-token');
    ui.$('authToggle').click();
    assert.equal(ui.$('accountType'), null);
    ui.$('fullName').value = 'Martin'; ui.$('birthDate').value = '2000-05-12'; ui.$('email').value = 'martin@example.test'; ui.$('password').value = 'motdepasse';
    submit(ui, 'authForm'); await settle();
    const payload = mock.calls[0][1];
    assert.equal(payload.options.data.account_type, 'athlete');
    assert.equal(payload.options.data.birth_date, '2000-05-12');
    assert.equal(payload.options.data.gym_name, null);
    assert.equal(payload.options.emailRedirectTo, 'https://gestionboxeur.example/sub/planning.html?invite=opaque-token');
    assert.equal(ui.$('authSuccess').classList.contains('hidden'), false);
  } finally { await ui.close(); }
});

test('forgot password submits only reset with invitation-aware recovery redirect', async () => {
  const mock = authMock();
  const ui = await surface('login.html', 'auth.js', mock.client, 'https://gestionboxeur.example/login.html?invite=token');
  try {
    ui.$('forgotPassword').click(); ui.$('email').value = 'martin@example.test';
    assert.equal(ui.$('password').required, false);
    submit(ui, 'authForm'); await settle();
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0][0], 'reset');
    assert.equal(mock.calls[0][2].redirectTo, 'https://gestionboxeur.example/login.html?mode=recovery&invite=token');
    assert.match(ui.$('authSuccess').textContent, /Si un compte existe/);
  } finally { await ui.close(); }
});

test('signup defaults to athlete and rejects missing date of birth before contacting Auth', async () => {
  const mock=authMock();const ui=await surface('login.html','auth.js',mock.client);
  try{
    ui.$('authToggle').click();
    assert.equal(ui.$('accountType'),null);assert.equal(ui.$('birthDate').required,true);
    ui.$('fullName').value='Alex Test';ui.$('email').value='alex@example.test';ui.$('password').value='secret123';
    submit(ui,'authForm');await settle();assert.equal(mock.calls.length,0);assert.match(ui.$('authError').textContent,/naissance/);
    ui.$('birthDate').value='2000-03-12';
    submit(ui,'authForm');await settle();assert.equal(mock.calls[0][1].options.data.account_type,'athlete');
  }finally{await ui.close();}
});

test('athlete signup has no gym directory and stores pounds as normalized kilograms',async()=>{
  const mock=authMock();mock.client.from=()=>({select(){return this;},async order(){return {data:[{id:'crew-id',name:'Le Crew',address:'Adresse du gym',is_default:true}],error:null};}});
  const ui=await surface('login.html','auth.js',mock.client);
  try{
    ui.$('authToggle').click();ui.$('fullName').value='Alex Test';ui.$('birthDate').value='2001-02-03';ui.$('weight').value='154.3';ui.$('weightUnit').value='lb';ui.$('fights').value='4';ui.$('wins').value='3';ui.$('losses').value='1';
    ui.$('email').value='alex@example.test';ui.$('password').value='secret123';submit(ui,'authForm');await settle();
    const payload=mock.calls[0][1].options.data;assert.equal(payload.gym_id,null);assert.equal(payload.weight_unit,'lb');assert.ok(Math.abs(payload.weight_kg-70)<0.1);assert.equal(payload.first_name,'Alex');assert.equal(payload.last_name,'Test');
    assert.equal(payload.fights,4);assert.equal(payload.wins,3);assert.equal(payload.losses,1);assert.equal(payload.is_admin,undefined);
  }finally{await ui.close();}
});

test('athlete signup no longer depends on gym directory availability',async()=>{
  for(const error of [{code:'PGRST205',message:'gyms not found'},{message:'Network request failed'}]){
    const mock=authMock();mock.client.from=()=>({select(){return this;},async order(){return {data:null,error};}});
    const ui=await surface('login.html','auth.js',mock.client);
    try{
      ui.$('authToggle').click();ui.$('fullName').value='Alex Test';ui.$('birthDate').value='2000-02-03';ui.$('email').value='alex@example.test';ui.$('password').value='secret123';
      submit(ui,'authForm');await settle();assert.equal(mock.calls.length,1);assert.equal(mock.calls[0][1].options.data.account_type,'athlete');assert.equal(mock.calls[0][1].options.data.gym_id,null);assert.equal(ui.$('athleteGym'),null);
    }finally{await ui.close();}
  }
});

test('password recovery requires an established session and matching passwords', async () => {
  const mock = authMock();
  const ui = await surface('login.html', 'auth.js', mock.client, 'https://gestionboxeur.example/login.html?mode=recovery');
  try {
    assert.equal(ui.$('authSubmit').disabled, true);
    mock.emit('PASSWORD_RECOVERY', { user: { id: 'athlete-user' } });
    assert.equal(ui.$('authSubmit').disabled, false);
    ui.$('password').value = 'secret123'; ui.$('confirmPassword').value = 'different';
    submit(ui, 'authForm'); await settle();
    assert.equal(mock.calls.length, 0);
    assert.match(ui.$('authError').textContent, /ne correspondent pas/);
    ui.$('confirmPassword').value = 'secret123';
    submit(ui, 'authForm'); await settle();
    assert.deepEqual(mock.calls.map(call => call[0]), ['update']);
    assert.equal(ui.$('continueButton').classList.contains('hidden'), false);
  } finally { await ui.close(); }
});

function rosterMock({ legacy = false, role = "coach", authenticated = true, registered = false } = {}) {
  const calls = [];
  const athlete = { id: 'athlete-id', user_id:registered?'athlete-user':null, first_name: 'Martin', last_name: '', birth_date: null, sex: null, weight_kg: null, fights: 0, wins: null, losses: null, status: 'available', updated_at: '2026-09-22T12:00:00Z' };
  const tables = {
    profiles: { id: 'coach-id', full_name: 'Coach Camille', ...(!legacy ? { account_type: role } : {}), is_admin: false },
    gym_settings: { id: 'gym-id', gym_name: 'Mon équipe', address: '123, rue du Gym' },
    coach_contacts: [],
    coach_athletes: [{ athlete_id: 'athlete-id', private_notes: 'Note confidentielle', selected: true, can_view_calendar: true, updated_at: '2026-09-22T12:01:00Z' }],
    athletes: legacy ? [{ ...athlete, notes: 'Note privée existante', selected: true, is_active: true }, ...Array.from({ length: 7 }, (_, index) => ({ ...athlete, id: `legacy-${index}`, first_name: `Boxeur ${index}`, status: 'injured', notes: '', selected: false, is_active: false }))] : [athlete],
  };
  let authCallback;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: authenticated ? { user: { id: 'coach-id', email: 'coach@example.test' } } : null }, error: null }),
      onAuthStateChange: fn => { authCallback = fn; },
      signOut: async () => { authCallback('SIGNED_OUT'); return { error: null }; },
    },
    from(table) {
      let fields;
      const query = {
        select(value) { fields = value; calls.push(['select', table, fields]); return this; },
        eq(...args) { calls.push(['eq', table, ...args]); return this; }, order() { return this; }, in() { return this; }, limit() { return this; },
        update(payload) { calls.push(['update', table, payload]); return this; }, insert(payload) { calls.push(['insert', table, payload]); return this; }, delete() { calls.push(['delete', table]); return this; },
        single() { return this; },
        then(resolve, reject) {
          const error = legacy && table === 'profiles' && fields.includes('account_type') ? { code: '42703', message: 'column profiles.account_type does not exist' }
            : legacy && table === 'coach_athletes' ? { code: '42P01', message: 'relation "public.coach_athletes" does not exist' } : null;
          return Promise.resolve({ data: tables[table], error }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, args) { if(name==='my_coaching_invitations')return {data:[],error:null}; calls.push(['rpc', name, args]); return { data: 'athlete-id', error: null }; },
  };
  return { client, calls, tables, emit: (...args) => authCallback(...args) };
}

test('roster reads explicit shared fields and keeps private coach notes out of share lists', async () => {
  const mock = rosterMock();
  const ui = await surface('roster.html', 'roster.js', mock.client, 'https://gestionboxeur.example/roster.html');
  try {
    assert.equal(ui.$('addAthleteButton').disabled, false);
    assert.match(ui.$('athleteRows').textContent, /Note confidentielle/);
    const athleteRead = mock.calls.find(call => call[0] === 'select' && call[1] === 'athletes');
    assert.doesNotMatch(athleteRead[2], /\*|notes|selected/);
    ui.$('shareButton').click();
    const preview = ui.$('sharePreview').textContent;
    assert.match(preview, /Martin/);
    assert.doesNotMatch(preview, /confidentielle|null|undefined|0 kg|0 lb/);
    assert.equal(ui.$('shareDialog').open, true);
  } finally { await ui.close(); }
});

test('own coach contact uses contact email with account email only as fallback',async()=>{
  const mock=rosterMock();const original=mock.client.from;
  mock.client.from=table=>{const q=original(table),select=q.select,then=q.then;let fields; q.select=function(value){fields=value;return select.call(this,value);};q.then=function(resolve,reject){if(table==='athletes'&&fields==='email')return Promise.resolve({data:[{email:'contact@example.test'}],error:null}).then(resolve,reject);return then.call(this,resolve,reject);};return q;};
  const ui=await surface('roster.html','roster.js',mock.client);try{
    assert.match(ui.$('coachGrid').textContent,/contact@example.test/);assert.doesNotMatch(ui.$('coachGrid').textContent,/coach@example.test/);
    assert.ok(mock.calls.some(c=>c[0]==='eq'&&c[1]==='athletes'&&c[2]==='user_id'&&c[3]==='coach-id'));
  }finally{await ui.close();}
});

test('roster accepts a first name alone and sends atomic nullable bio/private relation payload', async () => {
  const mock = rosterMock();
  const ui = await surface('roster.html', 'roster.js', mock.client, 'https://gestionboxeur.example/roster.html');
  try {
    ui.$('addAthleteButton').click(); ui.window.document.querySelector('[aria-label="Créer une fiche"]').click(); ui.$('firstName').value = 'Alex';
    submit(ui, 'athleteForm'); await settle();
    const call = mock.calls.find(call => call[1] === 'create_roster_athlete');
    assert.equal(call[1], 'create_roster_athlete');
    assert.equal(call[2].p_data.first_name, 'Alex');
    assert.equal(call[2].p_data.last_name, '');
    assert.equal(call[2].p_data.birth_date, null);
    assert.equal(call[2].p_data.sex, null);
    assert.equal(call[2].p_data.weight_kg, null);
    assert.equal(call[2].p_data.selected, false);
    assert.ok(!('coach_id' in call[2].p_data));
    assert.ok(!('is_active' in call[2].p_data));
  } finally { await ui.close(); }
});

test('removing an athlete revokes the coach relation without deleting the shared athlete', async () => {
  const mock = rosterMock();
  const ui = await surface('roster.html', 'roster.js', mock.client, 'https://gestionboxeur.example/roster.html');
  try {
    ui.$('athleteRows').querySelector('.athlete-edit').click();
    ui.$('deleteAthleteButton').click(); await settle();
    const call = mock.calls.find(call => call[0] === 'rpc');
    assert.equal(call[1], 'archive_roster_athlete');
    assert.equal(call[2].p_athlete_id, 'athlete-id');
    assert.equal(ui.$('athleteRows').children.length, 0);
  } finally { await ui.close(); }
});

test('registered roster protects identity fields, uses one table and sends only changed coach-editable data',async()=>{
  const mock=rosterMock({registered:true});
  const ui=await surface('roster.html','roster.js',mock.client,'https://gestionboxeur.example/roster.html');
  try {
    assert.equal(ui.$('accountFilter'),null);
    assert.match(ui.$('athleteRows').querySelector('.roster-calendar-link').href,/planning\.html\?athlete=athlete-id$/);
    ui.$('resetFilters').click();ui.$('athleteRows').querySelector('.athlete-edit').click();
    for(const id of ['firstName','lastName','birthDate','sex','status'])assert.equal(ui.$(id).disabled,true);
    ui.$('weight').value='160';ui.$('weightUnit').value='lb';ui.$('firstName').value='Untrusted change';
    submit(ui,'athleteForm');await settle();
    const payload=mock.calls.find(call=>call[0]==='rpc'&&call[1]==='update_roster_athlete')[2].p_data;
    assert.deepEqual(Object.keys(payload).sort(),['fights','losses','selected','weight_kg','wins']);
    assert.equal(payload.weight_kg,72.6);
    ui.$('addAthleteButton').click(); ui.window.document.querySelector('[aria-label="Créer une fiche"]').click();assert.equal(ui.$('firstName').disabled,false);
  }finally{await ui.close();}
});

test('one roster includes free sheets and registered accounts regardless of calendar access; attachment refreshes it', async () => {
  const mock = rosterMock();
  const base = mock.tables.athletes[0];
  mock.tables.athletes = [
    { ...base, id: 'zoe', first_name: 'Zoé' },
    { ...base, id: 'ruslan-free', first_name: 'Ruslan', weight_kg: 72 },
    { ...base, id: 'ruslan-account', user_id: 'ruslan-user', first_name: 'Ruslan', weight_kg: 70 },
    { ...base, id: 'shared-calendar', user_id: 'other-user', first_name: 'Alex' },
  ];
  mock.tables.coach_athletes = mock.tables.athletes.map(athlete => ({
    athlete_id: athlete.id, private_notes: `Privé ${athlete.id}`, selected: true,
    can_view_calendar: athlete.id === 'shared-calendar', updated_at: '2026-09-22T13:00:00Z',
  }));
  mock.client.rpc = async (name, args) => {
    mock.calls.push(['rpc', name, args]);
    if (name === 'merge_roster_athlete') mock.tables.coach_athletes = mock.tables.coach_athletes.filter(link => link.athlete_id !== args.p_source_id);
    return { data: args.p_target_id, error: null };
  };
  const ui = await surface('roster.html', 'roster.js', mock.client, 'https://gestionboxeur.example/roster.html?liste=1');
  try {
    assert.equal(ui.$('athleteRows').children.length, 4);
    assert.equal(ui.$('shareDialog').open, false);
    assert.equal(ui.$('accountFilter'), null);
    assert.equal(ui.$('athleteRows').querySelectorAll('a.roster-calendar-link').length, 1);
    assert.equal(ui.$('athleteRows').querySelectorAll('button.roster-calendar-link').length, 0);
    assert.equal(ui.$('athleteRows').querySelector('a.name-button').textContent.trim(), 'Alex');
    ui.$('shareButton').click();
    assert.match(ui.$('sharePreview').textContent, /Zoé/);
    assert.equal((ui.$('sharePreview').textContent.match(/Ruslan/g) || []).length, 2);
    assert.doesNotMatch(ui.$('sharePreview').textContent, /Privé/);
    ui.$('shareDialog').close();
    const row = [...ui.$('athleteRows').children].find(row => row.textContent.includes('ruslan-free'));
    row.querySelector('.athlete-edit').click();
    assert.equal(ui.$('attachAthleteButton').hidden, false);
    ui.$('attachAthleteButton').click();
    await settle();
    assert.equal(mock.calls.some(call => call[0] === 'rpc'), false);
    assert.equal(ui.$('rosterLinkTarget').value, '');
    ui.$('rosterLinkTarget').value = 'ruslan-account';
    ui.$('rosterLinkTarget').dispatchEvent(new ui.window.Event('change'));
    const weight = ui.window.document.querySelector('[data-choice="weight"]');
    weight.value = 'source'; weight.dispatchEvent(new ui.window.Event('change'));
    ui.$('rosterLinkConfirm').checked = true; ui.$('rosterLinkConfirm').dispatchEvent(new ui.window.Event('change'));
    ui.window.document.querySelector('.roster-link-dialog form').dispatchEvent(new ui.window.Event('submit', { cancelable: true }));
    await settle();
    const call = mock.calls.find(call => call[1] === 'merge_roster_athlete');
    assert.deepEqual(call[2], {
      p_source_id: 'ruslan-free', p_target_id: 'ruslan-account',
      p_source_updated_at: base.updated_at, p_target_updated_at: base.updated_at,
      p_source_relation_updated_at: '2026-09-22T13:00:00Z', p_target_relation_updated_at: '2026-09-22T13:00:00Z',
      p_choices: { weight: 'source', record: 'target' },
    });
    assert.equal(ui.$('athleteRows').children.length, 3);
    assert.equal(ui.$('athleteRows').querySelectorAll('a.roster-calendar-link').length, 1);
    assert.equal(ui.$('shareDialog').open, false);
    assert.equal(ui.$('athleteDialog').open, false);
  } finally { await ui.close(); }
});

test('long merged notes survive an unrelated roster edit without trimming or resubmission', async () => {
  const mock = rosterMock({ registered: true });
  const notes = `  ${'x'.repeat(22000)}\n\n— Notes de la fiche rattachée —\n${'y'.repeat(20000)}  `;
  mock.tables.coach_athletes[0].private_notes = notes;
  const ui = await surface('roster.html', 'roster.js', mock.client, 'https://gestionboxeur.example/roster.html');
  try {
    ui.$('athleteRows').querySelector('.athlete-edit').click();
    assert.equal(ui.$('athleteNote').maxLength, notes.length);
    assert.equal(ui.$('athleteNote').value, notes);
    ui.$('weight').value = '70';
    submit(ui, 'athleteForm'); await settle();
    const payload = mock.calls.find(call => call[1] === 'update_roster_athlete')[2].p_data;
    assert.equal(Object.hasOwn(payload, 'private_notes'), false);
    ui.$('athleteRows').querySelector('.athlete-edit').click();
    ui.$('athleteNote').value = `  ${'z'.repeat(21000)}  `;
    submit(ui, 'athleteForm'); await settle();
    const edit = mock.calls.filter(call => call[1] === 'update_roster_athlete').at(-1)[2].p_data;
    assert.equal(edit.private_notes, `  ${'z'.repeat(21000)}  `);
  } finally { await ui.close(); }
});

test('administration renders untrusted names and emails as text and presents coaching activation instead of an athlete role', async () => {
  const mock = authMock({ user: { id: 'admin-id' } });
  mock.client.from = () => ({ select() { return this; }, eq() { return this; }, async single() { return { data: { is_admin: true }, error: null }; }, async maybeSingle() { return { data: { gym_name: 'Mon équipe', address: '123, rue du Gym' }, error: null }; } });
  mock.client.functions = { async invoke() { return { data: { users: [{ id: 'unsafe-id', email: 'x\" onclick=\"alert(1)@example.test', full_name: '<img src=x onerror=alert(1)>', account_type: 'athlete' }] }, error: null }; } };
  const ui = await surface('admin/index.html', 'admin.js', mock.client, 'https://gestionboxeur.example/admin/');
  try {
    assert.equal(ui.$('userRows').querySelector('img'), null);
    assert.equal(ui.$('userRows').querySelector('[onclick]'), null);
    assert.match(ui.$('userRows').textContent, /<img src=x onerror=alert\(1\)>/);
    assert.match(ui.$('userRows').textContent, /Non activées/);
    assert.doesNotMatch(ui.$('userRows').textContent, /Athlète/);
    assert.equal(ui.$('userRows').querySelectorAll('button').length, 2);
  } finally { await ui.close(); }
});

test('administration rejects a non-admin profile before invoking account APIs', async () => {
  const mock = authMock({ user: { id: 'coach-id' } });
  let invoked = false;
  mock.client.from = () => ({ select() { return this; }, eq() { return this; }, async single() { return { data: { is_admin: false }, error: null }; } });
  mock.client.functions = { async invoke() { invoked = true; return { data: {}, error: null }; } };
  const ui = await surface('admin/index.html', 'admin.js', mock.client, 'https://gestionboxeur.example/admin/');
  try {
    assert.equal(invoked, false);
    assert.equal(ui.$('createTestButton').disabled, true);
    assert.match(ui.$('adminError').textContent, /réservé aux administrateurs/);
  } finally { await ui.close(); }
});

test('legacy roster keeps eight existing athletes, unavailable statuses, gym address and combat/sparring lists', async () => {
  const mock = rosterMock({ legacy: true });
  const ui = await surface('roster.html', 'roster.js', mock.client, 'https://gestionboxeur.example/roster.html?liste=1');
  try {
    assert.equal(ui.$('athleteRows').children.length, 8);
    assert.equal(ui.$('statAvailable').textContent, '1');
    assert.equal(ui.$('gymBrand').textContent, 'Mon équipe');
    assert.equal(ui.$('gymAddress').textContent, '123, rue du Gym');
    assert.equal(ui.window.document.title, 'Mon équipe — Athlètes et listes');
    assert.equal(ui.$('shareDialog').open, false);
    assert.equal(ui.window.location.search, '?liste=1');
    ui.$('shareButton').click();
    assert.equal(ui.$('shareDialog').open, true);
    assert.match(ui.$('sharePreview').textContent, /SPARRING/);
    assert.match(ui.$('sharePreview').textContent, /MON ÉQUIPE/);
    assert.match(ui.$('sharePreview').textContent, /123, rue du Gym/);
    ui.$('shareGymAddress').value='45 rue du Combat';ui.$('shareGymAddress').dispatchEvent(new ui.window.Event('input'));
    assert.match(ui.$('sharePreview').textContent,/45 rue du Combat/);assert.doesNotMatch(ui.$('sharePreview').textContent,/123, rue du Gym/);
    assert.equal(ui.$('gymAddress').textContent,'123, rue du Gym');
    ui.$('includeGymAddress').checked=false;ui.$('includeGymAddress').dispatchEvent(new ui.window.Event('change'));
    assert.doesNotMatch(ui.$('sharePreview').textContent,/45 rue du Combat/);
    ui.$('shareDialog').close();ui.$('shareButton').click();assert.equal(ui.$('shareGymAddress').value,'123, rue du Gym');
    assert.doesNotMatch(ui.$('sharePreview').textContent, /privée existante/);
    ui.$('typeButtons').querySelector('[data-value="combat"]').click();
    assert.match(ui.$('sharePreview').textContent, /COMBAT/);
    assert.equal(mock.calls.some(call => call[0] === 'eq' && call[2] === 'is_active'), false);
  } finally { await ui.close(); }
});

test('legacy roster selection and removal use original owner-scoped storage with precise deletion confirmation', async () => {
  const mock = rosterMock({ legacy: true });
  const ui = await surface('roster.html', 'roster.js', mock.client, 'https://gestionboxeur.example/roster.html');
  try {
    const checkbox = ui.$('athleteRows').querySelector('input:not(:disabled)');
    checkbox.checked = false; checkbox.dispatchEvent(new ui.window.Event('change')); await settle();
    const update = mock.calls.find(call => call[0] === 'update');
    assert.equal(update[1], 'athletes'); assert.equal(update[2].selected, false);
    const name = [...ui.$('athleteRows').querySelectorAll('.name-button')].find(button => button.textContent.includes('Martin'));
    name.click();
    assert.equal(ui.$('deleteAthleteButton').textContent, 'Supprimer la fiche');
    const confirmations = [];
    ui.window.confirm = message => { confirmations.push(message); return false; };
    ui.$('deleteAthleteButton').click(); await settle();
    assert.match(confirmations[0], /définitivement.*notes.*irréversible/);
    assert.equal(mock.calls.some(call => call[0] === 'delete'), false);
    ui.window.confirm = () => true;
    ui.$('deleteAthleteButton').click(); await settle();
    assert.equal(mock.calls.filter(call => call[0] === 'delete').length, 1);
    assert.equal(ui.$('athleteRows').children.length, 7);
    assert.equal(mock.calls.some(call => call[0] === 'rpc'), false);
  } finally { await ui.close(); }
});

test('athlete and invitation route to planning while preserving query and hash', async () => {
  const athlete = rosterMock({ role: 'athlete' });
  const athleteUi = await surface('roster.html', 'roster.js', athlete.client, 'https://gestionboxeur.example/team/roster.html?date=2026-09-21#day');
  try {
    assert.deepEqual(athleteUi.navigations, ['https://gestionboxeur.example/team/planning.html?date=2026-09-21#day']);
    assert.equal(athlete.calls.some(call => call[1] === 'athletes'), false);
  } finally { await athleteUi.close(); }
  const coach = rosterMock();
  const inviteUi = await surface('roster.html', 'roster.js', coach.client, 'https://gestionboxeur.example/team/roster.html?invite=opaque%2Btoken&date=2026-09-21#invite');
  try {
    assert.deepEqual(inviteUi.navigations, ['https://gestionboxeur.example/team/planning.html?invite=opaque%2Btoken&date=2026-09-21#invite']);
    assert.equal(coach.calls.length, 0);
  } finally { await inviteUi.close(); }
});

test('sign-out clears displayed roster notes, gym identity, share preview and cached controls', async () => {
  const mock = rosterMock({ legacy: true });
  const ui = await surface('roster.html', 'roster.js', mock.client, 'https://gestionboxeur.example/roster.html');
  try {
    ui.$('shareButton').click();
    mock.emit('SIGNED_OUT'); await settle();
    assert.equal(ui.$('athleteRows').children.length, 0);
    assert.equal(ui.$('coachGrid').children.length, 0);
    assert.equal(ui.$('sharePreview').textContent, '');
    assert.equal(ui.$('gymBrand').textContent, 'Mon gym');
    assert.equal(ui.$('gymAddress').textContent, '');
    assert.equal(ui.$('shareDialog').open, false);
    assert.equal(ui.$('addAthleteButton').disabled, true);
    assert.deepEqual(ui.navigations, ['https://gestionboxeur.example/login.html']);
  } finally { await ui.close(); }
});

test('an explicit invitation survives the unauthenticated roster redirect to login', async () => {
  const mock = rosterMock({ authenticated: false });
  const ui = await surface('roster.html', 'roster.js', mock.client, 'https://gestionboxeur.example/team/roster.html?invite=opaque%2Btoken&date=2026-09-21#invite');
  try {
    assert.deepEqual(ui.navigations, ['https://gestionboxeur.example/team/login.html?invite=opaque%2Btoken&date=2026-09-21#invite']);
    assert.equal(mock.calls.length, 0);
  } finally { await ui.close(); }
});

test('an old pending invitation does not block a coach from opening the roster and lists', async () => {
  const mock = rosterMock({ legacy: true });
  const ui = await surface('roster.html', 'roster.js', mock.client, 'https://gestionboxeur.example/team/roster.html?liste=1', { pendingInvite: 'expired-old-token' });
  try {
    assert.deepEqual(ui.navigations, []);
    assert.equal(ui.$('athleteRows').children.length, 8);
    assert.equal(ui.$('shareDialog').open, false);
    ui.$('shareButton').click();
    assert.equal(ui.$('shareDialog').open, true);
    assert.match(ui.$('sharePreview').textContent, /SPARRING/);
  } finally { await ui.close(); }
});


test('attachment inside the edit form preserves unsaved edits instead of comparing stale data', async () => {
  const mock = rosterMock();
  const ui = await surface('roster.html', 'roster.js', mock.client, 'https://gestionboxeur.example/roster.html');
  try {
    ui.$('athleteRows').querySelector('.athlete-edit').click();
    ui.$('athleteNote').value = 'Observation non enregistrée';
    ui.$('attachAthleteButton').click(); await settle();
    assert.equal(ui.window.document.querySelector('.roster-link-dialog'), null);
    assert.match(ui.$('athleteError').textContent, /Enregistre tes modifications/);
    assert.equal(ui.$('athleteNote').value, 'Observation non enregistrée');
    assert.equal(ui.$('athleteDialog').open, true);
  } finally { await ui.close(); }
});


test('mobile roster sort uses the same ordering as the table headers', async () => {
 const mock=rosterMock();const base=mock.tables.athletes[0];
 mock.tables.athletes=[{...base,id:'a',first_name:'Alex',weight_kg:80},{...base,id:'b',first_name:'Zoe',weight_kg:60}];
 mock.tables.coach_athletes=mock.tables.athletes.map(a=>({athlete_id:a.id,can_view_calendar:false}));
 const ui=await surface('roster.html','roster.js',mock.client,'https://gestionboxeur.example/roster.html');
 try{
  ui.$('mobileSort').value='weight';ui.$('mobileSort').dispatchEvent(new ui.window.Event('change'));
  assert.match(ui.$('athleteRows').firstElementChild.textContent,/Zoe/);
  ui.$('mobileSortDirection').click();assert.match(ui.$('athleteRows').firstElementChild.textContent,/Alex/);
  assert.equal(ui.window.document.querySelector('[data-sort="weight"]').closest('th').getAttribute('aria-sort'),'descending');
 }finally{await ui.close();}
});


test('sharing defaults to Sparring first and exposes synchronized selection for type and weight',async()=>{
 const mock=rosterMock();const ui=await surface('roster.html','roster.js',mock.client,'https://gestionboxeur.example/roster.html');
 try{
  ui.$('shareButton').click();
  assert.equal(ui.$('typeButtons').firstElementChild.dataset.value,'sparring');
  assert.match(ui.$('sharePreview').textContent,/POUR SPARRING/);
  assert.equal(ui.$('typeButtons').querySelector('[aria-pressed=true]').dataset.value,'sparring');
  ui.$('typeButtons').querySelector('[data-value=combat]').click();assert.match(ui.$('sharePreview').textContent,/POUR COMBAT/);
  ui.$('weightButtons').querySelector('[data-value=kg]').click();assert.equal(ui.$('weightButtons').querySelectorAll('[aria-pressed=true]').length,1);assert.equal(ui.$('weightButtons').querySelector('[aria-pressed=true]').dataset.value,'kg');
  ui.$('shareDialog').close();ui.$('shareButton').click();assert.equal(ui.$('typeButtons').querySelector('[aria-pressed=true]').dataset.value,'sparring');
 }finally{await ui.close();}
});


test('directory views preserve filtered rows, selection and sorting without duplicating controls',async()=>{
 const mock=rosterMock();const ui=await surface('roster.html','roster.js',mock.client,'https://gestionboxeur.example/roster.html');
 try{
  const row=ui.$('athleteRows').firstElementChild;const check=row.querySelector('input');
  assert.equal(ui.$('athleteDirectory').dataset.rosterView,'table');assert.equal(check.checked,true);
  ui.$('searchInput').value='Martin';ui.$('searchInput').dispatchEvent(new ui.window.Event('input'));
  const filtered=ui.$('athleteRows').firstElementChild;
  ui.$('rosterViewButtons').querySelector('[data-view=cards]').click();
  assert.equal(ui.$('athleteDirectory').dataset.rosterView,'cards');assert.equal(ui.$('athleteRows').firstElementChild,filtered);assert.equal(filtered.querySelector('input').checked,true);
  ui.$('rosterViewButtons').querySelector('[data-view=table]').click();assert.equal(ui.$('searchInput').value,'Martin');assert.equal(ui.$('athleteRows').children.length,1);
  assert.equal(ui.$('settingsButton'),null);assert.equal(ui.$('saveState'),null);assert.equal(ui.$('settingsDialog'),null);
 }finally{await ui.close();}
});

test('signing in continues to the personal calendar by default',async()=>{
 const mock=authMock({user:{id:'person'}});const ui=await surface('login.html','auth.js',mock.client);
 try{assert.equal(ui.$('continueButton').href,'https://gestionboxeur.example/planning.html');}finally{await ui.close();}
});

test('signup saves separate contact details and falls back to the account email', async () => {
 const mock=authMock(),ui=await surface('login.html','auth.js',mock.client);
 try {
  ui.$('authToggle').click();ui.$('fullName').value='Alex Test';ui.$('birthDate').value='2000-03-12';ui.$('email').value='account@example.test';ui.$('password').value='secret123';ui.$('phone').value='514 555 0100';
  assert.equal(ui.$('signupSports').open,false);
  submit(ui,'authForm');await settle();assert.equal(mock.calls[0][1].options.data.contact_email,'account@example.test');assert.equal(mock.calls[0][1].options.data.phone,'514 555 0100');
  ui.$('contactEmail').value='contact@example.test';submit(ui,'authForm');await settle();assert.equal(mock.calls[1][1].email,'account@example.test');assert.equal(mock.calls[1][1].options.data.contact_email,'contact@example.test');
  ui.$('contactEmail').value='invalid';submit(ui,'authForm');await settle();assert.equal(mock.calls.length,2);
  ui.$('authToggle').click();assert.equal(ui.$('contactEmail').disabled,true);
 } finally {await ui.close();}
});

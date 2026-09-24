import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';

const source = await readFile(new URL('../js/test-session.js', import.meta.url), 'utf8');
async function sessionSurface({userId='test-id',owner='admin-id',valid=true}={}) {
  const window=new Window({url:'https://example.test/team/admin/',settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
  const calls=[],navigations=[];
  window.localStorage.setItem('regular-admin-session','untouched-admin-credentials');
  window.__config={TEST_MODE_KEY:'mode',TEST_SESSION_KEY:'test-session',TEST_STORAGE_POINTER:'test-pointer',isTestSession:()=>Boolean(window.sessionStorage.getItem('mode')),
    client:{auth:{stopAutoRefresh(){calls.push('stop-refresh');},onAuthStateChange(){}}},
    createTestClient:()=>({auth:{async verifyOtp(payload){calls.push(payload);window.sessionStorage.setItem('test-session','test-only-credentials');return {data:{session:valid?{user:{id:userId}}:null,user:{id:userId,app_metadata:{test_admin_id:owner}}},error:null};},async signOut(){calls.push('sign-out-test');return {error:null};}}})};
  window.__navigate=url=>navigations.push(url);
  window.eval(source.replace(/^import .*;$/m,'const {client,createTestClient,isTestSession,TEST_MODE_KEY,TEST_SESSION_KEY,TEST_STORAGE_POINTER}=window.__config;').replace(/^export /gm,'').replaceAll('location.replace(','window.__navigate(')+'\nwindow.api={beginTestSession,returnFromTestSession,mountTestSessionBanner};');
  return {window,calls,navigations,api:window.api,close:()=>window.happyDOM.abort()};
}
test('test mode uses a real verified athlete session and leaves administrator credentials untouched',async()=>{
  const ui=await sessionSurface();try{
    await ui.api.beginTestSession({user_id:'test-id',token_hash:'one-time-token'},'admin-id');
    assert.deepEqual(JSON.parse(JSON.stringify(ui.calls[0])),{token_hash:'one-time-token',type:'magiclink'});
    assert.equal(JSON.parse(ui.window.sessionStorage.getItem('mode')).userId,'test-id');
    assert.equal(ui.window.localStorage.getItem('regular-admin-session'),'untouched-admin-credentials');
    assert.deepEqual(ui.navigations,['https://example.test/team/planning.html']);
    ui.api.mountTestSessionBanner();assert.match(ui.window.document.body.textContent,/permissions réelles/);assert.doesNotMatch(ui.window.document.body.textContent,/one-time-token|credentials/);
  }finally{await ui.close();}
});
test('mismatched dedicated account, owner or expired session cannot enter test mode',async()=>{
  for(const options of [{userId:'another-athlete'},{owner:'another-admin'},{valid:false}]){
    const ui=await sessionSurface(options);try{
      await assert.rejects(ui.api.beginTestSession({user_id:'test-id',token_hash:'token'},'admin-id'),/plus autorisée/);
      assert.equal(ui.window.sessionStorage.getItem('mode'),null);assert.equal(ui.window.sessionStorage.getItem('test-session'),null);assert.equal(ui.navigations.length,0);assert.ok(ui.calls.includes('sign-out-test'));
    }finally{await ui.close();}
  }
});
test('admin logout during test preparation invalidates late credentials',async()=>{
  const ui=await sessionSurface();try{
    await assert.rejects(ui.api.beginTestSession({user_id:'test-id',token_hash:'token'},'admin-id',()=>false),/plus autorisée/);
    assert.equal(ui.window.sessionStorage.getItem('mode'),null);assert.equal(ui.navigations.length,0);
  }finally{await ui.close();}
});
test('returning from athlete test removes only per-tab test credentials',async()=>{
  const ui=await sessionSurface();try{
    ui.window.sessionStorage.setItem('mode','active');ui.window.sessionStorage.setItem('test-session','test');
    await ui.api.returnFromTestSession();
    assert.equal(ui.window.sessionStorage.getItem('mode'),null);assert.equal(ui.window.sessionStorage.getItem('test-session'),null);
    assert.equal(ui.window.localStorage.getItem('regular-admin-session'),'untouched-admin-credentials');
    assert.deepEqual(ui.navigations,['https://example.test/team/admin/']);
  }finally{await ui.close();}
});

async function settle(){for(let i=0;i<20;i++)await Promise.resolve();await new Promise(setImmediate);}
async function profileSurface(role='athlete',{contactEmail=null,resetError=null,birthDate='2000-03-04'}={}){
  const window=new Window({url:'https://example.test/team/profile.html',settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
  window.document.write(await readFile(new URL('../profile.html',import.meta.url),'utf8'));
  const calls=[],nav=[];let authCallback;
  const rows={profiles:{id:'current-user',account_type:role,full_name:'Alex Test',phone:'555-0000',is_admin:false,gym_id:'crew'},gyms:[{id:'crew',name:'Le Crew',address:'123 rue Exemple',is_default:true}],athletes:{id:'own-athlete',first_name:'Alex',last_name:'Test',birth_date:birthDate,email:contactEmail,sex:'F',weight_kg:70,weight_unit:'lb',fights:4,wins:2,losses:2,gym_id:'crew'},gym_settings:{gym_name:'Le Crew',address:'123 rue Exemple'}};
  window.__client={auth:{async getSession(){return {data:{session:{user:{id:'current-user',email:'account@example.test'}}},error:null};},async resetPasswordForEmail(email,options){calls.push(['resetPasswordForEmail',email,JSON.parse(JSON.stringify(options))]);return {data:{},error:resetError};},onAuthStateChange(fn){authCallback=fn;},async signOut(){authCallback('SIGNED_OUT');return {error:null};}},
    from(table){const q={select(){return q;},eq(...args){calls.push(['filter',table,...args]);return q;},order(){return q;},single(){return q;},maybeSingle(){return q;},then(resolve,reject){return Promise.resolve({data:rows[table],error:null}).then(resolve,reject);}};return q;},
    async rpc(name,args){calls.push([name,JSON.parse(JSON.stringify(args))]);return {data:'saved',error:null};}};
  window.__navigation=args=>nav.push(args);window.__navigate=()=>{};
  const script=await readFile(new URL('../js/profile.js',import.meta.url),'utf8');
  window.eval(script.replace(/^import \{ client \}.*$/m,'const client=window.__client;').replace(/^import \{ mountNavigation \}.*$/m,'const mountNavigation=window.__navigation;').replaceAll('location.replace(','window.__navigate('));await settle();
  return {window,calls,nav,$:id=>window.document.getElementById(id),close:()=>window.happyDOM.abort()};
}
test('athlete profile reads own identity and saves normalized sports data without privilege fields',async()=>{
  const ui=await profileSurface();try{
    assert.equal(ui.$('athletePanel').classList.contains('hidden'),false);assert.equal(ui.$('coachPanel').classList.contains('hidden'),true);
    assert.ok(ui.calls.some(c=>c[0]==='filter'&&c[1]==='athletes'&&c[2]==='user_id'&&c[3]==='current-user'));
    assert.equal(ui.$('profileWeight').value,'154.3');ui.$('profileWeight').value='165.3';ui.$('profileWeight').step='any'; // Happy DOM miscomputes decimal step validity.
    ui.$('profileStatus').value='unavailable';
    ui.$('sportsProfileForm').dispatchEvent(new ui.window.Event('submit',{cancelable:true}));await settle();
    const data=ui.calls.find(c=>c[0]==='save_athlete_profile')[1].p_data;
    assert.ok(Math.abs(data.weight_kg-75)<0.1);assert.equal(data.birth_date,undefined);assert.equal(data.email,undefined);assert.equal(data.weight_unit,'lb');assert.equal(data.user_id,undefined);assert.equal(data.is_admin,undefined);assert.equal(data.coach_id,undefined);
    assert.equal(data.status,'unavailable');assert.equal(data.gym_id,undefined);assert.equal(ui.$('profileGym'),null);
    assert.equal(ui.$('sportsStatus').classList.contains('hidden'),false);
  }finally{await ui.close();}
});
test('coach profile exposes own sports profile and saves gym separately',async()=>{
  const ui=await profileSurface('coach');try{
    assert.equal(ui.$('coachPanel').classList.contains('hidden'),false);assert.equal(ui.$('athletePanel').classList.contains('hidden'),false);
    assert.equal(ui.$('existingGym'),null);ui.$('coachGymName').value='Autre gym';ui.$('coachGymAddress').value='45 rue Test';ui.$('coachGymForm').dispatchEvent(new ui.window.Event('submit',{cancelable:true}));await settle();
    assert.deepEqual(ui.calls.find(c=>c[0]==='save_gym'),['save_gym',{p_name:'Autre gym',p_address:'45 rue Test'}]);assert.equal(ui.$('gymBrand').textContent,'Autre gym');
  }finally{await ui.close();}
});


test('personal account can request coaching activation only for itself',async()=>{
 const ui=await profileSurface();try{
  assert.equal(ui.$('enableCoachingButton').hidden,false);
  ui.$('enableCoachingButton').click();await settle();
  assert.deepEqual(ui.calls.find(call=>call[0]==='enable_coaching'),['enable_coaching',{}]);
 }finally{await ui.close();}
});


test('coach personal contact saves independently of unused sports fields and defaults to account email',async()=>{
 const ui=await profileSurface('coach',{birthDate:null});try{
  assert.equal(ui.$('profileEmail').value,'account@example.test');assert.equal(ui.$('profileBirthDate').required,false);
  assert.equal(ui.$('sportsProfileForm').hidden,true);assert.equal(ui.$('sportsToggle').getAttribute('aria-expanded'),'false');
  ui.$('profileWins').value='900';ui.$('profileWeight').value='-1';
  ui.$('profileEmail').value='contact@example.test';ui.$('athleteProfileForm').dispatchEvent(new ui.window.Event('submit',{cancelable:true}));await settle();
  const patch=ui.calls.find(c=>c[0]==='save_athlete_profile')[1].p_data;
  assert.equal(patch.email,'contact@example.test');assert.equal(patch.birth_date,null);
  assert.deepEqual(Object.keys(patch).sort(),['birth_date','email','first_name','last_name','phone','sex']);
  assert.equal(ui.$('personalStatus').className,'success');
  ui.$('sportsToggle').click();assert.equal(ui.$('sportsProfileForm').hidden,false);assert.equal(ui.$('sportsToggle').getAttribute('aria-expanded'),'true');
  ui.$('sportsToggle').click();assert.equal(ui.$('sportsProfileForm').hidden,true);
 }finally{await ui.close();}
});

test('saved contact email is displayed but password recovery always uses the account email',async()=>{
 const ui=await profileSurface('coach',{contactEmail:'contact@example.test'});try{
  assert.equal(ui.$('profileEmail').value,'contact@example.test');
  ui.$('profileEmail').value='unsaved@example.test';ui.$('resetPasswordButton').click();ui.$('resetPasswordButton').click();await settle();
  assert.deepEqual(ui.calls.filter(c=>c[0]==='resetPasswordForEmail'),[['resetPasswordForEmail','account@example.test',{redirectTo:'https://example.test/team/login.html?mode=recovery'}]]);
  assert.equal(ui.$('passwordStatus').className,'success');assert.equal(ui.$('resetPasswordButton').disabled,true);
  assert.equal(ui.calls.some(c=>c[0]==='save_athlete_profile'),false);
 }finally{await ui.close();}
});

test('failed password email can be retried and signout clears profile details',async()=>{
 const ui=await profileSurface('coach',{resetError:{message:'Envoi indisponible'}});try{
  ui.$('resetPasswordButton').click();await settle();assert.equal(ui.$('resetPasswordButton').disabled,false);assert.equal(ui.$('passwordStatus').className,'form-error');
  ui.$('logoutButton').click();await settle();for(const id of ['athletePanel','sportsPanel','securityPanel'])assert.equal(ui.$(id).classList.contains('hidden'),true);
  assert.equal(ui.$('accountEmail').textContent,'');assert.equal(ui.$('profileEmail').value,'');
 }finally{await ui.close();}
});

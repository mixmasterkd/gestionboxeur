import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { createGroupsUI } from '../js/groups.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const people=[
 {id:'self',user_id:'coach',first_name:'Claude',last_name:'Martin'},
 {id:'athlete',user_id:'athlete-user',first_name:'Émilie',last_name:'Roy'},
 {id:'readonly',user_id:'readonly-user',first_name:'Louis',last_name:'Léger'},
 {id:'sheet',user_id:null,first_name:'Fiche',last_name:'Sans compte'},
];
const relation=(athlete_id,can_add_sessions=true)=>({athlete_id,status:'accepted',can_view_calendar:true,can_add_sessions});
async function fixture({groups=[],hash='',mobile=false,account={}}={}) {
 const window=new Window({url:`https://example.test/roster.html${hash}`,settings:{disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
 for(const name of ['window','document','location','history'])Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?window:window[name]});
 window.matchMedia=()=>({matches:mobile});
 document.write(await readFile(new URL('../roster.html',import.meta.url),'utf8'));
 let user={id:'coach'},loadedGroups=structuredClone(groups);const calls=[],messages=[];
 const loadedAccount={profile:{account_type:'coach'},planningAvailable:true,athletes:people,relations:[relation('athlete'),relation('readonly',false)],...account};
 const api={
  loadAccount:async()=>structuredClone(loadedAccount),loadTrainingGroups:async()=>structuredClone(loadedGroups),
  saveTrainingGroup:async(payload,existing)=>{calls.push(['save',structuredClone(payload),existing?.id]);const group={...existing,...payload,id:existing?.id||'new',coach_id:user.id};loadedGroups=[...loadedGroups.filter(g=>g.id!==group.id),group];return group;},
  deleteTrainingGroup:async(group)=>{calls.push(['delete',group.id]);loadedGroups=loadedGroups.filter(g=>g.id!==group.id);},
 };
 const ui=createGroupsUI({getUser:()=>user,api,onToast:message=>messages.push(message)});await ui.refresh();
 const click=text=>{const node=[...document.querySelectorAll('button')].find(b=>b.textContent===text||b.getAttribute('aria-label')===text);assert.ok(node,text);node.click();};
 const submit=()=>document.querySelector('.group-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
 return {window,api,ui,calls,messages,click,submit,setUser:next=>user=next,close:async()=>{ui.invalidate();await window.happyDOM.abort();}};
}
const group={id:'g1',coach_id:'coach',name:'Compétition',athlete_ids:['self','athlete'],updated_at:'2026-09-30T12:00:00Z'};
test('roster tabs display groups separately, including an initial group deep link',async()=>{
 const f=await fixture({groups:[group],hash:'#groupes'});try {
  assert.equal(document.getElementById('groupDirectory').hidden,false);assert.equal(document.getElementById('athleteDirectory').hidden,true);assert.equal(document.getElementById('coachesDirectory').hidden,true);
  assert.equal(document.querySelector('[data-directory=groups]').getAttribute('aria-pressed'),'true');
  assert.match(document.querySelector('.group-card').textContent,/Claude Martin, Émilie Roy/);assert.match(document.querySelector('.group-card a').href,/planning.html\?group=g1$/);
  f.click('Athlètes');assert.equal(document.getElementById('groupDirectory').hidden,true);assert.equal(document.getElementById('athleteDirectory').hidden,false);assert.equal(location.hash,'');
  f.click('Groupes');assert.equal(location.hash,'#groupes');
 }finally{await f.close();}
});
test('creating a group lists the coach by name alongside permitted athletes and saves selected members',async()=>{
 const f=await fixture({mobile:true});try {
  f.click('＋ Créer un groupe');assert.equal(document.activeElement.id,'groupDialogTitle');
  assert.deepEqual([...document.querySelectorAll('[name=recipient_athlete]')].map(n=>n.value),['self','athlete']);
  assert.match(document.querySelector('.group-form').textContent,/Claude Martin/);assert.doesNotMatch(document.querySelector('.group-form').textContent,/M’inclure/);
  document.querySelector('[name=group_name]').value='  Compétition  ';document.querySelector('[name=recipient_athlete][value=self]').click();document.querySelector('[name=recipient_athlete][value=athlete]').click();
  f.submit();await tick();assert.deepEqual(f.calls,[['save',{name:'Compétition',athlete_ids:['self','athlete']},undefined]]);assert.equal(document.querySelector('.group-dialog').open,false);assert.match(document.querySelector('.group-card').textContent,/2 membres/);
 }finally{await f.close();}
});
test('editing a group changes its name and membership while an empty group remains valid',async()=>{
 const f=await fixture({groups:[group]});try {
  f.click('Modifier');document.querySelector('[name=group_name]').value='Technique';document.querySelector('[value=self]').click();document.querySelector('[value=athlete]').click();f.submit();await tick();
  assert.deepEqual(f.calls[0],['save',{name:'Technique',athlete_ids:[]},'g1']);assert.match(document.querySelector('.group-card').textContent,/Aucun membre/);
 }finally{await f.close();}
});
test('deleting a group requires the displayed second confirmation',async()=>{
 const f=await fixture({groups:[group]});try {
  f.click('Modifier');f.click('Supprimer le groupe');assert.equal(f.calls.length,0);assert.equal(document.querySelector('.group-delete-warning').hidden,false);assert.match(document.querySelector('.group-delete-warning').textContent,/passées et les bilans sont conservés/);
  f.click('Confirmer la suppression');await tick();assert.deepEqual(f.calls,[['delete','g1']]);assert.equal(document.querySelector('.group-card'),null);
 }finally{await f.close();}
});
test('inaccessible existing members remain removable and cannot silently block a group forever',async()=>{
 const f=await fixture({groups:[{...group,athlete_ids:['self','readonly','missing']} ]});try {
  f.click('Modifier');assert.match(document.querySelector('.group-form').textContent,/Athlète indisponible/);assert.equal(document.querySelectorAll('.recipient-option small').length,2);
  f.submit();assert.equal(f.calls.length,0);assert.match(document.querySelector('.group-form .form-error').textContent,/Retire les membres/);
  document.querySelector('[value=readonly]').click();document.querySelector('[value=missing]').click();f.submit();await tick();assert.deepEqual(f.calls[0][1].athlete_ids,['self']);
 }finally{await f.close();}
});
test('failed saves preserve the editable draft and surface the service error',async()=>{
 const f=await fixture();try {
  f.api.saveTrainingGroup=async()=>{throw new Error('Connexion interrompue');};f.click('＋ Créer un groupe');document.querySelector('[name=group_name]').value='Mon groupe';f.submit();await tick();
  assert.equal(document.querySelector('.group-dialog').open,true);assert.equal(document.querySelector('[name=group_name]').value,'Mon groupe');assert.match(document.querySelector('.group-form .form-error').textContent,/Connexion interrompue/);assert.equal(document.querySelector('[type=submit]').disabled,false);
 }finally{await f.close();}
});
test('refresh clears private group cards and dialogs before an account request completes',async()=>{
 const f=await fixture({groups:[group]});try {
  f.click('Modifier');let release;f.api.loadAccount=()=>new Promise(resolve=>release=resolve);f.setUser({id:'other'});const pending=f.ui.refresh();
  assert.equal(document.querySelector('.group-card'),null);assert.equal(document.querySelector('.group-dialog').open,false);assert.equal(document.getElementById('addGroupButton').disabled,true);
  f.ui.invalidate();release({profile:{account_type:'coach'},athletes:[],relations:[]});await pending;assert.equal(document.querySelector('.group-card'),null);
 }finally{await f.close();}
});
test('an account change prevents submitting a stale group or reopening its editor',async()=>{
 const f=await fixture({groups:[group]});try {
  f.click('Modifier');f.setUser({id:'other'});f.submit();await tick();assert.equal(f.calls.length,0);
  document.querySelector('.group-dialog').close();f.click('Modifier');assert.equal(document.querySelector('.group-dialog').open,false);
 }finally{await f.close();}
});
test('a late save after invalidation cannot show a previous account toast or restore its groups',async()=>{
 const f=await fixture();try {
  let release;f.api.saveTrainingGroup=()=>new Promise(resolve=>release=resolve);f.click('＋ Créer un groupe');document.querySelector('[name=group_name]').value='Ancien compte';f.submit();f.ui.invalidate();f.setUser({id:'other'});release({id:'old'});await tick();
  assert.deepEqual(f.messages,[]);assert.equal(document.querySelector('.group-card'),null);assert.equal(document.querySelector('.group-dialog').children.length,0);
 }finally{await f.close();}
});
test('athlete accounts and unavailable planning cannot create groups',async()=>{
 for(const account of [{profile:{account_type:'athlete'}},{planningAvailable:false}]){
  const f=await fixture({account});try {assert.equal(document.getElementById('addGroupButton').disabled,true);assert.equal(document.getElementById('groupError').hidden,false);assert.equal(document.querySelector('.group-card'),null);}finally{await f.close();}
 }
});

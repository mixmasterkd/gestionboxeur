import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { planningAthletes, createRecipientPicker } from '../js/group-selection.js';
const athletes=[{id:'self',user_id:'coach',first_name:'Claude',last_name:'Martin'},{id:'a',user_id:'a-user',first_name:'Émilie',last_name:'Roy'},{id:'b',user_id:'b-user',first_name:'Louis',last_name:'Rivard'},{id:'sheet',first_name:'Fiche'}];
function fixture(options={}){const window=new Window();globalThis.document=window.document;const picker=createRecipientPicker({athletes,...options});document.body.append(picker.root);return{window,picker,close:()=>window.happyDOM.abort()};}
test('planning includes one’s own named athlete and only accepted writable connected athletes',()=>{
 const state={user:{id:'coach'},athletes,relations:[{athlete_id:'a',status:'accepted',can_view_calendar:true,can_add_sessions:true},{athlete_id:'b',status:'accepted',can_view_calendar:true,can_add_sessions:false},{athlete_id:'sheet',status:'accepted',can_view_calendar:true,can_add_sessions:true}]};
 assert.deepEqual(planningAthletes(state).map(a=>a.id),['self','a']);state.relations[0].status='pending';assert.deepEqual(planningAthletes(state).map(a=>a.id),['self']);
 state.relations[0].status='accepted';state.relations[0].can_view_calendar=false;assert.deepEqual(planningAthletes(state).map(a=>a.id),['self']);
});
test('group and individual recipients remain explicit while the total deduplicates their shared members',async()=>{
 const f=fixture({groups:[{id:'g',name:'Compétition',athlete_ids:['self','a']}],athleteIds:['a'],groupIds:['g']});try{
  assert.deepEqual([...document.querySelectorAll('.recipient-section')].map(n=>n.textContent),['Groupes','Athlètes']);assert.match(document.querySelector('.recipient-summary').textContent,/2 personnes$/);assert.deepEqual(f.picker.value(),{athlete_ids:['a'],group_ids:['g']});
  document.querySelector('[value=g]').click();assert.deepEqual(f.picker.value(),{athlete_ids:['a'],group_ids:[]});assert.match(document.querySelector('.recipient-summary').textContent,/1 personne$/);
 }finally{await f.close();}
});
test('search ignores accents and preserves checked selections when hidden by the query',async()=>{
 const f=fixture({athleteIds:['self']});try{
  const search=document.querySelector('[type=search]');search.value='emilie';search.dispatchEvent(new f.window.Event('input'));assert.equal(document.querySelectorAll('.recipient-option').length,1);assert.match(document.querySelector('.recipient-options').textContent,/Émilie Roy/);document.querySelector('[value=a]').click();assert.deepEqual(f.picker.value().athlete_ids,['self','a']);
  search.value='';search.dispatchEvent(new f.window.Event('input'));assert.equal(document.querySelector('[value=self]').checked,true);
 }finally{await f.close();}
});
test('membership selection excludes group choices and opening does not focus the search',async()=>{
 const f=fixture({allowGroups:false,groups:[{id:'g',name:'Groupe',athlete_ids:['a']}],groupIds:['g']});try{
  f.picker.open();assert.equal(document.querySelector('details').open,true);assert.equal(document.querySelector('[name=recipient_group]'),null);assert.deepEqual(f.picker.value().group_ids,[]);assert.notEqual(document.activeElement,document.querySelector('[type=search]'));
 }finally{await f.close();}
});
test('recipient names are rendered as text without interpreting markup',async()=>{
 const f=fixture({athletes:[{id:'a',first_name:'<img src=x>',last_name:'<script>test</script>'}]});try{assert.equal(document.querySelector('img,script'),null);assert.match(document.querySelector('.recipient-options').textContent,/<img src=x>/);}finally{await f.close();}
});

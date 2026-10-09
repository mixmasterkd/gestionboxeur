import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createJournalUI} from '../js/journal.js';
const tick=()=>new Promise(r=>setImmediate(r));
async function fixture(){
 const window=new Window();globalThis.document=window.document;globalThis.window=window;
 document.body.innerHTML='<section id="journalSection"></section><dialog id="journalDialog"><div id="journalContent"></div></dialog>';
 const state={user:{id:'athlete'},selectedAthlete:{id:'a1',user_id:'athlete'},relation:null};
 const entries=[],updates=[],calls=[];
 const api={loadJournal:async()=>structuredClone({entries,updates}),saveJournalEntry:async(payload,existing)=>{calls.push(['save',payload]);const row=existing?entries.find(e=>e.id===existing.id):{id:'j1',created_by:state.user.id,author_name:'Auteur',created_at:'2026-09-24T12:00:00Z',archived:false};Object.assign(row,payload,{updated_at:'2026-09-24T12:01:00Z'});if(!existing){entries.push(row);updates.push({id:'u1',entry_id:row.id,kind:'created',content:row.body,created_at:row.created_at,author_name:'Auteur'});}return structuredClone(row);},addJournalComment:async(id,content)=>{calls.push(['comment',id,content]);updates.push({id:'u2',entry_id:id,kind:'comment',content,created_at:'2026-09-24T13:00:00Z',author_name:'Coach'});}};
 const sortables=[];
 api.deleteJournalEntry=async(entry,expectedUpdates)=>{calls.push(['delete',structuredClone(entry),structuredClone(expectedUpdates)]);entries.splice(entries.findIndex(item=>item.id===entry.id),1);for(let index=updates.length-1;index>=0;index--)if(updates[index].entry_id===entry.id)updates.splice(index,1);return {id:entry.id};};
 const ui=createJournalUI({getState:()=>state,api,makeSortable:(node,options)=>{const instance={node,options,destroy(){this.destroyed=true;},option(key,value){this.options[key]=value;}};sortables.push(instance);return instance;}});await ui.refresh();
 return {window,state,api,ui,entries,updates,calls,sortables,close:async()=>{ui.invalidate();await window.happyDOM.abort();delete globalThis.document;delete globalThis.window;}};
}
const click=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text).click();
test('athlete creates a subject then views coach comments in both journal views without calendar notes',async()=>{
 const f=await fixture();try{
 click('＋ Sujet');document.querySelector('[name=journal_title]').value='Garde';document.querySelector('[name=journal_body]').value='<img src=x onerror=alert(1)> Observation';click('Enregistrer');await tick();
 assert.equal(f.entries.length,1);assert.equal(document.querySelector('img'),null);
 document.querySelector('[name=journal_comment]').value='Conseil';click('Ajouter au suivi');await tick();assert.equal(f.updates.length,2);
 document.querySelector('.close-button').click();click('Chronologie');assert.match(document.querySelector('.journal-content').textContent,/Conseil/);assert.equal(document.querySelectorAll('.journal-timeline-entry').length,2);
 click('Kanban');assert.equal(document.querySelectorAll('.journal-card').length,1);
 assert.equal(document.querySelector('[data-archive=active]').getAttribute('aria-pressed'),'true');
 }finally{await f.close();}
});
test('late journal response cannot leak the previous athlete into a newly selected calendar',async()=>{
 const f=await fixture();try{
 let resolve;f.api.loadJournal=()=>new Promise(r=>resolve=r);const old=f.ui.refresh();f.state.selectedAthlete={id:'a2',user_id:'athlete'};f.api.loadJournal=async()=>({entries:[],updates:[]});await f.ui.refresh();
 resolve({entries:[{id:'secret',title:'Ancien sujet',status:'work',archived:false}],updates:[]});await old;assert.doesNotMatch(document.querySelector('.journal-content').textContent,/Ancien sujet/);
 }finally{await f.close();}
});
test('read-only coaches cannot create subjects or leave advice',async()=>{
 const f=await fixture();try{f.state.user.id='coach';f.state.relation={status:'accepted',can_view_calendar:true,can_add_sessions:false};await f.ui.refresh();assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='＋ Sujet').hidden,true);f.state.relation.status='revoked';await f.ui.refresh();assert.match(document.querySelector('.journal-content').textContent,/autorisations/);}finally{await f.close();}
});

async function addSubject(f){
 click('＋ Sujet');document.querySelector('[name=journal_title]').value='Garde';click('Enregistrer');await tick();document.querySelector('.close-button').click();
 return document.querySelector('.journal-card');
}
function drop(f,item,status){
 const source=f.sortables.filter(s=>!s.destroyed).find(s=>s.node.contains(item));
 const target=document.querySelector(`.journal-cards[data-status="${status}"]`);
 source.options.onStart({item});target.append(item);
 return source.options.onEnd({item,to:target});
}
test('journal dragging changes the shared status and keeps the detail accessible',async()=>{
 const f=await fixture();try{
  const card=await addSubject(f);assert.equal(document.querySelectorAll('.journal-drag-handle').length,1);
  await drop(f,card,'work');assert.equal(f.entries[0].status,'work');
  assert.equal(document.querySelector('[data-status=work] .journal-card-open').getAttribute('aria-label'),'Ouvrir Garde');
  assert.deepEqual(f.calls.at(-1),['save',{status:'work'}]);assert.match(document.querySelector('[role=status]').textContent,/En travail/);
  assert.equal(f.sortables.filter(s=>!s.destroyed).every(s=>!s.options.disabled),true);
 }finally{await f.close();}
});
test('a failed journal drag restores the original column and reports the error',async()=>{
 const f=await fixture();try{
  const card=await addSubject(f);f.api.saveJournalEntry=async()=>{throw new Error('Connexion interrompue');};
  await drop(f,card,'maintain');assert.ok(document.querySelector('[data-status=explore] .journal-card'));assert.equal(document.querySelector('[data-status=maintain] .journal-card'),null);
  assert.match(document.querySelector('.form-error').textContent,/Connexion interrompue/);
 }finally{await f.close();}
});
test('read-only access, archives and a changed athlete cannot save a drag',async()=>{
 const f=await fixture();try{
  const card=await addSubject(f);const source=f.sortables.filter(s=>!s.destroyed)[0];source.options.onStart({item:card});
  f.state.selectedAthlete={id:'a2',user_id:'athlete'};await source.options.onEnd({item:card,to:{dataset:{status:'work'}}});assert.equal(f.calls.length,1);
  f.state.selectedAthlete={id:'a1',user_id:'athlete'};f.state.user.id='coach';f.state.relation={status:'accepted',can_view_calendar:true,can_add_sessions:false};await f.ui.refresh();assert.equal(document.querySelector('.journal-drag-handle'),null);
  f.state.user.id='athlete';f.entries[0].archived=true;await f.ui.refresh();document.querySelector('[data-archive=archived]').click();assert.equal(document.querySelectorAll('.journal-card').length,1);assert.equal(document.querySelector('.journal-drag-handle'),null);
 }finally{await f.close();}
});

test('a saved drag keeps its new column if reloading the history fails',async()=>{
 const f=await fixture();try{
  const card=await addSubject(f);f.api.loadJournal=async()=>{throw new Error('Historique indisponible');};
  await drop(f,card,'maintain');assert.equal(f.entries[0].status,'maintain');assert.ok(document.querySelector('[data-status=maintain] .journal-card'));
  assert.match(document.querySelector('.form-error').textContent,/Historique indisponible/);
 }finally{await f.close();}
});

test('creating a journal subject on mobile keeps the title field unfocused until touched',async()=>{
 const f=await fixture();try {
  f.window.matchMedia=()=>({matches:true});click('＋ Sujet');
  assert.equal(document.activeElement,document.getElementById('journalTitle'));
  const title=document.querySelector('[name=journal_title]');title.focus();assert.equal(document.activeElement,title);
 }finally{await f.close();}
});

test('saving opens the subject detail before its history loads and preserves a new observation draft',async()=>{
 const f=await fixture();try{
  let resolveHistory;f.api.loadJournal=()=>new Promise(resolve=>{resolveHistory=resolve;});
  click('＋ Sujet');document.querySelector('[name=journal_title]').value='Respiration';click('Enregistrer');await tick();
  assert.equal(document.getElementById('journalTitle').textContent,'Respiration');
  assert.equal(document.querySelector('[name=journal_title]'),null);
  assert.ok(document.querySelector('[name=journal_comment]'));
  assert.match(document.querySelector('.journal-guide').textContent,/observations/);
  document.querySelector('[name=journal_comment]').value='Déjà en train de noter un conseil.';
  resolveHistory(structuredClone({entries:f.entries,updates:f.updates}));await tick();
  assert.equal(document.querySelector('[name=journal_comment]').value,'Déjà en train de noter un conseil.');
  assert.equal(document.querySelectorAll('.journal-update').length,1);
 }finally{await f.close();}
});

test('archives are one searchable list regardless of the active board view and preserve status on reactivation',async()=>{
 const f=await fixture();try{
  await addSubject(f);
  f.entries[0].status='maintain';f.entries[0].archived=true;
  f.entries.push({...f.entries[0],id:'j2',title:'Mobilité',status:'work'});
  f.updates.push({id:'u3',entry_id:'j2',kind:'comment',content:'Épaules',created_at:'2026-09-24T14:00:00Z'});
  await f.ui.refresh();click('Chronologie');click('Archives');
  assert.equal(document.querySelectorAll('.journal-archive-list').length,1);
  assert.equal(document.querySelectorAll('.journal-column').length,0);
  assert.equal(document.querySelectorAll('.journal-archive-card').length,2);
  assert.equal(document.querySelector('[aria-label="Vue du journal"]').hidden,true);
  const search=document.querySelector('[name=journal_search]');search.value='epaules';search.dispatchEvent(new f.window.Event('input'));
  assert.equal(document.querySelectorAll('.journal-archive-card').length,1);
  assert.match(document.querySelector('.journal-archive-card').textContent,/Mobilité/);
  document.querySelector('.journal-archive-card .journal-card-open').click();click('Réactiver');await tick();
  assert.equal(f.entries.find(entry=>entry.id==='j2').archived,false);
  assert.equal(f.entries.find(entry=>entry.id==='j2').status,'work');
  assert.ok(document.querySelector('[name=journal_comment]'));
 }finally{await f.close();}
});

test('permanent deletion requires explicit confirmation and sends the subject and exact history snapshot',async()=>{
 const f=await fixture();try{
  await addSubject(f);document.querySelector('.journal-card-open').click();
  click('Supprimer définitivement le sujet');
  assert.match(document.getElementById('journalContent').textContent,/ne peut pas être annulée/);
  assert.equal(f.calls.filter(call=>call[0]==='delete').length,0);
  click('Annuler');assert.equal(document.getElementById('journalTitle').textContent,'Garde');
  click('Supprimer définitivement le sujet');click('Supprimer définitivement');await tick();
  const deletion=f.calls.find(call=>call[0]==='delete');assert.equal(deletion[1].id,'j1');assert.equal(deletion[1].updated_at,'2026-09-24T12:01:00Z');assert.deepEqual(deletion[2].map(update=>update.id),['u1']);
  assert.equal(f.entries.length,0);assert.equal(f.updates.length,0);assert.equal(document.getElementById('journalDialog').open,false);
  assert.equal(document.querySelectorAll('.journal-card').length,0);
 }finally{await f.close();}
});

test('deletion conflicts keep the confirmation open and leave the subject and its follow-ups intact',async()=>{
 const f=await fixture();try{
  await addSubject(f);document.querySelector('.journal-card-open').click();click('Supprimer définitivement le sujet');
  f.api.deleteJournalEntry=async()=>{throw new Error('Un nouveau suivi a été ajouté. Rouvre le sujet.');};
  click('Supprimer définitivement');await tick();
  assert.equal(f.entries.length,1);assert.equal(f.updates.length,1);assert.equal(document.getElementById('journalDialog').open,true);
  assert.match(document.getElementById('journalContent').textContent,/nouveau suivi/);
  f.updates.push({id:'new-followup',entry_id:'j1',kind:'comment',content:'Un conseil récent',created_at:'2026-09-24T14:00:00Z'});
  click('Actualiser le sujet');await tick();
  assert.equal(document.getElementById('journalTitle').textContent,'Garde');
  assert.match(document.querySelector('.journal-history').textContent,/Un conseil récent/);
 }finally{await f.close();}
});

test('only the athlete owner or the author with current writing permission sees permanent deletion',async()=>{
 const f=await fixture();try{
  await addSubject(f);f.entries[0].created_by='original-coach';
  await f.ui.refresh();document.querySelector('.journal-card-open').click();assert.match(document.getElementById('journalContent').textContent,/Supprimer définitivement le sujet/);
  f.state.user.id='other-coach';f.state.relation={status:'accepted',can_view_calendar:true,can_add_sessions:true};await f.ui.refresh();document.querySelector('.journal-card-open').click();assert.doesNotMatch(document.getElementById('journalContent').textContent,/Supprimer définitivement/);
  f.state.user.id='original-coach';await f.ui.refresh();document.querySelector('.journal-card-open').click();assert.match(document.getElementById('journalContent').textContent,/Supprimer définitivement le sujet/);
  f.state.relation.can_add_sessions=false;await f.ui.refresh();assert.doesNotMatch(document.getElementById('journalContent').textContent,/Supprimer définitivement/);
 }finally{await f.close();}
});

test('a save from before an athlete switch cannot reopen its dialog when returning to the first athlete',async()=>{
 const f=await fixture();try{
  let resolveSave;f.api.saveJournalEntry=()=>new Promise(resolve=>{resolveSave=resolve;});
  click('＋ Sujet');document.querySelector('[name=journal_title]').value='Ancien brouillon';click('Enregistrer');
  f.state.selectedAthlete={id:'a2',user_id:'athlete'};await f.ui.refresh();
  f.state.selectedAthlete={id:'a1',user_id:'athlete'};await f.ui.refresh();
  resolveSave({id:'old',title:'Ancien brouillon',body:'',archived:false,status:'explore',created_by:'athlete',created_at:'2026-09-24T12:00:00Z',updated_at:'2026-09-24T12:01:00Z'});await tick();
  assert.equal(document.getElementById('journalDialog').open,false);assert.doesNotMatch(document.querySelector('.journal-content').textContent,/Ancien brouillon/);
 }finally{await f.close();}
});

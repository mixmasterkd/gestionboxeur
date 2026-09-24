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
 const ui=createJournalUI({getState:()=>state,api});await ui.refresh();
 return {window,state,api,ui,entries,updates,calls,close:async()=>{ui.invalidate();await window.happyDOM.abort();delete globalThis.document;delete globalThis.window;}};
}
const click=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text).click();
test('athlete creates a subject then views coach comments in both journal views without calendar notes',async()=>{
 const f=await fixture();try{
 click('＋ Sujet');document.querySelector('[name=journal_title]').value='Garde';document.querySelector('[name=journal_body]').value='<img src=x onerror=alert(1)> Observation';click('Enregistrer');await tick();
 assert.equal(f.entries.length,1);assert.equal(document.querySelector('img'),null);
 document.querySelector('[name=journal_comment]').value='Conseil';click('Ajouter au suivi');await tick();assert.equal(f.updates.length,2);
 document.querySelector('.close-button').click();click('Chronologie');assert.match(document.querySelector('.journal-content').textContent,/Conseil/);assert.equal(document.querySelectorAll('.journal-timeline-entry').length,2);
 click('Kanban');assert.equal(document.querySelectorAll('.journal-card').length,1);
 const archive=document.querySelector('[name=journal_archive]');assert.equal(archive.value,'active');
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

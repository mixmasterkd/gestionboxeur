import test from 'node:test';
import assert from 'node:assert/strict';
import {saveSession,deleteSession,loadTrainingGroups,saveTrainingGroup,deleteTrainingGroup,loadGroupCalendar,getSharedSession,getSharedEvent,saveEvent,deleteEvent} from '../js/data.js';

function database(respond=()=>({data:[],error:null})){
 const calls=[];
 return {calls,rpc(name,args){calls.push({rpc:name,args});return Promise.resolve(respond(calls.at(-1)));},from(table){
  const q={table,filters:[],orders:[]};
  const chain={select(columns){q.columns=columns;return chain;},insert(payload){q.insert=payload;return chain;},update(payload){q.update=payload;return chain;},delete(){q.delete=true;return chain;},
   eq(...args){q.filters.push(['eq',...args]);return chain;},gte(...args){q.filters.push(['gte',...args]);return chain;},lte(...args){q.filters.push(['lte',...args]);return chain;},or(value){q.filters.push(['or',value]);return chain;},
   order(column){q.orders.push(column);return chain;},range(start,end){q.range=[start,end];return chain;},single(){q.single=true;return chain;},
   then(resolve,reject){calls.push(q);return Promise.resolve(respond(q)).then(resolve,reject);}};
  return chain;
 }};
}
test('one directly selected athlete keeps an ordinary editable session in the chosen calendar',async()=>{
 const db=database(q=>({data:{id:'saved',...q.insert},error:null}));
 const saved=await saveSession({title:'Boxe',date:'2026-10-01',athlete_id:'currently-open',athlete_ids:['selected','selected'],group_ids:[]},null,db);
 assert.equal(saved.athlete_id,'selected');assert.equal(saved.athlete_ids,undefined);assert.equal(saved.group_ids,undefined);
 assert.equal(db.calls[0].table,'training_sessions');
});
test('mixed or multiple recipients use one atomic RPC and common edits preserve the loaded master version',async()=>{
 const db=database(()=>({data:{id:'master'},error:null}));
 const payload={title:'Commun',athlete_ids:['a'],group_ids:['group']};
 await saveSession(payload,null,db);assert.deepEqual(db.calls[0],{rpc:'save_shared_training_session',args:{p_payload:payload,p_id:null,p_updated_at:null}});
 await saveSession({athlete_ids:['a','b'],group_ids:[]},null,db);assert.equal(db.calls[1].rpc,'save_shared_training_session');
 await saveSession({title:'Correction'},{id:'master',shared_session_id:'master',is_group_session:true,updated_at:'version'},db);
 assert.deepEqual(db.calls[2].args,{p_payload:{title:'Correction'},p_id:'master',p_updated_at:'version'});
 await assert.rejects(()=>saveSession({date:'2026-10-02'},{id:'copy',shared_session_id:'master'},db),/commune/);
 await assert.rejects(()=>deleteSession({id:'copy',shared_session_id:'master'},db),/commune/);
 await deleteSession({id:'master',is_group_session:true,updated_at:'version'},db);
 assert.deepEqual(db.calls[3],{rpc:'delete_shared_training_session',args:{p_id:'master',p_updated_at:'version'}});
});
test('group listing paginates and membership saves match identity and version without including a supplied owner',async()=>{
 const db=database(q=>q.table?{data:q.range[0]===0?Array.from({length:500},(_,i)=>({id:String(i),name:'Groupe',training_group_members:[{athlete_id:'a'}]})):[{id:'last',training_group_members:[]}],error:null}:{data:{id:'group'},error:null});
 const groups=await loadTrainingGroups(db);assert.equal(groups.length,501);assert.deepEqual(groups[0].athlete_ids,['a']);assert.deepEqual(groups[500].athlete_ids,[]);
 await saveTrainingGroup({name:'Boxe',athlete_ids:['a','a','self'],coach_id:'forged'},{id:'g',updated_at:'loaded'},db);
 assert.deepEqual(db.calls[2].args,{p_name:'Boxe',p_athlete_ids:['a','self'],p_id:'g',p_updated_at:'loaded'});
 await deleteTrainingGroup({id:'g',updated_at:'loaded'},db);assert.deepEqual(db.calls[3].args,{p_id:'g',p_updated_at:'loaded'});
});
test('group calendar fetches only common plans for the selected group and never athlete feedback',async()=>{
 const row={id:'master',title:'Commun',shared_session_groups:[{group_id:'one'},{group_id:'two'}],shared_session_athletes:[{athlete_id:'direct'}],selected_group:[{group_id:'one'}]};
 const db=database(q=>({data:q.table==='shared_calendar_events'?[]:q.single?row:[row],error:null}));
 const calendar=await loadGroupCalendar('one','2026-10-01','2026-10-31',db);
 assert.equal(calendar.sessions[0].is_group_session,true);assert.equal(calendar.sessions[0].shared_session_id,'master');assert.equal(calendar.sessions[0].athlete_id,null);
 assert.deepEqual(calendar.sessions[0].group_ids,['one','two']);assert.deepEqual(calendar.feedback,[]);assert.deepEqual(calendar.events,[]);
 assert.deepEqual(db.calls[0].filters,[['eq','selected_group.group_id','one'],['gte','date','2026-10-01'],['lte','date','2026-10-31']]);
 assert.match(db.calls[0].columns,/selected_group:shared_session_groups!inner/);
 const master=await getSharedSession('master',db);assert.deepEqual(master.athlete_ids,['direct']);
 assert.ok(db.calls.every(q=>['shared_training_sessions','shared_calendar_events'].includes(q.table)));
});

test('notes share atomically across groups, with protected copies and ordinary private notes for one person',async()=>{
 const db=database(q=>({data:q.insert?{id:'one',...q.insert}:{id:'note'},error:null}));
 const personal=await saveEvent({title:'Perso',athlete_ids:['self','self'],group_ids:[],is_private:true},null,db);
 assert.equal(personal.athlete_id,'self');assert.equal(personal.is_private,true);assert.equal(personal.group_ids,undefined);
 await saveEvent({title:'Commun',group_ids:['g'],athlete_ids:['a'],is_private:true,is_locked:false},null,db);
 assert.equal(db.calls[1].rpc,'save_shared_calendar_event');assert.equal(db.calls[1].args.p_payload.is_private,false);assert.equal(db.calls[1].args.p_payload.is_locked,true);
 const master={id:'note',is_group_event:true,shared_event_id:'note',updated_at:'old'};
 await saveEvent({title:'Correction'},master,db);assert.equal(db.calls[2].args.p_updated_at,'old');assert.equal(db.calls[2].args.p_id,'note');
 await assert.rejects(()=>saveEvent({title:'Divergence'},{id:'copy',shared_event_id:'note'},db),/commune/);
 await assert.rejects(()=>deleteEvent({id:'copy',shared_event_id:'note'},db),/commune/);
 await deleteEvent(master,db);assert.deepEqual(db.calls[3],{rpc:'delete_shared_calendar_event',args:{p_id:'note',p_updated_at:'old'}});
});
test('group notes include ranges overlapping the calendar and keep recipient IDs only on the author master',async()=>{
 const row={id:'note',date:'2026-09-28',end_date:'2026-10-02',shared_event_groups:[{group_id:'g'}],shared_event_athletes:[{athlete_id:'a'}],selected_group:[{group_id:'g'}]};
 const db=database(q=>({data:q.table==='shared_training_sessions'?[]:q.single?row:[row],error:null}));
 const calendar=await loadGroupCalendar('g','2026-10-01','2026-10-31',db);
 assert.equal(calendar.events.length,1);assert.equal(calendar.events[0].is_group_event,true);assert.equal(calendar.events[0].shared_event_id,'note');assert.equal(calendar.events[0].athlete_id,null);
 assert.deepEqual(calendar.events[0].group_ids,['g']);assert.deepEqual(calendar.events[0].athlete_ids,['a']);
 assert.deepEqual(db.calls[1].filters,[['eq','selected_group.group_id','g'],['lte','date','2026-10-31'],['or','end_date.gte.2026-10-01,and(end_date.is.null,date.gte.2026-10-01)']]);
 assert.match(db.calls[1].columns,/selected_group:shared_event_groups!inner/);
 assert.equal((await getSharedEvent('note',db)).shared_event_id,'note');
});

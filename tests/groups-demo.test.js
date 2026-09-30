import test from 'node:test';
import assert from 'node:assert/strict';

test('local demo supports group creation, personal coach participation, common updates and preserved feedback',async()=>{
 const previousLocation=globalThis.location;globalThis.location={href:'http://localhost/planning.html?demo=coach'};
 try{
  const demo=await import('../js/demo-data.js?groups-preview');
  const own='preview-coach-athlete',athlete='preview-athlete';
  let group=await demo.saveTrainingGroup({name:'Ensemble',athlete_ids:[own]});
  const day='2099-01-01';
  let master=await demo.saveSession({title:'Partagée',date:day,athlete_ids:[own],group_ids:[group.id],blocks:[],created_by:'preview-coach'});
  let calendar=await demo.loadCalendar(own,day,day);assert.equal(calendar.sessions.length,1);
  const copy=calendar.sessions[0];assert.equal(copy.is_group_session,undefined);
  await demo.rpc('set_session_completed',{p_session_id:copy.id,p_completed:true});
  await demo.rpc('save_session_feedback',{p_session_id:copy.id,p_rpe:5,p_feeling:4,p_comment:'Mon retour'});
  master=await demo.saveSession({title:'Corrigée'},master);
  calendar=await demo.loadCalendar(own,day,day);assert.equal(calendar.sessions[0].id,copy.id);assert.equal(calendar.sessions[0].title,'Corrigée');assert.ok(calendar.sessions[0].completed_at);assert.equal(calendar.feedback[0].comment,'Mon retour');
  group=await demo.saveTrainingGroup({name:group.name,athlete_ids:[own,athlete]},group);
  assert.equal((await demo.loadCalendar(athlete,day,day)).sessions.length,1);
  assert.equal((await demo.loadGroupCalendar(group.id,day,day)).sessions.length,1);
  await demo.deleteTrainingGroup(group);
  assert.equal((await demo.loadCalendar(athlete,day,day)).sessions.length,0);
  assert.equal((await demo.loadCalendar(own,day,day)).sessions.length,1);
  await demo.deleteSession(master);calendar=await demo.loadCalendar(own,day,day);assert.equal(calendar.sessions[0].shared_session_id,null);assert.equal(calendar.feedback[0].comment,'Mon retour');
  const single=await demo.saveSession({title:'Individuelle',date:day,athlete_id:athlete,athlete_ids:[own],group_ids:[],created_by:'preview-coach'});
  assert.equal(single.athlete_id,own);assert.equal(single.is_group_session,undefined);
 }finally{globalThis.location=previousLocation;}
});

test('demo group notes synchronize recipients and ranges while keeping history and private personal notes',async()=>{
 const previousLocation=globalThis.location;globalThis.location={href:'http://localhost/planning.html?demo=coach'};
 try{
  const demo=await import('../js/demo-data.js?group-notes-preview');
  const own='preview-coach-athlete',athlete='preview-athlete',future='2099-01-01',past='2000-01-01';
  let group=await demo.saveTrainingGroup({name:'Notes groupe',athlete_ids:[own]});
  let note=await demo.saveEvent({title:'Consignes',date:future,group_ids:[group.id],athlete_ids:[own],is_private:true,is_locked:false});
  assert.equal(note.is_private,false);assert.equal(note.is_locked,true);
  let calendar=await demo.loadCalendar(own,future,future);assert.equal(calendar.events.length,1);
  const copy=calendar.events[0];assert.equal(copy.is_group_event,undefined);
  await assert.rejects(()=>demo.saveEvent({title:'Copie'},copy),/commune/);await assert.rejects(()=>demo.deleteEvent(copy),/commune/);
  note=await demo.saveEvent({title:'Corrigées'},note);assert.equal((await demo.loadCalendar(own,future,future)).events[0].id,copy.id);
  const historical=await demo.saveEvent({title:'Passé',date:past,group_ids:[group.id],athlete_ids:[]});
  const ongoing=await demo.saveEvent({title:'Stage',date:past,end_date:future,group_ids:[group.id],athlete_ids:[]});
  group=await demo.saveTrainingGroup({name:group.name,athlete_ids:[own,athlete]},group);
  assert.deepEqual((await demo.loadCalendar(athlete,future,future)).events.map(e=>e.title).sort(),['Corrigées','Stage']);
  assert.equal((await demo.loadCalendar(athlete,past,past)).events.some(e=>e.title==='Passé'),false);
  assert.equal((await demo.loadGroupCalendar(group.id,future,future)).events.length,2);
  await demo.deleteTrainingGroup(group);
  assert.deepEqual((await demo.loadCalendar(athlete,future,future)).events.map(e=>e.title),['Stage']);
  assert.equal((await demo.loadCalendar(own,future,future)).events.length,2);
  await demo.deleteEvent(historical);assert.equal((await demo.loadCalendar(own,past,past)).events.find(e=>e.title==='Passé').shared_event_id,null);
  await demo.deleteEvent(ongoing);assert.equal((await demo.loadCalendar(athlete,past,past)).events.find(e=>e.title==='Stage').shared_event_id,null);
  const personal=await demo.saveEvent({title:'Privée',date:future,athlete_ids:[own],group_ids:[],created_by:'preview-coach',is_private:true});
  assert.equal(personal.is_private,true);assert.equal(personal.athlete_id,own);assert.equal(personal.is_group_event,undefined);
 }finally{globalThis.location=previousLocation;}
});

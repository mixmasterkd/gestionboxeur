import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import * as domain from '../js/domain.js';
import * as calendar from '../js/calendar.js';
import * as ui from '../js/ui.js';
import {createJournalUI} from '../js/journal.js';
import {applyEventColor} from '../js/event-colors.js';
import {renderSessionChart} from '../js/session-chart.js';

const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();await new Promise(r=>setImmediate(r));};
const makeSession=(id,created_by='coach',date=domain.todayLocal(),order=1024)=>({id,athlete_id:'athlete',created_by,author_name:'Camille',title:`Séance ${id}`,sport:'running',date,sort_order:order,updated_at:'2026-09-21T12:00:00Z',blocks:[{...domain.makeBlock('run'),duration_seconds:600,zone:2}]});
async function surface({role='coach',sessions=[],events=[],feedback=[],url='https://example.test/gestionboxeur/planning.html',invitationError=null,planningAvailable=true,userId=role==='coach'?'coach':'athlete-user',storage={},storageFailure=false}={}) {
  const window=new Window({url,settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
  for(const [key,value] of Object.entries(storage))window.localStorage.setItem(key,value);
  if(storageFailure)Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new Error('Storage inaccessible');}});
  window.document.write(await readFile(new URL('../planning.html',import.meta.url),'utf8'));
  const original={document:globalThis.document,window:globalThis.window};globalThis.document=window.document;globalThis.window=window;
  const calls=[],instances=[],controls={};
  const athlete={id:'athlete',first_name:'Martin',last_name:'',user_id:role==='athlete'?userId:'athlete-user'};
  const relation={athlete_id:'athlete',coach_id:role==='coach'?userId:'coach',status:'accepted',can_view_calendar:true,can_add_sessions:true,can_edit_own_sessions:true,can_view_feedback:true};
  const account={planningAvailable,gym:role==='coach'?{gym_name:'Club de boxe du quartier',address:'125, rue du Ring'}:null,profile:{id:userId,account_type:role,full_name:role==='coach'?'Camille':'Martin',is_admin:false},coach:role==='coach'?{user_id:userId,join_code:'secret-code'}:null,relations:role==='coach'?[relation]:[],athletes:[athlete]};
  const source={sessions,events,feedback};let authCallback;
  const api={client:{auth:{getSession:async()=>({data:{session:{user:{id:account.profile.id,email:'user@example.test'}}}}),onAuthStateChange:fn=>{authCallback=fn;},signOut:async()=>{authCallback('SIGNED_OUT');return {};}}},
    loadAccount:async()=>controls.account?controls.account():structuredClone(account),loadCalendar:async(...args)=>{calls.push(['load',...args]);if(controls.calendar)return controls.calendar(...args);const [athleteId,start,end]=args;return structuredClone({...source,sessions:source.sessions.filter(session=>session.athlete_id===athleteId&&session.date>=start&&session.date<=end),events:source.events.filter(event=>event.date<=end&&(event.end_date||event.date)>=start)});},
    rpc:async(name,args)=>{calls.push([name,args]);if(invitationError)throw new Error(invitationError);return 'athlete';},
    saveSession:async(...args)=>{calls.push(['save',...args]);return args[0];}};
  const methods={editSession:(...args)=>calls.push(['edit',...args]),showSession:s=>calls.push(['show',s]),editEvent:(...args)=>calls.push(['event',...args]),showEvent:e=>calls.push(['showEvent',e]),setCompleted:async(s,completed)=>{calls.push(['complete',s.id,completed]);source.sessions.find(item=>item.id===s.id).completed_at=completed?'2026-09-22T12:00:00Z':null;await window.__app.refreshCalendar();}};
  window.__bridge={createJournalUI,api,domain,calendar,renderSessionChart,applyEventColor,ui:{...ui,toast:m=>calls.push(['toast',m])},
    Sortable:class {constructor(node,options){this.node=node;this.options=options;instances.push(this);}destroy(){}},
    createSessionUI:()=>methods,createConnectionsUI:()=>({open:()=>{},inviteAthlete:()=>{}}),createLibraryUI:options=>({open:()=>{},options})};
  const code=await readFile(new URL('../js/app.js',import.meta.url),'utf8');
  window.eval(`const mountNavigation=()=>{};const {createJournalUI,Sortable,createSessionUI,createConnectionsUI,createLibraryUI,renderSessionChart,applyEventColor}=window.__bridge;
    const dataApi=window.__bridge.api;
    const {client,loadAccount,loadCalendar,rpc,saveSession}=dataApi;
    const {SPORTS,summarizeBlocks,formatDuration}=window.__bridge.domain;
    const {todayLocal,datesForView,shiftPeriod,orderedSessions,positionBetween,eventOnDate,dateLabel,periodLabel}=window.__bridge.calendar;
    const {$,el,button,displayName,initials,toast,showError}=window.__bridge.ui;
    ${code.replace(/^import .*;\n/gm,'')}
    window.__app={state,refreshAccount,refreshCalendar,canEdit,canAdd,handleDrop,libraryUI};`);
  await settle();
  return {window,$:id=>window.document.getElementById(id),app:window.__app,api,account,source,calls,instances,controls,emit:authCallback,
    close:async()=>{await window.happyDOM.abort();if(original.document===undefined)delete globalThis.document;else globalThis.document=original.document;if(original.window===undefined)delete globalThis.window;else globalThis.window=original.window;}};
}

test('coach calendar renders seven days, own handles, known totals and personal events',async()=>{
  const a=makeSession('a'),b=makeSession('b','other-coach',a.date,2048);
  b.completed_at='2026-09-21T20:00:00Z';
  const page=await surface({sessions:[a,b],events:[{id:'exam',date:a.date,title:'Examen <script>bad</script>',category:'exam'}],feedback:[{session_id:'b',rpe:8,feeling:2,comment:'Fatigue'}]});
  try{
    assert.equal(page.$('workspace').hidden,false);assert.equal(page.$('athleteTitle').textContent,'Martin');
    assert.equal(page.$('calendar').querySelectorAll('.day').length,7);
    assert.equal(page.$('calendar').querySelectorAll('.drag-handle').length,1);
    assert.equal(page.$('sessionTotal').textContent,'2');assert.equal(page.$('durationTotal').textContent,'20 min');
    assert.equal(page.$('calendar').querySelectorAll('.event-card').length,1);
    assert.equal(page.$('calendar').querySelectorAll('script').length,0);
    assert.match(page.$('calendar').textContent,/RPE 8\/10/);
    assert.equal(page.app.canEdit(b),false);assert.equal(page.app.canEdit(a),true);
    page.$('calendar').querySelector('.session-title').click();assert.equal(page.calls.at(-1)[0],'show');
  }finally{await page.close();}
});

test('athlete starts with today, can add workouts and context but cannot drag locked coach sessions',async()=>{
  const page=await surface({role:'athlete',sessions:[makeSession('a')]});
  try{
    assert.equal(page.app.state.view,'today');assert.equal(page.$('athleteSidebar').hidden,true);
    assert.equal(page.$('rosterLink').hidden,true);assert.equal(page.$('addSessionButton').hidden,false);
    assert.equal(page.$('addEventButton').hidden,false);assert.equal(page.$('calendar').querySelectorAll('.day').length,1);
    assert.equal(page.$('calendar').querySelectorAll('.drag-handle').length,0);
    assert.equal(page.app.canAdd(),true);assert.equal(page.app.canEdit(makeSession('a')),false);
  }finally{await page.close();}
});

test('unlocked sessions can be moved by the athlete or linked coach, but foreign calendars and free sheets stay inaccessible',async()=>{
  for(const role of ['athlete','coach']) {
    const shared={...makeSession('shared','other-coach'),is_locked:false};
    const page=await surface({role,sessions:[shared]});
    try {
      assert.equal(page.app.canEdit(shared),true);
      assert.equal(page.app.canEdit({...shared,is_locked:true}),false);
      assert.equal(page.app.canEdit({...shared,athlete_id:'someone-else'}),false);
      assert.equal(page.$('calendar').querySelectorAll('.drag-handle').length,1);
      if(role==='coach') {
        page.app.state.relation.can_edit_own_sessions=false;
        assert.equal(page.app.canEdit(shared),false);
        page.app.state.relation.can_edit_own_sessions=true;
        page.app.state.selectedAthlete.user_id=null;
        assert.equal(page.app.canAdd(),false);assert.equal(page.app.canEdit(shared),false);
        page.account.athletes[0].user_id=null;
        await page.app.refreshAccount();
        assert.equal(page.app.state.selectedAthlete,null);
        assert.match(page.$('athleteList').textContent,/fiches sans compte.*Mes athlètes/);
        assert.equal(page.$('athleteList').querySelector('a').href,'https://example.test/gestionboxeur/roster.html');
      }
    }finally{await page.close();}
  }
});

test('linked athletes remain selectable without calendar permission and no protected content is fetched or retained',async()=>{
  const page=await surface({sessions:[makeSession('private')],feedback:[{session_id:'private',rpe:7,comment:'Privé'}]});
  try {
    assert.ok(page.$('calendar').querySelector('.session-card'));
    page.account.relations[0].can_view_calendar=false;
    await page.app.refreshAccount();page.calls.length=0;
    await page.app.refreshCalendar();
    assert.equal(page.app.state.selectedAthlete.id,'athlete');
    assert.match(page.$('athleteList').textContent,/Martin.*Accès calendrier non autorisé/);
    assert.match(page.$('calendarStatus').textContent,/autorisé par l’athlète/);
    assert.equal(page.calls.some(call=>call[0]==='load'),false);
    assert.equal(page.app.state.sessions.length,0);assert.equal(page.app.state.feedback.length,0);
    assert.equal(page.$('calendar').children.length,0);
    assert.equal(page.$('addSessionButton').hidden,true);assert.equal(page.$('addEventButton').hidden,true);
    assert.equal(page.app.canEdit(makeSession('private')),false);assert.equal(page.app.canAdd(),false);
  } finally { await page.close(); }
});

test('an out-of-order calendar response cannot overwrite the newly selected period',async()=>{
  const page=await surface();
  try{
    let resolveOld,resolveNew;
    page.controls.calendar=()=>new Promise(resolve=>{if(!resolveOld)resolveOld=resolve;else resolveNew=resolve;});
    const old=page.app.refreshCalendar();
    page.app.state.anchor=domain.addDays(page.app.state.anchor,7);
    const latest=page.app.refreshCalendar();
    resolveNew({sessions:[makeSession('new','coach',page.app.state.anchor)],events:[],feedback:[]});await latest;
    resolveOld({sessions:[makeSession('old')],events:[],feedback:[]});await old;
    assert.equal(page.$('calendar').querySelectorAll('[data-session-id="new"]').length,1);
    assert.equal(page.$('calendar').querySelectorAll('[data-session-id="old"]').length,0);
    page.controls.calendar=null;
    page.app.state.selectedAthlete=null;
    page.$('sessionTotal').textContent='99';page.$('calendar').setAttribute('aria-busy','true');
    await page.app.refreshCalendar();
    assert.equal(page.$('sessionTotal').textContent,'0');assert.equal(page.$('calendar').hasAttribute('aria-busy'),false);
    assert.equal(page.$('calendar').children.length,0);
  }finally{await page.close();}
});

test('an old account refresh cannot restore stale permissions or coach labels',async()=>{
  const page=await surface();
  try{
    let resolveOld,resolveNew;
    page.controls.account=()=>new Promise(resolve=>{if(!resolveOld)resolveOld=resolve;else resolveNew=resolve;});
    const old=page.app.refreshAccount(),latest=page.app.refreshAccount();
    const current=structuredClone(page.account);current.profile.full_name='Actuel';current.relations[0].can_add_sessions=false;
    resolveNew(current);await latest;
    const stale=structuredClone(page.account);stale.profile.full_name='Ancien';resolveOld(stale);await old;
    assert.equal(page.$('accountName').textContent,'Actuel');assert.equal(page.app.canAdd(),false);
  }finally{await page.close();}
});

test('calendar reload displays a retry and propagates failures when a mutation requires a fresh version',async()=>{
  const page=await surface({sessions:[makeSession('a')]});
  try{
    page.controls.calendar=async()=>{throw new Error('Connexion interrompue');};
    await assert.rejects(page.app.refreshCalendar({throwOnError:true}),/Connexion interrompue/);
    assert.match(page.$('calendarStatus').textContent,/Connexion interrompue.*Réessayer/);
    assert.equal(page.$('calendar').hasAttribute('aria-busy'),false);
    assert.equal(page.app.state.sessions.length,0);
    await page.app.refreshCalendar();
    page.controls.calendar=null;page.$('calendarStatus').querySelector('button').click();await settle();
    assert.ok(page.$('calendar').querySelector('[data-session-id="a"]'));
  }finally{await page.close();}
});

test('dragging updates only the chosen author session with fractional order',async()=>{
  const a=makeSession('a'),b=makeSession('b','other-coach',a.date,2048),c=makeSession('c','other-coach',a.date,4096);
  const page=await surface({sessions:[a,b,c]});
  try{
    const list=page.$('calendar').querySelector(`[data-date="${a.date}"] .day-content`);
    const card=list.querySelector('[data-session-id="a"]');list.insertBefore(card,list.querySelector('[data-session-id="c"]'));
    await page.app.handleDrop({from:list,to:list,item:card,oldDraggableIndex:0,newDraggableIndex:1});
    const save=page.calls.find(c=>c[0]==='save');assert.equal(save[2].id,'a');assert.deepEqual(Object.keys(save[1]).sort(),['date','sort_order']);assert.equal(save[1].sort_order,3072);
    assert.equal(page.calls.filter(c=>c[0]==='save').length,1);
  }finally{await page.close();}
});

test('month totals exclude visible neighboring-month sessions',async()=>{
  const page=await surface({sessions:[makeSession('a','coach','2026-09-30'),makeSession('b','coach','2026-10-01')]});
  try{
    page.app.state.view='month';page.app.state.anchor='2026-09-21';await page.app.refreshCalendar();
    assert.equal(page.$('calendar').querySelectorAll('.day').length,42);assert.equal(page.$('sessionTotal').textContent,'1');assert.equal(page.$('durationTotal').textContent,'10 min');
  }finally{await page.close();}
});

test('successful invitation consumes token and strips URL; errors preserve it for correct account',async()=>{
  let page=await surface({role:'athlete',url:'https://example.test/gestionboxeur/?invite=abc'});
  try{assert.equal(page.window.sessionStorage.getItem('pendingInvite'),null);assert.equal(new URL(page.window.location.href).searchParams.has('invite'),false);assert.equal(page.calls[0][0],'accept_invitation');}finally{await page.close();}
  page=await surface({url:'https://example.test/gestionboxeur/?invite=abc',invitationError:'Connecte-toi avec un compte athlète.'});
  try{assert.equal(page.window.sessionStorage.getItem('pendingInvite'),'abc');assert.match(page.$('connectionBanner').textContent,/compte athlète/);}finally{await page.close();}
});

test('historical schema keeps gym identity and access to lists while blocking inactive planning actions',async()=>{
  const page=await surface({planningAvailable:false});
  try{
    assert.equal(page.$('gymBrand').textContent,'Club de boxe du quartier');
    assert.equal(page.$('gymAddress').textContent,'125, rue du Ring');
    assert.equal(page.$('planningUnavailable').hidden,false);
    assert.equal(page.$('workspace').hidden,true);
    assert.equal(page.$('rosterLink').hidden,false);
    assert.equal(page.$('connectionsButton').hidden,true);
    assert.equal(page.$('libraryButton').hidden,true);
    assert.equal(page.calls.some(call=>call[0]==='load'),false);
    assert.equal(page.app.canAdd(),false);
    assert.equal(page.$('planningUnavailable').querySelector('a').href,'https://example.test/gestionboxeur/roster.html');
    await page.api.client.auth.signOut();
    assert.equal(page.$('gymAddress').textContent,'');
    assert.equal(page.$('gymBrand').textContent,'Mon espace');
    assert.equal(page.$('accountName').textContent,'');
  }finally{await page.close();}
});

test('an athlete account shows its own calendar context without a coach gym address',async()=>{
  const page=await surface({role:'athlete'});
  try{
    assert.equal(page.$('gymBrand').textContent,'Mon entraînement');
    assert.equal(page.$('gymAddress').textContent,'');
    assert.equal(page.$('gymAddress').hidden,true);
    assert.match(page.$('gymHome').href,/\/planning\.html$/);
    assert.equal(page.$('athleteTitle').textContent,'Mon calendrier');
  }finally{await page.close();}
});

test('athlete completion control marks a locked session and coach sees status independently of feedback permission',async()=>{
  const session={...makeSession('done'),is_locked:true,completed_at:null};
  const page=await surface({role:'athlete',sessions:[session]});
  try {
    page.$('calendar').querySelector('.completion-button').click();await settle();
    assert.ok(page.calls.some(call=>call[0]==='complete'&&call[1]==='done'&&call[2]===true));
    assert.equal(page.$('calendar').querySelector('.completion-button').getAttribute('aria-pressed'),'true');
    assert.ok(page.$('calendar').querySelector('.session-card.is-completed'));
  }finally{await page.close();}
  const coach=await surface({sessions:[{...session,completed_at:'2026-09-22T12:00:00Z'}],feedback:[{session_id:'done',rpe:9,feeling:2,comment:'Privé'}]});
  try{
    coach.app.state.relation.can_view_feedback=false;await coach.app.refreshCalendar();
    assert.equal(coach.$('calendar').querySelector('.completion-button'),null);
    assert.match(coach.$('calendar').querySelector('.completion-pill').textContent,/Faite/);
    assert.equal(coach.$('calendar').querySelector('.feedback-pill'),null);
  }finally{await coach.close();}
});

test('calendar view persists per account and preview environment without restoring an old date',async()=>{
  const key='gestionboxeur:calendar-view:v1:connected:coach';
  let page=await surface({storage:{[key]:'month'}});
  let saved;
  try{
    assert.equal(page.app.state.view,'month');assert.equal(page.app.state.anchor,domain.todayLocal());
    assert.equal(page.$('todayViewButton').hidden,false);
    page.app.state.anchor='2020-01-01';page.$('todayViewButton').click();await settle();
    assert.equal(page.app.state.view,'today');assert.equal(page.window.localStorage.getItem(key),'today');
    saved=page.window.localStorage.getItem(key);
  }finally{await page.close();}
  page=await surface({storage:{[key]:saved}});
  try{assert.equal(page.app.state.view,'today');assert.equal(page.app.state.anchor,domain.todayLocal());}finally{await page.close();}
  page=await surface({userId:'another-coach',storage:{[key]:'month'}});
  try{assert.equal(page.app.state.view,'week');}finally{await page.close();}
  page=await surface({url:'https://example.test/gestionboxeur/planning.html?demo=coach',storage:{[key]:'month','gestionboxeur:calendar-view:v1:demo-coach:coach':'today'}});
  try{assert.equal(page.app.state.view,'today');page.$('viewButtons').querySelector('[data-view="week"]').click();await settle();assert.equal(page.window.localStorage.getItem(key),'month');assert.equal(page.window.localStorage.getItem('gestionboxeur:calendar-view:v1:demo-coach:coach'),'week');}finally{await page.close();}
});

test('invalid or blocked local storage does not prevent calendar navigation',async()=>{
  for(const options of [{storage:{'gestionboxeur:calendar-view:v1:connected:athlete-user':'corrupted'}},{storageFailure:true}]){
    const page=await surface({role:'athlete',...options});
    try{
      assert.equal(page.app.state.view,'today');
      page.$('viewButtons').querySelector('[data-view="month"]').click();await settle();
      assert.equal(page.app.state.view,'month');assert.equal(page.$('calendar').querySelectorAll('.day').length,42);
    }finally{await page.close();}
  }
});

test('weekly running minutes are independent of day and month and reuse covering ranges',async()=>{
  const run=(id,date,seconds,distance=0)=>({...makeSession(id,'coach',date),blocks:[{...domain.makeBlock('run'),duration_seconds:seconds,distance_m:distance||null,zone:2}]});
  const sessions=[run('monday','2026-09-28',3600,10000),run('saturday','2026-10-03',1800,5000),run('next-week','2026-10-06',7200),{...run('box','2026-09-29',900),sport:'boxing'}];
  const page=await surface({sessions});
  try{
    page.app.state.anchor='2026-09-30';page.app.state.view='today';page.calls.length=0;await page.app.refreshCalendar();
    assert.equal(page.$('sessionTotal').textContent,'0');assert.equal(page.$('runningTotal').textContent,'90 min');assert.equal(page.$('distanceTotal').textContent,'15 km renseignés');
    assert.deepEqual(page.calls.filter(call=>call[0]==='load').map(call=>call.slice(2)),[['2026-09-30','2026-09-30'],['2026-09-28','2026-10-04']]);
    page.app.state.view='week';page.calls.length=0;await page.app.refreshCalendar();
    assert.equal(page.$('runningTotal').textContent,'90 min');assert.equal(page.$('durationTotal').textContent,'1 h 45 min');assert.equal(page.calls.filter(call=>call[0]==='load').length,1);
    page.app.state.view='month';page.calls.length=0;await page.app.refreshCalendar();
    assert.equal(page.$('runningTotal').textContent,'90 min');assert.equal(page.$('durationTotal').textContent,'1 h 15 min');assert.equal(page.$('sessionTotal').textContent,'2');assert.equal(page.calls.filter(call=>call[0]==='load').length,1);
    assert.match(page.$('runningWeekRange').textContent,/28.*4/);
  }finally{await page.close();}
});

test('weekly course never estimates time from distance and reports missing portions',async()=>{
  const day=domain.todayLocal();
  const sessions=[{...makeSession('distance','coach',day),blocks:[{...domain.makeBlock('run'),distance_m:5000}]},{...makeSession('timed','coach',day),blocks:[{...domain.makeBlock('run'),duration_seconds:90}]}];
  const page=await surface({sessions});
  try{
    assert.equal(page.$('runningTotal').textContent,'1,5 min');assert.match(page.$('runningWeekHint').textContent,/partielle/);assert.equal(page.$('distanceTotal').textContent,'5 km renseignés');
    page.source.sessions.splice(1,1);await page.app.refreshCalendar();
    assert.equal(page.$('runningTotal').textContent,'—');assert.match(page.$('runningWeekHint').textContent,/aucune estimation/);
    page.source.sessions.length=0;await page.app.refreshCalendar();assert.equal(page.$('runningTotal').textContent,'0 min');assert.equal(page.$('distanceTotal').hidden,true);
  }finally{await page.close();}
});

test('a stale weekly response cannot replace a newer day and weekly totals',async()=>{
  const page=await surface({role:'athlete'});
  try{
    const pending=[];
    page.controls.calendar=(...args)=>new Promise(resolve=>pending.push({args,resolve}));
    const old=page.app.refreshCalendar();
    page.app.state.anchor=domain.addDays(page.app.state.anchor,7);const newDate=page.app.state.anchor;
    const latest=page.app.refreshCalendar();
    assert.equal(pending.length,4);
    const newer={sessions:[{...makeSession('new','coach',newDate),blocks:[{...domain.makeBlock('run'),duration_seconds:1200}]}],events:[],feedback:[]};
    pending[2].resolve(newer);pending[3].resolve(newer);await latest;
    const older={sessions:[makeSession('old')],events:[],feedback:[]};pending[0].resolve(older);pending[1].resolve(older);await old;
    assert.equal(page.$('runningTotal').textContent,'20 min');assert.ok(page.$('calendar').querySelector('[data-session-id="new"]'));assert.equal(page.$('calendar').querySelector('[data-session-id="old"]'),null);
  }finally{await page.close();}
});

test('failed weekly supplement preserves the usable day but never shows a false weekly zero',async()=>{
  const session=makeSession('today');const page=await surface({role:'athlete',sessions:[session]});
  try{
    page.controls.calendar=async(_id,start,end)=>{if(start!==end)throw new Error('Indisponible');return {sessions:[session],events:[],feedback:[]};};
    await page.app.refreshCalendar();
    assert.ok(page.$('calendar').querySelector('[data-session-id="today"]'));assert.equal(page.$('runningTotal').textContent,'—');assert.match(page.$('runningWeekHint').textContent,/indisponible/);
  }finally{await page.close();}
});

test('running and boxing calendar tiles contain accessible miniature charts',async()=>{
  const running=makeSession('run'),boxing={...makeSession('box'),sport:'boxing',blocks:[{...domain.makeBlock('bag'),rounds:3,work_seconds:180,rest_seconds:60}]};
  const page=await surface({sessions:[running,boxing]});
  try{
    const runChart=page.$('calendar').querySelector('[data-session-id="run"] .session-chart');
    const boxChart=page.$('calendar').querySelector('[data-session-id="box"] .session-chart');
    assert.match(runChart.querySelector('svg').getAttribute('aria-label'),/zone cible/);assert.equal(boxChart.querySelectorAll('rect').length,5);
    assert.match(boxChart.querySelector('svg').getAttribute('aria-label'),/effort demandé/);
  }finally{await page.close();}
});


test('coach switches between personal and coached calendars with independent permissions',async()=>{
 const page=await surface();
 try{
   const own={id:'personal',user_id:page.account.profile.id,first_name:'Coach'};
   page.account.athletes.push(own);page.app.state.selectedAthlete=null;
   await page.app.refreshAccount();await page.app.refreshCalendar();
   assert.equal(page.app.state.selectedAthlete.id,'personal');assert.equal(page.app.canAdd(),true);
   assert.equal(page.$('athleteTitle').textContent,'Mon calendrier');
   const personal={...makeSession('personal-session',page.account.profile.id),athlete_id:'personal'};
   assert.equal(page.app.canEdit(personal),true);
   assert.equal(page.app.canEdit(makeSession('foreign')),false);
   assert.match(page.$('athleteList').textContent,/Mon calendrier/);
   page.$('athleteList').querySelectorAll('button')[1].click();await settle();
   assert.equal(page.app.state.selectedAthlete.id,'athlete');assert.equal(page.app.canEdit(personal),false);
 }finally{await page.close();}
});

test('thirty calendars stay behind a searchable picker and selection preserves the period',async()=>{
  const page=await surface();
  try {
    page.account.athletes=Array.from({length:30},(_,i)=>({id:`athlete-${i}`,user_id:`user-${i}`,first_name:i===29?'Émile':'Boxeur',last_name:String(i)}));
    page.account.relations=page.account.athletes.map(a=>({...page.account.relations[0],athlete_id:a.id}));
    await page.app.refreshAccount();
    const anchor=page.app.state.anchor,view=page.app.state.view;
    assert.equal(page.$('athletePickerDialog').open,false);
    assert.equal(page.$('athleteList').closest('dialog').id,'athletePickerDialog');
    assert.equal(page.$('athleteList').querySelectorAll('button').length,30);
    page.$('athletePickerButton').click();await settle();
    assert.equal(page.$('athletePickerDialog').open,true);
    assert.equal(page.window.document.activeElement.id,'athleteSearch');
    page.$('athleteSearch').value='emile';page.$('athleteSearch').dispatchEvent(new page.window.Event('input'));
    assert.equal(page.$('athleteList').querySelectorAll('button').length,1);
    page.$('athleteList').querySelector('button').click();await settle();
    assert.equal(page.app.state.selectedAthlete.id,'athlete-29');
    assert.equal(page.$('athletePickerDialog').open,false);
    assert.equal(page.app.state.anchor,anchor);assert.equal(page.app.state.view,view);
    assert.equal(page.window.document.activeElement.id,'athletePickerButton');
    page.$('athletePickerButton').click();await settle();
    assert.equal(page.$('athleteList').querySelectorAll('button').length,30);
  } finally { await page.close(); }
});

test('monthly tiles open details and reserve quick completion for week and day views',async()=>{
  const page=await surface({role:'athlete',sessions:[{...makeSession('quick'),is_locked:true}]});
  try {
    page.app.state.view='month';await page.app.refreshCalendar();
    assert.equal(page.$('calendar').querySelector('.completion-button'),null);
    page.app.state.view='week';await page.app.refreshCalendar();
    let toggle=page.$('calendar').querySelector('.session-card-footer .completion-button');
    assert.ok(toggle);toggle.click();await settle();
    assert.equal(page.$('calendar').querySelector('.completion-button').getAttribute('aria-pressed'),'true');
    page.app.state.view='month';await page.app.refreshCalendar();
    assert.equal(page.$('calendar').querySelector('.completion-button'),null);
    assert.match(page.$('calendar').querySelector('.session-title').getAttribute('aria-label'),/Faite/);
    assert.equal(page.calls.filter(c=>c[0]==='show').length,0);
    page.$('calendar').querySelector('.session-title').click();
    assert.equal(page.calls.filter(c=>c[0]==='show').length,1);
  } finally { await page.close(); }
});

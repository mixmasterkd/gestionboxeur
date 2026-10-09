import {mountCalendarMenu} from '../js/calendar-menu.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import * as domain from '../js/domain.js';
import * as calendar from '../js/calendar.js';
import * as ui from '../js/ui.js';
import {createJournalUI} from '../js/journal.js';
import {applyEventColor} from '../js/event-colors.js';
import {accessIcon} from '../js/access-icons.js';
import {renderSessionChart} from '../js/session-chart.js';
import * as monthPreviews from '../js/month-previews.js';
import {mountSessionTimer} from '../js/session-timer.js';

const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();await new Promise(r=>setImmediate(r));};
const makeSession=(id,created_by='coach',date=domain.todayLocal(),order=1024)=>({id,athlete_id:'athlete',created_by,author_name:'Camille',title:`Séance ${id}`,sport:'running',date,sort_order:order,updated_at:'2026-09-21T12:00:00Z',blocks:[{...domain.makeBlock('run'),duration_seconds:600,zone:2}]});
async function surface({role='coach',sessions=[],events=[],feedback=[],url='https://example.test/gestionboxeur/planning.html',invitationError=null,planningAvailable=true,userId=role==='coach'?'coach':'athlete-user',storage={},storageFailure=false,groups=[]}={}) {
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
    loadTrainingGroups:async()=>{if(controls.groups)return controls.groups();return structuredClone(groups);},
    loadGroupCalendar:async(...args)=>{calls.push(['loadGroup',...args]);if(controls.groupCalendar)return controls.groupCalendar(...args);const [id,start,end]=args;return {sessions:source.sessions.filter(s=>s.is_group_session&&s.group_ids?.includes(id)&&s.date>=start&&s.date<=end),events:source.events.filter(e=>e.is_group_event&&e.group_ids?.includes(id)&&e.date<=end&&(e.end_date||e.date)>=start),feedback:[]};},
    rpc:async(name,args)=>{calls.push([name,args]);if(invitationError)throw new Error(invitationError);return 'athlete';},
    saveSession:async(...args)=>{calls.push(['save',...args]);return args[0];},
    saveEvent:async(payload,existing)=>{calls.push(['saveEvent',payload,existing]);if(controls.saveEvent)return controls.saveEvent(payload,existing);const index=source.events.findIndex(item=>item.id===existing.id);source.events[index]={...source.events[index],...payload,updated_at:'saved-event'};return structuredClone(source.events[index]);}};
  const methods={editSession:(...args)=>calls.push(['edit',...args]),showSession:s=>calls.push(['show',s]),editEvent:(...args)=>calls.push(['event',...args]),showEvent:e=>calls.push(['showEvent',e]),setCompleted:async(s,completed)=>{calls.push(['complete',s.id,completed]);source.sessions.find(item=>item.id===s.id).completed_at=completed?'2026-09-22T12:00:00Z':null;await window.__app.refreshCalendar();}};
  window.__bridge={mountCalendarMenu,loadSessionTimer:()=>controls.loadSessionTimer?controls.loadSessionTimer():Promise.resolve({mountSessionTimer}),monthPreviews,createJournalUI,api,domain,calendar,renderSessionChart,applyEventColor,accessIcon,ui:{...ui,toast:m=>calls.push(['toast',m])},
    Sortable:class {constructor(node,options){this.node=node;this.options=options;instances.push(this);}destroy(){}},
    createSessionUI:()=>methods,createConnectionsUI:()=>({open:options=>calls.push(['connections',options]),inviteAthlete:()=>{}}),createLibraryUI:options=>({open:config=>calls.push(['library',config]),options})};
  const code=await readFile(new URL('../js/app.js',import.meta.url),'utf8');
  window.eval(`const mountNavigation=()=>{};const {mountCalendarMenu,createJournalUI,Sortable,createSessionUI,createConnectionsUI,createLibraryUI,renderSessionChart,applyEventColor,accessIcon}=window.__bridge;
    const {chooseMonthPreviews,monthSessionPreview,monthNotePreview}=window.__bridge.monthPreviews;
    const dataApi=window.__bridge.api;
    const {client,loadAccount,loadCalendar,rpc,saveSession}=dataApi;
    const {SPORTS,summarizeBlocks,formatDuration}=window.__bridge.domain;
    const {todayLocal,datesForView,shiftPeriod,orderedSessions,positionBetween,eventOnDate,dateLabel,periodLabel,orderedEvents,eventSpans,moveEventDates}=window.__bridge.calendar;
    const {$,el,button,displayName,initials,toast,showError,openDialog,confirmAction}=window.__bridge.ui;
    ${code.replace(/^import .*;\n/gm,'').replace("import('./session-timer.js')",'window.__bridge.loadSessionTimer()')}
    window.__app={state,refreshAccount,refreshCalendar,canEdit,canAdd,handleDrop,handleEventDrop,libraryUI};`);
  await settle();
  return {window,$:id=>window.document.getElementById(id),app:window.__app,api,account,source,calls,instances,controls,emit:authCallback,
    close:async()=>{window.document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());await window.happyDOM.abort();if(original.document===undefined)delete globalThis.document;else globalThis.document=original.document;if(original.window===undefined)delete globalThis.window;else globalThis.window=original.window;}};
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
    assert.equal(page.$('sessionCountLabel').textContent,'séances');assert.equal(page.$('durationLabel').textContent,'prévues');assert.equal(page.$('todayButton'),null);
    assert.equal(page.$('calendar').querySelectorAll('.event-card').length,1);
    assert.equal(page.$('calendar').querySelectorAll('script').length,0);
    assert.match(page.$('calendar').textContent,/RPE 8\/10/);
    assert.equal(page.app.canEdit(b),false);assert.equal(page.app.canEdit(a),true);
    page.$('calendar').querySelector('.session-title').click();assert.equal(page.calls.at(-1)[0],'show');
  }finally{await page.close();}
});

test('training cards reuse the note palette, keep readable headers and remain sortable siblings',async()=>{
  const first=makeSession('palette-a'),second={...makeSession('palette-b'),sport:'boxing',is_locked:false};
  const page=await surface({sessions:[first,second]});
  try{
    const content=page.$('calendar').querySelector(`[data-date="${first.date}"] .day-content`);
    const cards=[...content.querySelectorAll(':scope > .session-card')];
    assert.equal(cards.length,2);assert.equal(cards[0].dataset.color,'sand');
    assert.ok(['#f4ecd9','#fbe2dc','#e1edf9','#eee5f8','#e0f1e8'].includes(cards[0].style.getPropertyValue('--event-bg')));
    assert.ok(['#cfbc8d','#d6a499','#9ebbd9','#c0a6d6','#9cbfaa'].includes(cards[1].style.getPropertyValue('--event-border')));
    assert.equal(cards[0].querySelector('.session-card-header .session-title').textContent,first.title);
    assert.equal(cards[1].querySelector('.session-card-header .lock-badge'),null);
  }finally{await page.close();}
});

test('external personal-connections requests never inherit another athlete’s calendar context',async()=>{
 const page=await surface({role:'coach'});
 try {
  assert.equal(page.app.state.selectedAthlete.user_id,'athlete-user');
  assert.equal(page.$('connectionsButton').hidden,true);
  page.window.dispatchEvent(new page.window.CustomEvent('connections:open',{detail:{personal:true}}));
  assert.deepEqual(structuredClone(page.calls.at(-1)),['connections',{personal:true}]);
  page.$('connectionsButton').click();assert.deepEqual(structuredClone(page.calls.at(-1)),['connections',{personal:false}]);
 }finally{await page.close();}
});

test('athlete starts with today, can add workouts and context but cannot drag locked coach sessions',async()=>{
  const page=await surface({role:'athlete',sessions:[makeSession('a')]});
  try{
    assert.equal(page.app.state.view,'today');assert.equal(page.$('athleteSidebar').hidden,false);
    assert.equal(page.$('rosterLink').hidden,false);assert.equal(page.$('addSessionButton').hidden,false);
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
    assert.match(page.$('runningTotal').title,/28.*4/);
    assert.equal(page.$('runningWeekHint').textContent,'');
    assert.equal(page.$('periodHint').textContent,'');
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
   assert.match(page.$('athleteList').textContent,/CoachPersonnel/);
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

const makeEvent=(id,values={})=>({id,athlete_id:'athlete',created_by:'coach',author_name:'Camille',title:`Note ${id}`,date:'2026-09-21',end_date:null,category:'note',notes:'',is_locked:true,is_private:false,sort_order:1024,updated_at:'2026-09-21T12:00:00Z',...values});
test('multi-day notes have one desktop band per week, continuation markers and separate accessible controls',async()=>{
 const note=makeEvent('camp',{date:'2026-09-25',end_date:'2026-09-30',is_private:true});
 const page=await surface({events:[note]});
 try{
  page.app.state.anchor='2026-09-24';page.app.state.view='month';await page.app.refreshCalendar();
  const spans=[...page.$('calendar').querySelectorAll('.event-desktop-span')];assert.equal(spans.length,2);
  assert.equal(spans[0].style.gridColumn,'5 / 8');assert.equal(spans[1].style.gridColumn,'1 / 4');
  assert.ok(spans[0].classList.contains('continues-after'));assert.ok(spans[1].classList.contains('continues-before'));
  assert.equal(page.$('calendar').querySelectorAll('.event-mobile-span').length,2);
  assert.equal(page.$('calendar').querySelectorAll('.calendar-week').length,6);
  assert.match(spans[0].querySelector('.event-date-range').textContent,/25.*30/);
  assert.ok(spans[0].querySelector('[aria-label*="Privée"]'));assert.ok(spans[0].querySelector('[aria-label*="Verrouillée"]'));
  assert.doesNotMatch(spans[0].textContent,/verrouill|partag|Privée/i);
  spans[0].querySelector('.event-drag-handle').click();assert.equal(page.calls.filter(call=>call[0]==='showEvent').length,0);
  spans[0].querySelector('.event-open').click();assert.equal(page.calls.at(-1)[0],'showEvent');
 }finally{await page.close();}
});

test('dragging a multi-day note moves the whole range with existing concurrency and only changes its dates and position',async()=>{
 const note=makeEvent('camp',{date:'2026-09-21',end_date:'2026-09-23'}),next=makeEvent('next',{date:'2026-09-24',sort_order:2048});
 const page=await surface({events:[note,next]});
 try{
  page.app.state.anchor='2026-09-21';await page.app.refreshCalendar();
  const card=page.$('calendar').querySelector('.event-desktop-span'),from=card.parentElement,to=page.$('calendar').querySelector('.day-content[data-date="2026-09-24"]');
  to.insertBefore(card,to.firstChild);await page.app.handleEventDrop({item:card,from,to,oldDraggableIndex:0,newDraggableIndex:0});
  const save=page.calls.find(call=>call[0]==='saveEvent');assert.equal(save[2].updated_at,note.updated_at);assert.equal(save[2].id,note.id);
  assert.deepEqual(JSON.parse(JSON.stringify(save[1])),{date:'2026-09-24',end_date:'2026-09-26',sort_order:1024});assert.equal(page.calls.filter(call=>call[0]==='saveEvent').length,1);
  assert.equal(page.app.state.events.find(item=>item.id===note.id).updated_at,'saved-event');assert.equal(page.app.state.events.find(item=>item.id===next.id).date,'2026-09-24');
  assert.equal(page.$('calendar').querySelector('.event-desktop-span').style.gridColumn,'4 / 7');
 }finally{await page.close();}
});

test('locked notes of another author and private notes are never draggable by other viewers',async()=>{
 const foreign=makeEvent('foreign',{created_by:'other-coach'}),privateNote=makeEvent('secret',{created_by:'other-coach',is_private:true,is_locked:false});
 const page=await surface({events:[foreign,privateNote]});
 try{
  page.app.state.anchor='2026-09-21';await page.app.refreshCalendar();
  assert.equal(page.$('calendar').querySelector('[data-event-id=secret]'),null);assert.equal(page.app.canEdit(privateNote),false);
  const card=page.$('calendar').querySelector('[data-event-id=foreign]');assert.equal(card.querySelector('.event-drag-handle'),null);
  const from=card.parentElement,to=page.$('calendar').querySelector('.day-content[data-date="2026-09-23"]');to.append(card);
  await page.app.handleEventDrop({item:card,from,to,oldDraggableIndex:0,newDraggableIndex:0});assert.equal(page.calls.filter(call=>call[0]==='saveEvent').length,0);
  assert.ok(page.$('calendar').querySelector('.day-content[data-date="2026-09-21"] [data-event-id=foreign]'));
 }finally{await page.close();}
});

test('failed note movement restores the displayed range and its original position',async()=>{
 const note=makeEvent('camp',{date:'2026-09-21',end_date:'2026-09-23'});const page=await surface({events:[note]});
 try{
  page.app.state.anchor='2026-09-21';await page.app.refreshCalendar();page.controls.saveEvent=async()=>{throw new Error('La note a changé.');};
  const card=page.$('calendar').querySelector('.event-desktop-span'),from=card.parentElement,to=page.$('calendar').querySelector('.day-content[data-date="2026-09-25"]');to.append(card);
  await page.app.handleEventDrop({item:card,from,to,oldDraggableIndex:0,newDraggableIndex:0});
  assert.equal(page.app.state.events[0].date,'2026-09-21');assert.equal(page.app.state.events[0].end_date,'2026-09-23');
  assert.equal(page.$('calendar').querySelector('.event-desktop-span').style.gridColumn,'1 / 4');assert.ok(page.calls.some(call=>call[0]==='toast'&&/a changé/.test(call[1])));
 }finally{await page.close();}
});

test('dragging a continued band shifts the complete note relative to its visible week anchor',async()=>{
 const note=makeEvent('camp',{date:'2026-09-25',end_date:'2026-10-02'});const page=await surface({events:[note]});
 try{
  page.app.state.anchor='2026-09-28';await page.app.refreshCalendar();
  const card=page.$('calendar').querySelector('.event-desktop-span');assert.equal(card.dataset.anchorDate,'2026-09-28');
  const from=card.parentElement,to=page.$('calendar').querySelector('.day-content[data-date="2026-09-30"]');to.append(card);
  await page.app.handleEventDrop({item:card,from,to,oldDraggableIndex:0,newDraggableIndex:0});
  const payload=page.calls.find(call=>call[0]==='saveEvent')[1];assert.equal(payload.date,'2026-09-27');assert.equal(payload.end_date,'2026-10-04');
 }finally{await page.close();}
});


test('group picker identifies groups and displays only their common sessions with no personal completion',async()=>{
 const master={...makeSession('shared'),athlete_id:null,is_group_session:true,shared_session_id:'shared',group_ids:['g1'],athlete_ids:[]};
 const page=await surface({groups:[{id:'g1',coach_id:'coach',name:'Compétition',athlete_ids:['athlete']}],sessions:[master,makeSession('private')]});
 try {
  assert.equal(page.app.state.groupsAvailable,true);
  const picker=[...page.$('athleteList').querySelectorAll('button')].find(b=>b.textContent.includes('Compétition'));
  assert.match(picker.textContent,/Groupe · 1 membre/);picker.click();await settle();
  assert.equal(page.app.state.selectedAthlete,null);assert.equal(page.app.state.selectedGroup.id,'g1');
  assert.equal(page.$('sessionTotal').textContent,'1');assert.equal(page.$('calendar').querySelectorAll('.session-card').length,1);
  assert.equal(page.$('calendar').querySelectorAll('.completion-pill,.completion-button').length,0);
  assert.equal(page.$('addEventButton').hidden,false);assert.equal(page.app.canEdit(master),true);
  assert.equal(page.$('calendar').querySelectorAll('.drag-handle').length,1);
  assert.match(page.$('athleteTitle').textContent,/Compétition/);
  page.$('journalButton').click();await settle();assert.equal(page.app.state.selectedGroup,null);assert.equal(page.app.state.surface,'journal');assert.equal(page.$('libraryButton').hidden,false);page.$('libraryButton').click();assert.equal(page.calls.at(-1)[0],'library');
 }finally{await page.close();}
});

test('group admin with athlete account can select and edit the managed group, members keep only their own calendar',async()=>{
 const groups=[{id:'managed',name:'MRJEU',role:'admin',coach_id:'other',athlete_ids:['athlete']},{id:'joined',name:'Compétiteurs',role:'member',coach_id:'other',athlete_ids:['athlete']}];
 const master={...makeSession('shared','other'),athlete_id:null,is_group_session:true,shared_session_id:'shared',group_ids:['managed'],athlete_ids:[]};
 const page=await surface({role:'athlete',groups,sessions:[master],url:'https://example.test/planning.html?group=managed'});
 try{
  assert.equal(page.$('athletePickerButton').hidden,false);page.$('athletePickerButton').click();assert.equal(page.$('athletePickerDialog').open,true);
  assert.equal(page.app.state.selectedGroup.id,'managed');assert.equal(page.app.canAdd(),true);assert.equal(page.app.canEdit(master),true);
  assert.equal(page.app.canEdit({...master,group_ids:['managed','joined']}),false);
  assert.equal(page.app.canEdit({...master,athlete_ids:['someone-else']}),false);
  assert.equal(page.app.state.groups.length,1);assert.doesNotMatch(page.$('athleteList').textContent,/Compétiteurs/);
  assert.equal(page.$('calendar').querySelector('.completion-button'),null);
 }finally{await page.close();}
 const member=await surface({role:'athlete',groups:[groups[1]],url:'https://example.test/planning.html?group=joined'});
 try{assert.equal(member.$('athletePickerButton').hidden,false);assert.equal(member.app.state.selectedGroup,null);assert.equal(member.app.state.selectedAthlete.user_id,'athlete-user');}
 finally{await member.close();}
});

test('unavailable group feature keeps individual planning usable and shared copies never drag',async()=>{
 const shared={...makeSession('copy'),shared_session_id:'master'};
 const page=await surface({sessions:[shared]});
 try {
  page.controls.groups=async()=>{throw new Error('Mise à jour nécessaire');};await page.app.refreshAccount();await page.app.refreshCalendar();
  assert.equal(page.app.state.groupsAvailable,false);assert.equal(page.app.canAdd(),true);
  assert.match(page.$('athleteList').textContent,/Groupes indisponibles/);
  assert.equal(page.$('calendar').querySelectorAll('.drag-handle').length,0);
  assert.equal(page.app.canEdit(shared),true);
  assert.equal(page.app.canEdit({...shared,created_by:'other-coach',is_locked:false}),false);
 }finally{await page.close();}
});

test('group deep link survives refresh and late group calendar cannot overwrite an athlete',async()=>{
 const page=await surface({groups:[{id:'g1',coach_id:'coach',name:'Équipe',athlete_ids:['athlete']}],url:'https://example.test/planning.html?group=g1'});
 try {
  assert.equal(page.app.state.selectedGroup.id,'g1');
  let resolve;page.controls.groupCalendar=()=>new Promise(r=>{resolve=r;});const pending=page.app.refreshCalendar();
  page.$('athleteList').querySelector('button').click();await settle();
  resolve({sessions:[{...makeSession('late'),athlete_id:null,is_group_session:true,group_ids:['g1']}],events:[],feedback:[]});await pending;
  assert.equal(page.app.state.selectedGroup,null);assert.equal(page.app.state.selectedAthlete.id,'athlete');assert.equal(page.app.state.sessions.length,0);
  assert.equal(page.window.location.search,'?athlete=athlete');
 }finally{await page.close();}
});


test('day plus opens the three original choices with the clicked date and neutral focus',async()=>{
 const page=await surface();
 try {
  const day=page.$('calendar').querySelectorAll('.day')[2],date=day.dataset.date,plus=day.querySelector('.add-day');
  assert.equal(day.querySelectorAll('.day-actions button').length,1);assert.equal(plus.textContent,'＋');
  assert.equal(page.$('addSessionButton').hidden,false);assert.equal(page.$('addEventButton').hidden,false);
  plus.click();assert.equal(page.$('dayAddDialog').open,true);
  assert.deepEqual([...page.$('dayAddOptions').querySelectorAll('button')].map(b=>b.textContent),['Bibliothèque','Planifier une séance','Notes']);
  assert.equal(page.window.document.activeElement.id,'dayAddTitle');
  page.$('dayAddOptions').querySelectorAll('button')[1].click();assert.equal(page.$('dayAddDialog').open,false);
  assert.deepEqual(structuredClone(page.calls.at(-1)),['edit',null,date]);
  plus.click();page.$('dayAddOptions').querySelectorAll('button')[2].click();assert.deepEqual(structuredClone(page.calls.at(-1)),['event',null,date]);
  plus.click();page.$('dayAddOptions').querySelectorAll('button')[0].click();
  const choice=page.calls.at(-1);assert.equal(choice[0],'library');assert.equal(choice[1].kind,'session');
  choice[1].onSelect({id:'template',title:'Footing'});
  assert.deepEqual(structuredClone(page.calls.at(-1)),['edit',{id:undefined,title:'Footing',athlete_id:'athlete',date},date,true]);
  plus.click();page.$('dayAddDialog').dispatchEvent(new page.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await settle();
  assert.equal(page.$('dayAddDialog').open,false);assert.equal(page.window.document.activeElement,plus);
  plus.click();page.$('dayAddDialog').click();assert.equal(page.$('dayAddDialog').open,false);
 }finally{await page.close();}
});

test('day library choices preserve group context and reject a stale calendar, permission or account',async()=>{
 const page=await surface({groups:[{id:'g1',coach_id:'coach',name:'Équipe',athlete_ids:['athlete']}],url:'https://example.test/planning.html?group=g1'});
 try {
  const open=()=>{const day=page.$('calendar').querySelectorAll('.day')[1];day.querySelector('.add-day').click();page.$('dayAddOptions').querySelector('button').click();return {date:day.dataset.date,select:page.calls.at(-1)[1].onSelect};};
  const group=open();assert.match(page.$('dayAddContext').textContent,/Groupe · Équipe/);
  group.select({id:'template',title:'Équipe'});assert.equal(page.calls.at(-1)[0],'edit');assert.equal(page.calls.at(-1)[2],group.date);assert.equal(page.app.state.selectedGroup.id,'g1');
  const old=open();page.$('athleteList').querySelector('button').click();await settle();const before=page.calls.filter(c=>c[0]==='edit').length;
  old.select({id:'template'});assert.equal(page.calls.filter(c=>c[0]==='edit').length,before);
  const individual=open();page.app.state.relation.can_add_sessions=false;individual.select({id:'template'});assert.equal(page.calls.filter(c=>c[0]==='edit').length,before);
  page.app.state.relation.can_add_sessions=true;
  const previousAccount=open();page.app.state.user={id:'someone-else'};previousAccount.select({id:'template'});assert.equal(page.calls.filter(c=>c[0]==='edit').length,before);
 }finally{await page.close();}
});

test('unlocked notes omit access icons and short text has a safe compact preview',async()=>{
 const note=makeEvent('brief',{is_locked:false,notes:'  Mobilité <script>alert(1)</script>  avant le cours.  '});
 const page=await surface({events:[note,makeEvent('title-only',{is_locked:false})]});
 try {
  page.app.state.anchor=note.date;await page.app.refreshCalendar();
  const card=page.$('calendar').querySelector('[data-event-id="brief"]');
  assert.equal(card.querySelector('.lock-badge'),null);assert.equal(card.querySelector('script'),null);
  assert.equal(card.querySelector('.event-preview').textContent,'Mobilité <script>alert(1)</script> avant le cours.');
  assert.equal(page.$('calendar').querySelector('[data-event-id="title-only"] .event-preview'),null);
  card.querySelector('.event-open').click();assert.equal(page.calls.at(-1)[1].notes,note.notes);
 }finally{await page.close();}
});

test('group notes show only on the selected group, remain author-only and can move as a master',async()=>{
 const note=makeEvent('group-note',{athlete_id:null,is_group_event:true,shared_event_id:'group-note',group_ids:['g1'],athlete_ids:[],is_locked:false});
 const page=await surface({groups:[{id:'g1',coach_id:'coach',name:'Équipe',athlete_ids:['athlete']}],events:[note,makeEvent('individual')],url:'https://example.test/planning.html?group=g1'});
 try {
  page.app.state.anchor=note.date;await page.app.refreshCalendar();
  assert.equal(page.$('calendar').querySelectorAll('.event-card').length,1);assert.equal(page.$('addEventButton').hidden,false);
  assert.equal(page.app.canEdit(note),true);assert.equal(page.app.canEdit({...note,created_by:'other'}),false);
  assert.equal(page.app.canEdit({...note,group_ids:['other']}),false);
  const card=page.$('calendar').querySelector('[data-event-id="group-note"]');assert.match(card.querySelector('.lock-badge').getAttribute('aria-label'),/Note commune/);assert.ok(card.querySelector('.event-drag-handle'));
  const from=card.parentElement,to=page.$('calendar').querySelector('.day-content[data-date="2026-09-23"]');to.append(card);
  await page.app.handleEventDrop({item:card,from,to,oldDraggableIndex:0,newDraggableIndex:0});
  assert.equal(page.calls.find(call=>call[0]==='saveEvent')[1].date,'2026-09-23');assert.equal(page.app.state.events[0].date,'2026-09-23');
 }finally{await page.close();}
});

test('shared note copies are author-only and cannot move separately from the common note',async()=>{
 const note=makeEvent('copy',{shared_event_id:'master',is_locked:false});const page=await surface({events:[note]});
 try {
  page.app.state.anchor=note.date;await page.app.refreshCalendar();assert.equal(page.app.canEdit(note),true);assert.equal(page.app.canEdit({...note,created_by:'other'}),false);
  const card=page.$('calendar').querySelector('[data-event-id="copy"]');assert.match(card.querySelector('.lock-badge').getAttribute('aria-label'),/Note commune/);assert.equal(card.querySelector('.event-drag-handle'),null);
  const from=card.parentElement,to=page.$('calendar').querySelector('.day-content[data-date="2026-09-23"]');to.append(card);
  await page.app.handleEventDrop({item:card,from,to,oldDraggableIndex:0,newDraggableIndex:0});assert.equal(page.calls.some(call=>call[0]==='saveEvent'),false);
 }finally{await page.close();}
});


test('switching accounts clears calendar details and invalidates a pending read',async()=>{
  const page=await surface({sessions:[makeSession('private')]});try {
    page.emit('SIGNED_IN',{user:{id:'coach'}});
    assert.equal(page.$('workspace').hidden,false);
    let finish;
    page.controls.calendar=()=>new Promise(resolve=>{finish=resolve;});
    page.$('nextButton').click();await settle();
    page.emit('SIGNED_IN',{user:{id:'other-account'}});
    assert.equal(page.$('workspace').hidden,true);
    assert.equal(page.$('calendar').textContent,'');
    assert.equal(page.$('athleteList').textContent,'');
    finish({sessions:[makeSession('late-private')],events:[],feedback:[]});await settle();
    assert.equal(page.$('calendar').textContent,'');
  }finally{await page.close();}
});

test('signing out destroys the session timer, its private instructions and fullscreen state',async()=>{
  const page=await surface({sessions:[makeSession('timer-private')]});
  try{
    page.$('calendar').querySelector('.session-timer-button').click();await settle();
    assert.equal(page.$('sessionTimerDialog').open,true);
    page.$('sessionTimerDialog').querySelector('.session-timer-start').click();await settle();
    assert.equal(page.$('sessionTimerBoard').dataset.status,'running');
    page.emit('SIGNED_OUT');await settle();
    assert.equal(page.$('sessionTimerDialog'),null);assert.equal(page.window.document.body.classList.contains('timer-session-open'),false);
  }finally{await page.close();}
});
test('a delayed timer load cannot expose the former account after an account switch',async()=>{
  const page=await surface({sessions:[makeSession('timer-pending')]});
  try{
    let resolve;page.controls.loadSessionTimer=()=>new Promise(r=>{resolve=r;});
    page.$('calendar').querySelector('.session-timer-button').click();await settle();
    page.emit('SIGNED_IN',{user:{id:'other-account'}});
    resolve({mountSessionTimer});await settle();
    assert.equal(page.$('sessionTimerDialog'),null);assert.equal(page.app.state.user,null);
  }finally{await page.close();}
});

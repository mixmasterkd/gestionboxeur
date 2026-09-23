import Sortable from 'sortablejs';
import { client, loadAccount, loadCalendar, rpc, saveSession } from './data.js';
import * as dataApi from './data.js';
import { SPORTS, summarizeBlocks, formatDuration } from './domain.js';
import { todayLocal, datesForView, shiftPeriod, orderedSessions, positionBetween, eventOnDate, dateLabel, periodLabel } from './calendar.js';
import { $, el, button, displayName, initials, toast, showError } from './ui.js';
import { createSessionUI } from './session-dialogs.js';
import { createConnectionsUI } from './connections.js';
import { createLibraryUI } from './library.js';
import { mountNavigation } from './navigation.js';
import { renderSessionChart } from './session-chart.js';

const state = { user:null, profile:null, gym:null, planningAvailable:true, coach:null, relations:[], athletes:[], selectedAthlete:null, relation:null, sessions:[],events:[],feedback:[],runningWeekSessions:null,runningWeekError:false,view:'week',anchor:todayLocal() };
let calendarTicket=0, accountTicket=0, dragSaving=false, sortables=[], destroyed=false;
const isCoach=()=>state.profile?.account_type==='coach';
const ownsCalendar=()=>state.profile?.account_type==='athlete' && !!state.user?.id && state.selectedAthlete?.user_id===state.user.id;
const canView=()=>state.planningAvailable && !!state.selectedAthlete?.user_id && (ownsCalendar() || isCoach() && state.relation?.status==='accepted' && state.relation.can_view_calendar);
const canAdd=()=>canView() && (ownsCalendar() || !!state.relation?.can_add_sessions);
const canEdit=session=>canView() && session.athlete_id===state.selectedAthlete.id && (ownsCalendar() || !!state.relation?.can_edit_own_sessions) && (session.created_by===state.user?.id || session.is_locked===false);
const sessionUI=createSessionUI({getState:()=>state,refresh:()=>refreshCalendar({throwOnError:true}),openLibrary:options=>libraryUI.open(options),canEdit,canAdd,api:dataApi});
const libraryUI=createLibraryUI({getState:()=>state,canAdd,onUseTemplate:template=>sessionUI.editSession({...template,id:undefined,athlete_id:state.selectedAthlete?.id,date:state.anchor},state.anchor,true)});
const connectionsUI=createConnectionsUI({getState:()=>state,refreshAccount,refreshCalendar});
const calendarViews=new Set(['today','week','month']);
function viewPreferenceKey() {
  if(!state.user?.id)return null;
  const demo=new URL(location.href).searchParams.get('demo');
  const environment=['athlete','coach'].includes(demo)?`demo-${demo}`:'connected';
  return `gestionboxeur:calendar-view:v1:${environment}:${state.user.id}`;
}
function restoreView() {
  const fallback=isCoach()?'week':'today';
  try {const saved=localStorage.getItem(viewPreferenceKey());return calendarViews.has(saved)?saved:fallback;}
  catch{return fallback;}
}
function rememberView(view) {
  const key=viewPreferenceKey();if(!key||!calendarViews.has(view))return;
  try{localStorage.setItem(key,view);}catch{/* Private browsing or full storage must not block navigation. */}
}

function fatal(error) { showError($('globalError'),error);$('loading').hidden=true; }
function acceptedAthletes() { const ids=new Set(state.relations.filter(r=>r.status==='accepted').map(r=>r.athlete_id)); return isCoach()?state.athletes.filter(a=>ids.has(a.id)&&a.user_id):state.athletes.filter(a=>a.user_id===state.user?.id); }
function clearCalendar() {sortables.forEach(s=>s.destroy());sortables=[];$('calendar').replaceChildren();}
async function refreshAccount() {
  if(!state.user||destroyed)return false;
  const ticket=++accountTicket,userId=state.user.id;
  const account=await loadAccount(state.user);
  if(ticket!==accountTicket||destroyed||state.user?.id!==userId)return false;
  Object.assign(state,account);
  const available=acceptedAthletes();
  const fromURL=new URL(location.href).searchParams.get('athlete');
  state.selectedAthlete=available.find(a=>a.id===state.selectedAthlete?.id)||available.find(a=>a.id===fromURL)||available[0]||null;
  state.relation=state.relations.find(r=>r.athlete_id===state.selectedAthlete?.id && r.coach_id===state.user.id)||null;
  renderAccount();
  return true;
}
function renderAccount() {
  mountNavigation({role:state.profile.account_type,isAdmin:state.profile.is_admin});
  $('accountName').textContent=state.profile.full_name || state.user.email;
  $('gymBrand').textContent=isCoach()?(state.gym?.gym_name||'Mon gym'):'Mon entraînement';
  $('gymAddress').textContent=isCoach()?(state.gym?.address||''):'';
  $('gymAddress').hidden=!$('gymAddress').textContent;
  $('gymHome').href=isCoach()?'./':'planning.html';
  document.title=`Planification — ${$('gymBrand').textContent}`;
  $('rosterLink').hidden=!isCoach();$('libraryButton').hidden=!isCoach()||!state.planningAvailable;$('adminLink').hidden=!state.profile.is_admin;
  $('connectionsButton').hidden=!state.planningAvailable;
  $('planningUnavailable').hidden=state.planningAvailable;
  $('workspace').hidden=!state.planningAvailable;
  if(!state.planningAvailable) {
    clearCalendar();$('athleteList').replaceChildren();
    $('planningUnavailable').querySelector('p').textContent=isCoach()?'Les fiches de tes athlètes, tes contacts et tes listes combat/sparring restent accessibles.':'Ton calendrier sera accessible une fois la planification activée.';
    $('planningUnavailable').querySelector('a').hidden=!isCoach();
    return;
  }
  $('athleteSidebar').hidden=!isCoach();$('workspace').classList.toggle('athlete-workspace',!isCoach());
  $('todayViewButton').hidden=false;$('addSessionButton').hidden=!canAdd();
  $('addEventButton').hidden=!canAdd();$('addEventButton').textContent='＋ Événement / note';
  $('inviteButton').hidden=!isCoach()||!state.selectedAthlete||!!state.selectedAthlete.user_id;
  $('noAthlete').hidden=!!state.selectedAthlete||!isCoach();
  $('calendarSection').hidden=!state.selectedAthlete;
  $('athleteTitle').textContent=isCoach()?(state.selectedAthlete?displayName(state.selectedAthlete):'Calendrier d’entraînement'):'Mon calendrier';
  $('viewEyebrow').textContent='PLANIFICATION DES ENTRAÎNEMENTS';
  $('athleteSubtitle').textContent=isCoach()?'Séances et événements de cet athlète.':'Séances, événements et bilans.';
  if(!isCoach()&&!state.selectedAthlete) {$('calendarStatus').textContent='Aucun profil athlète lié. Ouvre ton lien d’invitation ou reconnecte-toi après la création de ton compte.';$('calendarSection').hidden=false;}
  renderAthleteList();
}
function renderAthleteList() {
  const query=$('athleteSearch').value.trim().toLocaleLowerCase('fr');
  $('athleteList').replaceChildren();
  const list=acceptedAthletes().filter(a=>displayName(a).toLocaleLowerCase('fr').includes(query));
  for(const athlete of list) {
    const item=button('',async()=>{
      if(athlete.id===state.selectedAthlete?.id) return;
      state.selectedAthlete=athlete;state.relation=state.relations.find(r=>r.athlete_id===athlete.id);
      renderAccount();await refreshCalendar();
    },`athlete-item${athlete.id===state.selectedAthlete?.id?' active':''}`,{'aria-pressed':String(athlete.id===state.selectedAthlete?.id)});
    const relation=state.relations.find(r=>r.athlete_id===athlete.id);
    const status=!athlete.user_id?'Fiche sans compte':relation?.can_view_calendar===false?'Accès calendrier non autorisé':'Compte lié';
    item.append(el('span',{class:'athlete-avatar','aria-hidden':'true'},initials(athlete)),el('span',{},el('strong',{},displayName(athlete)),el('small',{},status)));
    if(athlete.user_id)item.append(el('span',{class:'dot','aria-hidden':'true'}));
    $('athleteList').append(item);
  }
  if(!list.length) {
    $('athleteList').append(el('p',{class:'empty-message'},query?'Aucun athlète correspondant.':'Aucun compte athlète lié. Les fiches sans compte sont dans « Mes athlètes ».'));
    if(isCoach())$('athleteList').append(el('a',{href:'./',class:'button secondary'},'Ouvrir Mes athlètes'));
  }
}
async function refreshCalendar({throwOnError=false}={}) {
  const ticket=++calendarTicket;
  clearCalendar();state.sessions=[];state.events=[];state.feedback=[];state.runningWeekSessions=null;state.runningWeekError=false;
  renderPeriod();renderTotals();$('calendar').removeAttribute('aria-busy');
  if(!state.planningAvailable||!state.selectedAthlete) return;
  if(!canView()) {$('calendarStatus').textContent='L’accès au calendrier doit être autorisé par l’athlète dans « Mes coachs ».';renderTotals();return;}
  $('calendarStatus').textContent='Chargement du calendrier…';
  $('calendar').setAttribute('aria-busy','true');
  const dates=datesForView(state.anchor,state.view);
  const week=datesForView(state.anchor,'week'),athleteId=state.selectedAthlete.id,userId=state.user?.id;
  const coversWeek=dates[0]<=week[0]&&dates.at(-1)>=week.at(-1);
  try {
    const [periodResult,weekResult]=await Promise.allSettled([
      loadCalendar(athleteId,dates[0],dates.at(-1)),
      ...(coversWeek?[]:[loadCalendar(athleteId,week[0],week.at(-1))]),
    ]);
    if(ticket!==calendarTicket||destroyed||state.user?.id!==userId||state.selectedAthlete?.id!==athleteId)return;
    if(periodResult.status==='rejected')throw periodResult.reason;
    const data=periodResult.value;
    Object.assign(state,data);
    state.runningWeekError=weekResult?.status==='rejected';
    const weekData=coversWeek?data:weekResult?.value;
    state.runningWeekSessions=weekData?weekData.sessions.filter(session=>session.date>=week[0]&&session.date<=week.at(-1)):null;
    $('calendarStatus').textContent='';renderCalendar();renderTotals();
  }catch(error){if(ticket===calendarTicket){$('calendarStatus').replaceChildren(el('span',{},error.message||'Impossible de charger le calendrier. '),button('Réessayer',refreshCalendar,'quiet-button'));renderTotals();}if(throwOnError)throw error;}
  finally{if(ticket===calendarTicket)$('calendar').removeAttribute('aria-busy');}
}
function renderPeriod() {
  $('periodTitle').textContent=periodLabel(state.anchor,state.view);
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===state.view)));
  $('calendarFootnote').textContent=canAdd()?'Glisse tes séances par leur poignée, ou utilise « Modifier » pour changer la date. Aucune heure n’est imposée.':'Les séances sont organisées par date. Ouvre une fiche pour lire les instructions et les retours.';
}
function periodSessions() {return state.view==='month'?state.sessions.filter(s=>s.date.slice(0,7)===state.anchor.slice(0,7)):state.sessions;}
function renderTotals() {
  const sessions=periodSessions();let duration=0,knownTime=false,unknown=false;
  for(const session of sessions) {const s=summarizeBlocks(session.blocks);duration+=s.duration_seconds;knownTime||=s.hasTime;unknown||=!s.hasTime||s.hasUnquantified||s.hasDistanceOnly||s.errors.length>0;}
  $('sessionTotal').textContent=String(sessions.length);$('durationTotal').textContent=knownTime?formatDuration(duration):'—';
  $('durationTotal').title=unknown?'Somme des durées renseignées ; certains blocs n’ont pas de durée.':'Somme des durées renseignées.';
  $('periodHint').textContent=unknown?'Totaux partiels : certaines durées ne sont pas renseignées.':'Totaux des séances de la période.';
  const week=datesForView(state.anchor,'week');
  $('runningWeekRange').textContent=periodLabel(state.anchor,'week');
  $('runningTotal').title=`Course prévue du ${dateLabel(week[0])} au ${dateLabel(week.at(-1))}.`;
  $('distanceTotal').hidden=true;$('distanceTotal').textContent='';
  if(state.runningWeekSessions===null) {
    $('runningTotal').textContent='—';
    $('runningWeekHint').textContent=state.runningWeekError?'Total hebdomadaire indisponible. Réessaie en actualisant le calendrier.':'';
    return;
  }
  const running=state.runningWeekSessions.filter(session=>session.sport==='running');
  let runTime=0,distance=0,knownRunTime=false,knownDistance=false,partial=false;
  for(const session of running) {
    const s=summarizeBlocks(session.blocks);runTime+=s.duration_seconds;distance+=s.distance_m;
    knownRunTime||=s.hasTime;knownDistance||=s.hasDistance;
    partial||=!s.hasTime||s.hasUnquantified||s.hasDistanceOnly||s.errors.length>0;
  }
  const minutes=runTime/60,number=new Intl.NumberFormat('fr-CA',{maximumFractionDigits:2});
  $('runningTotal').textContent=knownRunTime?`${minutes>0&&minutes<0.005?'< 0,01':number.format(minutes)} min`:running.length?'—':'0 min';
  $('runningWeekHint').textContent=partial?(knownRunTime?'Durée partielle · temps renseignés uniquement.':'Durées non renseignées · aucune estimation.'):'Du lundi au dimanche.';
  if(knownDistance){$('distanceTotal').textContent=`${number.format(distance/1000)} km renseignés`;$('distanceTotal').hidden=false;}
}
const feelings=['','😞','😕','😐','🙂','😄'];
function sessionCard(session) {
  const sport=SPORTS.find(s=>s.id===session.sport)||SPORTS.at(-1), summary=summarizeBlocks(session.blocks);
  const completed=Boolean(session.completed_at);
  const card=el('article',{class:`session-card${completed?' is-completed':''}`,dataset:{sessionId:session.id}});
  const top=el('div',{class:'session-top'},el('span',{class:'sport-tag',dataset:{sport:session.sport}},`${sport.icon} ${sport.label}`));
  if(canEdit(session))top.append(button('⠿',()=>{},'drag-handle',{'aria-label':`Déplacer ${session.title} par glisser-déposer`,title:'Glisser pour déplacer. Pour changer la date au clavier, ouvre la séance puis Modifier.'}));
  top.append(el('span',{class:`lock-badge ${session.is_locked===false?'unlocked':'locked'}`,title:session.is_locked===false?'Modifiable par l’athlète et ses coachs autorisés':'Modifiable uniquement par son créateur'},session.is_locked===false?'Partagée':'Verrouillée'));
  card.append(top,button(session.title,()=>sessionUI.showSession(session),'session-title'));
  const meta=[];if(summary.hasTime)meta.push(formatDuration(summary.duration_seconds));if(summary.hasDistance)meta.push(`${new Intl.NumberFormat('fr-CA',{maximumFractionDigits:2}).format(summary.distance_m/1000)} km`);
  if(!meta.length)meta.push(session.blocks.length?`${session.blocks.length} bloc${session.blocks.length>1?'s':''}`:'Instructions libres');
  card.append(el('div',{class:'session-meta'},meta.join(' · ')));
  if(['running','boxing'].includes(session.sport))card.append(renderSessionChart(session,{summary}));
  card.append(el('p',{class:'session-author'},`Par ${session.author_name||'Coach'}`));
  if(ownsCalendar()) {
    const toggle=button(completed?'✓ Faite':'Marquer comme faite',async()=>{
      if(toggle.disabled)return;
      toggle.disabled=true;
      try{await sessionUI.setCompleted(session,!completed);}catch(error){toast(error.message||'Impossible d’enregistrer le statut.');}
      finally{toggle.disabled=false;}
    },'completion-button',{'aria-pressed':String(completed),'aria-label':`${completed?'Annuler la réalisation de':'Marquer comme faite :'} ${session.title}`});
    card.append(toggle);
  }else card.append(el('span',{class:`completion-pill ${completed?'completed':'pending'}`},completed?'✓ Faite':'À faire'));
  const feedback=state.feedback.find(f=>f.session_id===session.id);
  if(completed&&feedback&&(!isCoach()||state.relation?.can_view_feedback!==false))card.append(el('div',{class:'feedback-pill'},`${feedback.feeling?feelings[feedback.feeling]+' ':''}${feedback.rpe?'RPE '+feedback.rpe+'/10':'Retour reçu'}${feedback.comment?' · commentaire':''}`));
  return card;
}
function renderCalendar() {
  clearCalendar();const calendar=$('calendar');calendar.className=`calendar${state.view==='month'?' month':state.view==='today'?' today-view':''}`;
  for(const date of datesForView(state.anchor,state.view)) {
    const day=el('section',{class:`day${date===todayLocal()?' today':''}${date.slice(0,7)!==state.anchor.slice(0,7)?' outside-month':''}`,dataset:{date},'aria-label':dateLabel(date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})});
    day.append(el('header',{class:'day-heading'},el('span',{class:'weekday'},dateLabel(date,{weekday:'short'})),el('span',{class:'date-number','aria-label':date===todayLocal()?'Aujourd’hui':undefined},String(Number(date.slice(8))))));
    for(const event of state.events.filter(e=>eventOnDate(e,date))){ const card=button('',()=>sessionUI.showEvent(event),'event-card');card.append(el('span',{class:'event-label'},event.is_locked===false?'Événement partagé':'Événement · verrouillé'),el('strong',{},event.title));day.append(card); }
    const content=el('div',{class:'day-content',dataset:{date}});
    const sessions=orderedSessions(state.sessions.filter(s=>s.date===date));sessions.forEach(s=>content.append(sessionCard(s)));
    content.append(el('div',{class:'empty-day'},'Aucune séance prévue'));
    day.append(content);
    if(canAdd())day.append(button(state.view==='month'?'＋':'＋ Séance',()=>sessionUI.editSession(null,date),'add-day',{'aria-label':`Planifier une séance le ${dateLabel(date)}`}));
    if(canAdd())day.append(button(state.view==='month'?'＋ Note':'＋ Événement',()=>sessionUI.editEvent(null,date),'add-day',{'aria-label':`Ajouter un événement le ${dateLabel(date)}`}));
    calendar.append(day);
    if(canView()) {
      sortables.push(new Sortable(content,{group:'training-calendar',animation:150,handle:'.drag-handle',draggable:'.session-card',ghostClass:'sortable-ghost',delay:170,delayOnTouchOnly:true,touchStartThreshold:5,fallbackOnBody:true,filter:(_event,target)=>!canEdit(state.sessions.find(s=>s.id===target.closest('.session-card')?.dataset.sessionId)||{}),onMove:()=>!dragSaving,onEnd:handleDrop}));
    }
  }
}
async function handleDrop(event) {
  if(event.from===event.to && event.oldDraggableIndex===event.newDraggableIndex)return;
  const session=state.sessions.find(s=>s.id===event.item.dataset.sessionId);
  if(!session||!canEdit(session)||dragSaving){renderCalendar();return;}
  dragSaving=true;$('calendarStatus').textContent='Enregistrement du déplacement…';
  try{
    const cards=[...event.to.querySelectorAll(':scope > .session-card')];const index=cards.indexOf(event.item);
    const before=index>0?state.sessions.find(s=>s.id===cards[index-1].dataset.sessionId):null;
    const after=index<cards.length-1?state.sessions.find(s=>s.id===cards[index+1].dataset.sessionId):null;
    const sort_order=positionBetween(before,after);await saveSession({date:event.to.dataset.date,sort_order},session);toast('Séance déplacée.');
  }catch(error){toast(error.message||'Le déplacement n’a pas été enregistré.');}
  finally{dragSaving=false;await refreshCalendar();}
}
async function init() {
  const params=new URL(location.href).searchParams;
  const invitation=params.get('invite')||sessionStorage.getItem('pendingInvite');
  if(invitation)sessionStorage.setItem('pendingInvite',invitation);
  const {data,error}=await client.auth.getSession();if(error)throw error;
  if(!data.session){location.replace(`login.html${invitation?'?invite='+encodeURIComponent(invitation):''}`);return;}
  state.user=data.session.user;
  client.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT'){destroyed=true;calendarTicket++;accountTicket++;clearCalendar();state.user=null;state.gym=null;state.sessions=[];state.events=[];state.feedback=[];state.athletes=[];$('athleteList').replaceChildren();$('gymBrand').textContent='Mon espace';$('gymAddress').textContent='';$('gymAddress').hidden=true;$('accountName').textContent='';document.title='Planification';document.querySelectorAll('dialog[open]').forEach(d=>d.close());$('workspace').hidden=true;$('planningUnavailable').hidden=true;location.replace('login.html');}});
  if(invitation){
    try{await rpc('accept_invitation',{p_token:invitation});sessionStorage.removeItem('pendingInvite');const clean=new URL(location.href);clean.searchParams.delete('invite');history.replaceState({},'',clean);$('connectionBanner').textContent='Invitation acceptée. Ton calendrier est maintenant partagé avec ton coach.';$('connectionBanner').hidden=false;}
    catch(error){$('connectionBanner').textContent=error.message||'Impossible d’accepter cette invitation.';$('connectionBanner').hidden=false;}
  }
  if(!await refreshAccount())return;
  state.view=restoreView();$('loading').hidden=true;
  if(new URL(location.href).searchParams.get('coachs')==='1'&&state.planningAvailable)connectionsUI.open();
  if(state.planningAvailable)await refreshCalendar();
}
$('athleteSearch').addEventListener('input',renderAthleteList);
$('previousButton').addEventListener('click',()=>{state.anchor=shiftPeriod(state.anchor,state.view,-1);refreshCalendar();});
$('nextButton').addEventListener('click',()=>{state.anchor=shiftPeriod(state.anchor,state.view,1);refreshCalendar();});
$('todayButton').addEventListener('click',()=>{state.anchor=todayLocal();refreshCalendar();});
$('viewButtons').addEventListener('click',event=>{const view=event.target.closest('[data-view]')?.dataset.view;if(calendarViews.has(view)){state.view=view;rememberView(view);refreshCalendar();}});
$('addSessionButton').addEventListener('click',()=>sessionUI.editSession(null,state.anchor));
$('addEventButton').addEventListener('click',()=>sessionUI.editEvent(null,state.anchor));
$('inviteButton').addEventListener('click',()=>connectionsUI.inviteAthlete());
$('connectionsButton').addEventListener('click',()=>connectionsUI.open());
$('manageConnectionsButton').addEventListener('click',()=>connectionsUI.open());
$('libraryButton').addEventListener('click',()=>libraryUI.open());
$('logoutButton').addEventListener('click',async()=>{try{const {error}=await client.auth.signOut();if(error)throw error;}catch(error){toast(error.message);}});
window.addEventListener('offline',()=>{$('connectionBanner').textContent='Connexion interrompue. Reconnecte-toi avant d’enregistrer des changements.';$('connectionBanner').hidden=false;});
window.addEventListener('online',()=>{$('connectionBanner').hidden=true;refreshCalendar();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.user&&state.profile&&!document.querySelector('dialog[open]')&&!dragSaving){refreshAccount().then(refreshCalendar).catch(fatal);}});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
init().catch(fatal);

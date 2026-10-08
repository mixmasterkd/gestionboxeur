import { createJournalUI } from './journal.js';
import { applyEventColor } from './event-colors.js';
import { accessIcon } from './access-icons.js';
import { chooseMonthPreviews, monthSessionPreview, monthNotePreview } from './month-previews.js';
import Sortable from 'sortablejs';
import { client, loadAccount, loadCalendar, rpc, saveSession } from './data.js';
import * as dataApi from './data.js';
import { SPORTS, summarizeBlocks, formatDuration } from './domain.js';
import { todayLocal, datesForView, shiftPeriod, orderedSessions, positionBetween, eventOnDate, dateLabel, periodLabel, orderedEvents, eventSpans, moveEventDates } from './calendar.js';
import { $, el, button, displayName, initials, toast, showError, openDialog, confirmAction } from './ui.js';
import { createSessionUI } from './session-dialogs.js';
import { createConnectionsUI } from './connections.js';
import { createLibraryUI } from './library.js';
import { mountNavigation } from './navigation.js';
import { renderSessionChart } from './session-chart.js';

const state = { surface:location.hash==='#journal'?'journal':'calendar', user:null, profile:null, gym:null, planningAvailable:true, coach:null, relations:[], athletes:[], selectedAthlete:null, selectedGroup:null, groups:[], groupsAvailable:false, groupsError:null, relation:null, sessions:[],events:[],feedback:[],runningWeekSessions:null,runningWeekError:false,view:'week',anchor:todayLocal() };
let calendarTicket=0, accountTicket=0, dragSaving=false, sortables=[], destroyed=false;
const isCoach=()=>state.profile?.account_type==='coach';
const ownsCalendar=()=>!state.selectedGroup && !!state.user?.id && state.selectedAthlete?.user_id===state.user.id;
const canView=()=>state.planningAvailable && (state.selectedGroup ? isCoach() && state.groups.some(g=>g.id===state.selectedGroup.id) : !!state.selectedAthlete?.user_id && (ownsCalendar() || isCoach() && state.relation?.status==='accepted' && state.relation.can_view_calendar));
const canAdd=()=>canView() && (!!state.selectedGroup || ownsCalendar() || !!state.relation?.can_add_sessions);
const isCommon=item=>!!(item.is_group_session||item.is_group_event||item.shared_session_id||item.shared_event_id);
const canEdit=session=>canView() && (session.is_group_session||session.is_group_event ? (!state.selectedGroup || session.group_ids?.includes(state.selectedGroup.id)) && session.created_by===state.user?.id : !state.selectedGroup && session.athlete_id===state.selectedAthlete?.id && (ownsCalendar() || !!state.relation?.can_edit_own_sessions) && (!isCommon(session) || session.created_by===state.user?.id) && (!session.is_private || session.created_by===state.user?.id) && (session.created_by===state.user?.id || session.is_locked===false));
const canDrag=session=>canEdit(session)&&(!isCommon(session)||session.is_group_session||session.is_group_event);
const sessionUI=createSessionUI({getState:()=>state,refresh:()=>refreshCalendar({throwOnError:true}),openLibrary:options=>libraryUI.open(options),canEdit,canAdd,api:dataApi,onTimer:openSessionTimer});
const libraryUI=createLibraryUI({getState:()=>state,canAdd,onCreateTemplate:options=>sessionUI.editTemplate(null,options),onEditTemplate:(template,options)=>sessionUI.editTemplate(template,options),onUseTemplate:template=>sessionUI.editSession({...template,id:undefined,athlete_id:state.selectedAthlete?.id,date:state.anchor},state.anchor,true)});
const connectionsUI=createConnectionsUI({getState:()=>state,refreshAccount,refreshCalendar});
const journalUI=createJournalUI({getState:()=>state,api:dataApi});
let activeSessionTimer=null, timerRequest=0;
async function openSessionTimer(session) {
  const request=++timerRequest, userId=state.user?.id, context=state.selectedGroup?.id||state.selectedAthlete?.id;
  const current=()=>!destroyed&&request===timerRequest&&state.user?.id===userId&&(state.selectedGroup?.id||state.selectedAthlete?.id)===context&&canView();
  const live=state.sessions.find(item=>item.id===session.id);
  if(!current()||!live){toast('Cet entraînement n’est plus accessible dans ce calendrier.');return;}
  const key=`${userId}:${context}:${live.id}`, revision=JSON.stringify([live.title,live.workout_document,live.blocks,live.description,live.notes]);
  try {
    if(activeSessionTimer?.key!==key||activeSessionTimer?.revision!==revision) {
      const snapshot=activeSessionTimer?.ui.snapshot();
      if(snapshot&&snapshot.elapsed>0&&snapshot.status!=='done'&&!await confirmAction('Changer le timer ?', 'Le timer précédent est en pause. Le remplacer par celui de cet entraînement ?', 'Changer'))return;
      if(!current())return;
      const { mountSessionTimer }=await import('./session-timer.js');
      if(!current())return;
      const dialog=el('dialog');
      // Validate the new program before retiring the previous playback copy.
      const ui=mountSessionTimer(dialog,live);
      activeSessionTimer?.ui.destroy();document.body.append(dialog);
      activeSessionTimer={key,revision,ui};
    }
    if($('detailDialog').open)$('detailDialog').close();
    activeSessionTimer.ui.open();
  }catch(error){if(current())toast(error.message||'Impossible d’ouvrir le timer.');}
}
function sessionTimerButton(session) {
  const node=button('Timer',()=>openSessionTimer(session),'session-timer-button',{'aria-label':`Ouvrir le timer de ${session.title}`});
  const icon=el('span',{'aria-hidden':'true'});icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="14" r="8"/><path d="M12 10v4l3 2M9 2h6M12 2v4M18 6l2-2"/></svg>';node.prepend(icon);return node;
}
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
function acceptedAthletes() { const ids=new Set(state.relations.filter(r=>r.status==='accepted').map(r=>r.athlete_id)); return state.athletes.filter(a=>a.user_id===state.user?.id || isCoach()&&ids.has(a.id)&&a.user_id).sort((a,b)=>Number(b.user_id===state.user?.id)-Number(a.user_id===state.user?.id)); }
function clearCalendar() {if($('dayAddDialog').open)$('dayAddDialog').close();sortables.forEach(s=>s.destroy());sortables=[];$('calendar').replaceChildren();}
async function refreshAccount() {
  if(!state.user||destroyed)return false;
  const ticket=++accountTicket,userId=state.user.id;
  const account=await loadAccount(state.user);
  if(ticket!==accountTicket||destroyed||state.user?.id!==userId)return false;
  Object.assign(state,account);
  state.groupsError=null;state.groupsAvailable=false;
  if(isCoach()&&account.planningAvailable&&dataApi.loadTrainingGroups) {
    try { const groups=await dataApi.loadTrainingGroups();if(ticket!==accountTicket||destroyed||state.user?.id!==userId)return false;state.groups=groups;state.groupsAvailable=true; }
    catch(error) { if(ticket!==accountTicket||destroyed||state.user?.id!==userId)return false;state.groups=[];state.groupsError=error.message; }
  } else state.groups=[];
  const groupFromURL=new URL(location.href).searchParams.get('group');
  state.selectedGroup=state.surface==='calendar'?(state.groups.find(g=>g.id===(state.selectedGroup?.id||groupFromURL))||null):null;
  const available=acceptedAthletes();
  const fromURL=new URL(location.href).searchParams.get('athlete');
  state.selectedAthlete=(location.hash==='#coachs'?available.find(a=>a.user_id===state.user.id):null)||available.find(a=>a.id===state.selectedAthlete?.id)||available.find(a=>a.id===fromURL)||available[0]||null;
  if(state.selectedGroup)state.selectedAthlete=null;
  state.relation=state.relations.find(r=>r.athlete_id===state.selectedAthlete?.id && r.coach_id===state.user.id)||null;
  renderAccount();
  void connectionsUI.refreshNotice?.();
  return true;
}
function renderAccount() {
  mountNavigation({role:state.profile.account_type,isAdmin:state.profile.is_admin,section:state.surface});
  $('accountName').textContent=state.profile.full_name || state.user.email;
  $('gymBrand').textContent=isCoach()?(state.gym?.gym_name||'Mon gym'):'Mon entraînement';
  $('gymAddress').textContent=isCoach()?(state.gym?.address||''):'';
  $('gymAddress').hidden=!$('gymAddress').textContent;
  $('gymHome').href=isCoach()?'./':'planning.html';
  document.title=`Planification — ${$('gymBrand').textContent}`;
  $('rosterLink').hidden=!isCoach();$('libraryButton').hidden=!state.planningAvailable;$('adminLink').hidden=!state.profile.is_admin;
  $('connectionsButton').hidden=!state.planningAvailable;
  $('planningUnavailable').hidden=state.planningAvailable;
  $('workspace').hidden=!state.planningAvailable;
  if(!state.planningAvailable) {
    clearCalendar();$('athleteList').replaceChildren();
    $('planningUnavailable').querySelector('p').textContent=isCoach()?'Les fiches de tes athlètes, tes contacts et tes listes combat/sparring restent accessibles.':'Ton calendrier sera accessible une fois la planification activée.';
    $('planningUnavailable').querySelector('a').hidden=!isCoach();
    return;
  }
  $('athleteSidebar').hidden=!isCoach();$('athletePickerButton').hidden=!isCoach();$('workspace').classList.toggle('athlete-workspace',!isCoach());
  $('todayViewButton').hidden=false;$('addSessionButton').hidden=!canAdd();
  $('addEventButton').hidden=!canAdd();
  $('inviteButton').hidden=!isCoach()||!state.selectedAthlete||!!state.selectedAthlete.user_id;
  $('noAthlete').hidden=!!state.selectedAthlete||!!state.selectedGroup||!isCoach();
  $('calendarSection').hidden=!state.selectedAthlete&&!state.selectedGroup;
  $('athleteTitle').textContent=state.selectedGroup?state.selectedGroup.name:ownsCalendar()?'Mon calendrier':isCoach()?(state.selectedAthlete?displayName(state.selectedAthlete):'Calendrier d’entraînement'):'Mon calendrier';
  $('athleteTitle').classList.toggle('group-calendar-badge',!!state.selectedGroup);
  if(state.selectedGroup)$('athleteTitle').prepend(groupIcon());
  $('viewEyebrow').textContent='PLANIFICATION DES ENTRAÎNEMENTS';
  $('athleteSubtitle').textContent=state.selectedGroup?`Groupe · ${state.selectedGroup.athlete_ids.length} membre${state.selectedGroup.athlete_ids.length>1?'s':''} · Séances et notes communes` : !ownsCalendar()&&isCoach()?'Séances et notes de cet athlète.':'Séances, notes et bilans.';
  if(!isCoach()&&!state.selectedAthlete) {$('calendarStatus').textContent='Aucun profil athlète lié. Ouvre ton lien d’invitation ou reconnecte-toi après la création de ton compte.';$('calendarSection').hidden=false;}
  renderAthleteList();
  renderSurface();
}
function renderSurface(){
 const journal=state.surface==='journal';
 $('journalSection').hidden=!journal;$('calendarSection').hidden=journal||(!state.selectedAthlete&&!state.selectedGroup);
 document.querySelector('.intro-actions').hidden=journal;$('athleteSubtitle').hidden=journal;
 if(journal){$('athleteTitle').textContent=state.selectedGroup?state.selectedGroup.name:ownsCalendar()?'Mon journal':state.selectedAthlete?'Journal · '+displayName(state.selectedAthlete):'Journal';journalUI.refresh();}
}
function setSurface(surface){if(surface==='journal'&&state.selectedGroup){state.selectedGroup=null;state.selectedAthlete=acceptedAthletes().find(a=>a.user_id===state.user.id)||acceptedAthletes()[0]||null;state.relation=state.relations.find(r=>r.athlete_id===state.selectedAthlete?.id);void refreshCalendar();}state.surface=surface;const url=new URL(location.href);url.hash=surface==='journal'?'journal':'';if(surface==='journal')url.searchParams.delete('group');history.replaceState(history.state,'',url);if(surface==='calendar')journalUI.invalidate();renderAccount();}
function searchName(value) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr'); }
function avatarTone(athlete) {
  // Stable identity, independent of list order, search or a changed display name.
  const identity = String(athlete.id || athlete.user_id || displayName(athlete));
  let hash = 0;
  for (const character of identity) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
  return String(hash % 6);
}
function groupIcon() {
  const span=el('span',{'aria-hidden':'true'});span.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M17 4a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 5v3"/></svg>';return span;
}
function rememberSelection() { const url=new URL(location.href);url.searchParams.delete('athlete');url.searchParams.delete('group');if(state.selectedGroup)url.searchParams.set('group',state.selectedGroup.id);else if(state.selectedAthlete)url.searchParams.set('athlete',state.selectedAthlete.id);history.replaceState(history.state,'',url); }
function renderAthleteList() {
  const query=searchName($('athleteSearch').value.trim());
  $('athleteList').replaceChildren();
  const list=acceptedAthletes().filter(a=>searchName(a.user_id===state.user?.id?'Mon calendrier '+displayName(a):displayName(a)).includes(query));
  if(list.length)$('athleteList').append(el('h3',{class:'picker-section-title'},'Athlètes'));
  for(const athlete of list) {
    const item=button('',async()=>{
      $('athletePickerDialog').close();
      if(athlete.id===state.selectedAthlete?.id) return;
      state.selectedGroup=null;state.selectedAthlete=athlete;rememberSelection();state.relation=state.relations.find(r=>r.athlete_id===athlete.id);
      renderAccount();await refreshCalendar();
    },`athlete-item${athlete.id===state.selectedAthlete?.id?' active':''}`,{'aria-pressed':String(athlete.id===state.selectedAthlete?.id)});
    const relation=state.relations.find(r=>r.athlete_id===athlete.id);
    const status=athlete.user_id===state.user?.id?'Personnel':!athlete.user_id?'Fiche sans compte':relation?.can_view_calendar===false?'Accès calendrier non autorisé':'Compte lié';
    item.append(el('span',{class:'athlete-avatar','aria-hidden':'true',dataset:{avatarTone:avatarTone(athlete)}},initials(athlete)),el('span',{},el('strong',{},displayName(athlete)),el('small',{},status)));
    if(athlete.user_id)item.append(el('span',{class:'dot','aria-hidden':'true'}));
    $('athleteList').append(item);
  }
  const groups=(state.groups||[]).filter(group=>searchName(group.name).includes(query));
  if(groups.length)$('athleteList').append(el('h3',{class:'picker-section-title'},'Groupes'));
  for(const group of groups) {
    const active=state.selectedGroup?.id===group.id;
    const item=button('',async()=>{ $('athletePickerDialog').close();if(active)return;state.selectedGroup=group;state.selectedAthlete=null;state.relation=null;state.surface='calendar';journalUI.invalidate();const url=new URL(location.href);url.hash='';history.replaceState(history.state,'',url);rememberSelection();renderAccount();await refreshCalendar(); },`athlete-item${active?' active':''}`,{'aria-pressed':String(active)});
    item.append(el('span',{class:'athlete-avatar group-avatar','aria-hidden':'true'},groupIcon()),el('span',{},el('strong',{},group.name),el('small',{},`Groupe · ${group.athlete_ids.length} membre${group.athlete_ids.length>1?'s':''}`)));$('athleteList').append(item);
  }
  if(state.groupsError)$('athleteList').append(el('p',{class:'empty-message'},'Groupes indisponibles : '+state.groupsError));
  if(!list.length&&!groups.length) {
    $('athleteList').append(el('p',{class:'empty-message'},query?'Aucun athlète correspondant.':'Aucun compte athlète lié. Les fiches sans compte sont dans « Mes athlètes ».'));
    if(isCoach())$('athleteList').append(el('a',{href:'roster.html',class:'button secondary'},'Ouvrir Mes athlètes'));
  }
}
async function refreshCalendar({throwOnError=false}={}) {
  const ticket=++calendarTicket;
  clearCalendar();state.sessions=[];state.events=[];state.feedback=[];state.runningWeekSessions=null;state.runningWeekError=false;
  renderPeriod();renderTotals();$('calendar').removeAttribute('aria-busy');
  if(!state.planningAvailable||(!state.selectedAthlete&&!state.selectedGroup)) return;
  if(!canView()) {$('calendarStatus').textContent='L’accès au calendrier doit être autorisé par l’athlète dans « Mes coachs ».';renderTotals();return;}
  $('calendarStatus').textContent='Chargement du calendrier…';
  $('calendar').setAttribute('aria-busy','true');
  const dates=datesForView(state.anchor,state.view);
  const week=datesForView(state.anchor,'week'),athleteId=state.selectedGroup?.id||state.selectedAthlete.id,userId=state.user?.id;
  const groupCalendar=!!state.selectedGroup,load=groupCalendar?dataApi.loadGroupCalendar:loadCalendar;
  const coversWeek=dates[0]<=week[0]&&dates.at(-1)>=week.at(-1);
  try {
    const [periodResult,weekResult]=await Promise.allSettled([
      load(athleteId,dates[0],dates.at(-1)),
      ...(coversWeek?[]:[load(athleteId,week[0],week.at(-1))]),
    ]);
    if(ticket!==calendarTicket||destroyed||state.user?.id!==userId||(state.selectedGroup?.id||state.selectedAthlete?.id)!==athleteId||!!state.selectedGroup!==groupCalendar)return;
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
  $('calendarFootnote').textContent=canAdd()?'Glisse tes séances et notes par leur poignée, ou utilise « Modifier » pour changer la date. Aucune heure n’est imposée.':'Les séances sont organisées par date. Ouvre une fiche pour lire les instructions et les retours.';
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
const sessionColor=session=>session.workout_document?.banner_color||'sand';
function sessionCard(session) {
  const sport=SPORTS.find(s=>s.id===session.sport)||SPORTS.at(-1), summary=summarizeBlocks(session.blocks);
  const completed=Boolean(session.completed_at);
  const card=el('article',{class:`session-card${completed?' is-completed':''}`,dataset:{sessionId:session.id}});
  applyEventColor(card,sessionColor(session));
  const top=el('div',{class:'session-top'},el('span',{class:'sport-tag',dataset:{sport:session.sport}},`${sport.icon} ${sport.label}`));
  if(canDrag(session))top.append(button('⠿',()=>{},'drag-handle',{'aria-label':`Déplacer ${session.title} par glisser-déposer`,title:'Glisser pour déplacer. Pour changer la date au clavier, ouvre la séance puis Modifier.'}));
  if(isCommon(session)||session.is_locked!==false)top.append(calendarAccessBadge('locked',isCommon(session)?'Séance commune · modifiable par son auteur pour tous les destinataires':'Verrouillée · modifiable uniquement par son créateur'));
  const titleRow=el('div',{class:'session-title-row'},button(session.title,()=>sessionUI.showSession(session),'session-title'));
  if(state.view==='month')titleRow.querySelector('button').setAttribute('aria-label',`${session.title} · ${completed?'Faite':'À faire'} · Ouvrir la séance`);
  card.append(el('header',{class:'session-card-header'},top,titleRow));
  const meta=[];if(summary.hasTime)meta.push(formatDuration(summary.duration_seconds));if(summary.hasDistance)meta.push(`${new Intl.NumberFormat('fr-CA',{maximumFractionDigits:2}).format(summary.distance_m/1000)} km`);
  if(!meta.length)meta.push(session.blocks.length?`${session.blocks.length} bloc${session.blocks.length>1?'s':''}`:'Instructions libres');
  card.append(el('div',{class:'session-meta'},meta.join(' · ')));
  if(['running','boxing','sparring'].includes(session.sport))card.append(renderSessionChart(session,{summary}));
  card.append(el('p',{class:'session-author'},`Par ${session.author_name||'Coach'}`));
  const footer=state.view==='month'?null:el('div',{class:'session-card-footer'},sessionTimerButton(session));
  if(!footer)card.append(sessionTimerButton(session));
  if(ownsCalendar()&&state.view!=='month') {
    const toggle=button('',async()=>{
      if(toggle.disabled)return;
      toggle.disabled=true;
      try{await sessionUI.setCompleted(session,!completed);}catch(error){toast(error.message||'Impossible d’enregistrer le statut.');}
      finally{toggle.disabled=false;}
    },'completion-button',{'aria-pressed':String(completed),'aria-label':`${completed?'Annuler la réalisation de':'Marquer comme faite :'} ${session.title}`});
    toggle.title=completed?'Annuler « faite »':'Marquer comme faite';
    toggle.append(el('span',{'aria-hidden':'true'},completed?'✓':'○'),el('span',{},'Fait'));
    footer.append(toggle);
  }else if(!state.selectedGroup&&footer)footer.append(el('span',{class:`completion-pill ${completed?'completed':'pending'}`},completed?'✓ Faite':'À faire'));
  const feedback=state.feedback.find(f=>f.session_id===session.id);
  if(!state.selectedGroup&&completed&&feedback&&(!isCoach()||state.relation?.can_view_feedback!==false))card.append(el('div',{class:'feedback-pill'},`${feedback.feeling?feelings[feedback.feeling]+' ':''}${feedback.rpe?'RPE '+feedback.rpe+'/10':'Retour reçu'}${feedback.comment?' · commentaire':''}`));
  if(footer)card.append(footer);
  return card;
}
function calendarAccessBadge(name,label) {
  return el('span',{class:`lock-badge calendar-access-icon ${name}`,role:'img','aria-label':label,title:label},accessIcon(name));
}
function eventCard(event,{span=null,mobile=false}={}) {
  const end=event.end_date||event.date,multiple=end!==event.date;
  const range=multiple?`${dateLabel(event.date,{day:'numeric',month:'short'})} – ${dateLabel(end,{day:'numeric',month:'short'})}`:dateLabel(event.date,{day:'numeric',month:'short'});
  const card=el('article',{class:`event-card${span?' event-span':''}${mobile?' event-mobile-span':span?' event-desktop-span':''}`,dataset:{eventId:event.id,anchorDate:span?.start||event.date},'aria-label':`${event.title} · ${range}`});
  applyEventColor(card,event.color);
  const open=button('',()=>sessionUI.showEvent(event),'event-open',{'aria-label':`${event.title} · ${range} · Ouvrir la note`});
  open.append(el('strong',{},event.title));
  const preview=String(event.notes||'').trim().replace(/\s+/g,' ');
  if(preview)open.append(el('span',{class:'event-preview'},preview));
  if(multiple)open.append(el('span',{class:'event-date-range'},range));
  const controls=el('div',{class:'event-controls'});
  if(isCommon(event)||event.is_locked!==false)controls.append(calendarAccessBadge('locked',isCommon(event)?'Note commune · modifiable par son auteur pour tous les destinataires':'Verrouillée · modifiable uniquement par son créateur'));
  if(event.is_private)controls.append(calendarAccessBadge('private','Privée · visible uniquement par son auteur'));
  if(canDrag(event))controls.append(button('⠿',event=>{event.preventDefault();event.stopPropagation();},'event-drag-handle',{'aria-label':`Déplacer ${event.title} par glisser-déposer`,title:'Glisser pour déplacer toute la plage. Au clavier, ouvre la note puis Modifier.'}));
  card.append(open);if(controls.childElementCount)card.append(controls);
  if(span){card.classList.toggle('continues-before',span.continuesBefore);card.classList.toggle('continues-after',span.continuesAfter);if(!mobile){card.style.gridColumn=`${span.startIndex+1} / ${span.endIndex+2}`;card.style.gridRow=String(span.lane+1);}}
  return card;
}
function calendarSortable(content,{bands=false}={}) {
  if(!canView())return;
  sortables.push(new Sortable(content,{
    group:{name:'training-calendar',pull:true,put:!bands},sort:!bands,animation:150,
    handle:'.drag-handle, .event-drag-handle',draggable:'.session-card, .event-card',ghostClass:'sortable-ghost',
    delay:170,delayOnTouchOnly:true,touchStartThreshold:5,fallbackOnBody:true,
    filter:(_event,target)=>{const card=target.closest('.session-card, .event-card');return !canDrag(card?.dataset.eventId?state.events.find(e=>e.id===card.dataset.eventId)||{}:state.sessions.find(s=>s.id===card?.dataset.sessionId)||{});},
    onMove:()=>!dragSaving,
    onEnd:event=>event.item.dataset.eventId?handleEventDrop(event):handleDrop(event),
  }));
}
function renderCalendar() {
  clearCalendar();const calendar=$('calendar');calendar.className=`calendar calendar-spanning${state.view==='month'?' month':state.view==='today'?' today-view':''}`;
  const dates=datesForView(state.anchor,state.view),events=orderedEvents(state.events.filter(event=>!event.is_private||event.created_by===state.user?.id));
  for(let offset=0;offset<dates.length;offset+=7){
    const weekDates=dates.slice(offset,offset+7),week=el('div',{class:'calendar-week',dataset:{weekStart:weekDates[0]}});
    const layout=state.view==='today'?{spans:[],lanes:0}:eventSpans(events,weekDates);
    const lanes=el('div',{class:'calendar-event-lanes','aria-label':'Notes sur plusieurs jours'});lanes.hidden=!layout.spans.length;
    for(const span of layout.spans){const card=eventCard(span.event,{span});if(span.lane>0)card.classList.add('month-overflow-span');lanes.append(card);}
    for(const [index,date] of weekDates.entries()) {
      const day=el('section',{class:`day${date===todayLocal()?' today':''}${date.slice(0,7)!==state.anchor.slice(0,7)?' outside-month':''}`,dataset:{date},'aria-label':dateLabel(date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})});
      day.style.gridColumn=String(index+1);
      const dateNumber=el('span',{class:'date-number','aria-label':date===todayLocal()?'Aujourd’hui':undefined},String(Number(date.slice(8))));
      const heading=el('header',{class:'day-heading'},el('span',{class:'weekday'},dateLabel(date,{weekday:'short'})));
      if(state.view==='month') {
        const sessionCount=state.sessions.filter(s=>s.date===date).length,noteCount=events.filter(e=>eventOnDate(e,date)).length;
        const open=button('',()=>openCalendarDay(date),'month-day-button',{'aria-label':`Ouvrir le ${dateLabel(date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})} : ${sessionCount} séance(s), ${noteCount} note(s)`});
        open.append(dateNumber,el('span',{class:'month-day-summary','aria-hidden':'true'},sessionCount?`${sessionCount} S`:'',el('span',{},noteCount?`${noteCount} N`:'')));
        heading.append(open);
      } else heading.append(dateNumber);
      day.append(heading);
      const content=el('div',{class:'day-content',dataset:{date}});
      for(const event of events.filter(event=>eventOnDate(event,date)&&(state.view==='today'||!event.end_date||event.end_date===event.date)))content.append(eventCard(event));
      for(const span of layout.spans.filter(span=>span.start===date))content.append(eventCard(span.event,{span,mobile:true}));
      const sessions=orderedSessions(state.sessions.filter(s=>s.date===date));sessions.forEach(s=>content.append(sessionCard(s)));
      if(state.view==='month') {
        const dayNotes=events.filter(e=>eventOnDate(e,date));
        const spans=layout.spans.filter(span=>span.lane===0&&index>=span.startIndex&&index<=span.endIndex);
        const singleNotes=dayNotes.filter(e=>!e.end_date||e.end_date===e.date);
        const previews=chooseMonthPreviews(sessions,singleNotes,spans.length),compact=el('div',{class:'month-mobile-content'});
        for(const {kind,item} of previews)compact.append(kind==='session'?monthSessionPreview(item,()=>sessionUI.showSession(item)):monthNotePreview(item,()=>sessionUI.showEvent(item)));
        const hidden=sessions.length+dayNotes.length-previews.length-spans.length;
        if(hidden>0)compact.append(button(`+${hidden}`,()=>openCalendarDay(date),'month-more',{'aria-label':`Voir les ${hidden} autres éléments du ${dateLabel(date)}`}));
        day.append(compact);
      }
      content.append(el('div',{class:'empty-day'},'Aucune séance prévue'));day.append(content);
      const actions=el('footer',{class:'day-actions'});
      if(canAdd())actions.append(button('＋',event=>openDayAddMenu(date,event.currentTarget),'add-day',{'aria-label':`Ajouter le ${dateLabel(date)}`,'aria-haspopup':'dialog','aria-controls':'dayAddDialog'}));
      day.append(actions);week.append(day);calendarSortable(content);
    }
    week.append(lanes);calendar.append(week);calendarSortable(lanes,{bands:true});
  }
}
async function openCalendarDay(date) { state.anchor=date;state.view='today';rememberView('today');await refreshCalendar();if(!destroyed&&state.view==='today'&&state.anchor===date)$('todayViewButton').focus(); }
let dayAddTrigger=null;
function openDayAddMenu(date,trigger) {
  if(!canAdd())return;
  const dialog=$('dayAddDialog'),context={userId:state.user.id,athleteId:state.selectedAthlete?.id,groupId:state.selectedGroup?.id,account:accountTicket,calendar:calendarTicket};
  const current=()=>!destroyed&&canAdd()&&state.user?.id===context.userId&&state.selectedAthlete?.id===context.athleteId&&state.selectedGroup?.id===context.groupId&&accountTicket===context.account&&calendarTicket===context.calendar;
  const run=action=>{dialog.close();if(current())action();};
  $('dayAddTitle').textContent=dateLabel(date,{weekday:'long',day:'numeric',month:'long'});
  $('dayAddContext').textContent=state.selectedGroup?`Groupe · ${state.selectedGroup.name}`:ownsCalendar()?'Mon calendrier':displayName(state.selectedAthlete);
  const actions=[
    ['libraryButton','Bibliothèque',()=>libraryUI.open({kind:'session',onSelect:template=>{if(current())sessionUI.editSession({...template,id:undefined,athlete_id:context.athleteId,date},date,true);}})],
    ['addSessionButton','Planifier une séance',()=>sessionUI.editSession(null,date)],
    ['addEventButton','Notes',()=>sessionUI.editEvent(null,date)],
  ];
  $('dayAddOptions').replaceChildren(...actions.map(([source,label,action])=>{
    const item=button('',()=>run(action),'day-add-option');
    item.append($(source).querySelector('svg').cloneNode(true),el('span',{},label));return item;
  }));
  dayAddTrigger=trigger;openDialog(dialog,$('dayAddTitle'));
}
$('closeDayAdd').addEventListener('click',()=>$('dayAddDialog').close());
$('dayAddDialog').addEventListener('click',event=>{if(event.target===$('dayAddDialog'))$('dayAddDialog').close();});
$('dayAddDialog').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();$('dayAddDialog').close();}});
$('dayAddDialog').addEventListener('close',()=>{if(dayAddTrigger?.isConnected&&!document.querySelector('dialog[open]'))dayAddTrigger.focus({preventScroll:true});dayAddTrigger=null;});
async function handleEventDrop(event) {
  const note=state.events.find(note=>note.id===event.item.dataset.eventId),targetDate=event.to.dataset.date;
  if(!note||!targetDate||!canDrag(note)||dragSaving){renderCalendar();return;}
  const anchor=event.item.dataset.anchorDate||note.date;
  if(event.from===event.to&&event.oldDraggableIndex===event.newDraggableIndex){renderCalendar();return;}
  const context={calendarId:state.selectedGroup?.id||state.selectedAthlete?.id,group:!!state.selectedGroup,userId:state.user.id,ticket:calendarTicket};
  const sameContext=()=>!destroyed&&(state.selectedGroup?.id||state.selectedAthlete?.id)===context.calendarId&&!!state.selectedGroup===context.group&&state.user?.id===context.userId;
  dragSaving=true;$('calendarStatus').textContent='Enregistrement du déplacement…';
  try{
    const dates=moveEventDates(note,targetDate,anchor),cards=[...event.to.querySelectorAll(':scope > .event-card')].filter(card=>card===event.item||card.dataset.eventId!==note.id),index=cards.indexOf(event.item);
    const before=index>0?state.events.find(note=>note.id===cards[index-1].dataset.eventId):null;
    const after=index>=0&&index<cards.length-1?state.events.find(note=>note.id===cards[index+1].dataset.eventId):null;
    const payload={...dates,sort_order:positionBetween(before,after)};
    const saved=await dataApi.saveEvent(payload,note);
    if(sameContext()){
      if(calendarTicket===context.ticket){state.events=state.events.map(item=>item.id===note.id?{...note,...payload,...saved}:item);renderCalendar();$('calendarStatus').textContent='';}
      else await refreshCalendar();
    }
    toast('Note déplacée.');
  }catch(error){if(sameContext()&&calendarTicket===context.ticket){renderCalendar();$('calendarStatus').textContent='';}toast(error.message||'Le déplacement n’a pas été enregistré.');}
  finally{dragSaving=false;}
}
async function handleDrop(event) {
  if(event.from===event.to && event.oldDraggableIndex===event.newDraggableIndex)return;
  const session=state.sessions.find(s=>s.id===event.item.dataset.sessionId);
  if(!session||!canDrag(session)||dragSaving){renderCalendar();return;}
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
  client.auth.onAuthStateChange((event,session)=>{
    const changed=event==='SIGNED_IN'&&state.user&&session?.user?.id&&session.user.id!==state.user.id;
    if(event!=='SIGNED_OUT'&&!changed)return;
    destroyed=true;timerRequest++;activeSessionTimer?.ui.destroy();activeSessionTimer=null;journalUI.invalidate();calendarTicket++;accountTicket++;clearCalendar();
    Object.assign(state,{user:null,profile:null,gym:null,coach:null,relation:null,relations:[],sessions:[],events:[],feedback:[],athletes:[],groups:[],selectedGroup:null,selectedAthlete:null,runningWeekSessions:null});
    $('athleteList').replaceChildren();$('gymBrand').textContent='Mon espace';
    $('gymAddress').textContent='';$('gymAddress').hidden=true;$('accountName').textContent='';
    document.title='Planification';
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());
    $('workspace').hidden=true;$('planningUnavailable').hidden=true;
    location.replace(changed?'planning.html':'login.html');
  });
  if(invitation){
    try{await rpc('accept_invitation',{p_token:invitation});sessionStorage.removeItem('pendingInvite');const clean=new URL(location.href);clean.searchParams.delete('invite');history.replaceState({},'',clean);$('connectionBanner').textContent='Invitation acceptée. Ton calendrier est maintenant partagé avec ton coach.';$('connectionBanner').hidden=false;}
    catch(error){$('connectionBanner').textContent=error.message||'Impossible d’accepter cette invitation.';$('connectionBanner').hidden=false;}
  }
  if(!await refreshAccount())return;
  state.view=restoreView();$('loading').hidden=true;
  if(new URL(location.href).searchParams.get('coachs')==='1'&&state.planningAvailable)connectionsUI.open();
  if(state.planningAvailable)await refreshCalendar();
}
$('journalButton').addEventListener('click',()=>setSurface('journal'));
$('calendarButton').addEventListener('click',()=>setSurface('calendar'));
$('athleteSearch').addEventListener('input',renderAthleteList);
$('athletePickerButton').addEventListener('click',()=>{
  if(!isCoach())return;
  $('athleteSearch').value='';renderAthleteList();openDialog($('athletePickerDialog'),$('athleteSearch'));
});
$('closeAthletePicker').addEventListener('click',()=>$('athletePickerDialog').close());
$('athletePickerDialog').addEventListener('close',()=>$('athletePickerButton').focus());
$('previousButton').addEventListener('click',()=>{state.anchor=shiftPeriod(state.anchor,state.view,-1);refreshCalendar();});
$('nextButton').addEventListener('click',()=>{state.anchor=shiftPeriod(state.anchor,state.view,1);refreshCalendar();});
$('todayButton').addEventListener('click',()=>{state.anchor=todayLocal();refreshCalendar();});
$('viewButtons').addEventListener('click',event=>{const view=event.target.closest('[data-view]')?.dataset.view;if(calendarViews.has(view)){state.view=view;rememberView(view);refreshCalendar();}});
$('addSessionButton').addEventListener('click',()=>sessionUI.editSession(null,state.anchor));
$('addEventButton').addEventListener('click',()=>sessionUI.editEvent(null,state.anchor));
$('inviteButton').addEventListener('click',()=>connectionsUI.inviteAthlete());
$('connectionsButton').addEventListener('click',()=>connectionsUI.open({personal:ownsCalendar()}));
$('connectionsButton').addEventListener('open-personal-connections',()=>connectionsUI.open({personal:true}));
$('manageConnectionsButton').addEventListener('click',()=>{$('athletePickerDialog').close();connectionsUI.open();});
$('libraryButton').addEventListener('click',()=>libraryUI.open());
$('logoutButton').addEventListener('click',async()=>{try{const {error}=await client.auth.signOut();if(error)throw error;}catch(error){toast(error.message);}});
window.addEventListener('offline',()=>{$('connectionBanner').textContent='Connexion interrompue. Reconnecte-toi avant d’enregistrer des changements.';$('connectionBanner').hidden=false;});
window.addEventListener('online',()=>{$('connectionBanner').hidden=true;refreshCalendar();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.user&&state.profile&&!document.querySelector('dialog[open]')&&!dragSaving){refreshAccount().then(refreshCalendar).catch(fatal);}});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
init().catch(fatal);

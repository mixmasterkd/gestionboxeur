import { getStarterTemplates } from './starter-templates.js';
/** Development-only calendar preview. All data stays in memory, with no account or network writes. */
import { todayLocal, weekStart, addDays, makeBlock } from './domain.js';

const role = new URL(location.href).searchParams.get('demo') === 'athlete' ? 'athlete' : 'coach';
const user = { id: role === 'athlete' ? 'preview-athlete-user' : 'preview-coach', email: 'apercu@example.test' };
const athlete = { id:'preview-athlete',user_id:'preview-athlete-user',first_name:'Alex',last_name:'Morin',birth_date:'2002-06-14',sex:'M',weight_kg:72,status:'available' };
const coachAthlete={id:'preview-coach-athlete',user_id:'preview-coach',first_name:'Camille',last_name:'',birth_date:null,sex:null,status:'available'};
const relations = [{athlete_id:athlete.id,coach_id:'preview-coach',status:'accepted',can_view_calendar:true,can_add_sessions:true,can_edit_own_sessions:true,can_view_feedback:true}];
const start=weekStart(), step=(type,title,seconds,zone)=>({...makeBlock(type),title,duration_seconds:seconds,zone});
const intervals=[step('warmup','Échauffement progressif',600,2),{...makeBlock('repeat'),title:'Vitesse contrôlée',repeat_count:6,children:[step('interval','Accélération',120,4),step('recovery','Récupération active',60,1)]},step('recovery','Retour au calme',300,1)];
let serial=0;
const stamp=()=>`preview-${++serial}`;
const workout=(id,title,sport,date,blocks,locked=false,author='preview-coach')=>({id,athlete_id:athlete.id,created_by:author,author_name:author==='preview-coach'?'Camille · Coach':author===athlete.user_id?'Alex Morin':'Sam · Préparation physique',title,sport,date,sort_order:1024,description:'Construire de bonnes sensations. Garde une exécution propre jusqu’au dernier bloc.',notes:'Échauffement, hydratation, puis place au travail.',blocks,is_locked:locked,completed_at:null,updated_at:stamp()});
let sessions=[
  workout('preview-run','Trouver son rythme','running',todayLocal(),intervals),
  workout('preview-box','Précision & déplacements','boxing',todayLocal(),[{...step('shadow','Shadow technique',null,null),rounds:4,work_seconds:180,rest_seconds:60,description:'Jab, sortie d’axe et replacement.'},{...step('bag','Sac · enchaînements',null,null),rounds:6,work_seconds:180,rest_seconds:60}],true),
  workout('preview-strength','Une base solide','strength',addDays(start,3),[{...makeBlock('repeat'),title:'Circuit',repeat_count:3,children:[{...makeBlock('strength'),title:'Squats',repetitions:12},{...makeBlock('strength'),title:'Pompes',repetitions:10},step('recovery','Repos',60,1)]}]),
  workout('preview-distance','Intervalles · 400 mètres','running',addDays(start,5),[{...makeBlock('repeat'),title:'Piste',repeat_count:5,children:[{...makeBlock('interval'),title:'400 m soutenus',distance_m:400,zone:4},{...makeBlock('recovery'),title:'200 m faciles',distance_m:200,zone:1}]}],false,'preview-other-coach'),
  workout('preview-own','Mobilité du soir','mobility',addDays(start,4),[step('mobility','Hanches et épaules',900,null)],false,athlete.user_id),
];
let events=[{id:'preview-event',athlete_id:athlete.id,created_by:athlete.user_id,author_name:'Alex Morin',title:'Disponible après 17 h',category:'note',date:todayLocal(),end_date:null,notes:'Cours en journée. Je peux m’entraîner en fin d’après-midi.',is_locked:false,is_private:false,sort_order:1024,updated_at:stamp()}];
events.push(
 {id:'preview-range',athlete_id:athlete.id,created_by:'preview-coach',author_name:'Camille · Coach',title:'Suivi des déplacements',category:'note',date:addDays(todayLocal(),-1),end_date:addDays(todayLocal(),2),notes:'Observer les appuis et les sorties d’axe pendant les séances.',color:'blue',is_locked:false,is_private:false,sort_order:2048,updated_at:stamp()},
 {id:'preview-private-range',athlete_id:athlete.id,created_by:'preview-coach',author_name:'Camille · Coach',title:'Observations techniques',category:'note',date:todayLocal(),end_date:addDays(todayLocal(),1),notes:'Note privée de démonstration, visible seulement dans l’aperçu coach.',color:'lavender',is_locked:true,is_private:true,sort_order:3072,updated_at:stamp()},
);
let feedback=[];
let templates=[{id:'preview-template',coach_id:'preview-coach',title:'Intervalles · 6 × 2 min',sport:'running',description:'Une séance de course à adapter.',notes:'',blocks:intervals,kind:'session'}];
const clone=value=>structuredClone(value);
export const client={auth:{
  getSession:async()=>({data:{session:{user:clone(user)}}}),
  onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
  signOut:async()=>{location.href='login.html';return {};},
}};
export async function loadAccount() {
  mountPreviewBanner();
  return clone({profile:{id:user.id,full_name:role==='athlete'?'Alex Morin':'Camille',account_type:role,is_admin:false},gym:role==='coach'?{gym_name:'Le Crew',address:''}:null,planningAvailable:true,coach:role==='coach'?{user_id:user.id,join_code:'apercu-local'}:null,relations:role==='coach'?relations:[],athletes:role==='coach'?[coachAthlete,athlete]:[athlete]});
}
export async function loadCalendar(athleteId,begin,end) {
  return clone({sessions:sessions.filter(s=>s.athlete_id===athleteId&&s.date>=begin&&s.date<=end),events:events.filter(e=>e.athlete_id===athleteId&&e.date<=end&&(e.end_date||e.date)>=begin&&(!e.is_private||e.created_by===user.id)),feedback});
}
function save(list,payload,existing) {
  if(existing){const index=list.findIndex(item=>item.id===existing.id);if(index<0||list[index].updated_at!==existing.updated_at)throw new Error('Cet élément a changé. Actualise le calendrier.');list[index]={...list[index],...clone(payload),updated_at:stamp()};return clone(list[index]);}
  const item={...clone(payload),id:crypto.randomUUID(),author_name:role==='coach'?'Camille · Coach':'Alex Morin',updated_at:stamp()};list.push(item);return clone(item);
}
export async function saveSession(payload,existing){
 if(!existing&&Array.isArray(payload.athlete_ids)&&!payload.group_ids?.length&&new Set(payload.athlete_ids).size===1){
  const {group_ids,athlete_ids,...content}=payload;payload={...content,athlete_id:athlete_ids[0]};
 }
 if(existing?.shared_session_id&&!existing.is_group_session)throw new Error('Ouvre la séance commune pour modifier son contenu.');
 if(existing?.is_group_session||(!existing&&('group_ids' in payload||'athlete_ids' in payload))) {
  requireCoach();
  const old=existing?sharedSessions.find(s=>s.id===existing.id):null;
  if(existing&&(!old||old.updated_at!==existing.updated_at))throw new Error('Cette séance commune a changé. Actualise le calendrier.');
  const value={...old,...clone(payload),group_ids:[...new Set(payload.group_ids??old?.group_ids??[])],athlete_ids:[...new Set(payload.athlete_ids??old?.athlete_ids??[])],
   is_group_session:true,athlete_id:null,completed_at:null,created_by:user.id};
  if(!value.group_ids.length&&!value.athlete_ids.length)throw new Error('Choisis au moins une personne ou un groupe.');
  if(value.group_ids.some(id=>!groups.some(g=>g.id===id)))throw new Error('Groupe inaccessible.');
  const item=save(sharedSessions,value,existing);sharedSessions.find(s=>s.id===item.id).shared_session_id=item.id;
  syncShared(item.id,{content:true,allowPast:!existing});return getSharedSession(item.id);
 }
 return save(sessions,existing?payload:{...payload,completed_at:null},existing);
}
export async function saveEvent(payload,existing){
 if(!existing&&Array.isArray(payload.athlete_ids)&&!payload.group_ids?.length&&new Set(payload.athlete_ids).size===1){
  const {group_ids,athlete_ids,...content}=payload;payload={...content,athlete_id:athlete_ids[0]};
 }
 if(existing?.shared_event_id&&!existing.is_group_event)throw new Error('Ouvre la note commune pour modifier son contenu.');
 if(existing?.is_group_event||(!existing&&('group_ids' in payload||'athlete_ids' in payload))){
  requireCoach();const old=existing?sharedEvents.find(e=>e.id===existing.id):null;
  if(existing&&(!old||old.created_by!==user.id||old.updated_at!==existing.updated_at))throw new Error('Cette note commune a changé. Actualise le calendrier.');
  const value={category:'note',notes:'',color:'sand',end_date:null,is_locked:false,sort_order:1024,...old,...clone(payload),
   group_ids:[...new Set(payload.group_ids??old?.group_ids??[])],athlete_ids:[...new Set(payload.athlete_ids??old?.athlete_ids??[])],
   is_group_event:true,athlete_id:null,is_private:false,is_locked:true,created_by:user.id};
  if(!value.group_ids.length&&!value.athlete_ids.length)throw new Error('Choisis au moins une personne ou un groupe.');
  if(value.group_ids.some(id=>!groups.some(g=>g.id===id)))throw new Error('Groupe inaccessible.');
  if(value.athlete_ids.some(id=>![athlete.id,coachAthlete.id].includes(id)))throw new Error('Athlète inaccessible.');
  if(value.end_date&&value.end_date<value.date)throw new Error('La date de fin doit suivre la date de début.');
  const item=save(sharedEvents,value,existing);sharedEvents.find(e=>e.id===item.id).shared_event_id=item.id;
  syncSharedEvent(item.id,{content:true,allowPast:!existing});return getSharedEvent(item.id);
 }
 const stored=existing?events.find(event=>event.id===existing.id):null;
 if(stored?.is_private&&stored.created_by!==user.id)throw new Error('Cette note n’est plus accessible.');
 if(stored&&'is_private' in payload&&payload.is_private!==stored.is_private&&stored.created_by!==user.id)throw new Error('Seul l’auteur peut changer la confidentialité de cette note.');
 if(!stored&&payload.is_private&&payload.created_by!==user.id)throw new Error('La note privée doit appartenir à son auteur.');
 return save(events,existing?payload:{is_private:false,...payload},existing);
}
export async function deleteSession(item){
 if(item.is_group_session){
  requireCoach();const found=sharedSessions.find(s=>s.id===item.id);
  if(!found||found.updated_at!==item.updated_at)throw new Error('Cette séance commune a changé.');
  sessions=sessions.filter(s=>s.shared_session_id!==item.id||!removable(s));
  sessions.filter(s=>s.shared_session_id===item.id).forEach(s=>{s.shared_session_id=null;});
  sharedSessions=sharedSessions.filter(s=>s.id!==item.id);return;
 }
 if(item.shared_session_id)throw new Error('Ouvre la séance commune pour la supprimer.');
 sessions=sessions.filter(s=>s.id!==item.id);feedback=feedback.filter(f=>f.session_id!==item.id);
}
export async function deleteEvent(item){
 if(item.is_group_event){
  requireCoach();const found=sharedEvents.find(e=>e.id===item.id);
  if(!found||found.created_by!==user.id||found.updated_at!==item.updated_at)throw new Error('Cette note commune a changé.');
  events=events.filter(e=>e.shared_event_id!==item.id||e.date<todayLocal());
  events.filter(e=>e.shared_event_id===item.id).forEach(e=>{e.shared_event_id=null;e.updated_at=stamp();});
  sharedEvents=sharedEvents.filter(e=>e.id!==item.id);return;
 }
 if(item.shared_event_id)throw new Error('Ouvre la note commune pour la supprimer.');
 const event=events.find(e=>e.id===item.id);if(event?.is_private&&event.created_by!==user.id)throw new Error('Cette note n’est plus accessible.');events=events.filter(e=>e.id!==item.id);
}
export async function getTemplates(){return clone(templates);}
export async function saveTemplate(item){return save(templates,item);}
export async function updateTemplate(item,existing){return save(templates,item,existing);}
export async function deleteTemplate(id){templates=templates.filter(t=>t.id!==id);}
export async function rpc(name,args){
  if(name==='my_coaching_invitations')return [];
  if(name==='athlete_coaches')return clone(relations.map(r=>({...r,display_name:'Camille · Coach'})));
  if(name==='set_session_completed'){
    const session=sessions.find(item=>item.id===args.p_session_id);
    if(!session||session.athlete_id!==(role==='coach'?coachAthlete.id:athlete.id))throw new Error('Seul l’athlète concerné peut indiquer que cette séance est faite.');
    session.completed_at=args.p_completed?(session.completed_at||new Date().toISOString()):null;
    session.updated_at=stamp();return session.completed_at;
  }
  if(name==='save_session_feedback'){
    const session=sessions.find(item=>item.id===args.p_session_id);
    if(!session?.completed_at||session.athlete_id!==(role==='coach'?coachAthlete.id:athlete.id))throw new Error('Marque d’abord cette séance comme faite.');
    feedback=feedback.filter(f=>f.session_id!==args.p_session_id);feedback.push({session_id:args.p_session_id,athlete_id:session.athlete_id,rpe:args.p_rpe,feeling:args.p_feeling,comment:args.p_comment});return;
  }
  throw new Error('Cette action nécessite un compte connecté. L’aperçu permet de tester les séances et le calendrier avec des données fictives.');
}
function mountPreviewBanner(){
  if(document.getElementById('localPreviewBanner'))return;
  const banner=document.createElement('aside');banner.id='localPreviewBanner';banner.className='local-preview-banner';banner.setAttribute('aria-label','Aperçu local');
  const text=document.createElement('span');text.textContent=`Aperçu ${role==='coach'?'coach':'athlète'} · données fictives, réinitialisées au rechargement.`;
  const switcher=document.createElement('a');switcher.href=`planning.html?demo=${role==='coach'?'athlete':'coach'}`;switcher.textContent=role==='coach'?'Voir côté athlète →':'Voir côté coach →';
  const exit=document.createElement('a');exit.href='login.html';exit.textContent='Se connecter';banner.append(text,switcher,exit);document.body.prepend(banner);
}

let folders=[],journalEntries=[],journalUpdates=[];
export async function getLibraryFolders(){return clone(folders);}
export async function saveLibraryFolder(name,id){if(id){const folder=folders.find(f=>f.id===id);if(!folder)throw new Error('Dossier introuvable.');folder.name=name;return clone(folder);}const folder={id:crypto.randomUUID(),owner_id:user.id,name};folders.push(folder);return clone(folder);}
let libraryInitialized=false;
export async function initializeLibrary(){
 if(libraryInitialized)return false;
 for(const base of getStarterTemplates()){
  const name=base.sport==='running'?'Jog - Base':'Boxe - Base';
  let folder=folders.find(f=>f.name===name);if(!folder){folder={id:crypto.randomUUID(),owner_id:user.id,name};folders.push(folder);}
  const {title,sport,description,notes,blocks,workout_document}=base;
  await saveTemplate({title,sport,description,notes,blocks,workout_document,kind:'session',folder_id:folder.id,coach_id:user.id});
 }
 libraryInitialized=true;return true;
}
export async function deleteLibraryFolder(folder,contents){
 const found=folders.find(f=>f.id===folder.id),items=templates.filter(t=>t.folder_id===folder.id);
 if(!found||found.name!==folder.name||items.length!==contents.length||items.some(t=>!contents.some(e=>e.id===t.id&&e.updated_at===t.updated_at)))throw new Error('Le contenu du dossier a changé. Rouvre-le et vérifie son contenu avant de réessayer.');
 templates=templates.filter(t=>t.folder_id!==folder.id);folders=folders.filter(f=>f.id!==folder.id);return items.length;
}
export async function moveTemplate(template,folderId){return save(templates,{folder_id:folderId},template);}
export async function loadJournal(athleteId){const entries=journalEntries.filter(e=>e.athlete_id===athleteId);return clone({entries,updates:journalUpdates.filter(u=>entries.some(e=>e.id===u.entry_id))});}
function journalUpdate(entryId,kind,content=''){const item={id:crypto.randomUUID(),entry_id:entryId,kind,content,created_by:user.id,author_name:role==='coach'?'Camille · Coach':'Alex Morin',created_at:new Date().toISOString()};journalUpdates.push(item);return clone(item);}
export async function addJournalComment(entryId,content){return journalUpdate(entryId,'comment',content);}
export async function deleteJournalEntry(entry,updates){
 const current=journalEntries.find(row=>row.id===entry.id);
 const ids=journalUpdates.filter(row=>row.entry_id===entry.id).map(row=>row.id).sort();
 if(!current||current.updated_at!==entry.updated_at||JSON.stringify(ids)!==JSON.stringify(updates.map(row=>row.id).sort()))throw new Error('Ce sujet ou ses suivis ont changé. Rouvre-le avant de le supprimer.');
 journalEntries=journalEntries.filter(row=>row.id!==entry.id);journalUpdates=journalUpdates.filter(row=>row.entry_id!==entry.id);return entry.id;
}
export async function saveJournalEntry(payload,existing){
 const now=new Date().toISOString();
 if(existing){const entry=journalEntries.find(e=>e.id===existing.id);if(!entry||entry.updated_at!==existing.updated_at)throw new Error('Ce sujet a changé.');
 if(payload.status&&payload.status!==entry.status)journalUpdate(entry.id,'status',payload.status);
 if('archived' in payload&&payload.archived!==entry.archived)journalUpdate(entry.id,payload.archived?'archived':'restored');
 if('body' in payload&&(payload.body!==entry.body||payload.title!==entry.title))journalUpdate(entry.id,'edited',payload.body);
 Object.assign(entry,clone(payload),{updated_at:now});return clone(entry);}
 const entry={...clone(payload),id:crypto.randomUUID(),created_by:user.id,author_name:role==='coach'?'Camille · Coach':'Alex Morin',created_at:now,updated_at:now,archived:false};journalEntries.push(entry);journalUpdate(entry.id,'created',entry.body);return clone(entry);
}

let groups=role==='coach'?[{id:'preview-group',coach_id:user.id,name:'Boxe compétition',athlete_ids:[athlete.id],updated_at:stamp()}]:[];
let sharedSessions=[],sharedEvents=[];
function requireCoach(){if(role!=='coach')throw new Error('Compte coach requis.');}
function removable(session){return session.date>=todayLocal()&&!session.completed_at&&!feedback.some(f=>f.session_id===session.id);}
function syncShared(id,{content=false,allowPast=false}={}){
 const master=sharedSessions.find(s=>s.id===id);
 const targets=new Set([...master.athlete_ids,...groups.filter(g=>master.group_ids.includes(g.id)).flatMap(g=>g.athlete_ids)]);
 if([...targets].some(id=>![athlete.id,coachAthlete.id].includes(id)))throw new Error('Athlète inaccessible.');
 sessions=sessions.filter(s=>s.shared_session_id!==id||targets.has(s.athlete_id)||!removable(s));
 for(const target of targets){
  const copy=sessions.find(s=>s.shared_session_id===id&&s.athlete_id===target);
  const {group_ids,athlete_ids,is_group_session,...fields}=master;
  if(copy){if(content)Object.assign(copy,clone(fields),{id:copy.id,athlete_id:target,completed_at:copy.completed_at,updated_at:stamp()});}
  else if(allowPast||master.date>=todayLocal())sessions.push({...clone(fields),id:crypto.randomUUID(),shared_session_id:id,athlete_id:target,completed_at:null,updated_at:stamp()});
 }
}
function syncSharedEvent(id,{content=false,allowPast=false}={}){
 const master=sharedEvents.find(e=>e.id===id);
 const targets=new Set([...master.athlete_ids,...groups.filter(g=>master.group_ids.includes(g.id)).flatMap(g=>g.athlete_ids)]);
 if([...targets].some(id=>![athlete.id,coachAthlete.id].includes(id)))throw new Error('Athlète inaccessible.');
 events=events.filter(e=>e.shared_event_id!==id||targets.has(e.athlete_id)||e.date<todayLocal());
 for(const target of targets){
  const copy=events.find(e=>e.shared_event_id===id&&e.athlete_id===target);
  const {group_ids,athlete_ids,is_group_event,...fields}=master;
  if(copy){if(content)Object.assign(copy,clone(fields),{id:copy.id,athlete_id:target,updated_at:stamp()});}
  else if(allowPast||(master.end_date||master.date)>=todayLocal())events.push({...clone(fields),id:crypto.randomUUID(),shared_event_id:id,athlete_id:target,updated_at:stamp()});
 }
}
export async function loadTrainingGroups(){requireCoach();return clone(groups);}
export async function saveTrainingGroup(payload,existing){
 requireCoach();const name=String(payload.name||'').trim(),athlete_ids=[...new Set(payload.athlete_ids||[])];
 if(!name||name.length>100)throw new Error('Le nom du groupe doit contenir entre 1 et 100 caractères.');
 if(athlete_ids.some(id=>![athlete.id,coachAthlete.id].includes(id)))throw new Error('Athlète inaccessible.');
 const group=save(groups,{name,athlete_ids,coach_id:user.id},existing);
 sharedSessions.filter(s=>s.group_ids.includes(group.id)).forEach(s=>syncShared(s.id));
 sharedEvents.filter(e=>e.group_ids.includes(group.id)).forEach(e=>syncSharedEvent(e.id));return group;
}
export async function deleteTrainingGroup(group){
 requireCoach();const found=groups.find(g=>g.id===group.id);
 if(!found||found.updated_at!==group.updated_at)throw new Error('Ce groupe a changé.');
 groups=groups.filter(g=>g.id!==group.id);
 sharedSessions.filter(s=>s.group_ids.includes(group.id)).forEach(s=>{s.group_ids=s.group_ids.filter(id=>id!==group.id);syncShared(s.id);});
 sharedEvents.filter(e=>e.group_ids.includes(group.id)).forEach(e=>{e.group_ids=e.group_ids.filter(id=>id!==group.id);syncSharedEvent(e.id);});
}
export async function getSharedSession(id){requireCoach();const session=sharedSessions.find(s=>s.id===id);if(!session)throw new Error('Séance commune inaccessible.');return clone(session);}
export async function getSharedEvent(id){requireCoach();const event=sharedEvents.find(e=>e.id===id&&e.created_by===user.id);if(!event)throw new Error('Note commune inaccessible.');return clone(event);}
export async function loadGroupCalendar(groupId,start,end){requireCoach();return clone({sessions:sharedSessions.filter(s=>s.group_ids.includes(groupId)&&s.date>=start&&s.date<=end),events:sharedEvents.filter(e=>e.group_ids.includes(groupId)&&e.date<=end&&(e.end_date||e.date)>=start),feedback:[]});}

/** Development-only calendar preview. All data stays in memory, with no account or network writes. */
import { todayLocal, weekStart, addDays, makeBlock } from './domain.js';

const role = new URL(location.href).searchParams.get('demo') === 'athlete' ? 'athlete' : 'coach';
const user = { id: role === 'athlete' ? 'preview-athlete-user' : 'preview-coach', email: 'apercu@example.test' };
const athlete = { id:'preview-athlete',user_id:'preview-athlete-user',first_name:'Alex',last_name:'Morin',birth_date:'2002-06-14',sex:'M',weight_kg:72,status:'available' };
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
  return clone({profile:{id:user.id,full_name:role==='athlete'?'Alex Morin':'Camille',account_type:role,is_admin:false},gym:role==='coach'?{gym_name:'Le Crew',address:''}:null,planningAvailable:true,coach:role==='coach'?{user_id:user.id,join_code:'apercu-local'}:null,relations:role==='coach'?relations:[],athletes:[athlete]});
}
export async function loadCalendar(athleteId,begin,end) {
  return clone({sessions:sessions.filter(s=>s.athlete_id===athleteId&&s.date>=begin&&s.date<=end),events:events.filter(e=>e.athlete_id===athleteId&&e.date<=end&&(e.end_date||e.date)>=begin&&(!e.is_private||e.created_by===user.id)),feedback});
}
function save(list,payload,existing) {
  if(existing){const index=list.findIndex(item=>item.id===existing.id);if(index<0||list[index].updated_at!==existing.updated_at)throw new Error('Cet élément a changé. Actualise le calendrier.');list[index]={...list[index],...clone(payload),updated_at:stamp()};return clone(list[index]);}
  const item={...clone(payload),id:crypto.randomUUID(),author_name:role==='coach'?'Camille · Coach':'Alex Morin',updated_at:stamp()};list.push(item);return clone(item);
}
export async function saveSession(payload,existing){return save(sessions,existing?payload:{...payload,completed_at:null},existing);}
export async function saveEvent(payload,existing){
 const stored=existing?events.find(event=>event.id===existing.id):null;
 if(stored?.is_private&&stored.created_by!==user.id)throw new Error('Cette note n’est plus accessible.');
 if(stored&&'is_private' in payload&&payload.is_private!==stored.is_private&&stored.created_by!==user.id)throw new Error('Seul l’auteur peut changer la confidentialité de cette note.');
 if(!stored&&payload.is_private&&payload.created_by!==user.id)throw new Error('La note privée doit appartenir à son auteur.');
 return save(events,existing?payload:{is_private:false,...payload},existing);
}
export async function deleteSession(item){sessions=sessions.filter(s=>s.id!==item.id);feedback=feedback.filter(f=>f.session_id!==item.id);}
export async function deleteEvent(item){const event=events.find(e=>e.id===item.id);if(event?.is_private&&event.created_by!==user.id)throw new Error('Cette note n’est plus accessible.');events=events.filter(e=>e.id!==item.id);}
export async function getTemplates(){return clone(templates);}
export async function saveTemplate(item){return save(templates,item);}
export async function deleteTemplate(id){templates=templates.filter(t=>t.id!==id);}
export async function rpc(name,args){
  if(name==='my_coaching_invitations')return [];
  if(name==='athlete_coaches')return clone(relations.map(r=>({...r,display_name:'Camille · Coach'})));
  if(name==='set_session_completed'){
    const session=sessions.find(item=>item.id===args.p_session_id);
    if(role!=='athlete'||!session||session.athlete_id!==athlete.id)throw new Error('Seul l’athlète concerné peut indiquer que cette séance est faite.');
    session.completed_at=args.p_completed?(session.completed_at||new Date().toISOString()):null;
    session.updated_at=stamp();return session.completed_at;
  }
  if(name==='save_session_feedback'){
    const session=sessions.find(item=>item.id===args.p_session_id);
    if(role!=='athlete'||!session?.completed_at)throw new Error('Marque d’abord cette séance comme faite.');
    feedback=feedback.filter(f=>f.session_id!==args.p_session_id);feedback.push({session_id:args.p_session_id,athlete_id:athlete.id,rpe:args.p_rpe,feeling:args.p_feeling,comment:args.p_comment});return;
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
export async function deleteLibraryFolder(id){folders=folders.filter(f=>f.id!==id);templates.forEach(t=>{if(t.folder_id===id)t.folder_id=null;});}
export async function moveTemplate(template,folderId){return save(templates,{folder_id:folderId},template);}
export async function loadJournal(athleteId){const entries=journalEntries.filter(e=>e.athlete_id===athleteId);return clone({entries,updates:journalUpdates.filter(u=>entries.some(e=>e.id===u.entry_id))});}
function journalUpdate(entryId,kind,content=''){const item={id:crypto.randomUUID(),entry_id:entryId,kind,content,created_by:user.id,author_name:role==='coach'?'Camille · Coach':'Alex Morin',created_at:new Date().toISOString()};journalUpdates.push(item);return clone(item);}
export async function addJournalComment(entryId,content){return journalUpdate(entryId,'comment',content);}
export async function saveJournalEntry(payload,existing){
 const now=new Date().toISOString();
 if(existing){const entry=journalEntries.find(e=>e.id===existing.id);if(!entry||entry.updated_at!==existing.updated_at)throw new Error('Ce sujet a changé.');
 if(payload.status&&payload.status!==entry.status)journalUpdate(entry.id,'status',payload.status);
 if('archived' in payload&&payload.archived!==entry.archived)journalUpdate(entry.id,payload.archived?'archived':'restored');
 if('body' in payload&&(payload.body!==entry.body||payload.title!==entry.title))journalUpdate(entry.id,'edited',payload.body);
 Object.assign(entry,clone(payload),{updated_at:now});return clone(entry);}
 const entry={...clone(payload),id:crypto.randomUUID(),created_by:user.id,author_name:role==='coach'?'Camille · Coach':'Alex Morin',created_at:now,updated_at:now,archived:false};journalEntries.push(entry);journalUpdate(entry.id,'created',entry.body);return clone(entry);
}

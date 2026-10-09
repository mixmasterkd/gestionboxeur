import { getStarterTemplates } from './starter-templates.js';
import { client as connectedClient } from './config.js';
// Explicit preview only on the local development server; production uses real auth.
const preview = import.meta.env?.DEV && typeof location !== 'undefined' && ['coach','athlete'].includes(new URL(location.href).searchParams.get('demo'))
  ? await import('./demo-data.js') : null;
const client = preview?.client || connectedClient;
export const isDemo = Boolean(preview);
export const ATHLETE_FIELDS = 'id,user_id,coach_id,first_name,last_name,birth_date,sex,status,weight_kg,is_active';
export async function result(query) {
  const {data,error}=await query;
  if(error) {
    if(error.code==='PGRST116') throw new Error('Cet élément a changé ou n’est plus accessible. Actualise le calendrier avant de réessayer.');
    if(error.code==='42P01'||error.code==='42703'||error.code==='PGRST205') throw new Error('La mise à jour de la base de données est nécessaire pour ouvrir la planification.');
    if(error.code==='42501') throw new Error('Tu n’as pas la permission d’effectuer cette action.');
    throw error;
  }
  return data;
}
export const rpc=(name,args)=>preview?preview.rpc(name,args):result(client.rpc(name,args));
function missingAccountType(error) {
  if (!error || !['42703','PGRST204'].includes(error.code)) return false;
  const message=String(error.message||'');
  if (error.code==='PGRST204') return /\bcould not find the ["']account_type["'] column of ["']profiles["']/i.test(message);
  return /\bcolumn\s+["']?(?:profiles(?:_\d+)?["']?\.["']?)?account_type["']?\s+does not exist\b/i.test(message);
}
const missingPlanningTable=error=>['42P01','PGRST205'].includes(error?.code);
const missingSharedPlanning=error=>missingPlanningTable(error)||(['42703','PGRST204'].includes(error?.code)&&/\b(?:is_locked|completed_at)\b/.test(error.message||''));
const unavailableAccount=(profile,gym)=>({profile,gym,coach:null,relations:[],athletes:[],planningAvailable:false});

// The optional client lets tests cover real query/error contracts without contacting Supabase.
export async function loadAccount(user,database=client) {
  if(preview&&database===client)return preview.loadAccount(user);
  const profileResponse=await database.from('profiles').select('id,full_name,phone,is_admin,account_type').eq('id',user.id).single();
  if (missingAccountType(profileResponse.error)) {
    const historical=await result(database.from('profiles').select('id,full_name,phone,is_admin').eq('id',user.id).single());
    const gym=await result(database.from('gym_settings').select('gym_name,address').eq('coach_id',user.id).maybeSingle());
    return unavailableAccount({...historical,account_type:'coach'},gym);
  }
  const profile=await result(profileResponse);
  const queries=profile.account_type==='coach' ? [
    ['gym',database.from('gym_settings').select('gym_name,address').eq('coach_id',user.id).maybeSingle()],
    ['coach',database.from('coach_profiles').select('*').eq('user_id',user.id).single()],
    ['relations',database.from('coach_athletes').select('*').eq('coach_id',user.id)],
    ['athletes',database.from('athletes').select(ATHLETE_FIELDS).order('last_name')],
  ] : [
    ['athletes',database.from('athletes').select(ATHLETE_FIELDS).eq('user_id',user.id)],
  ];
  // Athlete accounts otherwise never touch a planning table while loading their profile.
  queries.push(['planning',database.from('training_sessions').select('id,is_locked,completed_at').limit(1)]);
  const settled=await Promise.allSettled(queries.map(async([key,query])=>({key,response:await query})));
  const rejected=settled.find(item=>item.status==='rejected');
  if(rejected) throw rejected.reason;
  const responses=settled.map(item=>item.value);
  // A missing table must never conceal a simultaneous permission or network failure.
  const unexpected=responses.find(({key,response})=>response.error && (key==='gym'||!(key==='planning'?missingSharedPlanning(response.error):missingPlanningTable(response.error))));
  if(unexpected) await result(unexpected.response);
  const account=Object.fromEntries(responses.map(({key,response})=>[key,response.data]));
  const gym=account.gym??null;
  if(responses.some(({key,response})=>key==='planning'?missingSharedPlanning(response.error):missingPlanningTable(response.error))) return unavailableAccount(profile,gym);
  return {profile,gym,coach:account.coach??null,relations:account.relations??[],athletes:account.athletes??[],planningAvailable:true};
}
export async function loadCalendar(athleteId,start,end) {
  if(preview)return preview.loadCalendar(athleteId,start,end);
  const [sessions,events]=await Promise.all([
    result(client.from('training_sessions').select('*').eq('athlete_id',athleteId).gte('date',start).lte('date',end).order('date').order('sort_order')),
    result(client.from('personal_events').select('*').eq('athlete_id',athleteId).lte('date',end).or(`end_date.gte.${start},and(end_date.is.null,date.gte.${start})`).order('date')),
  ]);
  const feedback=sessions.length ? await result(client.from('session_feedback').select('*').eq('athlete_id',athleteId).in('session_id',sessions.map(s=>s.id))) : [];
  return {sessions,events,feedback};
}
export async function saveSession(payload,existing,database=client) {
  if(preview&&database===client)return preview.saveSession(payload,existing);
  if(!existing&&Array.isArray(payload.athlete_ids)&&!payload.group_ids?.length&&new Set(payload.athlete_ids).size===1){
    const {group_ids,athlete_ids,...content}=payload;payload={...content,athlete_id:athlete_ids[0]};
  }
  if(existing?.shared_session_id&&!existing.is_group_session)throw new Error('Ouvre la séance commune pour modifier son contenu.');
  if(existing?.is_group_session||(!existing&&('group_ids' in payload||'athlete_ids' in payload))) {
    return result(database.rpc('save_shared_training_session',{p_payload:payload,p_id:existing?.id??null,p_updated_at:existing?.updated_at??null}));
  }
  if(existing) return result(database.from('training_sessions').update(payload).eq('id',existing.id).eq('updated_at',existing.updated_at).select().single());
  return result(database.from('training_sessions').insert(payload).select().single());
}
export async function deleteSession(s,database=client) {
  if(preview&&database===client)return preview.deleteSession(s);
  if(s.is_group_session)return result(database.rpc('delete_shared_training_session',{p_id:s.id,p_updated_at:s.updated_at}));
  if(s.shared_session_id)throw new Error('Ouvre la séance commune pour la supprimer.');
  return result(database.from('training_sessions').delete().eq('id',s.id).eq('updated_at',s.updated_at).select('id').single());
}
export async function saveEvent(payload,existing,database=client) {
  if(preview&&database===client)return preview.saveEvent(payload,existing);
  if(!existing&&Array.isArray(payload.athlete_ids)&&!payload.group_ids?.length&&new Set(payload.athlete_ids).size===1){
    const {group_ids,athlete_ids,...content}=payload;payload={...content,athlete_id:athlete_ids[0]};
  }
  if(existing?.shared_event_id&&!existing.is_group_event)throw new Error('Ouvre la note commune pour modifier son contenu.');
  if(existing?.is_group_event||(!existing&&('group_ids' in payload||'athlete_ids' in payload))){
    return result(database.rpc('save_shared_calendar_event',{p_payload:{...payload,is_private:false,is_locked:true},p_id:existing?.id??null,p_updated_at:existing?.updated_at??null}));
  }
  if(existing) return result(database.from('personal_events').update(payload).eq('id',existing.id).eq('updated_at',existing.updated_at).select().single());
  return result(database.from('personal_events').insert(payload).select().single());
}
export async function deleteEvent(e,database=client){
  if(preview&&database===client)return preview.deleteEvent(e);
  if(e.is_group_event)return result(database.rpc('delete_shared_calendar_event',{p_id:e.id,p_updated_at:e.updated_at}));
  if(e.shared_event_id)throw new Error('Ouvre la note commune pour la supprimer.');
  return result(database.from('personal_events').delete().eq('id',e.id).eq('updated_at',e.updated_at).select('id').single());
}
export const initializeLibrary=()=>preview?preview.initializeLibrary():rpc('initialize_training_library',{p_templates:getStarterTemplates().map(({title,sport,description,notes,blocks,workout_document})=>({title,sport,description,notes,blocks,workout_document}))});
async function libraryRows(table,order) {
 const rows=[];for(let offset=0;;offset+=500){const page=await result(client.from(table).select('*').order(order).order('id').range(offset,offset+499));rows.push(...page);if(page.length<500)return rows;}
}
export const getTemplates=()=>preview?preview.getTemplates():libraryRows('session_templates','created_at');
export const saveTemplate=t=>preview?preview.saveTemplate(t):result(client.from('session_templates').insert(t).select().single());
export async function updateTemplate(payload,existing,db=client) {
  if(!existing?.id||!existing.updated_at||!existing.coach_id)throw new Error('Rouvre cet entraînement depuis la bibliothèque avant de le modifier.');
  const allowed=['title','sport','description','notes','blocks','workout_document','kind','folder_id'];
  const changes=Object.fromEntries(allowed.filter(key=>key in payload).map(key=>[key,payload[key]]));
  if(preview&&db===client)return preview.updateTemplate(changes,existing);
  const {data,error}=await db.from('session_templates').update(changes).eq('id',existing.id).eq('coach_id',existing.coach_id).eq('updated_at',existing.updated_at).select().single();
  if(error?.code==='PGRST116')throw new Error('Cet entraînement a été modifié ou supprimé ailleurs. Ton texte est conservé ici; rouvre l’entraînement depuis la bibliothèque pour charger sa dernière version.');
  return result(Promise.resolve({data,error}));
}
export const deleteTemplate=id=>preview?preview.deleteTemplate(id):result(client.from('session_templates').delete().eq('id',id).select('id').single());
export { client };

export const getLibraryFolders=()=>preview?preview.getLibraryFolders():libraryRows('library_folders','name');
export const saveLibraryFolder=(name,id)=>preview?preview.saveLibraryFolder(name,id):result(id?client.from('library_folders').update({name}).eq('id',id).select().single():client.from('library_folders').insert({name}).select().single());
export const deleteLibraryFolder=(folder,contents)=>preview?preview.deleteLibraryFolder(folder,contents):rpc('delete_training_library_folder',{p_folder_id:folder.id,p_expected_name:folder.name,p_contents:contents.map(({id,updated_at})=>({id,updated_at}))});
export const moveTemplate=(template,folderId)=>preview?preview.moveTemplate(template,folderId):result(client.from('session_templates').update({folder_id:folderId}).eq('id',template.id).eq('updated_at',template.updated_at).select().single());
async function allJournalRows(query) {
 const rows=[];
 for(let offset=0;;offset+=500){const page=await result(query().range(offset,offset+499));rows.push(...page);if(page.length<500)return rows;}
}
export async function loadJournal(athleteId) {
 if(preview)return preview.loadJournal(athleteId);
 const entries=await allJournalRows(()=>client.from('journal_entries').select('*').eq('athlete_id',athleteId).order('created_at').order('id'));
 const updates=entries.length?await allJournalRows(()=>client.from('journal_updates').select('*,journal_entries!inner(athlete_id)').eq('journal_entries.athlete_id',athleteId).order('created_at').order('id')):[];
 return {entries,updates};
}
export const saveJournalEntry=(payload,existing)=>preview?preview.saveJournalEntry(payload,existing):result(existing?client.from('journal_entries').update(payload).eq('id',existing.id).eq('updated_at',existing.updated_at).select().single():client.from('journal_entries').insert(payload).select().single());
export const addJournalComment=(entryId,content)=>preview?preview.addJournalComment(entryId,content):result(client.from('journal_updates').insert({entry_id:entryId,content}).select().single());
export function deleteJournalEntry(entry,updates) {
 if(!entry?.id||!entry.updated_at||!Array.isArray(updates))throw new Error('Rouvre le sujet avant de le supprimer.');
 if(preview)return preview.deleteJournalEntry(entry,updates);
 return rpc('delete_journal_entry',{p_id:entry.id,p_updated_at:entry.updated_at,p_update_ids:updates.map(update=>update.id)});
}

// Group roles are scoped to membership. Personal copies keep the existing
// calendar/feedback rules; membership never grants individual coaching access.
let hasCommunity=false;
export const communityAvailable=()=>hasCommunity;
export async function loadTrainingGroups(database=client) {
  if(preview&&database===client)return preview.loadTrainingGroups();
  const community=await database.rpc('community_command',{p_action:'list_groups',p_data:{}});
  if(!community.error){hasCommunity=true;return community.data;}
  // Older deployed backends retain their existing owner-only group API.
  if(!['PGRST202','42883'].includes(community.error.code))return result(community);
  const rows=[];
  for(let offset=0;;offset+=500){
    const page=await result(database.from('training_groups').select('*,training_group_members(athlete_id)').order('name').order('id').range(offset,offset+499));
    rows.push(...page.map(({training_group_members,...group})=>({...group,athlete_ids:(training_group_members||[]).map(m=>m.athlete_id)})));
    if(page.length<500)return rows;
  }
}
export async function saveTrainingGroup(payload,existing,database=client) {
  if(preview&&database===client)return preview.saveTrainingGroup(payload,existing);
  return result(database.rpc('save_training_group',{p_name:payload.name,p_athlete_ids:[...new Set(payload.athlete_ids||[])],p_id:existing?.id??null,p_updated_at:existing?.updated_at??null}));
}
export async function deleteTrainingGroup(group,database=client) {
  if(preview&&database===client)return preview.deleteTrainingGroup(group);
  return result(database.rpc('delete_training_group',{p_id:group.id,p_updated_at:group.updated_at}));
}
const sharedColumns='*,shared_session_groups(group_id),shared_session_athletes(athlete_id)';
function sharedSession({shared_session_groups,shared_session_athletes,...session}) {
  return {...session,is_group_session:true,shared_session_id:session.id,athlete_id:null,completed_at:null,
    group_ids:(shared_session_groups||[]).map(g=>g.group_id),athlete_ids:(shared_session_athletes||[]).map(a=>a.athlete_id)};
}
export async function getSharedSession(id,database=client) {
  if(preview&&database===client)return preview.getSharedSession(id);
  return sharedSession(await result(database.from('shared_training_sessions').select(sharedColumns).eq('id',id).single()));
}
const sharedEventColumns='*,shared_event_groups(group_id),shared_event_athletes(athlete_id)';
function sharedEvent({shared_event_groups,shared_event_athletes,...event}){
  return {...event,is_group_event:true,shared_event_id:event.id,athlete_id:null,is_private:false,
    group_ids:(shared_event_groups||[]).map(g=>g.group_id),athlete_ids:(shared_event_athletes||[]).map(a=>a.athlete_id)};
}
export async function getSharedEvent(id,database=client){
  if(preview&&database===client)return preview.getSharedEvent(id);
  return sharedEvent(await result(database.from('shared_calendar_events').select(sharedEventColumns).eq('id',id).single()));
}
export async function loadGroupCalendar(groupId,start,end,database=client) {
  if(preview&&database===client)return preview.loadGroupCalendar(groupId,start,end);
  if(database===client&&hasCommunity)return result(database.rpc('community_command',{p_action:'group_calendar',p_data:{group_id:groupId,from:start,to:end}}));
  const sessions=[],events=[];
  for(let offset=0;;offset+=500){
    const page=await result(database.from('shared_training_sessions').select(`${sharedColumns},selected_group:shared_session_groups!inner(group_id)`)
      .eq('selected_group.group_id',groupId).gte('date',start).lte('date',end).order('date').order('sort_order').order('id').range(offset,offset+499));
    sessions.push(...page.map(({selected_group,...row})=>sharedSession(row)));
    if(page.length<500)break;
  }
  for(let offset=0;;offset+=500){
    const page=await result(database.from('shared_calendar_events').select(`${sharedEventColumns},selected_group:shared_event_groups!inner(group_id)`)
      .eq('selected_group.group_id',groupId).lte('date',end).or(`end_date.gte.${start},and(end_date.is.null,date.gte.${start})`).order('date').order('sort_order').order('id').range(offset,offset+499));
    events.push(...page.map(({selected_group,...row})=>sharedEvent(row)));
    if(page.length<500)return {sessions,events,feedback:[]};
  }
}

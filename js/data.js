import { client as connectedClient } from './config.js';
// Explicit preview only on the local development server; production uses real auth.
const preview = import.meta.env?.DEV && typeof location !== 'undefined' && ['coach','athlete'].includes(new URL(location.href).searchParams.get('demo'))
  ? await import('./demo-data.js') : null;
const client = preview?.client || connectedClient;
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
export async function saveSession(payload,existing) {
  if(preview)return preview.saveSession(payload,existing);
  if(existing) return result(client.from('training_sessions').update(payload).eq('id',existing.id).eq('updated_at',existing.updated_at).select().single());
  return result(client.from('training_sessions').insert(payload).select().single());
}
export const deleteSession=s=>preview?preview.deleteSession(s):result(client.from('training_sessions').delete().eq('id',s.id).eq('updated_at',s.updated_at).select('id').single());
export async function saveEvent(payload,existing) {
  if(preview)return preview.saveEvent(payload,existing);
  if(existing) return result(client.from('personal_events').update(payload).eq('id',existing.id).eq('updated_at',existing.updated_at).select().single());
  return result(client.from('personal_events').insert(payload).select().single());
}
export const deleteEvent=e=>preview?preview.deleteEvent(e):result(client.from('personal_events').delete().eq('id',e.id).eq('updated_at',e.updated_at).select('id').single());
export const getTemplates=()=>preview?preview.getTemplates():result(client.from('session_templates').select('*').order('updated_at',{ascending:false}));
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

export const getLibraryFolders=()=>preview?preview.getLibraryFolders():result(client.from('library_folders').select('*').order('name'));
export const saveLibraryFolder=(name,id)=>preview?preview.saveLibraryFolder(name,id):result(id?client.from('library_folders').update({name}).eq('id',id).select().single():client.from('library_folders').insert({name}).select().single());
export const deleteLibraryFolder=id=>preview?preview.deleteLibraryFolder(id):result(client.from('library_folders').delete().eq('id',id).select('id').single());
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

import { localQuery,personas } from './local-preview-server.mjs';
import { parseTrainingText } from '../js/workout-document.js';

export async function seedLocalPreview(db) {
 await db.exec('create table if not exists auth.local_seed(id integer primary key)');
 if((await db.query('select id from auth.local_seed where id=1')).rows.length)return;
 const [owner,admin,member,invitee]=personas;
 const rpc=(user,name,args={})=>localQuery(db,user.id,{rpc:name,args});
 const command=(user,action,data={})=>rpc(user,'community_command',{p_action:action,p_data:data});
 const group=async(user,name,description)=>{
  const groups=await command(user,'list_groups');
  return groups.find(g=>g.name===name)||await command(user,'save_group',{name,description});
 };
 const add=async(creator,g,user,role='member')=>{
  const memberships=await command(user,'list_groups');if(memberships.some(row=>row.id===g.id))return;
  await command(creator,'invite_member',{group_id:g.id,email:user.email,role});
  const notification=(await command(user,'notifications')).items.find(item=>item.group_id===g.id);
  await command(user,'respond_invitation',{id:notification.id,accept:true});
 };
 const competitors=await group(owner,'Compétiteurs','Les entraînements, les nouvelles et les idées de notre équipe.');
 await add(owner,competitors,admin);await add(owner,competitors,member);
 const mrjeu=await group(owner,'MRJEU','Notre petit groupe du mardi et du jeudi.');
 await add(owner,mrjeu,admin,'admin');await add(owner,mrjeu,member);
 const intel=await group(admin,'IntelCore','Un groupe indépendant, avec des membres qui s’entraînent aussi ailleurs.');
 await add(admin,intel,member);
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 for(const [g,title,text] of [[competitors,'Boxe · coordination','4 rounds\n- Shadow 2min\n- Repos 1min'],[mrjeu,'Circuit du jeudi','3 fois\n- Renforcement 45s\n- Repos 15s'],[intel,'Mobilité et récupération','- Mobilité 10min']]){
  const creator=g.coach_id===owner.id?owner:admin;
  const sessions=await localQuery(db,creator.id,{table:'shared_training_sessions',filters:[{column:'title',op:'eq',value:title}]});
  await rpc(creator,'save_shared_training_session',{p_payload:{title,date,group_ids:[g.id],athlete_ids:[],sport:'boxing',blocks:parseTrainingText(text,{sport:'boxing'}).blocks,description:'',notes:'',workout_document:{version:1,text,marks:[]}},p_id:sessions[0]?.id??null,p_updated_at:sessions[0]?.updated_at??null});
 }
 const detail=await command(owner,'group_detail',{group_id:competitors.id});
 if(!detail.posts.length){
  await command(owner,'create_post',{group_id:competitors.id,kind:'message',content:'Bienvenue dans le groupe! Les entraînements arrivent directement dans ton calendrier.'});
  await command(member,'create_post',{group_id:competitors.id,kind:'suggestion',content:'Est-ce qu’on pourrait ajouter une séance de technique de push-up ensemble?'});
 }
 if(!detail.polls.length)await command(owner,'create_poll',{group_id:competitors.id,question:'Quel moment préfères-tu pour une séance de groupe?',options:['Mardi à 18 h','Jeudi à 18 h','Samedi matin']});
 await command(owner,'invite_member',{group_id:competitors.id,email:invitee.email,role:'member'});
 await rpc(owner,'invite_existing_athlete',{p_email:invitee.email});
 const ownAthlete=(await localQuery(db,member.id,{table:'athletes',columns:'id,user_id',filters:[{column:'user_id',op:'eq',value:member.id}]}))[0];
 const personal=await localQuery(db,member.id,{table:'personal_events',filters:[{column:'title',op:'eq',value:'Ma note privée'}]});
 if(!personal.length)await localQuery(db,member.id,{table:'personal_events',method:'insert',values:{athlete_id:ownAthlete.id,created_by:member.id,title:'Ma note privée',date,category:'note',notes:'Cette note reste personnelle, même pour les admins de mes groupes.',is_private:true}});
 await db.query('insert into auth.local_seed values(1) on conflict do nothing');
}

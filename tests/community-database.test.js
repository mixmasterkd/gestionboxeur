import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('independent communities enforce scoped roles, accepted invitations and private calendars',async(t)=>{
 const db=new PGlite();
 const owner='73000000-0000-4000-8000-000000000001',admin='73000000-0000-4000-8000-000000000002',member='73000000-0000-4000-8000-000000000003',outside='73000000-0000-4000-8000-000000000004';
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
 const root=()=>db.exec('reset role');
 const login=async id=>{await root();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const cmd=(action,data={})=>scalar('select public.community_command($1,$2)',[action,JSON.stringify(data)]);
 const detail=id=>cmd('group_detail',{id});
 const save=(payload,existing)=>scalar('select public.save_shared_training_session($1,$2,$3)',[JSON.stringify(payload),existing?.id??null,existing?.updated_at??null]);
 const note=(payload,existing)=>scalar('select public.save_shared_calendar_event($1,$2,$3)',[JSON.stringify(payload),existing?.id??null,existing?.updated_at??null]);
 let g,h,inv,master,noteMaster,poll,post,athletes={};
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid(),auth.role() to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
  for(const [id,name] of [[owner,'Créateur'],[admin,'Admin'],[member,'Membre'],[outside,'Extérieur']]){
   await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,id+'@example.test',JSON.stringify({full_name:name,account_type:'athlete',birth_date:'2000-01-01'})]);
   athletes[id]=await scalar('select id from public.athletes where user_id=$1',[id]);
  }
  const future=await scalar("select (current_date+7)::text"),past=await scalar("select (current_date-7)::text");
  await t.test('every account creates a group and invitations do not grant access before acceptance',async()=>{
   await login(owner);g=await cmd('save_group',{name:'MRJEU',description:'Mardi et jeudi'});
   assert.equal(g.role,'owner');assert.equal(g.member_count,1);assert.deepEqual(g.athlete_ids,[athletes[owner]]);
   inv=await cmd('invite_member',{group_id:g.id,email:member+'@example.test'});
   await login(member);assert.deepEqual(await cmd('list_groups'),[]);await assert.rejects(()=>detail(g.id),/inaccessible/);
   const notifications=await cmd('notifications');assert.equal(notifications.count,1);assert.equal(notifications.items[0].type,'group_invitation');
   await login(outside);await assert.rejects(()=>cmd('respond_invitation',{id:inv.id,accept:true}),/inaccessible/);
   await login(member);await cmd('respond_invitation',{id:inv.id,accept:true});assert.equal((await cmd('notifications')).count,0);
   assert.equal((await cmd('list_groups'))[0].role,'member');assert.equal((await detail(g.id)).members.length,2);
   await root();assert.equal(await scalar('select count(*)::int from public.coach_athletes'),0);assert.equal(await scalar('select count(*)::int from public.coach_profiles'),0);
  });
  await t.test('creator alone appoints administrators; members can participate without private data exposure',async()=>{
   await login(owner);inv=await cmd('invite_member',{group_id:g.id,email:admin+'@example.test',role:'admin'});
   await login(admin);await cmd('respond_invitation',{id:inv.id,accept:true});assert.equal((await cmd('list_groups'))[0].role,'admin');
   await assert.rejects(()=>cmd('set_role',{group_id:g.id,user_id:member,role:'admin'}),/créateur/);
   await assert.rejects(()=>cmd('delete_group',{group_id:g.id}),/créateur/);
   await assert.rejects(()=>cmd('save_group',{id:g.id,name:'Vol',updated_at:g.updated_at}),/créateur/);
   await assert.rejects(()=>cmd('invite_member',{group_id:g.id,email:outside+'@example.test',role:'admin'}),/créateur/);
   await login(member);await assert.rejects(()=>cmd('invite_member',{group_id:g.id,email:outside+'@example.test'}),/Administration/);
   await assert.rejects(()=>cmd('set_role',{group_id:g.id,user_id:member,role:'admin'}),/créateur/);
   post=await cmd('create_post',{group_id:g.id,kind:'suggestion',content:'Un cours le samedi?'});
   await cmd('support_post',{id:post.id});await cmd('comment_post',{id:post.id,content:'Avec un début à 10 h.'});
   let d=await detail(g.id);assert.equal(d.posts[0].support_count,1);assert.equal(d.posts[0].supported_by_me,true);assert.equal(d.posts[0].comments.length,1);
   await cmd('support_post',{id:post.id});assert.equal((await detail(g.id)).posts[0].support_count,0);
   await assert.rejects(()=>cmd('pin_post',{id:post.id}),/Administration/);
   await login(outside);await assert.rejects(()=>cmd('support_post',{id:post.id}),/inaccessible/);await assert.rejects(()=>cmd('comment_post',{id:post.id,content:'Intrusion'}),/inaccessible/);
   await login(admin);await cmd('pin_post',{id:post.id});await cmd('status_post',{id:post.id,status:'planned'});
   d=await detail(g.id);assert.equal(d.posts[0].pinned,true);assert.equal(d.posts[0].status,'planned');
   assert.equal(await scalar('select count(*)::int from public.athletes where user_id=$1',[member]),0);
   assert.equal(await scalar('select count(*)::int from public.training_sessions where athlete_id=$1',[athletes[member]]),0);
   for(const table of ['group_posts','group_comments','group_poll_votes','group_invitations'])await assert.rejects(()=>db.query(`select * from public.${table}`),/permission denied/);
  });
  await t.test('polls enforce one changeable vote, matching options, expiry and group isolation',async()=>{
   await login(admin);poll=await cmd('create_poll',{group_id:g.id,question:'Quelle heure?',options:['10 h','11 h']});
   let d=await detail(g.id);const options=d.polls[0].options;
   await login(member);await cmd('vote',{poll_id:poll.id,option_id:options[0].id});await cmd('vote',{poll_id:poll.id,option_id:options[1].id});
   d=await detail(g.id);assert.equal(d.polls[0].total_votes,1);assert.equal(d.polls[0].my_vote,options[1].id);assert.deepEqual(d.polls[0].options.map(x=>x.votes),[0,1]);
   await assert.rejects(()=>cmd('create_poll',{group_id:g.id,question:'Non',options:['a','b']}),/Administration/);
   await login(outside);await assert.rejects(()=>cmd('vote',{poll_id:poll.id,option_id:options[0].id}),/inaccessible/);
   h=await cmd('save_group',{name:'IntelCore'});let secondPoll=await cmd('create_poll',{group_id:h.id,question:'Autre?',options:['Oui','Non']});
   const secondOption=(await detail(h.id)).polls[0].options[0].id;
   await login(member);await assert.rejects(()=>cmd('vote',{poll_id:poll.id,option_id:secondOption}),/invalide/);
   await login(admin);await cmd('close_poll',{id:poll.id});await login(member);await assert.rejects(()=>cmd('vote',{poll_id:poll.id,option_id:options[0].id}),/terminé/);
   await login(owner);await assert.rejects(()=>cmd('create_poll',{group_id:g.id,question:'Doublon?',options:['Oui',' oui ']}),/différents/);
   await assert.rejects(()=>cmd('create_poll',{group_id:g.id,question:'Passé?',options:['A','B'],closes_at:'2000-01-01'}),/future/);
   await root();await db.query('update public.group_polls set closes_at=now()-interval \'1 day\' where id=$1',[secondPoll.id]);
   await login(outside);await assert.rejects(()=>cmd('vote',{poll_id:secondPoll.id,option_id:secondOption}),/terminé/);
  });
  await t.test('group admins distribute and modify common content without gaining personal coaching rights',async()=>{
   await login(owner);master=await save({title:'Séance commune',date:future,group_ids:[g.id],athlete_ids:[],blocks:[]});
   noteMaster=await note({title:'Rendez-vous',date:future,group_ids:[g.id],athlete_ids:[],notes:'Au gym'});
   await login(member);assert.equal(await scalar('select count(*)::int from public.training_sessions where shared_session_id=$1',[master.id]),1);
   let copy=await scalar('select id from public.training_sessions where shared_session_id=$1',[master.id]);
   await db.query('select public.set_session_completed($1,true)',[copy]);await db.query("select public.save_session_feedback($1,5,4,'Privé')",[copy]);
   await assert.rejects(()=>save({title:'Interdit'},master),/coach requis/);
   await login(admin);master=await save({title:'Correction par admin',is_locked:true},master);noteMaster=await note({notes:'À l’extérieur'},noteMaster);
   assert.equal(master.title,'Correction par admin');assert.equal(await scalar('select count(*)::int from public.training_sessions where athlete_id=$1',[athletes[member]]),0);
   assert.equal(await scalar('select count(*)::int from public.session_feedback'),0);
   await assert.rejects(()=>save({title:'Copie forgée',date:future,group_ids:[g.id],athlete_ids:[athletes[outside]]}),/destinataire/);
   await login(member);assert.equal(await scalar('select title from public.training_sessions where id=$1',[copy]),'Correction par admin');
   assert.ok(await scalar('select completed_at from public.training_sessions where id=$1',[copy]));assert.equal(await scalar('select comment from public.session_feedback where session_id=$1',[copy]),'Privé');
   assert.equal(await scalar('select notes from public.personal_events where shared_event_id=$1',[noteMaster.id]),'À l’extérieur');
  });
  await t.test('overlapping group membership deduplicates assignments and leaving preserves completed history',async()=>{
   await login(owner);const other=await cmd('save_group',{name:'Compétiteurs'});const invite=await cmd('invite_member',{group_id:other.id,email:member+'@example.test'});
   await login(member);await cmd('respond_invitation',{id:invite.id,accept:true});
   await login(owner);const shared=await save({title:'Deux groupes',date:future,group_ids:[g.id,other.id],athlete_ids:[],blocks:[]});
   await login(admin);await assert.rejects(()=>save({title:'Hors périmètre'},shared),/inaccessible/);
   assert.equal(await scalar('select count(*)::int from public.shared_training_sessions where id=$1',[shared.id]),1);
   const partialCalendar=await cmd('group_calendar',{group_id:g.id,from:future,to:future});
   assert.equal(partialCalendar.sessions.find(x=>x.id===shared.id).can_manage,false);assert.deepEqual(partialCalendar.sessions.find(x=>x.id===shared.id).athlete_ids,[]);
   assert.equal(partialCalendar.sessions.find(x=>x.id===master.id).can_manage,true);
   await login(member);await assert.rejects(()=>cmd('group_calendar',{group_id:g.id,from:future,to:future}),/inaccessible/);
   await login(member);assert.equal(await scalar('select count(*)::int from public.training_sessions where shared_session_id=$1',[shared.id]),1);
   await cmd('leave_group',{group_id:g.id});assert.equal(await scalar('select count(*)::int from public.training_sessions where shared_session_id=$1',[shared.id]),1);
   assert.equal(await scalar('select count(*)::int from public.training_sessions where shared_session_id=$1',[master.id]),1);
   assert.equal(await scalar('select count(*)::int from public.personal_events where shared_event_id=$1',[noteMaster.id]),0);
   await cmd('leave_group',{group_id:other.id});assert.equal(await scalar('select count(*)::int from public.training_sessions where shared_session_id=$1',[shared.id]),0);
   await assert.rejects(()=>detail(g.id),/inaccessible/);
   await login(owner);await cmd('delete_group',{group_id:other.id});
  });
  await t.test('ownership transfers explicitly and departed admins cannot issue usable invitations',async()=>{
   await login(owner);const invite=await cmd('invite_member',{group_id:g.id,email:outside+'@example.test',role:'admin'});
   await cmd('transfer_group',{group_id:g.id,user_id:admin});assert.equal((await detail(g.id)).group.role,'admin');
   await assert.rejects(()=>cmd('delete_group',{group_id:g.id}),/créateur/);
   await login(outside);await assert.rejects(()=>cmd('respond_invitation',{id:invite.id,accept:true}),/plus valide/);
   await login(admin);await assert.rejects(()=>cmd('leave_group',{group_id:g.id}),/transférer/);
   await cmd('remove_member',{group_id:g.id,user_id:owner});
   master=await save({title:'Après le départ du créateur'},master);
   await login(owner);assert.equal(await scalar('select count(*)::int from public.shared_training_sessions where id=$1',[master.id]),0);
   assert.equal(await scalar('select count(*)::int from public.shared_calendar_events where id=$1',[noteMaster.id]),0);
   assert.equal(await scalar('select count(*)::int from public.shared_session_groups where session_id=$1',[master.id]),0);
   await assert.rejects(()=>save({title:'Ancien créateur'},master),/inaccessible|coach requis/);
   await login(admin);await cmd('delete_group',{group_id:g.id});
   await login(member);assert.equal(await scalar('select count(*)::int from public.training_sessions where shared_session_id=$1',[master.id]),1);
   await login(owner);assert.deepEqual(await cmd('list_groups'),[]);
  });
  await t.test('historical roster members remain usable by group admins without exposing their private profiles',async()=>{
   await login(owner);await scalar('select public.enable_coaching()');
   const unlinked=[];for(const name of ['Sans compte A','Sans compte B'])unlinked.push(await scalar('select public.create_roster_athlete($1)',[JSON.stringify({first_name:name})]));
   await root();await db.query("insert into public.coach_athletes(coach_id,athlete_id,status) values($1,$2,'accepted')",[owner,athletes[member]]);await login(owner);
   const legacy=await scalar('select public.save_training_group($1,$2)', ['Ancien groupe',[athletes[member]]]);
   // Imported historical rows may contain unlinked roster sheets; they remain
   // distinct in the member list and can be removed without creating accounts.
   await root();for(const aid of unlinked)await db.query('insert into public.training_group_members(group_id,athlete_id) values($1,$2)',[legacy.id,aid]);await login(owner);
   assert.equal((await detail(legacy.id)).group.member_count,4);
   const invite=await cmd('invite_member',{group_id:legacy.id,email:admin+'@example.test',role:'admin'});
   await login(admin);await cmd('respond_invitation',{id:invite.id,accept:true});
   for(const aid of unlinked)await cmd('remove_member',{group_id:legacy.id,athlete_id:aid});
   assert.equal((await detail(legacy.id)).members.length,3);
   let oldShared=await save({title:'Avec les anciennes fiches',date:future,group_ids:[legacy.id],athlete_ids:[],blocks:[]});
   oldShared=await save({title:'Correction ancienne fiche'},oldShared);
   assert.equal(await scalar('select count(*)::int from public.athletes where id=$1',[athletes[member]]),0);
   await root();await db.query('update public.coach_athletes set can_add_sessions=false where coach_id=$1 and athlete_id=$2',[owner,athletes[member]]);
   await login(admin);await assert.rejects(()=>save({title:'Permission révoquée'},oldShared),/destinataire/);
   await root();await db.query('update public.coach_athletes set can_add_sessions=true where coach_id=$1 and athlete_id=$2',[owner,athletes[member]]);
   await login(admin);await cmd('remove_member',{group_id:legacy.id,user_id:member});
   await root();assert.equal(await scalar('select count(*)::int from public.training_sessions where shared_session_id=$1 and athlete_id=$2',[oldShared.id,athletes[member]]),0);
   await login(owner);await cmd('delete_group',{group_id:legacy.id});
  });
  await t.test('anonymous callers and direct table mutations cannot bypass the checked entry point',async()=>{
   await root();await db.exec('set role anon');await assert.rejects(()=>cmd('list_groups'),/permission denied/);
   await login(outside);await assert.rejects(()=>db.query("update public.training_group_members set role='admin' where group_id=$1",[h.id]),/permission denied/);
   await assert.rejects(()=>db.query('select app_private.community_refresh_group($1)',[h.id]),/permission denied/);
   await assert.rejects(()=>db.query('select app_private.community_detail($1)',[h.id]),/permission denied/);
   await assert.rejects(()=>db.query('update public.training_sessions set shared_group_authorized=true'),/permission denied/);
   await root();assert.equal(await scalar("select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'group_%' and c.relkind='r' and not c.relrowsecurity"),0);
   assert.equal(await scalar("select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='community_command'"),false);
  });
 }finally{await db.close();}
});

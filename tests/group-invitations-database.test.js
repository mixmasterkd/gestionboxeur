import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('group roster invitations and revocable links protect personal relationships and require explicit membership consent', async t => {
 const db = new PGlite();
 const uid = n => `92000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
 const owner=uid(1),admin=uid(2),zoe=uid(3),emile=uid(4),groupOnly=uid(5),pending=uid(6),revoked=uid(7),outside=uid(8),newcomer=uid(9);
 const athlete = new Map(); let group, legacy, invitation;
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
 const root=()=>db.exec('reset role');
 const login=async id=>{await root();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const cmd=(action,data={})=>scalar('select public.community_command($1,$2)',[action,JSON.stringify(data)]);
 const candidates=(query='',offset=0)=>cmd('invite_candidates',{group_id:group.id,query,offset});
 const makeUser=async(id,first,last='Test')=>{
  await root();await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,`${first.toLowerCase()}-${id.slice(-3)}@example.test`,JSON.stringify({full_name:`${first} ${last}`,first_name:first,last_name:last,account_type:'athlete',birth_date:'2000-01-01'})]);
  athlete.set(id,await scalar('select id from public.athletes where user_id=$1',[id]));
 };
 const relate=async(account,user,status='accepted')=>{await root();await db.query('insert into public.coach_athletes(coach_id,athlete_id,status) values($1,$2,$3)',[account,athlete.get(user),status]);};
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid(),auth.role() to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);
  for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
  for(const [id,first,last] of [[owner,'Créateur','Groupe'],[admin,'Admin','Second'],[zoe,'Zoé','Tremblay'],[emile,'Émile','Lavoie'],[groupOnly,'Groupe','Seulement'],[pending,'Lien','En attente'],[revoked,'Ancien','Lien'],[outside,'Extérieur','Autre'],[newcomer,'Nouveau','Compte']])await makeUser(id,first,last);
  await relate(owner,zoe);await relate(owner,emile);await relate(owner,pending,'pending');await relate(owner,revoked,'revoked');await relate(admin,outside);
  await login(owner);group=await cmd('save_group',{name:'Athlètes communs',description:'Horaire collectif'});
  legacy=await scalar('select public.create_roster_athlete($1)',[JSON.stringify({first_name:'Sans',last_name:'Compte',email:'sans@example.test'})]);
  invitation=await cmd('invite_member',{group_id:group.id,email:'groupe-005@example.test'});
  await login(groupOnly);await cmd('respond_invitation',{id:invitation.id,accept:true});
  await login(owner);invitation=await cmd('invite_member',{group_id:group.id,email:'admin-002@example.test',role:'admin'});
  await login(admin);await cmd('respond_invitation',{id:invitation.id,accept:true});

  await t.test('candidate search uses only this account accepted roster, folds accents, and marks unlinked sheets',async()=>{
   await login(owner);const list=await candidates();assert.equal(list.total,3);assert.equal(list.next_offset,null);
   assert.deepEqual(new Set(list.items.map(x=>x.user_id)),new Set([zoe,emile,null]));
   assert.equal(list.items.find(x=>x.athlete_id===legacy).status,'sans_compte');assert.equal(list.items.find(x=>x.user_id===zoe).status,'available');
   assert.equal((await candidates('TREMBLAY zoe')).items[0].user_id,zoe);
   assert.equal((await candidates('emile')).items[0].user_id,emile);
   assert.equal((await candidates('EMILE-004@EXAMPLE.TEST')).items[0].user_id,emile);
   assert.equal((await candidates('nonexistent')).total,0);assert.equal((await candidates('%')).total,0);
   await assert.rejects(()=>candidates('',-1),/Recherche invalide/);await assert.rejects(()=>candidates('a'.repeat(201)),/Recherche invalide/);
   await login(admin);const own=await candidates();assert.deepEqual(own.items.map(x=>x.user_id),[outside]);
   for(const user of [groupOnly,outside]){await login(user);await assert.rejects(()=>candidates(),/Administration/);}
  });
  await t.test('batch invitations deduplicate, retain consent and never create coaching relationships',async()=>{
   await login(owner);const sent=await cmd('invite_members',{group_id:group.id,user_ids:[zoe,emile,zoe],role:'member'});
   assert.equal(sent.invited_count,2);assert.equal(sent.items.length,2);
   const retry=await cmd('invite_members',{group_id:group.id,user_ids:[zoe,emile]});assert.equal(retry.invited_count,0);assert.equal(retry.pending_count,2);
   assert.equal((await candidates('zoe')).items[0].status,'pending');
   await login(zoe);await assert.rejects(()=>cmd('group_detail',{group_id:group.id}),/inaccessible/);
   const notice=(await cmd('notifications')).items.find(i=>i.type==='group_invitation'&&i.group_id===group.id);assert.ok(notice);
   await cmd('respond_invitation',{id:notice.id,accept:true});assert.equal((await cmd('group_detail',{id:group.id})).group.role,'member');
   await login(owner);assert.equal((await candidates('zoe')).items[0].status,'member');
   const repeat=await cmd('invite_members',{group_id:group.id,user_ids:[zoe,emile]});assert.equal(repeat.member_count,1);assert.equal(repeat.pending_count,1);
   await root();assert.equal(await scalar('select count(*)::int from public.coach_athletes'),6);assert.equal(await scalar('select count(*)::int from public.coach_profiles'),0);
  });
  await t.test('forged recipients, role promotion and a late batch failure roll back every invitation',async()=>{
   await login(admin);await assert.rejects(()=>cmd('invite_members',{group_id:group.id,user_ids:[outside],role:'admin'}),/créateur/);
   await assert.rejects(()=>cmd('invite_members',{group_id:group.id,user_ids:[outside,emile]}),/liés/);
   await login(owner);for(const user of [groupOnly,pending,revoked,outside])await assert.rejects(()=>cmd('invite_members',{group_id:group.id,user_ids:[user]}),/liés/);
   await assert.rejects(()=>cmd('invite_members',{group_id:group.id,user_ids:[]}),/1 à 50/);
   await assert.rejects(()=>cmd('invite_members',{group_id:group.id,user_ids:Array(51).fill(zoe)}),/1 à 50/);
   await assert.rejects(()=>cmd('invite_members',{group_id:group.id,user_ids:[null]}),/liés/);
   // The second recipient has declined recently; the first insertion must also roll back.
   const fresh=await cmd('save_group',{name:'Atomique'});
   await root();await db.query("insert into public.group_invitations(group_id,user_id,invited_by,status,responded_at) values($1,$2,$3,'declined',now())",[fresh.id,emile,owner]);
   await login(owner);await assert.rejects(()=>cmd('invite_members',{group_id:fresh.id,user_ids:[zoe,emile]}),/Attends/);
   await root();assert.equal(await scalar('select count(*)::int from public.group_invitations where group_id=$1 and user_id=$2',[fresh.id,zoe]),0);
   await login(owner);await cmd('delete_group',{group_id:fresh.id});
  });
  await t.test('accepted roster pagination remains stable and does not expose a different manager roster',async()=>{
   for(let n=20;n<52;n++){await makeUser(uid(n),`Nom${n}`,'Pagination');await relate(owner,uid(n));}
   await login(owner);const first=await candidates('Pagination');const second=await candidates('Pagination',first.next_offset);
   assert.equal(first.items.length,30);assert.equal(first.total,32);assert.equal(first.next_offset,30);assert.equal(second.items.length,2);assert.equal(second.next_offset,null);
   assert.equal(new Set([...first.items,...second.items].map(x=>x.athlete_id)).size,32);
   assert.deepEqual((await candidates('Pagination')).items.map(x=>x.athlete_id),first.items.map(x=>x.athlete_id));
   await login(admin);assert.equal((await candidates('Pagination')).total,0);
  });
  await t.test('links reveal only an authenticated preview, store a digest, and require explicit acceptance',async()=>{
   await login(owner);const future=await scalar("select (current_date+7)::text");
   const session=await scalar('select public.save_shared_training_session($1,null,null)',[JSON.stringify({title:'Séance reçue après consentement',date:future,group_ids:[group.id],athlete_ids:[],blocks:[]})]);
   const link=await cmd('create_join_link',{group_id:group.id});assert.match(link.token,/^[a-f0-9]{64}$/);
   const management=await cmd('group_detail',{id:group.id});assert.equal(management.join_links.length,1);assert.equal(management.join_links[0].id,link.id);assert.equal(JSON.stringify(management).includes(link.token),false);
   await root();const row=(await db.query('select * from public.group_join_links where id=$1',[link.id])).rows[0];assert.equal(row.token,undefined);
   assert.equal(await scalar("select encode(token_hash,'hex')=encode(sha256(convert_to($1,'UTF8')),'hex') from public.group_join_links where id=$2",[link.token,link.id]),true);
   await db.exec('set role anon');await assert.rejects(()=>cmd('inspect_join_link',{token:link.token}),/permission denied/);
   await login(outside);const preview=await cmd('inspect_join_link',{token:link.token});assert.deepEqual(Object.keys(preview.group).sort(),['description','id','name']);assert.equal(preview.already_member,false);
   await assert.rejects(()=>cmd('group_detail',{id:group.id}),/inaccessible/);
   assert.equal(await scalar('select count(*)::int from public.training_sessions where shared_session_id=$1',[session.id]),0);
   const accepted=await cmd('accept_join_link',{token:link.token,role:'admin'});assert.equal(accepted.group_id,group.id);assert.equal(accepted.role,'member');assert.equal(accepted.already_member,false);
   assert.equal(await scalar('select count(*)::int from public.training_sessions where shared_session_id=$1',[session.id]),1);
   assert.equal((await cmd('accept_join_link',{token:link.token})).already_member,true);assert.equal((await cmd('group_detail',{id:group.id})).join_links.length,0);
   await root();assert.equal(await scalar('select count(*)::int from public.training_group_members where group_id=$1 and athlete_id=$2',[group.id,athlete.get(outside)]),1);
   assert.equal(await scalar('select count(*)::int from public.coach_athletes where coach_id=$1 and athlete_id=$2',[owner,athlete.get(outside)]),0);
   await login(owner);assert.equal((await cmd('accept_join_link',{token:link.token})).role,'owner');
  });
  await t.test('new links revoke old tokens and revoked/expired/invalid links share the same opaque failure',async()=>{
   await login(owner);const old=await cmd('create_join_link',{group_id:group.id});const fresh=await cmd('create_join_link',{group_id:group.id});assert.notEqual(old.token,fresh.token);
   const invalid=async token=>{for(const action of ['inspect_join_link','accept_join_link'])await assert.rejects(()=>cmd(action,{token}),error=>error.message==='Lien d’invitation invalide ou expiré.');};
   await login(newcomer);await invalid(old.token);await invalid('0'.repeat(64));await invalid('invalid');
   await login(owner);await cmd('revoke_join_link',{group_id:group.id,id:fresh.id});await login(newcomer);await invalid(fresh.token);
   await login(owner);const expired=await cmd('create_join_link',{group_id:group.id});
   await root();await db.query("update public.group_join_links set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",[expired.id]);
   await login(newcomer);await invalid(expired.token);
   await login(owner);await assert.rejects(()=>cmd('create_join_link',{group_id:group.id,role:'admin'}),/uniquement des membres/);
   await assert.rejects(()=>cmd('create_join_link',{group_id:group.id,expires_at:'2000-01-01'}),/Expiration/);
   await assert.rejects(()=>cmd('create_join_link',{group_id:group.id,expires_at:'2100-01-01'}),/Expiration/);
  });
  await t.test('an inviter must still manage the group and a shared link never attaches an unlinked roster sheet',async()=>{
   await login(admin);const link=await cmd('create_join_link',{group_id:group.id});
   await login(owner);await cmd('set_role',{group_id:group.id,user_id:admin,role:'member'});
   await login(newcomer);await assert.rejects(()=>cmd('inspect_join_link',{token:link.token}),/invalide ou expiré/);await assert.rejects(()=>cmd('accept_join_link',{token:link.token}),/invalide ou expiré/);
   await login(admin);await assert.rejects(()=>cmd('create_join_link',{group_id:group.id}),/Administration/);await assert.rejects(()=>cmd('revoke_join_link',{group_id:group.id}),/Administration/);
   await login(owner);const fresh=await cmd('create_join_link',{group_id:group.id});
   await root();await db.query('update public.athletes set email=$1 where id=$2',['nouveau-009@example.test',legacy]);
   await login(newcomer);await cmd('accept_join_link',{token:fresh.token});
   await root();assert.equal(await scalar('select user_id from public.athletes where id=$1',[legacy]),null);
   assert.equal(await scalar('select count(*)::int from public.coach_athletes where athlete_id=$1',[athlete.get(newcomer)]),0);
   assert.equal(await scalar('select athlete_id from public.training_group_members m join public.athletes a on a.id=m.athlete_id where m.group_id=$1 and a.user_id=$2',[group.id,newcomer]),athlete.get(newcomer));
  });
  await t.test('RPC-only grants, cross-group revocation and poll creation cannot be bypassed',async()=>{
   await login(owner);const other=await cmd('save_group',{name:'Autre groupe'});const link=await cmd('create_join_link',{group_id:other.id});
   await assert.rejects(()=>cmd('revoke_join_link',{group_id:group.id,id:link.id}),/inaccessible/);
   await login(zoe);for(const action of ['invite_members','create_join_link','revoke_join_link'])await assert.rejects(()=>cmd(action,{group_id:group.id,user_ids:[emile]}),/Administration/);
   await assert.rejects(()=>cmd('create_poll',{group_id:group.id,question:'Non',options:['A','B']}),/Administration/);
   await assert.rejects(()=>db.query('select * from public.group_join_links'),/permission denied/);
   await assert.rejects(()=>db.query('select app_private.community_can_invite($1,$2,$3)',[group.id,owner,'member']),/permission denied/);
   await assert.rejects(()=>db.query('select app_private.community_calendar_command($1,$2)',['list_groups','{}']),/permission denied/);
   await root();assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.group_join_links'::regclass"),true);
   assert.equal(await scalar("select has_table_privilege('authenticated','public.group_join_links','select')"),false);
   assert.equal(await scalar("select prosecdef from pg_proc where oid='public.community_command(text,jsonb)'::regprocedure"),false);
   await db.query("select set_config('request.jwt.claim.sub','',false)");await db.exec('set role authenticated');await assert.rejects(()=>cmd('inspect_join_link',{token:link.token}),/Connecte-toi/);
  });
 } finally { await db.close(); }
});

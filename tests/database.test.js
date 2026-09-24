import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL semantics in an isolated database; no remote data is touched.
test('migration, data preservation and cross-account PostgreSQL security', async (t) => {
  const db = new PGlite();
  const coach1 = '10000000-0000-4000-8000-000000000001';
  const coach2 = '10000000-0000-4000-8000-000000000002';
  const athleteUser = '10000000-0000-4000-8000-000000000003';
  const outsider = '10000000-0000-4000-8000-000000000004';
  const legacyIncompleteUser = '10000000-0000-4000-8000-000000000006';
  const legacyAthlete = '20000000-0000-4000-8000-000000000001';
  let legacyFeedbackSession;
  const scalar = async (sql, params=[]) => Object.values((await db.query(sql,params)).rows[0] ?? {})[0];
  const admin = async () => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false)"); };
  const login = async id => { await admin(); await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[id]); await db.exec('set role authenticated'); };
  const signup = async (id,role,name,email=`${id}@example.test`) => {
    await admin();
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,email,JSON.stringify({account_type:role,full_name:name,is_admin:true,...(role==='athlete'?{birth_date:'2000-03-12',sex:'M'}:{})})]);
  };
  const denied = async operation => assert.rejects(operation,/permission denied|row-level security|Accès|Seul|Compte|Connecte-toi|cannot|invalide|obligatoire|already|check constraint/i);
  const mergeSnapshot = async (source,target,coach=coach1) => {
    const rows=(await db.query('select a.id,a.updated_at::text as athlete_version,c.updated_at::text as relation_version from public.athletes a join public.coach_athletes c on c.athlete_id=a.id where c.coach_id=$1 and a.id in ($2,$3)',[coach,source,target])).rows;
    const byId=new Map(rows.map(row=>[row.id,row]));
    return [source,target,byId.get(source)?.athlete_version,byId.get(target)?.athlete_version,byId.get(source)?.relation_version,byId.get(target)?.relation_version];
  };
  const mergeRoster = (snapshot,choices={weight:'target',record:'target'}) => scalar('select public.merge_roster_athlete($1,$2,$3,$4,$5,$6,$7)',[...snapshot,JSON.stringify(choices)]);

  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant execute on function auth.uid(),auth.role() to anon,authenticated,service_role;
      alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;
    `);
    const directory = new URL('../supabase/migrations/',import.meta.url);
    const files = (await readdir(directory)).filter(x=>x.endsWith('.sql')).sort();
    for (const file of files.filter(x=>!x.startsWith('202609'))) await db.exec(await readFile(new URL(file,directory),'utf8'));
    await signup(coach1,'coach','Coach historique','mixmasterkd@gmail.com');
    await db.query('insert into public.athletes(id,coach_id,first_name,last_name,notes,selected) values($1,$2,$3,$4,$5,true)',[legacyAthlete,coach1,'Martin','Historique','Note confidentielle']);
    await db.query("update public.athletes set birth_date='1999-01-01',sex='F',weight_kg=68.5,fights=4,wins=3,losses=1 where id=$1",[legacyAthlete]);
    for (let n=2;n<=8;n++) await db.query('insert into public.athletes(coach_id,first_name,last_name) values($1,$2,$3)',[coach1,`Athlète ${n}`,'Historique']);
    for (const file of files.filter(x=>x.startsWith('202609'))) {
      await db.exec(await readFile(new URL(file,directory),'utf8'));
      if(file.includes('secure_profile_roles')) await t.test('standalone security patch revokes inherited PUBLIC admin updates while preserving the legacy roster',async()=>{
        await login(coach1);
        await denied(()=>db.query('update public.profiles set is_admin=true where id=$1',[coach1]));
        assert.equal((await db.query('select * from public.athletes')).rows.length,8);
        await db.query("update public.profiles set phone='555-0100' where id=$1",[coach1]);
        await admin();
      });
      if(file.includes('training_platform')) await signup(legacyIncompleteUser,'athlete','Ancien profil incomplet');
      if(file.includes('shared_planning_and_gyms')) {
        const incomplete=await scalar('select id from public.athletes where user_id=$1',[legacyIncompleteUser]);
        legacyFeedbackSession=await scalar("insert into public.training_sessions(athlete_id,created_by,title,date,is_locked) values($1,$2,'Séance historique terminée','2026-09-20',true) returning id",[incomplete,coach1]);
        await db.query("insert into public.session_feedback(session_id,athlete_id,created_by,rpe,feeling,comment,updated_at) values($1,$2,$3,7,4,'Retour historique','2026-09-20 19:15:00+00')",[legacyFeedbackSession,incomplete,legacyIncompleteUser]);
      }
    }

    await t.test('completion upgrade backfills existing feedback without modifying authors, content locks or feedback',async()=>{
      assert.equal(await scalar("select completed_at=timestamp with time zone '2026-09-20 19:15:00+00' from public.training_sessions where id=$1",[legacyFeedbackSession]),true);
      assert.equal(await scalar('select is_locked from public.training_sessions where id=$1',[legacyFeedbackSession]),true);
      assert.equal(await scalar('select created_by from public.training_sessions where id=$1',[legacyFeedbackSession]),coach1);
      assert.equal(await scalar('select comment from public.session_feedback where session_id=$1',[legacyFeedbackSession]),'Retour historique');
    });

    await t.test('read-only deployment verification runs against the complete migration chain',async()=>{
      const results=await db.exec(await readFile(new URL('../supabase/tests/verify_upgrade.sql',import.meta.url),'utf8'));
      const permissions=results.find(result=>result.rows[0]?.completion_update_is_protected !== undefined)?.rows[0];
      assert.ok(permissions);
      assert.ok(Object.values(permissions).every(value=>value===true));
    });

    await t.test('invitation lock invariant rechecks accepted relation after sorted athlete locks before any profile write',async()=>{
      // PGlite executes one PostgreSQL connection, so it cannot reproduce a
      // two-connection row-lock wait. Verify the installed locking invariant in
      // addition to both serialized outcome tests below; do not claim a race run.
      const definition=await scalar("select pg_get_functiondef('public.accept_invitation(text)'::regprocedure)");
      const body=definition.replace(/--[^\n]*/g,'').replace(/\s+/g,' ').toLowerCase();
      const athleteLock=body.indexOf('perform 1 from public.athletes where id=v_inv.athlete_id or user_id=auth.uid() order by id for update;');
      const relationLock=body.indexOf('select * into v_relation from public.coach_athletes where athlete_id=v_inv.athlete_id and coach_id=v_inv.coach_id for update;');
      const statusCheck=body.indexOf("if not found or v_relation.status is distinct from 'accepted' then raise exception 'invitation révoquée.';");
      const firstWrite=body.indexOf('delete from public.athletes');
      assert.ok(athleteLock>=0 && relationLock>athleteLock && statusCheck>relationLock && firstWrite>statusCheck);
      const merge=await scalar("select pg_get_functiondef('public.merge_roster_athlete(uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,jsonb)'::regprocedure)");
      assert.doesNotMatch(merge.replace(/--[^\n]*/g,''),/(?:update|delete\s+from)\s+public\.athlete_invitations/i);
    });

    await t.test('existing athlete without DOB survives upgrade and unrelated edits until completing profile',async()=>{
      await login(legacyIncompleteUser);
      const incomplete=await scalar('select id from public.athletes');
      assert.equal(await scalar('select birth_date from public.athletes'),null);
      await db.query('update public.athletes set weight_kg=65 where id=$1',[incomplete]);
      assert.equal(await scalar('select weight_kg from public.athletes'),'65.0');
      const event=await scalar("insert into public.personal_events(athlete_id,title,date) values($1,'Conservé','2026-09-24') returning id",[incomplete]);
      await denied(()=>db.query('select public.save_athlete_profile($1)',[JSON.stringify({first_name:'Incomplet'})]));
      await db.query('select public.save_athlete_profile($1)',[JSON.stringify({birth_date:'2001-02-03'})]);
      assert.equal(await scalar('select count(*)::int from public.personal_events where id=$1',[event]),1);
      await db.query('select public.set_session_completed($1,false)',[legacyFeedbackSession]);
      await admin();
      await db.query('delete from auth.users where id=$1',[legacyIncompleteUser]);
      assert.equal(await scalar('select created_by from public.session_feedback where session_id=$1',[legacyFeedbackSession]),null);
      assert.equal(await scalar('select comment from public.session_feedback where session_id=$1',[legacyFeedbackSession]),'Retour historique');
      await db.query('delete from public.athletes where id=$1',[incomplete]);
    });

    await t.test('additive upgrade retains eight athletes, account and private roster data',async()=>{
      assert.equal(await scalar('select count(*)::int from public.athletes'),8);
      assert.equal(await scalar('select count(*)::int from public.coach_athletes'),8);
      assert.equal(await scalar('select is_admin from public.profiles where id=$1',[coach1]),true);
      assert.equal(await scalar('select private_notes from public.coach_athletes where athlete_id=$1',[legacyAthlete]),'Note confidentielle');
      assert.equal(await scalar('select selected from public.coach_athletes where athlete_id=$1',[legacyAthlete]),true);
    });
    await signup(coach2,'coach','Coach secondaire');
    await signup(athleteUser,'athlete','Martin connecté');
    await signup(outsider,'athlete','Autre athlète');

    await t.test('signup metadata cannot grant admin; account type and admin flags are protected',async()=>{
      await login(coach2);
      assert.equal(await scalar('select is_admin from public.profiles'),false);
      await denied(()=>db.query('update public.profiles set is_admin=true where id=$1',[coach2]));
      await denied(()=>db.query("update public.profiles set account_type='athlete' where id=$1",[coach2]));
      await db.query("update public.profiles set full_name='Coach modifié' where id=$1",[coach2]);
      assert.equal(await scalar('select display_name from public.coach_profiles'),'Coach modifié');
      await denied(()=>db.query('select notes from public.athletes'));
    });

    let token;
    await t.test('single-use invitation attaches the original roster UUID and safely merges only a pristine signup stub',async()=>{
      await login(coach1);
      const invite=await scalar('select public.create_invitation($1)',[legacyAthlete]);
      token=invite.token;
      assert.equal(token.length,64);
      await denied(()=>db.query('select * from public.athlete_invitations'));
      await login(athleteUser);
      assert.equal(await scalar('select public.accept_invitation($1)',[token]),legacyAthlete);
      assert.equal(await scalar('select id from public.athletes'),legacyAthlete);
      assert.equal(await scalar('select birth_date::text from public.athletes'),'2000-03-12');
      assert.equal(await scalar('select first_name from public.athletes'),'Martin connecté');
      assert.equal(await scalar('select sex from public.athletes'),'M');
      assert.equal(await scalar('select fights from public.athletes'),4);
      assert.equal(await scalar('select weight_kg from public.athletes'),'68.5');
      await assert.rejects(()=>db.query('select public.accept_invitation($1)',[token]),/invalide|expirée/);
      await denied(()=>db.query('select notes from public.athletes'));
      assert.equal(await scalar('select count(*)::int from public.coach_athletes'),0);
      const coaches=(await db.query('select * from public.athlete_coaches($1)',[legacyAthlete])).rows;
      assert.equal(coaches.length,1);
      assert.equal(coaches[0].coach_id,coach1);
      assert.equal('private_notes' in coaches[0],false);
    });

    let session1,session2;
    await t.test('coach connection requires athlete request plus coach acceptance, and private notes stay per coach',async()=>{
      await login(coach2);
      const code=await scalar('select join_code from public.coach_profiles');
      assert.equal(await scalar('select count(*)::int from public.athletes'),0);
      await login(athleteUser);
      assert.equal(await scalar('select public.request_coach($1)',[code]),coach2);
      await login(coach2);
      assert.equal(await scalar('select status from public.coach_athletes'),'pending');
      assert.equal(await scalar('select count(*)::int from public.athletes'),1);
      await denied(()=>db.query("insert into public.training_sessions(athlete_id,title,date) values($1,'Trop tôt','2026-09-21')",[legacyAthlete]));
      await db.query('select public.respond_coach_request($1,true)',[legacyAthlete]);
      assert.equal(await scalar('select private_notes from public.coach_athletes'),'');
      await db.query("update public.coach_athletes set private_notes='Deuxième note' where athlete_id=$1",[legacyAthlete]);
      await denied(()=>db.query('update public.coach_athletes set can_add_sessions=true'));
    });

    await t.test('locked sessions protect the creator and author identities cannot be reassigned',async()=>{
      await login(coach1);
      session1=await scalar("insert into public.training_sessions(athlete_id,title,date,blocks,is_locked) values($1,'Course','2026-09-21',$2,true) returning id",[legacyAthlete,JSON.stringify([{id:'b1',kind:'step',title:'Facile',duration_seconds:1200,children:[]}])]);
      await login(coach2);
      assert.equal(await scalar('select count(*)::int from public.training_sessions'),1);
      assert.equal((await db.query("update public.training_sessions set title='Vol' where id=$1 returning id",[session1])).rows.length,0);
      assert.equal((await db.query('delete from public.training_sessions where id=$1 returning id',[session1])).rows.length,0);
      session2=await scalar("insert into public.training_sessions(athlete_id,title,date) values($1,'Boxe','2026-09-21') returning id",[legacyAthlete]);
      await denied(()=>db.query("insert into public.training_sessions(athlete_id,created_by,title,date) values($1,$2,'Usurpation','2026-09-21')",[legacyAthlete,coach1]));
      await denied(()=>db.query("insert into public.training_sessions(athlete_id,title,date,author_name) values($1,'Usurpation','2026-09-21','Autre coach')",[legacyAthlete]));
      await denied(()=>db.query("insert into public.training_sessions(athlete_id,title,date,created_at) values($1,'Antidaté','2026-09-21','2001-01-01')",[legacyAthlete]));
      await denied(()=>db.query('update public.training_sessions set created_by=$1 where id=$2',[coach1,session2]));
      await denied(()=>db.query('update public.training_sessions set athlete_id=gen_random_uuid() where id=$1',[session2]));
      await db.query('update public.training_sessions set sort_order=512 where id=$1',[session2]);
      await login(athleteUser);
      assert.equal(await scalar('select count(*)::int from public.training_sessions'),2);
      assert.equal((await db.query("update public.training_sessions set title='Athlète' where id=$1 returning id",[session1])).rows.length,0);
      const own=await scalar("insert into public.training_sessions(athlete_id,title,date) values($1,'Athlète','2026-09-21') returning id",[legacyAthlete]);
      assert.equal(await scalar('select author_name from public.training_sessions where id=$1',[own]),'Martin connecté');
      await db.query('delete from public.training_sessions where id=$1',[own]);
    });

    await t.test('unlocked sessions can be moved by athlete and another linked coach but only creator changes lock or deletes',async()=>{
      await login(coach1);
      await db.query('update public.training_sessions set is_locked=false where id=$1',[session1]);
      await login(coach2);
      assert.equal((await db.query("update public.training_sessions set title='Partagée',date='2026-09-23' where id=$1 returning id",[session1])).rows.length,1);
      await denied(()=>db.query('update public.training_sessions set is_locked=true where id=$1',[session1]));
      await login(athleteUser);
      assert.equal((await db.query("update public.training_sessions set date='2026-09-24',sort_order=256 where id=$1 returning id",[session1])).rows.length,1);
      await denied(()=>db.query('update public.training_sessions set is_locked=true where id=$1',[session1]));
      assert.equal((await db.query('delete from public.training_sessions where id=$1 returning id',[session1])).rows.length,0);
      const own=await scalar("insert into public.training_sessions(athlete_id,title,date,is_locked) values($1,'Séance athlète','2026-09-25',true) returning id",[legacyAthlete]);
      await login(coach1);
      assert.equal((await db.query("update public.training_sessions set title='Modification' where id=$1 returning id",[own])).rows.length,0);
      await login(athleteUser);
      await db.query('update public.training_sessions set is_locked=false where id=$1',[own]);
      await login(coach1);
      assert.equal((await db.query("update public.training_sessions set title='Conseil du coach' where id=$1 returning id",[own])).rows.length,1);
      await login(athleteUser);
      await db.query('delete from public.training_sessions where id=$1',[own]);
      await db.query("insert into public.session_templates(title,blocks) values('Mon modèle','[]')");
      assert.equal(await scalar('select count(*)::int from public.session_templates'),1);
    });

    await t.test('registered identity belongs to athlete while linked coach edits sports results; free sheets have no calendar',async()=>{
      await login(coach1);
      await db.query('select public.update_roster_athlete($1,$2)',[legacyAthlete,JSON.stringify({weight_kg:72.5,fights:8,wins:5,losses:3,private_notes:'Note propre',selected:true})]);
      assert.equal(await scalar('select fights from public.athletes where id=$1',[legacyAthlete]),8);
      for (const patch of [{birth_date:'1998-01-01'},{first_name:'Autre'},{sex:'F'},{status:'injured'},{phone:'123'},{weight_unit:'lb'}]) {
        await denied(()=>db.query('select public.update_roster_athlete($1,$2)',[legacyAthlete,JSON.stringify(patch)]));
      }
      await denied(()=>db.query("update public.athletes set last_name='Autre' where id=$1",[legacyAthlete]));
      const free=await scalar('select public.create_roster_athlete($1)',[JSON.stringify({first_name:'Fiche libre'})]);
      await db.query('select public.update_roster_athlete($1,$2)',[free,JSON.stringify({birth_date:'1995-01-01',sex:'F',first_name:'Modifiable',status:'injured'})]);
      assert.equal(await scalar("select public.coach_has_permission($1,'roster')",[free]),true);
      assert.equal(await scalar("select public.coach_has_permission($1,'calendar')",[free]),false);
      await denied(()=>db.query("insert into public.training_sessions(athlete_id,title,date) values($1,'Pas de compte','2026-09-23')",[free]));
      await denied(()=>db.query("insert into public.personal_events(athlete_id,title,date) values($1,'Pas de compte','2026-09-23')",[free]));
      await login(athleteUser);
      await db.query('select public.save_athlete_profile($1)',[JSON.stringify({first_name:'Martin',last_name:'Athlète',birth_date:'2000-03-12',sex:'M',weight_unit:'lb',weight_kg:73,fights:9,wins:6,losses:3})]);
      assert.equal(await scalar('select full_name from public.profiles'),'Martin Athlète');
      assert.equal(await scalar('select weight_unit from public.athletes'),'lb');
      await denied(()=>db.query("update public.athletes set birth_date=null where id=$1",[legacyAthlete]));
      await denied(()=>db.query('select public.save_athlete_profile($1)',[JSON.stringify({birth_date:'2099-01-01'})]));
      await login(outsider);
      assert.equal((await db.query('update public.athletes set weight_kg=80 where id=$1 returning id',[legacyAthlete])).rows.length,0);
    });

    await t.test('signup requires DOB and gym directory is shared without granting calendar access',async()=>{
      await admin();
      await assert.rejects(()=>db.query('insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),$1,$2)',['invalid@example.test',JSON.stringify({account_type:'athlete',full_name:'Incomplet'})]),/date de naissance/);
      const withoutGym='10000000-0000-4000-8000-000000000007';
      await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[withoutGym,'nogym@example.test',JSON.stringify({account_type:'athlete',full_name:'Sans gym',birth_date:'2000-01-01',gym_id:null})]);
      assert.equal(await scalar('select gym_id from public.athletes where user_id=$1',[withoutGym]),null);
      await login(coach2);
      const gym=await scalar('select public.save_gym($1,$2)',['  Club   exemple ',' 123  Rue Test ']);
      assert.equal(await scalar('select gym_id from public.profiles'),gym);
      assert.equal(await scalar('select gym_name from public.gym_settings'),'Club exemple');
      assert.equal(await scalar('select public.save_gym($1,$2)',['club exemple','123 rue test']),gym);
      await denied(()=>db.query('select public.admin_save_gym($1,$2,null)',['Interdit','Rue test']));
      await login(coach1);
      const ownBefore=await scalar('select gym_id from public.profiles');
      const added=await scalar('select public.admin_save_gym($1,$2,null)',['Nouveau club','50 Rue Test']);
      assert.equal(await scalar('select gym_id from public.profiles'),ownBefore);
      const crew=await scalar('select id from public.gyms where is_default');
      await db.query('select public.admin_save_gym($1,$2,$3)',['Le Crew','Adresse de test',crew]);
      assert.equal(await scalar('select count(*)::int from public.gyms where is_default'),1);
      assert.equal(await scalar('select address from public.gyms where id=$1',[crew]),'Adresse de test');
      await login(outsider);
      await denied(()=>db.query('select public.save_gym($1,$2)',['Interdit','Rue test']));
      await db.query('select public.save_athlete_profile($1)',[JSON.stringify({gym_id:gym})]);
      assert.equal(await scalar('select gym_id from public.athletes'),gym);
      await login(coach2);
      assert.equal((await db.query('select id from public.athletes where user_id=$1',[outsider])).rows.length,0);
      await admin(); await db.exec('set role anon');
      assert.equal(await scalar('select count(*)::int from public.gyms where id=$1',[added]),1);
      await denied(()=>db.query("insert into public.gyms(name,address) values('Intrus','Adresse')"));
      await denied(()=>db.query('select created_by from public.gyms'));
    });

    await t.test('admin test mapping is service-managed and visible only to its owning administrator',async()=>{
      await admin();
      await db.query('insert into public.admin_test_accounts(admin_id,test_user_id) values($1,$2)',[coach1,outsider]);
      await login(coach1);
      assert.equal(await scalar('select test_user_id from public.admin_test_accounts'),outsider);
      await denied(()=>db.query('update public.admin_test_accounts set test_user_id=$1',[athleteUser]));
      await login(coach2);
      assert.equal(await scalar('select count(*)::int from public.admin_test_accounts'),0);
      await denied(()=>db.query('insert into public.admin_test_accounts(admin_id,test_user_id) values($1,$2)',[coach2,athleteUser]));
      await login(outsider);
      assert.equal(await scalar('select count(*)::int from public.admin_test_accounts'),0);
    });

    await t.test('completion is athlete-only, independent from locked content and feedback, and idempotent',async()=>{
      await login(coach1);
      await db.query('update public.training_sessions set is_locked=true where id=$1',[session1]);
      await denied(()=>db.query('select public.set_session_completed($1,true)',[session1]));
      await denied(()=>db.query('update public.training_sessions set completed_at=now() where id=$1',[session1]));
      await login(outsider);
      await denied(()=>db.query('select public.set_session_completed($1,true)',[session1]));
      await login(athleteUser);
      assert.equal(await scalar('select completed_at from public.training_sessions where id=$1',[session1]),null);
      await assert.rejects(()=>db.query('select public.save_session_feedback($1,7,3,$2)',[session1,'Trop tôt']),/terminée/);
      await assert.rejects(()=>db.query('insert into public.session_feedback(session_id,athlete_id,rpe) values($1,$2,7)',[session1,legacyAthlete]),/terminée/);
      await denied(()=>db.query('update public.training_sessions set completed_at=now() where id=$1',[session1]));
      await denied(()=>db.query("insert into public.training_sessions(athlete_id,title,date,completed_at) values($1,'Contournement','2026-09-25',now())",[legacyAthlete]));
      await denied(()=>db.query('select public.set_session_completed($1,null)',[session1]));
      assert.equal((await db.query("update public.training_sessions set title='Toujours verrouillée' where id=$1 returning id",[session1])).rows.length,0);
      const completedAt=await scalar('select public.set_session_completed($1,true)',[session1]);
      assert.ok(completedAt);
      assert.deepEqual(await scalar('select public.set_session_completed($1,true)',[session1]),completedAt);
      assert.equal(await scalar('select count(*)::int from public.session_feedback'),0);
      assert.equal(await scalar('select created_by from public.training_sessions where id=$1',[session1]),coach1);
      assert.equal(await scalar('select is_locked from public.training_sessions where id=$1',[session1]),true);
      await db.query('select public.save_session_feedback($1,6,4,$2)',[session1,'Retour conservé']);
      assert.equal(await scalar('select public.set_session_completed($1,false)',[session1]),null);
      assert.equal(await scalar('select public.set_session_completed($1,false)',[session1]),null);
      assert.equal(await scalar('select comment from public.session_feedback where session_id=$1',[session1]),'Retour conservé');
      await assert.rejects(()=>db.query("update public.session_feedback set comment='Interdit après annulation' where session_id=$1",[session1]),/terminée/);
      await assert.rejects(()=>db.query('select public.save_session_feedback($1,7,3,$2)',[session1,'Interdit après annulation']),/terminée/);
      await db.query('select public.set_session_completed($1,true)',[session1]);
      await db.query('select public.set_coach_permissions($1,$2,true,true,true,false)',[legacyAthlete,coach2]);
      await login(coach2);
      assert.ok(await scalar('select completed_at from public.training_sessions where id=$1',[session1]));
      assert.equal(await scalar('select count(*)::int from public.session_feedback'),0);
      await denied(()=>db.query('select public.set_session_completed($1,false)',[session1]));
      await login(athleteUser);
      assert.equal(await scalar('select comment from public.session_feedback where session_id=$1',[session1]),'Retour conservé');
      await db.query('select public.set_coach_permissions($1,$2,true,true,true,true)',[legacyAthlete,coach2]);
      await login(coach1);
      await db.query('update public.training_sessions set is_locked=false where id=$1',[session1]);
      const beforeEdit=await scalar('select completed_at from public.training_sessions where id=$1',[session1]);
      await db.query("update public.training_sessions set date='2026-09-25' where id=$1",[session1]);
      assert.deepEqual(await scalar('select completed_at from public.training_sessions where id=$1',[session1]),beforeEdit);
    });

    await t.test('personal events and atomic feedback belong to the athlete; unrelated accounts see nothing',async()=>{
      await login(athleteUser);
      await db.query("insert into public.personal_events(athlete_id,title,category,date) values($1,'Examen','exam','2026-09-22')",[legacyAthlete]);
      await db.query('select public.save_session_feedback($1,7,3,$2)',[session1,'Bonne séance']);
      await db.query('select public.save_session_feedback($1,8,4,$2)',[session1,'Corrigé']);
      assert.equal(await scalar('select rpe from public.session_feedback'),8);
      await denied(()=>db.query('select public.save_session_feedback($1,11,4,$2)',[session1,'Invalide']));
      await login(coach2);
      assert.equal(await scalar('select count(*)::int from public.personal_events'),1);
      const event=await scalar('select id from public.personal_events');
      assert.equal(await scalar('select color from public.personal_events where id=$1',[event]),'sand');
      await db.query("update public.personal_events set color='lavender' where id=$1",[event]);
      assert.equal(await scalar('select color from public.personal_events where id=$1',[event]),'lavender');
      await denied(()=>db.query("update public.personal_events set color='invalid' where id=$1",[event]));
      assert.equal((await db.query("update public.personal_events set date='2026-09-25' where id=$1 returning id",[event])).rows.length,1);
      await denied(()=>db.query('update public.personal_events set is_locked=true where id=$1',[event]));
      assert.equal((await db.query('delete from public.personal_events where id=$1 returning id',[event])).rows.length,0);
      const coachEvent=await scalar("insert into public.personal_events(athlete_id,title,date,is_locked) values($1,'Évaluation','2026-09-26',true) returning id",[legacyAthlete]);
      await login(athleteUser);
      assert.equal((await db.query("update public.personal_events set title='Bloqué' where id=$1 returning id",[coachEvent])).rows.length,0);
      assert.equal((await db.query("update public.personal_events set color='coral' where id=$1 returning id",[coachEvent])).rows.length,0);
      await login(coach2);
      await db.query('delete from public.personal_events where id=$1',[coachEvent]);
      assert.equal(await scalar('select count(*)::int from public.session_feedback'),1);
      await denied(()=>db.query('select public.save_session_feedback($1,4,4,$2)',[session1,'Coach']));
      await login(outsider);
      assert.equal(await scalar('select count(*)::int from public.training_sessions'),0);
      assert.equal(await scalar('select count(*)::int from public.personal_events'),0);
      assert.equal(await scalar('select count(*)::int from public.session_feedback'),0);
      await denied(()=>db.query('select public.save_session_feedback($1,4,4,$2)',[session1,'Intrus']));
      const ownAthlete=await scalar('select id from public.athletes');
      await denied(()=>db.query('insert into public.session_feedback(session_id,athlete_id,rpe) values($1,$2,5)',[session2,ownAthlete]));
      await denied(()=>db.query("insert into public.personal_events(athlete_id,title,date) values($1,'Intrus','2026-09-21')",[legacyAthlete]));
    });

    await t.test('athlete permissions and revocation immediately constrain coach access',async()=>{
      await login(athleteUser);
      await db.query('select public.set_coach_permissions($1,$2,true,false,false,false)',[legacyAthlete,coach2]);
      await login(coach2);
      assert.equal(await scalar('select count(*)::int from public.session_feedback'),0);
      assert.equal((await db.query("update public.training_sessions set title='Interdit' where id=$1 returning id",[session2])).rows.length,0);
      await denied(()=>db.query("insert into public.training_sessions(athlete_id,title,date) values($1,'Interdit','2026-09-21')",[legacyAthlete]));
      await login(athleteUser);
      await db.query('select public.revoke_coach_relation($1,$2)',[legacyAthlete,coach2]);
      await login(coach2);
      assert.equal(await scalar('select count(*)::int from public.training_sessions'),0);
      assert.equal(await scalar('select count(*)::int from public.athletes'),0);
    });

    await t.test('invalid nested blocks and template bounds are rejected by PostgreSQL',async()=>{
      await login(coach1);
      for(const blocks of [[{kind:'step',duration_seconds:-1}],[{kind:'repeat',repeat_count:101,children:[]}],[{kind:'step',zone:8}],{kind:'step'},[{kind:'repeat',repeat_count:2,children:null}]]) {
        await denied(()=>db.query("insert into public.session_templates(title,blocks) values('Invalide',$1)",[JSON.stringify(blocks)]));
      }
      let explosion=[{kind:'step',duration_seconds:1,children:[]}];
      for(let depth=0;depth<3;depth++) explosion=[{kind:'repeat',repeat_count:100,children:explosion}];
      await denied(()=>db.query("insert into public.session_templates(title,blocks) values('Explosion',$1)",[JSON.stringify(explosion)]));
      let tooDeep=[{kind:'step',duration_seconds:1,children:[]}];
      for(let depth=0;depth<4;depth++) tooDeep=[{kind:'repeat',repeat_count:1,children:tooDeep}];
      await denied(()=>db.query("insert into public.session_templates(title,blocks) values('Trop profond',$1)",[JSON.stringify(tooDeep)]));
      await db.query("insert into public.session_templates(title,sport,blocks) values('Natation','swimming',$1)",[JSON.stringify([{kind:'repeat',repeat_count:3,children:[{kind:'step',distance_m:100,children:[]}]}])]);
      await login(coach2);
      assert.equal(await scalar('select count(*)::int from public.session_templates'),0);
    });

    await t.test('invitation cannot erase a profile that already has personal data; expired and hijacked invitations fail',async()=>{
      await login(coach1);
      const target=await scalar('select public.create_roster_athlete($1)',[JSON.stringify({first_name:'Sans compte',private_notes:'Privé'})]);
      const invite=await scalar('select public.create_invitation($1)',[target]);
      await login(outsider);
      const self=await scalar('select id from public.athletes');
      await db.query("insert into public.personal_events(athlete_id,title,date) values($1,'Existant','2026-09-22')",[self]);
      await assert.rejects(()=>db.query('select public.accept_invitation($1)',[invite.token]),/profil actif/);
      assert.equal(await scalar('select count(*)::int from public.personal_events'),1);
      await admin();
      await db.query("update public.athlete_invitations set expires_at=now()-interval '1 day' where athlete_id=$1",[target]);
      await login(outsider);
      await assert.rejects(()=>db.query('select public.accept_invitation($1)',[invite.token]),/expirée/);
      await login(coach1);
      await assert.rejects(()=>db.query('select public.create_invitation($1)',[legacyAthlete]),/déjà un compte/);
    });

    await t.test('changing only a legacy weight class prevents invitation merge and preserves the athlete profile',async()=>{
      const establishedUser='10000000-0000-4000-8000-000000000005';
      await signup(establishedUser,'athlete','Athlète avec catégorie');
      await login(establishedUser);
      const ownAthlete=await scalar('select id from public.athletes');
      await db.query("update public.athletes set weight_class='Welter' where id=$1",[ownAthlete]);
      await login(coach1);
      const target=await scalar('select public.create_roster_athlete($1)',[JSON.stringify({first_name:'Fiche invitée'})]);
      const invite=await scalar('select public.create_invitation($1)',[target]);
      await login(establishedUser);
      await assert.rejects(()=>db.query('select public.accept_invitation($1)',[invite.token]),/profil actif/);
      assert.equal(await scalar('select id from public.athletes'),ownAthlete);
      assert.equal(await scalar('select weight_class from public.athletes'),'Welter');
      await admin();
      assert.equal(await scalar('select user_id from public.athletes where id=$1',[target]),null);
      assert.equal(await scalar('select accepted_at from public.athlete_invitations where athlete_id=$1',[target]),null);
    });

    await t.test('manual attachment preserves the registered identity, history, other coaches and full private notes',async()=>{
      const targetUser='10000000-0000-4000-8000-000000000008';
      await signup(targetUser,'athlete','Identité inscrite');
      const target=await scalar('select id from public.athletes where user_id=$1',[targetUser]);
      await db.query("update public.athletes set weight_kg=81,fights=12,wins=8,losses=4,weight_unit='lb',phone='555-0188' where id=$1",[target]);
      await db.query("insert into public.coach_athletes(coach_id,athlete_id,status,can_view_calendar,can_add_sessions,can_edit_own_sessions,can_view_feedback,private_notes) values($1,$2,'accepted',false,false,false,false,$3)",[coach1,target,'T'.repeat(20000)]);
      await db.query("insert into public.coach_athletes(coach_id,athlete_id,status,private_notes) values($1,$2,'accepted','Notes autre coach cible')",[coach2,target]);
      const historySession=await scalar("insert into public.training_sessions(athlete_id,created_by,title,date,is_locked,completed_at) values($1,$2,'Historique à conserver','2026-09-20',true,now()) returning id",[target,coach2]);
      await db.query("insert into public.personal_events(athlete_id,created_by,title,date) values($1,$2,'Événement à conserver','2026-09-20')",[target,targetUser]);
      await db.query("insert into public.session_feedback(session_id,athlete_id,created_by,rpe,feeling,comment) values($1,$2,$3,7,4,'Feedback à conserver')",[historySession,target,targetUser]);
      await login(coach1);
      const source=await scalar('select public.create_roster_athlete($1)',[JSON.stringify({first_name:'Ancienne identité',birth_date:'1990-01-01',sex:'F',weight_kg:72.5,fights:5,wins:3,losses:2,private_notes:'S'.repeat(20000),selected:true})]);
      const invitation=await scalar('select public.create_invitation($1)',[source]);
      await admin();
      await db.query("insert into public.coach_athletes(coach_id,athlete_id,status,private_notes,selected) values($1,$2,'accepted','Notes autre coach source',true)",[coach2,source]);
      const beforeTarget=await scalar("select to_jsonb(a)-array['weight_kg','fights','wins','losses','updated_at','onboarding_stub'] from public.athletes a where id=$1",[target]);
      const beforeSource=await scalar('select to_jsonb(a) from public.athletes a where id=$1',[source]);
      const otherLinks=(await db.query('select to_jsonb(c) as row from public.coach_athletes c where coach_id=$1 and athlete_id in ($2,$3) order by athlete_id',[coach2,source,target])).rows;
      const targetHistory=async()=>scalar('select jsonb_build_object(\'sessions\',(select jsonb_agg(to_jsonb(s) order by id) from public.training_sessions s where athlete_id=$1),\'events\',(select jsonb_agg(to_jsonb(e) order by id) from public.personal_events e where athlete_id=$1),\'feedback\',(select jsonb_agg(to_jsonb(f) order by session_id) from public.session_feedback f where athlete_id=$1))',[target]);
      const beforeHistory=await targetHistory();
      await login(coach1);
      const versions=await mergeSnapshot(source,target);
      assert.equal(await mergeRoster(versions,{weight:'source',record:'target'}),target);
      assert.equal(await scalar('select weight_kg from public.athletes where id=$1',[target]),'72.5');
      assert.equal(await scalar('select fights from public.athletes where id=$1',[target]),12);
      const notes=await scalar('select private_notes from public.coach_athletes where athlete_id=$1',[target]);
      assert.ok(notes.startsWith('T'.repeat(20000))); assert.ok(notes.endsWith('S'.repeat(20000))); assert.ok(notes.length>40000);
      assert.equal(await scalar('select private_notes from public.coach_athletes where athlete_id=$1',[source]),'S'.repeat(20000));
      assert.equal(await scalar('select status from public.coach_athletes where athlete_id=$1',[source]),'revoked');
      assert.equal(await scalar('select selected from public.coach_athletes where athlete_id=$1',[source]),false);
      assert.equal(await scalar('select selected from public.coach_athletes where athlete_id=$1',[target]),true);
      assert.equal(await scalar("select public.coach_has_permission($1,'calendar')",[target]),false);
      assert.equal(await scalar("select public.coach_has_permission($1,'add')",[target]),false);
      assert.equal(await scalar('select count(*)::int from public.training_sessions where athlete_id=$1',[target]),0);
      await denied(()=>mergeRoster(versions));
      await db.query('select public.update_roster_athlete($1,$2)',[target,JSON.stringify({private_notes:notes,weight_kg:73})]);
      assert.equal(await scalar('select private_notes from public.coach_athletes where athlete_id=$1',[target]),notes);
      await assert.rejects(()=>db.query('select public.update_roster_athlete($1,$2)',[target,JSON.stringify({private_notes:notes+'X'})]),/Aucun texte n’a été tronqué/);
      assert.equal(await scalar('select private_notes from public.coach_athletes where athlete_id=$1',[target]),notes);
      const editedNotes='U'+notes.slice(1);
      await db.query('select public.update_roster_athlete($1,$2)',[target,JSON.stringify({private_notes:editedNotes})]);
      assert.equal(await scalar('select private_notes from public.coach_athletes where athlete_id=$1',[target]),editedNotes);
      await admin();
      assert.deepEqual(await scalar("select to_jsonb(a)-array['weight_kg','fights','wins','losses','updated_at','onboarding_stub'] from public.athletes a where id=$1",[target]),beforeTarget);
      assert.deepEqual(await scalar('select to_jsonb(a) from public.athletes a where id=$1',[source]),beforeSource);
      assert.deepEqual((await db.query('select to_jsonb(c) as row from public.coach_athletes c where coach_id=$1 and athlete_id in ($2,$3) order by athlete_id',[coach2,source,target])).rows,otherLinks);
      assert.deepEqual(await targetHistory(),beforeHistory);
      await login(targetUser);
      await assert.rejects(()=>db.query('select public.accept_invitation($1)',[invitation.token]),/révoquée/);
      assert.equal(await scalar('select id from public.athletes'),target);
      await admin();
      assert.equal(await scalar('select user_id from public.athletes where id=$1',[source]),null);
      assert.equal(await scalar('select accepted_at from public.athlete_invitations where athlete_id=$1',[source]),null);
    });

    await t.test('if invitation acceptance wins first, manual attachment cannot archive its now-registered source',async()=>{
      const targetUser='10000000-0000-4000-8000-000000000011';
      const invitedUser='10000000-0000-4000-8000-000000000012';
      await signup(targetUser,'athlete','Cible déjà liée');
      const target=await scalar('select id from public.athletes where user_id=$1',[targetUser]);
      await db.query("insert into public.coach_athletes(coach_id,athlete_id,status,private_notes) values($1,$2,'accepted','Cible conservée')",[coach1,target]);
      await login(coach1);
      const source=await scalar('select public.create_roster_athlete($1)',[JSON.stringify({first_name:'Invitation en cours',private_notes:'Source conservée'})]);
      const invitation=await scalar('select public.create_invitation($1)',[source]);
      const versions=await mergeSnapshot(source,target);
      await signup(invitedUser,'athlete','Nouveau compte invité');
      await login(invitedUser);
      assert.equal(await scalar('select public.accept_invitation($1)',[invitation.token]),source);
      assert.equal(await scalar('select birth_date::text from public.athletes'),'2000-03-12');
      await login(coach1);
      await assert.rejects(()=>mergeRoster(versions),/possède déjà un compte/);
      assert.equal(await scalar('select status from public.coach_athletes where athlete_id=$1',[source]),'accepted');
      assert.equal(await scalar('select user_id from public.athletes where id=$1',[source]),invitedUser);
      assert.equal(await scalar('select private_notes from public.coach_athletes where athlete_id=$1',[source]),'Source conservée');
      assert.equal(await scalar('select private_notes from public.coach_athletes where athlete_id=$1',[target]),'Cible conservée');
    });

    await t.test('attachment requires explicit choices, four fresh versions, two accepted links and correct account types',async()=>{
      const targetUser='10000000-0000-4000-8000-000000000009';
      await signup(targetUser,'athlete','Cible des contrôles');
      const target=await scalar('select id from public.athletes where user_id=$1',[targetUser]);
      await db.query("insert into public.coach_athletes(coach_id,athlete_id,status) values($1,$2,'accepted')",[coach1,target]);
      await login(coach1);
      const source=await scalar('select public.create_roster_athlete($1)',[JSON.stringify({first_name:'Source contrôlée',weight_kg:67,fights:7,wins:5,losses:2,selected:true})]);
      const freeTarget=await scalar('select public.create_roster_athlete($1)',[JSON.stringify({first_name:'Cible libre interdite'})]);
      let versions=await mergeSnapshot(source,target);
      for(const choices of [null,{},[],{weight:'source'},{weight:'source',record:null},{weight:'sum',record:'target'},{weight:'target',record:'add'},{weight:'target',record:'target',first_name:'Interdit'}]) {
        await assert.rejects(()=>mergeRoster(versions,choices),/Choisis explicitement/);
      }
      for(const index of [2,3,4,5]) {
        const missing=[...versions]; missing[index]=null;
        await assert.rejects(()=>mergeRoster(missing),/Versions/);
        const stale=[...versions]; stale[index]='2000-01-01T00:00:00Z';
        await assert.rejects(()=>mergeRoster(stale),/a changé/);
      }
      await assert.rejects(()=>mergeRoster([source,source,...versions.slice(2)]),/distinctes/);
      await assert.rejects(async()=>mergeRoster(await mergeSnapshot(source,freeTarget)),/cible doit être un athlète inscrit/i);
      await assert.rejects(async()=>mergeRoster(await mergeSnapshot(target,source)),/possède déjà un compte/);
      await login(coach2); await denied(()=>mergeRoster(versions));
      await login(outsider); await denied(()=>mergeRoster(versions));
      await login(targetUser); await denied(()=>mergeRoster(versions));
      for(const relationId of [source,target]) for(const status of ['pending','revoked']) {
        await admin(); await db.query('update public.coach_athletes set status=$1 where coach_id=$2 and athlete_id=$3',[status,coach1,relationId]);
        await login(coach1); await denied(()=>mergeRoster(versions));
        await admin(); await db.query("update public.coach_athletes set status='accepted' where coach_id=$1 and athlete_id=$2",[coach1,relationId]);
      }
      await admin(); await db.query("update public.athletes set status='injured',weight_kg=90,fights=2,wins=1,losses=1 where id=$1",[target]);
      await login(coach1); versions=await mergeSnapshot(source,target);
      assert.equal(await mergeRoster(versions,{weight:'target',record:'source'}),target);
      assert.equal(await scalar('select weight_kg from public.athletes where id=$1',[target]),'90.0');
      assert.deepEqual((await db.query('select fights,wins,losses from public.athletes where id=$1',[target])).rows[0],{fights:7,wins:5,losses:2});
      assert.equal(await scalar('select selected from public.coach_athletes where athlete_id=$1',[target]),false);
      assert.equal(await scalar('select status from public.athletes where id=$1',[target]),'injured');
      await denied(()=>db.query('select public.update_roster_athlete($1,$2)',[target,JSON.stringify({birth_date:'1999-01-01'})]));
    });

    await t.test('attachment refuses a free sheet with legacy calendar data and makes no partial changes',async()=>{
      const targetUser='10000000-0000-4000-8000-000000000010';
      await signup(targetUser,'athlete','Cible historique');
      const target=await scalar('select id from public.athletes where user_id=$1',[targetUser]);
      await db.query("insert into public.coach_athletes(coach_id,athlete_id,status,private_notes) values($1,$2,'accepted','Cible intacte')",[coach1,target]);
      await login(coach1);
      const source=await scalar('select public.create_roster_athlete($1)',[JSON.stringify({first_name:'Ancien calendrier',private_notes:'Source intacte',selected:true})]);
      for(const kind of ['session','event','feedback']) {
        await admin();
        let session,event;
        if(kind==='session') session=await scalar("insert into public.training_sessions(athlete_id,created_by,title,date) values($1,$2,'Ancienne séance','2026-09-20') returning id",[source,coach1]);
        if(kind==='event') event=await scalar("insert into public.personal_events(athlete_id,created_by,title,date) values($1,$2,'Ancien événement','2026-09-20') returning id",[source,coach1]);
        if(kind==='feedback') {
          session=await scalar("insert into public.training_sessions(athlete_id,created_by,title,date,completed_at) values($1,$2,'Ancien feedback','2026-09-20',now()) returning id",[source,coach1]);
          await db.query('insert into public.session_feedback(session_id,athlete_id,created_by,rpe) values($1,$2,$3,5)',[session,source,coach1]);
          // Simulate an inherited inconsistent feedback reference: feedback alone
          // must block attachment, even when no session remains on the free sheet.
          await db.query('update public.training_sessions set athlete_id=$1 where id=$2',[target,session]);
        }
        await login(coach1); const versions=await mergeSnapshot(source,target);
        await assert.rejects(()=>mergeRoster(versions),/données de calendrier/);
        assert.equal(await scalar('select status from public.coach_athletes where athlete_id=$1',[source]),'accepted');
        assert.equal(await scalar('select selected from public.coach_athletes where athlete_id=$1',[source]),true);
        assert.equal(await scalar('select private_notes from public.coach_athletes where athlete_id=$1',[target]),'Cible intacte');
        await admin();
        if(session) await db.query('delete from public.training_sessions where id=$1',[session]);
        if(event) await db.query('delete from public.personal_events where id=$1',[event]);
      }
    });

    await t.test('archival and deleting a coach account preserve shared athletes and authored history',async()=>{
      await login(coach1);
      await db.query('select public.archive_roster_athlete($1)',[legacyAthlete]);
      assert.equal((await db.query('select id from public.athletes where id=$1',[legacyAthlete])).rows.length,0);
      await admin();
      await db.query('delete from auth.users where id=$1',[coach1]);
      assert.equal(await scalar('select count(*)::int from public.athletes where id=$1',[legacyAthlete]),1);
      assert.equal(await scalar('select coach_id from public.athletes where id=$1',[legacyAthlete]),null);
      assert.equal(await scalar('select count(*)::int from public.training_sessions where athlete_id=$1',[legacyAthlete]),2);
      assert.equal(await scalar('select created_by from public.training_sessions where id=$1',[session1]),null);
      assert.equal(await scalar('select author_name from public.training_sessions where id=$1',[session1]),'Coach historique');
    });

    await t.test('anonymous callers have neither table access nor invitation RPC access',async()=>{
      await admin(); await db.exec('set role anon');
      await denied(()=>db.query('select id from public.athletes'));
      await denied(()=>db.query('select public.accept_invitation($1)',[token]));
      await denied(()=>db.query('select public.set_session_completed($1,true)',[session1]));
      await denied(()=>db.query("select public.merge_roster_athlete($1,$1,now(),now(),now(),now(),'{\"weight\":\"target\",\"record\":\"target\"}')",[legacyAthlete]));
    });
  } finally { await db.close(); }
});

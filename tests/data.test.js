import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAccount, ATHLETE_FIELDS, updateTemplate } from '../js/data.js';

const user={id:'coach-user'};
const coachProfile={id:user.id,full_name:'Camille',phone:'555-0100',is_admin:false,account_type:'coach'};
const gym={gym_name:'Gym du Canal',address:'42, rue du Canal'};
const success=data=>({data,error:null});
const failure=(code,message)=>({data:null,error:{code,message}});

function mockDatabase(respond) {
  const calls=[];
  return {calls,from(table){
    const query={table,columns:null,filters:[],order:null,limit:null,single:false,maybeSingle:false};
    const chain={
      select(columns){query.columns=columns;return chain;},
      eq(column,value){query.filters.push([column,value]);return chain;},
      order(column){query.order=column;return chain;},
      limit(count){query.limit=count;return chain;},
      single(){query.single=true;return chain;},
      maybeSingle(){query.maybeSingle=true;return chain;},
      then(resolve,reject){calls.push(query);return Promise.resolve().then(()=>respond(query)).then(resolve,reject);},
    };
    return chain;
  }};
}
function standardResponse(query) {
  switch(query.table) {
    case 'profiles': return success(coachProfile);
    case 'gym_settings': return success(gym);
    case 'coach_profiles': return success({user_id:user.id,display_name:'Camille',join_code:'code'});
    case 'coach_athletes': return success([{coach_id:user.id,athlete_id:'athlete-1',status:'accepted',private_notes:'Note privée'}]);
    case 'athletes': return success([{id:'athlete-1',first_name:'Martin',last_name:''}]);
    case 'training_sessions': return success([]);
    default: throw new Error(`Unexpected query ${query.table}`);
  }
}

test('loadAccount retrieves the configured gym and migrated coach data with safe athlete columns',async()=>{
  const db=mockDatabase(standardResponse);
  const account=await loadAccount(user,db);
  assert.deepEqual(account.profile,coachProfile);
  assert.deepEqual(account.gym,gym);
  assert.equal(account.coach.user_id,user.id);
  assert.equal(account.relations[0].private_notes,'Note privée');
  assert.equal(account.athletes[0].id,'athlete-1');
  assert.equal(account.planningAvailable,true);
  const gymQuery=db.calls.find(q=>q.table==='gym_settings');
  assert.equal(gymQuery.columns,'gym_name,address');
  assert.deepEqual(gymQuery.filters,[['coach_id',user.id]]);
  assert.equal(gymQuery.maybeSingle,true);
  const athleteQuery=db.calls.find(q=>q.table==='athletes');
  assert.equal(athleteQuery.columns,ATHLETE_FIELDS);
  for(const privateColumn of ['notes','selected']) assert.equal(athleteQuery.columns.split(',').includes(privateColumn),false);
});

for(const missing of [
  failure('42703','column profiles.account_type does not exist'),
  failure('42703','column "account_type" does not exist'),
  failure('PGRST204',"Could not find the 'account_type' column of 'profiles' in the schema cache"),
]) test(`loadAccount supports the historical schema only for missing account_type (${missing.error.code}: ${missing.error.message})`,async()=>{
  const db=mockDatabase(query=>{
    if(query.table==='profiles')return query.columns.includes('account_type')?missing:success({id:user.id,full_name:'Coach historique',phone:null,is_admin:true});
    if(query.table==='gym_settings')return success(gym);
    throw new Error('Legacy fallback must not query planning or protected global athlete fields');
  });
  const account=await loadAccount(user,db);
  assert.deepEqual(account,{profile:{id:user.id,full_name:'Coach historique',phone:null,is_admin:true,account_type:'coach'},gym,coach:null,relations:[],athletes:[],planningAvailable:false});
  assert.deepEqual(db.calls.map(q=>q.table),['profiles','profiles','gym_settings']);
  assert.equal(db.calls[1].columns,'id,full_name,phone,is_admin');
});

test('loadAccount does not disguise other profile-column errors or profile permissions as an old schema',async()=>{
  for(const error of [
    failure('42703','column profiles.full_name does not exist'),
    failure('42703','column profiles.account_type_lookup does not exist'),
    failure('42703','column profiles.full_name does not exist; did you mean profiles.account_type?'),
    failure('PGRST204',"Could not find the 'account_type' column of 'other_table' in the schema cache"),
    failure('42501','permission denied for profiles.account_type'),
    failure('PGRST116','No profile row'),
  ]) {
    const db=mockDatabase(()=>error);
    await assert.rejects(()=>loadAccount(user,db));
    assert.equal(db.calls.length,1);
  }
});

test('loadAccount returns an unavailable planner only for absent planning tables while retaining gym identity',async()=>{
  for(const [table,code] of [['coach_profiles','42P01'],['coach_athletes','PGRST205'],['training_sessions','42P01']]) {
    const db=mockDatabase(query=>query.table===table?failure(code,`Missing ${table}`):standardResponse(query));
    const account=await loadAccount(user,db);
    assert.deepEqual(account,{profile:coachProfile,gym,coach:null,relations:[],athletes:[],planningAvailable:false});
  }
});

test('loadAccount propagates permissions and network failures even alongside a missing planning table',async()=>{
  for(const problem of [failure('42501','permission denied'),failure('PGRST000','Connection unavailable'),failure('42703','column athletes.user_id does not exist')]) {
    const db=mockDatabase(query=>{
      if(query.table==='coach_profiles')return failure('42P01','Missing coach_profiles');
      if(query.table==='athletes')return problem;
      return standardResponse(query);
    });
    await assert.rejects(()=>loadAccount(user,db));
  }
  const networkError=new Error('Failed to fetch');
  const db=mockDatabase(query=>{
    if(query.table==='coach_profiles')return failure('PGRST205','Missing coach_profiles');
    if(query.table==='athletes')throw networkError;
    return standardResponse(query);
  });
  await assert.rejects(()=>loadAccount(user,db),error=>error===networkError);
});

test('loadAccount never masks errors loading the existing gym table, including during legacy fallback',async()=>{
  for(const legacy of [false,true]) {
    const db=mockDatabase(query=>{
      if(legacy&&query.table==='profiles')return query.columns.includes('account_type')?failure('42703','column profiles.account_type does not exist'):success(coachProfile);
      if(query.table==='gym_settings')return failure('42P01','Missing gym_settings');
      if(query.table==='coach_profiles')return failure('42P01','Missing coach_profiles');
      return standardResponse(query);
    });
    await assert.rejects(()=>loadAccount(user,db));
  }
});

test('loadAccount permits an unconfigured gym without inventing an identity',async()=>{
  const db=mockDatabase(query=>query.table==='gym_settings'?success(null):standardResponse(query));
  const account=await loadAccount(user,db);
  assert.equal(account.gym,null);
  assert.equal(account.planningAvailable,true);
});

test('loadAccount loads an athlete account without coach or gym queries and restricts the athlete lookup to the user',async()=>{
  const athleteUser={id:'athlete-user'};
  const profile={id:athleteUser.id,full_name:'Martin',phone:null,is_admin:false,account_type:'athlete'};
  const athletes=[{id:'own-athlete',user_id:athleteUser.id,first_name:'Martin',last_name:''}];
  const db=mockDatabase(query=>{
    if(query.table==='profiles')return success(profile);
    if(query.table==='athletes')return success(athletes);
    if(query.table==='training_sessions')return success([]);
    throw new Error('Athletes must not load another account’s gym or private coach relation');
  });
  assert.deepEqual(await loadAccount(athleteUser,db),{profile,gym:null,coach:null,relations:[],athletes,planningAvailable:true});
  assert.deepEqual(db.calls.find(q=>q.table==='athletes').filters,[['user_id',athleteUser.id]]);
  assert.equal(db.calls.find(q=>q.table==='training_sessions').limit,1);
});

test('loadAccount detects missing planning tables for athlete accounts too',async()=>{
  const profile={...coachProfile,account_type:'athlete'};
  const db=mockDatabase(query=>{
    if(query.table==='profiles')return success(profile);
    if(query.table==='athletes')return success([{id:'own-athlete',user_id:user.id}]);
    if(query.table==='training_sessions')return failure('PGRST205','Missing training_sessions');
    throw new Error(`Unexpected ${query.table}`);
  });
  assert.deepEqual(await loadAccount(user,db),{profile,gym:null,coach:null,relations:[],athletes:[],planningAvailable:false});
});

test('an older planning schema without locks or completion is unavailable instead of exposing unsupported controls',async()=>{
  for(const column of ['is_locked','completed_at']) for(const error of [
    {code:'42703',message:`column training_sessions.${column} does not exist`},
    {code:'PGRST204',message:`Could not find the '${column}' column of 'training_sessions' in the schema cache`},
  ]) {
    const db=mockDatabase(query=>query.table==='profiles'?{data:coachProfile}:query.table==='gym_settings'?{data:gym}:query.table==='training_sessions'?{error}:{data:[]});
    const account=await loadAccount(user,db);
    assert.equal(account.planningAvailable,false);assert.deepEqual(account.gym,gym);
  }
});


test('library updates whitelist fields and match the owner, identity and loaded version',async()=>{
 const calls=[],payloads=[];const db={from(table){calls.push(['table',table]);const chain={update(p){payloads.push(p);return chain;},eq(k,v){calls.push([k,v]);return chain;},select(){return chain;},single(){return Promise.resolve({data:{id:'t1'},error:null});}};return chain;}};
 const original={id:'t1',coach_id:'owner',updated_at:'v1'};
 assert.deepEqual(await updateTemplate({title:'Titre',folder_id:'f1',coach_id:'attacker',id:'bad',updated_at:'bad',athlete_id:'bad'},original,db),{id:'t1'});
 assert.deepEqual(payloads,[{title:'Titre',folder_id:'f1'}]);assert.deepEqual(calls,[['table','session_templates'],['id','t1'],['coach_id','owner'],['updated_at','v1']]);
 await assert.rejects(()=>updateTemplate({}, {id:'t1'},db),/Rouvre/);
});

test('a concurrent library edit reports a recoverable conflict instead of inserting another workout',async()=>{
 const chain={update(){return this;},eq(){return this;},select(){return this;},single(){return Promise.resolve({data:null,error:{code:'PGRST116'}});}};
 await assert.rejects(()=>updateTemplate({title:'Draft'},{id:'t1',coach_id:'owner',updated_at:'v1'},{from:()=>chain}),/Ton texte est conservé/);
});

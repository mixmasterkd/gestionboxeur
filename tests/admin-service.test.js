import test from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { readFile } from 'node:fs/promises';

const raw=await readFile(new URL('../supabase/functions/admin-users/index.ts',import.meta.url),'utf8');
const source=nodeModule.stripTypeScriptTypes?.(raw.replace(/^import .*;$/m,''));
const adminId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',testId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function service({admin=true,validJwt=true,mapping=true,testAdmin=false,owner=adminId}={}){
  const calls=[];
  const testUser={id:testId,email:`athlete-test-${adminId}@gestionboxeur.test`,app_metadata:{test_admin_id:owner,is_test_athlete:true}};
  const database={auth:{async getUser(token){calls.push(['verify-jwt',token]);return {data:{user:validJwt?{id:adminId,user_metadata:{full_name:'Admin'}}:null},error:validJwt?null:{message:'invalid'}};},admin:{
    async getUserById(id){calls.push(['get-user',id]);return {data:{user:testUser},error:null};},
    async createUser(payload){
      calls.push(['create-user',payload]);
      // Match the Auth API limit so an invalid generated password cannot pass locally.
      if(new TextEncoder().encode(payload.password).length>72)return {data:{user:null},error:{message:'Password cannot be longer than 72 characters'}};
      return {data:{user:testUser},error:null};
    },
    async generateLink(payload){calls.push(['generate-link',payload]);return {data:{properties:{hashed_token:'single-use-token'}},error:null};},
    async deleteUser(id){calls.push(['delete-user',id]);return {error:null};},
  },async resetPasswordForEmail(email,options){calls.push(['reset-email',email,options]);return {error:null};}},
    from(table){let match;const query={select(){return query;},eq(field,value){match=value;return query;},single(){return query;},maybeSingle(){return query;},upsert(payload,options){calls.push(['upsert',table,payload,options]);return query;},then(resolve,reject){let data=null;if(table==='profiles')data=match===adminId?{is_admin:admin}:{is_admin:testAdmin,account_type:'athlete'};else if(table==='admin_test_accounts')data=mapping?{test_user_id:testId}:null;else if(table==='athletes')data={id:'athlete-row'};return Promise.resolve({data,error:null}).then(resolve,reject);}};return query;}};
  let handler;
  new Function('Deno','createClient',source)({serve(fn){handler=fn;},env:{get:name=>name==='APP_URL'?'https://example.test/team/':'configured-server-value'}},()=>database);
  const request=(body,token='real-jwt')=>handler(new Request('https://example.test/functions/v1/admin-users',{method:'POST',headers:token?{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  return {calls,request};
}
const options={skip:!source};
test('admin service verifies JWT and database admin flag before account operations',options,async()=>{
  for(const config of [{validJwt:false},{admin:false}]){
    const api=service(config);const response=await api.request({action:'athlete_test_session'});assert.ok([401,403].includes(response.status));assert.equal(api.calls.some(c=>c[0]==='generate-link'||c[0]==='create-user'),false);
  }
});
test('test session ignores caller targets and produces only dedicated athlete token',options,async()=>{
  const api=service();const response=await api.request({action:'athlete_test_session',user_id:'victim',email:'victim@example.test'});const body=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(body,{user_id:testId,token_hash:'single-use-token'});
  assert.deepEqual(api.calls.find(c=>c[0]==='generate-link')[1],{type:'magiclink',email:`athlete-test-${adminId}@gestionboxeur.test`});
  const relation=api.calls.find(c=>c[0]==='upsert'&&c[1]==='coach_athletes');assert.equal(relation[3].ignoreDuplicates,true,'repeat visits must retain permission/revocation experiments');
});
test('test provisioning is athlete-only and never returns its random password',options,async()=>{
  const api=service({mapping:false});const response=await api.request({action:'athlete_test_session'});const body=await response.json();
  assert.equal(response.status,200);const created=api.calls.find(c=>c[0]==='create-user')[1];assert.equal(created.user_metadata.account_type,'athlete');assert.equal(created.user_metadata.birth_date,'2000-01-01');assert.equal(created.app_metadata.test_admin_id,adminId);assert.equal(created.app_metadata.is_test_athlete,true);assert.ok(created.password.length>60);assert.ok(new TextEncoder().encode(created.password).length<=72);assert.equal(body.password,undefined);
});
test('wrong owner or admin-privileged account cannot serve as test athlete',options,async()=>{
  for(const config of [{owner:'another-admin'},{testAdmin:true}]){
    const api=service(config);const response=await api.request({action:'athlete_test_session'});assert.equal(response.status,403);assert.equal(api.calls.some(c=>c[0]==='generate-link'),false);
  }
});
test('member password reset uses server-resolved member email and canonical redirect only',options,async()=>{
  const api=service();const response=await api.request({action:'reset_password',user_id:testId,email:'attacker@example.test',redirect_to:'https://attacker.example/'});
  assert.equal(response.status,200);const reset=api.calls.find(c=>c[0]==='reset-email');assert.equal(reset[1],`athlete-test-${adminId}@gestionboxeur.test`);assert.equal(reset[2].redirectTo,'https://example.test/team/login.html?mode=recovery');
});

// Development-only transport. Uses the real migrations and RLS with fictional
// accounts, entirely on this machine. Never mounted by Vite build/preview.
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export const personas = [
  { id:'71000000-0000-4000-8000-000000000001', name:'Camille', email:'camille@local.test', role:'coach', label:'Camille · créateur' },
  { id:'71000000-0000-4000-8000-000000000002', name:'Alex', email:'alex@local.test', role:'athlete', label:'Alex · admin et membre' },
  { id:'71000000-0000-4000-8000-000000000003', name:'Sam', email:'sam@local.test', role:'athlete', label:'Sam · membre' },
  { id:'71000000-0000-4000-8000-000000000004', name:'Zoé', email:'zoe@local.test', role:'athlete', label:'Zoé · invitations' },
];
const identifier = value => {
  if (!/^[a-z_][a-z_0-9]*$/i.test(value)) throw new Error('Identifiant invalide.');
  return '"'+value+'"';
};
const bootstrap = `create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
grant usage on schema public,auth to anon,authenticated,service_role;
grant execute on function auth.uid(),auth.role() to anon,authenticated,service_role;
alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;
create table auth.local_migrations(name text primary key);`;
const embeds = {
  training_groups:{training_group_members:['group_id','id']},
  shared_training_sessions:{shared_session_groups:['session_id','id'],shared_session_athletes:['session_id','id']},
  shared_calendar_events:{shared_event_groups:['event_id','id'],shared_event_athletes:['event_id','id']},
  journal_updates:{journal_entries:['id','entry_id']},
};
function split(value) {
  const out=[];let start=0,depth=0;
  for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;if(value[i]===')')depth--;if(value[i]===','&&!depth){out.push(value.slice(start,i));start=i+1;}}
  out.push(value.slice(start));return out.filter(Boolean);
}

export async function openLocalDatabase({ directory=process.env.GBOXEUR_LOCAL_DATABASE || resolve('.local-preview/database') }={}) {
  await mkdir(directory,{recursive:true});
  const db=new PGlite(directory);
  if(!(await db.query("select 1 from pg_namespace where nspname='auth'")).rows.length)await db.exec(bootstrap);
  const applied=new Set((await db.query('select name from auth.local_migrations')).rows.map(row=>row.name));
  // Supabase assigned these publication timestamps; preserve already-applied local trials.
  const publishedNames={"20261008231021_open_community_groups.sql": "20261009053411_open_community_groups.sql", "20261009011343_personal_rosters_and_journal_deletion.sql": "20261009053420_personal_rosters_and_journal_deletion.sql", "20261009030740_group_batch_invitations_and_join_links.sql": "20261009053421_group_batch_invitations_and_join_links.sql"};
  for(const [oldName,newName] of Object.entries(publishedNames)) {
    if(!applied.has(oldName)||applied.has(newName))continue;
    await db.query('update auth.local_migrations set name=$1 where name=$2',[newName,oldName]);
    applied.delete(oldName);applied.add(newName);
  }
  for(const name of (await readdir(resolve('supabase/migrations'))).filter(name=>name.endsWith('.sql')).sort()) {
    if(applied.has(name))continue;
    await db.transaction(async tx=>{await tx.exec(await readFile(resolve('supabase/migrations',name),'utf8'));await tx.query('insert into auth.local_migrations values($1)',[name]);});
  }
  for(const p of personas)await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3) on conflict do nothing',[p.id,p.email,JSON.stringify({full_name:p.name,account_type:p.role,birth_date:'1996-05-12'})]);
  return db;
}

export async function localQuery(db,userId,request) {
  if(!personas.some(p=>p.id===userId))throw new Error('Choisis un compte d’essai.');
  return db.transaction(async tx=>{
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[userId]);
    await tx.exec('set local role authenticated');
    if(request.rpc){
      const entries=Object.entries(request.args||{}),args=entries.map(([,v])=>v&&typeof v==='object'&&!Array.isArray(v)?JSON.stringify(v):v);
      const sql=`select * from public.${identifier(request.rpc)}(${entries.map(([key],i)=>`${identifier(key)} => $${i+1}`).join(',')})`;
      const rows=(await tx.query(sql,args)).rows;
      const definition=(await tx.query("select p.proretset from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",[request.rpc])).rows[0];
      return definition?.proretset?rows:rows[0]?.[request.rpc]??null;
    }
    const table=identifier(request.table), args=[];
    const param=value=>{args.push(value);return '$'+args.length;};
    const nested=[];
    const selections=split(request.columns||'*').map(part=>{
      const match=part.match(/^(?:(\w+):)?(\w+)(!inner)?\((.*)\)$/);
      if(!match)return part==='*'?'t.*':`t.${identifier(part)}`;
      const [,alias,child,inner,cols]=match,relation=embeds[request.table]?.[child];
      if(!relation)throw new Error('Relation non prise en charge dans cet aperçu.');
      const name=alias||child;
      nested.push({name,child,relation,inner,cols});
      return `(select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from public.${identifier(child)} c where c.${identifier(relation[0])}=t.${identifier(relation[1])}) as ${identifier(name)}`;
    });
    const predicate=(column,op,value)=>{
      const comparator={eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<=',ilike:'ilike',like:'like'}[op];
      if(column.includes('.')){
        const [alias,field]=column.split('.'),child=nested.find(item=>item.name===alias);
        if(!child||!comparator)throw new Error('Filtre invalide.');
        return `exists(select 1 from public.${identifier(child.child)} c where c.${identifier(child.relation[0])}=t.${identifier(child.relation[1])} and c.${identifier(field)} ${comparator} ${param(value)})`;
      }
      const col='t.'+identifier(column);
      if(op==='is'&&value===null)return col+' is null';
      if(op==='in')return value.length?`${col} in (${value.map(param).join(',')})`:'false';
      if(!comparator)throw new Error('Filtre invalide.');
      return `${col} ${comparator} ${param(value)}`;
    };
    const logic=text=>split(text).map(part=>{
      const match=part.match(/^(and|or)\((.*)\)$/);
      if(match)return '('+logic(match[2]).join(match[1]==='and'?' and ':' or ')+')';
      const [column,op,...rest]=part.split('.');return predicate(column,op,rest.join('.')==='null'?null:rest.join('.'));
    });
    const where=(request.filters||[]).map(f=>predicate(f.column,f.op,f.value));
    for(const text of request.or||[])where.push('('+logic(text).join(' or ')+')');
    const conditions=where.length?' where '+where.join(' and '):'';
    let sql;
    if(request.method==='insert'){
      const values=Array.isArray(request.values)?request.values:[request.values];
      const columns=Object.keys(values[0]);
      sql=`insert into public.${table} as t (${columns.map(identifier).join(',')}) values ${values.map(v=>'('+columns.map(c=>param(v[c]&&typeof v[c]==='object'?JSON.stringify(v[c]):v[c])).join(',')+')').join(',')} returning ${selections.join(',')}`;
    }else if(request.method==='update'){
      const changes=Object.entries(request.values).map(([key,value])=>identifier(key)+'='+param(value&&typeof value==='object'?JSON.stringify(value):value));
      sql=`update public.${table} as t set ${changes.join(',')}${conditions} returning ${selections.join(',')}`;
    }else if(request.method==='delete')sql=`delete from public.${table} as t${conditions} returning ${selections.join(',')}`;
    else{
      sql=`select ${selections.join(',')} from public.${table} t${conditions}`;
      if(request.order?.length)sql+=' order by '+request.order.map(item=>'t.'+identifier(item.column)+(item.ascending===false?' desc':' asc')).join(',');
      const start=Math.max(0,Number(request.start)||0),limit=Math.min(5000,Math.max(0,Number(request.limit)||5000));
      sql+=` limit ${param(limit)} offset ${param(start)}`;
    }
    // PostgREST returns SQL DATE as YYYY-MM-DD; do not turn it into a JS
    // timestamp, which would move/omit calendar tiles in client date matching.
    const rows=(await tx.query(sql,args,{parsers:{1082:value=>value,1114:value=>value,1184:value=>value}})).rows;
    if(request.single){
      if(rows.length===1)return rows[0];
      if(!rows.length&&request.single==='maybe')return null;
      throw Object.assign(new Error('Cet élément n’est plus accessible.'),{code:'PGRST116'});
    }
    return rows;
  });
}

export function localPreviewPlugin() {
  let db;
  return {name:'local-preview-database',apply:'serve',async configureServer(server){
    db=await openLocalDatabase();
    const {seedLocalPreview}=await import('./local-preview-seed.mjs');
    await seedLocalPreview(db);
    server.httpServer?.once('close',()=>void db.close());
    // Serialize requests: RLS identity and transaction state cannot overlap.
    let queue=Promise.resolve();
    server.middlewares.use('/__local',async(req,res,next)=>{
      if(!req.url?.startsWith('/api'))return next();
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      if(req.method!=='POST'){res.statusCode=405;res.end('{}');return;}
      if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){res.statusCode=403;res.end('{}');return;}
      try{
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1_000_000)throw new Error('Requête trop longue.');}
        const body=JSON.parse(raw),user=personas.find(p=>p.id===body.userId);
        if(body.action==='personas'){res.end(JSON.stringify({data:personas,error:null}));return;}
        if(!user)throw new Error('Compte d’essai inconnu.');
        const task=queue.then(()=>localQuery(db,user.id,body.query));queue=task.catch(()=>{});
        res.end(JSON.stringify({data:await task,error:null}));
      }catch(error){res.end(JSON.stringify({data:null,error:{message:error.message,code:error.code||'LOCAL_ERROR'}}));}
    });
  }};
}

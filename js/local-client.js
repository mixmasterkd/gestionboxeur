// Imported only by the explicitly enabled Vite development sandbox.
const storageKey='gboxeur:local-persona';
let users=[],current=null;
const listeners=new Set();
async function request(query,action){
  try{
    const response=await fetch('/__local/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:current?.id,query,action})});
    if(!response.ok)throw new Error('L’espace local est indisponible.');
    return await response.json();
  }catch(error){return {data:null,error:{message:error.message}};}
}
const loaded=await request(null,'personas');
if(loaded.error)throw new Error(loaded.error.message);
users=loaded.data;
let saved;try{saved=localStorage.getItem(storageKey);}catch{/* Optional preference. */}
current=users.find(user=>user.id===saved)||users[0];
class Query {
  constructor(table){this.query={table,method:'select',filters:[],order:[],or:[]};}
  select(columns='*'){this.query.columns=columns;return this;}
  insert(values){this.query.method='insert';this.query.values=values;return this;}
  update(values){this.query.method='update';this.query.values=values;return this;}
  delete(){this.query.method='delete';return this;}
  filter(column,op,value){this.query.filters.push({column,op,value});return this;}
  eq(column,value){return this.filter(column,'eq',value);}
  neq(column,value){return this.filter(column,'neq',value);}
  gte(column,value){return this.filter(column,'gte',value);}
  lte(column,value){return this.filter(column,'lte',value);}
  gt(column,value){return this.filter(column,'gt',value);}
  lt(column,value){return this.filter(column,'lt',value);}
  in(column,value){return this.filter(column,'in',value);}
  is(column,value){return this.filter(column,'is',value);}
  ilike(column,value){return this.filter(column,'ilike',value);}
  or(value){this.query.or.push(value);return this;}
  order(column,{ascending=true}={}){this.query.order.push({column,ascending});return this;}
  limit(value){this.query.limit=value;return this;}
  range(start,end){this.query.start=start;this.query.limit=end-start+1;return this;}
  single(){this.query.single='one';return this;}
  maybeSingle(){this.query.single='maybe';return this;}
  then(resolve,reject){return request(this.query).then(resolve,reject);}
}
const session=()=>current?{user:{id:current.id,email:current.email,user_metadata:{full_name:current.name}},access_token:'local-preview'}:null;
export const client={
  from:table=>new Query(table),rpc:(rpc,args)=>request({rpc,args}),
  auth:{getSession:async()=>({data:{session:session()},error:null}),getUser:async()=>({data:{user:session()?.user??null},error:null}),
    resetPasswordForEmail:async()=>({error:{message:'Ces comptes d’essai sont fictifs et n’ont pas de mot de passe. Choisis un compte dans le bandeau Essai local.'}}),
    onAuthStateChange(callback){listeners.add(callback);return {data:{subscription:{unsubscribe(){listeners.delete(callback);}}}};},
    async signOut(){current=null;for(const callback of listeners)callback('SIGNED_OUT',null);return {error:null};},
  },
};
function mount(){
  if(document.getElementById('localPreviewBanner'))return;
  const banner=document.createElement('aside');banner.id='localPreviewBanner';banner.className='local-preview-banner';
  const text=document.createElement('span');text.textContent='Essai local · données fictives';
  const label=document.createElement('label');label.textContent='Compte ';
  const select=document.createElement('select');select.setAttribute('aria-label','Compte d’essai');
  for(const user of users){const option=document.createElement('option');option.value=user.id;option.textContent=user.label;option.selected=user.id===current?.id;select.append(option);}
  select.addEventListener('change',()=>{try{localStorage.setItem(storageKey,select.value);}catch{/* use URL on next iteration if necessary */}location.href='groups.html';});
  label.append(select);banner.append(text,label);document.body.prepend(banner);
  const style=document.createElement('style');style.textContent='.local-preview-banner{position:relative;z-index:20;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px 20px;padding:8px 12px;background:#203831;color:#f1fff6;font:13px system-ui}.local-preview-banner select{min-height:36px;max-width:100%;background:#18302a;color:#fff;border:1px solid #679c82;border-radius:8px;padding:4px 8px}@media(max-width:800px){.has-navigation .local-preview-banner{margin-left:0}}';document.head.append(style);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();

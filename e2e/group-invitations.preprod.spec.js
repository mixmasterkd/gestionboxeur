import {test,expect} from '@playwright/test';
const ORIGIN='http://127.0.0.1:4174';
const OWNER='71000000-0000-4000-8000-000000000001',ALEX='71000000-0000-4000-8000-000000000002',SAM='71000000-0000-4000-8000-000000000003',ZOE='71000000-0000-4000-8000-000000000004';
async function rpc(request,userId,name,args={}){
 const response=await request.post(`${ORIGIN}/__local/api`,{data:{userId,query:{rpc:name,args}}});
 const body=await response.json();expect(body.error).toBeNull();return body.data;
}
const command=(request,user,action,data={})=>rpc(request,user,'community_command',{p_action:action,p_data:data});
async function configure(page,user){
 await page.context().route('**/*',route=>new URL(route.request().url()).origin===ORIGIN?route.continue():route.abort());
 await page.addInitScript(id=>localStorage.setItem('gboxeur:local-persona',id),user);
}
async function linked(request,user,email){
 const rows=await rpc(request,OWNER,'find_athlete_by_email',{p_email:email});
 if(rows[0]?.connection_status==='accepted')return;
 const id=await rpc(request,OWNER,'invite_existing_athlete',{p_email:email});
 await rpc(request,user,'respond_coaching_invitation',{p_invitation_id:id,p_accept:true});
}
async function memberPicker(page,group){
 await page.goto(`/groups.html?group=${group.id}`);
 await expect(page.locator('#communityGroupTitle')).toHaveText(group.name);
 await page.getByRole('tab',{name:'Membres',exact:true}).click();
 await page.getByRole('button',{name:'Ajouter des membres',exact:true}).click();
 return page.locator('#communityDialog');
}
test.beforeEach(async({baseURL,page})=>{
 expect(new URL(baseURL).origin).toBe(ORIGIN);await configure(page,OWNER);
 page.__errors=[];page.on('pageerror',error=>page.__errors.push(error.message));
});
test.afterEach(async({page})=>{expect(page.__errors).toEqual([]);});

test('coach invites several athletes by name and pending members retain consent and role boundaries',async({page,request,browser},info)=>{
 await linked(request,ALEX,'alex@local.test');await linked(request,SAM,'sam@local.test');
 const suffix=`${info.project.name}-${Date.now()}`;
 const group=await command(request,OWNER,'save_group',{name:`Équipe QA ${suffix}`,description:'Description conservée mais absente de l’en-tête.'});
 const sheet=await rpc(request,OWNER,'create_roster_athlete',{p_data:{first_name:'Émile',last_name:`Chêne ${suffix}`,email:'nom-bizarre@example.test'}});
 let memberContext;
 try{
  const dialog=await memberPicker(page,group);
  await expect(page.locator('.community-group-calendar,.community-description')).toHaveCount(0);
  const search=dialog.getByRole('searchbox',{name:'Rechercher un athlète'});
  await search.fill('sam');const sam=dialog.locator('.community-candidate').filter({hasText:'Sam'});await expect(sam).toBeVisible();await sam.getByRole('checkbox').check();
  await search.fill('alex');const alex=dialog.locator('.community-candidate').filter({hasText:'Alex'});await expect(alex).toBeVisible();await alex.getByRole('checkbox').check();
  await search.fill(`emile chene ${suffix}`);
  await expect(dialog.locator('.community-candidate').filter({hasText:suffix})).toContainText('Compte non lié');
  await expect(dialog.locator('.community-candidate').filter({hasText:suffix}).getByRole('checkbox')).toBeDisabled();
  await expect(dialog.locator('.community-picker-selection')).toContainText('2 personnes sélectionnées');
  await dialog.getByRole('button',{name:'Envoyer 2 invitations',exact:true}).click();
  await expect(dialog.locator('.community-picker-outcome')).toContainText(/2/);
  await search.fill('');await expect(dialog.locator('.community-candidate[data-status=pending]')).toHaveCount(2);
  await page.screenshot({path:info.outputPath('member-picker.png')});
  await dialog.getByRole('button',{name:'Terminé',exact:true}).click();
  let detail=await command(request,OWNER,'group_detail',{group_id:group.id});
  expect(detail.group.description).toBe('Description conservée mais absente de l’en-tête.');expect(detail.members).toHaveLength(1);expect(detail.invitations).toHaveLength(2);
  const notification=(await command(request,SAM,'notifications')).items.find(item=>item.group_id===group.id);
  await command(request,SAM,'respond_invitation',{id:notification.id,accept:true});
  memberContext=await browser.newContext({...info.project.use});const member=await memberContext.newPage();await configure(member,SAM);
  await member.goto(`${ORIGIN}/groups.html?group=${group.id}`);await expect(member.locator('#communityGroupTitle')).toHaveText(group.name);
  await expect(member.getByRole('button',{name:'Faire une suggestion',exact:true})).toBeVisible();
  await member.getByRole('tab',{name:'Sondages',exact:true}).click();await expect(member.getByRole('button',{name:'Créer un sondage',exact:true})).toHaveCount(0);
  await member.getByRole('tab',{name:'Membres',exact:true}).click();await expect(member.getByRole('button',{name:'Ajouter des membres',exact:true})).toHaveCount(0);await expect(member.getByRole('button',{name:'Quitter le groupe',exact:true})).toBeVisible();
  await page.reload();const reopened=await memberPicker(page,group);await expect(reopened.locator('.community-candidate[data-status=member]').filter({hasText:'Sam'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{
  await memberContext?.close();await command(request,OWNER,'delete_group',{group_id:group.id});await rpc(request,OWNER,'archive_roster_athlete',{p_athlete_id:sheet});
 }
});

test('share link joins only after acceptance and renewing or revoking makes the old link unusable',async({page,request,browser},info)=>{
 const group=await command(request,OWNER,'save_group',{name:`Lien QA ${info.project.name}-${Date.now()}`});
 let guestContext;
 try{
  const dialog=await memberPicker(page,group);
  await dialog.getByText('Partager un lien d’invitation',{exact:true}).click();
  await dialog.getByRole('button',{name:'Créer un lien',exact:true}).click();
  const field=dialog.getByRole('textbox',{name:'Lien d’invitation du groupe'});await expect(field).toHaveValue(/groups\.html\?join=[0-9a-f]{64}$/);
  const oldLink=await field.inputValue();
  guestContext=await browser.newContext({...info.project.use});const guest=await guestContext.newPage();await configure(guest,ZOE);
  await guest.goto(oldLink);await expect(guest.getByRole('heading',{name:group.name,exact:true})).toBeVisible();
  expect((await command(request,OWNER,'group_detail',{group_id:group.id})).members).toHaveLength(1);
  await guest.getByRole('button',{name:'Accepter et rejoindre',exact:true}).click();await expect(guest.locator('#communityGroupTitle')).toHaveText(group.name);
  expect(new URL(guest.url()).searchParams.has('join')).toBe(false);
  const detail=await command(request,OWNER,'group_detail',{group_id:group.id});expect(detail.members).toHaveLength(2);expect(detail.members.find(member=>member.user_id===ZOE).role).toBe('member');
  await dialog.getByRole('button',{name:'Renouveler le lien',exact:true}).click();await expect(field).not.toHaveValue(oldLink);const newLink=await field.inputValue();
  await guest.goto(oldLink);await expect(guest.getByRole('alert')).toContainText(/invalide ou expiré/);await expect(guest.getByRole('button',{name:'Accepter et rejoindre',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Révoquer le lien',exact:true}).click();await expect(field).toBeHidden();
  await guest.goto(newLink);await expect(guest.getByRole('alert')).toContainText(/invalide ou expiré/);
  expect((await command(request,OWNER,'group_detail',{group_id:group.id})).members).toHaveLength(2);
 }finally{await guestContext?.close();await command(request,OWNER,'delete_group',{group_id:group.id});}
});

test('a long athlete list scrolls inside a bounded picker across screen sizes and themes',async({page,request},info)=>{
 const group=await command(request,OWNER,'save_group',{name:`Disposition QA ${info.project.name}-${Date.now()}`});
 // Read-only response fixture exercises long names and pagination without adding accounts.
 const candidates=Array.from({length:65},(_,index)=>({athlete_id:`athlete-${index}`,user_id:`user-${index}`,name:`Prénom composé ${index} Nom de famille très long`,email:`courriel-tres-long-${index}@exemple.test`,status:'available'}));
 await page.route('**/__local/api',async route=>{
  const body=route.request().postDataJSON();
  if(body?.query?.rpc!=='community_command'||body.query.args.p_action!=='invite_candidates')return route.fallback();
  const offset=body.query.args.p_data.offset||0;
  return route.fulfill({json:{data:{items:candidates.slice(offset,offset+30),offset,next_offset:offset+30<candidates.length?offset+30:null,total:candidates.length},error:null}});
 });
 try{
  const sizes=info.project.name==='phone'?[[320,568],[390,844],[844,390]]:[[1440,900]];
  for(const [width,height] of sizes)for(const theme of ['light','dark']){
   await page.setViewportSize({width,height});
   const dialog=await memberPicker(page,group);
   await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
   await expect(dialog.locator('.community-candidate')).toHaveCount(30);
   const list=dialog.locator('.community-candidate-list');
   const scroll=await list.evaluate(element=>{element.scrollTop=200;return {top:element.scrollTop,height:element.clientHeight,full:element.scrollHeight};});
   expect(scroll.top).toBeGreaterThan(0);expect(scroll.full).toBeGreaterThan(scroll.height);
   await dialog.getByRole('button',{name:'Voir plus d’athlètes',exact:true}).click();
   await expect(dialog.locator('.community-candidate')).toHaveCount(60);
   await dialog.getByText('Inviter par courriel',{exact:true}).click();
   await dialog.getByText('Partager un lien d’invitation',{exact:true}).click();
   await expect(dialog.getByRole('button',{name:'Créer un lien',exact:true})).toBeVisible();
   const bounds=await dialog.boundingBox();
   expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);
   expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);expect(bounds.y+bounds.height).toBeLessThanOrEqual(height+1);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
   await page.screenshot({path:info.outputPath(`picker-${width}-${theme}.png`)});
   await dialog.getByRole('button',{name:'Terminé',exact:true}).click();
  }
 }finally{await command(request,OWNER,'delete_group',{group_id:group.id});}
});

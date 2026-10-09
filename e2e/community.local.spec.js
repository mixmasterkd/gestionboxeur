import {test,expect} from '@playwright/test';

const ids=['71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003'];
async function api(request,user,action,data={}){
 const response=await request.post('/__local/api',{data:{userId:user,query:{rpc:'community_command',args:{p_action:action,p_data:data}}}});
 const body=await response.json();if(body.error)throw new Error(body.error.message);return body.data;
}
async function persona(page,id){
 await page.addInitScript(id=>localStorage.setItem('gboxeur:local-persona',id),id);
}
async function invited(request,group,user,email,role){
 await api(request,ids[0],'invite_member',{group_id:group.id,email,role});
 const notification=(await api(request,user,'notifications')).items.find(item=>item.group_id===group.id);
 await api(request,user,'respond_invitation',{id:notification.id,accept:true});
}
test('menu navigation is direct, returns to its root and installs from the menu (read only)',async({page})=>{
 const errors=[],blocked=[];
 page.on('pageerror',error=>errors.push(error.message));
 // This QA path must preserve every existing local test record.
 await page.route('**/__local/api',async route=>{
  const body=route.request().postDataJSON(),query=body.query;
  const safe=body.action==='personas'||query&&(!query.rpc&&query.method==='select'||query.rpc==='community_command'&&['list_groups','group_detail','notifications','group_calendar'].includes(query.args?.p_action));
  if(safe)return route.continue();
  blocked.push(body);return route.abort();
 });
 await persona(page,ids[0]);await page.goto('/groups.html');
 await expect(page.locator('.community-group-card').first()).toBeVisible();
 const trigger=page.locator('[data-primary-menu]'),menu=page.locator('#profileMenuDialog');
 await trigger.click();await expect(menu).toBeVisible();
 await expect(trigger).toHaveAttribute('aria-expanded','true');
 await expect(menu.locator('[data-menu-group]').first()).toBeVisible();
 expect(await menu.locator('[data-menu-action]').evaluateAll(nodes=>nodes.map(node=>node.dataset.menuAction))).toEqual(['notifications','connections','groups','profile','install']);
 const group=menu.locator('[data-menu-group]').first(),groupId=await group.getAttribute('data-menu-group'),name=await group.locator('.profile-group-name').textContent();
 const documentId=await page.evaluate(()=>window.__qaDocument=`${performance.timeOrigin}-${Math.random()}`);
 await group.click();await expect(menu).toBeHidden();
 await expect(page.locator('#communityGroupTitle')).toHaveText(name);await expect(page.getByRole('tab',{name:'Suggestions',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Écrire un message',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.__qaDocument)).toBe(documentId);
 await trigger.click();await expect(menu.locator(`[data-menu-group="${groupId}"]`)).toHaveAttribute('aria-current','page');
 await menu.locator('[data-menu-action=notifications]').click();await expect(menu.locator('h2')).toHaveText('Notifications');
 await page.keyboard.press('Escape');await expect(menu.locator('h2')).toHaveText('Menu');
 await menu.locator('[data-menu-action=install]').click();
 const install=page.locator('#appInstallDialog');await expect(install).toBeVisible();await expect(menu).toBeHidden();
 await install.getByRole('button',{name:'← Menu',exact:true}).click();
 await expect(install).toBeHidden();await expect(menu).toBeVisible();
 await expect(menu.locator('[data-menu-action=install]')).toBeFocused();
 await menu.locator('[data-menu-action=install]').click();await page.keyboard.press('Escape');
 await expect(menu).toBeVisible();await expect(install).toBeHidden();
 if(page.viewportSize().width<=800)await page.locator('.menu-drawer-dismiss').click();else await trigger.click();
 await expect(menu).toBeHidden();
 await trigger.click();await expect(menu.locator('h2')).toHaveText('Menu');
 await menu.locator('[data-menu-action=groups]').click();await expect(page.locator('#communityListTitle')).toBeVisible();
 await page.goBack();await expect(page.locator('#communityGroupTitle')).toHaveText(name);
 await page.getByRole('button',{name:'← Mes groupes',exact:true}).click();await expect(page.locator('#communityListTitle')).toBeVisible();
 await trigger.click();
 if(page.viewportSize().width<=800)await page.locator('.menu-drawer-dismiss').click();else await page.locator('#communityListTitle').click();
 await expect(menu).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(blocked).toEqual([]);expect(errors).toEqual([]);
});

test('group workout is editable by its admin, received once and completed only by its member',async({page,request,browser},testInfo)=>{
 const group=await api(request,ids[0],'save_group',{name:`QA calendrier ${testInfo.project.name} ${Date.now()}`});
 const contexts=[],title=`Entraînement QA ${group.id.slice(0,8)}`,editedTitle=`Séance ajustée ${group.id.slice(0,8)}`;
 try{
  await invited(request,group,ids[1],'alex@local.test','admin');await invited(request,group,ids[2],'sam@local.test','member');
  await persona(page,ids[0]);await page.goto(`/planning.html?group=${group.id}`);
  await expect(page.locator('#athleteTitle')).toHaveText(group.name);
  await page.locator('.add-day').first().click();await page.locator('#dayAddDialog').getByRole('button',{name:'Planifier une séance',exact:true}).click();const form=page.locator('#sessionDialog');
  await form.getByLabel('Titre de la séance').fill(title);
  await form.getByRole('textbox',{name:'Texte de l’entraînement'}).fill('3 rounds\n- Shadow 45s\n- Repos 15s');
  await form.getByRole('button',{name:'Planifier la séance',exact:true}).click();await expect(form).toBeHidden();
  await expect(page.getByRole('button',{name:title,exact:true})).toBeVisible();
  const adminContext=await browser.newContext({...testInfo.project.use,timezoneId:'America/Toronto'});contexts.push(adminContext);
  const admin=await adminContext.newPage();await persona(admin,ids[1]);await admin.goto(`http://192.168.50.123:4173/planning.html?group=${group.id}`);
  await admin.getByRole('button',{name:title,exact:true}).click();
  await admin.locator('#detailDialog').getByRole('button',{name:'Modifier la séance commune',exact:true}).click();
  await admin.locator('#sessionDialog').getByLabel('Titre de la séance').fill(editedTitle);
  await admin.locator('#sessionDialog').getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();await expect(admin.locator('#sessionDialog')).toBeHidden();
  const memberContext=await browser.newContext({...testInfo.project.use,timezoneId:'America/Toronto'});contexts.push(memberContext);
  const member=await memberContext.newPage();await persona(member,ids[2]);await member.goto('http://192.168.50.123:4173/planning.html');
  await expect(member.locator('#athletePickerButton')).toBeVisible();
  const received=member.getByRole('button',{name:editedTitle,exact:true});await expect(received).toHaveCount(1);await received.click();
  const detail=member.locator('#detailDialog');await expect(detail.getByRole('button',{name:'Modifier la séance commune',exact:true})).toHaveCount(0);
  await detail.getByRole('button',{name:'✓ Marquer comme faite',exact:true}).click();await expect(detail).toContainText('Séance faite');
  await detail.locator('[name="rpe"]').selectOption('7');await detail.locator('[name="feeling"][value="4"]').check();await detail.locator('[name="comment"]').fill('Mon bilan privé QA');await detail.locator('[name="comment"]').blur();
  await expect(detail.locator('.feedback-save-status')).toContainText('enregistré');
  await api(request,ids[0],'remove_member',{group_id:group.id,user_id:ids[2]});await member.reload();await expect(received).toBeVisible();
  await expect(member.locator('#calendar')).toContainText('Fait');
  await admin.reload();await admin.getByRole('button',{name:editedTitle,exact:true}).click();await expect(admin.locator('#detailDialog')).not.toContainText('Mon bilan privé QA');
  expect(await member.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await Promise.all(contexts.map(context=>context.close()));await api(request,ids[0],'delete_group',{group_id:group.id});}
});

test('profile badge stays until response and group suggestions/polls stay in their group',async({page,request},testInfo)=>{
 const group=await api(request,ids[0],'save_group',{name:`QA échanges ${testInfo.project.name} ${Date.now()}`});
 try{
  await api(request,ids[0],'invite_member',{group_id:group.id,email:'sam@local.test',role:'member'});
  await persona(page,ids[2]);await page.goto('/groups.html');
  const profile=page.locator('[data-primary-menu]');
  await expect(profile.locator('.profile-notification-badge')).toBeVisible();await profile.click();
  await page.locator('#profileMenuDialog').getByRole('button',{name:/Notifications/}).click();
  await expect(profile.locator('.profile-notification-badge')).toBeVisible();
  const invitation=page.locator('.profile-notification-card').filter({hasText:group.name});
  await invitation.locator('[data-notification-action=accept]').click();await expect(invitation).toHaveCount(0);
  await page.keyboard.press('Escape');await page.goto(`/groups.html?group=${group.id}`);
  await page.getByRole('button',{name:'Faire une suggestion',exact:true}).click();await page.locator('#communityDialog textarea').fill('Ajouter de la mobilité <script>reste du texte</script>');
  await page.getByRole('button',{name:'Publier dans le groupe',exact:true}).click();await expect(page.locator('.community-post')).toContainText('<script>reste du texte</script>');await expect(page.locator('.community-post script')).toHaveCount(0);
  const poll=await api(request,ids[0],'create_poll',{group_id:group.id,question:'Quel jour?',options:['Mardi','Jeudi']});
  await page.reload();await page.getByRole('tab',{name:'Sondages'}).click();await page.getByRole('button',{name:/Mardi/}).click();await expect(page.getByRole('button',{name:/Mardi/})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:/Jeudi/}).click();await expect(page.locator('.community-poll')).toContainText('1 vote');
  await api(request,ids[0],'close_poll',{id:poll.id});await page.reload();await page.getByRole('tab',{name:'Sondages'}).click();await expect(page.getByRole('button',{name:/Jeudi/})).toBeDisabled();
 }finally{await api(request,ids[0],'delete_group',{group_id:group.id});}
});

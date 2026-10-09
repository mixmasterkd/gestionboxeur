import {test,expect} from '@playwright/test';

const SAM='71000000-0000-4000-8000-000000000003';
const ALEX='71000000-0000-4000-8000-000000000002';
const QA_ORIGIN='http://127.0.0.1:4174';

// This suite writes only to the separate fictional QA database. A mistakenly
// selected LAN/production configuration fails before visiting or changing data.
test.beforeEach(async({baseURL,page})=>{
 expect(new URL(baseURL).origin).toBe(QA_ORIGIN);
 await page.context().route('**/*',route=>new URL(route.request().url()).origin===QA_ORIGIN?route.continue():route.abort());
 await page.addInitScript(id=>localStorage.setItem('gboxeur:local-persona',id),SAM);
});
async function read(request,userId,table,columns,filters=[]){
 const response=await request.post(`${QA_ORIGIN}/__local/api`,{data:{userId,query:{table,method:'select',columns,filters}}});
 const body=await response.json();expect(body.error).toBeNull();return body.data;
}
const filter=(column,value)=>({column,op:'eq',value});

test('an athlete account manages its own list and manual contacts without activating coaching',async({page,request,browser},testInfo)=>{
 const suffix=`${testInfo.project.name}-${Date.now()}`;
 const athleteName=`Liste QA ${suffix}`,contactName=`Contact QA ${suffix}`,privateNote=`Note privée ${suffix}`;
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/roster.html');
 await expect(page.getByRole('heading',{name:'Liste d’athlètes',exact:true})).toBeVisible();
 await expect(page.locator('#addAthleteButton')).toBeEnabled();
 await expect(page.locator('#groupDirectory,.directory-tabs')).toHaveCount(0);
 const before=await read(request,SAM,'profiles','account_type',[filter('id',SAM)]);
 expect(before[0].account_type).toBe('athlete');
 expect(await read(request,SAM,'coach_profiles','user_id',[filter('user_id',SAM)])).toEqual([]);

 await page.locator('#addAthleteButton').click();
 await expect(page.locator('#athleteDialog')).toBeVisible();
 await page.locator('#firstName').fill(athleteName);
 await page.locator('#athleteNote').fill(privateNote);
 await page.locator('#athleteForm').getByRole('button',{name:'Enregistrer',exact:true}).click();
 await expect(page.locator('#athleteDialog')).toBeHidden();
 const row=page.locator('#athleteRows tr').filter({hasText:athleteName});
 await expect(row).toHaveCount(1);
 await expect(row).toContainText(privateNote);
 await row.locator('.athlete-edit').click();
 await expect(page.locator('#attachAthleteButton')).toBeHidden();
 await page.locator('#weight').fill('68');await page.locator('#fights').fill('5');
 await page.locator('#wins').fill('3');await page.locator('#losses').fill('1');
 await page.locator('#athleteForm').getByRole('button',{name:'Enregistrer',exact:true}).click();
 await expect(page.locator('#athleteDialog')).toBeHidden();await expect(row).toContainText('68 kg');
 await row.getByRole('checkbox').check();await expect(row.getByRole('checkbox')).toBeEnabled();await expect(row.getByRole('checkbox')).toBeChecked();

 await page.locator('#addCoachButton').click();
 await page.locator('#coachFirstName').fill(contactName);await page.locator('#coachPhone').fill('514 555 0142');
 await page.locator('#coachEmail').fill('contact-qa@example.test');
 await page.locator('#coachForm').getByRole('button',{name:'Enregistrer',exact:true}).click();
 await expect(page.locator('#coachDialog')).toBeHidden();
 const contact=page.locator('#coachGrid .coach-card').filter({hasText:contactName});
 await expect(contact).toHaveCount(1);
 await page.locator('#shareButton').click();
 await expect(page.locator('#sharePreview')).toContainText(athleteName);
 await expect(page.locator('#sharePreview')).toContainText('68 kg');
 await expect(page.locator('#sharePreview')).toContainText('5 combats (3-1)');
 await expect(page.locator('#sharePreview')).not.toContainText(privateNote);
 const contactChoice=page.locator('#coachChoices .coach-choice').filter({hasText:contactName});
 await expect(contactChoice).toHaveCount(1);
 await expect(page.locator('#sharePreview')).toContainText(`${contactName} — 514 555 0142`);
 await contactChoice.locator('.include-email').check();await expect(page.locator('#sharePreview')).toContainText('contact-qa@example.test');
 await contactChoice.locator('.include-coach').uncheck();await expect(page.locator('#sharePreview')).not.toContainText(contactName);
 await contactChoice.locator('.include-coach').check();
 await expect(page.locator('#coachChoices strong').filter({hasText:/^Sam$/})).toHaveCount(0);
 await page.locator('#shareDialog [data-close]').click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);

 const other=await browser.newContext({...testInfo.project.use,baseURL:QA_ORIGIN});
 try{
  await other.route('**/*',route=>new URL(route.request().url()).origin===QA_ORIGIN?route.continue():route.abort());
  await other.addInitScript(id=>localStorage.setItem('gboxeur:local-persona',id),ALEX);
  const otherPage=await other.newPage();await otherPage.goto('/roster.html');
  await expect(otherPage.locator('#addAthleteButton')).toBeEnabled();
  await expect(otherPage.locator('#athleteRows')).not.toContainText(athleteName);
  await expect(otherPage.locator('#coachGrid')).not.toContainText(contactName);
  expect(await read(request,ALEX,'coach_contacts','id',[filter('first_name',contactName)])).toEqual([]);
  expect(await read(request,ALEX,'athletes','id',[filter('first_name',athleteName)])).toEqual([]);
 }finally{await other.close();}

 await page.reload();await expect(row).toHaveCount(1);await expect(row.getByRole('checkbox')).toBeChecked();
 await expect(contact).toHaveCount(1);
 expect((await read(request,SAM,'profiles','account_type',[filter('id',SAM)]))[0].account_type).toBe('athlete');
 expect(await read(request,SAM,'coach_profiles','user_id',[filter('user_id',SAM)])).toEqual([]);

 // Finish CRUD through the UI; only this run's records are removed from QA.
 await contact.getByRole('button',{name:'Modifier',exact:true}).click();
 await page.locator('#coachPhone').fill('514 555 0188');
 await page.locator('#coachForm').getByRole('button',{name:'Enregistrer',exact:true}).click();
 await expect(page.locator('#coachDialog')).toBeHidden();await expect(contact).toContainText('514 555 0188');
 await contact.getByRole('button',{name:'Modifier',exact:true}).click();
 page.once('dialog',dialog=>dialog.accept());await page.locator('#deleteCoachButton').click();
 await expect(contact).toHaveCount(0);
 await row.locator('.athlete-edit').click();page.once('dialog',dialog=>dialog.accept());await page.locator('#deleteAthleteButton').click();
 await expect(row).toHaveCount(0);await expect(page.locator('#pageError')).toBeHidden();
 expect(errors).toEqual([]);
});

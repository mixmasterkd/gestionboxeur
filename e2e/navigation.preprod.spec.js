import { test,expect } from '@playwright/test';

for(const [name,id] of [['coach','71000000-0000-4000-8000-000000000001'],['athlete','71000000-0000-4000-8000-000000000003']]){
 test(`${name} has one clear relationship entry, universal athletes and an open sports profile`,async({page})=>{
  const errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*.supabase.co/**',route=>{external.push(route.request().url());return route.abort();});
  await page.addInitScript(id=>localStorage.setItem('gboxeur:local-persona',id),id);
  await page.goto('/planning.html#journal');await expect(page.locator('#journalSection')).toBeVisible();
  const nav=page.locator('#primaryNavigation');await expect(nav.getByRole('link',{name:'Athlètes',exact:true})).toBeVisible();
  await expect(nav.getByRole('link',{name:'Mes coachs',exact:true})).toHaveCount(0);
  await expect(page.locator('#connectionsButton')).toBeHidden();
  await page.locator('[data-primary-menu]').click();const menu=page.locator('#profileMenuDialog');
  expect(await menu.locator('[data-menu-action]').evaluateAll(nodes=>nodes.map(node=>node.dataset.menuAction))).toEqual(['notifications','connections','groups','profile','install']);
  await menu.locator('[data-menu-action=connections]').click();
  await expect(page.locator('#connectionsDialog')).toBeVisible();await expect(menu).toBeHidden();
  await page.keyboard.press('Escape');await expect(page.locator('#connectionsDialog')).toBeHidden();
  await nav.getByRole('link',{name:'Athlètes',exact:true}).click();await expect(page.locator('#rosterTitle')).toHaveText('Liste d’athlètes');
  await expect(page.locator('[data-directory]')).toHaveCount(0);
  await page.locator('[data-primary-menu]').click();await page.locator('[data-menu-action=profile]').click();
  await expect(page.locator('#sportsPanel')).toBeVisible();await expect(page.locator('#sportsProfileForm')).toBeVisible();
  await expect(page.locator('a[href="planning.html#coachs"]')).toHaveCount(0);
  await expect(page.locator('#connectionsButton')).toHaveCount(0);
  if(name==='athlete')await expect(page.locator('#enableCoachingButton')).toBeVisible();else await expect(page.locator('#enableCoachingButton')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);expect(external).toEqual([]);
 });
}

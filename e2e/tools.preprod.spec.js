import { test,expect } from '@playwright/test';

const sam='71000000-0000-4000-8000-000000000003';
test.beforeEach(async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));page.__toolErrors=errors;
 await page.route('**/*.supabase.co/**',route=>{errors.push('Unexpected remote request');return route.abort();});
 await page.addInitScript(id=>localStorage.setItem('gboxeur:local-persona',id),sam);
});
test.afterEach(async({page})=>{expect(page.__toolErrors).toEqual([]);});

async function choose(page,id){
 await page.locator('[data-tools-menu]').click();
 const menu=page.locator('#toolsMenuDialog');await expect(menu).toBeVisible();
 await menu.locator(`[data-tool-menu-item="${id}"]`).click();
 await expect(menu).toBeHidden();
}

test('tools open directly across pages and preserve same-page selection and browser history',async({page})=>{
 await page.goto('/planning.html');await expect(page.locator('#workspace')).toBeVisible();
 await page.locator('[data-tools-menu]').click();const menu=page.locator('#toolsMenuDialog');
 await expect(menu.locator('[data-tool-menu-item]')).toHaveCount(10);
 await expect(menu.locator('[data-tool-menu-item] svg')).toHaveCount(10);
 await menu.locator('[data-tool-menu-item=intervals]').click();
 await expect(page).toHaveURL(/tools\.html\?tool=intervals$/);
 await expect(page.locator('#toolTitle')).toHaveText('Timer à intervalles');
 await expect(page.locator('#toolsMenu, #toolsBack, .tool-card')).toHaveCount(0);
 const stamp=await page.evaluate(()=>window.__toolDocument=`${performance.timeOrigin}-${Math.random()}`);
 await choose(page,'reaction');
 await expect(page).toHaveURL(/tool=cognitive&game=reaction$/);
 await expect(page.locator('.cognitive-game-host')).toBeVisible();
 await expect(page.locator('.cognitive-menu')).toHaveCount(0);
 await expect(page.locator('.cognitive-game-host')).not.toContainText('Chargement du jeu');
 expect(await page.evaluate(()=>window.__toolDocument)).toBe(stamp);
 await page.locator('[data-tools-menu]').click();
 await expect(menu.locator('[data-tool-menu-item=reaction]')).toHaveAttribute('aria-current','page');
 await page.keyboard.press('Escape');
 await page.goBack();
 await expect(page).toHaveURL(/tool=intervals$/);
 await expect(page.locator('#toolTitle')).toHaveText('Timer à intervalles');
 await page.reload();await expect(page.locator('#toolTitle')).toHaveText('Timer à intervalles');
 await choose(page,'visual-memory');
 await expect(page).toHaveURL(/game=visual-memory$/);
 await expect(page.locator('.cognitive-game-host')).not.toContainText('Chargement du jeu');
 await expect(page.locator('.cognitive-game-host')).toBeVisible();
 await expect(page.locator('.cognitive-game-back, #mentalBack, .cognitive-menu')).toHaveCount(0);
 await choose(page,'steps');
 await expect(page.locator('#toolTitle')).toHaveText('Compteur de pas');
 await page.goBack();await expect(page).toHaveURL(/game=visual-memory$/);
});

test('tools drawer and desktop popup scroll inside the viewport and share keyboard navigation with Menu',async({page},info)=>{
 await page.goto('/tools.html');await expect(page.locator('#toolsApp')).toBeVisible();
 await page.emulateMedia({reducedMotion:'reduce'});
 const sizes=info.project.name==='phone'?[[320,568],[844,390]]:[[1440,900]];
 for(const [width,height] of sizes){
  await page.setViewportSize({width,height});
  for(const theme of ['dark','light']){
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   const trigger=page.locator('[data-tools-menu]'),menu=page.locator('#toolsMenuDialog');
   await trigger.click();await expect(menu).toBeVisible();
   await expect(menu.locator('.tools-menu-close')).toHaveCount(0);
   const box=await menu.boundingBox();
   expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
   expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y+box.height).toBeLessThanOrEqual(height);
   expect(await menu.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   if(height<600){
    expect(await menu.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
    await menu.locator('[data-tool-menu-item=dual-task]').scrollIntoViewIfNeeded();
    expect(await menu.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
   }
   await page.screenshot({path:info.outputPath(`tools-menu-${width}-${theme}.png`)});
   await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(trigger).toBeFocused();
   await page.locator('[data-primary-menu]').click();await expect(page.locator('#profileMenuDialog')).toBeVisible();
   if(width<=800){
    await page.locator('.menu-drawer-dismiss').click();
    await expect(page.locator('#profileMenuDialog')).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/menu-drawer-open/);
   }
   await trigger.click();await expect(menu).toBeVisible();await expect(page.locator('#profileMenuDialog')).toBeHidden();
   await page.keyboard.press('Escape');
  }
 }
});


test('all tools and games open without intermediate choices and fullscreen still has an exit',async({page},info)=>{
 await page.goto('/tools.html');await expect(page.locator('#toolTitle')).toHaveText('Timer de boxe');
 await expect(page).toHaveURL(/tool=boxing$/);
 const targets=[['boxing','#timerStart'],['intervals','#timerStart'],['punches','.punch-counters'],['steps','#stepTap'],['bulletin','.bulletin'],['tiles','#cognitiveStart'],['bag','#cognitiveStart'],['reaction','#reactionStart'],['visual-memory','#mentalStart'],['dual-task','#mentalStart']];
 for(const [id,target] of targets){
  await choose(page,id);await expect(page.locator(target)).toBeVisible();
  await expect(page.locator('#toolsMenu, #toolsBack, .tool-card, .cognitive-menu, .cognitive-game-back, #mentalBack')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.locator('#mentalStart').click();await expect(page.locator('.mental.is-playing')).toBeVisible();
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('#mentalStop').click();await expect(page.locator('.mental.is-playing')).toHaveCount(0);
 await expect(page.locator('[data-tools-menu]')).toBeVisible();
 await choose(page,'boxing');
 await page.locator('#toolFullscreen').click();
 await expect(page.locator('#toolFullscreen')).toHaveAttribute('aria-pressed','true');
 await page.locator('#toolFullscreen').click();
 await expect(page.locator('#toolFullscreen')).toHaveAttribute('aria-pressed','false');
 await expect(page.locator('[data-tools-menu]')).toBeVisible();
 await page.screenshot({path:info.outputPath('direct-boxing.png')});
 await page.goto('/tools.html?tool=cognitive');
 await expect(page).toHaveURL(/tool=cognitive&game=tiles$/);await expect(page.locator('#cognitiveStart')).toBeVisible();
 await page.goto('/tools.html?tool=unknown');
 await expect(page).toHaveURL(/tool=boxing$/);await expect(page.locator('#timerStart')).toBeVisible();
});

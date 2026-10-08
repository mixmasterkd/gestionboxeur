import { test, expect } from '@playwright/test';

async function openCalendar(page, role='coach') {
  await page.clock.setFixedTime(new Date('2026-10-07T16:00:00Z'));
  await page.goto(`/planning.html?demo=${role}&athlete=preview-athlete`);
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#calendar')).not.toHaveAttribute('aria-busy','true');
}
async function noOverflow(page, dialog) {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  if(dialog) {
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
    const box=await dialog.boundingBox(),viewport=page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x+box.width).toBeLessThanOrEqual(viewport.width+1);
  }
}

test.beforeEach(async({page})=>{
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('.supabase.co/')&&!['GET','OPTIONS'].includes(r.method()))errors.push('Unexpected remote mutation');});
  page.__calendarErrors=errors;
});
test.afterEach(async({page})=>{expect(page.__calendarErrors).toEqual([]);});

for(const theme of ['dark','light']) test(`navigation and month/day overview in ${theme} theme`,async({page})=>{
  await openCalendar(page);
  if(theme==='light')await page.locator('.appearance-toggle').click();
  await noOverflow(page);
  await page.getByRole('button',{name:'Mois',exact:true}).click();
  const day=page.locator('.day[data-date="2026-10-08"] .month-day-button');
  await expect(day).toHaveAccessibleName(/1 séance\(s\), 2 note\(s\)/);
  await day.scrollIntoViewIfNeeded();
  const box=await day.boundingBox();expect(box.width).toBeGreaterThanOrEqual(32);expect(box.height).toBeGreaterThanOrEqual(36);
  await page.screenshot({path:test.info().outputPath(`month-${theme}.png`)});
  await day.click();
  await expect(page.locator('#calendar .day')).toHaveCount(1);
  await expect(page.locator('#calendar .day')).toHaveAttribute('data-date','2026-10-08');
  await expect(page.getByRole('button',{name:/Suivi des déplacements.*Ouvrir la note/})).toBeVisible();
  await expect(page.locator('#todayViewButton')).toBeFocused();
  await page.locator('#nextButton').click();await expect(page.locator('#calendar .day')).toHaveAttribute('data-date','2026-10-09');
  await page.locator('#previousButton').click();await expect(page.locator('#calendar .day')).toHaveAttribute('data-date','2026-10-08');
  await page.locator('#todayButton').click();await expect(page.locator('#calendar .day')).toHaveAttribute('data-date','2026-10-07');
  await noOverflow(page);
  await page.reload();await expect(page.locator('#calendar .day')).toHaveCount(1);
});

test('create, edit, move and delete a multi-day note',async({page})=>{
  await openCalendar(page);
  await page.locator('#addEventButton').click();const form=page.locator('#eventDialog');
  await noOverflow(page,form);
  await form.getByLabel('Titre',{exact:true}).fill('QA note');
  await form.getByLabel('Date de fin').fill('2026-10-09');
  await form.getByLabel('Notes',{exact:true}).fill('Texte long pour vérifier la lecture sur téléphone. '.repeat(8));
  await form.getByRole('button',{name:'Ajouter la note',exact:true}).click();await expect(form).not.toBeVisible();
  await page.getByRole('button',{name:/QA note.*Ouvrir la note/}).click();
  const detail=page.locator('#detailDialog');await noOverflow(page,detail);
  await detail.getByRole('button',{name:'Modifier / déplacer',exact:true}).click();
  await form.getByLabel('Date de début').fill('2026-10-08');
  await form.getByLabel('Date de fin').fill('2026-10-10');
  await form.locator('button[type="submit"]').click();await expect(form).not.toBeVisible();
  await page.getByRole('button',{name:/QA note.*Ouvrir la note/}).click();
  await expect(detail).toContainText('8 octobre 2026 → 10 octobre 2026');
  await detail.getByRole('button',{name:'Supprimer',exact:true}).click();
  await page.locator('#confirmYes').click();
  await expect(detail).not.toBeVisible();await expect(page.getByRole('button',{name:/QA note.*Ouvrir la note/})).toHaveCount(0);
});

test('plan a session from a day, then move it through the editor',async({page})=>{
  await openCalendar(page);
  await page.locator('.day[data-date="2026-10-08"] .add-day').click();
  await page.locator('#dayAddDialog').getByRole('button',{name:'Planifier une séance',exact:true}).click();
  const form=page.locator('#sessionDialog');await noOverflow(page,form);
  await expect(form.locator('[name="date"]')).toHaveValue('2026-10-08');
  await form.getByLabel('Titre de la séance').fill('QA séance');
  await form.locator('[name="sport"]').selectOption('running');
  await form.getByRole('textbox',{name:'Texte de l’entraînement'}).fill('- 5m @ Z2\n- 1m @ Repos');
  await form.getByRole('button',{name:'Planifier la séance',exact:true}).click();
  await expect(form).not.toBeVisible();
  const card=page.locator('.session-card').filter({has:page.getByRole('button',{name:'QA séance',exact:true})});
  await expect(page.locator('.day[data-date="2026-10-08"]')).toContainText('QA séance');
  await card.getByRole('button',{name:'QA séance',exact:true}).click();
  await page.locator('#detailDialog').getByRole('button',{name:'Modifier / déplacer',exact:true}).click();
  await expect(form.getByRole('textbox',{name:'Texte de l’entraînement'})).toContainText('5m');
  await form.getByLabel('Date',{exact:true}).fill('2026-10-09');
  await form.locator('button[type="submit"]').click();await expect(form).not.toBeVisible();
  await expect(page.locator('.day[data-date="2026-10-09"]')).toContainText('QA séance');
  await expect(page.locator('.day[data-date="2026-10-08"]')).not.toContainText('QA séance');
});

test('athlete can complete a locked session and save feedback',async({page})=>{
  await openCalendar(page,'athlete');
  await expect(page.getByRole('button',{name:/Observations techniques.*Ouvrir la note/})).toHaveCount(0);
  await page.getByRole('button',{name:'Précision & déplacements',exact:true}).click();
  const detail=page.locator('#detailDialog');await noOverflow(page,detail);
  await expect(detail.getByRole('button',{name:'Modifier / déplacer',exact:true})).toHaveCount(0);
  await detail.getByRole('button',{name:'✓ Marquer comme faite',exact:true}).click();
  await expect(detail).toContainText('Séance faite');
  await detail.locator('[name="rpe"]').selectOption('7');
  await detail.locator('[name="feeling"][value="4"]').check();
  await detail.locator('[name="comment"]').fill('Bonne séance QA');
  await detail.locator('[name="comment"]').blur();
  await expect(detail.locator('.feedback-save-status')).toContainText('enregistré');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Précision & déplacements',exact:true}).click();
  await expect(detail.locator('[name="comment"]')).toHaveValue('Bonne séance QA');
});

test('group and personal calendars stay distinct and dialogs work with the keyboard',async({page})=>{
  await openCalendar(page);
  await page.locator('#athletePickerButton').click();const picker=page.locator('#athletePickerDialog');
  await noOverflow(page,picker);
  await picker.getByRole('button',{name:/Boxe compétition/}).click();
  await expect(page.locator('#athleteTitle')).toContainText('Boxe compétition');
  await page.locator('#addEventButton').click();await noOverflow(page,page.locator('#eventDialog'));
  await expect(page.locator('#eventDialog')).toContainText('Boxe compétition');
  await page.keyboard.press('Escape');
  await page.locator('#athletePickerButton').click();
  await picker.getByRole('button',{name:/Alex Morin/}).click();
  await page.getByRole('button',{name:'Mois',exact:true}).click();
  const day=page.locator('.day[data-date="2026-10-07"] .month-day-button');
  await day.focus();await page.keyboard.press('Enter');
  await expect(page.locator('#todayViewButton')).toBeFocused();
  await expect(page.locator('#calendar .day')).toHaveCount(1);
});

test('desktop drag moves a session to another day',async({page},info)=>{
  test.skip(page.viewportSize().width<1024,'The date editor is exercised on every touch viewport.');
  await openCalendar(page);
  const handle=page.locator('[data-session-id="preview-run"] .drag-handle');
  const target=page.locator('.day[data-date="2026-10-08"] .day-content');
  await handle.scrollIntoViewIfNeeded();
  const from=await handle.boundingBox(),to=await target.boundingBox();
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);
  await page.mouse.down();
  await page.mouse.move(from.x+from.width/2+15,from.y+from.height/2+10,{steps:5});
  const targetY=Math.max(60,Math.min(page.viewportSize().height-100,to.y+150));
  await page.mouse.move(to.x+to.width/2,targetY,{steps:30});
  await page.mouse.move(to.x+to.width/2+2,targetY,{steps:5});
  await page.mouse.up();
  await expect(page.locator('.day[data-date="2026-10-08"] [data-session-id="preview-run"]')).toHaveCount(1);
});

test('touch long-press reorders sessions without opening their details',async({page,hasTouch})=>{
  test.skip(!hasTouch||page.viewportSize().width>800,'Portrait touch gesture; all formats also exercise moving by date.');
  await openCalendar(page);await page.locator('#todayViewButton').click();
  const source=page.locator('[data-session-id="preview-run"] .drag-handle'),target=page.locator('[data-session-id="preview-box"]');
  await source.evaluate(element=>element.scrollIntoView({block:'center',behavior:'instant'}));
  const from=await source.boundingBox(),to=await target.boundingBox();
  expect(from.width).toBeGreaterThanOrEqual(36);expect(from.height).toBeGreaterThanOrEqual(44);
  const cdp=await page.context().newCDPSession(page),x=from.x+from.width/2,y=from.y+from.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  // Sortable requires a 170 ms hold on touch. Preserve a realistic gesture duration.
  await new Promise(resolve=>setTimeout(resolve,220));
  for(let step=1;step<=20;step++){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(to.x+to.width/2-x)*step/20,y:y+(to.y+30-y)*step/20}]});
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  await expect(page.locator('.session-card').first()).toHaveAttribute('data-session-id','preview-run');
  await expect(page.locator('#toast')).toHaveText('Séance déplacée.');
  await expect(page.locator('#detailDialog')).not.toBeVisible();
});


test('library search plans a template on the day chosen from the calendar',async({page})=>{
  await openCalendar(page);
  await page.locator('.day[data-date="2026-10-08"] .add-day').click();
  await page.locator('#dayAddDialog').getByRole('button',{name:'Bibliothèque',exact:true}).click();
  const library=page.locator('#libraryDialog');await noOverflow(page,library);
  await library.getByRole('searchbox',{name:'Rechercher dans la bibliothèque'}).fill('Jog 10');
  await expect(library.locator('.template-card')).toHaveCount(1);
  await library.getByRole('button',{name:'Utiliser',exact:true}).click();
  const form=page.locator('#sessionDialog');
  await expect(form.locator('[name="date"]')).toHaveValue('2026-10-08');
  await expect(form.getByLabel('Titre de la séance')).toHaveValue('Jog 10 min');
  await form.getByRole('button',{name:'Planifier la séance',exact:true}).click();
  await expect(form).not.toBeVisible();
  await expect(page.locator('.day[data-date="2026-10-08"]')).toContainText('Jog 10 min');
});

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
    // Wait for the drawer's entry animation before judging its final bounds.
    await expect.poll(async()=>{
      const box=await dialog.boundingBox(),viewport=page.viewportSize();
      return !!box&&box.x>=-1&&box.x+box.width<=viewport.width+1;
    }).toBe(true);
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
  await expect(page.locator('#todayButton')).toHaveCount(0);await page.locator('#previousButton').click();await expect(page.locator('#calendar .day')).toHaveAttribute('data-date','2026-10-07');
  await noOverflow(page);
  await page.reload();await expect(page.locator('#calendar .day')).toHaveCount(1);
});

test('create, edit, move and delete a multi-day note',async({page})=>{
  await openCalendar(page);
  await page.locator('.add-day').first().click();await page.locator('#dayAddDialog').getByRole('button',{name:'Notes',exact:true}).click();const form=page.locator('#eventDialog');
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
  await page.locator('.add-day').first().click();await page.locator('#dayAddDialog').getByRole('button',{name:'Notes',exact:true}).click();await noOverflow(page,page.locator('#eventDialog'));
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

test('month previews open the selected workout or note without changing the calendar view',async({page})=>{
  await openCalendar(page);
  await page.getByRole('button',{name:'Mois',exact:true}).click();
  const mobile=page.viewportSize().width<=800;
  const workout=mobile?page.locator('.month-session-preview[data-session-id="preview-box"]'):page.locator('.session-card[data-session-id="preview-box"] .session-title');
  await workout.click();
  await expect(page.locator('#detailTitle')).toHaveText('Précision & déplacements');
  await expect(page.locator('#detailDialog').getByRole('button',{name:/Ouvrir le timer/})).toBeVisible();
  await page.locator('#detailDialog .close-button').click();
  await expect(page.getByRole('button',{name:'Mois',exact:true})).toHaveAttribute('aria-pressed','true');
  const band=page.locator('.calendar-event-lanes .event-card').filter({hasText:'Suivi des déplacements'}).first();
  await band.locator('.event-open').click();await expect(page.locator('#detailTitle')).toHaveText('Suivi des déplacements');
  await page.locator('#detailDialog .close-button').click();
  if(mobile){
    await expect(page.locator('.month-mobile-content .session-timer-button')).toHaveCount(0);
    await page.locator('.day[data-date="2026-10-07"] .month-more').click();
    await expect(page.getByRole('button',{name:'Jour',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.getByRole('button',{name:'Précision & déplacements',exact:true})).toBeVisible();
  }else await expect(page.locator('.month-mobile-content').first()).toBeHidden();
  await noOverflow(page);
});

async function addTimerWorkout(page,title,text) {
  await page.locator('.add-day').first().click();await page.locator('#dayAddDialog').getByRole('button',{name:'Planifier une séance',exact:true}).click();
  const form=page.locator('#sessionDialog');
  await form.getByLabel('Titre de la séance').fill(title);
  await form.locator('[name="sport"]').selectOption('boxing');
  await form.getByRole('textbox',{name:'Texte de l’entraînement'}).fill(text);
  await form.getByRole('button',{name:'Planifier la séance',exact:true}).click();
  await expect(form).not.toBeVisible();
}
async function deliberateHold(page,control,milliseconds,touch) {
  const box=await control.boundingBox(),point={x:box.x+box.width/2,y:box.y+box.height/2};
  if(touch){
    const cdp=await page.context().newCDPSession(page);
    try{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await page.clock.runFor(milliseconds);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    finally{await cdp.detach();}
  }else{await page.mouse.move(point.x,point.y);await page.mouse.down();await page.clock.runFor(milliseconds);await page.mouse.up();}
}

test('workout timer plays timed and manual steps fullscreen with deliberate locked controls',async({page},info)=>{
  await page.clock.install({time:new Date('2026-10-07T16:00:00Z')});
  await openCalendar(page);
  await addTimerWorkout(page,'QA timer mixte','- Sac 2s @ Z4 - Garder les mains hautes\n- Push-up 10x\n- Repos 1s\n- Course 400mtr\n- Sac 1s');
  await page.getByRole('button',{name:'Ouvrir le timer de QA timer mixte',exact:true}).click();
  const dialog=page.locator('#sessionTimerDialog'),board=page.locator('#sessionTimerBoard');
  await noOverflow(page,dialog);await expect(dialog.locator('.session-timer-summary')).toContainText('2 étapes libres');
  await expect(dialog.locator('.session-timer-setup')).toHaveCount(0);
  await expect(dialog).not.toContainText(/Garder les mains hautes|Push-up|10 répétitions|400 m|Programmation et consignes/);
  await expect(board.locator('.timer-phase')).toHaveText('Effort');
  await expect(board.locator('.timer-next')).toHaveText('Ensuite : Effort · Sans durée');
  await dialog.locator('.session-timer-sound input').uncheck();
  await dialog.locator('.session-timer-start').click();
  await expect(board).toHaveAttribute('data-session-locked','true');await expect(board).toHaveClass(/is-session/);
  await expect(board).toHaveCSS('background-color','rgb(237, 148, 39)');
  await expect(board.locator('.timer-digits')).toHaveText('00:02');
  const readout=await board.locator('.timer-readout').boundingBox(),controls=await board.locator('.timer-session-controls').boundingBox();
  expect(readout.y+readout.height<=controls.y+1 || readout.x+readout.width<=controls.x+1).toBe(true);
  await page.clock.runFor(2000);
  await expect(board.locator('.timer-round')).toHaveText('Étape 2 / 5');
  await expect(board.locator('.session-timer-measure')).toHaveText('Temps écoulé · passage manuel');
  await expect(board.locator('.timer-next')).toHaveText('Ensuite : Repos · 00:01');
  const advance=board.locator('.session-timer-advance');
  await advance.click();await expect(board.locator('.timer-round')).toHaveText('Étape 2 / 5');
  await deliberateHold(page,advance,1000,info.project.use.hasTouch);await expect(board.locator('.timer-round')).toHaveText('Étape 2 / 5');
  await deliberateHold(page,advance,2100,info.project.use.hasTouch);await expect(board.locator('.timer-phase')).toHaveText('Repos');
  await expect(board).toHaveAttribute('data-session-locked','true');
  await page.clock.runFor(1000);await expect(board.locator('.timer-round')).toHaveText('Étape 4 / 5');
  await expect(board.locator('.session-timer-measure')).toHaveText('Temps écoulé · passage manuel');
  await expect(dialog).not.toContainText(/Garder les mains hautes|Push-up|10 répétitions|400 m/);
  await page.screenshot({path:test.info().outputPath('session-timer-manual.png')});
  await deliberateHold(page,board.locator('#timerSessionLock'),3100,info.project.use.hasTouch);
  await expect(board).toHaveAttribute('data-status','running');await expect(board).toHaveAttribute('data-session-locked','false');
  await board.locator('#timerSessionToggle').click();await expect(board).toHaveAttribute('data-status','paused');
  const paused=await board.locator('.timer-digits').textContent();await page.clock.runFor(15000);await expect(board.locator('.timer-digits')).toHaveText(paused);
  await board.locator('#timerSessionToggle').click();await expect(board).toHaveAttribute('data-session-locked','true');
  await deliberateHold(page,advance,2100,info.project.use.hasTouch);await page.clock.runFor(1000);await expect(board).toHaveAttribute('data-status','done');
  await deliberateHold(page,board.locator('#timerSessionLock'),3100,info.project.use.hasTouch);
  await board.locator('#timerSessionClose').click();await dialog.getByRole('button',{name:'Fermer le timer',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'QA timer mixte',exact:true}).click();
  await expect(page.locator('#detailDialog')).toContainText('Push-up');
  await expect(page.locator('#detailDialog')).toContainText('Garder les mains hautes');
  await expect(page.locator('#detailDialog').getByRole('button',{name:'Modifier / déplacer',exact:true})).toBeVisible();
});

test('free workout shows only elapsed time in the timer and keeps instructions in its session details',async({page},info)=>{
  await page.clock.install({time:new Date('2026-10-07T16:00:00Z')});await openCalendar(page);
  await addTimerWorkout(page,'QA technique libre','Technique libre. Prévoir les gants et les bandages.');
  await page.getByRole('button',{name:'Ouvrir le timer de QA technique libre',exact:true}).click();
  const dialog=page.locator('#sessionTimerDialog');
  await expect(dialog.getByRole('button',{name:'Chrono libre',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(dialog.locator('.session-timer-summary')).toContainText('1 étape libre');
  await dialog.locator('.session-timer-sound input').uncheck();await dialog.locator('.session-timer-start').click();
  await page.clock.runFor(5000);
  await expect(dialog.locator('.timer-digits')).toHaveText('00:05');
  await expect(dialog).not.toContainText('Prévoir les gants et les bandages.');
  await expect(dialog.locator('.session-timer-measure')).toHaveText('Temps écoulé · passage manuel');
  await expect(dialog.locator('.session-timer-advance')).toContainText('Terminer l’étape');
  await expect(dialog.locator('#sessionTimerBoard')).toHaveAttribute('data-status','running');
  await deliberateHold(page,dialog.locator('#timerSessionLock'),3100,info.project.use.hasTouch);
  await dialog.locator('#timerSessionClose').click();await dialog.getByRole('button',{name:'Fermer le timer',exact:true}).click();
  await page.getByRole('button',{name:'QA technique libre',exact:true}).click();
  await expect(page.locator('#detailDialog')).toContainText('Technique libre. Prévoir les gants et les bandages.');
});

test('untimed structured workout can use chosen intervals while preserving its rounds and saved program',async({page},info)=>{
  await page.clock.install({time:new Date('2026-10-07T16:00:00Z')});await openCalendar(page);
  const text='2 rounds\n- Push-up 10x\n- Squats 12x';
  await addTimerWorkout(page,'QA circuit sans durée',text);
  const open=page.getByRole('button',{name:'Ouvrir le timer de QA circuit sans durée',exact:true});
  await open.click();const dialog=page.locator('#sessionTimerDialog'),board=dialog.locator('#sessionTimerBoard');
  await expect(dialog.getByRole('button',{name:'Chrono libre',exact:true})).toHaveAttribute('aria-pressed','true');
  await dialog.getByRole('button',{name:'Configurer des intervalles',exact:true}).click();
  await expect(dialog.getByLabel('Nombre d’intervalles',{exact:true})).toHaveCount(0);
  await dialog.getByLabel('Effort (secondes)',{exact:true}).fill('0');
  await expect(dialog.locator('.session-timer-start')).toBeDisabled();await expect(dialog.locator('.session-timer-config-error')).toContainText('Effort');
  await dialog.getByLabel('Effort (secondes)',{exact:true}).fill('30');
  await dialog.getByLabel('Repos (secondes)',{exact:true}).fill('10');
  await expect(dialog.locator('.session-timer-summary')).toHaveText('7 étapes · 02:30');
  await noOverflow(page,dialog);await dialog.locator('.session-timer-setup').screenshot({path:test.info().outputPath('untimed-interval-settings.png')});
  await dialog.locator('.session-timer-sound input').uncheck();await dialog.locator('.session-timer-start').click();
  await expect(board).toHaveAttribute('data-session-locked','true');await expect(board.locator('.timer-round')).toHaveText('Étape 1 / 7 · Round 1/2');
  await expect(dialog.getByLabel('Effort (secondes)',{exact:true})).toBeDisabled();
  await expect(board.locator('.session-timer-advance')).not.toBeVisible();
  await page.clock.runFor(30000);await expect(board.locator('.timer-phase')).toHaveText('Repos');await expect(board.locator('.timer-digits')).toHaveText('00:10');
  await page.clock.runFor(10000);await expect(board.locator('.timer-round')).toHaveText('Étape 3 / 7 · Round 1/2');
  await deliberateHold(page,board.locator('#timerSessionLock'),3100,info.project.use.hasTouch);
  await board.locator('#timerSessionClose').click();await dialog.getByRole('button',{name:'Fermer le timer',exact:true}).click();
  await open.click();await expect(board).toHaveAttribute('data-status','paused');
  await expect(dialog.getByLabel('Effort (secondes)',{exact:true})).toHaveValue('30');
  await expect(dialog.getByRole('button',{name:'Chrono libre',exact:true})).toBeDisabled();
  await dialog.locator('.session-timer-reset').click();await dialog.getByRole('button',{name:'Chrono libre',exact:true}).click();
  await expect(dialog.locator('.session-timer-summary')).toHaveText('4 étapes libres · passage manuel');
  await expect(board.locator('.timer-round')).toHaveText('Étape 1 / 4 · Round 1/2');
  await dialog.getByRole('button',{name:'Fermer le timer',exact:true}).click();
  await page.getByRole('button',{name:'QA circuit sans durée',exact:true}).click();
  await page.locator('#detailDialog').getByRole('button',{name:'Modifier / déplacer',exact:true}).click();
  await expect(page.locator('#sessionDialog').getByRole('textbox',{name:'Texte de l’entraînement'})).toHaveText(text,{useInnerText:true});
});

test('free prose can run a chosen number of intervals with no added final rest',async({page},info)=>{
  await page.clock.install({time:new Date('2026-10-07T16:00:00Z')});await openCalendar(page);
  await addTimerWorkout(page,'QA intervalles libres','Technique libre. Prévoir les gants.');
  await page.getByRole('button',{name:'Ouvrir le timer de QA intervalles libres',exact:true}).click();
  const dialog=page.locator('#sessionTimerDialog'),board=dialog.locator('#sessionTimerBoard');
  await dialog.getByRole('button',{name:'Configurer des intervalles',exact:true}).click();
  await dialog.getByLabel('Effort (secondes)',{exact:true}).fill('2');await dialog.getByLabel('Repos (secondes)',{exact:true}).fill('1');
  await dialog.getByLabel('Nombre d’intervalles',{exact:true}).fill('0');await expect(dialog.locator('.session-timer-start')).toBeDisabled();
  await dialog.getByLabel('Nombre d’intervalles',{exact:true}).fill('3');
  await expect(dialog.locator('.session-timer-summary')).toHaveText('5 étapes · 00:08');await noOverflow(page,dialog);
  await dialog.locator('.session-timer-setup').screenshot({path:test.info().outputPath('free-interval-settings.png')});
  await dialog.locator('.session-timer-sound input').uncheck();await dialog.locator('.session-timer-start').click();
  await expect(board.locator('.timer-round')).toHaveText('Étape 1 / 5 · Intervalle 1/3');
  await expect(board).not.toContainText('Prévoir les gants');
  await page.clock.runFor(8000);await expect(board).toHaveAttribute('data-status','done');await expect(board.locator('.timer-digits')).toHaveText('00:08');
  await expect(board.locator('.timer-round')).toHaveText('Étape 5 / 5 · Intervalle 3/3');
  await deliberateHold(page,board.locator('#timerSessionLock'),3100,info.project.use.hasTouch);
  await board.locator('#timerSessionReset').click();await expect(board).toHaveAttribute('data-status','idle');await expect(board.locator('.timer-digits')).toHaveText('00:02');
});

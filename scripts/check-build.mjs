// Check the shipped cascade, not just the development HTML. Shared CSS chunks
// previously placed legacy button and layout rules after the current theme.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { Window } from 'happy-dom';

const pages = ['roster.html', 'login.html', 'planning.html', 'profile.html', 'admin/index.html'];
for (const page of pages) {
  const file = resolve('dist', page);
  const html = await readFile(file, 'utf8');
  for (const width of [375, 1280]) for (const theme of ["dark", "light"]) {
    const window = new Window({ width, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
    try {
      window.document.write(html);
      window.document.documentElement.setAttribute("data-theme", theme);
      for (const link of [...window.document.querySelectorAll('link[rel="stylesheet"]')]) {
        const style = window.document.createElement('style');
        style.textContent = await readFile(resolve(dirname(file), link.getAttribute('href')), 'utf8');
        link.replaceWith(style);
      }
      const button = window.document.querySelector('.button-dark, .button.primary');
      assert.ok(button, `${page}: primary action`);
      const computed = window.getComputedStyle(button);
      assert.equal(computed.backgroundColor, theme === 'dark' ? '#d7dfe9' : '#263246', `${page} at ${width}px: the current palette must win`);
      assert.equal(computed.color, theme === 'dark' ? '#18202b' : '#fff', `${page}: readable primary action`);
      assert.equal(window.getComputedStyle(window.document.body).backgroundColor, theme === 'dark' ? '#181b20' : '#f4f5f7', `${page}: graphite surface`);
      assert.ok(parseFloat(computed.minHeight) >= 44, `${page}: usable action height`);
      if (page === 'planning.html') {
        assert.equal(window.getComputedStyle(window.document.querySelector('.date-navigation')).display, width < 620 ? 'grid' : 'flex', 'compiled calendar responsiveness');
        const actions=window.document.querySelector('.planner-intro > .intro-actions');
        assert.equal(window.getComputedStyle(actions).display,'grid','calendar actions share equal grid cells');
        assert.ok(parseFloat(window.getComputedStyle(actions.querySelector('#addEventButton')).minHeight)>=80,'event action uses the common panel height');
        const calendar=window.document.getElementById('calendar');
        calendar.className='calendar';
        calendar.innerHTML='<article class="session-card"><div class="session-title-row"><button class="session-title">Jog</button></div><div class="session-card-footer"><button class="completion-button" aria-pressed="false">○ Fait</button></div></article>';
        const completion=window.getComputedStyle(calendar.querySelector('.completion-button'));
        assert.equal(completion.display,'inline-flex','quick completion remains visible in week view');
        assert.ok(parseFloat(completion.minHeight)>=36,'completion target remains usable');
        const monthCalendar=calendar.cloneNode(true);monthCalendar.className='calendar month';calendar.replaceWith(monthCalendar);
        assert.equal(window.getComputedStyle(monthCalendar.querySelector('.session-card-footer')).display,'none','monthly tiles never overflow with quick completion controls');
      }
      if (page === 'roster.html') {
        const coach=window.document.createElement('div');coach.className='coach-choice';coach.innerHTML='<label class="coach-choice-head"><strong>Coach test</strong></label>';
        window.document.getElementById('coachChoices').append(coach);
        const coachStyle=window.getComputedStyle(coach);
        assert.equal(coachStyle.backgroundColor,theme==='dark'?'#22262d':'#fff','contact surface follows appearance');
        assert.equal(window.getComputedStyle(coach.querySelector('strong')).color,theme==='dark'?'#edf0f4':'#222c3a','contact text remains legible');
        const selected=window.document.querySelector('#typeButtons [aria-pressed="true"]');
        const weight=window.document.querySelector('#weightButtons button');weight.setAttribute('aria-pressed','true');
        for(const option of [selected,weight]) {
          const style=window.getComputedStyle(option);
          assert.equal(style.backgroundColor,theme==='dark'?'#edf0f4':'#222c3a','same high-contrast selected option');
          assert.equal(style.color,theme==='dark'?'#181b20':'#f4f5f7','selected option readable');
        }
      }
      if (page === 'roster.html') {
        const directory=window.document.getElementById('athleteDirectory');
        assert.equal(window.getComputedStyle(directory.querySelector('.roster')).display,width<620?'block':'table','mobile uses a compact list and desktop keeps the table');
        if(width<620)assert.equal(window.getComputedStyle(directory.querySelector('thead')).display,'none','mobile uses individual field labels');
        else assert.notEqual(window.getComputedStyle(directory.querySelector('thead')).display,'none','desktop keeps its column headers');
        const cards=directory.cloneNode(true);cards.dataset.rosterView='cards';directory.replaceWith(cards);
        assert.equal(window.getComputedStyle(cards.querySelector('.roster tbody')).display,'grid','cards remain available at every width');
        assert.equal(window.getComputedStyle(cards.querySelector('thead')).display,'none','cards use individual field labels');
      }
      if (page === 'roster.html' && width < 620) {
        assert.equal(window.getComputedStyle(window.document.querySelector('.share-foot')).marginLeft, '0px', 'share buttons must remain inside the dialog');
      }
      if (page === 'login.html') {
        assert.equal(window.getComputedStyle(window.document.body).display, 'flex', 'legacy auth layout must not override Arena');
      }
    } finally { await window.happyDOM.abort(); }
  }
}
console.log('CSS compilé : palette, boutons et règles mobiles vérifiés sur les cinq pages.');

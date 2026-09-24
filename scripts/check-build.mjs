// Check the shipped cascade, not just the development HTML. Shared CSS chunks
// previously placed legacy button and layout rules after the current theme.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { Window } from 'happy-dom';

const pages = ['index.html', 'login.html', 'planning.html', 'profile.html', 'admin/index.html'];
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
        const calendar=window.document.getElementById('calendar');
        calendar.className='calendar month';
        calendar.innerHTML='<article class="session-card"><div class="session-title-row"><button class="session-title">Jog</button><button class="completion-button" aria-pressed="false"><span class="completion-mark"></span></button></div></article>';
        const completion=window.getComputedStyle(calendar.querySelector('.completion-button'));
        assert.equal(completion.display,'inline-grid','completion remains visible in monthly mobile view');
        assert.ok(parseFloat(completion.minHeight)>=36,'monthly completion target remains usable');
      }
      if (page === 'index.html' && width < 620) {
        assert.equal(window.getComputedStyle(window.document.querySelector('.share-foot')).marginLeft, '0px', 'share buttons must remain inside the dialog');
      }
      if (page === 'login.html') {
        assert.equal(window.getComputedStyle(window.document.body).display, 'flex', 'legacy auth layout must not override Arena');
      }
    } finally { await window.happyDOM.abort(); }
  }
}
console.log('CSS compilé : palette, boutons et règles mobiles vérifiés sur les cinq pages.');

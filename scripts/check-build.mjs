// Check the shipped cascade, not just the development HTML. Shared CSS chunks
// previously placed legacy button and layout rules after the current theme.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { Window } from 'happy-dom';
import { intervalControlsMarkup } from '../js/timer-interval-controls.js';

const pages = ['roster.html', 'login.html', 'planning.html', 'profile.html', 'tools.html', 'admin/index.html'];
// Validate the deployed subdirectory, not only a server mounted at '/'.
const siteURL = new URL('https://mixmasterkd.github.io/gestionboxeur/');
const manifestURL = new URL('manifest.webmanifest', siteURL);
const manifest = JSON.parse(await readFile('dist/manifest.webmanifest', 'utf8'));
assert.equal(manifest.name, 'GBoxeur');
assert.equal(manifest.short_name, 'GBoxeur');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.prefer_related_applications, false);
for (const key of ['id', 'start_url', 'scope']) assert.equal(new URL(manifest[key], manifestURL).href, siteURL.href, `app ${key} stays inside gestionboxeur/`);
for (const size of [192, 512]) {
  const icon = manifest.icons.find(icon => icon.sizes === `${size}x${size}` && icon.type === 'image/png');
  assert.ok(icon, `install icon ${size}`);
  const data = await readFile(resolve('dist', icon.src));
  assert.equal(data.toString('hex', 0, 8), '89504e470d0a1a0a', 'real PNG icon');
  assert.equal(data.readUInt32BE(16), size); assert.equal(data.readUInt32BE(20), size);
}
for (const page of ['index.html', ...pages]) {
  const window = new Window({settings:{disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
  try {
    window.document.write(await readFile(resolve('dist', page), 'utf8'));
    const link = window.document.querySelector('link[rel="manifest"]');
    assert.ok(link, `${page}: app manifest`);
    assert.equal(new URL(link.getAttribute('href'), new URL(page, siteURL)).href, manifestURL.href, `${page}: shared app identity`);
    assert.equal(window.document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content, 'GBoxeur');
    const apple = window.document.querySelector('link[rel="apple-touch-icon"]');
    assert.ok(apple, `${page}: iPhone icon`);
    const data = await readFile(resolve('dist', dirname(page), apple.getAttribute('href')));
    assert.equal(data.readUInt32BE(16), 180); assert.equal(data.readUInt32BE(20), 180);
  } finally { await window.happyDOM.abort(); }
}
console.log('GBoxeur : manifeste, chemins GitHub Pages et icônes vérifiés sur les 7 pages.');
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
      if (page === 'tools.html') {
        const start = window.document.createElement('button');
        start.className = 'button primary';
        window.document.getElementById('toolStage').append(start);
        const grid = window.document.querySelector('.tools-grid');
        assert.equal(window.getComputedStyle(grid).display, 'grid', 'tools use an adaptable grid');
        assert.ok(parseFloat(window.getComputedStyle(grid.querySelector('.tool-card')).minHeight) >= 180, 'tools have large touch targets');
        const board=window.document.createElement('div');board.className='timer-board';board.dataset.design='boxing';board.dataset.status='running';board.dataset.phase='work';board.dataset.warning='false';
        window.document.getElementById('toolStage').append(board);
        const workingBackground=window.getComputedStyle(board).backgroundImage;
        board.dataset.warning='true';
        assert.notEqual(window.getComputedStyle(board).backgroundImage,workingBackground,'the 30-second warning replaces the green background');
        assert.equal(window.getComputedStyle(board).color,'#29200c','warning uses dark text on yellow');
        board.dataset.warning='false';board.dataset.phase='rest';
        assert.notEqual(window.getComputedStyle(board).backgroundImage,workingBackground,'rest has a separate red background');
        board.dataset.design='intervals';board.dataset.phase='work';board.dataset.colored='true';
        board.style.setProperty('--interval-color','#25a567');board.style.setProperty('--interval-high-color','#ed9427');board.style.setProperty('--interval-ink','#101722');
        assert.equal(window.getComputedStyle(board).backgroundColor,'#25a567','interval work uses its assigned intensity');
        assert.equal(window.getComputedStyle(board).color,'#101722','interval text remains readable in both themes');
        board.dataset.range='true';
        assert.match(window.getComputedStyle(board).backgroundImage,/linear-gradient/,'intensity ranges retain both endpoint colors');
        board.dataset.range='false';board.dataset.phase='rest';board.style.setProperty('--interval-color','#a3a9b2');
        assert.equal(window.getComputedStyle(board).backgroundColor,'#a3a9b2','interval rest is gray, not boxing red');
        board.dataset.colored='false';board.dataset.phase='prepare';
        assert.notEqual(window.getComputedStyle(board).backgroundColor,'#a3a9b2','preparation is not a recovery intensity');
        const controls=window.document.createElement('div');controls.className='timer-controls-panel';
        controls.innerHTML=intervalControlsMarkup({rounds:8,series:1});
        window.document.getElementById('toolStage').append(controls);
        const unit=controls.querySelector('[data-unit="M"]');unit.setAttribute('aria-pressed','true');
        assert.ok(parseFloat(window.getComputedStyle(unit).minWidth)>=34,'unit toggles keep a usable target despite their compact appearance');
        assert.equal(window.getComputedStyle(controls.querySelector('#timerAdvancedPanel')).display,'none','the inactive mode never leaks into the base panel');
        assert.equal(window.getComputedStyle(controls.querySelector('.interval-mode-tabs')).gridTemplateColumns,'repeat(2,minmax(0,1fr))','Base and Advanced stay side by side');
        const cognitive=window.document.createElement('section');cognitive.className='cognitive';
        cognitive.innerHTML='<h2 class="cognitive-game-title">Tuiles</h2><div class="cognitive-tiles" data-count="8"><button class="cognitive-tile"></button></div><div class="cognitive-bag-fallback" hidden></div>';
        window.document.getElementById('toolStage').append(cognitive);
        assert.ok(parseFloat(window.getComputedStyle(cognitive.querySelector('.cognitive-game-title')).fontSize)>=20,'the separate game title stays readable');
        assert.equal(window.getComputedStyle(cognitive.querySelector('.cognitive-tiles')).gridTemplateColumns,width<620?'repeat(2,minmax(0,1fr))':'repeat(4,minmax(0,1fr))','eight tiles adapt to portrait width');
        assert.ok(parseFloat(window.getComputedStyle(cognitive.querySelector('.cognitive-tile')).minHeight)>=44,'tiles keep accessible touch targets');
        assert.equal(window.getComputedStyle(cognitive.querySelector('.cognitive-bag-fallback')).display,'none','inactive bag fallback stays hidden');
        const titleStyle=window.getComputedStyle(cognitive.querySelector('.cognitive-game-title'));
        assert.notEqual(titleStyle.color,window.getComputedStyle(window.document.body).backgroundColor,'the separate game title remains readable in both themes');
        const reaction=window.document.createElement('section');reaction.className='reaction';reaction.dataset.mode='choice';
        reaction.innerHTML='<div class="reaction-arena"><button class="reaction-pad"></button><button class="reaction-pad"></button><button class="reaction-pad"></button><button class="reaction-pad"></button></div><div class="reaction-actions"><button class="button secondary" hidden>Arrêter</button></div>';
        window.document.getElementById('toolStage').append(reaction);
        const reactionArena=reaction.querySelector('.reaction-arena');
        assert.equal(window.getComputedStyle(reactionArena).display,'grid','four reaction targets remain a grid in both themes');
        assert.equal(window.getComputedStyle(reactionArena).gridTemplateColumns,'repeat(2,minmax(0,1fr))','four reaction targets keep two columns in portrait and desktop');
        for(const pad of reaction.querySelectorAll('.reaction-pad')) {
          const padStyle=window.getComputedStyle(pad);
          assert.ok(parseFloat(padStyle.minHeight)>=44,'reaction pads retain accessible touch targets');
          assert.equal(padStyle.transition,'none','reaction colors appear immediately without a timing-distorting transition');
        }
        assert.equal(window.getComputedStyle(reaction.querySelector('[hidden]')).display,'none','inactive reaction actions remain hidden after CSS bundling');
        const reactionPad=reaction.querySelector('.reaction-pad');reactionPad.classList.add('is-lit');reactionPad.style.backgroundColor='#22c55e';
        assert.equal(window.getComputedStyle(reactionPad).transition,'none','lit reaction targets do not acquire a theme transition');
        assert.equal(window.getComputedStyle(reactionPad).backgroundColor,'#22c55e','reaction signals preserve their assigned color');
        reaction.dataset.mode='simple';
        assert.equal(window.getComputedStyle(reactionArena).display,'block','simple reaction mode keeps a single large target');
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
console.log(`CSS compilé : palette, boutons et règles mobiles vérifiés sur les ${pages.length} pages.`);

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';

const source = await readFile(new URL('../js/navigation.js', import.meta.url), 'utf8');

function navigation(url, { dev = true } = {}) {
  const window = new Window({ url });
  const frames = [];
  let banners = 0;
  window.__mountBanner = () => { banners++; };
  window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  window.eval(source
    .replace(/^import .*test-session\.js.*;$/m, 'const mountTestSessionBanner = window.__mountBanner;')
    .replace('import.meta.env?.DEV', String(dev))
    .replace(/^export /gm, '') + '\nwindow.mountNavigation = mountNavigation;');
  return {
    window,
    mount: window.mountNavigation,
    link: label => [...window.document.querySelectorAll('.nav-links a')].find(a => a.querySelector('.nav-label').textContent === label),
    flush: () => { while (frames.length) frames.shift()(); },
    get banners() { return banners; },
  };
}

test('athlete navigation exposes their calendar, coaches and profile without coach/admin controls', () => {
  const ui = navigation('https://example.test/boxing/planning.html');
  try {
    assert.equal(ui.banners, 1, 'return-to-admin banner can mount before account loading');
    ui.mount({ role: 'athlete', isAdmin: false });
    assert.deepEqual([...ui.window.document.querySelectorAll('.nav-label')].map(el => el.textContent), ['Calendrier', 'Mes coachs', 'Mon profil']);
    assert.equal(ui.link('Mon profil').href, 'https://example.test/boxing/profile.html');
    assert.equal(ui.link('Calendrier').getAttribute('aria-current'), 'page');
    assert.equal(ui.window.document.body.dataset.accountRole, 'athlete');
    assert.equal(ui.link('Administration'), undefined);
  } finally { ui.window.happyDOM.abort(); }
});

test('admin navigation resolves routes correctly from the nested administration page', () => {
  const ui = navigation('https://example.test/boxing/admin/');
  try {
    ui.mount({ role: 'coach', isAdmin: true });
    assert.equal(ui.link('Mes athlètes').href, 'https://example.test/boxing/');
    assert.equal(ui.link('Mes listes'), undefined);
    assert.deepEqual([...ui.window.document.querySelectorAll('.nav-label')].map(el => el.textContent), ['Mes athlètes', 'Calendrier', 'Mon gym', 'Administration']);
    assert.equal(ui.link('Mon gym').href, 'https://example.test/boxing/profile.html');
    assert.equal(ui.link('Administration').getAttribute('aria-current'), 'page');
    ui.mount({ role: 'coach', isAdmin: true });
    assert.equal(ui.window.document.querySelectorAll('#primaryNavigation').length, 1);
  } finally { ui.window.happyDOM.abort(); }
});

test('coach navigation has one athlete entry and keeps old list URLs on that table', () => {
  for (const path of ['/boxing/', '/boxing/index.html', '/boxing/?liste=1', '/boxing/index.html?liste=1']) {
    const ui = navigation(`https://example.test${path}`);
    try {
      ui.mount({ role: 'coach', isAdmin: false });
      assert.deepEqual([...ui.window.document.querySelectorAll('.nav-label')].map(el => el.textContent), ['Mes athlètes', 'Calendrier', 'Mon gym']);
      assert.equal(ui.link('Mes athlètes').href, 'https://example.test/boxing/');
      assert.equal(ui.link('Mes athlètes').getAttribute('aria-current'), 'page');
      assert.equal(ui.window.document.querySelectorAll('[aria-current="page"]').length, 1);
      assert.equal(ui.link('Mes listes'), undefined);
    } finally { ui.window.happyDOM.abort(); }
  }
});

test('obsolete list query cannot mark the roster active on another page', () => {
  for (const [path, active] of [['planning.html?liste=1', 'Calendrier'], ['profile.html?liste=1', 'Mon gym'], ['admin/?liste=1', 'Administration']]) {
    const ui = navigation(`https://example.test/boxing/${path}`);
    try {
      ui.mount({ role: 'coach', isAdmin: true });
      assert.equal(ui.link(active).getAttribute('aria-current'), 'page');
      assert.equal(ui.link('Mes athlètes').hasAttribute('aria-current'), false);
      assert.equal(ui.window.document.querySelectorAll('[aria-current="page"]').length, 1);
    } finally { ui.window.happyDOM.abort(); }
  }
});

for (const role of ['coach', 'athlete']) {
  test(`${role} preview keeps the calendar and identity in the isolated local preview`, () => {
    const ui = navigation(`https://example.test/boxing/planning.html?demo=${role}`);
    try {
      ui.mount({ role, isAdmin: false });
      assert.equal(ui.link('Calendrier').href, `https://example.test/boxing/planning.html?demo=${role}`);
      assert.equal(ui.window.document.querySelector('.nav-identity').href, `https://example.test/boxing/planning.html?demo=${role}`);
      const profile = ui.link(role === 'coach' ? 'Mon gym' : 'Mon profil');
      assert.equal(profile.href, 'https://example.test/boxing/profile.html');
      assert.match(profile.title, /Quitter l’aperçu/);
      if (role === 'athlete') assert.equal(ui.link('Mes coachs').href, 'https://example.test/boxing/planning.html?demo=athlete#coachs');
    } finally { ui.window.happyDOM.abort(); }
  });
}

test('production does not present a demo query as an active isolated preview', () => {
  const ui = navigation('https://example.test/boxing/planning.html?demo=coach', { dev: false });
  try {
    ui.mount({ role: 'coach', isAdmin: false });
    assert.equal(ui.link('Calendrier').href, 'https://example.test/boxing/planning.html');
    assert.equal(ui.link('Mon gym').title, '');
    assert.equal(ui.window.document.querySelector('.nav-identity').href, 'https://example.test/boxing/');
  } finally { ui.window.happyDOM.abort(); }
});

test('the coaches deep link opens once and preserves the preview and selected athlete when consumed', () => {
  const ui = navigation('https://example.test/boxing/planning.html?demo=athlete&athlete=athlete-2#coachs');
  try {
    const button = ui.window.document.createElement('button');
    button.id = 'connectionsButton';
    let opened = 0;
    button.addEventListener('click', () => { opened++; });
    ui.window.document.body.append(button);
    ui.mount({ role: 'athlete' });
    ui.mount({ role: 'athlete' });
    ui.flush();
    assert.equal(opened, 1);
    assert.equal(ui.window.location.hash, '');
    assert.equal(new URL(ui.window.location.href).searchParams.get('demo'), 'athlete');
    assert.equal(new URL(ui.window.location.href).searchParams.get('athlete'), 'athlete-2');
    ui.mount({ role: 'athlete' });
    ui.flush();
    assert.equal(opened, 1, 'closing the dialog is respected on subsequent refreshes');
    ui.link('Mes coachs').click();
    assert.equal(opened, 2, 'the user can still open coaches explicitly');
    assert.equal(ui.window.location.hash, '');
  } finally { ui.window.happyDOM.abort(); }
});

test('spatial navigation opens as a named dialog and closes back to its trigger', () => {
  const ui = navigation('https://example.test/boxing/admin/');
  try {
    ui.mount({ role: 'coach', isAdmin: true });
    const doc = ui.window.document, trigger = doc.querySelector('.nav-explore'), dialog = doc.querySelector('#spaceNavigation');
    assert.equal(trigger.getAttribute('aria-controls'), dialog.id);
    assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog');
    assert.ok(doc.getElementById(dialog.getAttribute('aria-labelledby')));
    assert.equal(dialog.open, false);
    trigger.click();
    assert.equal(dialog.open, true);
    assert.equal(doc.body.classList.contains('space-is-open'), true);
    assert.equal(doc.activeElement, dialog.querySelector('.space-close'));
    assert.equal(dialog.querySelectorAll('.space-card').length, 4);
    assert.equal(dialog.querySelector('.is-current').href, 'https://example.test/boxing/admin/');
    dialog.querySelector('.space-close').click();
    assert.equal(dialog.open, false);
    assert.equal(doc.body.classList.contains('space-is-open'), false);
    assert.equal(doc.activeElement, trigger);
  } finally { ui.window.happyDOM.abort(); }
});

test('spatial athlete map respects routes and opens coaches without leaving the preview', () => {
  const ui = navigation('https://example.test/boxing/planning.html?demo=athlete');
  try {
    const doc = ui.window.document;
    const coaches = doc.createElement('dialog');
    doc.body.append(coaches);
    const button = doc.createElement('button'); button.id = 'connectionsButton';
    button.onclick = () => coaches.showModal(); doc.body.append(button);
    ui.mount({ role: 'athlete' });
    const dialog = doc.querySelector('#spaceNavigation');
    const links = [...dialog.querySelectorAll('.space-card')];
    assert.equal(links.length, 3);
    assert.equal(links.some(link => link.textContent.includes('Administration')), false);
    assert.equal(links[0].href, 'https://example.test/boxing/planning.html?demo=athlete');
    doc.querySelector('.nav-explore').click(); links[1].click();
    assert.equal(dialog.open, false);
    assert.equal(coaches.open, true);
    assert.equal(ui.window.location.pathname, '/boxing/planning.html');
    assert.equal(ui.window.location.search, '?demo=athlete');
  } finally { ui.window.happyDOM.abort(); }
});

test('refreshing navigation disposes the old spatial map and releases the scroll lock', () => {
  const ui = navigation('https://example.test/boxing/planning.html');
  try {
    const doc = ui.window.document;
    ui.mount({ role: 'coach', isAdmin: true }); doc.querySelector('.nav-explore').click();
    ui.mount({ role: 'athlete' });
    assert.equal(doc.querySelectorAll('#spaceNavigation').length, 1);
    assert.equal(doc.querySelectorAll('.nav-explore').length, 1);
    assert.equal(doc.body.classList.contains('space-is-open'), false);
    assert.equal(doc.querySelector('#spaceNavigation').open, false);
    assert.equal(doc.querySelector('#spaceNavigation').textContent.includes('Administration'), false);
    doc.querySelector('.nav-explore').click(); assert.equal(doc.querySelector('#spaceNavigation').open, true);
  } finally { ui.window.happyDOM.abort(); }
});

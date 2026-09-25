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
    assert.deepEqual([...ui.window.document.querySelectorAll('.nav-label')].map(el => el.textContent), ['Calendrier', 'Journal', 'Mes coachs', 'Mon profil']);
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
    assert.equal(ui.link('Mes athlètes').href, 'https://example.test/boxing/roster.html');
    assert.equal(ui.link('Mes listes'), undefined);
    assert.deepEqual([...ui.window.document.querySelectorAll('.nav-label')].map(el => el.textContent), ['Calendrier', 'Journal', 'Mes athlètes', 'Mon profil', 'Administration']);
    assert.equal(ui.link('Mon profil').href, 'https://example.test/boxing/profile.html');
    assert.equal(ui.link('Administration').getAttribute('aria-current'), 'page');
    ui.mount({ role: 'coach', isAdmin: true });
    assert.equal(ui.window.document.querySelectorAll('#primaryNavigation').length, 1);
  } finally { ui.window.happyDOM.abort(); }
});

test('coach navigation has one athlete entry and keeps old list URLs on that table', () => {
  for (const path of ['/boxing/roster.html', '/boxing/roster.html?liste=1']) {
    const ui = navigation(`https://example.test${path}`);
    try {
      ui.mount({ role: 'coach', isAdmin: false });
      assert.deepEqual([...ui.window.document.querySelectorAll('.nav-label')].map(el => el.textContent), ['Calendrier', 'Journal', 'Mes athlètes', 'Mon profil']);
      assert.equal(ui.link('Mes athlètes').href, 'https://example.test/boxing/roster.html');
      assert.equal(ui.link('Mes athlètes').getAttribute('aria-current'), 'page');
      assert.equal(ui.window.document.querySelectorAll('[aria-current="page"]').length, 1);
      assert.equal(ui.link('Mes listes'), undefined);
    } finally { ui.window.happyDOM.abort(); }
  }
});

test('obsolete list query cannot mark the roster active on another page', () => {
  for (const [path, active] of [['planning.html?liste=1', 'Calendrier'], ['profile.html?liste=1', 'Mon profil'], ['admin/?liste=1', 'Administration']]) {
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
      const profile = ui.link(role === 'coach' ? 'Mon profil' : 'Mon profil');
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
    assert.equal(ui.link('Mon profil').title, '');
    assert.equal(ui.window.document.querySelector('.nav-identity').href, 'https://example.test/boxing/planning.html');
  } finally { ui.window.happyDOM.abort(); }
});

test('the coaches deep link opens once and preserves the preview and selected athlete when consumed', () => {
  const ui = navigation('https://example.test/boxing/planning.html?demo=athlete&athlete=athlete-2#coachs');
  try {
    const button = ui.window.document.createElement('button');
    button.id = 'connectionsButton';
    let opened = 0;
    button.addEventListener('click', () => { opened++; });
    button.addEventListener('open-personal-connections', () => { opened++; });
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

test('authenticated profile, roster and administration headers link to personal connections without selected-athlete parameters',()=>{
 for(const [path,actionsClass] of [['profile.html?athlete=other','top-actions'],['roster.html?athlete=other','topbar-actions'],['admin/?athlete=other','top-actions']]) {
  const ui=navigation(`https://example.test/boxing/${path}`);
  try {
   const doc=ui.window.document;
   doc.body.innerHTML=`<header class="topbar"><a class="brand">Mon gym</a><nav class="${actionsClass}"><button class="appearance-toggle" id="appearanceToggle"></button><button id="logoutButton">Déconnexion</button></nav></header>`;
   ui.mount({role:'coach',isAdmin:true});ui.mount({role:'coach',isAdmin:true});
   const link=doc.getElementById('connectionsButton');assert.equal(link.tagName,'A');
   assert.equal(link.href,'https://example.test/boxing/planning.html#coachs');
   assert.equal(link.previousElementSibling.id,'appearanceToggle');assert.equal(link.nextElementSibling.id,'logoutButton');
   assert.equal(link.getAttribute('aria-label'),'Coachs et invitations');assert.equal(link.querySelector('.connections-label').textContent,'Coachs et invitations');
   assert.ok(link.querySelector('svg[aria-hidden=true]'));assert.equal(doc.querySelectorAll('#connectionsButton').length,1);
  }finally{ui.window.happyDOM.abort();}
 }
});

test('the public login page never receives a private connections shortcut',()=>{
 const ui=navigation('https://example.test/boxing/login.html');
 try {
  ui.window.document.body.innerHTML='<header class="topbar"><nav class="top-actions"></nav></header>';
  ui.mount({role:'athlete'});assert.equal(ui.window.document.getElementById('connectionsButton'),null);
 }finally{ui.window.happyDOM.abort();}
});

test('coach library opens once through its deep link without Explorer', () => {
  const ui = navigation('https://example.test/boxing/planning.html?athlete=a1#bibliotheque');
  try {
    const doc = ui.window.document, button = doc.createElement('button');
    let opens = 0; button.id = 'libraryButton'; button.onclick = () => { opens++; }; doc.body.append(button);
    ui.mount({ role: 'coach' }); ui.flush();
    assert.equal(opens, 1); assert.equal(ui.window.location.hash, ''); assert.equal(ui.window.location.search, '?athlete=a1');
    ui.mount({ role: 'coach' }); ui.flush(); assert.equal(opens, 1);
    assert.equal(doc.querySelector('.nav-explore'),null);
    assert.equal(doc.querySelector('#spaceNavigation'),null);

  } finally { ui.window.happyDOM.abort(); }
});

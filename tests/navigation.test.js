import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';

const source = await readFile(new URL('../js/navigation.js', import.meta.url), 'utf8');

function navigation(url, { dev = true } = {}) {
  const window = new Window({ url });
  const frames = [];
  let banners = 0;
  const menus = [];
  const toolsMenus = [];
  window.__mountProfileMenu = options => { const instance = { ...options, destroyed: false, destroy() { this.destroyed = true; } }; menus.push(instance); return instance; };
  window.__mountToolsMenu = options => { const instance = { ...options, destroyed: false, destroy() { this.destroyed = true; } }; toolsMenus.push(instance); return instance; };
  window.__mountBanner = () => { banners++; };
  window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  window.eval(source
    .replace(/^import .*test-session\.js.*;$/m, 'const mountTestSessionBanner = window.__mountBanner;')
    .replace(/^import .*profile-menu\.js.*;$/m, 'const mountProfileMenu = window.__mountProfileMenu;')
    .replace(/^import .*tools-menu\.js.*;$/m, 'const mountToolsMenu = window.__mountToolsMenu;')
    .replace('import.meta.env?.DEV', String(dev))
    .replace(/^export /gm, '') + '\nwindow.mountNavigation = mountNavigation;');
  return {
    window,
    mount: window.mountNavigation,
    link: label => [...window.document.querySelectorAll('.nav-links a, .nav-links button')].find(a => a.querySelector('.nav-label').textContent === label),
    flush: () => { while (frames.length) frames.shift()(); },
    get banners() { return banners; },
    menus,
    toolsMenus,
  };
}

test('athlete navigation keeps the same Athlètes destination and Menu as a coach', () => {
  const ui = navigation('https://example.test/boxing/planning.html');
  try {
    assert.equal(ui.banners, 1, 'return-to-admin banner can mount before account loading');
    ui.mount({ role: 'athlete', isAdmin: false });
    assert.deepEqual([...ui.window.document.querySelectorAll('.nav-label')].map(el => el.textContent), ['Calendrier', 'Journal', 'Athlètes', 'Outils', 'Menu']);
    assert.equal(ui.link('Athlètes').href, 'https://example.test/boxing/roster.html');
    assert.equal(ui.link('Mes coachs'), undefined);
    assert.equal(ui.link('Menu').tagName, 'BUTTON');
    assert.equal(ui.link('Outils').tagName, 'BUTTON');
    assert.equal(ui.link('Calendrier').getAttribute('aria-current'), 'page');
    assert.equal(ui.window.document.body.dataset.accountRole, 'athlete');
    assert.equal(ui.link('Administration'), undefined);
  } finally { ui.window.happyDOM.abort(); }
});

test('profile menu keeps its existing navigation position and replaces its prior mount', () => {
  const ui = navigation('https://example.test/boxing/groups.html?demo=athlete');
  try {
    ui.mount({ role: 'athlete' });
    assert.equal(ui.link('Menu').hasAttribute('aria-current'), false);
    assert.equal(ui.menus[0].trigger, ui.link('Menu'));
    assert.equal(ui.menus[0].route('groups.html'), 'https://example.test/boxing/groups.html?demo=athlete');
    assert.equal(ui.menus[0].route('planning.html#coachs'), 'https://example.test/boxing/planning.html?demo=athlete#coachs');
    ui.mount({ role: 'athlete' });
    assert.equal(ui.menus[0].destroyed, true);
    assert.equal(ui.menus[1].destroyed, false);
    assert.equal(ui.toolsMenus[0].destroyed, true);
    assert.equal(ui.toolsMenus[1].destroyed, false);
  } finally { ui.window.happyDOM.abort(); }
});

test('admin navigation resolves routes correctly from the nested administration page', () => {
  const ui = navigation('https://example.test/boxing/admin/');
  try {
    ui.mount({ role: 'coach', isAdmin: true });
    assert.equal(ui.link('Athlètes').href, 'https://example.test/boxing/roster.html');
    assert.equal(ui.link('Mes listes'), undefined);
    assert.deepEqual([...ui.window.document.querySelectorAll('.nav-label')].map(el => el.textContent), ['Calendrier', 'Journal', 'Athlètes', 'Outils', 'Menu']);
    assert.equal(ui.link('Menu').tagName, 'BUTTON');
    assert.equal(ui.link('Administration'), undefined);
    assert.equal(ui.link('Menu').getAttribute('aria-current'), 'page');
    assert.equal(ui.menus[0].isAdmin, true);
    assert.equal(ui.menus[0].route('admin/'), 'https://example.test/boxing/admin/');
    ui.mount({ role: 'coach', isAdmin: true });
    assert.equal(ui.window.document.querySelectorAll('#primaryNavigation').length, 1);
  } finally { ui.window.happyDOM.abort(); }
});

test('coach navigation has one athlete entry and keeps old list URLs on that table', () => {
  for (const path of ['/boxing/roster.html', '/boxing/roster.html?liste=1']) {
    const ui = navigation(`https://example.test${path}`);
    try {
      ui.mount({ role: 'coach', isAdmin: false });
      assert.deepEqual([...ui.window.document.querySelectorAll('.nav-label')].map(el => el.textContent), ['Calendrier', 'Journal', 'Athlètes', 'Outils', 'Menu']);
      assert.equal(ui.link('Athlètes').href, 'https://example.test/boxing/roster.html');
      assert.equal(ui.link('Athlètes').getAttribute('aria-current'), 'page');
      assert.equal(ui.window.document.querySelectorAll('[aria-current="page"]').length, 1);
      assert.equal(ui.link('Mes listes'), undefined);
    } finally { ui.window.happyDOM.abort(); }
  }
});

test('obsolete list query cannot mark the roster active on another page', () => {
  for (const [path, active] of [['planning.html?liste=1', 'Calendrier'], ['profile.html?liste=1', 'Menu'], ['admin/?liste=1', 'Menu']]) {
    const ui = navigation(`https://example.test/boxing/${path}`);
    try {
      ui.mount({ role: 'coach', isAdmin: true });
      const hasCurrent = active !== 'Menu' || path.startsWith('admin/');
      assert.equal(ui.link(active).getAttribute('aria-current'), hasCurrent ? 'page' : null);
      assert.equal(ui.link('Athlètes').hasAttribute('aria-current'), false);
      assert.equal(ui.window.document.querySelectorAll('[aria-current="page"]').length, hasCurrent ? 1 : 0);
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
      const profile = ui.link(role === 'coach' ? 'Menu' : 'Menu');
      assert.equal(profile.tagName, 'BUTTON');
      assert.equal(profile.title, '');
      assert.equal(ui.link('Athlètes').href, 'https://example.test/boxing/roster.html');
    } finally { ui.window.happyDOM.abort(); }
  });
}

test('production does not present a demo query as an active isolated preview', () => {
  const ui = navigation('https://example.test/boxing/planning.html?demo=coach', { dev: false });
  try {
    ui.mount({ role: 'coach', isAdmin: false });
    assert.equal(ui.link('Calendrier').href, 'https://example.test/boxing/planning.html');
    assert.equal(ui.link('Menu').title, '');
    assert.equal(ui.window.document.querySelector('.nav-identity').href, 'https://example.test/boxing/planning.html');
  } finally { ui.window.happyDOM.abort(); }
});

test('the coaches deep link opens once and preserves the preview and selected athlete when consumed', () => {
  const ui = navigation('https://example.test/boxing/planning.html?demo=athlete&athlete=athlete-2#coachs');
  try {
    let opened = 0;
    ui.window.addEventListener('connections:open', event => { assert.equal(event.detail.personal, true); opened++; });
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
    assert.equal(ui.link('Mes coachs'), undefined, 'the relation entry belongs only to Menu');
    assert.equal(ui.window.location.hash, '');
  } finally { ui.window.happyDOM.abort(); }
});

test('authenticated headers no longer add a duplicate connections shortcut',()=>{
 for(const [path,actionsClass] of [['profile.html?athlete=other','top-actions'],['roster.html?athlete=other','topbar-actions'],['groups.html','top-actions'],['tools.html','top-actions'],['admin/?athlete=other','top-actions']]) {
  const ui=navigation(`https://example.test/boxing/${path}`);
  try {
   const doc=ui.window.document;
   doc.body.innerHTML=`<header class="topbar"><a class="brand">Mon gym</a><nav class="${actionsClass}"><button class="appearance-toggle" id="appearanceToggle"></button><button id="logoutButton">Déconnexion</button></nav></header>`;
   ui.mount({role:'coach',isAdmin:true});ui.mount({role:'coach',isAdmin:true});
   assert.equal(doc.getElementById('connectionsButton'),null);
   assert.equal(doc.getElementById('logoutButton').previousElementSibling.id,'appearanceToggle');
  }finally{ui.window.happyDOM.abort();}
 }
});

test('the legacy calendar connections control is retained for listeners but hidden from interaction', () => {
  const ui = navigation('https://example.test/boxing/planning.html');
  try {
    const button = ui.window.document.createElement('button'); button.id = 'connectionsButton';
    ui.window.document.body.append(button); let calls = 0; button.onclick = () => { calls++; };
    ui.mount({ role: 'athlete' });
    assert.equal(button.hidden, true); assert.equal(button.getAttribute('aria-hidden'), 'true'); assert.equal(button.tabIndex, -1);
    button.click(); assert.equal(calls, 1);
  } finally { ui.window.happyDOM.abort(); }
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


test('tools menu is active for both roles and keeps direct local previews isolated across routes', () => {
  for (const role of ['coach', 'athlete']) {
    const ui = navigation(`https://example.test/boxing/tools.html?demo=${role}`);
    try {
      ui.mount({ role });
      assert.equal(ui.link('Outils').getAttribute('aria-current'), 'page');
      assert.equal(ui.link('Outils').tagName, 'BUTTON');
      assert.equal(ui.link('Outils').hasAttribute('href'), false);
      assert.equal(ui.toolsMenus[0].trigger, ui.link('Outils'));
      assert.equal(ui.toolsMenus[0].route('tools.html?tool=boxing'), `https://example.test/boxing/tools.html?tool=boxing&demo=${role}`);
      assert.equal(ui.toolsMenus[0].route('tools.html?tool=cognitive&game=tiles'), `https://example.test/boxing/tools.html?tool=cognitive&game=tiles&demo=${role}`);
      assert.equal(ui.link('Calendrier').href, `https://example.test/boxing/planning.html?demo=${role}`);
      assert.equal(ui.link('Outils').title, '');
      assert.ok(ui.link('Outils').querySelector('svg[aria-hidden="true"]'));
      assert.equal(ui.window.document.querySelectorAll('[aria-current="page"]').length, 1);
    } finally { ui.window.happyDOM.abort(); }
  }
});


test('mobile navigation orders actual focusable nodes and restores the desktop order on resize', () => {
  const ui = navigation('https://example.test/boxing/planning.html');
  const labels = () => [...ui.window.document.querySelectorAll('.nav-label')].map(node => node.textContent);
  try {
    ui.window.happyDOM.setInnerWidth(390); ui.mount({ role: 'coach', isAdmin: true });
    // Happy DOM initializes media-query listeners to false; synchronize their first state.
    ui.window.dispatchEvent(new ui.window.Event('resize'));
    assert.deepEqual(labels(), ['Menu', 'Outils', 'Calendrier', 'Journal', 'Athlètes']);
    assert.equal(ui.link('Administration'), undefined);
    const tools = ui.link('Outils'); tools.focus();
    ui.window.happyDOM.setInnerWidth(1440);
    assert.deepEqual(labels(), ['Calendrier', 'Journal', 'Athlètes', 'Outils', 'Menu']);
    assert.equal(ui.link('Outils'), tools); assert.equal(ui.window.document.activeElement, tools);
    ui.mount({ role: 'athlete', isAdmin: false });
    ui.window.happyDOM.setInnerWidth(320);
    assert.deepEqual(labels(), ['Menu', 'Outils', 'Calendrier', 'Journal', 'Athlètes']);
    assert.equal(ui.menus.at(-1).isAdmin, false);
    assert.equal(ui.window.document.querySelectorAll('#primaryNavigation').length, 1);
  } finally { ui.window.happyDOM.abort(); }
});

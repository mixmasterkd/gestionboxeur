import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { createMenuPanelLayout } from '../js/menu-panel-layout.js';
import { TOOL_MENU_ITEMS } from '../js/tool-catalog.js';

const source = await readFile(new URL('../js/tools-menu.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');
const profileSource = await readFile(new URL('../js/profile-menu.js', import.meta.url), 'utf8');

function fixture({ url = 'https://example.test/boxing/planning.html', width = 390, height = 844 } = {}) {
  const window = new Window({ url, width, height });
  window.createMenuPanelLayout = createMenuPanelLayout;
  const doc = window.document;
  doc.body.innerHTML = '<nav id="primaryNavigation"><button id="toolsTrigger">Outils</button><button id="profileTrigger">Menu</button></nav><button id="outside">Contenu de page</button>';
  const nav = doc.getElementById('primaryNavigation'), trigger = doc.getElementById('toolsTrigger');
  nav.getBoundingClientRect = () => ({ top: width <= 800 ? height - 80 : 0, right: width <= 800 ? width : 220 });
  trigger.getBoundingClientRect = () => ({ top: width <= 800 ? height - 72 : 670, right: width <= 800 ? width * .8 : 204 });
  window.__items = TOOL_MENU_ITEMS;
  window.eval(uiSource.replace(/^export /gm, '') + '\nwindow.__ui = {el,button,displayName};');
  window.eval('{ const TOOL_MENU_ITEMS=window.__items; const {el,button}=window.__ui; ' + source.replace(/^import .*;\n/gm, '').replace(/^export /gm, '') + '\nwindow.__mountToolsMenu=mountToolsMenu; }');
  const route = path => {
    const result = new URL(path, new URL('./', window.location.href));
    const demo = new URLSearchParams(window.location.search).get('demo');
    if (demo) result.searchParams.set('demo', demo);
    return result.href;
  };
  const mounted = window.__mountToolsMenu({ trigger, route });
  const dialog = doc.getElementById('toolsMenuDialog');
  dialog.getBoundingClientRect = () => ({ height: Math.min(650, Number.parseFloat(dialog.style.maxHeight) || 650), width: Number.parseFloat(dialog.style.width) || 320 });
  let profile;
  return {
    window, doc, trigger, dialog, mounted, route,
    link: id => dialog.querySelector(`[data-tool-menu-item="${id}"]`),
    selection: detail => window.dispatchEvent(new window.CustomEvent('tools:selection', { detail })),
    mountProfile() {
      window.eval(`{ const {el,button,displayName}=window.__ui;
        const client={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};
        const prepareMenuInstall=()=>{},isAppInstalled=()=>false,openInstall=()=>{};
        const loadGroups=async()=>[],loadNotifications=async()=>[],command=async()=>{},rpc=async()=>[],loadAccount=async()=>({});
        ${profileSource.replace(/^import .*;\n/gm, '').replace(/^export /gm, '')}
        window.__mountProfile=mountProfileMenu;
      }`);
      profile = window.__mountProfile({ trigger: doc.getElementById('profileTrigger'), route });
      return doc.getElementById('profileMenuDialog');
    },
    async destroy() { mounted.destroy(); profile?.destroy(); await window.happyDOM.abort(); },
  };
}

test('catalog exposes ten direct destinations with icons and no intermediate cognitive destination', () => {
  assert.equal(TOOL_MENU_ITEMS.length, 10);
  assert.equal(new Set(TOOL_MENU_ITEMS.map(item => item.id)).size, 10);
  assert.deepEqual(TOOL_MENU_ITEMS.filter(item => item.game).map(item => item.game), ['tiles', 'bag', 'visual-memory', 'reaction', 'dual-task']);
  for (const item of TOOL_MENU_ITEMS) {
    assert.match(item.icon, /^<svg /); assert.match(item.icon, /aria-hidden="true"/);
    assert.equal('description' in item, false);
  }
});

test('the popup lists each direct tool route, preserves demo and groups games with a nonclickable label', async () => {
  const f = fixture({ url: 'https://example.test/boxing/profile.html?demo=athlete' });
  try {
    f.trigger.click();
    assert.equal(f.dialog.open, true);
    assert.equal(f.trigger.getAttribute('aria-expanded'), 'true'); assert.equal(f.trigger.classList.contains('is-open'), true);
    assert.equal(f.doc.activeElement.id, 'toolsMenuTitle');
    assert.equal(f.dialog.querySelectorAll('a').length, 10);
    assert.equal(f.dialog.querySelector('.tools-menu-section').tagName, 'P');
    assert.equal(f.dialog.querySelector('.tools-menu-section').textContent, 'Jeux cognitifs');
    for (const item of TOOL_MENU_ITEMS) {
      const link = f.link(item.id), url = new URL(link.href);
      assert.equal(link.textContent, item.title); assert.ok(link.querySelector('svg'));
      assert.equal(url.pathname, '/boxing/tools.html'); assert.equal(url.searchParams.get('demo'), 'athlete');
      assert.equal(url.searchParams.get('tool'), item.tool); assert.equal(url.searchParams.get('game'), item.game || null);
    }
    f.trigger.click(); assert.equal(f.dialog.open, false); assert.equal(f.doc.activeElement, f.trigger);
  } finally { await f.destroy(); }
});

test('same-page clicks request a direct tool without reloading or preempting confirmed selection', async () => {
  const f = fixture({ url: 'https://example.test/boxing/tools.html?tool=boxing&demo=coach' });
  const requests = [];
  f.window.addEventListener('tools:navigate', event => requests.push(JSON.parse(JSON.stringify(event.detail))));
  try {
    assert.equal(f.link('boxing').getAttribute('aria-current'), 'page');
    f.trigger.click();
    const click = new f.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    f.link('visual-memory').dispatchEvent(click);
    assert.equal(click.defaultPrevented, true); assert.deepEqual(requests, [{ tool: 'cognitive', game: 'visual-memory' }]);
    assert.equal(f.dialog.open, false); assert.equal(f.doc.activeElement, f.trigger);
    assert.equal(f.link('boxing').getAttribute('aria-current'), 'page', 'a refused navigation keeps the real selection');
    assert.equal(f.window.location.search, '?tool=boxing&demo=coach');
    f.selection({ tool: 'cognitive', game: 'visual-memory' });
    assert.equal(f.link('boxing').hasAttribute('aria-current'), false); assert.equal(f.link('visual-memory').getAttribute('aria-current'), 'page');
    f.selection({ tool: null }); assert.equal(f.dialog.querySelector('[aria-current]'), null);
  } finally { await f.destroy(); }
});

test('modified clicks retain normal link behavior and outside focus, taps and Escape close the popup', async () => {
  const f = fixture({ url: 'https://example.test/boxing/tools.html' });
  let navigations = 0; f.window.addEventListener('tools:navigate', () => { navigations++; });
  try {
    f.trigger.click();
    const modified = new f.window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 });
    f.link('tiles').dispatchEvent(modified);
    assert.equal(modified.defaultPrevented, false); assert.equal(navigations, 0); assert.equal(f.dialog.open, true);
    f.doc.getElementById('outside').dispatchEvent(new f.window.PointerEvent('pointerdown', { bubbles: true }));
    assert.equal(f.dialog.open, false);
    f.trigger.click(); f.doc.getElementById('outside').focus(); assert.equal(f.dialog.open, false);
    f.trigger.click();
    const ignored = new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); ignored.preventDefault(); f.doc.dispatchEvent(ignored);
    assert.equal(f.dialog.open, true);
    f.doc.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(f.dialog.open, false); assert.equal(f.doc.activeElement, f.trigger);
  } finally { await f.destroy(); }
});

test('opening Menu and Outils in either order never leaves both panels open', async () => {
  const f = fixture();
  try {
    const profile = f.mountProfile(), trigger = f.doc.getElementById('profileTrigger');
    trigger.click(); assert.equal(profile.open, true);
    f.trigger.click(); assert.equal(profile.open, false); assert.equal(f.dialog.open, true);
    trigger.click(); assert.equal(profile.open, true); assert.equal(f.dialog.open, false);
    f.mounted.open(); assert.equal(profile.open, false); assert.equal(f.dialog.open, true);
  } finally { await f.destroy(); }
});

test('mobile drawer and desktop popup stay inside short or large viewports', async () => {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 900]]) {
    const f = fixture({ width, height });
    try {
      f.trigger.click();
      const left = parseFloat(f.dialog.style.left), top = parseFloat(f.dialog.style.top), panel = f.dialog.getBoundingClientRect();
      if (width <= 800) {
        assert.equal(left, 0); assert.equal(top, 0);
        assert.equal(parseFloat(f.dialog.style.height), height);
        assert.ok(panel.width < width && panel.width >= width - 48);
        assert.equal(f.doc.body.classList.contains('menu-drawer-open'), true);
      } else {
        assert.ok(left >= 8); assert.ok(left + panel.width <= width - 8);
        assert.ok(top >= 8); assert.ok(top + panel.height <= height - 8);
        assert.ok(parseFloat(f.dialog.style.maxHeight) <= height - 16);
        assert.equal(f.doc.body.classList.contains('menu-drawer-open'), false);
      }
      assert.equal(f.dialog.querySelector('.tools-menu-close'), null);
    } finally { await f.destroy(); }
  }
});

test('teardown removes handlers and allows a clean remount with the latest URL selection', async () => {
  const f = fixture({ url: 'https://example.test/boxing/tools.html?tool=cognitive&game=bag' });
  try {
    assert.equal(f.link('bag').getAttribute('aria-current'), 'page');
    f.trigger.click(); f.mounted.destroy();
    assert.equal(f.trigger.getAttribute('aria-expanded'), 'false'); assert.equal(f.doc.getElementById('toolsMenuDialog'), null);
    f.trigger.click(); assert.equal(f.doc.getElementById('toolsMenuDialog'), null);
    const next = f.window.__mountToolsMenu({ trigger: f.trigger, route: f.route });
    try {
      f.trigger.click(); assert.equal(f.doc.querySelectorAll('#toolsMenuDialog[open]').length, 1);
      assert.equal(f.doc.querySelector('[data-tool-menu-item="bag"]').getAttribute('aria-current'), 'page');
    } finally { next.destroy(); }
  } finally { await f.destroy(); }
});

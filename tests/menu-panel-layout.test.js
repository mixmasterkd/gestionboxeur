import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createMenuPanelLayout } from '../js/menu-panel-layout.js';

function fixture({ width = 390, height = 844, viewport } = {}) {
  const window = new Window({ width, height });
  const doc = window.document;
  doc.body.innerHTML = '<header id="header">En-tête</header><main id="content"><button id="action">Action de page</button></main><nav id="primaryNavigation"><button id="trigger">Menu</button></nav><a class="skip-link" href="#content">Aller au contenu</a><div class="app-toast" role="status">Information</div><div class="toast" role="status">Information</div><div id="hidden" hidden></div><div id="displayNone" style="display:none"></div><div id="visibilityHidden" style="visibility:hidden"></div><dialog id="other"></dialog><script type="application/json">{}</script><style></style><link rel="stylesheet"><template></template><dialog id="menu"></dialog>';
  if (viewport) Object.defineProperty(window, 'visualViewport', { value: viewport });
  const dialog = doc.getElementById('menu'), trigger = doc.getElementById('trigger');
  const anchor = { top: height - 60, right: 204 }, nav = { right: 220 };
  trigger.getBoundingClientRect = () => anchor;
  doc.getElementById('primaryNavigation').getBoundingClientRect = () => nav;
  dialog.getBoundingClientRect = () => ({ width: parseFloat(dialog.style.width) || 320, height: Math.min(620, parseFloat(dialog.style.maxHeight) || 620) });
  let dismissals = 0;
  const layout = createMenuPanelLayout({ dialog, trigger, onDismiss() { dismissals++; dialog.close(); layout.close(); } });
  return {
    window, doc, dialog, trigger, anchor, nav, layout,
    get dismissals() { return dismissals; },
    open() { dialog.show(); layout.position(); },
    async destroy() { layout.destroy(); await window.happyDOM.abort(); },
  };
}

test('mobile drawers leave a bounded right strip and shift only visible page children', async () => {
  for (const [width, height] of [[320, 568], [390, 844], [800, 600]]) {
    const f = fixture({ width, height });
    try {
      f.open();
      const panelWidth = parseFloat(f.dialog.style.width), strip = width - panelWidth;
      assert.ok(strip >= 28 && strip <= 48);
      assert.equal(f.dialog.style.left, '0px'); assert.equal(f.dialog.style.top, '0px');
      assert.ok([`${height}px`, '100dvh'].includes(f.dialog.style.height)); assert.equal(f.dialog.style.maxHeight, `${height}px`);
      assert.equal(f.doc.body.classList.contains('menu-drawer-open'), true);
      assert.equal(f.doc.body.style.getPropertyValue('--menu-drawer-width'), `${panelWidth}px`);
      assert.deepEqual([...f.doc.querySelectorAll('.menu-drawer-shift')].map(node => node.id), ['header', 'content', 'primaryNavigation']);
      const dismiss = f.doc.querySelector('.menu-drawer-dismiss');
      assert.equal(dismiss.tagName, 'BUTTON'); assert.equal(dismiss.type, 'button');
      assert.equal(dismiss.getAttribute('aria-label'), 'Fermer le menu');
      assert.equal(dismiss.getAttribute('aria-controls'), 'menu');
      assert.equal(f.doc.getElementById('content').hasAttribute('style'), false, 'page content receives no inline transform');
      assert.equal(f.doc.getElementById('content').inert, false);
      f.layout.position();
      assert.equal(f.doc.querySelectorAll('.menu-drawer-dismiss').length, 1);
    } finally { await f.destroy(); }
  }
});

test('desktop panels fit the viewport beside the rail even in a short landscape viewport', async () => {
  for (const [width, height] of [[844, 390], [1440, 900]]) {
    const f = fixture({ width, height });
    try {
      f.open();
      const bounds = f.dialog.getBoundingClientRect(), left = parseFloat(f.dialog.style.left), top = parseFloat(f.dialog.style.top);
      assert.equal(bounds.width, 320); assert.equal(left, 228);
      assert.ok(top >= 8); assert.ok(top + bounds.height <= height - 8);
      assert.equal(f.dialog.style.height, 'auto');
      assert.equal(f.doc.querySelector('.menu-drawer-dismiss'), null);
      assert.equal(f.doc.body.classList.contains('menu-drawer-open'), false);
      f.nav.right = width - 10; f.anchor.top = -100; f.layout.position();
      assert.equal(parseFloat(f.dialog.style.left) + bounds.width, width - 8);
      assert.equal(f.dialog.style.top, '8px');
    } finally { await f.destroy(); }
  }
});

test('desktop geometry respects a smaller offset visual viewport and mobile height follows its visible area', async () => {
  const f = fixture({ width: 1440, height: 900, viewport: { width: 600, height: 360, offsetLeft: 30, offsetTop: 40 } });
  try {
    f.open();
    assert.equal(f.dialog.style.maxHeight, '344px'); assert.equal(f.dialog.style.top, '48px');
    assert.ok(parseFloat(f.dialog.style.left) >= 38);
    assert.ok(parseFloat(f.dialog.style.left) + 320 <= 622);
    f.window.innerWidth = 390;
    Object.assign(f.window.visualViewport, { width: 390, height: 410, offsetLeft: 0, offsetTop: 0 });
    f.layout.position();
    assert.equal(f.dialog.style.maxHeight, '410px');
    assert.ok(['410px', '100dvh'].includes(f.dialog.style.height));
  } finally { await f.destroy(); }
});

test('resizing to desktop restores the page before measuring the trigger, and closing restores original inline styles', async () => {
  const f = fixture();
  try {
    f.open();
    f.trigger.getBoundingClientRect = () => {
      assert.equal(f.doc.body.classList.contains('menu-drawer-open'), false);
      assert.equal(f.doc.getElementById('primaryNavigation').classList.contains('menu-drawer-shift'), false);
      return { top: 400, right: 204 };
    };
    f.window.innerWidth = 1200;
    f.layout.position();
    assert.equal(f.dialog.style.width, '320px'); assert.equal(f.dialog.style.height, 'auto');
    assert.equal(f.doc.querySelector('.menu-drawer-dismiss'), null);
    assert.equal(f.doc.body.style.getPropertyValue('--menu-drawer-width'), '');
    f.dialog.close(); f.layout.close();
    assert.equal(f.dialog.style.cssText, '');
    assert.equal(f.doc.querySelector('.menu-drawer-shift'), null);
  } finally { await f.destroy(); }
});

test('the right strip closes once without dispatching page actions or outside pointer/focus handlers', async () => {
  const f = fixture();
  let actions = 0, outsidePointers = 0, outsideFocus = 0, outsideClicks = 0;
  try {
    f.doc.getElementById('action').addEventListener('click', () => actions++);
    f.doc.addEventListener('pointerdown', () => outsidePointers++);
    f.doc.addEventListener('focusin', () => outsideFocus++);
    f.doc.addEventListener('click', () => outsideClicks++);
    f.open();
    const dismiss = f.doc.querySelector('.menu-drawer-dismiss');
    const down = new f.window.PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    dismiss.dispatchEvent(down); dismiss.focus(); dismiss.click();
    assert.equal(down.defaultPrevented, true);
    assert.equal(f.dismissals, 1); assert.equal(f.dialog.open, false);
    assert.equal(actions, 0); assert.equal(outsidePointers, 0); assert.equal(outsideFocus, 0); assert.equal(outsideClicks, 0);
    assert.equal(f.doc.querySelector('.menu-drawer-dismiss'), null);
    assert.equal(f.doc.body.classList.contains('menu-drawer-open'), false);
    dismiss.click(); assert.equal(f.dismissals, 1, 'a detached strip cannot dismiss a later menu');
  } finally { await f.destroy(); }
});

test('repositioning catches new visual children and drops hidden or removed shift targets', async () => {
  const f = fixture();
  try {
    f.open();
    const added = f.doc.createElement('aside'); added.id = 'added'; f.doc.body.append(added);
    const header = f.doc.getElementById('header'), content = f.doc.getElementById('content');
    header.hidden = true; content.remove(); f.layout.position();
    assert.equal(added.classList.contains('menu-drawer-shift'), true);
    assert.equal(header.classList.contains('menu-drawer-shift'), false);
    assert.equal(content.classList.contains('menu-drawer-shift'), false);
    f.dialog.close(); f.layout.position();
    assert.equal(added.classList.contains('menu-drawer-shift'), false);
    assert.equal(f.doc.querySelector('.menu-drawer-dismiss'), null);
  } finally { await f.destroy(); }
});

test('menu switching and late cleanup cannot remove the new drawer state', async () => {
  const f = fixture();
  const secondDialog = f.doc.getElementById('other');
  const second = createMenuPanelLayout({ dialog: secondDialog, trigger: f.trigger, onDismiss() {} });
  try {
    f.open(); secondDialog.show(); second.position();
    assert.equal(f.doc.querySelectorAll('.menu-drawer-dismiss').length, 1);
    assert.equal(f.doc.querySelector('.menu-drawer-dismiss').getAttribute('aria-controls'), 'other');
    f.dialog.close(); f.layout.close();
    assert.equal(f.doc.body.classList.contains('menu-drawer-open'), true);
    assert.equal(f.doc.getElementById('content').classList.contains('menu-drawer-shift'), true);
    secondDialog.close(); second.close();
    assert.equal(f.doc.querySelector('.menu-drawer-dismiss'), null);
    assert.equal(f.doc.querySelector('.menu-drawer-shift'), null);
    assert.equal(f.doc.body.style.getPropertyValue('--menu-drawer-width'), '');
  } finally { second.destroy(); await f.destroy(); }
});

test('close and destroy preserve existing classes and CSS variables and are safe when repeated', async () => {
  const f = fixture();
  try {
    f.doc.body.classList.add('menu-drawer-open');
    f.doc.body.style.setProperty('--menu-drawer-width', '12px', 'important');
    const content = f.doc.getElementById('content'); content.classList.add('menu-drawer-shift');
    f.open(); f.layout.destroy(); f.layout.destroy(); f.layout.close(); f.layout.position();
    assert.equal(f.doc.body.classList.contains('menu-drawer-open'), true);
    assert.equal(f.doc.body.style.getPropertyValue('--menu-drawer-width'), '12px');
    assert.equal(f.doc.body.style.getPropertyPriority('--menu-drawer-width'), 'important');
    assert.equal(content.classList.contains('menu-drawer-shift'), true);
    assert.equal(f.doc.getElementById('header').classList.contains('menu-drawer-shift'), false);
    assert.equal(f.doc.querySelector('.menu-drawer-dismiss'), null);
  } finally { await f.destroy(); }
});

test('closing preserves a CSS variable changed independently while the drawer was open', async () => {
  const f = fixture();
  try {
    f.open();
    f.doc.body.style.setProperty('--menu-drawer-width', '20px');
    f.layout.close();
    assert.equal(f.doc.body.style.getPropertyValue('--menu-drawer-width'), '20px');
  } finally { await f.destroy(); }
});

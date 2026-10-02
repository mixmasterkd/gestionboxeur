import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { appInstallInstructions, mountAppInstall } from '../js/app-install.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture({ hasHost = true, userAgent = '', platform = '', maxTouchPoints = 0, standalone = false, mode = null, fallback = false } = {}) {
  const window = new Window({ url: 'https://example.test/profile.html' });
  const doc = window.document;
  doc.body.innerHTML = `<button id="before">Avant</button>${hasHost ? '<div id="appInstallMount"></div>' : ''}<button id="after">Après</button>`;
  for (const [key, value] of Object.entries({ userAgent, platform, maxTouchPoints, standalone })) Object.defineProperty(window.navigator, key, { configurable: true, value });
  const queries = new Map();
  window.matchMedia = query => {
    if (!queries.has(query)) {
      const media = new window.EventTarget(); media.matches = query === `(display-mode: ${mode})`;
      media.set = value => { media.matches = value; media.dispatchEvent(new window.Event('change')); };
      queries.set(query, media);
    }
    return queries.get(query);
  };
  if (fallback) window.HTMLDialogElement.prototype.showModal = undefined;
  const ui = mountAppInstall({ doc, view: window });
  const $ = selector => doc.querySelector(selector);
  return { window, doc, ui, $, queries,
    prompt(fn, choice) {
      const event = new window.Event('beforeinstallprompt', { cancelable: true }); event.prompt = fn;
      if (choice) event.userChoice = choice;
      window.dispatchEvent(event); return event;
    },
    async close() { ui?.destroy(); await window.happyDOM.abort(); },
  };
}

test('only mounts inside the explicit install container and does not create a banner', async () => {
  const missing = fixture({ hasHost: false });
  try {
    assert.equal(missing.ui, null); assert.equal(missing.$('#appInstallButton'), null); assert.equal(missing.$('dialog'), null);
    assert.equal(missing.prompt(() => {}).defaultPrevented, false);
  } finally { await missing.close(); }
  const app = fixture();
  try {
    assert.equal(app.$('#appInstallButton').parentElement.id, 'appInstallMount');
    assert.equal(app.$('#appInstallButton').textContent, 'Installer GBoxeur');
    assert.equal(app.$('#appInstallButton').type, 'button');
    assert.equal(app.$('#appInstallDialog').open, false);
    assert.equal(app.$('.app-install-backdrop').hidden, true);
  } finally { await app.close(); }
});

test('login installation is a text action alongside unchanged auth actions and respects their hidden states', async () => {
  const html = await readFile(new URL('../login.html', import.meta.url), 'utf8');
  const window = new Window({ url: 'https://example.test/login.html', settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  window.document.write(html);
  const doc = window.document, toggle = doc.getElementById('authToggle'), forgot = doc.getElementById('forgotPassword'), continuation = doc.getElementById('continueButton');
  let ui;
  try {
    const host = doc.getElementById('appInstallMount');
    assert.equal(host.parentElement, toggle.parentElement); assert.equal(host.parentElement, forgot.parentElement);
    assert.equal(host.closest('form'), null); assert.equal(doc.querySelectorAll('#appInstallMount').length, 1);
    assert.equal(host.dataset.installAppearance, 'link'); assert.equal(continuation.classList.contains('hidden'), true);
    forgot.classList.add('hidden'); toggle.textContent = 'Retour à la connexion';
    ui = mountAppInstall({ doc, view: window });
    const button = doc.getElementById('appInstallButton');
    assert.equal(button.classList.contains('link-button'), true); assert.equal(button.classList.contains('button'), false);
    assert.equal(forgot.classList.contains('hidden'), true); assert.equal(toggle.textContent, 'Retour à la connexion'); assert.equal(continuation.classList.contains('hidden'), true);
    window.dispatchEvent(new window.Event('appinstalled'));
    assert.equal(host.hidden, true); assert.equal(toggle.hidden, false); assert.equal(forgot.classList.contains('hidden'), true);
  } finally { ui?.destroy(); await window.happyDOM.abort(); }
});

test('profile Application section is compact and entirely hidden after installation or in standalone mode', async () => {
  const html = await readFile(new URL('../profile.html', import.meta.url), 'utf8');
  for (const standalone of [false, true]) {
    const window = new Window({ url: 'https://example.test/profile.html', settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
    window.document.write(html); Object.defineProperty(window.navigator, 'standalone', { value: standalone });
    const doc = window.document, section = doc.querySelector('[data-app-install-section]');
    assert.equal(section.hidden, true); assert.equal(section.querySelector('h2').textContent, 'Application');
    assert.ok(doc.getElementById('enableCoachingButton')); assert.ok(doc.getElementById('resetPasswordButton'));
    const ui = mountAppInstall({ doc, view: window });
    try {
      assert.equal(section.hidden, standalone);
      assert.equal(doc.getElementById('appInstallButton').classList.contains('secondary'), true);
      window.dispatchEvent(new window.Event('appinstalled'));
      assert.equal(section.hidden, true); assert.equal(doc.getElementById('appInstallMount').hidden, true);
      assert.ok(doc.getElementById('enableCoachingButton')); assert.ok(doc.getElementById('resetPasswordButton'));
    } finally { ui.destroy(); await window.happyDOM.abort(); }
  }
});

test('instructions identify iPhone, iPad desktop mode, Android, Safari Mac and desktop', () => {
  assert.equal(appInstallInstructions({ userAgent: 'iPhone Safari' }).platform, 'ios');
  assert.equal(appInstallInstructions({ userAgent: 'Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 5 }).platform, 'ios');
  assert.equal(appInstallInstructions({ userAgent: 'Mozilla Android Chrome' }).platform, 'android');
  assert.equal(appInstallInstructions({ userAgent: 'Macintosh Version/26 Safari/605' }).platform, 'mac-safari');
  assert.equal(appInstallInstructions({ userAgent: 'Macintosh Chrome/130 Safari/537' }).platform, 'desktop');
  assert.equal(appInstallInstructions({ userAgent: 'Windows Chrome', platform: 'Win32', maxTouchPoints: 10 }).platform, 'desktop');
  assert.equal(appInstallInstructions().platform, 'desktop');
});

test('manual instructions open only on click, close with focus restoration, and trap keyboard focus', async () => {
  const app = fixture({ userAgent: 'iPhone Safari' });
  try {
    const button = app.$('#appInstallButton'), dialog = app.$('#appInstallDialog'); button.focus(); button.click();
    assert.equal(dialog.open, true); assert.equal(dialog.dataset.platform, 'ios');
    assert.equal(dialog.getAttribute('aria-labelledby'), 'appInstallTitle');
    assert.match(app.$('#appInstallSteps').textContent, /Safari/); assert.match(app.$('#appInstallSteps').textContent, /Partager/);
    assert.match(dialog.textContent, /connexion Internet reste nécessaire/);
    const close = app.$('.app-install-close'), done = app.$('.app-install-done');
    assert.equal(app.doc.activeElement, close);
    app.doc.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert.equal(app.doc.activeElement, done);
    app.doc.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(app.doc.activeElement, close);
    app.doc.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(dialog.open, false); assert.equal(app.doc.activeElement, button);
    button.click(); done.click(); assert.equal(dialog.open, false); assert.equal(app.doc.activeElement, button);
    button.click(); dialog.dispatchEvent(new app.window.Event('cancel', { cancelable: true })); assert.equal(dialog.open, false);
  } finally { await app.close(); }
});

test('native install prompt is invoked synchronously once per event without opening help on dismissal', async () => {
  const app = fixture();
  try {
    let count = 0, release;
    const event = app.prompt(() => { count++; return new Promise(resolve => { release = resolve; }); });
    assert.equal(event.defaultPrevented, true);
    const button = app.$('#appInstallButton'); button.click(); button.click();
    assert.equal(count, 1); assert.equal(button.disabled, true); assert.equal(app.$('#appInstallDialog').open, false);
    release({ outcome: 'dismissed' }); await flush();
    assert.equal(button.disabled, false); assert.equal(app.$('#appInstallDialog').open, false);
    button.click(); assert.equal(app.$('#appInstallDialog').open, true); assert.equal(count, 1);
  } finally { await app.close(); }
});

test('legacy userChoice is awaited and acceptance does not falsely claim installation finished', async () => {
  const app = fixture();
  try {
    let resolveChoice;
    app.prompt(() => Promise.resolve(), new Promise(resolve => { resolveChoice = resolve; }));
    app.$('#appInstallButton').click(); await flush(); assert.equal(app.$('#appInstallButton').disabled, true);
    resolveChoice({ outcome: 'accepted' }); await flush();
    assert.equal(app.$('#appInstallMount').hidden, false); assert.equal(app.$('#appInstallButton').disabled, false);
    app.window.dispatchEvent(new app.window.Event('appinstalled'));
    assert.equal(app.$('#appInstallMount').hidden, true);
  } finally { await app.close(); }
});

test('prompt rejection falls back to helpful manual instructions without unhandled errors', async () => {
  const app = fixture({ userAgent: 'Android Chrome' });
  try {
    app.prompt(() => Promise.reject(new Error('not allowed'))); app.$('#appInstallButton').click(); await flush();
    assert.equal(app.$('#appInstallDialog').open, true); assert.equal(app.$('#appInstallDialog').dataset.platform, 'android');
    assert.equal(app.$('#appInstallNotice').hidden, false); assert.match(app.$('#appInstallNotice').textContent, /menu de ton navigateur/);
    assert.equal(app.$('#appInstallButton').disabled, false);
  } finally { await app.close(); }
});

test('standalone and appinstalled suppress the button and close open help', async () => {
  for (const options of [{ standalone: true }, { mode: 'standalone' }, { mode: 'minimal-ui' }, { mode: 'window-controls-overlay' }]) {
    const app = fixture(options);
    try { assert.equal(app.$('#appInstallMount').hidden, true); assert.equal(app.prompt(() => {}).defaultPrevented, false); } finally { await app.close(); }
  }
  const app = fixture();
  try {
    app.$('#appInstallButton').click(); assert.equal(app.$('#appInstallDialog').open, true);
    const query = app.queries.get('(display-mode: standalone)'); query.set(true);
    assert.equal(app.$('#appInstallMount').hidden, true); assert.equal(app.$('#appInstallDialog').open, false);
    query.set(false); assert.equal(app.$('#appInstallMount').hidden, false);
    app.$('#appInstallButton').click(); app.window.dispatchEvent(new app.window.Event('appinstalled'));
    assert.equal(app.$('#appInstallMount').hidden, true); assert.equal(app.$('#appInstallDialog').open, false);
    query.set(false); assert.equal(app.$('#appInstallMount').hidden, true);
  } finally { await app.close(); }
});

test('fallback dialog keeps a modal role, backdrop, keyboard behavior and returns focus', async () => {
  const app = fixture({ fallback: true });
  try {
    app.$('#appInstallButton').focus(); app.$('#appInstallButton').click();
    const dialog = app.$('#appInstallDialog');
    assert.equal(dialog.open, true); assert.equal(dialog.getAttribute('role'), 'dialog'); assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.equal(app.$('.app-install-backdrop').hidden, false);
    app.$('.app-install-backdrop').click(); assert.equal(dialog.open, false); assert.equal(app.$('.app-install-backdrop').hidden, true);
    assert.equal(app.doc.activeElement, app.$('#appInstallButton'));
  } finally { await app.close(); }
});

test('mount is idempotent and destroy removes listeners and prevents late prompt updates', async () => {
  const app = fixture();
  try {
    assert.equal(mountAppInstall({ doc: app.doc, view: app.window }), app.ui);
    assert.equal(app.doc.querySelectorAll('#appInstallButton').length, 1);
    let reject;
    app.prompt(() => new Promise((_, fail) => { reject = fail; })); app.$('#appInstallButton').click(); app.ui.destroy();
    reject(new Error('late failure')); await flush();
    assert.equal(app.$('#appInstallButton'), null); assert.equal(app.$('#appInstallDialog'), null);
    assert.equal(app.prompt(() => {}).defaultPrevented, false);
    const remounted = mountAppInstall({ doc: app.doc, view: app.window }); assert.ok(remounted); assert.equal(app.doc.querySelectorAll('#appInstallButton').length, 1); remounted.destroy();
  } finally { await app.close(); }
});

test('auto-mount waits for DOM readiness, stays scoped and registers no offline system', async () => {
  const source = await readFile(new URL('../js/app-install.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /serviceWorker\s*\.\s*register|caches\s*\.|localStorage\s*\./);
  const window = new Window({ url: 'https://example.test/login.html' });
  try {
    window.document.body.innerHTML = '<div id="appInstallMount"></div>';
    window.eval(source.replace(/^export /gm, ''));
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    assert.equal(window.document.querySelectorAll('#appInstallButton').length, 1);
  } finally { await window.happyDOM.abort(); }
});

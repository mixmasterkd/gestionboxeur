import { client, loadAccount, result, isDemo } from './data.js';
import { createToolStore, createDemoToolStore } from './tool-saves.js';
import { createCognitiveRecordStore, createDemoCognitiveRecordStore } from './cognitive-records.js';
import { createReactionRecordStore, createDemoReactionRecordStore } from './reaction-records.js';
import { createMentalStore } from './mental-records.js';
import '../css/bulletin-board.css';
import '../css/timer-presets.css';
import '../css/cognitive-games.css';
import '../css/reaction-game.css';
import '../css/mental-games.css';
import '../css/timer-session.css';
import { mountNavigation } from './navigation.js';
import { mountTools } from './tools.js';

const $ = id => document.getElementById(id);
let toolsUI = null, generation = 0, currentOwner = null;
let routeMode = 'push', routeKey = null, routeIndex = 0, committedURL = null, restoringHistory = false, selectionVersion = 0;
function normalizeRoute(route) {
  if (!route) return null;
  const tool = route.tool === null ? 'boxing' : route.tool;
  const game = tool === 'cognitive' && route.game === undefined ? 'tiles' : route.game;
  if (!['boxing', 'intervals', 'punches', 'steps', 'bulletin', 'cognitive'].includes(tool)) return null;
  if (game !== undefined && (tool !== 'cognitive' || !['tiles', 'bag', 'visual-memory', 'reaction', 'dual-task'].includes(game))) return null;
  return game ? { tool, game } : { tool };
}
function locationRoute() {
  const params = new URLSearchParams(location.search);
  if (params.getAll('tool').length > 1 || params.getAll('game').length > 1) return { tool: 'boxing' };
  const route = { tool: params.has('tool') ? params.get('tool') : null };
  if (params.has('game')) route.game = params.get('game');
  return normalizeRoute(route) || { tool: 'boxing' };
}
function sameSelection(left, right) { return left?.tool === right?.tool && left?.game === right?.game; }
function routeState(index) { return { ...history.state, toolsRoute: { key: routeKey, index } }; }
function announce(selection) { window.dispatchEvent(new CustomEvent('tools:selection', { detail: selection })); }
function selected(selection) {
  if (!toolsUI || !routeKey) return;
  const url = new URL(location.href);
  if (selection.tool === null) url.searchParams.delete('tool'); else url.searchParams.set('tool', selection.tool);
  if (selection.game) url.searchParams.set('game', selection.game); else url.searchParams.delete('game');
  if (routeMode === 'push' && url.href !== committedURL) history.pushState(routeState(++routeIndex), '', url);
  else {
    const entry = history.state?.toolsRoute;
    if (routeMode === 'pop' && entry?.key === routeKey) routeIndex = entry.index;
    history.replaceState(routeState(routeIndex), '', url);
  }
  committedURL = url.href;
  selectionVersion++;
  announce(selection);
}
function applyRoute(route, mode) {
  route = normalizeRoute(route);
  if (!toolsUI || !route) return false;
  routeMode = mode;
  const previousVersion = selectionVersion;
  try {
    toolsUI.navigate(route);
    const accepted = sameSelection(toolsUI.getSelection(), route);
    if (accepted && mode !== 'push' && previousVersion === selectionVersion) selected(toolsUI.getSelection());
    return accepted;
  } finally { routeMode = 'push'; }
}
function initializeRouting() {
  const entry = history.state?.toolsRoute;
  routeKey = typeof entry?.key === 'string' ? entry.key : `tools-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  routeIndex = Number.isInteger(entry?.index) ? entry.index : 0;
  committedURL = location.href;
  history.replaceState(routeState(routeIndex), '', committedURL);
  applyRoute(locationRoute(), 'replace');
}
window.addEventListener('tools:navigate', event => {
  if (!restoringHistory) applyRoute(event.detail, 'push');
});
window.addEventListener('popstate', () => {
  if (!toolsUI || !committedURL) return;
  if (restoringHistory) { restoringHistory = false; return; }
  const target = history.state?.toolsRoute, route = locationRoute();
  if (route && applyRoute(route, 'pop')) return;
  // Undo the browser move when an active session refuses to leave. Preserve its history entry.
  const distance = target?.key === routeKey && Number.isInteger(target.index) ? routeIndex - target.index : 0;
  if (distance) { restoringHistory = true; history.go(distance); }
  else history.replaceState(routeState(routeIndex), '', committedURL);
});
function failure(error) { $('toolsError').textContent = error?.message || 'Impossible de charger tes outils. Réessaie.'; $('toolsError').hidden = false; }
async function initialize() {
  const ticket = ++generation;
  try {
    const { session } = await result(client.auth.getSession());
    if (ticket !== generation) return;
    if (!session) { location.replace('login.html'); return; }
    currentOwner = session.user.id;
    const account = await loadAccount(session.user);
    if (ticket !== generation) return;
    $('accountName').textContent = account.profile.full_name || session.user.email || '';
    $('gymBrand').textContent = account.gym?.gym_name || 'Mon espace';
    $('gymAddress').textContent = account.gym?.address || '';
    mountNavigation({ role: account.profile.account_type, isAdmin: account.profile.is_admin });
    toolsUI = mountTools($('toolsApp'), { ownerId: session.user.id, onSelection(selection) { if (ticket === generation) selected(selection); }, toolStore: isDemo ? createDemoToolStore() : createToolStore(client, session.user.id), cognitiveStore: isDemo ? createDemoCognitiveRecordStore() : createCognitiveRecordStore(client, session.user.id), reactionStore: isDemo ? createDemoReactionRecordStore() : createReactionRecordStore(client, session.user.id), mentalStore: createMentalStore(client, session.user.id) });
    initializeRouting();
    $('toolsApp').hidden = false;
  } catch (error) { if (ticket === generation) failure(error); }
  finally { if (ticket === generation) $('toolsLoading').hidden = true; }
}
$('logoutButton').addEventListener('click', async () => {
  $('logoutButton').disabled = true;
  try { await result(client.auth.signOut({ scope: 'local' })); }
  catch (error) { failure(error); $('logoutButton').disabled = false; }
});
client.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    generation++; toolsUI?.destroy(); toolsUI = null; currentOwner = null;
    $('toolsApp').hidden = true; $('accountName').textContent = ''; $('gymBrand').textContent = 'Mon espace'; $('gymAddress').textContent = '';
    location.replace('login.html');
  } else if (event === 'SIGNED_IN' && currentOwner && session?.user?.id && session.user.id !== currentOwner) {
    // A different account can sign in from another tab while a game is open.
    generation++; toolsUI?.destroy(); toolsUI = null; currentOwner = session.user.id;
    $('toolsApp').hidden = true; $('toolsLoading').hidden = false; $('toolsError').hidden = true;
    $('accountName').textContent = ''; $('gymBrand').textContent = 'Mon espace'; $('gymAddress').textContent = '';
    location.replace(`tools.html${location.search}${location.hash}`);
  }
});
initialize();

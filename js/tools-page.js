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
    toolsUI = mountTools($('toolsApp'), { ownerId: session.user.id, toolStore: isDemo ? createDemoToolStore() : createToolStore(client, session.user.id), cognitiveStore: isDemo ? createDemoCognitiveRecordStore() : createCognitiveRecordStore(client, session.user.id), reactionStore: isDemo ? createDemoReactionRecordStore() : createReactionRecordStore(client, session.user.id), mentalStore: createMentalStore(client, session.user.id) });
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
    location.replace('tools.html');
  }
});
initialize();

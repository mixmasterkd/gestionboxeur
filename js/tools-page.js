import { client, loadAccount, result } from './data.js';
import { mountNavigation } from './navigation.js';
import { mountTools } from './tools.js';

const $ = id => document.getElementById(id);
let toolsUI = null, generation = 0;
function failure(error) { $('toolsError').textContent = error?.message || 'Impossible de charger tes outils. Réessaie.'; $('toolsError').hidden = false; }
async function initialize() {
  const ticket = ++generation;
  try {
    const { session } = await result(client.auth.getSession());
    if (ticket !== generation) return;
    if (!session) { location.replace('login.html'); return; }
    const account = await loadAccount(session.user);
    if (ticket !== generation) return;
    $('accountName').textContent = account.profile.full_name || session.user.email || '';
    $('gymBrand').textContent = account.gym?.gym_name || 'Mon espace';
    $('gymAddress').textContent = account.gym?.address || '';
    mountNavigation({ role: account.profile.account_type, isAdmin: account.profile.is_admin });
    toolsUI = mountTools($('toolsApp'));
    $('toolsApp').hidden = false;
  } catch (error) { if (ticket === generation) failure(error); }
  finally { if (ticket === generation) $('toolsLoading').hidden = true; }
}
$('logoutButton').addEventListener('click', async () => {
  $('logoutButton').disabled = true;
  try { await result(client.auth.signOut({ scope: 'local' })); }
  catch (error) { failure(error); $('logoutButton').disabled = false; }
});
client.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') {
    generation++; toolsUI?.destroy(); toolsUI = null;
    $('toolsApp').hidden = true; $('accountName').textContent = ''; $('gymBrand').textContent = 'Mon espace'; $('gymAddress').textContent = '';
    location.replace('login.html');
  }
});
initialize();

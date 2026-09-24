import { client } from './config.js';
import { beginTestSession } from './test-session.js';
import { mountNavigation } from './navigation.js';

const $ = id => document.getElementById(id);
let users = [];
let timer;
let authorized = false;
let accountGeneration = 0;
let listGeneration = 0;
let currentUserId = null;
const activeAccount = (generation, userId) => authorized && generation === accountGeneration && userId === currentUserId;
const dateFormatter = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = value => value && Number.isFinite(new Date(value).getTime()) ? dateFormatter.format(new Date(value)) : '—';
const toast = text => {
  clearTimeout(timer);
  $('toast').textContent = text;
  $('toast').classList.remove('hidden');
  timer = setTimeout(() => $('toast').classList.add('hidden'), 3500);
};
function showError(text = '') {
  $('adminError').textContent = text;
  $('adminError').classList.toggle('hidden', !text);
}
function showTestError(text = '') {
  $('testAccountError').textContent = text;
  $('testAccountError').classList.toggle('hidden', !text);
}
async function callAdmin(body) {
  if (!authorized) throw new Error('Accès administrateur requis.');
  const { data, error } = await client.functions.invoke('admin-users', { body });
  if (error) {
    let detail = error.message;
    try {
      if (error.context?.clone) {
        const payload = await error.context.clone().json();
        detail = payload.error || payload.message || detail;
      }
    } catch { /* Fall back to the transport error. */ }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
function textCell(value, strong = false) {
  const cell = document.createElement('td');
  if (strong) {
    const element = document.createElement('strong');
    element.textContent = value;
    cell.append(element);
  } else cell.textContent = value;
  return cell;
}
function render() {
  const rows = $('userRows');
  rows.replaceChildren();
  for (const user of users) {
    const tr = document.createElement('tr');
    const role = user.account_type === 'athlete' ? 'Athlète' : 'Coach';
    tr.append(textCell(user.full_name || '—', true), textCell(role), textCell(user.email || '—'), textCell(formatDate(user.created_at)), textCell(formatDate(user.last_sign_in_at)));
    const actions = document.createElement('td');
    const reset = document.createElement('button');
    reset.className = 'edit'; reset.type = 'button'; reset.textContent = 'Réinitialiser le mot de passe';
    reset.addEventListener('click', () => resetPassword(user, reset));
    const remove = document.createElement('button');
    remove.className = 'danger'; remove.type = 'button'; remove.textContent = 'Supprimer le compte';
    remove.addEventListener('click', () => deleteUser(user.id, remove));
    actions.className = 'admin-row-actions';
    actions.append(reset, document.createTextNode(' '), remove);
    tr.append(actions);
    rows.append(tr);
  }
  $('emptyState').classList.toggle('hidden', users.length !== 0);
}
async function loadUsers() {
  if (!authorized) return;
  const account = accountGeneration, userId = currentUserId, request = ++listGeneration;
  const current = () => activeAccount(account, userId) && request === listGeneration;
  showError();
  $('refreshButton').disabled = true;
  try {
    const data = await callAdmin({ action: 'list' });
    if (!current()) return;
    users = data.users || [];
    render();
  } catch (error) { if (current()) showError(error.message || 'Accès administrateur refusé.'); }
  finally { if (current()) $('refreshButton').disabled = false; }
}
async function resetPassword(user, button) {
  const email = user.email;
  if (!authorized || button.disabled || !email || !confirm(`Envoyer un lien de réinitialisation à ${email} ?`)) return;
  const account = accountGeneration, userId = currentUserId;
  button.disabled = true;
  showError();
  try {
    await callAdmin({ action: 'reset_password', user_id: user.id });
    if (!activeAccount(account, userId)) return;
    toast('Lien de réinitialisation envoyé.');
  } catch (error) { if (activeAccount(account, userId)) showError(error.message); }
  finally { button.disabled = !activeAccount(account, userId); }
}
async function deleteUser(userId, button) {
  const user = users.find(item => item.id === userId);
  if (!authorized || button.disabled || !user || !confirm(`Supprimer définitivement le compte de ${user.email} ? Cette action supprime son accès à l’application.`)) return;
  const account = accountGeneration, ownerId = currentUserId;
  button.disabled = true;
  showError();
  try {
    await callAdmin({ action: 'delete', user_id: userId });
    if (!activeAccount(account, ownerId)) return;
    // A list requested before this deletion must not restore the deleted row.
    listGeneration++;
    $('refreshButton').disabled = false;
    users = users.filter(item => item.id !== userId);
    render();
    toast('Compte supprimé.');
  } catch (error) { if (activeAccount(account, ownerId)) showError(error.message); }
  finally { button.disabled = !activeAccount(account, ownerId); }
}
async function createTestUser() {
  if (!authorized || $('createTestButton').disabled) return;
  const account = accountGeneration, userId = currentUserId;
  $('createTestButton').disabled = true;
  $('createTestButton').textContent = 'Ouverture du compte de test…';
  $('createTestButton').setAttribute('aria-busy', 'true');
  showTestError();
  try {
    const data = await callAdmin({ action: 'athlete_test_session' });
    if (!activeAccount(account, userId)) return;
    await beginTestSession(data, userId, () => activeAccount(account, userId));
  } catch (error) { if (activeAccount(account, userId)) showTestError(/Action inconnue|Function not found/i.test(error.message || '') ? 'Le mode athlète de test sera disponible après la mise à jour du service d’administration.' : error.message); }
  finally {
    if (account === accountGeneration) {
      $('createTestButton').disabled = !authorized;
      $('createTestButton').textContent = 'Passer en mode athlète de test';
      $('createTestButton').removeAttribute('aria-busy');
    }
  }
}
async function loadGyms() {
  if (!authorized) return;
  const account=accountGeneration,userId=currentUserId;
  try {
    const {data,error}=await client.from('gyms').select('id,name,address,is_default').order('name');
    if(!activeAccount(account,userId))return;
    if(error)throw error;
    $('gymDirectory').replaceChildren();$('gymError').classList.add('hidden');
    for(const gym of data||[]) {
      const row=document.createElement('div');row.className='gym-directory-item';
      const description=document.createElement('div'),name=document.createElement('strong'),address=document.createElement('p');
      name.textContent=gym.name+(gym.is_default?' · Par défaut':'');address.textContent=gym.address||'Adresse à compléter';description.append(name,address);
      const edit=document.createElement('button');edit.type='button';edit.className='button';edit.textContent='Modifier';
      edit.addEventListener('click',()=>{if(!authorized)return;$('editingGymId').value=gym.id;$('newGymName').value=gym.name;$('newGymAddress').value=gym.address||'';$('saveAdminGymButton').textContent='Enregistrer le gym';$('cancelGymEditButton').classList.remove('hidden');$('newGymName').focus();});
      row.append(description,edit);$('gymDirectory').append(row);
    }
  }catch(error){if(activeAccount(account,userId)){$('gymError').textContent=['42P01','PGRST205'].includes(error?.code)?'Le répertoire sera disponible après l’activation de la mise à jour de la plateforme.':error.message;$('gymError').classList.remove('hidden');}}
}
function resetGymForm() {$('adminGymForm').reset();$('editingGymId').value='';$('saveAdminGymButton').textContent='Ajouter le gym';$('cancelGymEditButton').classList.add('hidden');}
$('cancelGymEditButton').addEventListener('click',resetGymForm);
$('adminGymForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!authorized||$('saveAdminGymButton').disabled)return;
  const account=accountGeneration,userId=currentUserId;$('saveAdminGymButton').disabled=true;$('gymError').classList.add('hidden');
  try{
    const {error}=await client.rpc('admin_save_gym',{p_name:$('newGymName').value.trim(),p_address:$('newGymAddress').value.trim(),p_gym_id:$('editingGymId').value||null});
    if(!activeAccount(account,userId))return;if(error)throw error;resetGymForm();await loadGyms();if(activeAccount(account,userId))toast('Gym enregistré dans le répertoire.');
  }catch(error){if(activeAccount(account,userId)){$('gymError').textContent=error.message;$('gymError').classList.remove('hidden');}}
  finally{if(activeAccount(account,userId))$('saveAdminGymButton').disabled=false;}
});
function clearPrivateState() {
  accountGeneration++; listGeneration++; currentUserId = null;
  users = []; authorized = false;
  $('userRows').querySelectorAll('button').forEach(button => { button.disabled = true; });
  $('userRows').replaceChildren();
  $('gymBrand').textContent = 'Mon gym'; $('gymAddress').textContent = ''; document.title = 'Administration';
  $('createTestButton').disabled = true; $('refreshButton').disabled = true;
  $('createTestButton').textContent = 'Passer en mode athlète de test';
  $('createTestButton').removeAttribute('aria-busy'); showTestError();
  $('saveAdminGymButton').disabled = true;$('gymDirectory').replaceChildren();resetGymForm();$('gymError').textContent='';$('gymError').classList.add('hidden');
  $('emptyState').classList.add('hidden'); showError();
  clearTimeout(timer); $('toast').textContent = ''; $('toast').classList.add('hidden');
}
$('refreshButton').addEventListener('click', loadUsers);
$('createTestButton').addEventListener('click', createTestUser);
$('logoutButton').addEventListener('click', async () => {
  if ($('logoutButton').disabled) return;
  const account = accountGeneration;
  $('logoutButton').disabled = true;
  try {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (account !== accountGeneration) return;
    if (error) throw error;
    clearPrivateState(); location.replace('../login.html');
  } catch (error) { if (account === accountGeneration) showError(error.message); }
  finally { if (account === accountGeneration) $('logoutButton').disabled = false; }
});
client.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') { clearPrivateState(); location.replace('../login.html'); }
  else if (event === 'SIGNED_IN' && session?.user?.id && session.user.id !== currentUserId) {
    clearPrivateState();
    const account = accountGeneration;
    // Defer Supabase calls until its authentication callback has released its lock.
    setTimeout(() => { if (account === accountGeneration) initialize(); }, 0);
  }
});
async function initialize() {
  clearPrivateState();
  const account = accountGeneration;
  $('logoutButton').disabled = false;
  try {
    const { data, error } = await client.auth.getSession();
    if (account !== accountGeneration) return;
    if (error) throw error;
    if (!data.session) { location.replace('../login.html'); return; }
    const userId = data.session.user.id; currentUserId = userId;
    const result = await client.from('profiles').select('is_admin').eq('id', userId).single();
    if (account !== accountGeneration || userId !== currentUserId) return;
    if (result.error) throw result.error;
    if (!result.data.is_admin) throw new Error('Cet espace est réservé aux administrateurs.');
    const gym = await client.from('gym_settings').select('gym_name,address').eq('coach_id', userId).maybeSingle();
    if (account !== accountGeneration || userId !== currentUserId) return;
    if (gym.error) throw gym.error;
    $('gymBrand').textContent = gym.data?.gym_name || 'Mon gym';
    $('gymAddress').textContent = gym.data?.address || '';
    document.title = `Administration — ${$('gymBrand').textContent}`;
    authorized = true;
    mountNavigation({role:'coach',isAdmin:true});
    $('createTestButton').disabled = false;
    $('saveAdminGymButton').disabled = false;
    loadGyms();
    await loadUsers();
  } catch (error) { if (account === accountGeneration) showError(error.message); }
}
window.addEventListener('pageshow', event => { if (event.persisted) initialize(); });
initialize();

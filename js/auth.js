import { client } from './config.js';
import { isTestSession } from './config.js';
import { returnFromTestSession } from './test-session.js';

const $ = id => document.getElementById(id);
const option = (label,value,selected=false) => { const item=document.createElement('option');item.textContent=label;item.value=value;item.selected=selected;return item; };
const params = new URLSearchParams(location.search);
const fragment = new URLSearchParams(location.hash.slice(1));
const invite = params.get('invite');
if (invite) sessionStorage.setItem('pendingInvite', invite);
const pendingInvite = invite || sessionStorage.getItem('pendingInvite');
let mode = fragment.get('type') === 'recovery' || params.get('mode') === 'recovery' ? 'recovery' : 'login';
let recoveryReady = false;
let busy = false;
let athleteSignupReady = false;
let athleteSignupUnavailable = 'L’inscription athlète sera disponible après l’activation de la mise à jour de la plateforme.';

function dashboardUrl() {
  const url = new URL('./planning.html', location.href);
  if (pendingInvite) url.searchParams.set('invite', pendingInvite);
  return url.href;
}
function message(text, type = 'error') {
  const element = $(type === 'error' ? 'authError' : 'authSuccess');
  element.textContent = text;
  element.classList.remove('hidden');
}
function clearMessages() {
  $('authError').classList.add('hidden');
  $('authSuccess').classList.add('hidden');
}
function friendlyError(error) {
  const text = error.message || 'Une erreur est survenue. Réessaie.';
  if (/Invalid login credentials/i.test(text)) return 'Courriel ou mot de passe incorrect.';
  if (/User already registered/i.test(text)) return 'Ce courriel est déjà utilisé. Connecte-toi ou réinitialise ton mot de passe.';
  if (/Email not confirmed/i.test(text)) return 'Confirme ton courriel avant de te connecter.';
  if (/rate limit|too many requests/i.test(text)) return 'Trop de demandes. Attends quelques minutes avant de réessayer.';
  if (/fetch|network/i.test(text)) return 'Connexion impossible. Vérifie ta connexion Internet et réessaie.';
  return text;
}
function updateAccountType() {
  const coach = false;
  document.querySelectorAll('.coach-only').forEach(el => el.classList.toggle('hidden', mode !== 'signup' || !coach));
  document.querySelectorAll('.athlete-only').forEach(el => el.classList.toggle('hidden', mode !== 'signup' || coach));
  $('birthDate').required = mode === 'signup' && !coach;
  document.querySelectorAll('.athlete-only input, .athlete-only select').forEach(el => { el.disabled = mode !== 'signup' || coach; });
}
const today = new Date();
const localDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
$('birthDate').max = localDate;
async function loadGyms() {
  try {
    const { data, error } = await client.from('gyms').select('id,name,address,is_default').order('name');
    if (error) throw error;
    $('athleteGym').replaceChildren(option('Sans gym pour le moment', ''));
    for (const gym of data || []) $('athleteGym').append(option(`${gym.name}${gym.address ? ' · '+gym.address : ''}`, gym.id, gym.is_default));
    athleteSignupReady = true;
  } catch (error) {
    athleteSignupReady = false;
    if (!['42P01','42703','PGRST205','PGRST204'].includes(error?.code)) athleteSignupUnavailable = 'Impossible de vérifier l’accès à l’inscription athlète. Vérifie ta connexion et recharge cette page.';
    $('athleteGym').replaceChildren(option('Sans gym pour le moment', ''));
    $('gymDirectoryNotice').textContent = athleteSignupUnavailable;
  }
}
const gymDirectoryLoad = loadGyms();
function setMode(next) {
  mode = next;
  clearMessages();
  const signup = mode === 'signup';
  const recovery = mode === 'recovery';
  const forgot = mode === 'forgot';
  document.querySelectorAll('.signup-only').forEach(el => el.classList.toggle('hidden', !signup));
  $('fullName').required = signup;
  $('emailField').classList.toggle('hidden', recovery);
  $('email').required = !recovery;
  $('passwordField').classList.toggle('hidden', forgot);
  $('password').required = !forgot;
  $('password').autocomplete = signup || recovery ? 'new-password' : 'current-password';
  $('passwordLabel').textContent = recovery ? 'Nouveau mot de passe' : 'Mot de passe';
  $('confirmPasswordField').classList.toggle('hidden', !recovery);
  $('confirmPassword').required = recovery;
  $('authTitle').textContent = signup ? 'Créer un compte' : recovery ? 'Nouveau mot de passe' : forgot ? 'Mot de passe oublié' : 'Connexion';
  $('authIntro').textContent = signup ? 'Crée ton compte. Les fonctions coach s’activent ensuite dans ton profil.' : recovery ? 'Choisis un mot de passe d’au moins 6 caractères.' : forgot ? 'Reçois un lien sécurisé pour choisir un nouveau mot de passe.' : '';
  $('authIntro').hidden = !$('authIntro').textContent;
  $('authSubmit').textContent = signup ? 'Créer mon compte' : recovery ? 'Enregistrer le mot de passe' : forgot ? 'Envoyer le lien' : 'Se connecter';
  $('authSubmit').disabled = recovery && !recoveryReady;
  $('authToggle').textContent = mode === 'login' ? 'Créer un compte' : 'Retour à la connexion';
  $('forgotPassword').classList.toggle('hidden', mode !== 'login');
  $('continueButton').classList.add('hidden');
  updateAccountType();
}

if (pendingInvite) {
  $('inviteNotice').classList.remove('hidden');
}
setMode(mode);
$('authToggle').addEventListener('click', () => setMode(mode === 'login' ? 'signup' : 'login'));
$('forgotPassword').addEventListener('click', () => setMode('forgot'));
$('continueButton').href = dashboardUrl();

client.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    recoveryReady = Boolean(session);
    setMode('recovery');
  }
});

async function initialize() {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (isTestSession() && !data.session) { await returnFromTestSession(); return; }
  const urlError = fragment.get('error_description') || params.get('error_description');
  if (urlError) {
    setMode('forgot');
    message('Ce lien est invalide ou expiré. Demande un nouveau lien de réinitialisation ou reconnecte-toi.');
    history.replaceState(null, '', location.pathname);
    return;
  }
  if (mode === 'recovery') {
    recoveryReady = Boolean(data.session);
    setMode('recovery');
    if (!recoveryReady) message('Ce lien de réinitialisation est invalide ou expiré. Utilise « Retour à la connexion », puis « Mot de passe oublié ».');
    return;
  }
  if (data.session) location.replace(dashboardUrl());
}
initialize().catch(error => message(friendlyError(error)));

$('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  clearMessages();
  busy = true;
  $('authSubmit').disabled = true;
  try {
    const email = $('email').value.trim();
    const password = $('password').value;
    if (mode === 'forgot') {
      const resetUrl = new URL('./login.html', location.href);
      resetUrl.searchParams.set('mode', 'recovery');
      if (pendingInvite) resetUrl.searchParams.set('invite', pendingInvite);
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: resetUrl.href });
      if (error) throw error;
      message('Si un compte existe pour ce courriel, un lien de réinitialisation a été envoyé. Vérifie aussi tes indésirables.', 'success');
    } else if (mode === 'recovery') {
      if (!recoveryReady) throw new Error('Ouvre un lien de réinitialisation valide avant de continuer.');
      if (password !== $('confirmPassword').value) throw new Error('Les deux mots de passe ne correspondent pas.');
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      $('password').value = '';
      $('confirmPassword').value = '';
      message('Ton mot de passe a été mis à jour.', 'success');
      $('continueButton').classList.remove('hidden');
      history.replaceState(null, '', location.pathname);
    } else if (mode === 'signup') {
      const accountType = 'athlete';
      const athlete = accountType === 'athlete';
      if (athlete) { await gymDirectoryLoad; if (!athleteSignupReady) throw new Error(athleteSignupUnavailable); }
      const nameParts = $('fullName').value.trim().split(/\s+/);
      const birthDate = $('birthDate').value;
      if (athlete && (!birthDate || birthDate > localDate)) throw new Error('Indique une date de naissance valide. Elle est obligatoire pour les athlètes.');
      const optionalNumber = id => $(id).value === '' ? null : Number($(id).value);
      const weight = optionalNumber('weight'), fights = optionalNumber('fights') ?? 0, wins = optionalNumber('wins'), losses = optionalNumber('losses');
      if (athlete && ((weight !== null && (!Number.isFinite(weight) || weight <= 0 || weight > 1500)) || [fights,wins,losses].some(n => n !== null && (!Number.isSafeInteger(n) || n < 0)))) throw new Error('Vérifie ton poids et ton bilan de combats.');
      if (athlete && (wins ?? 0) + (losses ?? 0) > fights) throw new Error('Les victoires et les défaites ne peuvent pas dépasser le nombre de combats.');
      const { data, error } = await client.auth.signUp({
        email, password,
        options: {
          emailRedirectTo: dashboardUrl(),
          data: {
            full_name: $('fullName').value.trim(), account_type: accountType,
            gym_name: null,
            gym_address: null,
            ...(athlete ? { first_name: nameParts[0], last_name: nameParts.slice(1).join(' '), birth_date: birthDate, sex: $('sex').value || null, weight_kg: weight === null ? null : $('weightUnit').value === 'lb' ? Math.round(weight / 2.2046226218 * 1000) / 1000 : weight, weight_unit: $('weightUnit').value, fights, wins, losses, gym_id: $('athleteGym').value || null } : {}),
          },
        },
      });
      if (error) throw error;
      if (data.session) { location.replace(dashboardUrl()); return; }
      message('Vérifie ton courriel pour confirmer ton compte, puis connecte-toi.' + (pendingInvite ? ' Ton invitation sera conservée.' : ''), 'success');
    } else {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      location.replace(dashboardUrl());
    }
  } catch (error) {
    message(friendlyError(error));
  } finally {
    busy = false;
    $('authSubmit').disabled = mode === 'recovery' && !recoveryReady;
  }
});

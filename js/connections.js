import { rpc } from './data.js';
import { $, el, button, field, input, heading, errorBox, showError, confirmAction, displayName } from './ui.js';

const PERMISSIONS = [
  ['can_view_calendar', 'Voir mon calendrier'],
  ['can_add_sessions', 'Ajouter des séances et notes'],
  ['can_edit_own_sessions', 'Modifier et déplacer les éléments déverrouillés'],
  ['can_view_feedback', 'Voir mes retours et mon RPE'],
];

export function createConnectionsUI({ getState, refreshAccount, refreshCalendar }) {
  const dialog = $('connectionsDialog');
  const content = $('connectionsContent');
  let generation = 0;
  let pending = false, personalView = false, noticeGeneration = 0;

  dialog.addEventListener('close', () => {
    generation++;
    content.replaceChildren();
  });

  function selectedAthlete(state) {
    if (typeof state.selectedAthlete === 'string') return state.athletes.find(athlete => athlete.id === state.selectedAthlete);
    if (state.selectedAthlete) return state.selectedAthlete;
    return state.profile?.account_type === 'athlete' ? state.athletes.find(athlete => athlete.user_id === state.user?.id) || state.athletes[0] : null;
  }
  function isCurrent(version, userId) {
    return generation === version && dialog.open && getState().user?.id === userId;
  }
  function shell(title = 'Comptes et invitations') {
    const body = el('div', { class: 'dialog-body' });
    content.replaceChildren(heading(title, 'CONNEXIONS', dialog, 'connectionsTitle'), body,
      el('footer', { class: 'dialog-actions' }, button('Fermer', () => dialog.close())));
    return body;
  }
  function setBusy(value) {
    pending = value;
    content.querySelectorAll('button:not(.close-button), input').forEach(node => { node.disabled = value; });
    content.setAttribute('aria-busy', String(value));
  }
  async function refresh() {
    await refreshAccount();
    await refreshCalendar();
  }
  function success(body, message) {
    body.prepend(el('p', { class: 'note-box', role: 'status' }, message));
  }
  async function perform(error, action, message) {
    if (pending) return;
    const version = generation;
    const userId = getState().user?.id;
    error.hidden = true;
    setBusy(true);
    let saved = false;
    try {
      await action();
      saved = true;
      await refresh();
      if (!isCurrent(version, userId)) return;
      const body = await render();
      if (body && message) success(body, message);
    } catch (failure) {
      if (!isCurrent(version, userId)) return;
      if (saved) {
        // A successful mutation must not be offered a second time after a failed refresh.
        const body = shell();
        const alert = errorBox();
        showError(alert, new Error(`Modification enregistrée. Impossible d’actualiser l’affichage : ${failure.message || failure}`));
        body.append(alert, button('Actualiser', async () => {
          if (pending) return;
          setBusy(true);
          try {
            await refresh();
            if (isCurrent(version, userId)) await render();
          } catch (retryError) {
            if (isCurrent(version, userId)) showError(alert, new Error(`Modification enregistrée. Impossible d’actualiser l’affichage : ${retryError.message || retryError}`));
          } finally {
            pending = false;
            if (dialog.open) setBusy(false);
          }
        }));
      } else showError(error, failure);
    } finally {
      pending = false;
      if (dialog.open) setBusy(false);
    }
  }
  async function copyText(text, error) {
    error.hidden = true;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const area = el('textarea', { value: text, 'aria-label': 'Texte à copier' });
        area.style.cssText = 'position:fixed;left:-9999px;top:0';
        content.append(area); area.select();
        let copied;
        try { copied = document.execCommand('copy'); } finally { area.remove(); }
        if (!copied) throw new Error('La copie automatique est indisponible. Sélectionne le texte affiché pour le copier.');
      }
      const status = el('span', { role: 'status', class: 'muted' }, 'Copié.');
      error.parentElement.querySelector('[data-copy-status]')?.remove();
      status.dataset.copyStatus = 'true';
      error.after(status);
    } catch (failure) { showError(error, failure); }
  }
  function codeBox(value, label = 'Copier le code') {
    const container = el('div');
    const error = errorBox();
    container.append(el('div', { class: 'code-box' }, el('code', {}, value), button(label, () => copyText(value, error))), error);
    return container;
  }
  function existingAccountHelp() {
    return el('p', { class: 'permission-help' },
      'Compte déjà actif : partage ton code coach. Après acceptation de la demande, utilise « Rattacher » sur la fiche sans compte dans ',
      el('a', { href: 'roster.html' }, 'Mes athlètes'),
      ' pour la relier au profil inscrit et conserver son calendrier.');
  }
  function renderCoach(state, body) {
    body.append(el('h3', {}, 'Ton code coach'),
      el('p', {}, 'Un athlète qui possède déjà un compte peut saisir ce code dans « Mes coachs ». Sa demande apparaîtra ci-dessous : tu pourras l’accepter ou la refuser.'));
    if (state.coach?.join_code) body.append(codeBox(state.coach.join_code));
    else body.append(el('p', { class: 'muted' }, 'Le code coach est indisponible. Actualise ton compte pour le récupérer.'));

    const pendingRelations = state.relations.filter(relation => relation.status === 'pending');
    body.append(el('h3', {}, `Demandes à valider (${pendingRelations.length})`));
    if (!pendingRelations.length) body.append(el('p', { class: 'muted' }, 'Aucune demande en attente.'));
    for (const relation of pendingRelations) {
      const athlete = state.athletes.find(item => item.id === relation.athlete_id);
      const error = errorBox();
      const card = el('article', { class: 'connection-card', dataset: { athleteId: relation.athlete_id } },
        el('h3', {}, displayName(athlete)), el('p', {}, 'Cet athlète demande une liaison à ton compte coach.'));
      const respond = accept => perform(error,
        () => rpc('respond_coach_request', { p_athlete_id: relation.athlete_id, p_accept: accept }),
        accept ? 'Demande acceptée. Le compte athlète est lié au tien.' : 'Demande refusée.');
      card.append(el('div', { class: 'intro-actions' }, button('Accepter', () => respond(true), 'button primary'), button('Refuser', () => respond(false))), error);
      body.append(card);
    }

    const accepted = state.relations.filter(relation => relation.status === 'accepted');
    body.append(el('h3', {}, `Fiches et comptes liés (${accepted.length})`));
    if (!accepted.length) body.append(el('p', { class: 'muted' }, 'Ajoute une fiche dans « Mes athlètes » ou accepte une demande de liaison.'));
    for (const relation of accepted) {
      const athlete = state.athletes.find(item => item.id === relation.athlete_id);
      if (!athlete) continue;
      const card = el('article', { class: 'connection-card', dataset: { athleteId: athlete.id } },
        el('h3', {}, displayName(athlete), el('span', { class: 'connection-status' }, athlete.user_id ? 'Compte lié' : 'Fiche sans compte')),
        el('p', {}, athlete.user_id ? 'L’athlète règle les accès à son calendrier dans « Mes coachs ».' : 'Fiche utilisable dans les listes. Pour une nouvelle inscription, crée un lien d’invitation depuis cette fiche.'));
      if (!athlete.user_id) card.append(button('Créer un lien d’invitation', () => generateInvitation(athlete), 'button secondary'));
      body.append(card);
    }
    body.append(el('p', { class: 'permission-help' }, 'Nouveau compte : le lien d’invitation créé depuis une fiche permet à l’athlète de s’inscrire en conservant cette fiche.'), existingAccountHelp());
  }
  async function renderAthlete(state, body, version) {
    const athlete = state.athletes.find(item => item.user_id === state.user?.id);
    if (!athlete) {
      body.append(el('p', { class: 'empty-message' }, 'Ton profil athlète n’est pas encore disponible. Actualise ton compte avant de connecter un coach.'));
      return;
    }
    body.append(el('p', {}, 'Ajoute tes coachs avec leur code, puis règle leurs accès au calendrier.'));
    const form = el('form', { class: 'connection-card' });
    const code = input('coach_code', '', 'text', { required: true, maxlength: 100, autocomplete: 'off', autocapitalize: 'none', spellcheck: false });
    const joinError = errorBox();
    form.append(el('h3', {}, 'Ajouter un coach'), field('Code fourni par ton coach', code),
      el('button', { type: 'submit', class: 'button primary' }, 'Envoyer la demande'), joinError);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!code.value.trim()) { showError(joinError, 'Saisis le code fourni par ton coach.'); return; }
      const p_code = code.value.trim().toLowerCase();
      perform(joinError, () => rpc('request_coach', { p_code }), 'Demande enregistrée. La liaison sera active après acceptation du coach.');
    });
    body.append(form, el('h3', {}, 'Mes coachs'));
    const list = el('div', { 'aria-live': 'polite' }, el('p', { class: 'muted' }, 'Chargement des coachs…'));
    body.append(list);
    const coaches = await rpc('athlete_coaches', { p_athlete_id: athlete.id });
    if (!isCurrent(version, state.user?.id)) return;
    list.replaceChildren();
    const activeCoaches = (coaches || []).filter(coach => ['accepted', 'pending'].includes(coach.status));
    if (!activeCoaches.length) list.append(el('p', { class: 'muted' }, 'Aucun coach connecté. Demande son code à ton coach pour l’ajouter.'));
    for (const coach of activeCoaches) {
      const accepted = coach.status === 'accepted';
      const name = coach.display_name || 'Coach';
      const card = el('article', { class: 'connection-card', dataset: { coachId: coach.coach_id } },
        el('h3', {}, name, el('span', { class: 'connection-status' }, accepted ? 'Connecté' : 'En attente')));
      const error = errorBox();
      if (accepted) {
        const permissions = el('form');
        const checks = new Map();
        const list = el('div', { class: 'permission-list' });
        for (const [key, label] of PERMISSIONS) {
          const checkbox = input(key, '', 'checkbox', { checked: Boolean(coach[key]) });
          checks.set(key, checkbox);
          list.append(el('label', {}, checkbox, label));
        }
        permissions.append(list, el('p', { class: 'permission-help' }, 'Sans accès au calendrier, les autres permissions restent inactives. Un élément verrouillé reste modifiable uniquement par son créateur. La suppression est réservée au créateur.'),
          el('button', { type: 'submit', class: 'button secondary' }, 'Enregistrer les permissions'));
        permissions.addEventListener('submit', event => {
          event.preventDefault();
          const args = { p_athlete_id: athlete.id, p_coach_id: coach.coach_id };
          for (const [key, checkbox] of checks) args[`p_${key}`] = checkbox.checked;
          perform(error, () => rpc('set_coach_permissions', args), `Permissions de ${name} enregistrées.`);
        });
        card.append(permissions);
      } else card.append(el('p', {}, 'Ton coach doit accepter cette demande avant d’accéder à ton calendrier.'));
      const revoke = button(accepted ? 'Retirer ce coach' : 'Annuler la demande', async () => {
        if (pending) return;
        const confirmVersion = generation;
        const confirmUser = getState().user?.id;
        setBusy(true);
        let confirmed;
        try {
          confirmed = await confirmAction(accepted ? 'Retirer ce coach ?' : 'Annuler la demande ?',
            accepted ? `${name} perdra son accès à ton profil. Tes séances, ton historique et tes autres coachs seront conservés.` : `Annuler la demande envoyée à ${name} ?`,
            accepted ? 'Retirer le coach' : 'Annuler la demande');
        } catch (failure) { showError(error, failure); }
        finally { setBusy(false); }
        if (!confirmed || !isCurrent(confirmVersion, confirmUser)) return;
        perform(error, () => rpc('revoke_coach_relation', { p_athlete_id: athlete.id, p_coach_id: coach.coach_id }),
          accepted ? 'Coach retiré. Ton profil et tes séances sont conservés.' : 'Demande annulée.');
      }, 'button secondary');
      card.append(el('div', { class: 'intro-actions' }, revoke), error);
      list.append(card);
    }
  }
  async function renderInvitations(body,state,version) {
    const invitations=await rpc('my_coaching_invitations');
    if(!isCurrent(version,state.user.id))return;
    const incoming=(invitations||[]).filter(item=>item.direction==='incoming');
    if(!incoming.length)return;
    const list=el('section',{class:'incoming-coaching-invitations'},el('h3',{},'Invitations de coachs'));
    for(const item of incoming) {
      const error=errorBox(),card=el('article',{class:'connection-card'},el('h3',{},item.coach_name),
        el('p',{},'Ce coach propose de te suivre. En acceptant, tu lui permets de voir ton calendrier et tes bilans, d’ajouter des séances et de modifier les éléments déverrouillés. Tu pourras ajuster ces accès dans Mes coachs.'));
      const respond=accept=>perform(error,()=>rpc('respond_coaching_invitation',{p_invitation_id:item.id,p_accept:accept}),accept?'Invitation acceptée. Le coach peut maintenant te suivre.':'Invitation refusée.');
      card.append(el('div',{class:'intro-actions'},button('Accepter ce coach',()=>respond(true),'button primary'),button('Refuser',()=>respond(false))),error);list.append(card);
    }
    body.prepend(list);
  }
  async function refreshNotice() {
    const userId=getState().user?.id, noticeVersion=++noticeGeneration;if(!userId)return;
    try {
      const invitations=await rpc('my_coaching_invitations');if(getState().user?.id!==userId||noticeVersion!==noticeGeneration)return;
      const count=(invitations||[]).filter(item=>item.direction==='incoming').length;
      let notice=$('incomingInvitationsNotice');
      if(!notice&&$('connectionBanner')){notice=el('div',{id:'incomingInvitationsNotice',class:'banner connection-banner',role:'status'});$('connectionBanner').after(notice);}
      if(!notice)return;notice.hidden=!count;
      notice.replaceChildren(el('span',{},`${count} invitation${count>1?'s':''} de coach à consulter`),button('Voir les invitations',()=>open({personal:true}),'button secondary'));
    }catch{/* Invitations remain available from Mes coachs if this notice cannot load. */}
  }
  async function render() {
    const version = ++generation;
    const state = getState();
    const isCoach = state.profile?.account_type === 'coach';
    const body = shell(isCoach && !personalView ? 'Athlètes et invitations' : 'Mes coachs');
    if (isCoach) body.append(el('div', { class: 'template-tabs', role: 'group', 'aria-label': 'Connexions' }, ...[['Mes athlètes', false], ['Mes coachs', true]].map(([label, personal]) => button(label, () => { if (pending) return; personalView = personal; render(); }, 'button secondary', { 'aria-pressed': String(personalView === personal) }))));
    try {
      if (isCoach && !personalView) renderCoach(state, body);
      else await renderAthlete(state, body, version);
      await renderInvitations(body,state,version);
    } catch (error) {
      if (isCurrent(version, state.user?.id)) {
        const alert = errorBox(); showError(alert, error); body.append(alert, button('Réessayer', () => open()));
      }
    }
    return isCurrent(version, state.user?.id) ? body : null;
  }
  async function open({ personal = false } = {}) {
    if (pending) return;
    personalView = personal;
    if (!dialog.open) dialog.showModal();
    await render();
  }
  async function generateInvitation(athlete) {
    if (pending) return;
    const state = getState();
    if (state.profile?.account_type !== 'coach') return;
    if (!dialog.open) dialog.showModal();
    const version = ++generation;
    const body = shell(`Inviter ${displayName(athlete)}`);
    const error = errorBox();
    if (!athlete || athlete.user_id) {
      body.append(el('p', {}, athlete ? 'Cet athlète possède déjà un compte lié. Aucune invitation n’est nécessaire.' : 'Sélectionne un athlète dans ton effectif avant de créer une invitation.'),
        existingAccountHelp(), error);
      if (state.coach?.join_code) body.append(codeBox(state.coach.join_code));
      return;
    }
    const progress = el('p', { role: 'status', class: 'muted' }, 'Création du lien d’invitation…');
    body.append(progress, error);
    setBusy(true);
    try {
      const invitation = await rpc('create_invitation', { p_athlete_id: athlete.id });
      if (!isCurrent(version, state.user?.id)) return;
      if (!invitation?.token) throw new Error('Le lien d’invitation n’a pas été renvoyé. Réessaie.');
      const link = new URL('login.html', location.href);
      link.searchParams.set('invite', invitation.token);
      progress.remove();
      const expiration = new Date(invitation.expires_at);
      const expiryText = Number.isFinite(expiration.getTime())
        ? `Ce lien est valide 7 jours, jusqu’au ${new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeStyle: 'short' }).format(expiration)}.`
        : 'Ce lien est valide 7 jours.';
      body.append(el('p', {}, `Partage ce lien avec ${displayName(athlete)} pour lui permettre de créer son compte et de retrouver cette fiche.`),
        codeBox(link.href, 'Copier le lien'), el('p', { class: 'muted' }, expiryText),
        el('p', { class: 'permission-help' }, 'Ce nouveau lien remplace ton précédent lien pour cette fiche. Il s’utilise une seule fois. Aucun courriel n’est envoyé automatiquement.'),
        existingAccountHelp(),
        button('Retour aux connexions', () => open()));
    } catch (failure) {
      if (isCurrent(version, state.user?.id)) { progress.remove(); showError(error, failure); body.append(button('Réessayer', () => generateInvitation(athlete))); }
    } finally {
      pending = false;
      if (dialog.open) setBusy(false);
    }
  }
  async function inviteAthlete() {
    await generateInvitation(selectedAthlete(getState()));
  }
  return { open, inviteAthlete, refreshNotice };
}

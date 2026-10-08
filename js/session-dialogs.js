import { createRecipientPicker, planningAthletes } from './group-selection.js';
import { $, el, button, field, input, textarea, select, heading, errorBox, showError, busy, toast, confirmAction, displayName, openDialog } from './ui.js';
import { SPORTS, BLOCK_TYPES, todayLocal, validateBlocks, summarizeBlocks } from './domain.js';
import { renderWorkout } from './editor.js';
import { renderTrainingDocument } from './workout-rich-text.js';
import { parseTrainingText } from './workout-document.js';
import { ProgramEditor } from './program-editor.js';
import { EVENT_COLORS, applyEventColor } from './event-colors.js';
import { renderSessionChart } from './session-chart.js';
import { dateLabel } from './calendar.js';
import { accessIcon } from './access-icons.js';

export const EVENT_CATEGORIES = [
  ['school', 'École'], ['exam', 'Examen'], ['work', 'Travail'], ['vacation', 'Vacances'],
  ['unavailable', 'Indisponibilité'], ['competition', 'Compétition'], ['appointment', 'Rendez-vous'], ['note', 'Note libre'], ['other', 'Autre'],
].map(([value, label]) => ({ value, label }));
const FEELINGS = [
  { value: 1, emoji: '😣', label: 'Très mauvais' }, { value: 2, emoji: '😕', label: 'Difficile' },
  { value: 3, emoji: '😐', label: 'Normal' }, { value: 4, emoji: '🙂', label: 'Bon' }, { value: 5, emoji: '😄', label: 'Excellent' },
];
const sportName = value => SPORTS.find(sport => sport.id === value)?.label || value || 'Autre';
function nextOrder(items, date, excludingId) {
  const positions = (items || []).filter(item => item.date === date && item.id !== excludingId).map(item => Number(item.sort_order)).filter(Number.isFinite);
  return Math.max(0, ...positions) + 1024;
}
function blocksError(blocks) {
  const errors = validateBlocks(blocks);
  if (!errors.length) errors.push(...summarizeBlocks(blocks).errors);
  if (errors.length) throw new Error(errors.join('\n'));
}
function show(dialog, preferredFocus) { openDialog(dialog, preferredFocus); }

/** Shared session/event dialogs with explicit persistence dependency. */
export function createSessionUI({ getState, refresh, openLibrary, canEdit, canAdd, api, onTimer = null }) {
  if (!api) throw new Error('Le service de sauvegarde des séances est requis.');
  const getApi = () => Promise.resolve(api);
  let activeEditor = null, detailGeneration = 0, editRequest = 0;
  const completing = new Set();
  const libraryAvailable = () => Boolean(getState().user?.id);
  const ownsAthlete = () => {
    const state = getState(); return !state.selectedGroup && !!state.user?.id && state.selectedAthlete?.user_id === state.user.id;
  };
  const canDelete = item => canEdit(item) && item.created_by === getState().user?.id;
  const ownsSession = session => ownsAthlete() && session.athlete_id === getState().selectedAthlete.id;
  async function setCompleted(session, completed) {
    if (!ownsSession(session)) throw new Error('Seul l’athlète concerné peut indiquer que cette séance est faite.');
    if (completing.has(session.id)) return null;
    completing.add(session.id);
    const userId = getState().user.id, version = detailGeneration;
    let saved = false, updated;
    try {
      const timestamp = await (await getApi()).rpc('set_session_completed', { p_session_id: session.id, p_completed: completed });
      saved = true;
      if (getState().user?.id !== userId || !ownsSession(session)) return null;
      updated = { ...session, completed_at: completed ? timestamp : null };
      const current = getState().sessions?.find(item => item.id === session.id);
      if (current) current.completed_at = updated.completed_at;
      await refresh();
      if (getState().user?.id !== userId || !ownsSession(session)) return null;
      toast(completed ? 'Séance marquée comme faite. Tu peux ajouter ton bilan quand tu veux.' : 'La séance est de nouveau à faire.');
      return getState().sessions?.find(item => item.id === session.id) || updated;
    } catch (error) {
      if (!saved) throw error;
      if (getState().user?.id !== userId || !ownsSession(session)) return null;
      toast('Statut enregistré. Actualise le calendrier pour afficher la dernière version.');
      // The saved row has a new optimistic version; do not leave the old one editable.
      const dialog = $('detailDialog');
      if (dialog?.open && version === detailGeneration) dialog.close();
      return null;
    } finally { completing.delete(session.id); }
  }

  function completionSection(session, dialog, version) {
    const completed = Boolean(session.completed_at), section = el('section', { class: 'session-completion', 'aria-label': 'Réalisation de la séance' });
    const status = el('div', { class: `completion-status ${completed ? 'completed' : 'pending'}` }, el('strong', {}, completed ? '✓ Séance faite' : 'Séance à faire'), el('p', { class: 'muted' }, completed ? 'Réalisation indiquée par l’athlète.' : 'L’athlète peut la cocher une fois son entraînement terminé.'));
    section.append(status);
    if (ownsSession(session)) {
      const error = errorBox();
      const toggle = button(completed ? 'Annuler « faite »' : '✓ Marquer comme faite', async () => {
        if (toggle.disabled) return;
        error.hidden = true;
        try {
          await busy(toggle, async () => {
            const updated = await setCompleted(session, !completed);
            if (updated && dialog.open && version === detailGeneration) showSession(updated);
          });
        } catch (failure) { if (dialog.open && version === detailGeneration) showError(error, failure); }
      }, 'completion-button button secondary', { 'aria-pressed': String(completed) });
      section.append(toggle, error);
    }
    section.append(feedbackSection(session, version, section));
    return section;
  }
  function lockControl(item) {
    const creator = !item || item.created_by === getState().user?.id;
    return accessControl('is_locked', 'Verrouiller', item ? item.is_locked !== false : false, !creator, 'locked', 'unlocked', checked => creator
      ? checked ? 'Verrouillé · seul l’auteur peut modifier ou déplacer.' : 'Déverrouillé · modifiable par l’athlète et ses coachs autorisés.'
      : 'Seul l’auteur peut changer le verrouillage.');
  }
  function accessControl(name, label, checked, disabled, activeIcon, inactiveIcon, describe) {
    const control = input(name, '', 'checkbox', { checked, disabled, 'aria-label': label });
    const drawing = el('span', { class: 'access-drawing', 'aria-hidden': 'true' });
    const wrapper = el('label', { class: `access-control ${name === 'is_locked' ? 'lock-control' : 'privacy-control'}` }, control, drawing);
    const update = () => {
      drawing.replaceChildren(name==='is_locked'&&!control.checked ? el('span',{class:'lock-action-label'},'Verrouiller') : accessIcon(control.checked ? activeIcon : inactiveIcon));
      wrapper.dataset.active = String(control.checked); wrapper.dataset.disabled = String(control.disabled);
      wrapper.title = describe(control.checked);
    };
    control.addEventListener('change', update); update();
    return { control, field: wrapper };
  }
  function eventVisible(event) {
    return !event.is_private || event.created_by === getState().user?.id;
  }
  function accessStatus(locked, privateNote = false) {
    const status = el('span', { class: 'access-status' });
    const badge = (icon, label) => el('span', { class: 'access-badge', role: 'img', 'aria-label': label, title: label }, accessIcon(icon));
    if(locked)status.append(badge('locked', 'Verrouillé · seul l’auteur peut modifier.'));
    if (privateNote) status.append(badge('private', 'Privé · visible seulement par toi.'));
    return status;
  }
  async function finish(dialog, message, isCurrent = () => true) {
    if (!isCurrent()) return;
    try { await refresh(); if (isCurrent()) { dialog.close(); toast(message); } }
    catch (error) { if (isCurrent()) { dialog.close(); toast(`${message} L’actualisation a échoué : ${error.message || 'réessaie depuis le calendrier'}`); } }
  }
  function deleteButton(item, kind, dialog, error, version) {
    const note=kind==='event', common=Boolean(note?item.shared_event_id:item.shared_session_id);
    const label=note?'note':'séance', userId=getState().user?.id;
    const current=()=>dialog.open&&version===detailGeneration&&getState().user?.id===userId;
    const remove=button(common?`Supprimer la ${label} commune`:'Supprimer',async()=>{
      if(remove.disabled||!current())return;
      try {
        await busy(remove,async()=>{
          if(!canDelete(item))throw new Error('Tes permissions ont changé.');
          const data=await getApi();
          const target=common && !(note?item.is_group_event:item.is_group_session)
            ? await (note?data.getSharedEvent(item.shared_event_id):data.getSharedSession(item.shared_session_id)) : item;
          if(!current())return;
          if(!canDelete(item)||!canDelete(target))throw new Error('Tes permissions ont changé.');
          const message=common
            ? `« ${target.title} » sera retirée des calendriers des destinataires pour les dates à venir. ${note?'Les notes déjà commencées seront conservées.':'Les séances passées, réalisées et les bilans seront conservés.'}`
            : note?`« ${target.title} » sera retirée de ton calendrier.`:`« ${target.title} » sera supprimée avec son feedback.`;
          if(!await confirmAction(`Supprimer cette ${label}${common?' commune':''} ?`,message,'Supprimer'))return;
          if(!current())return;
          if(!canDelete(item)||!canDelete(target))throw new Error('Tes permissions ont changé.');
          await (note?data.deleteEvent(target):data.deleteSession(target));
          await finish(dialog,note?'Note supprimée.':'Séance supprimée.',current);
        });
      }catch(failure){if(current())showError(error,failure);}
    },'button secondary left-action');
    return remove;
  }
  async function saveBlockTemplate(block, sport) {
    if (!libraryAvailable()) throw new Error('Connecte-toi pour enregistrer un entraînement.');
    blocksError([block]);
    const title = (block.title?.trim() || (block.kind === 'repeat' ? 'Répétition' : BLOCK_TYPES.find(type => type.id === block.type)?.label) || 'Bloc réutilisable').slice(0, 200);
    await (await getApi()).saveTemplate({ title, sport, description: '', notes: '', blocks: [block], kind: 'block', coach_id: getState().user.id });
    toast('Bloc enregistré dans ta bibliothèque.');
  }

  function editSession(session = null, date = todayLocal(), duplicate = false, { templateOnly = false, folders = [], folderId = null, onClose = null } = {}) {
    const request=++editRequest;
    if (!templateOnly && !duplicate && session?.shared_session_id && !session.is_group_session) {
      if (!canEdit(session)) { toast('Seul l’auteur peut modifier la séance commune.'); return; }
      const userId=getState().user?.id, athleteId=getState().selectedAthlete?.id, details=detailGeneration;
      return api.getSharedSession(session.shared_session_id).then(shared=>{
        if(request!==editRequest||details!==detailGeneration||getState().user?.id!==userId||getState().selectedAthlete?.id!==athleteId)return;
        editSession(shared,date,false);
      }).catch(error=>{if(request===editRequest&&details===detailGeneration&&getState().user?.id===userId)toast(error.message||'Impossible de charger la séance commune.');});
    }
    if (templateOnly ? !libraryAvailable() : session && !duplicate ? !canEdit(session) : !canAdd()) { toast('Tu n’as pas la permission de planifier cette séance.'); return; }
    const state = getState(), athlete = templateOnly ? { id: null, first_name: 'Bibliothèque privée' } : state.selectedGroup ? {id:null,first_name:state.selectedGroup.name} : state.selectedAthlete, editorUserId = state.user?.id;
    const contextId=state.selectedGroup?.id||state.selectedAthlete?.id, groupContext=!!state.selectedGroup;
    const sameContext=()=>!!getState().selectedGroup===groupContext&&(getState().selectedGroup?.id||getState().selectedAthlete?.id)===contextId;
    if (!athlete) { toast('Choisis d’abord un athlète.'); return; }
    if (!duplicate && !session?.is_group_session && session?.athlete_id && session.athlete_id !== athlete.id) { toast('Ouvre le calendrier de cet athlète avant de modifier la séance.'); return; }
    const existing = duplicate ? null : session;
    if(templateOnly&&existing&&existing.coach_id!==editorUserId){toast('Cet entraînement ne fait pas partie de ta bibliothèque.');return;}
    const dialog = $('sessionDialog'), container = $('sessionDialogContent');
    if (activeEditor) { activeEditor.destroy(); activeEditor = null; }
    const title = input('title', duplicate && !session?.kind ? `${session?.title || 'Séance'} (copie)`.slice(0, 200) : session?.title || '', 'text', { required: true, maxLength: 200 });
    const initialSport = session?.sport === 'sparring' ? 'boxing' : session?.sport || 'boxing';
    const sportOptions = SPORTS.filter(item => !item.legacy).map(item => ({ value: item.id, label: item.label }));
    if (!sportOptions.some(option => option.value === initialSport)) sportOptions.push({ value: initialSport, label: initialSport });
    const sport = select('sport', sportOptions, initialSport, { required: true });
    const day = input('date', duplicate ? date : session?.date || date, 'date', { required: true });
    const lock = lockControl(existing);
    const editorMount = el('div'), error = errorBox();
    let bannerBaseline=session?.workout_document?.banner_color||'sand';
    let bannerExplicit=Object.hasOwn(session?.workout_document||{},'banner_color');
    const bannerColors = el('fieldset', { class: 'event-colors session-banner-colors' }, el('legend', {}, 'Couleur du bandeau'));
    for (const choice of EVENT_COLORS) {
      const control = input('session_banner_color', choice.id, 'radio', { checked: choice.id === (session?.workout_document?.banner_color || 'sand'), 'aria-label': choice.label });
      const swatch = el('span', { 'aria-hidden': 'true' }); applyEventColor(swatch, choice.id);
      bannerColors.append(el('label', {}, control, swatch));
    }
    const selectedBannerColor = () => bannerColors.querySelector('input:checked').value;
    const workoutDocument = () => {
      const document=editor.getDocument(), color=selectedBannerColor();
      return bannerExplicit||color!==bannerBaseline?{...document,banner_color:color}:document;
    };
    const basics = el('fieldset', {class:'session-basics'},el('legend',{},'Séance'),field('Titre de la séance',title),el('div',{class:'session-basics-grid'},field('Discipline',sport),templateOnly ? null : field('Date',day),templateOnly ? null : lock.field));
    const templateFolder=templateOnly?select('template_folder',[{value:'',label:'Mes entraînements (sans dossier)'},...folders.filter(f=>f.owner_id===editorUserId).map(f=>({value:f.id,label:f.name}))],existing?.folder_id||folderId||''):null;
    if(templateOnly)basics.querySelector('.session-basics-grid').append(field('Dossier',templateFolder));
    const recipients = !templateOnly && state.profile?.account_type==='coach' && state.groupsAvailable && (!existing||existing.is_group_session)
      ? createRecipientPicker({athletes:planningAthletes(state),groups:state.groups||[],
          athleteIds:existing?.is_group_session?existing.athlete_ids||[]:state.selectedGroup?[]:athlete.id?[athlete.id]:[],
          groupIds:existing?.is_group_session?existing.group_ids||[]:state.selectedGroup?[state.selectedGroup.id]:[],
          onChange:selected=>{lock.field.hidden=!!existing?.is_group_session||selected.group_ids.length>0||selected.athlete_ids.length>1;}}) : null;
    const sharedNotice=existing?.is_group_session?el('p',{class:'session-shared-note'},'Séance commune : les modifications seront appliquées à tous les destinataires. Les bilans restent individuels.'):null;
    const body = el('div', { class: 'dialog-body' }, basics, recipients?.root, sharedNotice, editorMount, bannerColors, error);
    const submit = el('button', { type: 'submit', class: 'button primary' }, templateOnly ? 'Enregistrer dans ma bibliothèque' : existing ? 'Enregistrer les modifications' : 'Planifier la séance');
    const form = el('form', {}, body, el('footer', { class: 'dialog-actions' }, button('Annuler', () => dialog.close()), submit));
    container.replaceChildren(heading(templateOnly ? existing?'Modifier l’entraînement':session?'Personnaliser l’entraînement':'Créer un entraînement' : existing ? 'Modifier la séance' : duplicate ? 'Dupliquer la séance' : 'Planifier une séance', displayName(athlete), dialog, 'sessionDialogTitle'), form);
    let revision = 0, keep = null, modelSaving = false, saving = false;
    const preventClosing=event=>{if(templateOnly&&saving){event.preventDefault();event.stopImmediatePropagation();}};
    dialog.addEventListener('cancel',preventClosing);
    for(const close of container.querySelectorAll('.close-button,.dialog-actions button[type=button]'))close.addEventListener('click',preventClosing,true);
    const changed = () => { revision++; if (keep && !modelSaving) { keep.disabled = false; keep.textContent = 'Enregistrer en bibliothèque'; } };
    const editor = new ProgramEditor(editorMount, { blocks: session?.blocks || [], notes: [session?.description, session?.notes].filter(Boolean).join('\n\n'), document: session?.workout_document || null, sport: sport.value, onChange: changed, onLibrary: openLibrary && libraryAvailable() ? chooseTemplate : null, onSaveBlock: libraryAvailable() ? block => { if (!isCurrent()) throw new Error('Le compte actif a changé.'); return saveBlockTemplate(block, sport.value); } : null });
    const isCurrent = () => dialog.open && activeEditor === editor && getState().user?.id === editorUserId && (templateOnly || sameContext());
    sport.addEventListener('change', () => { editor.setSport(sport.value); changed(); });
    activeEditor = editor;
    dialog.addEventListener('close', () => { const returning=activeEditor===editor&&getState().user?.id===editorUserId;dialog.removeEventListener('cancel',preventClosing);editor.destroy();if(activeEditor===editor)activeEditor=null;if(returning)onClose?.(); }, { once: true });
    function chooseTemplate() {
      if (!isCurrent()) return;
      openLibrary({ onSelect: async template => {
        if (!isCurrent()) return;
        try {
          if (template.kind === 'block') {
            blocksError([...(editor.getValue()), ...(template.blocks || [])]);
            for (const block of template.blocks || []) editor.appendBlock(block);
            return;
          }
          if (editor.hasDraft() || editor.getValue().length || title.value.trim() || editor.getNotes().trim() || editor.getDocument()?.text.trim()) {
            if (!await confirmAction('Remplacer l’entraînement ?', 'Cet entraînement remplacera le texte et les étapes actuellement saisis. La date et le verrouillage resteront inchangés.', 'Utiliser l’entraînement')) return;
          }
          if (!isCurrent()) return;
          blocksError(template.blocks || []); editor.setValue(template.blocks || [], [template.description, template.notes].filter(Boolean).join('\n\n'), template.workout_document || null);
          const templateColor=template.workout_document?.banner_color||'sand', colorControl=bannerColors.querySelector(`input[value="${templateColor}"]`);
          bannerBaseline=templateColor;bannerExplicit=Object.hasOwn(template.workout_document||{},'banner_color');
          if(colorControl)colorControl.checked=true;
          title.value = template.title || '';
          const templateSport = template.sport === 'sparring' ? 'boxing' : template.sport || 'other';
          if (![...sport.options].some(option => option.value === templateSport)) sport.append(el('option', { value: templateSport }, sportName(templateSport)));
          sport.value = templateSport; editor.setSport(sport.value); changed();
        } catch (err) { showError(error, err); }
      } });
    }
    if (libraryAvailable() && !templateOnly) {
      keep = button('Enregistrer en bibliothèque', async () => {
        if (modelSaving) return;
        error.hidden = true;
        try {
          if (!libraryAvailable() || !isCurrent()) throw new Error('Le compte actif a changé. Rouvre la séance.');
          if (!title.value.trim()) throw new Error('Donne un titre à ton entraînement.');
          const blocks = editor.getValue(); blocksError(blocks);
          const savedRevision = revision; modelSaving = true;
          await busy(keep, () => api.saveTemplate({ title: title.value.trim(), sport: sport.value, description: '', notes: editor.getNotes().trim(), blocks, workout_document: workoutDocument(), kind: 'session', coach_id: editorUserId }));
          if (!isCurrent()) return;
          keep.disabled = savedRevision === revision; keep.textContent = savedRevision === revision ? 'Entraînement enregistré' : 'Enregistrer en bibliothèque'; toast('Séance gardée dans ta bibliothèque. Aucune date n’a été planifiée.');
        } catch (failure) { if (isCurrent()) showError(error, failure); }
        finally { modelSaving = false; }
      }, 'button secondary');
      form.querySelector('.dialog-actions').prepend(keep);
      form.addEventListener('input', changed);
      form.addEventListener('change', changed);
    }
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saving || !form.reportValidity()) return;
      error.hidden = true;
      try {
        if (!title.value.trim()) throw new Error('Donne un titre à la séance.');
        if (templateOnly) {
          if (!isCurrent() || !libraryAvailable()) throw new Error('Le compte actif a changé.');
          const blocks = editor.getValue(); blocksError(blocks);
          saving = true;
          await busy(submit, async () => {
            const data = await getApi();
            if (!isCurrent() || !libraryAvailable()) return;
            const payload={ title: title.value.trim(), sport: sport.value, description: '', notes: editor.getNotes().trim(), blocks, workout_document: workoutDocument(), kind: existing?.kind||session?.kind||'session', folder_id:templateFolder.value||null };
            if(existing)await data.updateTemplate(payload,existing);else await data.saveTemplate({...payload,coach_id:editorUserId});
            if (isCurrent()) { dialog.close(); toast('Entraînement enregistré dans ta bibliothèque.'); }
          });
          return;
        }
        if (!isCurrent() || (existing ? !canEdit(existing) : !canAdd())) throw new Error('Tes permissions ont changé. Actualise le calendrier.');
        const blocks = editor.getValue(); blocksError(blocks);
        const current = getState();
        if (!sameContext()) throw new Error('Le calendrier actif a changé. Rouvre la séance.');
        const payload = { title: title.value.trim(), sport: sport.value, date: day.value,
          sort_order: existing && existing.date === day.value ? existing.sort_order : nextOrder(current.sessions, day.value, existing?.id),
          description: '', notes: editor.getNotes().trim(), blocks, workout_document: workoutDocument() };
        if (!existing) Object.assign(payload, { athlete_id: athlete.id, created_by: current.user.id });
        if(recipients) {
          const selected=recipients.value();
          if(!selected.athlete_ids.length&&!selected.group_ids.length)throw new Error('Choisis au moins une personne ou un groupe.');
          Object.assign(payload,selected);
        }
        if(groupContext&&!recipients&&!existing)throw new Error('Les groupes sont indisponibles. Actualise le calendrier.');
        if (!existing || existing.created_by === current.user.id && lock.control.checked !== (existing.is_locked !== false)) payload.is_locked = lock.field.hidden ? true : lock.control.checked;
        saving = true;
        await busy(submit, async () => {
          const data = await getApi();
          if (!existing || existing.date !== payload.date) {
            const targetDay = groupContext ? await data.loadGroupCalendar(contextId, payload.date, payload.date) : await data.loadCalendar(athlete.id, payload.date, payload.date);
            payload.sort_order = nextOrder(targetDay.sessions, payload.date, existing?.id);
          }
          if (!isCurrent()) return;
          if (existing ? !canEdit(existing) : !canAdd()) throw new Error('Tes permissions ont changé. Actualise le calendrier.');
          await data.saveSession(payload, existing); await finish(dialog, existing ? 'Séance mise à jour.' : 'Séance planifiée.', isCurrent);
        });
      } catch (err) { if (isCurrent()) showError(error, err); }
      finally { saving = false; }
    });
    show(dialog, title);
  }

  function feedbackSection(session, version, completion) {
    const state = getState(), feedback = (state.feedback || []).find(item => item.session_id === session.id);
    const section = el('section', { class: 'feedback-section post-session-review', 'aria-label':'Bilan de la séance' }, el('h3', {}, 'Bilan'));
    if (!session.completed_at) return el('p', { class: 'post-session-hint muted' }, 'Le bilan sera disponible une fois la séance marquée comme faite.');
    if (!ownsAthlete() || session.athlete_id !== state.selectedAthlete.id) {
      if (state.relation?.can_view_feedback === false) { section.append(el('p', { class: 'muted' }, 'L’athlète ne partage pas ses feedbacks avec toi.')); return section; }
      if (!feedback) { section.append(el('p', { class: 'muted' }, 'L’athlète n’a pas encore partagé son retour.')); return section; }
      const feeling = FEELINGS.find(item => item.value === feedback.feeling);
      if (feedback.rpe != null) section.append(el('span', { class: 'feedback-score' }, `RPE ${feedback.rpe}/10`));
      if (feeling) section.append(el('span', { class: 'feedback-score' }, `${feeling.emoji} ${feeling.label} · ${feeling.value}/5`));
      if (feedback.comment) section.append(el('p', { class: 'feedback-read' }, feedback.comment));
      return section;
    }
    const rpe = select('rpe', [{ value: '', label: 'Choisir un effort' }, ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: `${index + 1}/10${index === 0 ? ' · très facile' : index === 9 ? ' · maximal' : ''}` }))], feedback?.rpe == null ? '' : String(feedback.rpe), { required: true });
    const feelingGroup = el('fieldset', {}, el('legend', { class: 'feedback-label' }, 'Comment te sentais-tu ?'));
    const choices = el('div', { class: 'feeling-options' });
    FEELINGS.forEach(feeling => choices.append(el('label', { class: 'feeling-choice' }, el('input', { type: 'radio', name: 'feeling', value: String(feeling.value), required: true, checked: feedback?.feeling === feeling.value }), el('span', {}, feeling.emoji, el('small', {}, `${feeling.value} · ${feeling.label}`)))));
    feelingGroup.append(choices); feelingGroup.style.border = '0'; feelingGroup.style.padding = '0'; feelingGroup.style.margin = '0';
    const comment = textarea('comment', feedback?.comment || '', { maxLength: 20000 });
    const error = errorBox(), status = el('p',{class:'feedback-save-status muted',role:'status'},'Enregistrement automatique');
    const retry = button('Réessayer', () => saveFeedback(), 'button secondary', {hidden:true});
    const form = el('form', {}, field('Effort perçu · RPE', rpe, '1 = très facile · 10 = effort maximal'), feelingGroup, field('Commentaire', comment), status, error, retry);
    const userId = state.user.id;
    const isCurrent = () => getState().user?.id === userId && version === detailGeneration && ownsSession(session);
    const values = () => ({p_session_id:session.id,p_rpe:Number(rpe.value),p_feeling:Number(form.querySelector('input[name="feeling"]:checked')?.value),p_comment:comment.value.trim()});
    let saving = false, queued = false, savedSignature = feedback ? JSON.stringify(values()) : '';
    async function saveFeedback() {
      if (!isCurrent()) return;
      if (saving) { queued = true; return; }
      const payload = values();
      if (!Number.isInteger(payload.p_rpe) || payload.p_rpe < 1 || payload.p_rpe > 10 || !Number.isInteger(payload.p_feeling) || payload.p_feeling < 1 || payload.p_feeling > 5) { status.textContent='Choisis ton RPE et ton ressenti.'; return; }
      const signature = JSON.stringify(payload);
      if (signature === savedSignature) { status.textContent='Bilan enregistré'; return; }
      const toggle = completion.querySelector('.completion-button');
      error.hidden = true; retry.hidden = true; saving = true; if (toggle) toggle.disabled = true;
      status.textContent='Enregistrement…';
      try {
        const current = getState().sessions?.find(item => item.id === session.id);
        if (!(current || session).completed_at) throw new Error('Marque d’abord cette séance comme faite.');
        await (await getApi()).rpc('save_session_feedback', payload);
        savedSignature = signature;
        if (!isCurrent()) return;
        const list = getState().feedback || (getState().feedback = []);
        const saved = {session_id:session.id,rpe:payload.p_rpe,feeling:payload.p_feeling,comment:payload.p_comment};
        const existing = list.find(item => item.session_id === session.id);
        if (existing) Object.assign(existing,saved); else list.push(saved);
        status.textContent='Bilan enregistré';
        try { await refresh(); } catch { if (isCurrent()) status.textContent='Bilan enregistré · calendrier à actualiser'; }
      } catch (err) { if (isCurrent()) { status.textContent='Bilan non enregistré';showError(error,err);retry.hidden=false; } }
      finally { saving=false;if(toggle)toggle.disabled=false; if(queued && isCurrent()){queued=false;void saveFeedback();} }
    }
    let commentTimer;
    const flush = () => {clearTimeout(commentTimer);void saveFeedback();};
    form.addEventListener('change', flush);
    comment.addEventListener('blur', flush);
    comment.addEventListener('input',()=>{status.textContent='Modification en cours…';clearTimeout(commentTimer);commentTimer=setTimeout(flush,600);});
    form.addEventListener('submit', event => {event.preventDefault();void saveFeedback();});
    section.append(form); return section;
  }

  function showSession(session) {
    const version = ++detailGeneration;
    const dialog = $('detailDialog'), content = $('detailContent');
    const error = errorBox(), body = el('div', { class: 'dialog-body' });
    body.append(el('div', { class: 'detail-meta' }, el('span', {}, sportName(session.sport)), el('span', {}, dateLabel(session.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })), el('span', {}, `Créée par ${session.author_name || 'son auteur'}`), accessStatus(!!session.shared_session_id || session.is_locked !== false)));
    if(session.shared_session_id&&!session.is_group_session)body.append(el('p',{class:'session-shared-note'},'Séance commune : son auteur gère le contenu pour tous les destinataires. Ta réalisation et ton bilan restent individuels.'));
    const workout = el('div');
    if (session.workout_document) {
      renderTrainingDocument(workout, session.workout_document);
      const partial=parseTrainingText(session.workout_document.text,{sport:session.sport}).errors.length>0;
      body.append(workout, renderSessionChart(session, { compact: false, partial }));
    } else {
      if (session.description) body.append(el('p', { class: 'session-intro' }, session.description));
      renderWorkout(workout, session.blocks || [], { sport: session.sport }); body.append(workout);
      if (['boxing', 'sparring'].includes(session.sport)) workout.prepend(renderSessionChart(session, { compact: false }));
      if (session.notes) body.append(el('p', { class: 'note-box' }, session.notes));
    }
    body.append(error, session.is_group_session ? el('p',{class:'session-shared-note'},'Séance commune du groupe. Chaque athlète indique sa réalisation et son bilan dans son propre calendrier.') : completionSection(session, dialog, version));
    const actions = el('footer', { class: 'dialog-actions' });
    if (onTimer) actions.append(button('Timer', () => onTimer(session), 'button primary', { 'aria-label': `Ouvrir le timer de ${session.title}` }));
    if (canDelete(session)) actions.append(deleteButton(session,'session',dialog,error,version));
      if (canEdit(session)) actions.append(button(session.shared_session_id?'Modifier la séance commune':'Modifier / déplacer', () => { dialog.close(); editSession(session); }));
      if (canAdd()) actions.append(button('Dupliquer', () => { dialog.close(); editSession(session, session.date, true); }));
    if (libraryAvailable()) {
      const save = button('Enregistrer en bibliothèque', async () => {
        try { await busy(save, async () => { blocksError(session.blocks || []); await (await getApi()).saveTemplate({ title: session.title, sport: session.sport, description: session.description || '', notes: session.notes || '', blocks: session.blocks || [], workout_document: session.workout_document || null, kind: 'session', coach_id: getState().user.id }); toast('Séance enregistrée dans ta bibliothèque.'); }); } catch (err) { showError(error, err); }
      }); actions.append(save);
    }
    actions.append(button('Fermer', () => dialog.close()));
    content.replaceChildren(heading(session.title, 'SÉANCE PLANIFIÉE', dialog, 'detailTitle'), body, actions); show(dialog);
  }

  function editEvent(event = null, date = todayLocal()) {
    if (event ? !eventVisible(event) || !canEdit(event) : !canAdd()) { toast('Tu n’as pas la permission de modifier cette note.'); return; }
    const request=++editRequest;
    if(event?.shared_event_id&&!event.is_group_event) {
      const userId=getState().user?.id, athleteId=getState().selectedAthlete?.id, details=detailGeneration;
      return api.getSharedEvent(event.shared_event_id).then(shared=>{
        if(request!==editRequest||details!==detailGeneration||getState().user?.id!==userId||getState().selectedAthlete?.id!==athleteId)return;
        editEvent(shared,date);
      }).catch(error=>{if(request===editRequest&&details===detailGeneration&&getState().user?.id===userId)toast(error.message||'Impossible de charger la note commune.');});
    }
    const state = getState(), athleteId = state.selectedAthlete?.id||null, editorUserId = state.user.id;
    const contextId=state.selectedGroup?.id||athleteId, groupContext=!!state.selectedGroup;
    const sameContext=()=>!!getState().selectedGroup===groupContext&&(getState().selectedGroup?.id||getState().selectedAthlete?.id)===contextId;
    const isCurrent = () => request===editRequest && getState().user?.id === editorUserId && sameContext() && dialog.open;
    if(!contextId){toast('Choisis un calendrier.');return;}
    if(event&&!event.is_group_event&&event.athlete_id!==athleteId){toast('Ouvre le calendrier de cette note avant de la modifier.');return;}
    const dialog = $('eventDialog'), container = $('eventDialogContent');
    const title = input('title', event?.title || '', 'text', { required: true, maxLength: 200 });
    const options = [...EVENT_CATEGORIES];
    if (event?.category && !options.some(item => item.value === event.category)) options.push({ value: event.category, label: event.category });
    const category = select('category', options, event?.category || 'note', { required: true });
    const dateInput = input('date', event?.date || date, 'date', { required: true });
    const endDate = input('end_date', event?.end_date || '', 'date', { min: event?.date || date });
    dateInput.addEventListener('input', () => { endDate.min = dateInput.value; });
    const notes = textarea('notes', event?.notes || '', { maxLength: 20000 });
    const colors = el('fieldset', { class: 'event-colors' }, el('legend', {}, 'Couleur'));
    for (const choice of EVENT_COLORS) {
      const control = input('event_color', choice.id, 'radio', { checked: choice.id === (event?.color || 'sand'), 'aria-label': choice.label });
      const swatch = el('span', { 'aria-hidden': 'true' }); applyEventColor(swatch, choice.id);
      colors.append(el('label', {}, control, swatch));
    }
    const lock = lockControl(event);
    const creator = !event || event.created_by === state.user.id;
    const privacy = accessControl('is_private', 'Privé · visible seulement par moi', !!event?.is_private, !creator, 'private', 'shared', value => !creator ? 'Seul l’auteur peut changer la visibilité.' : value ? 'Privé · visible seulement par toi.' : 'Partagé · visible par l’athlète et ses coachs autorisés.');
    const visibility = el('p', { class: 'event-visibility', role: 'status' });
    let common=!!event?.is_group_event;
    const updateVisibility = () => { visibility.textContent = common ? 'Note commune · visible par les destinataires, modifiable seulement par son auteur.' : privacy.control.checked ? 'Privé · visible seulement par toi.' : 'Partagé avec l’athlète et ses coachs autorisés.'; };
    const recipients=state.profile?.account_type==='coach'&&state.groupsAvailable&&(!event||event.is_group_event)
      ? createRecipientPicker({athletes:planningAthletes(state),groups:state.groups||[],
          athleteIds:event?.is_group_event?event.athlete_ids||[]:groupContext?[]:[athleteId],
          groupIds:event?.is_group_event?event.group_ids||[]:groupContext?[state.selectedGroup.id]:[],
          onChange:selected=>{common=!!event?.is_group_event||selected.group_ids.length>0||selected.athlete_ids.length>1;lock.field.hidden=common;privacy.field.hidden=common;updateVisibility();}}):null;
    if(common){lock.field.hidden=true;privacy.field.hidden=true;}
    privacy.control.addEventListener('change', updateVisibility); updateVisibility();
    const error = errorBox(), submit = el('button', { type: 'submit', class: 'button primary' }, event ? 'Enregistrer les modifications' : 'Ajouter la note');
    const basics = el('fieldset', { class: 'session-basics event-basics' }, el('legend', {}, 'Note'), field('Titre', title), field('Catégorie', category), el('div', { class: 'form-grid' }, field('Date de début', dateInput), field('Date de fin', endDate, 'Facultative · pour plusieurs jours')), el('div', { class: 'event-access-row' }, visibility, el('div', { class: 'access-controls', role: 'group', 'aria-label': 'Verrouillage et visibilité' }, lock.field, privacy.field)));
    const body = el('div', { class: 'dialog-body' }, basics, recipients?.root, field('Notes', notes), colors, error);
    const form = el('form', {}, body, el('footer', { class: 'dialog-actions' }, button('Annuler', () => dialog.close()), submit));
    container.replaceChildren(heading(event ? 'Modifier la note' : 'Ajouter une note', 'CALENDRIER', dialog, 'eventDialogTitle'), form);
    let saving = false;
    form.addEventListener('submit', async e => {
      e.preventDefault(); if (saving || !form.reportValidity()) return;
      error.hidden = true;
      try {
        if (!title.value.trim()) throw new Error('Donne un titre à ta note.');
        if (endDate.value && endDate.value < dateInput.value) throw new Error('La date de fin doit être égale ou postérieure au début.');
        if (!isCurrent() || (event ? !eventVisible(event) || !canEdit(event) : !canAdd())) throw new Error('Tes permissions ont changé.');
        const payload = { color: colors.querySelector('input:checked').value, title: title.value.trim(), category: category.value, date: dateInput.value, end_date: endDate.value || null, notes: notes.value.trim(), sort_order: event?.sort_order ?? nextOrder(getState().events, dateInput.value) };
        if (!event) Object.assign(payload, { athlete_id: athleteId, created_by: getState().user.id });
        if(recipients) {
          const selected=recipients.value();
          if(!selected.athlete_ids.length&&!selected.group_ids.length)throw new Error('Choisis au moins une personne ou un groupe.');
          Object.assign(payload,selected);
        }
        if(groupContext&&!recipients&&!event)throw new Error('Les groupes sont indisponibles. Actualise le calendrier.');
        if (!event || event.created_by === getState().user.id && lock.control.checked !== (event.is_locked !== false)) payload.is_locked = common ? true : lock.control.checked;
        if (!event || event.created_by === getState().user.id && privacy.control.checked !== !!event.is_private) payload.is_private = common ? false : privacy.control.checked;
        if(common){payload.is_locked=true;payload.is_private=false;}
        saving = true;
        await busy(submit, async () => { await (await getApi()).saveEvent(payload, event); await finish(dialog, event ? 'Note mise à jour.' : 'Note ajoutée.', isCurrent); });
      } catch (err) { if (isCurrent()) showError(error, err); } finally { saving = false; }
    });
    show(dialog, title);
  }

  function showEvent(event) {
    if (!eventVisible(event)) { toast('Cette note est privée.'); return; }
    const version=++detailGeneration;
    const dialog = $('detailDialog'), container = $('detailContent'), error = errorBox();
    const period = dateLabel(event.date, { day: 'numeric', month: 'long', year: 'numeric' }) + (event.end_date && event.end_date !== event.date ? ` → ${dateLabel(event.end_date, { day: 'numeric', month: 'long', year: 'numeric' })}` : '');
    const body = el('div', { class: 'dialog-body' }, el('div', { class: 'detail-meta' }, el('span', {}, EVENT_CATEGORIES.find(item => item.value === event.category)?.label || event.category), el('span', {}, period), accessStatus(!!event.shared_event_id || event.is_locked !== false, event.is_private)), el('p', { class: 'muted' }, `Créée par ${event.author_name || (event.created_by === getState().selectedAthlete?.user_id ? displayName(getState().selectedAthlete) : 'un coach')}.${event.is_private ? ' Privé · visible seulement par toi.' : ''}`), event.notes ? el('p', { class: 'note-box' }, event.notes) : null, error);
    if(event.shared_event_id)body.append(el('p',{class:'session-shared-note'},'Note commune : les modifications de son auteur s’appliquent à tous les destinataires.'));
    const actions = el('footer', { class: 'dialog-actions' });
    if (canDelete(event)) actions.append(deleteButton(event,'event',dialog,error,version));
    if (canEdit(event)) actions.append(button(event.shared_event_id?'Modifier la note commune':'Modifier / déplacer', () => { dialog.close(); editEvent(event); }));
    actions.append(button('Fermer', () => dialog.close()));
    if (body.querySelector('.note-box')) applyEventColor(body.querySelector('.note-box'), event.color);
    container.replaceChildren(heading(event.title, 'NOTE', dialog, 'detailTitle'), body, actions); show(dialog);
  }
  return { editSession, editTemplate: (template=null,options={}) => editSession(template, todayLocal(), template?.source==='starter', { ...options, templateOnly: true }), showSession, editEvent, showEvent, setCompleted };
}

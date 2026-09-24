import { $, el, button, field, input, textarea, select, heading, errorBox, showError, busy, toast, confirmAction, displayName } from './ui.js';
import { SPORTS, BLOCK_TYPES, todayLocal, validateBlocks, summarizeBlocks } from './domain.js';
import { renderWorkout } from './editor.js';
import { ProgramEditor } from './program-editor.js';
import { EVENT_COLORS, applyEventColor } from './event-colors.js';
import { renderSessionChart } from './session-chart.js';
import { dateLabel } from './calendar.js';

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
function show(dialog) { if (!dialog.open) dialog.showModal(); }

/** Shared session/event dialogs with explicit persistence dependency. */
export function createSessionUI({ getState, refresh, openLibrary, canEdit, canAdd, api }) {
  if (!api) throw new Error('Le service de sauvegarde des séances est requis.');
  const getApi = () => Promise.resolve(api);
  let activeEditor = null, detailGeneration = 0;
  const completing = new Set();
  const coach = () => getState().profile?.account_type === 'coach';
  const ownsAthlete = () => {
    const state = getState(); return state.profile?.account_type === 'athlete' && !!state.user?.id && state.selectedAthlete?.user_id === state.user.id;
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
    return section;
  }
  function lockControl(item) {
    const creator = !item || item.created_by === getState().user?.id;
    const control = input('is_locked', '', 'checkbox', { checked: item ? item.is_locked !== false : false, disabled: !creator });
    return { control, field: el('label', { class: 'lock-control' }, control, el('span', {}, 'Verrouiller', el('small', {}, creator ? 'Seul le créateur pourra modifier ou déplacer cet élément.' : 'Seul le créateur peut changer le verrouillage.'))) };
  }
  async function finish(dialog, message, isCurrent = () => true) {
    if (!isCurrent()) return;
    try { await refresh(); if (isCurrent()) { dialog.close(); toast(message); } }
    catch (error) { if (isCurrent()) { dialog.close(); toast(`${message} L’actualisation a échoué : ${error.message || 'réessaie depuis le calendrier'}`); } }
  }
  async function saveBlockTemplate(block, sport) {
    if (!coach()) throw new Error('Seul un coach peut enregistrer un modèle.');
    blocksError([block]);
    const title = (block.title?.trim() || (block.kind === 'repeat' ? 'Répétition' : BLOCK_TYPES.find(type => type.id === block.type)?.label) || 'Bloc réutilisable').slice(0, 200);
    await (await getApi()).saveTemplate({ title, sport, description: '', notes: '', blocks: [block], kind: 'block', coach_id: getState().user.id });
    toast('Bloc enregistré dans tes modèles.');
  }

  function editSession(session = null, date = todayLocal(), duplicate = false, { templateOnly = false } = {}) {
    if (templateOnly ? !coach() : session && !duplicate ? !canEdit(session) : !canAdd()) { toast('Tu n’as pas la permission de planifier cette séance.'); return; }
    const state = getState(), athlete = templateOnly ? { id: null, first_name: 'Bibliothèque privée' } : state.selectedAthlete, editorUserId = state.user?.id;
    if (!athlete) { toast('Choisis d’abord un athlète.'); return; }
    if (session?.athlete_id && session.athlete_id !== athlete.id) { toast('Ouvre le calendrier de cet athlète avant de modifier la séance.'); return; }
    const existing = duplicate ? null : session;
    const dialog = $('sessionDialog'), container = $('sessionDialogContent');
    if (activeEditor) { activeEditor.destroy(); activeEditor = null; }
    const title = input('title', duplicate && !session?.kind ? `${session?.title || 'Séance'} (copie)`.slice(0, 200) : session?.title || '', 'text', { required: true, maxLength: 200, placeholder: 'Ex. Intervalles · allure maîtrisée' });
    const sportOptions = SPORTS.map(item => ({ value: item.id, label: item.label }));
    if (session?.sport && !sportOptions.some(option => option.value === session.sport)) sportOptions.push({ value: session.sport, label: session.sport });
    const sport = select('sport', sportOptions, session?.sport || 'running', { required: true });
    const day = input('date', duplicate ? date : session?.date || date, 'date', { required: true });
    const lock = lockControl(existing), preview = el('div', { class: 'workout-preview' });
    const graph = el('details', { class: 'session-form-details session-program-preview' }, el('summary', {}, 'Aperçu graphique du programme'), preview);
    const editorMount = el('div'), error = errorBox();
    const templates = el('div', { class: 'template-tabs' });
    const body = el('div', { class: 'dialog-body' }, templates, field('Titre de la séance', title), el('div', { class: 'form-grid' }, field('Discipline', sport), templateOnly ? null : field('Date', day)), editorMount, graph, templateOnly ? null : lock.field, error);
    const submit = el('button', { type: 'submit', class: 'button primary' }, templateOnly ? 'Enregistrer dans ma bibliothèque' : existing ? 'Enregistrer les modifications' : 'Planifier la séance');
    const form = el('form', {}, body, el('footer', { class: 'dialog-actions' }, button('Annuler', () => dialog.close()), submit));
    container.replaceChildren(heading(templateOnly ? 'Créer un entraînement' : existing ? 'Modifier la séance' : duplicate ? 'Dupliquer la séance' : 'Planifier une séance', displayName(athlete), dialog, 'sessionDialogTitle'), form);
    let previewBlocks = session?.blocks || [], revision = 0, keep = null, modelSaving = false;
    const changed = () => { revision++; if (keep && !modelSaving) { keep.disabled = false; keep.textContent = 'Garder comme modèle'; } };
    const drawPreview = blocks => {
      changed();
      previewBlocks = blocks; graph.hidden = !['running', 'boxing', 'sparring'].includes(sport.value) || !blocks.length;
      if (sport.value === 'running') renderWorkout(preview, blocks, { sport: 'running', chartOnly: true });
      else preview.replaceChildren(renderSessionChart({ blocks, sport: sport.value }, { compact: false }));
    };
    const editor = new ProgramEditor(editorMount, { blocks: session?.blocks || [], notes: [session?.description, session?.notes].filter(Boolean).join('\n\n'), sport: sport.value, onChange: drawPreview, onSaveBlock: coach() ? block => { if (!isCurrent()) throw new Error('Le compte actif a changé.'); return saveBlockTemplate(block, sport.value); } : null });
    const isCurrent = () => dialog.open && activeEditor === editor && getState().user?.id === editorUserId && (templateOnly || getState().selectedAthlete?.id === athlete.id);
    drawPreview(previewBlocks);sport.addEventListener('change', () => { editor.setSport(sport.value); drawPreview(previewBlocks); });
    activeEditor = editor;
    dialog.addEventListener('close', () => { editor.destroy(); if (activeEditor === editor) activeEditor = null; }, { once: true });
    if (openLibrary && coach()) {
      templates.append(button('Bibliothèque de séances', () => openLibrary({ kind: 'session', onSelect: async template => {
        if (!isCurrent()) return;
        try {
          if (editor.hasDraft() || editor.getValue().length || title.value.trim() || editor.getNotes().trim()) {
            if (!await confirmAction('Remplacer le programme ?', 'Le modèle remplacera les blocs et les consignes actuellement saisis. La date et le verrouillage resteront inchangés.', 'Utiliser le modèle')) return;
          }
          if (!isCurrent()) return;
          blocksError(template.blocks || []); editor.setValue(template.blocks || [], [template.description, template.notes].filter(Boolean).join('\n\n'));
          title.value = template.title || '';
          if (![...sport.options].some(option => option.value === template.sport)) sport.append(el('option', { value: template.sport }, sportName(template.sport)));
          sport.value = template.sport || 'other'; editor.setSport(sport.value); drawPreview(editor.getValue());
        } catch (err) { showError(error, err); }
      } })), button('Mes blocs', () => openLibrary({ kind: 'block', onSelect: template => {
        if (!isCurrent()) return;
        try {
          blocksError([...(editor.getValue()), ...(template.blocks || [])]);
          for (const block of template.blocks || []) editor.appendBlock(block);
        } catch (err) { showError(error, err); }
      } })));
    }
    if (coach() && !templateOnly) {
      keep = button('Garder comme modèle', async () => {
        if (modelSaving) return;
        error.hidden = true;
        try {
          if (!coach() || !isCurrent()) throw new Error('Le compte actif a changé. Rouvre la séance.');
          if (!title.value.trim()) throw new Error('Donne un titre à ton modèle.');
          const blocks = editor.getValue(); blocksError(blocks);
          const savedRevision = revision; modelSaving = true;
          await busy(keep, () => api.saveTemplate({ title: title.value.trim(), sport: sport.value, description: '', notes: editor.getNotes().trim(), blocks, kind: 'session', coach_id: editorUserId }));
          if (!isCurrent()) return;
          keep.disabled = savedRevision === revision; keep.textContent = savedRevision === revision ? 'Modèle enregistré' : 'Garder comme modèle'; toast('Séance gardée dans ta bibliothèque. Aucune date n’a été planifiée.');
        } catch (failure) { if (isCurrent()) showError(error, failure); }
        finally { modelSaving = false; }
      }, 'button secondary');
      form.querySelector('.dialog-actions').prepend(keep);
      form.addEventListener('input', changed);
      form.addEventListener('change', changed);
    }
    let saving = false;
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saving || !form.reportValidity()) return;
      error.hidden = true;
      try {
        if (!title.value.trim()) throw new Error('Donne un titre à la séance.');
        if (templateOnly) {
          if (!isCurrent() || !coach()) throw new Error('Le compte actif a changé.');
          const blocks = editor.getValue(); blocksError(blocks);
          saving = true;
          await busy(submit, async () => {
            const data = await getApi();
            if (!isCurrent() || !coach()) return;
            await data.saveTemplate({ title: title.value.trim(), sport: sport.value, description: '', notes: editor.getNotes().trim(), blocks, kind: 'session', coach_id: editorUserId });
            if (isCurrent()) { dialog.close(); toast('Entraînement enregistré dans ta bibliothèque.'); }
          });
          return;
        }
        if (!isCurrent() || (existing ? !canEdit(existing) : !canAdd())) throw new Error('Tes permissions ont changé. Actualise le calendrier.');
        const blocks = editor.getValue(); blocksError(blocks);
        const current = getState();
        if (current.selectedAthlete?.id !== athlete.id) throw new Error('Le calendrier actif a changé. Rouvre la séance.');
        const payload = { title: title.value.trim(), sport: sport.value, date: day.value,
          sort_order: existing && existing.date === day.value ? existing.sort_order : nextOrder(current.sessions, day.value, existing?.id),
          description: '', notes: editor.getNotes().trim(), blocks };
        if (!existing) Object.assign(payload, { athlete_id: athlete.id, created_by: current.user.id });
        if (!existing || existing.created_by === current.user.id && lock.control.checked !== (existing.is_locked !== false)) payload.is_locked = lock.control.checked;
        saving = true;
        await busy(submit, async () => {
          const data = await getApi();
          if (!existing || existing.date !== payload.date) {
            const targetDay = await data.loadCalendar(athlete.id, payload.date, payload.date);
            payload.sort_order = nextOrder(targetDay.sessions, payload.date, existing?.id);
          }
          if (!isCurrent()) return;
          if (existing ? !canEdit(existing) : !canAdd()) throw new Error('Tes permissions ont changé. Actualise le calendrier.');
          await data.saveSession(payload, existing); await finish(dialog, existing ? 'Séance mise à jour.' : 'Séance planifiée.', isCurrent);
        });
      } catch (err) { if (isCurrent()) showError(error, err); }
      finally { saving = false; }
    });
    show(dialog); title.focus();
  }

  function feedbackSection(session) {
    const state = getState(), feedback = (state.feedback || []).find(item => item.session_id === session.id);
    const section = el('details', { class: 'feedback-section post-session-review' }, el('summary', {}, 'Bilan après la séance · RPE et ressenti'));
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
    const comment = textarea('comment', feedback?.comment || '', { maxLength: 20000, placeholder: 'Ce qui a bien été, une douleur, une adaptation…' });
    const error = errorBox(), submit = el('button', { type: 'submit', class: 'button primary' }, feedback ? 'Mettre à jour mon retour' : 'Partager mon retour');
    const form = el('form', {}, field('Effort perçu · RPE', rpe, '1 = très facile · 10 = effort maximal'), feelingGroup, field('Commentaire', comment), error, submit);
    let saving = false;
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saving || !form.reportValidity()) return;
      error.hidden = true;
      try {
        const feeling = Number(form.querySelector('input[name="feeling"]:checked')?.value), effort = Number(rpe.value);
        if (!Number.isInteger(effort) || effort < 1 || effort > 10 || !Number.isInteger(feeling) || feeling < 1 || feeling > 5) throw new Error('Choisis ton RPE et ton ressenti.');
        if (!ownsSession(session)) throw new Error('Ce feedback ne concerne pas ton calendrier.');
        const current = getState().sessions?.find(item => item.id === session.id);
        if (!(current || session).completed_at) throw new Error('Marque d’abord cette séance comme faite.');
        saving = true;
        await busy(submit, async () => { await (await getApi()).rpc('save_session_feedback', { p_session_id: session.id, p_rpe: effort, p_feeling: feeling, p_comment: comment.value.trim() }); await finish($('detailDialog'), 'Retour partagé avec tes coachs.'); });
      } catch (err) { showError(error, err); } finally { saving = false; }
    });
    section.append(el('p', { class: 'muted' }, 'Facultatif : ton retour concerne la séance complète. Tu peux le remplir plus tard.'), form); return section;
  }

  function showSession(session) {
    const version = ++detailGeneration;
    const dialog = $('detailDialog'), content = $('detailContent');
    const error = errorBox(), body = el('div', { class: 'dialog-body' });
    body.append(el('div', { class: 'detail-meta' }, el('span', {}, sportName(session.sport)), el('span', {}, dateLabel(session.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })), el('span', {}, `Créée par ${session.author_name || 'son auteur'}`), el('span', {class:'lock-badge'}, session.is_locked === false ? 'Partagée · modifiable ensemble' : 'Verrouillée · créateur uniquement')));
    if (session.description) body.append(el('p', { class: 'session-intro' }, session.description));
    const workout = el('div'); renderWorkout(workout, session.blocks || [], { sport: session.sport }); body.append(workout);
    if (['boxing', 'sparring'].includes(session.sport)) workout.prepend(renderSessionChart(session, { compact: false }));
    if (session.notes) body.append(el('p', { class: 'note-box' }, session.notes));
    body.append(error, completionSection(session, dialog, version));
    const actions = el('footer', { class: 'dialog-actions' });
      if (canDelete(session)) {
        const remove = button('Supprimer', async () => {
          if (!await confirmAction('Supprimer cette séance ?', `« ${session.title} » sera supprimée avec son feedback.`, 'Supprimer')) return;
          try { await busy(remove, async () => { if (!canDelete(session)) throw new Error('Tes permissions ont changé.'); await (await getApi()).deleteSession(session); await finish(dialog, 'Séance supprimée.'); }); } catch (err) { showError(error, err); }
        }, 'button secondary left-action');
        actions.append(remove);
      }
      if (canEdit(session)) actions.append(button('Modifier / déplacer', () => { dialog.close(); editSession(session); }));
      if (canAdd()) actions.append(button('Dupliquer', () => { dialog.close(); editSession(session, session.date, true); }));
    if (coach()) {
      const save = button('Enregistrer comme modèle', async () => {
        try { await busy(save, async () => { blocksError(session.blocks || []); await (await getApi()).saveTemplate({ title: session.title, sport: session.sport, description: session.description || '', notes: session.notes || '', blocks: session.blocks || [], kind: 'session', coach_id: getState().user.id }); toast('Séance enregistrée dans tes modèles.'); }); } catch (err) { showError(error, err); }
      }); actions.append(save);
    }
    actions.append(button('Fermer', () => dialog.close()));
    content.replaceChildren(heading(session.title, 'SÉANCE PLANIFIÉE', dialog, 'detailTitle'), body, feedbackSection(session), actions); show(dialog);
  }

  function editEvent(event = null, date = todayLocal()) {
    if (event ? !canEdit(event) : !canAdd()) { toast('Tu n’as pas la permission de modifier cet événement.'); return; }
    const state = getState(), athleteId = state.selectedAthlete.id;
    const dialog = $('eventDialog'), container = $('eventDialogContent');
    const title = input('title', event?.title || '', 'text', { required: true, maxLength: 200, placeholder: 'Ex. Examen de fin de session' });
    const options = [...EVENT_CATEGORIES];
    if (event?.category && !options.some(item => item.value === event.category)) options.push({ value: event.category, label: event.category });
    const category = select('category', options, event?.category || 'note', { required: true });
    const dateInput = input('date', event?.date || date, 'date', { required: true });
    const endDate = input('end_date', event?.end_date || '', 'date', { min: event?.date || date });
    dateInput.addEventListener('input', () => { endDate.min = dateInput.value; });
    const notes = textarea('notes', event?.notes || '', { maxLength: 20000, placeholder: 'Ex. Pas disponible avant 18 h.' });
    const colors = el('fieldset', { class: 'event-colors' }, el('legend', {}, 'Couleur pastel'));
    for (const choice of EVENT_COLORS) {
      const control = input('event_color', choice.id, 'radio', { checked: choice.id === (event?.color || 'sand') });
      const swatch = el('span', {}, choice.label); applyEventColor(swatch, choice.id);
      colors.append(el('label', {}, control, swatch));
    }
    const lock = lockControl(event);
    const error = errorBox(), submit = el('button', { type: 'submit', class: 'button primary' }, event ? 'Enregistrer les modifications' : 'Ajouter l’événement');
    const body = el('div', { class: 'dialog-body' }, el('p', { class: 'muted' }, 'Visible par l’athlète et ses coachs autorisés : rendez-vous, disponibilités, compétition ou note.'), field('Titre', title), field('Catégorie', category), el('div', { class: 'form-grid' }, field('Date de début', dateInput), field('Date de fin', endDate, 'Facultative · pour plusieurs jours')), lock.field, field('Notes', notes), colors, error);
    const form = el('form', {}, body, el('footer', { class: 'dialog-actions' }, button('Annuler', () => dialog.close()), submit));
    container.replaceChildren(heading(event ? 'Modifier l’événement' : 'Ajouter un événement', 'CALENDRIER PARTAGÉ', dialog, 'eventDialogTitle'), form);
    let saving = false;
    form.addEventListener('submit', async e => {
      e.preventDefault(); if (saving || !form.reportValidity()) return;
      error.hidden = true;
      try {
        if (!title.value.trim()) throw new Error('Donne un titre à ton événement.');
        if (endDate.value && endDate.value < dateInput.value) throw new Error('La date de fin doit être égale ou postérieure au début.');
        if (getState().selectedAthlete.id !== athleteId || (event ? !canEdit(event) : !canAdd())) throw new Error('Tes permissions ont changé.');
        const payload = { color: colors.querySelector('input:checked').value, title: title.value.trim(), category: category.value, date: dateInput.value, end_date: endDate.value || null, notes: notes.value.trim(), sort_order: event?.sort_order ?? nextOrder(getState().events, dateInput.value) };
        if (!event) Object.assign(payload, { athlete_id: athleteId, created_by: getState().user.id });
        if (!event || event.created_by === getState().user.id && lock.control.checked !== (event.is_locked !== false)) payload.is_locked = lock.control.checked;
        saving = true;
        await busy(submit, async () => { await (await getApi()).saveEvent(payload, event); await finish(dialog, event ? 'Événement mis à jour.' : 'Événement ajouté.'); });
      } catch (err) { showError(error, err); } finally { saving = false; }
    });
    show(dialog); title.focus();
  }

  function showEvent(event) {
    detailGeneration++;
    const dialog = $('detailDialog'), container = $('detailContent'), error = errorBox();
    const period = dateLabel(event.date, { day: 'numeric', month: 'long', year: 'numeric' }) + (event.end_date && event.end_date !== event.date ? ` → ${dateLabel(event.end_date, { day: 'numeric', month: 'long', year: 'numeric' })}` : '');
    const body = el('div', { class: 'dialog-body' }, el('div', { class: 'detail-meta' }, el('span', {}, EVENT_CATEGORIES.find(item => item.value === event.category)?.label || event.category), el('span', {}, period)), el('p', { class: 'muted' }, `Créé par ${event.author_name || (event.created_by === getState().selectedAthlete.user_id ? displayName(getState().selectedAthlete) : 'un coach')}. ${event.is_locked === false ? 'Modifiable ensemble.' : 'Verrouillé par son créateur.'}`), event.notes ? el('p', { class: 'note-box' }, event.notes) : null, error);
    const actions = el('footer', { class: 'dialog-actions' });
    if (canDelete(event)) {
      const remove = button('Supprimer', async () => {
        if (!await confirmAction('Supprimer cet événement ?', `« ${event.title} » sera retiré de ton calendrier.`, 'Supprimer')) return;
        try { await busy(remove, async () => { if (!canDelete(event)) throw new Error('Tes permissions ont changé.'); await (await getApi()).deleteEvent(event); await finish(dialog, 'Événement supprimé.'); }); } catch (err) { showError(error, err); }
      }, 'button secondary left-action');
      actions.append(remove);
    }
    if (canEdit(event)) actions.append(button('Modifier / déplacer', () => { dialog.close(); editEvent(event); }));
    actions.append(button('Fermer', () => dialog.close()));
    if (body.querySelector('.note-box')) applyEventColor(body.querySelector('.note-box'), event.color);
    container.replaceChildren(heading(event.title, 'ÉVÉNEMENT PERSONNEL', dialog, 'detailTitle'), body, actions); show(dialog);
  }
  return { editSession, editTemplate: () => editSession(null, todayLocal(), false, { templateOnly: true }), showSession, editEvent, showEvent, setCompleted };
}

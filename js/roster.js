import { client as supabase } from "./config.js";
import { createRosterStore } from "./roster-store.js";
import { createRosterAttachmentUI } from './roster-attachment.js';
import { createAthleteAddUI } from './roster-add.js';
import { mountNavigation } from './navigation.js';

  (() => {
    const rosterStore = createRosterStore(supabase);
    const KG_TO_LB = 2.2046226218;
    const statusLabels = { available: "Disponible", unavailable: "Indisponible", injured: "Blessé", sick: "Malade", not_ready: "Pas prêt" };
    const sexLabels = { M: "Homme", F: "Femme" };
    const sexShortLabels = { M: "H", F: "F" };
    let state = { athletes: [], coaches: [] };
    let currentUser;
    let profileData;
    let gymSettings;
    let shareType = "sparring";
    let shareWeight = "both";
    let sortKey = "name";
    let sortDirection = "asc";
    let toastTimer;
    let loadGeneration = 0;
    let attachmentRequest = 0;
    let athleteFormSnapshot = "";
    const formSnapshot = () => JSON.stringify([...document.querySelectorAll("#athleteForm input, #athleteForm select, #athleteForm textarea")].map(field => [field.id, field.value, field.checked]));

    const $ = id => document.getElementById(id);
    const els = {
      athleteRows: $("athleteRows"), athleteEmpty: $("athleteEmpty"), coachGrid: $("coachGrid"), coachEmpty: $("coachEmpty"),
      athleteDialog: $("athleteDialog"), coachDialog: $("coachDialog"), shareDialog: $("shareDialog"), toast: $("toast")
    };
    const attachmentUI = createRosterAttachmentUI({
      document, store: rosterStore,
      getContext: () => ({ userId: currentUser?.id, mode: rosterStore.mode, athletes: state.athletes }),
      onInvite: openAthleteInvitation, onToast: showToast,
      onRefresh: async () => {
        const owner = currentUser?.id, generation = loadGeneration + 1;
        setLoaded(false);
        try { await loadState(); els.athleteDialog.close(); }
        catch (error) {
          if (currentUser?.id === owner && loadGeneration === generation) { state.athletes = []; renderAthletes(); pageError(error); }
          throw error;
        }
      },
    });

    const athleteAddUI = createAthleteAddUI({client:supabase,getUserId:()=>currentUser?.id,onCreateSheet:()=>openAthlete()});

    function uid() { return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2); }
    function todayLocal() {
      const d = new Date();
      return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
    }
    function ageFromBirthDate(value) {
      if (!value) return null;
      const [year, month, day] = value.split("-").map(Number);
      const now = new Date();
      let age = now.getFullYear() - year;
      if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age--;
      return age;
    }
    function athleteFromDb(row, relation = {}) {
      return { id: row.id, userId: row.user_id || null, firstName: row.first_name, lastName: row.last_name || '', birthDate: row.birth_date || '', sex: row.sex || '',
        weightKg: row.weight_kg === null ? null : Number(row.weight_kg), fights: row.fights || 0, wins: row.wins, losses: row.losses,
        status: row.status || 'available', note: relation.private_notes || '', selected: Boolean(relation.selected) && row.status === 'available', updatedAt: row.updated_at,
        relationUpdatedAt: relation.updated_at, canViewCalendar: relation.can_view_calendar === true };
    }
    function coachFromDb(row) { return { id: row.id, firstName: row.first_name, lastName: row.last_name || "", phone: row.phone || "", email: row.email || "" }; }
    function selfCoach() {
      const pieces = (profileData?.full_name || currentUser?.user_metadata?.full_name || "Moi").trim().split(/\s+/);
      return { id: currentUser.id, firstName: pieces.shift() || "Moi", lastName: pieces.join(" "), phone: profileData?.phone || "", email: profileData?.contact_email || currentUser.email || "", isSelf: true };
    }
    function applyGymSettings() {
      $("gymBrand").textContent = gymSettings?.gym_name || "Mon gym";
      document.title = `${gymSettings?.gym_name || "Mon gym"} — Athlètes et listes`;
      $("gymAddress").textContent = gymSettings?.address || "";
    }
    function athleteToDb(athlete) {
      return { first_name: athlete.firstName, last_name: athlete.lastName, birth_date: athlete.birthDate || null, sex: athlete.sex || null,
        weight_kg: athlete.weightKg, fights: athlete.fights, wins: athlete.wins, losses: athlete.losses, status: athlete.status,
        private_notes: athlete.note || '', selected: athlete.selected };
    }
    function coachToDb(coach) { return { coach_id: currentUser.id, first_name: coach.firstName, last_name: coach.lastName || null, phone: coach.phone || null, email: coach.email || null }; }
    function setLoaded(loaded) {
      ['addAthleteButton', 'addCoachButton', 'shareButton'].forEach(id => { $(id).disabled = !loaded; });
    }
    function pageError(error) {
      $('pageError').textContent = `Impossible de charger l’effectif : ${error.message || error}. Recharge la page pour réessayer.`;
      $('pageError').classList.remove('hidden');
    }
    async function loadState() {
      const generation = ++loadGeneration;
      const params = new URLSearchParams(location.search);
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (generation !== loadGeneration) return;
      if (sessionError) throw sessionError;
      currentUser = session?.user;
      if (!currentUser) {
        const target = new URL('login.html', location.href);
        target.search = location.search; target.hash = location.hash;
        location.replace(target.href); return;
      }
      const invitation = params.get('invite');
      if (invitation) {
        const target = new URL('planning.html', location.href);
        target.search = location.search; target.hash = location.hash;
        target.searchParams.set('invite', invitation);
        location.replace(target.href); return;
      }
      const profile = await rosterStore.loadProfile(currentUser.id);
      if (generation !== loadGeneration) return;
      profileData = profile;
      if (profileData.account_type === 'athlete') {
        const target = new URL('planning.html', location.href);
        target.search = location.search; target.hash = location.hash;
        location.replace(target.href); return;
      }
      if (profileData.account_type !== 'coach') throw new Error('Le rôle de ton compte n’est pas reconnu.');
      const [athletes, coachesResult, gymResult] = await Promise.all([
        rosterStore.loadAthletes(),
        supabase.from('coach_contacts').select('id,first_name,last_name,phone,email').eq('coach_id', currentUser.id).order('last_name'),
        supabase.from('gym_settings').select('id,gym_name,address').eq('coach_id', currentUser.id).single(),
      ]);
      if (generation !== loadGeneration) return;
      if (coachesResult.error || gymResult.error) throw (coachesResult.error || gymResult.error);
      if(rosterStore.mode==='modern') {
        const contact=await supabase.from('athletes').select('email').eq('user_id',currentUser.id).limit(1);
        if(generation!==loadGeneration)return;if(contact.error)throw contact.error;
        profileData.contact_email=contact.data?.[0]?.email||null;
      }
      gymSettings = gymResult.data;
      state = { athletes: athletes.map(({ row, relation }) => athleteFromDb(row, relation)), coaches: [selfCoach(), ...coachesResult.data.map(coachFromDb)] };
      $('pageError').classList.add('hidden');
      applyGymSettings();
      mountNavigation({role:profileData.account_type,isAdmin:profileData.is_admin});
      $('adminButton').classList.toggle('hidden', !profileData.is_admin);
      setLoaded(true);
      renderAll();
    }
    function saveState(message) {
      renderAll();
      if (message) showToast(message);
    }
    function showToast(message) {
      clearTimeout(toastTimer); els.toast.textContent = message; els.toast.classList.remove("hidden");
      toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 2500);
    }
    function node(tag, attrs = {}, text = "") {
      const el = document.createElement(tag);
      Object.entries(attrs).forEach(([key, value]) => {
        if (key === "class") el.className = value;
        else if (key === "ariaLabel") el.setAttribute("aria-label", value);
        else if (key.startsWith("data-")) el.setAttribute(key, value);
        else if (key in el) el[key] = value;
        else el.setAttribute(key, value);
      });
      if (text !== "") el.textContent = text;
      return el;
    }
    function formatNumber(n) { return Number(n).toLocaleString("fr-CA", { maximumFractionDigits: 1 }); }
    function coachName(c) { return [c.firstName, c.lastName].filter(Boolean).join(" "); }
    function recordText(a) {
      const base = `${a.fights} combat${a.fights === 1 ? "" : "s"}`;
      return a.wins !== null && a.losses !== null ? `${base} (${a.wins}-${a.losses})` : base;
    }
    function athleteMatches(a) {
      const q = $("searchInput").value.trim().toLocaleLowerCase("fr-CA");
      const status = $("statusFilter").value;
      const sex = $("sexFilter").value;
      return (!q || `${a.firstName} ${a.lastName}`.toLocaleLowerCase("fr-CA").includes(q)) && (status === "all" || a.status === status) && (sex === "all" || a.sex === sex);
    }
    function athleteSortValue(a, key) {
      if (key === "age") return ageFromBirthDate(a.birthDate) ?? -1;
      if (key === "sex") return sexLabels[a.sex] || "";
      if (key === "weight") return a.weightKg ?? -1;
      if (key === "fights") return a.fights;
      if (key === "status") return statusLabels[a.status];
      return `${a.lastName} ${a.firstName}`.trim();
    }
    function compareAthletes(a, b) {
      const av = athleteSortValue(a, sortKey), bv = athleteSortValue(b, sortKey);
      let result = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "fr", { sensitivity: "base" });
      if (result === 0) result = `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, "fr", { sensitivity: "base" });
      return sortDirection === "asc" ? result : -result;
    }
    function updateSortHeaders() {
      $('mobileSort').value=sortKey;
      $('mobileSortDirection').textContent=sortDirection==='asc'?'↑':'↓';
      $('mobileSortDirection').setAttribute('aria-label',sortDirection==='asc'?'Tri croissant : inverser':'Tri décroissant : inverser');
      document.querySelectorAll(".sort-button").forEach(button => {
        const active = button.dataset.sort === sortKey;
        button.querySelector(".sort-arrow").textContent = active ? (sortDirection === "asc" ? "▲" : "▼") : "↕";
        button.closest("th").setAttribute("aria-sort", active ? (sortDirection === "asc" ? "ascending" : "descending") : "none");
      });
    }
    function renderAthletes() {
      const athletes = state.athletes.filter(athleteMatches).sort(compareAthletes);
      updateSortHeaders();
      els.athleteRows.replaceChildren();
      athletes.forEach(a => {
        const tr = node("tr", { class: a.selected ? "selected" : "" });
        const checkTd = node("td", { class: "check-cell" });
        const check = node("input", { type: "checkbox", checked: a.selected, disabled: a.status !== "available", ariaLabel: `Sélectionner ${a.firstName} ${a.lastName}` });
        check.addEventListener('change', async () => {
          const previous = a.selected;
          const selected = check.checked;
          check.disabled = true;
          try {
            await rosterStore.saveAthlete(a.id, { selected });
            a.selected = selected;
          } catch (error) {
            a.selected = previous;
            showToast(`Sélection non enregistrée : ${error.message}`);
          } finally { renderAthletes(); }
        });
        checkTd.append(check); tr.append(checkTd);

        const nameTd = node("td", { class: "athlete-name-cell" });
        const calendarAvailable = a.userId && a.canViewCalendar;
        const nameButton = calendarAvailable
          ? node("a", { class: "name-button roster-calendar-link", href: `planning.html?athlete=${encodeURIComponent(a.id)}`, title: `Ouvrir le calendrier de ${a.firstName} ${a.lastName}` }, `${a.firstName} ${a.lastName}`)
          : node("button", { class: "name-button", type: "button" }, `${a.firstName} ${a.lastName}`);
        if (!calendarAvailable) nameButton.addEventListener("click", () => openAthlete(a.id));
        nameTd.append(nameButton);
        if (a.note) nameTd.append(node("span", { class: "subtext" }, a.note));
        tr.append(nameTd);

        const age = ageFromBirthDate(a.birthDate);
        const ageTd = node("td");
        ageTd.append(node("strong", {}, age === null ? "—" : `${age} ans`));
        tr.append(ageTd);
        const sexTd = node("td");
        sexTd.append(node("span", { class: "chip sex-full" }, sexLabels[a.sex] || "—"));
        tr.append(sexTd);
        const weightTd = node("td");
        weightTd.append(node("strong", {}, a.weightKg === null ? "—" : `${formatNumber(a.weightKg)} kg`));
        if (a.weightKg !== null) weightTd.append(node("span", { class: "subtext" }, `${formatNumber(a.weightKg * KG_TO_LB)} lb`));
        tr.append(weightTd);
        tr.append(node("td", {}, recordText(a)));
        const statusTd = node("td"); statusTd.append(node("span", { class: `status ${a.status}` }, statusLabels[a.status])); tr.append(statusTd);
        const editTd = node("td", { class: "athlete-actions-cell" });
        const edit = node("button", { class: "edit athlete-edit", type: "button", ariaLabel: `Modifier la fiche de ${a.firstName} ${a.lastName}` });
        edit.append(node("span", {class:"roster-edit-label"}, "Modifier"),node("span", {class:"roster-edit-icon",ariaHidden:"true"}, "✎"));
        edit.addEventListener("click", () => openAthlete(a.id)); editTd.append(edit);
        tr.append(editTd);
        [...tr.children].forEach((cell,index)=>{cell.dataset.label=['Choisir','Athlète','Âge','Sexe','Poids','Combats','Statut','Action'][index];});
        els.athleteRows.append(tr);
      });
      els.athleteEmpty.classList.toggle("hidden", athletes.length > 0);
      $("athleteFoot").textContent = `${athletes.length} fiche${athletes.length === 1 ? "" : "s"} affichée${athletes.length === 1 ? "" : "s"}`;
      const available = state.athletes.filter(a => a.status === "available").length;
      const selected = state.athletes.filter(a => a.selected && a.status === "available").length;
      $("statAthletes").textContent = state.athletes.length; $("statAvailable").textContent = available; $("statSelected").textContent = selected; $("selectedCount").textContent = selected;
    }
    function renderCoaches() {
      els.coachGrid.replaceChildren();
      state.coaches.forEach(c => {
        const card = node("article", { class: "coach-card" });
        card.append(node("strong", {}, coachName(c)));
        if (c.phone) card.append(node("span", {}, c.phone));
        if (c.email) card.append(node("span", {}, c.email));
        if (c.isSelf) card.append(node('a', {class:'edit',href:'profile.html'}, 'Mon profil'));
        else {const edit=node('button',{class:'edit',type:'button'},'Modifier');edit.addEventListener('click',()=>openCoach(c.id));card.append(edit);}
        els.coachGrid.append(card);
      });
      els.coachEmpty.classList.toggle("hidden", state.coaches.length > 0);
    }
    function renderAll() { renderAthletes(); renderCoaches(); }

    function openAthlete(id = "") {
      $("athleteForm").reset(); $("athleteId").value = id; $("athleteError").classList.add("hidden");
      $("athleteDialogTitle").textContent = id ? "Modifier la fiche" : "Créer une fiche";
      $("deleteAthleteButton").classList.toggle("hidden", !id);
      $("deleteAthleteButton").textContent = rosterStore.mode === "legacy" ? "Supprimer la fiche" : "Retirer de mon effectif";
      const registered = !!state.athletes.find(a=>a.id===id)?.userId;
      ['firstName','lastName','birthDate','sex','status'].forEach(fieldId=>{$(fieldId).disabled=registered;});
      let note=$('registeredProfileNote');
      if(!note){note=node('p',{id:'registeredProfileNote',class:'hint'});$('athleteForm').prepend(note);}
      note.textContent=registered?'Compte lié : l’athlète gère son identité et sa disponibilité. Tu peux ajuster son poids, ses combats, ses victoires et ses défaites. Tes notes restent privées.':'Fiche pour les listes : tu gères toutes ses informations. Un compte et un calendrier ne sont pas obligatoires. Tu pourras rattacher un compte plus tard.';
      $('athleteNote').maxLength = Math.max(20000, state.athletes.find(a => a.id === id)?.note.length || 0);
      if (id) {
        const a = state.athletes.find(x => x.id === id); if (!a) return;
        $("firstName").value = a.firstName; $("lastName").value = a.lastName; $("birthDate").value = a.birthDate;
        $("sex").value = a.sex; $("status").value = a.status; $("weight").value = a.weightKg ?? ""; $("weightUnit").value = "kg";
        $("fights").value = a.fights; $("wins").value = a.wins ?? ""; $("losses").value = a.losses ?? ""; $("athleteNote").value = a.note;
      } else { $("sex").value = ""; $("status").value = "available"; $("weightUnit").value = "kg"; $("fights").value = 0; }
      $('attachAthleteButton').hidden = !id || registered || rosterStore.mode !== 'modern';
      athleteFormSnapshot = formSnapshot();
      updateWeightConversion(); els.athleteDialog.showModal(); setTimeout(() => $(registered?'weight':'firstName').focus(), 0);
    }
    async function openRosterAttachment(id, button) {
      const owner = currentUser?.id, generation = loadGeneration, request = ++attachmentRequest;
      button.disabled = true; button.textContent = 'Chargement…';
      try {
        // Selection and note edits also change row versions. Compare freshly read
        // snapshots, then let the RPC reject changes made after this comparison.
        const athletes = await rosterStore.loadAthletes();
        if (currentUser?.id !== owner || generation !== loadGeneration || request !== attachmentRequest) return;
        state.athletes = athletes.map(({ row, relation }) => athleteFromDb(row, relation));
        renderAthletes();
        attachmentUI.open(id);
      } catch (error) {
        if (currentUser?.id === owner && generation === loadGeneration && request === attachmentRequest) showToast(`Rattachement indisponible : ${error.message}`);
      } finally { button.disabled = false; button.textContent = 'Rattacher un compte'; }
    }
    async function openAthleteInvitation(athlete) {
      const dialog=node('dialog',{'aria-labelledby':'rosterInviteTitle'}),box=node('div',{class:'dialog-box'}),header=node('header',{class:'dialog-head'});
      header.append(node('h2',{id:'rosterInviteTitle'},`Inviter ${athlete.firstName}`));
      const close=node('button',{type:'button',class:'close',ariaLabel:'Fermer'},'×');close.addEventListener('click',()=>dialog.close());header.append(close);
      const content=node('div',{class:'dialog-body'}),status=node('p',{role:'status'},'Création du lien…');content.append(status);box.append(header,content);dialog.append(box);document.body.append(dialog);
      dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();const userId=currentUser?.id;
      try {
        const {data,error}=await supabase.rpc('create_invitation',{p_athlete_id:athlete.id});if(error)throw error;
        if(!dialog.open||currentUser?.id!==userId)return;
        const url=new URL('planning.html',location.href);url.searchParams.set('invite',data.token);
        status.textContent='Partage ce lien pour une nouvelle inscription : l’athlète conservera cette fiche. Si son compte est déjà utilisé, passe plutôt par ton code coach, accepte sa demande, puis utilise « Rattacher un compte » dans la fiche de modification. Le lien est valable 7 jours et remplace le précédent.';
        const label=node('label'),field=node('input',{type:'text',readOnly:true,value:url.href});label.append(node('span',{},'Lien personnel d’invitation'),field);content.append(label);
        const copy=node('button',{type:'button',class:'button'},'Copier le lien');copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url.href);copy.textContent='Lien copié';}catch{field.focus();field.select();status.textContent='Sélectionne et copie le lien ci-dessous.';}});content.append(copy);
      }catch(error){if(dialog.open&&currentUser?.id===userId)status.textContent=error.message||'Impossible de créer le lien.';}
    }
    function athleteError(message) { $("athleteError").textContent = message; $("athleteError").classList.remove("hidden"); }
    async function saveAthlete(event) {
      event.preventDefault();
      $('athleteError').classList.add('hidden');
      const button = event.submitter || $('athleteForm').querySelector('[type="submit"]');
      if (button.disabled) return;
      const id = $('athleteId').value;
      const old = state.athletes.find(a => a.id === id);
      const birthDate = $('birthDate').value;
      const age = ageFromBirthDate(birthDate);
      const hasWeight = $('weight').value.trim() !== '';
      const weightRaw = hasWeight ? Number($('weight').value) : null;
      const weightKg = hasWeight ? ($('weightUnit').value === 'lb' ? weightRaw / KG_TO_LB : weightRaw) : null;
      const fights = Number($('fights').value);
      const hasWins = $('wins').value !== '';
      const hasLosses = $('losses').value !== '';
      const wins = hasWins ? Number($('wins').value) : null;
      const losses = hasLosses ? Number($('losses').value) : null;
      if (!old?.userId && !$('firstName').value.trim()) return athleteError('Le prénom est obligatoire.');
      if (!old?.userId && birthDate && (!Number.isFinite(age) || age < 0 || age > 120 || birthDate > todayLocal())) return athleteError('Inscris une date de naissance valide, ou laisse le champ vide.');
      if (hasWeight && (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 600)) return athleteError('Inscris un poids valide, ou laisse le champ vide.');
      if (!Number.isInteger(fights) || fights < 0 || fights > 999) return athleteError('Le nombre de combats doit être un entier entre 0 et 999.');
      if (old?.userId) {
        if ([wins,losses].some(n=>n!==null&&(!Number.isInteger(n)||n<0)) || (wins??0)+(losses??0)>fights) return athleteError('Les victoires et les défaites ne peuvent pas dépasser le nombre de combats.');
      } else {
        if (hasWins !== hasLosses) return athleteError('Inscris les victoires et les défaites ensemble, ou laisse les deux champs vides.');
        if (hasWins && (!Number.isInteger(wins) || !Number.isInteger(losses) || wins < 0 || losses < 0 || wins + losses !== fights)) return athleteError('Les victoires et les défaites doivent totaliser le nombre de combats.');
      }
      const athlete = { firstName: $('firstName').value.trim(), lastName: $('lastName').value.trim(), birthDate, sex: $('sex').value,
        weightKg: weightKg === null ? null : Math.round(weightKg * 10) / 10, fights, wins, losses, status: $('status').value, note: $('athleteNote').value,
        selected: $('status').value === 'available' ? Boolean(old?.selected) : false };
      button.disabled = true;
      let saved = false;
      try {
        const p_data = athleteToDb(athlete);
        if(old && athlete.note === old.note)delete p_data.private_notes;
        if(old?.userId)for(const key of ['first_name','last_name','birth_date','sex','status'])delete p_data[key];
        await rosterStore.saveAthlete(id, p_data);
        saved = true;
        els.athleteDialog.close();
        await loadState();
        showToast(id ? 'Fiche mise à jour.' : 'Athlète ajouté.');
      } catch (error) {
        if (saved) pageError(error); else athleteError(error.message);
      } finally { button.disabled = false; }
    }
    function updateWeightConversion() {
      const value = Number($("weight").value); if (!value) { $("weightConversion").textContent = ""; return; }
      $("weightConversion").textContent = $("weightUnit").value === "kg" ? `Équivaut à ${formatNumber(value * KG_TO_LB)} lb` : `Équivaut à ${formatNumber(value / KG_TO_LB)} kg`;
    }

    function openCoach(id = "") {
      $("coachForm").reset(); $("coachId").value = id; $("coachError").classList.add("hidden");
      $("coachDialogTitle").textContent = id ? "Modifier le coach" : "Ajouter un coach"; $("deleteCoachButton").classList.toggle("hidden", !id);
      if (id) { const c = state.coaches.find(x => x.id === id); if (!c) return; $("coachFirstName").value = c.firstName; $("coachLastName").value = c.lastName; $("coachPhone").value = c.phone; $("coachEmail").value = c.email; }
      els.coachDialog.showModal(); setTimeout(() => $("coachFirstName").focus(), 0);
    }
    function coachError(message) { $("coachError").textContent = message; $("coachError").classList.remove("hidden"); }
    async function saveCoach(event) {
      event.preventDefault(); $("coachError").classList.add("hidden");
      const firstName = $("coachFirstName").value.trim(), lastName = $("coachLastName").value.trim(), phone = $("coachPhone").value.trim(), email = $("coachEmail").value.trim();
      if (!firstName) return coachError("Le prénom est obligatoire.");
      if (email && !$("coachEmail").checkValidity()) return coachError("Le courriel n’est pas valide.");
      const id = $("coachId").value; const coach = { id: id || uid(), firstName, lastName, phone, email };
      const result = id
        ? await supabase.from("coach_contacts").update(coachToDb(coach)).eq("id", id).select().single()
        : await supabase.from("coach_contacts").insert(coachToDb(coach)).select().single();
      if (result.error) return coachError(result.error.message);
      const saved = coachFromDb(result.data);
      if (id) state.coaches = state.coaches.map(c => c.id === id ? saved : c); else state.coaches.push(saved);
      els.coachDialog.close(); saveState(id ? "Coach mis à jour." : "Coach ajouté.");
    }

    function renderCoachChoices() {
      const wrap = $("coachChoices"); wrap.replaceChildren();
      state.coaches.forEach(c => {
        const box = node("div", { class: "coach-choice", "data-coach-id": c.id });
        const head = node("label", { class: "coach-choice-head" });
        const include = node("input", { type: "checkbox", checked: true, class: "include-coach" });
        head.append(include, node("strong", {}, coachName(c))); box.append(head);
        const methods = node("div", { class: "coach-methods" });
        if (c.phone) { const l = node("label"); l.append(node("input", { type: "checkbox", checked: true, class: "include-phone" }), document.createTextNode(" Téléphone")); methods.append(l); }
        if (c.email) { const l = node("label"); l.append(node("input", { type: "checkbox", checked: false, class: "include-email" }), document.createTextNode(" Courriel")); methods.append(l); }
        box.append(methods); box.addEventListener("change", updateSharePreview); wrap.append(box);
      });
      $("noCoachChoice").classList.toggle("hidden", state.coaches.length > 0);
    }
    function selectedAthletes() { return state.athletes.filter(a => a.selected && a.status === "available").sort(compareAthletes); }
    function formattedDate(value) { if (!value) return ""; return new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
    function shareText() {
      const gym = $("shareGym").value.trim() || "Mon gym"; const athletes = selectedAthletes();
      const lines = [`ATHLÈTES DISPONIBLES POUR ${shareType === "combat" ? "COMBAT" : "SPARRING"}`];
      if ($("includeGymName").checked) lines.push(gym.toUpperCase());
      if ($("includeGymAddress").checked && $("shareGymAddress").value.trim()) lines.push($("shareGymAddress").value.trim());
      if ($("includeDate").checked) lines.push(formattedDate($("shareDate").value));
      lines.push("");
      athletes.forEach(a => {
        const age = ageFromBirthDate(a.birthDate); const kg = `${formatNumber(a.weightKg)} kg`; const lb = `${formatNumber(a.weightKg * KG_TO_LB)} lb`;
        const weight = shareWeight === "kg" ? kg : shareWeight === "lb" ? lb : `${kg} / ${lb}`;
        let experience = `${a.fights} combat${a.fights === 1 ? "" : "s"}`;
        if ($("includeRecord").checked && a.wins !== null && a.losses !== null) experience += ` (${a.wins}-${a.losses})`;
        const details = [sexShortLabels[a.sex], age === null ? null : `${age} ans`, a.weightKg === null ? null : weight, experience].filter(Boolean);
        lines.push(`• ${[a.firstName, a.lastName].filter(Boolean).join(" ")} — ${details.join(", ")}`);
      });
      const contacts = [];
      document.querySelectorAll(".coach-choice").forEach(box => {
        if (!box.querySelector(".include-coach").checked) return;
        const c = state.coaches.find(x => x.id === box.dataset.coachId); if (!c) return;
        const details = [];
        if (box.querySelector(".include-phone")?.checked && c.phone) details.push(c.phone);
        if (box.querySelector(".include-email")?.checked && c.email) details.push(c.email);
        contacts.push(details.length ? `${coachName(c)} — ${details.join(" — ")}` : coachName(c));
      });
      if (contacts.length) lines.push("", "COACHS CONTACTS", ...contacts);
      return lines.join("\n");
    }
    function updateSharePreview() { $("sharePreview").textContent = shareText(); }
    function openShare() {
      $("shareGym").value = gymSettings?.gym_name || "Mon gym"; $("includeGymName").checked = true; $("includeGymAddress").checked = !!gymSettings?.address; $("shareGymAddress").value = gymSettings?.address || ""; $("shareDate").value = todayLocal(); $("shareDate").disabled = false; $("includeDate").checked = true; $("includeRecord").checked = true; shareType = "sparring"; shareWeight = "both";
      setSegment($("typeButtons"), shareType); setSegment($("weightButtons"), shareWeight); renderCoachChoices(); updateSharePreview(); els.shareDialog.showModal();
    }
    function setSegment(group, value) { group.querySelectorAll("button").forEach(b => { const selected=b.dataset.value===value; b.classList.toggle("active",selected);b.setAttribute("aria-pressed",String(selected)); }); }
    async function copyShare() {
      const text = shareText();
      try {
        try { await navigator.clipboard.writeText(text); }
        catch {
          const area = node('textarea', { value: text });
          area.style.position = 'fixed'; area.style.opacity = '0';
          document.body.append(area); area.select();
          let copied;
          try { copied = document.execCommand('copy'); } finally { area.remove(); }
          if (!copied) throw new Error('Copie refusée par le navigateur. Sélectionne le texte de l’aperçu pour le copier.');
        }
        showToast('Liste copiée — prête à envoyer.');
      } catch (error) { showToast(error.message); }
    }
    function guardForm(handler, onError) {
      return async event => {
        event.preventDefault();
        const button = event.submitter || event.currentTarget.querySelector('[type="submit"]');
        if (button.disabled) return;
        button.disabled = true;
        try { await handler(event); }
        catch (error) { onError(error.message || 'Impossible de sauvegarder. Réessaie.'); }
        finally { button.disabled = false; }
      };
    }
    $('attachAthleteButton').addEventListener('click', () => {
      if (formSnapshot() !== athleteFormSnapshot) { athleteError('Enregistre tes modifications avant de rattacher ce compte.'); return; }
      openRosterAttachment($('athleteId').value, $('attachAthleteButton'));
    });
    $("addAthleteButton").addEventListener("click", () => athleteAddUI.open()); $("athleteForm").addEventListener("submit", saveAthlete);
    $("weight").addEventListener("input", updateWeightConversion); $("weightUnit").addEventListener("change", updateWeightConversion);
    $('deleteAthleteButton').addEventListener('click', async () => {
      const id = $('athleteId').value;
      const athlete = state.athletes.find(item => item.id === id);
      if (!athlete) return;
      const legacy = rosterStore.mode === 'legacy';
      const confirmation = legacy
        ? `Supprimer définitivement la fiche de ${athlete.firstName} ${athlete.lastName} et ses notes de ton effectif ? Cette action est irréversible.`
        : `Retirer ${athlete.firstName} ${athlete.lastName} de ton effectif ? Son profil et les liens avec les autres coachs seront conservés.`;
      if (!confirm(confirmation)) return;
      $('deleteAthleteButton').disabled = true;
      try {
        await rosterStore.removeAthlete(id);
        state.athletes = state.athletes.filter(item => item.id !== id);
        els.athleteDialog.close();
        saveState(legacy ? 'Fiche supprimée de ton effectif.' : 'Athlète retiré de ton effectif.');
      } catch (error) { athleteError(error.message); }
      finally { $('deleteAthleteButton').disabled = false; }
    });
    $("addCoachButton").addEventListener("click", () => openCoach()); $("coachForm").addEventListener("submit", guardForm(saveCoach, coachError));
    $('deleteCoachButton').addEventListener('click', async () => {
      const id = $('coachId').value;
      const coach = state.coaches.find(item => item.id === id);
      if (!coach || !confirm(`Supprimer ${coachName(coach)} de tes contacts ?`)) return;
      $('deleteCoachButton').disabled = true;
      try {
        const { error } = await supabase.from('coach_contacts').delete().eq('id', id).eq('coach_id', currentUser.id);
        if (error) throw error;
        state.coaches = state.coaches.filter(item => item.id !== id);
        els.coachDialog.close(); saveState('Contact supprimé.');
      } catch (error) { coachError(error.message); }
      finally { $('deleteCoachButton').disabled = false; }
    });
    [$("searchInput"), $("statusFilter"), $("sexFilter")].forEach(el => el.addEventListener("input", renderAthletes));
    $('rosterViewButtons').addEventListener('click',event=>{
      const view=event.target.closest('[data-view]')?.dataset.view;
      if(!['table','cards'].includes(view))return;
      $('athleteDirectory').dataset.rosterView=view;
      $('rosterViewButtons').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===view)));
    });
    $('mobileSort').addEventListener('change', () => { sortKey=$('mobileSort').value;renderAthletes(); });
    $('mobileSortDirection').addEventListener('click', () => { sortDirection=sortDirection==='asc'?'desc':'asc';renderAthletes(); });
    document.querySelectorAll(".sort-button").forEach(button => button.addEventListener("click", () => {
      if (sortKey === button.dataset.sort) sortDirection = sortDirection === "asc" ? "desc" : "asc";
      else { sortKey = button.dataset.sort; sortDirection = "asc"; }
      renderAthletes();
    }));
    $("resetFilters").addEventListener("click", () => { $("searchInput").value = ""; $("statusFilter").value = "all"; $("sexFilter").value = "all";renderAthletes(); });
    $("shareButton").addEventListener("click", openShare); $("shareGym").addEventListener("input", updateSharePreview); $("shareGymAddress").addEventListener("input", updateSharePreview); $("shareDate").addEventListener("input", updateSharePreview); $("includeRecord").addEventListener("change", updateSharePreview); $("includeGymName").addEventListener("change", updateSharePreview); $("includeGymAddress").addEventListener("change", updateSharePreview);
    $("includeDate").addEventListener("change", () => { $("shareDate").disabled = !$("includeDate").checked; updateSharePreview(); });
    $("typeButtons").addEventListener("click", e => { if (!e.target.dataset.value) return; shareType = e.target.dataset.value; setSegment($("typeButtons"), shareType); updateSharePreview(); });
    $("weightButtons").addEventListener("click", e => { if (!e.target.dataset.value) return; shareWeight = e.target.dataset.value; setSegment($("weightButtons"), shareWeight); updateSharePreview(); });
    $("copyButton").addEventListener("click", copyShare); $("printButton").addEventListener("click", () => window.print());

    function clearPrivateState() {
      attachmentRequest++;
      attachmentUI.invalidate();
      loadGeneration++; rosterStore.reset();
      state = { athletes: [], coaches: [] }; currentUser = null; profileData = null; gymSettings = null;
      document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      document.querySelectorAll('form').forEach(form => form.reset());
      $('sharePreview').textContent = ''; $('shareGym').value = ''; $('shareGymAddress').value = ''; $('coachChoices').replaceChildren();
      $('pageError').textContent = ''; $('pageError').classList.add('hidden'); $('adminButton').classList.add('hidden');
      renderAll(); setLoaded(false); applyGymSettings();
    }
    $('logoutButton').addEventListener('click', async () => {
      $('logoutButton').disabled = true;
      try {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) throw error;
        clearPrivateState();
        location.replace('login.html');
      } catch (error) { showToast(`Déconnexion impossible : ${error.message}`); $('logoutButton').disabled = false; }
    });
    supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') { clearPrivateState(); location.replace('login.html'); }
    });
    document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => $(button.dataset.close).close()));
    document.querySelectorAll("dialog").forEach(dialog => dialog.addEventListener("click", e => { if (e.target === dialog) dialog.close(); }));
    $('birthDate').max = todayLocal();
    window.addEventListener('pageshow', event => { if (event.persisted) { clearPrivateState(); loadState().catch(pageError); } });
    setLoaded(false);
    loadState().catch(pageError);
  })();

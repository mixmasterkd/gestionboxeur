import Sortable from 'sortablejs';
import { $, el, button, field, input, textarea, select, heading, errorBox, showError, busy } from './ui.js';
export const JOURNAL_STATUSES=[['explore','À explorer'],['work','En travail'],['maintain','À entretenir']];
const labels=Object.fromEntries(JOURNAL_STATUSES);
const date=value=>new Intl.DateTimeFormat('fr-CA',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr');
export function createJournalUI({getState,api,makeSortable=(node,options)=>new Sortable(node,options)}) {
 let ticket=0,context='',entries=[],updates=[],view='kanban',archived=false,query='';
 let sortables=[],drag=null,dragSaving=false;
 const destroySortables=()=>{sortables.forEach(sortable=>sortable.destroy());sortables=[];};
 const root=$('journalSection');
 const key=()=>`${getState().user?.id}:${getState().selectedAthlete?.id}`;
 const owns=()=>getState().selectedAthlete?.user_id===getState().user?.id;
 const readable=()=>!!getState().selectedAthlete?.user_id&&(owns()||getState().relation?.status==='accepted'&&getState().relation.can_view_calendar);
 const writable=()=>readable()&&(owns()||getState().relation?.can_add_sessions);
 const current=(version)=>version===context&&version===key()&&!root.hidden;
 const dragStatus=el('p',{class:'journal-drag-status',role:'status','aria-live':'polite'});
 const errors=errorBox(),content=el('div',{class:'journal-content'});
 const search=input('journal_search','','search',{'aria-label':'Rechercher dans le journal'});
 const archiveChoice=select('journal_archive',[{value:'active',label:'Sujets actifs'},{value:'archived',label:'Archives'}],'active',{'aria-label':'Afficher les archives'});
 const modes=el('div',{class:'segmented',role:'group','aria-label':'Vue du journal'});
 for(const [value,label] of [['kanban','Kanban'],['timeline','Chronologie']])modes.append(button(label,()=>{view=value;draw();},'',{dataset:{view:value},'aria-pressed':String(view===value)}));
 const create=button('＋ Sujet',()=>edit(), 'button primary');
 root.replaceChildren(el('div',{class:'journal-toolbar'},modes,create),el('div',{class:'journal-filters'},field('Rechercher',search),archiveChoice),el('p',{class:'muted journal-sharing'},'Partagé avec les coachs qui ont accès à ce calendrier. Les notes du calendrier restent séparées.'),errors,dragStatus,content);
 search.addEventListener('input',()=>{query=normalize(search.value.trim());draw();});
 archiveChoice.addEventListener('change',()=>{archived=archiveChoice.value==='archived';draw();});
 function invalidate(){destroySortables();drag=null;dragStatus.textContent='';ticket++;context='';entries=[];updates=[];content.replaceChildren();$('journalDialog')?.close();}
 async function refresh(){
  if(root.hidden)return;
  const version=key(),request=++ticket;
  if(context!==version){$('journalDialog').close();entries=[];updates=[];query='';search.value='';context=version;}
  destroySortables();errors.hidden=true;create.hidden=!writable();
  if(!readable()){content.replaceChildren(el('p',{},'L’accès au journal suit les autorisations de ce calendrier.'));return;}
  content.replaceChildren(el('p',{role:'status'},'Chargement du journal…'));
  try{const result=await api.loadJournal(getState().selectedAthlete.id);if(request!==ticket||!current(version))return;entries=result.entries;updates=result.updates;draw();}
  catch(error){if(request===ticket&&current(version)){content.replaceChildren(button('Réessayer',refresh));showError(errors,error);}}
 }
 function matching(){return entries.filter(e=>e.archived===archived&&(!query||normalize(`${e.title} ${e.body} ${updates.filter(u=>u.entry_id===e.id).map(u=>u.content).join(' ')}`).includes(query)));}
 function draw(){
  if(!current(context))return;
  modes.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
  destroySortables();content.replaceChildren();const list=matching();
  if(view==='kanban'){
   const board=el('div',{class:'journal-board'});
   const canDrag=writable()&&!archived;
   for(const [status,label] of JOURNAL_STATUSES){
    const items=list.filter(e=>e.status===status);
    const column=el('section',{class:'journal-column','aria-label':label},el('h2',{},label,el('span',{class:'journal-count'},String(items.length))));
    const cards=el('div',{class:'journal-cards',dataset:{status}});
    for(const entry of items){
     const card=el('article',{class:'journal-card',dataset:{entryId:entry.id}});
     if(canDrag)card.append(el('span',{class:'journal-drag-handle','aria-hidden':'true',title:'Glisser pour changer de statut'},'⠿'));
     const open=button('',()=>detail(entry),'journal-card-open',{'aria-label':`Ouvrir ${entry.title}`});
     open.append(el('strong',{},entry.title),el('p',{},entry.body),el('small',{},`${entry.author_name||'Auteur'} · ${date(entry.updated_at)}`));card.append(open);cards.append(card);
    }
    cards.append(el('p',{class:'muted journal-empty'},'Aucun sujet.'));
    column.append(cards);board.append(column);
   }
   content.append(board);
   if(canDrag)for(const cards of board.querySelectorAll('.journal-cards'))sortables.push(makeSortable(cards,{
    group:'journal-status',sort:false,animation:150,draggable:'.journal-card',handle:'.journal-drag-handle',ghostClass:'journal-drag-ghost',chosenClass:'journal-drag-chosen',
    delay:170,delayOnTouchOnly:true,touchStartThreshold:5,fallbackOnBody:true,disabled:dragSaving,
    onMove:()=>!dragSaving&&current(context)&&writable()&&!archived,
    onStart:event=>{drag={version:context,entry:entries.find(e=>e.id===event.item.dataset.entryId)};},
    onEnd:finishDrag,
   }));
  }else{
   const byId=new Map(list.map(e=>[e.id,e]));const feed=updates.filter(u=>byId.has(u.entry_id)).sort((a,b)=>b.created_at.localeCompare(a.created_at));
   if(!feed.length)content.append(el('p',{class:'empty-message'},'Aucune entrée dans cette vue.'));
   for(const update of feed){const entry=byId.get(update.entry_id);const row=el('article',{class:'journal-timeline-entry'},el('small',{},`${date(update.created_at)} · ${update.author_name||'Auteur'}`),button(entry.title,()=>detail(entry),'journal-entry-link'),el('p',{},updateText(update)));content.append(row);}
  }
 }
 async function finishDrag(event){
  const started=drag;drag=null;
  const status=event.to?.dataset.status;
  if(!started||!current(started.version))return;
  if(dragSaving||!writable()||archived||!started.entry||!labels[status]||status===started.entry.status){draw();return;}
  dragSaving=true;errors.hidden=true;dragStatus.textContent='Enregistrement du déplacement…';
  sortables.forEach(sortable=>sortable.option('disabled',true));
  try{
   await save({status},started.entry,started.version);
   if(current(started.version))dragStatus.textContent=`${started.entry.title} : ${labels[status]}.`;
  }catch(error){if(current(started.version)){draw();dragStatus.textContent='';showError(errors,error);}}
  finally{dragSaving=false;if(current(started.version))draw();}
 }
 function updateText(update){return update.kind==='status'?`Statut : ${labels[update.content]||update.content}`:update.kind==='archived'?'Sujet archivé':update.kind==='restored'?'Sujet réactivé':update.kind==='edited'?`Texte modifié\n${update.content}`:update.kind==='created'?`Sujet ouvert\n${update.content}`:update.content;}
 async function save(payload,entry,version){if(!current(version)||!writable())throw new Error('Le journal sélectionné a changé.');const saved=await api.saveJournalEntry(payload,entry);if(!current(version))return null;entries=[...entries.filter(e=>e.id!==saved.id),saved];await refresh();return current(version)?entries.find(e=>e.id===saved.id)||saved:null;}
 function edit(entry=null){
  if(!writable()||entry&&entry.created_by!==getState().user.id)return;
  const version=context,dialog=$('journalDialog'),wrap=$('journalContent'),error=errorBox();
  const title=input('journal_title',entry?.title||'','text',{required:true,maxLength:160});const body=textarea('journal_body',entry?.body||'',{maxLength:20000,rows:6});
  const status=select('journal_status',JOURNAL_STATUSES.map(([value,label])=>({value,label})),entry?.status||'explore');
  const submit=button('Enregistrer',async()=>{try{await busy(submit,async()=>{const name=title.value.trim();if(!name)throw new Error('Indique le sujet.');const saved=await save({...(!entry?{athlete_id:getState().selectedAthlete.id}:{}),title:name,body:body.value.trim(),status:status.value},entry,version);if(saved&&dialog.open&&wrap.contains(error))detail(saved);});}catch(failure){if(current(version)&&wrap.contains(error))showError(error,failure);}},'button primary');
  wrap.replaceChildren(heading(entry?'Modifier le sujet':'Nouveau sujet','',dialog,'journalTitle'),el('div',{class:'dialog-body'},error,field('Sujet',title),field('Texte',body),field('Statut',status)),el('div',{class:'dialog-actions'},button('Annuler',()=>entry?detail(entry):dialog.close()),submit));if(!dialog.open)dialog.showModal();title.focus();
 }
 function detail(entry){
  if(!current(context))return;
  const version=context,dialog=$('journalDialog'),wrap=$('journalContent'),error=errorBox();
  const body=el('div',{class:'dialog-body'},el('p',{class:'muted'},`${entry.author_name||'Auteur'} · ${date(entry.created_at)}`),el('p',{class:'journal-text'},entry.body),error);
  const actions=el('div',{class:'journal-detail-actions'});
  const status=select('journal_status',JOURNAL_STATUSES.map(([value,label])=>({value,label})),entry.status,{disabled:!writable()});
  status.addEventListener('change',async()=>{status.disabled=true;try{const saved=await save({status:status.value},entry,version);if(saved&&dialog.open&&wrap.contains(error))detail(saved);}catch(failure){if(current(version)){status.value=entry.status;showError(error,failure);}}finally{status.disabled=!writable();}});
  actions.append(field('Statut',status));
  if(writable()){
   if(entry.created_by===getState().user.id)actions.append(button('Modifier mon texte',()=>edit(entry)));
   const archive=button(entry.archived?'Réactiver':'Archiver',async()=>{try{await busy(archive,async()=>{const saved=await save({archived:!entry.archived},entry,version);if(saved&&dialog.open&&wrap.contains(error))detail(saved);});}catch(failure){if(current(version)&&dialog.open&&wrap.contains(error))showError(error,failure);}});actions.append(archive);
  }body.append(actions,el('h3',{},'Suivi'));
  for(const update of updates.filter(u=>u.entry_id===entry.id).sort((a,b)=>a.created_at.localeCompare(b.created_at)))body.append(el('article',{class:'journal-update'},el('small',{},`${update.author_name||'Auteur'} · ${date(update.created_at)}`),el('p',{class:'journal-text'},updateText(update))));
  if(writable()&&!entry.archived){const comment=textarea('journal_comment','',{rows:3,maxLength:20000});const add=button('Ajouter au suivi',async()=>{try{await busy(add,async()=>{if(!current(version)||!writable())return;const text=comment.value.trim();if(!text)throw new Error('Écris ton observation ou ton conseil.');await api.addJournalComment(entry.id,text);if(current(version)){await refresh();if(current(version)&&dialog.open&&wrap.contains(error))detail(entries.find(e=>e.id===entry.id)||entry);}});}catch(failure){if(current(version)&&dialog.open&&wrap.contains(error))showError(error,failure);}},'button primary');body.append(field('Observation ou conseil',comment),add);}
  wrap.replaceChildren(heading(entry.title,'',dialog,'journalTitle'),body);if(!dialog.open)dialog.showModal();
 }
 return {refresh,invalidate};
}

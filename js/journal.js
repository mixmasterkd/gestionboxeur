import Sortable from 'sortablejs';
import { $, el, button, field, input, textarea, select, heading, errorBox, showError, busy, openDialog } from './ui.js';
export const JOURNAL_STATUSES=[['explore','À explorer'],['work','En travail'],['maintain','À entretenir']];
const labels=Object.fromEntries(JOURNAL_STATUSES);
const date=value=>new Intl.DateTimeFormat('fr-CA',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr');
export function createJournalUI({getState,api,makeSortable=(node,options)=>new Sortable(node,options)}) {
 let ticket=0,context='',contextKey='',contextSerial=0,entries=[],updates=[],view='kanban',archived=false,query='',openDetail=null;
 let sortables=[],drag=null,dragSaving=false;
 const destroySortables=()=>{sortables.forEach(sortable=>sortable.destroy());sortables=[];};
 const root=$('journalSection');
 const key=()=>`${getState().user?.id}:${getState().selectedAthlete?.id}`;
 const owns=()=>getState().selectedAthlete?.user_id===getState().user?.id;
 const readable=()=>!!getState().selectedAthlete?.user_id&&(owns()||getState().relation?.status==='accepted'&&getState().relation.can_view_calendar);
 const writable=()=>readable()&&(owns()||getState().relation?.can_add_sessions);
 const current=(version)=>version===context&&contextKey===key()&&!root.hidden;
 const canDelete=entry=>writable()&&(owns()||entry.created_by===getState().user?.id);
 const dragStatus=el('p',{class:'journal-drag-status',role:'status','aria-live':'polite'});
 const errors=errorBox(),content=el('div',{class:'journal-content'});
 const search=input('journal_search','','search',{'aria-label':'Rechercher dans le journal'});
 const archiveChoice=el('div',{class:'segmented journal-archive-switch',role:'group','aria-label':'Sujets du journal'});
 for(const [value,label] of [['active','Actifs'],['archived','Archives']])archiveChoice.append(button(label,()=>{archived=value==='archived';draw();},'',{dataset:{archive:value},'aria-pressed':String(value==='active')}));
 const modes=el('div',{class:'segmented',role:'group','aria-label':'Vue du journal'});
 for(const [value,label] of [['kanban','Kanban'],['timeline','Chronologie']])modes.append(button(label,()=>{view=value;draw();},'',{dataset:{view:value},'aria-pressed':String(view===value)}));
 const create=button('＋ Sujet',()=>edit(), 'button primary');
 root.replaceChildren(el('div',{class:'journal-toolbar'},modes,create),el('div',{class:'journal-filters'},field('Rechercher',search),archiveChoice),el('p',{class:'muted journal-sharing'},'Partagé avec les coachs qui ont accès à ce calendrier. Les notes du calendrier restent séparées.'),errors,dragStatus,content);
 search.addEventListener('input',()=>{query=normalize(search.value.trim());draw();});
 function invalidate(){destroySortables();drag=null;dragStatus.textContent='';ticket++;context='';contextKey='';contextSerial++;openDetail=null;entries=[];updates=[];content.replaceChildren();$('journalDialog')?.close();}
 async function refresh({background=false}={}){
  if(root.hidden)return;
  const selectedKey=key(),request=++ticket;
  if(contextKey!==selectedKey){$('journalDialog').close();openDetail=null;entries=[];updates=[];query='';search.value='';contextKey=selectedKey;context=`${selectedKey}:${++contextSerial}`;}
  const version=context;
  destroySortables();errors.hidden=true;create.hidden=!writable();
  if(!readable()){$('journalDialog').close();openDetail=null;content.replaceChildren(el('p',{},'L’accès au journal suit les autorisations de ce calendrier.'));return;}
  if(!background)content.replaceChildren(el('p',{role:'status'},'Chargement du journal…'));
  try{const result=await api.loadJournal(getState().selectedAthlete.id);if(request!==ticket||!current(version))return;entries=result.entries;updates=result.updates;draw();refreshOpenHistory();}
  catch(error){if(request===ticket&&current(version)){if(!background)content.replaceChildren(button('Réessayer',()=>refresh()));else draw();showError(errors,error);if(openDetail&&$('journalContent').contains(openDetail.history))showError(openDetail.historyError,new Error('Le sujet est enregistré, mais le suivi n’a pas pu être actualisé. Réessaie dans un instant.'));}}
 }
 function matching(){return entries.filter(e=>e.archived===archived&&(!query||normalize(`${e.title} ${e.body} ${updates.filter(u=>u.entry_id===e.id).map(u=>u.content).join(' ')}`).includes(query)));}
 function draw(){
  archiveChoice.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.archive==='archived')===archived)));
  if(!current(context))return;
  modes.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
  modes.hidden=archived;
  destroySortables();content.replaceChildren();const list=matching();
  if(archived){
   content.append(el('header',{class:'journal-archive-heading'},el('h2',{},'Sujets archivés'),el('p',{class:'muted'},'Retrouve un sujet avec la recherche, puis ouvre sa fiche pour le consulter ou le réactiver.')));
   const archiveList=el('div',{class:'journal-archive-list',role:'list','aria-label':'Sujets archivés'});
   for(const entry of [...list].sort((a,b)=>b.updated_at.localeCompare(a.updated_at))){
    const card=el('article',{class:'journal-card journal-archive-card',role:'listitem'});
    const open=button('',()=>detail(entry),'journal-card-open',{'aria-label':`Ouvrir ${entry.title}`});
    open.append(el('div',{class:'journal-archive-card-heading'},el('strong',{},entry.title),el('span',{class:'journal-status-badge'},labels[entry.status]||entry.status)),el('p',{},entry.body),el('small',{},`${entry.author_name||'Auteur'} · ${date(entry.updated_at)}`));card.append(open);archiveList.append(card);
   }
   content.append(list.length?archiveList:el('p',{class:'empty-message'},query?'Aucun sujet archivé ne correspond à cette recherche.':'Aucun sujet archivé.'));
  }else if(view==='kanban'){
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
 async function save(payload,entry,version,{detailAfter=null}={}){
  if(!current(version)||!writable())throw new Error('Le journal sélectionné a changé.');
  const saved=await api.saveJournalEntry(payload,entry);
  if(!current(version))return null;
  entries=[...entries.filter(e=>e.id!==saved.id),saved];draw();
  // The saved subject opens before the history read, which can take longer.
  if(detailAfter&&$('journalDialog').open&&$('journalContent').contains(detailAfter))detail(saved);
  await refresh({background:true});
  return current(version)?entries.find(e=>e.id===saved.id)||saved:null;
 }
 function edit(entry=null){
  if(!writable()||entry&&entry.created_by!==getState().user.id)return;
  if(!entry&&archived){archived=false;draw();}
  openDetail=null;
  const version=context,dialog=$('journalDialog'),wrap=$('journalContent'),error=errorBox();
  const title=input('journal_title',entry?.title||'','text',{required:true,maxLength:160});const body=textarea('journal_body',entry?.body||'',{maxLength:20000,rows:6});
  const status=select('journal_status',JOURNAL_STATUSES.map(([value,label])=>({value,label})),entry?.status||'explore');
  const submit=button('Enregistrer',async()=>{try{await busy(submit,async()=>{const name=title.value.trim();if(!name)throw new Error('Indique le sujet.');await save({...(!entry?{athlete_id:getState().selectedAthlete.id}:{}),title:name,body:body.value.trim(),status:status.value},entry,version,{detailAfter:error});});}catch(failure){if(current(version)&&wrap.contains(error))showError(error,failure);}},'button primary');
  wrap.replaceChildren(heading(entry?'Modifier le sujet':'Nouveau sujet','Journal partagé',dialog,'journalTitle'),el('div',{class:'dialog-body'},error,field('Sujet',title),field('Description du sujet (facultative)',body),field('Statut',status),!entry?el('p',{class:'journal-guide'},'Après l’enregistrement, la fiche du sujet s’ouvre pour ajouter tes observations et les conseils des coachs.'):null),el('div',{class:'dialog-actions'},button('Annuler',()=>entry?detail(entry):dialog.close()),submit));openDialog(dialog,title);
 }
 function drawHistory(node,entryId){
  const history=updates.filter(update=>update.entry_id===entryId).sort((a,b)=>a.created_at.localeCompare(b.created_at));
  node.replaceChildren(...(history.length?history.map(update=>el('article',{class:`journal-update${update.kind==='comment'?' journal-update-comment':''}`},el('small',{},`${update.author_name||'Auteur'} · ${date(update.created_at)}`),el('p',{class:'journal-text'},updateText(update)))):[el('p',{class:'muted'},'Le suivi de ce sujet apparaîtra ici.')]));
 }
 function refreshOpenHistory(){
  if(!openDetail||!current(openDetail.version)||!$('journalDialog').open||!$('journalContent').contains(openDetail.history))return;
  const entry=entries.find(item=>item.id===openDetail.entry.id);
  if(!entry){$('journalDialog').close();openDetail=null;return;}
  if(openDetail.writable!==writable()||openDetail.deletable!==canDelete(entry)||openDetail.entry.archived!==entry.archived){detail(entry);return;}
  openDetail.entry=entry;openDetail.historyError.hidden=true;drawHistory(openDetail.history,entry.id);
 }
 function detail(entry){
  if(!current(context))return;
  const version=context,dialog=$('journalDialog'),wrap=$('journalContent'),error=errorBox();
  const history=el('div',{class:'journal-history'}),historyError=errorBox();
  const displayed={version,entry,history,historyError,writable:writable(),deletable:canDelete(entry)};
  openDetail=displayed;
  const body=el('div',{class:'dialog-body journal-detail-body'},el('p',{class:'muted journal-subject-meta'},`${entry.author_name||'Auteur'} · ${date(entry.created_at)}`),entry.body?el('p',{class:'journal-text journal-subject-description'},entry.body):null);
  const actions=el('div',{class:'journal-detail-actions'});
  const status=select('journal_status',JOURNAL_STATUSES.map(([value,label])=>({value,label})),entry.status,{disabled:!writable()||entry.archived});
  status.addEventListener('change',async()=>{status.disabled=true;try{await save({status:status.value},displayed.entry,version,{detailAfter:error});}catch(failure){if(current(version)&&wrap.contains(error)){status.value=displayed.entry.status;showError(error,failure);}}finally{status.disabled=!writable()||displayed.entry.archived;}});
  actions.append(field('Statut',status));
  if(writable()){
   const buttons=el('div',{class:'journal-subject-actions'});
   if(entry.created_by===getState().user.id)buttons.append(button('Modifier mon texte',()=>edit(displayed.entry)));
   const archive=button(entry.archived?'Réactiver':'Archiver',async()=>{try{await busy(archive,async()=>{await save({archived:!displayed.entry.archived},displayed.entry,version,{detailAfter:error});});}catch(failure){if(current(version)&&dialog.open&&wrap.contains(error))showError(error,failure);}});buttons.append(archive);
   actions.append(buttons);
  }
  body.append(actions,error);
  if(writable()&&!entry.archived){
   const comment=textarea('journal_comment','',{rows:3,maxLength:20000,required:true});
   const notice=el('p',{class:'journal-followup-notice',role:'status',hidden:true});
   const add=button('Ajouter au suivi',null,'button primary',{type:'submit'});
   const form=el('form',{class:'journal-followup-form'},el('p',{class:'journal-guide'},'Le sujet décrit ce que tu veux travailler. Ajoute ici tes observations, les conseils reçus et tes progrès au fil des entraînements.'),field('Observation ou conseil',comment),notice,el('div',{class:'journal-followup-actions'},add));
   form.addEventListener('submit',async event=>{
    event.preventDefault();if(add.disabled)return;
    try{await busy(add,async()=>{
     if(!current(version)||!writable()||openDetail!==displayed)return;
     const text=comment.value.trim();if(!text)throw new Error('Écris ton observation ou ton conseil.');
     error.hidden=true;notice.hidden=true;
     const saved=await api.addJournalComment(entry.id,text);
     if(!current(version)||openDetail!==displayed)return;
     if(saved?.id)updates=[...updates.filter(item=>item.id!==saved.id),saved];
     if(comment.value.trim()===text)comment.value='';
     notice.textContent='Ton observation est ajoutée au suivi.';notice.hidden=false;
     drawHistory(history,entry.id);await refresh({background:true});
    });}catch(failure){if(current(version)&&dialog.open&&wrap.contains(error))showError(error,failure);}
   });
   body.append(form);
  }else if(entry.archived)body.append(el('p',{class:'journal-guide'},'Ce sujet est archivé. Son statut et son suivi sont conservés. Réactive-le pour reprendre le travail et ajouter une observation.'));
  body.append(el('h3',{class:'journal-history-title'},'Suivi du sujet'),historyError,history);drawHistory(history,entry.id);
  if(canDelete(entry))body.append(el('div',{class:'journal-delete-area'},button('Supprimer définitivement le sujet',()=>confirmDelete(displayed.entry),'button secondary journal-delete-button')));
  wrap.replaceChildren(heading(entry.title,entry.archived?'Sujet archivé':'Sujet du journal',dialog,'journalTitle'),body);openDialog(dialog,$('journalTitle'));dialog.scrollTop=0;
 }
 function confirmDelete(entry){
  if(!current(context)||!canDelete(entry))return;
  const version=context,dialog=$('journalDialog'),wrap=$('journalContent'),error=errorBox();
  const expectedEntry={...entry},expectedUpdates=updates.filter(update=>update.entry_id===entry.id).map(update=>({...update}));
  openDetail=null;
  const reload=button('Actualiser le sujet',()=>{if(current(version)){detail(entries.find(item=>item.id===entry.id)||entry);void refresh({background:true});}},'button secondary',{hidden:true});
  const remove=button('Supprimer définitivement',async()=>{
   if(remove.disabled)return;
   try{await busy(remove,async()=>{
    if(!current(version)||!canDelete(expectedEntry)||!wrap.contains(error))throw new Error('Le journal ou tes permissions ont changé. Rouvre le sujet.');
    await api.deleteJournalEntry(expectedEntry,expectedUpdates);
    if(!current(version))return;
    entries=entries.filter(item=>item.id!==entry.id);updates=updates.filter(item=>item.entry_id!==entry.id);draw();
    if(wrap.contains(error)){dialog.close();openDetail=null;}
   });}catch(failure){if(current(version)&&wrap.contains(error)){showError(error,failure);reload.hidden=false;}}
  },'button danger-button');
  wrap.replaceChildren(heading('Supprimer ce sujet ?','Suppression définitive',dialog,'journalTitle'),el('div',{class:'dialog-body journal-delete-confirmation'},el('p',{},el('strong',{},entry.title)),el('p',{},`Ce sujet et ses ${expectedUpdates.length} élément${expectedUpdates.length===1?'':'s'} de suivi seront supprimés pour toi et les coachs qui y ont accès.`),el('p',{},'Cette action ne peut pas être annulée.'),error,reload),el('div',{class:'dialog-actions'},button('Annuler',()=>detail(entries.find(item=>item.id===entry.id)||entry)),remove));
  openDialog(dialog,$('journalTitle'));dialog.scrollTop=0;
 }
 return {refresh,invalidate};
}

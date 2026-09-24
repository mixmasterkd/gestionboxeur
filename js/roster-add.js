import {el,button,field,input,heading,errorBox,showError} from './ui.js';

export function createAthleteAddUI({client,getUserId,onCreateSheet,onChanged}) {
 const dialog=el('dialog',{class:'app-dialog athlete-add-dialog','aria-labelledby':'athleteAddTitle'});
 const content=el('div');dialog.append(content);document.body.append(dialog);
 let generation=0,pending=false;
 dialog.addEventListener('close',()=>{generation++;});
 const rpc=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw error;return data;};
 const current=(version,user)=>dialog.open&&generation===version&&getUserId()===user;
 function shell(title) {const body=el('div',{class:'dialog-body'});content.replaceChildren(heading(title,'MES ATHLÈTES',dialog,'athleteAddTitle'),body);return body;}
 async function showPending(body,version,user) {
  const list=el('section',{class:'pending-athlete-invitations'});body.append(list);
  try {
   const invitations=(await rpc('my_coaching_invitations'))||[];
   if(!current(version,user))return;
   const outgoing=invitations.filter(i=>i.direction==='outgoing');if(!outgoing.length)return;
   list.append(el('h3',{},'Invitations en attente'));
   for(const item of outgoing) {
    const error=errorBox(),row=el('article',{class:'connection-card'},el('strong',{},item.athlete_name));
    const cancel=button('Annuler l’invitation',async()=>{
     if(pending)return;pending=true;cancel.disabled=true;
     try{await rpc('cancel_coaching_invitation',{p_invitation_id:item.id});if(current(version,user))row.remove();}
     catch(e){if(current(version,user))showError(error,e);}finally{pending=false;cancel.disabled=false;}
    });row.append(cancel,error);list.append(row);
   }
  } catch(e){if(current(version,user)){const error=errorBox();showError(error,e);list.append(error);}}
 }
 function open() {
  if(pending)return;const version=++generation,user=getUserId();
  const body=shell('Ajouter un athlète');
  body.append(el('div',{class:'athlete-add-choices'},
   button('',()=>findAthlete(),'athlete-add-choice',{'aria-label':'Inviter un athlète'}),
   button('',()=>{dialog.close();onCreateSheet();},'athlete-add-choice',{'aria-label':'Créer une fiche'})));
  const choices=body.querySelectorAll('.athlete-add-choice');
  choices[0].append(el('span',{class:'athlete-add-icon','aria-hidden':'true'},'↗'),el('strong',{},'Inviter un athlète'),el('span',{},'Compte existant · suivi du calendrier après son acceptation.'));
  choices[1].append(el('span',{class:'athlete-add-icon','aria-hidden':'true'},'▤'),el('strong',{},'Créer une fiche'),el('span',{},'Sans compte lié · répertoire et listes de combat ou de sparring.'));
  if(!dialog.open)dialog.showModal();void showPending(body,version,user);
 }
 function findAthlete() {
  const version=++generation,user=getUserId(),body=shell('Inviter un athlète');
  const query=input('athlete_search','','text',{required:true,minLength:2,maxLength:320,autocomplete:'off'}),error=errorBox(),results=el('div',{'aria-live':'polite'});
  const search=el('button',{type:'submit',class:'button primary'},'Rechercher');
  const form=el('form',{},field('Nom ou courriel du compte',query),search,error);
  body.append(button('← Retour',open,'button secondary'),el('p',{class:'muted'},'Recherche son compte par nom ou avec son courriel complet. L’athlète recevra ton invitation sur le site et pourra l’accepter ou la refuser.'),form,results);
  let ticket=0;
  query.addEventListener('input',()=>{ticket++;results.replaceChildren();});
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(pending||!form.reportValidity())return;
   const request=++ticket,term=query.value.trim();pending=true;search.disabled=true;error.hidden=true;results.replaceChildren();
   try {
    const matches=await rpc('search_athletes',{p_query:term});if(!current(version,user)||request!==ticket)return;
    if(!matches?.length){results.append(el('p',{},'Aucun compte trouvé. Vérifie le nom ou le courriel, ou crée une fiche pour ton répertoire.'));return;}
    results.append(el('p',{class:'muted'},matches.length===20?'20 résultats · précise le nom pour affiner la recherche.':`${matches.length} résultat${matches.length>1?'s':''}`));
    for(const match of matches) {
    const card=el('article',{class:'connection-card'},el('h3',{},match.display_name));results.append(card);
    if(match.connection_status==='accepted'){card.append(el('p',{},'Déjà dans ton effectif.'));continue;}
    if(match.connection_status==='pending'){card.append(el('p',{},'Invitation déjà envoyée · en attente de son acceptation.'));continue;}
    const send=button('Envoyer l’invitation',async()=>{
     if(pending||request!==ticket)return;pending=true;send.disabled=true;query.disabled=true;search.disabled=true;
     try {
      await rpc('invite_athlete',{p_athlete_id:match.athlete_id});
      if(!current(version,user))return;
      card.replaceChildren(el('h3',{},match.display_name),el('p',{role:'status'},'Invitation envoyée. Le suivi sera disponible après son acceptation.'));
      await onChanged?.();
     }catch(e){if(current(version,user))showError(error,e);}finally{pending=false;send.disabled=false;query.disabled=false;search.disabled=false;}
    },'button primary',{'aria-label':`Inviter ${match.display_name}`});card.append(send);
    }
   }catch(e){if(current(version,user)&&request===ticket)showError(error,e);}finally{pending=false;search.disabled=false;}
  });query.focus();
 }
 return {open};
}

import { mountCalendarMenu } from './calendar-menu.js';
import { loadAccount, loadTrainingGroups } from './data.js';
import { $, el, button, displayName, initials } from './ui.js';

/** Header shortcuts only: selecting a calendar never filters the personal roster. */
export function mountRosterCalendarMenu() {
  let ticket=0, account=null, groups=[], groupsError='', loading=false;
  const params=new URL(location.href).searchParams;
  const normalize=value=>String(value||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('fr');
  const route=(kind,id,hash='')=>{
    const url=new URL('planning.html',location.href);
    if(kind&&id)url.searchParams.set(kind,id);
    url.hash=hash;return url.href;
  };
  function athletes() {
    if(!account)return [];
    const accepted=new Set(account.relations.filter(r=>r.status==='accepted').map(r=>r.athlete_id));
    return account.athletes.filter(a=>a.user_id===account.user.id||account.profile.account_type==='coach'&&a.user_id&&accepted.has(a.id))
      .sort((a,b)=>Number(b.user_id===account.user.id)-Number(a.user_id===account.user.id));
  }
  function draw() {
    const list=$('athleteList'),query=normalize($('athleteSearch').value);list.replaceChildren();
    if(loading){list.append(el('p',{role:'status'},'Chargement des calendriers…'));return;}
    const entries=athletes().filter(a=>normalize((a.user_id===account.user.id?'Mon calendrier ':'')+displayName(a)).includes(query));
    if(entries.length)list.append(el('h3',{class:'picker-section-title'},'Athlètes'));
    for(const athlete of entries) {
      const personal=athlete.user_id===account.user.id;
      const item=button('',()=>{menu.close();location.assign(route('athlete',athlete.id));},'athlete-item');
      item.append(el('span',{class:'athlete-avatar','aria-hidden':'true'},initials(athlete)),el('span',{},el('strong',{},displayName(athlete)),el('small',{},personal?'Personnel':'Compte lié')));list.append(item);
    }
    const matching=groups.filter(g=>normalize(g.name).includes(query));
    if(matching.length)list.append(el('h3',{class:'picker-section-title'},'Groupes'));
    for(const group of matching) {
      const item=button('',()=>{menu.close();location.assign(route('group',group.id));},'athlete-item');
      item.append(el('span',{class:'athlete-avatar','aria-hidden':'true'},'G'),el('span',{},el('strong',{},group.name),el('small',{},'Calendrier du groupe')));list.append(item);
    }
    if(groupsError)list.append(el('p',{role:'status'},groupsError));
    if(!entries.length&&!matching.length&&!groupsError)list.append(el('p',{},'Aucun calendrier correspondant.'));
  }
  const menu=mountCalendarMenu({dialog:$('athletePickerDialog'),trigger:$('athletePickerButton'),search:$('athleteSearch'),beforeOpen:()=>{$('athleteSearch').value='';draw();return true;}});
  $('athleteSearch').addEventListener('input',draw);
  function clear() {
    ticket++;account=null;groups=[];groupsError='';loading=false;menu.close({restoreFocus:false});
    $('athleteList').replaceChildren();$('athleteTitle').textContent='Mon calendrier';$('athletePickerButton').hidden=true;
    $('libraryButton').href=route(null,null,'bibliotheque');
  }
  async function refresh(user) {
    clear();if(!user)return;
    const current=++ticket;loading=true;$('athletePickerButton').hidden=false;
    try {
      const loaded=await loadAccount(user);if(current!==ticket)return;
      account={...loaded,user};
      if(!loaded.planningAvailable){$('athletePickerButton').hidden=true;return;}
      try {const result=await loadTrainingGroups();if(current!==ticket)return;groups=result.filter(g=>['owner','admin'].includes(g.role)||!g.role&&g.coach_id===user.id);}
      catch {if(current!==ticket)return;groupsError='Les calendriers de groupe sont indisponibles pour le moment.';}
      const group=groups.find(g=>g.id===params.get('group'));
      const athlete=athletes().find(a=>a.id===params.get('athlete'));
      $('athleteTitle').textContent=group?.name||(athlete&&athlete.user_id!==user.id?displayName(athlete):'Mon calendrier');
      $('athletePickerButton').title=$('athleteTitle').textContent;
      $('libraryButton').href=route(group?'group':athlete?'athlete':null,group?.id||athlete?.id,'bibliotheque');
    } catch {if(current===ticket)groupsError='Impossible de charger les calendriers. Recharge la page pour réessayer.';}
    finally {if(current===ticket){loading=false;draw();}}
  }
  return {refresh,clear};
}

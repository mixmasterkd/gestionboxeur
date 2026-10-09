import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {mountCalendarMenu} from '../js/calendar-menu.js';
import * as ui from '../js/ui.js';

async function setup(loadAccount,loadTrainingGroups=async()=>[]) {
 const view=new Window({url:'https://example.test/roster.html',settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
 view.document.write(await readFile(new URL('../roster.html',import.meta.url),'utf8'));
 const old=globalThis.document;globalThis.document=view.document;
 view.__deps={mountCalendarMenu,loadAccount,loadTrainingGroups,...ui};
 const source=await readFile(new URL('../js/roster-calendar-menu.js',import.meta.url),'utf8');
 view.eval('const {mountCalendarMenu,loadAccount,loadTrainingGroups,$,el,button,displayName,initials}=window.__deps;'+source.replace(/^import .*;$/gm,'').replace('export function','function')+'\nwindow.header=mountRosterCalendarMenu();');
 return {view,header:view.header,text:()=>view.document.getElementById('athleteList').textContent,close:async()=>{view.header.clear();await view.happyDOM.abort();globalThis.document=old;}};
}
const account={planningAvailable:true,profile:{account_type:'coach'},relations:[{athlete_id:'accepted',status:'accepted'},{athlete_id:'pending',status:'pending'}],athletes:[{id:'self',user_id:'owner',first_name:'Moi'},{id:'accepted',user_id:'linked',first_name:'Lié'},{id:'pending',user_id:'waiting',first_name:'En attente'},{id:'offline',user_id:null,first_name:'Sans compte'}]};
test('roster chooser lists personal and accepted calendars and only managed groups',async()=>{
 const page=await setup(async()=>account,async()=>[{id:'g1',name:'Mon groupe',role:'admin'},{id:'g2',name:'Membre seulement',role:'member'}]);
 try {
  await page.header.refresh({id:'owner'});
  assert.match(page.text(),/Moi/);assert.match(page.text(),/Lié/);assert.match(page.text(),/Mon groupe/);
  assert.doesNotMatch(page.text(),/En attente|Sans compte|Membre seulement/);
  const search=page.view.document.getElementById('athleteSearch');search.value='lie';search.dispatchEvent(new page.view.Event('input'));
  assert.match(page.text(),/Lié/);assert.doesNotMatch(page.text(),/Moi|Mon groupe/);
  assert.equal(page.view.document.getElementById('libraryButton').hash,'#bibliotheque');
 }finally{await page.close();}
});
test('late calendar reads cannot restore another account after private state is cleared',async()=>{
 let resolve;const page=await setup(()=>new Promise(r=>{resolve=r;}));
 try {
  const pending=page.header.refresh({id:'owner'});page.header.clear();resolve(account);await pending;
  assert.equal(page.text(),'');assert.equal(page.view.document.getElementById('athletePickerButton').hidden,true);
 }finally{await page.close();}
});

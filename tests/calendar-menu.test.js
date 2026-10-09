import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {mountCalendarMenu} from '../js/calendar-menu.js';

for(const width of [390,1440])test(`calendar menu closes, restores focus and cleans layout at ${width}px`,async()=>{
 const view=new Window({width,height:720}),doc=view.document;
 doc.body.innerHTML='<header><button id="trigger">Mon calendrier</button></header><main id="outside">Page</main><dialog id="picker"><h2>Calendriers</h2><input type="search"><button id="choice">Mon calendrier</button></dialog>';
 const dialog=doc.querySelector('dialog'),trigger=doc.getElementById('trigger'),search=doc.querySelector('input');
 trigger.getBoundingClientRect=()=>({left:260,top:12,right:420,bottom:56,width:160,height:44});
 let opens=0;
 const menu=mountCalendarMenu({dialog,trigger,search,beforeOpen:()=>{opens++;return true;}});
 try{
  trigger.click();assert.equal(dialog.open,true);assert.equal(trigger.getAttribute('aria-expanded'),'true');
  assert.equal(doc.activeElement,width<=800?doc.querySelector('h2'):search);
  assert.equal(doc.body.classList.contains('menu-drawer-open'),width<=800);
  if(width>800){assert.equal(dialog.style.left,'260px');assert.equal(dialog.style.top,'64px');}
  trigger.click();assert.equal(dialog.open,false);assert.equal(doc.activeElement,trigger);
  trigger.click();doc.dispatchEvent(new view.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(dialog.open,false);assert.equal(doc.querySelector('.menu-drawer-dismiss'),null);
  trigger.click();doc.getElementById('outside').dispatchEvent(new view.Event('pointerdown',{bubbles:true}));assert.equal(dialog.open,false);
  trigger.click();menu.close();assert.equal(doc.activeElement,trigger);
  trigger.click();menu.destroy();assert.equal(doc.body.classList.contains('menu-drawer-open'),false);assert.equal(doc.querySelector('.menu-drawer-shift'),null);
  trigger.click();assert.equal(dialog.open,false);assert.equal(opens,5);
 }finally{menu.destroy();await view.happyDOM.abort();}
});

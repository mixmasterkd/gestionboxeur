import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
const source=await readFile(new URL('../js/appearance.js',import.meta.url),'utf8');
const key='gestionboxeur:appearance';
function page(choice,actions=''){
 const window=new Window({url:'https://boxing.example/planning.html'});
 window.document.write('<html><head><meta name="theme-color"></head><body><header class="app-header"><div class="account-nav">'+actions+'</div></header></body></html>');
 if(choice)window.localStorage.setItem(key,choice);
 window.eval(source);window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
 return window;
}
test('appearance toggle persists across pages and communicates the next mode',async()=>{
 const dark=page();let light;
 try{
  const button=dark.document.getElementById('appearanceToggle');
  assert.equal(dark.document.documentElement.dataset.theme,'dark');
  assert.equal(button.parentElement.className,'account-nav');
  assert.equal(button.getAttribute('aria-label'),'Passer au mode clair');
  button.click();
  assert.equal(dark.document.documentElement.dataset.theme,'light');
  assert.equal(button.getAttribute('aria-label'),'Passer au mode sombre');
  light=page(dark.localStorage.getItem(key));
  assert.equal(light.document.documentElement.dataset.theme,'light');
  dark.dispatchEvent(new dark.StorageEvent('storage',{key,newValue:'dark'}));
  assert.equal(dark.document.documentElement.dataset.theme,'dark');
  assert.equal(dark.document.querySelectorAll('#appearanceToggle').length,1);
 }finally{await dark.happyDOM.abort();await light?.happyDOM.abort();}
});

test('calendar library precedes theme and logout in both visual and keyboard order',async()=>{
 const window=page('light','<button id="libraryButton" class="calendar-library-button">Bibliothèque</button><button id="logoutButton">Déconnexion</button>');
 try{
  assert.deepEqual([...window.document.querySelector('.account-nav').children].map(el=>el.id),['libraryButton','appearanceToggle','logoutButton']);
  window.document.getElementById('appearanceToggle').click();
  assert.equal(window.document.documentElement.dataset.theme,'dark');
  assert.equal(window.document.getElementById('libraryButton').nextElementSibling.id,'appearanceToggle');
 }finally{await window.happyDOM.abort();}
});

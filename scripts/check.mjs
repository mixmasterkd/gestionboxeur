import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { Window } from 'happy-dom';
let failures=0;
for(const file of await readdir('js')) {
  if(!file.endsWith('.js'))continue;
  const result=spawnSync(process.execPath,['--check',`js/${file}`],{encoding:'utf8'});
  if(result.status){console.error(result.stderr);failures++;}
}
for(const file of ['index.html','planning.html','roster.html','login.html','profile.html','admin/index.html']) {
  const window=new Window({settings:{disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
  window.document.write(await readFile(file,'utf8'));
  const ids=[...window.document.querySelectorAll('[id]')].map(e=>e.id);
  const duplicates=ids.filter((id,i)=>ids.indexOf(id)!==i);
  if(duplicates.length){console.error(file,'IDs dupliqués',duplicates);failures++;}
  if(!window.document.querySelector('meta[name="viewport"]')){console.error(file,'viewport manquant');failures++;}
  for(const d of window.document.querySelectorAll('dialog')) {
    if(!d.getAttribute('aria-labelledby')&&!d.getAttribute('aria-label')){console.error(file,'dialogue sans nom accessible',d.id);failures++;}
  }
  await window.happyDOM.abort();
}
if(failures)process.exitCode=1;
else console.log('Syntaxe JavaScript, structure HTML, dialogues et balises mobiles : OK.');

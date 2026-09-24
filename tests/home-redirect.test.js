import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
const source=await readFile(new URL('../js/home-redirect.js',import.meta.url),'utf8');
for(const [suffix,target] of [['','planning.html'],['?liste=1','roster.html?liste=1'],['?invite=abc#coachs','planning.html?invite=abc#coachs'],['?liste=1&invite=abc','planning.html?liste=1&invite=abc']])test(`home opens ${target} without losing deep links`,async()=>{
 const window=new Window({url:'https://boxing.example/team/'+suffix});let destination;window.redirect=url=>destination=url;
 try{window.eval(source.replace('location.replace(','window.redirect('));assert.equal(destination,'https://boxing.example/team/'+target);}finally{await window.happyDOM.abort();}
});

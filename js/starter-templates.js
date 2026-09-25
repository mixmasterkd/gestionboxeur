import { parseTrainingText } from './workout-document.js';

/** Shared bases are copied only when the user saves a personalized version. */
export function getStarterTemplates() {
  const template=(id,title,sport,text)=>({id,source:'starter',kind:'session',title,sport,description:'',notes:'',workout_document:{version:1,text,marks:[]},blocks:parseTrainingText(text,{sport}).blocks});
  const jogs=Array.from({length:11},(_,index)=>{const minutes=10+index*5;return template(`starter-jog-${minutes}`,`Jog ${minutes} min`,'running',`- Jog ${minutes} MIN @ Z1-Z2`);});
  return [...jogs,
    template('starter-sparring','Sparring · 3 rounds','boxing',`Sparring
3 rounds
- 2 MIN
- 1 MIN @ Repos`),
    template('starter-boxing-fundamentals','Boxe fondamentale','boxing',`Échauffement
- Corde à danser 10 MIN

Shadow
3 rounds
- 3 MIN
- 1 MIN @ Repos

Sac
4 rounds
- 3 MIN
- 1 MIN @ Repos

Renforcement
3x
- Abdos 30x

Cool down
- Shadowboxing 5 MIN - Libre`),
  ];
}

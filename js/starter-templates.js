import { makeBlock } from './domain.js';

/** Local, editable examples. Nothing is saved until the coach explicitly asks. */
export function getStarterTemplates() {
  const jogs = Array.from({ length: 11 }, (_, index) => {
    const minutes = 10 + index * 5;
    return {
      id: `starter-jog-${minutes}`, source: 'starter', kind: 'session',
      title: `Jog ${minutes} min`, sport: 'running',
      description: 'Une course continue dont la durée et les détails peuvent être ajustés.', notes: '',
      blocks: [{ ...makeBlock('run'), title: 'Jog', duration_seconds: minutes * 60 }],
    };
  });
  return [...jogs, {
    id: 'starter-sparring', source: 'starter', kind: 'session',
    title: 'Sparring · 3 rounds', sport: 'sparring', description: '',
    notes: 'Adapter les rounds et les consignes avec le coach.',
    blocks: [{ ...makeBlock('sparring'), title: 'Sparring', rounds: 3, work_seconds: 120, rest_seconds: 60 }],
  }, {
    id: 'starter-boxing-fundamentals', source: 'starter', kind: 'session',
    title: 'Boxe fondamentale', sport: 'boxing',
    description: 'Une base de séance à personnaliser : corde, shadow, sac et abdos.', notes: '',
    blocks: [
      { ...makeBlock('cardio'), title: 'Corde', duration_seconds: 300 },
      { ...makeBlock('shadow'), title: 'Shadow', rounds: 4, work_seconds: 120, rest_seconds: 60 },
      { ...makeBlock('bag'), title: 'Sac', rounds: 4, work_seconds: 120, rest_seconds: 60 },
      { ...makeBlock('strength'), title: 'Abdos', duration_seconds: 300 },
    ],
  }];
}

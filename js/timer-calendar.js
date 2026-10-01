const DAY_MS = 86400000;
const MAX_RANGE_DAYS = 62;

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}

function aborted() {
  const error = new Error('Cette session n’est plus active.');
  error.name = 'AbortError';
  return error;
}

// Reuse the calendar's read permissions and read API. The timer receives detached
// copies of workout content; no session notes, feedback, events or write API.
export function createTimerCalendarSource({ user, account, loadCalendar, isCurrent = () => true }) {
  const ownerId = user?.id;
  function current() {
    if (!ownerId || user?.id !== ownerId || !isCurrent()) throw aborted();
  }
  function availableAthletes() {
    if (!ownerId || account?.planningAvailable !== true) return [];
    const coach = account.profile?.account_type === 'coach';
    const relations = account.relations || [];
    return (account.athletes || []).filter(athlete => athlete?.id && athlete.user_id && (
      athlete.user_id === ownerId || coach && relations.some(relation =>
        relation.coach_id === ownerId && relation.athlete_id === athlete.id &&
        relation.status === 'accepted' && relation.can_view_calendar === true)
    )).sort((a, b) => Number(b.user_id === ownerId) - Number(a.user_id === ownerId));
  }
  function authorized(calendarId) {
    current();
    if (!availableAthletes().some(athlete => athlete.id === calendarId)) {
      throw new Error('Ce calendrier n’est pas accessible.');
    }
  }

  return {
    ownerId,
    get calendars() {
      if (!isCurrent() || user?.id !== ownerId) return [];
      return availableAthletes().map(athlete => ({
        id: athlete.id,
        label: athlete.user_id === ownerId ? 'Mon calendrier' : [athlete.first_name, athlete.last_name].filter(Boolean).join(' ') || 'Athlète',
      }));
    },
    async loadSessions({ calendarId, start, end } = {}) {
      authorized(calendarId);
      const from = calendarDate(start), to = calendarDate(end);
      if (from === null || to === null || to < from || to - from >= MAX_RANGE_DAYS * DAY_MS) {
        throw new Error('Choisis une période valide de 62 jours maximum.');
      }
      const result = await loadCalendar(calendarId, start, end);
      authorized(calendarId);
      return (result?.sessions || []).filter(session =>
        session.athlete_id === calendarId && session.date >= start && session.date <= end
      ).map(session => structuredClone({
        id: session.id,
        title: session.title || 'Entraînement',
        date: session.date,
        sport: session.sport,
        blocks: Array.isArray(session.blocks) ? session.blocks : [],
        workout_document: session.workout_document ?? null,
      }));
    },
  };
}

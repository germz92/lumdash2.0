const VISIT_MINUTES = 15;
const CRAMPED_VISIT_MINUTES = 10;
const TRAVEL_BUFFER = 5;
const STEP_MINUTES = 5;

const ROLE_LEAD = 'lead photographer';
const ROLE_ADDITIONAL = 'additional photographer';
const ROLE_HEADSHOT = 'headshot booth photographer';
const ROLE_HEADSHOT_ALT = 'headshot photographer';

function parseTimeToMinutes(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  const ampm = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)$/i);
  if (ampm) {
    let hours = parseInt(ampm[1], 10);
    const minutes = parseInt(ampm[2] || '0', 10);
    const suffix = ampm[3].toLowerCase();
    if (suffix === 'pm' && hours !== 12) hours += 12;
    if (suffix === 'am' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2] || '0', 10);
  if (Number.isNaN(hours) || hours > 23) return null;
  return hours * 60 + minutes;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function isHeadshotRole(role) {
  const key = normalizeRole(role);
  return key === ROLE_HEADSHOT || key === ROLE_HEADSHOT_ALT;
}

function isRegularPhotoRole(role) {
  const key = normalizeRole(role);
  return key === ROLE_LEAD || key === ROLE_ADDITIONAL;
}

function isPhotoRole(role) {
  return isRegularPhotoRole(role) || isHeadshotRole(role);
}

function locationKey(location) {
  return String(location || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function locationParts(location) {
  const key = locationKey(location);
  if (!key) return { key: '', level: '', base: '' };

  const levelMatch = key.match(/\b(?:level|lvl|fl(?:oor)?)\s*(\d+)\b/)
    || key.match(/\b(\d+)(?:st|nd|rd|th)\s+(?:floor|lvl|level)\b/)
    || key.match(/\b(?:l|f)(\d+)\b/);
  let level = levelMatch ? levelMatch[1] : '';
  if (!level) {
    const roomNum = key.match(/\b(\d)(\d{2})\b/);
    if (roomNum) level = roomNum[1];
  }

  const base = key
    .replace(/\b(?:level|lvl|fl(?:oor)?)\s*\d+\b/g, '')
    .replace(/\b\d+(?:st|nd|rd|th)\s+(?:floor|lvl|level)\b/g, '')
    .replace(/\s+[a-d]\b/g, '')
    .replace(/\s+(north|south|east|west)\b/g, '')
    .trim();

  return { key, level, base };
}

function locationAffinity(person, location) {
  const target = locationParts(location);
  if (!target.key) return 0;
  let best = 0;
  for (const booking of person.bookings || []) {
    const prev = locationParts(booking.location);
    if (target.key && prev.key === target.key) best = Math.max(best, 3);
    else if (target.base && prev.base === target.base && target.base.length > 3) best = Math.max(best, 2);
    else if (target.level && prev.level === target.level) best = Math.max(best, 1);
  }
  return best;
}

function travelBuffer(fromLoc, toLoc) {
  const from = locationParts(fromLoc);
  const to = locationParts(toLoc);
  if (from.key && from.key === to.key) return 0;
  if (from.base && from.base === to.base && from.base.length > 3) return 2;
  if (from.level && from.level === to.level) return 2;
  return TRAVEL_BUFFER;
}

function sessionPriority(session, label) {
  let score = 0;
  if (session.important) score += 100;
  if (label?.coverage === 'dedicated' || label?.isMainEvent) score += 50;
  if (label?.isHeadshot) score += 10;
  return score;
}

function intervalsOverlap(a0, a1, b0, b1) {
  return a0 < b1 && b0 < a1;
}

function normalizePersonName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function namesLikelySamePerson(left, right) {
  const a = normalizePersonName(left);
  const b = normalizePersonName(right);
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

function sameCrewPerson(left, right) {
  if (!left || !right) return false;
  if (left === right || left.id === right.id) return true;
  if (left.userId && right.userId && String(left.userId) === String(right.userId)) return true;
  return namesLikelySamePerson(left.name, right.name);
}

function displayName(person, dayCrew) {
  const first = firstName(person.name);
  if (!first) return person.name;
  const collision = (dayCrew || []).some(other =>
    !sameCrewPerson(person, other) && firstName(other.name).toLowerCase() === first.toLowerCase()
  );
  return collision ? person.name : first;
}

function matchCrew(requested, crew) {
  const needle = String(requested || '').trim().toLowerCase();
  if (!needle) return null;
  return crew.find(person => person.name.toLowerCase() === needle)
    || crew.find(person => firstName(person.name).toLowerCase() === needle)
    || crew.find(person => person.name.toLowerCase().includes(needle));
}

function isMainEventText(text) {
  return /\bkeynotes?\b|\bawards?\b|\baward (show|ceremony)\b|\breceptions?\b|\bcocktails?\b|\bgala\b|\bplenary\b|\bcelebrations?\b|\bbanquets?\b|\bafter[- ]?party\b/.test(text);
}

function notesAskDedicated(text) {
  return /\bdedicated\b|\bstay the whole\b|\bstay (the )?entire\b|\bfull[- ]?time photographer\b|\bdo not leave\b|\bentire session\b|\bwhole (session|time)\b/.test(text);
}

function notesAskMultiple(text) {
  return /\b(two|2)\s+photographers?\b|\bneed (two|2)\b|\bpair of photographers\b/.test(text);
}

function sessionWindow(session) {
  const start = parseTimeToMinutes(session.startTime);
  if (start == null) return null;
  const end = parseTimeToMinutes(session.endTime);
  return { start, end: end != null ? end : start + 60 };
}

function overlappingSessions(session, all, labels) {
  const self = sessionWindow(session);
  if (!self) return [];
  return (all || []).filter(other => {
    if (String(other._id) === String(session._id)) return false;
    const label = labels?.get(String(other._id));
    if (label?.isHeadshot) return false;
    const otherWindow = sessionWindow(other);
    if (!otherWindow) return false;
    return intervalsOverlap(self.start, self.end, otherWindow.start, otherWindow.end);
  });
}

function isGatherSession(session, label) {
  return !!(label?.isMainEvent || session?.important);
}

function competingSessions(session, all, labels) {
  const selfLabel = labels?.get(String(session._id));
  return overlappingSessions(session, all, labels).filter(other => {
    const label = labels?.get(String(other._id));
    if (isGatherSession(session, selfLabel) && isGatherSession(other, label)) return false;
    return true;
  });
}

function siblingGatherSessions(session, all, labels) {
  return overlappingSessions(session, all, labels).filter(other => {
    const label = labels?.get(String(other._id));
    return isGatherSession(other, label);
  });
}

function classifyWithKeywords(session, crewNames = []) {
  const text = `${session.name || ''} ${session.notes || ''}`.toLowerCase();
  const isHeadshot = /\bheadshots?\b|\bbooth\b/.test(text);
  const isMainEvent = isMainEventText(text);
  const dedicated = isMainEvent || notesAskDedicated(text);
  const two = notesAskMultiple(text);
  const requestedNames = [];
  for (const name of crewNames) {
    const first = firstName(name).toLowerCase();
    const full = String(name).trim().toLowerCase();
    if (full.length > 3 && text.includes(full)) requestedNames.push(name);
    else if (first.length > 2 && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) {
      requestedNames.push(name);
    }
  }
  return {
    coverage: dedicated ? 'dedicated' : 'walk',
    walkMinutes: VISIT_MINUTES,
    photographerCount: two ? 2 : (isMainEvent ? 2 : 1),
    isHeadshot,
    isMainEvent,
    requestedNames: [...new Set(requestedNames)],
    source: 'keywords'
  };
}

async function classifyWithOpenAI(sessions, crewNames, openai) {
  const labels = new Map();
  for (const session of sessions) {
    labels.set(String(session._id), classifyWithKeywords(session, crewNames));
  }
  if (!openai || !sessions.length) return { labels, source: 'keywords' };

  const messages = [
    {
      role: 'system',
      content: `You label conference photo sessions for assignment. Return JSON: {"sessions":[{"id":"","coverage":"walk|dedicated","walkMinutes":15,"photographerCount":1,"isHeadshot":false,"isMainEvent":false,"requestedNames":[]}]}.
Rules:
- walk = photographer visits the room for about 10-15 minutes (default 15). They do not stay the whole session. Travel between rooms is about 5 minutes and is handled separately.
- dedicated = stay the entire start-end. Only for keynote, awards, reception, celebration, cocktail, gala, plenary, or notes that say dedicated / stay the whole time. Ordinary meetings, leadership meetings, new hire days, breakouts, lunch, and registration are walk, not dedicated.
- isMainEvent true only for keynote, awards, award show, reception, celebration, cocktail, gala, banquet, or plenary. Never for a regular meeting.
- photographerCount is a minimum: 2 only for those main events, or whatever notes ask for. Dedicated does not mean two photographers. If other sessions overlap a meeting, keep photographerCount at 1 so the extra people can cover those rooms.
- isHeadshot true if the session is a headshot booth.
- requestedNames must be copied from the provided crew name list when notes name that person. Never invent names.`
    },
    {
      role: 'user',
      content: JSON.stringify({
        crewNames,
        sessions: sessions.map(session => ({
          id: String(session._id),
          name: session.name || '',
          notes: session.notes || ''
        }))
      })
    }
  ];

  const attempts = [
    { model: 'gpt-5.6-luna' },
    { model: 'gpt-4o-mini', temperature: 0 }
  ];
  let lastError = null;

  for (const attempt of attempts) {
    try {
      const completion = await openai.chat.completions.create({
        ...attempt,
        response_format: { type: 'json_object' },
        messages
      });

      const parsed = JSON.parse(completion.choices[0].message.content || '{}');
      const rows = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      for (const row of rows) {
        const id = String(row.id || '');
        if (!id || !labels.has(id)) continue;
        const fallback = labels.get(id);
        const session = sessions.find(item => String(item._id) === id);
        const text = `${session?.name || ''} ${session?.notes || ''}`.toLowerCase();
        const keywordMain = fallback.isMainEvent || isMainEventText(text);
        const canBeDedicated = fallback.coverage === 'dedicated' || keywordMain || notesAskDedicated(text);
        const coverage = (row.coverage === 'dedicated' && canBeDedicated) || fallback.coverage === 'dedicated'
          ? 'dedicated'
          : 'walk';
        const requested = (row.requestedNames || [])
          .map(name => matchCrew(name, crewNames.map(n => ({ name: n })))?.name)
          .filter(Boolean);
        const count = Number(row.photographerCount);
        const openaiCount = Number.isFinite(count) && count > 0 ? Math.min(8, Math.round(count)) : 0;
        labels.set(id, {
          coverage,
          walkMinutes: Number(row.walkMinutes) > 0 ? Number(row.walkMinutes) : fallback.walkMinutes,
          photographerCount: keywordMain || notesAskMultiple(text)
            ? Math.max(fallback.photographerCount, openaiCount || 1)
            : fallback.photographerCount,
          isHeadshot: !!(row.isHeadshot || fallback.isHeadshot),
          isMainEvent: !!(fallback.isMainEvent || (row.isMainEvent && keywordMain)),
          requestedNames: [...new Set([...requested, ...fallback.requestedNames])],
          source: 'openai'
        });
      }
      return { labels, source: 'openai', model: attempt.model };
    } catch (err) {
      lastError = err;
      console.error(`[AutoAssign] ${attempt.model} classify failed:`, err.message);
    }
  }

  return { labels, source: 'keywords', classifyError: lastError?.message };
}

function findCrewPerson(people, row) {
  const userId = row.userId ? String(row.userId) : '';
  if (userId) {
    const byUser = people.find(person => person.userId && person.userId === userId);
    if (byUser) return byUser;
  }
  return people.find(person => namesLikelySamePerson(person.name, row.name)) || null;
}

function mapShift(row) {
  const start = parseTimeToMinutes(row.startTime);
  const end = parseTimeToMinutes(row.endTime);
  return {
    role: row.role,
    roleKey: normalizeRole(row.role),
    isLead: normalizeRole(row.role) === ROLE_LEAD,
    isHeadshot: isHeadshotRole(row.role),
    start: start == null ? 0 : start,
    end: end == null ? 24 * 60 : end
  };
}

function buildPhotoCrew(crewRows, date) {
  const people = [];
  for (const row of crewRows || []) {
    if (row.date !== date) continue;
    const name = String(row.name || '').trim();
    if (!name || !isPhotoRole(row.role) || row.availabilityStatus === 'declined') continue;
    const shift = mapShift(row);
    if (shift.end <= shift.start) continue;
    let person = findCrewPerson(people, row);
    if (!person) {
      person = {
        id: row.userId ? `user:${row.userId}` : `name:${normalizePersonName(name)}`,
        name,
        userId: row.userId ? String(row.userId) : null,
        shifts: [],
        minutes: 0,
        sessions: 0,
        walkMinutes: 0,
        walkSessions: 0,
        bookings: []
      };
      people.push(person);
    }
    person.shifts.push(shift);
    if (name.length > person.name.length) person.name = name;
    if (!person.userId && row.userId) person.userId = String(row.userId);
  }
  return people.map(person => {
    person.hasRegular = person.shifts.some(shift => !shift.isHeadshot);
    person.hasHeadshot = person.shifts.some(shift => shift.isHeadshot);
    person.isLead = person.shifts.some(shift => shift.isLead);
    person.isHeadshot = person.hasHeadshot && !person.hasRegular;
    person.role = [...new Set(person.shifts.map(shift => shift.role).filter(Boolean))].join(' / ');
    person.startMin = Math.min(...person.shifts.map(shift => shift.start));
    person.endMin = Math.max(...person.shifts.map(shift => shift.end));
    return person;
  });
}

function eligibleShifts(person, label, slotStart, slotEnd) {
  const duration = label?.coverage === 'dedicated'
    ? Math.max(1, slotEnd - slotStart)
    : Math.min(label?.walkMinutes || VISIT_MINUTES, Math.max(1, slotEnd - slotStart));
  return (person.shifts || []).filter(shift => {
    if (label?.isHeadshot && !shift.isHeadshot) return false;
    if (!label?.isHeadshot && shift.isHeadshot) return false;
    if (label?.coverage === 'dedicated') {
      return slotStart >= shift.start && slotEnd <= shift.end;
    }
    return Math.min(slotEnd, shift.end) - Math.max(slotStart, shift.start) >= duration;
  });
}

function compareCandidates(a, b, session, sessionLabel) {
  const sessionGap = a.person.walkSessions - b.person.walkSessions;
  const minuteGap = a.person.walkMinutes - b.person.walkMinutes;
  const affA = locationAffinity(a.person, session.location);
  const affB = locationAffinity(b.person, session.location);
  const idleGap = Math.abs(sessionGap) >= 2 || Math.abs(minuteGap) >= 20;

  if (idleGap) {
    if (sessionGap) return sessionGap;
    if (minuteGap) return minuteGap;
  }
  const start = parseTimeToMinutes(session.startTime);
  const end = parseTimeToMinutes(session.endTime) ?? (start == null ? 0 : start + 60);
  const leadA = start != null && eligibleShifts(a.person, sessionLabel, start, end).some(shift => shift.isLead);
  const leadB = start != null && eligibleShifts(b.person, sessionLabel, start, end).some(shift => shift.isLead);
  if ((sessionLabel.coverage === 'dedicated' || session.important) && leadA !== leadB) {
    return leadA ? -1 : 1;
  }
  if (affA !== affB && Math.abs(minuteGap) < 20 && Math.abs(sessionGap) < 2) return affB - affA;
  if (minuteGap) return minuteGap;
  if (sessionGap) return sessionGap;
  if (affA !== affB) return affB - affA;
  return a.person.name.localeCompare(b.person.name);
}

function isFree(person, start, end, loc) {
  for (const booking of person.bookings) {
    const buffer = travelBuffer(booking.location, loc);
    if (intervalsOverlap(start, end, booking.start - buffer, booking.end + buffer)) {
      return false;
    }
  }
  return true;
}

function findWindow(person, session, label, slotStart, slotEnd) {
  const loc = session.location || '';
  const slotLength = Math.max(1, slotEnd - slotStart);
  const shifts = eligibleShifts(person, label, slotStart, slotEnd);
  if (!shifts.length) return null;

  if (label.coverage === 'dedicated') {
    if (!isFree(person, slotStart, slotEnd, loc)) return null;
    return { start: slotStart, end: slotEnd, location: loc, minutes: slotLength };
  }

  const duration = Math.min(label.walkMinutes || VISIT_MINUTES, slotLength);
  for (const shift of shifts) {
    const earliest = Math.max(slotStart, shift.start);
    const latestStart = Math.min(slotEnd, shift.end) - duration;
    for (let start = earliest; start <= latestStart; start += STEP_MINUTES) {
      if (isFree(person, start, start + duration, loc)) {
        return { start, end: start + duration, location: loc, minutes: duration };
      }
    }
  }
  return null;
}

function book(person, window, dedicated = false) {
  person.bookings.push({
    start: window.start,
    end: window.end,
    location: window.location
  });
  person.minutes += window.minutes;
  person.sessions += 1;
  if (!dedicated) {
    person.walkMinutes += window.minutes;
    person.walkSessions += 1;
  }
}

function assignmentHasName(row, person, photoCrew) {
  const names = String(row.photographer || '').split(',').map(part => part.trim()).filter(Boolean);
  return names.includes(displayName(person, photoCrew)) || names.includes(person.name);
}

function sessionSlot(session, label) {
  const start = parseTimeToMinutes(session.startTime);
  if (start == null) return null;
  const end = parseTimeToMinutes(session.endTime);
  return {
    start,
    end: end != null ? end : start + (label?.coverage === 'dedicated' ? 60 : VISIT_MINUTES)
  };
}

function walkLabelFor(session, sorted, labels, label, photographerCount) {
  const visitMinutes = visitMinutesForSession(session, sorted, labels, { ...label, coverage: 'walk' }, photographerCount)
    || label.walkMinutes
    || VISIT_MINUTES;
  return { ...label, coverage: 'walk', walkMinutes: visitMinutes };
}

function isUnderused(person, crew) {
  const peers = (crew || []).filter(other => !other.isHeadshot);
  if (!peers.length) return false;
  const busiestSessions = Math.max(...peers.map(other => other.walkSessions));
  const busiestMinutes = Math.max(...peers.map(other => other.walkMinutes));
  return (busiestSessions - person.walkSessions >= 2)
    || (busiestMinutes - person.walkMinutes >= 20)
    || (person.walkSessions <= 1 && busiestSessions >= 3);
}

function fillUnderusedPhotographers({ photoCrew, assignments, sorted, labels, regularCrew, headshotCrew }) {
  const walkers = photoCrew.filter(person => person.hasRegular);
  if (!walkers.length) return;

  let added = true;
  let guard = 0;
  while (added && guard < 80) {
    added = false;
    guard += 1;
    const idle = [...walkers].sort((a, b) => {
      if (a.walkSessions !== b.walkSessions) return a.walkSessions - b.walkSessions;
      return a.walkMinutes - b.walkMinutes;
    });

    for (const person of idle) {
      if (!isUnderused(person, walkers)) continue;
      const targets = [...assignments].sort((a, b) => {
        const countA = String(a.photographer || '').split(',').map(part => part.trim()).filter(Boolean).length;
        const countB = String(b.photographer || '').split(',').map(part => part.trim()).filter(Boolean).length;
        if (countA !== countB) return countA - countB;
        return locationAffinity(person, b.location) - locationAffinity(person, a.location);
      });

      for (const row of targets) {
        if (!person.hasRegular && !row.isHeadshot) continue;
        if (!person.hasHeadshot && row.isHeadshot && headshotCrew.length) continue;
        if (assignmentHasName(row, person, photoCrew)) continue;
        const session = sorted.find(item => String(item._id) === row.programId);
        const label = labels.get(row.programId) || classifyWithKeywords(session || {});
        const slot = session ? sessionSlot(session, label) : null;
        if (!slot) continue;
        const already = String(row.photographer || '').split(',').map(part => part.trim()).filter(Boolean);
        const maxPeople = label.isMainEvent || session.important ? 8 : 2;
        if (already.length >= maxPeople) continue;
        const window = findWindow(person, session, walkLabelFor(session, sorted, labels, label, regularCrew.length), slot.start, slot.end);
        if (!window) continue;
        book(person, window, false);
        const name = displayName(person, photoCrew);
        row.photographer = [...already, name].join(', ');
        row.why = [row.why, `${name} added to avoid idle time`].filter(Boolean).join('; ');
        added = true;
        break;
      }
      if (added) break;
    }
  }
}

function poolForSession(label, regularCrew, headshotCrew) {
  if (label.isHeadshot) {
    return headshotCrew.length ? headshotCrew : regularCrew;
  }
  return regularCrew;
}

function alreadyBookedDuring(person, start, end) {
  return (person.bookings || []).some(booking => intervalsOverlap(booking.start, booking.end, start, end));
}

function neededPhotographers(session, label, allSessions, labels, pool) {
  const notesMinimum = Math.max(1, label.photographerCount || 1);
  if (label.isHeadshot) return Math.min(notesMinimum, Math.max(1, pool.length));
  const competing = competingSessions(session, allSessions, labels);
  const soleSlot = !competing.length;
  const mainEvent = isGatherSession(session, label);
  const daySessions = (allSessions || []).filter(item => {
    if (item.date !== session.date) return false;
    const otherLabel = labels?.get(String(item._id));
    return !otherLabel?.isHeadshot;
  });
  const onlyEventOfDay = daySessions.length <= 1;
  if (soleSlot && (mainEvent || label.coverage === 'dedicated' || onlyEventOfDay)) {
    return Math.max(notesMinimum, pool.length);
  }
  if (soleSlot) return Math.max(notesMinimum, Math.min(pool.length, Math.max(2, Math.ceil(pool.length / 2))));
  if (mainEvent) return Math.max(notesMinimum, 2);
  return notesMinimum;
}

function shareCoverageAcrossGatherings(assignments, sorted, labels, photoCrew) {
  for (const row of assignments) {
    const session = sorted.find(item => String(item._id) === row.programId);
    if (!session) continue;
    const label = labels.get(row.programId);
    if (!isGatherSession(session, label)) continue;
    const names = String(row.photographer || '').split(',').map(part => part.trim()).filter(Boolean);
    if (!names.length) continue;
    for (const sibling of siblingGatherSessions(session, sorted, labels)) {
      const sibRow = assignments.find(item => item.programId === String(sibling._id));
      const sibLabel = labels.get(String(sibling._id)) || classifyWithKeywords(sibling);
      const slot = sessionSlot(sibling, sibLabel);
      if (!sibRow || !slot) continue;
      const existing = String(sibRow.photographer || '').split(',').map(part => part.trim()).filter(Boolean);
      const extra = [];
      for (const name of names) {
        if (existing.includes(name) || extra.includes(name)) continue;
        const person = matchCrew(name, photoCrew);
        if (!person) continue;
        if (alreadyBookedDuring(person, slot.start, slot.end) || findWindow(person, sibling, sibLabel, slot.start, slot.end)) {
          extra.push(name);
        }
      }
      if (!extra.length) continue;
      sibRow.photographer = [...existing, ...extra].join(', ');
      const note = `Same slot as ${session.name || 'main event'}`;
      if (!String(sibRow.why || '').includes(note)) {
        sibRow.why = [sibRow.why, note].filter(Boolean).join('; ');
      }
    }
  }
}

function visitMinutesForSession(session, allSessions, labels, label, photographerCount) {
  if (label.coverage === 'dedicated') return null;
  const others = overlappingSessions(session, allSessions, labels);
  const concurrent = others.length + 1;
  if (concurrent >= 3) return CRAMPED_VISIT_MINUTES;
  if (photographerCount && concurrent >= photographerCount) return CRAMPED_VISIT_MINUTES;
  return label.walkMinutes || VISIT_MINUTES;
}

function assignDay(date, sessions, crewRows, labels) {
  const warnings = [];
  const photoCrew = buildPhotoCrew(crewRows, date);
  const regularCrew = photoCrew.filter(person => person.hasRegular);
  const headshotCrew = photoCrew.filter(person => person.hasHeadshot);

  if (!photoCrew.length) {
    warnings.push({ date, message: 'No photographers on crew this day.' });
  }

  const sorted = [...sessions].sort((a, b) => {
    const labelA = labels.get(String(a._id)) || classifyWithKeywords(a);
    const labelB = labels.get(String(b._id)) || classifyWithKeywords(b);
    const priority = sessionPriority(b, labelB) - sessionPriority(a, labelA);
    if (priority) return priority;
    return (parseTimeToMinutes(a.startTime) ?? 9999) - (parseTimeToMinutes(b.startTime) ?? 9999);
  });

  const assignments = [];

  for (const session of sorted) {
    const label = labels.get(String(session._id)) || classifyWithKeywords(session, photoCrew.map(p => p.name));
    const start = parseTimeToMinutes(session.startTime);
    const end = parseTimeToMinutes(session.endTime);
    const previousPhotographer = session.photographer || '';

    const base = {
      programId: String(session._id),
      date,
      name: session.name || '',
      startTime: session.startTime || '',
      endTime: session.endTime || '',
      location: session.location || '',
      coverage: label.coverage,
      isHeadshot: !!label.isHeadshot,
      previousPhotographer
    };

    if (start == null) {
      warnings.push({ date, session: session.name, message: 'Missing start time — skipped.' });
      assignments.push({ ...base, photographer: '', why: 'Skipped — no start time' });
      continue;
    }

    const slotEnd = end != null ? end : start + (label.coverage === 'dedicated' ? 60 : VISIT_MINUTES);
    const pool = poolForSession(label, regularCrew, headshotCrew);
    const visitMinutes = visitMinutesForSession(session, sorted, labels, label, pool.length);
    const sessionLabel = visitMinutes ? { ...label, walkMinutes: visitMinutes } : label;
    const availablePool = pool.filter(person => findWindow(person, session, sessionLabel, start, slotEnd));
    const needed = neededPhotographers(session, label, sorted, labels, availablePool);
    const chosen = [];
    const reasons = [];

    for (const requested of label.requestedNames || []) {
      if (chosen.length >= needed) break;
      const person = matchCrew(requested, photoCrew);
      if (!person) {
        warnings.push({ date, session: session.name, message: `${requested} is mentioned in notes but is not on crew.` });
        continue;
      }
      if (!eligibleShifts(person, sessionLabel, start, slotEnd).length) {
        warnings.push({ date, session: session.name, message: `${displayName(person, photoCrew)} is mentioned in notes but is off the clock or in another role for this slot.` });
        continue;
      }
      const window = findWindow(person, session, sessionLabel, start, slotEnd);
      if (!window) {
        warnings.push({ date, session: session.name, message: `${displayName(person, photoCrew)} is named in notes but is not free or is off the clock.` });
        continue;
      }
      book(person, window, sessionLabel.coverage === 'dedicated');
      chosen.push(person);
      reasons.push(`Notes asked for ${displayName(person, photoCrew)}`);
    }

    while (chosen.length < needed) {
      const candidates = pool
        .filter(person => !chosen.includes(person))
        .map(person => ({ person, window: findWindow(person, session, sessionLabel, start, slotEnd) }))
        .filter(row => row.window)
        .sort((a, b) => compareCandidates(a, b, session, sessionLabel));

      if (!candidates.length) {
        if (!chosen.length) reasons.push('No photographer free in this window');
        break;
      }
      const pick = candidates[0];
      const affinity = locationAffinity(pick.person, session.location);
      book(pick.person, pick.window, sessionLabel.coverage === 'dedicated');
      chosen.push(pick.person);
      if (session.important) {
        reasons.push('Marked important');
      }
      if (affinity >= 3) reasons.push('Same room as earlier assignment');
      else if (affinity === 2) reasons.push('Same room group');
      else if (affinity === 1) reasons.push('Same level as earlier assignment');
      const competing = competingSessions(session, sorted, labels);
      if (needed > 1 && !competing.length) {
        reasons.push(label.isMainEvent
          ? 'Sole keynote/reception — all available photographers'
          : 'Nothing else in this slot');
      } else if (label.isMainEvent && needed > 1) {
        reasons.push('Main event — extra coverage');
      } else if (label.coverage === 'dedicated') {
        reasons.push(eligibleShifts(pick.person, sessionLabel, start, slotEnd).some(shift => shift.isLead)
          ? 'Lead on dedicated session'
          : 'Dedicated coverage');
      } else if (visitMinutes === CRAMPED_VISIT_MINUTES) {
        reasons.push('Cramped slot — 10 min visit');
      } else if (!affinity && !session.important) {
        reasons.push('Visit ~15 min, lowest load');
      }
    }

    assignments.push({
      ...base,
      photographer: chosen.map(person => displayName(person, photoCrew)).join(', '),
      visitMinutes: label.coverage === 'dedicated' ? null : (visitMinutes || VISIT_MINUTES),
      why: [...new Set(reasons)].join('; ') || 'Unassigned'
    });
  }

  shareCoverageAcrossGatherings(assignments, sorted, labels, photoCrew);
  fillUnderusedPhotographers({ photoCrew, assignments, sorted, labels, regularCrew, headshotCrew });

  for (const person of photoCrew.filter(item => item.sessions === 0)) {
    const hours = person.shifts.some(shift => shift.start > 0 || shift.end < 24 * 60)
      ? 'no session fits their call times or role windows'
      : 'no remaining session they can take';
    warnings.push({
      date,
      message: `${displayName(person, photoCrew)} unused — ${hours}.`,
      unused: true
    });
  }

  assignments.sort((a, b) => {
    const byTime = (parseTimeToMinutes(a.startTime) ?? 9999) - (parseTimeToMinutes(b.startTime) ?? 9999);
    if (byTime) return byTime;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  return {
    date,
    assignments,
    warnings,
    workload: photoCrew.map(person => ({
      name: displayName(person, photoCrew),
      fullName: person.name,
      role: person.role,
      minutes: person.minutes,
      sessions: person.sessions
    }))
  };
}

async function buildAssignmentProposal({ programSchedule = [], rows = [], dates = null, openai = null }) {
  const dateFilter = Array.isArray(dates) && dates.length && !dates.includes('all')
    ? new Set(dates)
    : null;
  const sessions = (programSchedule || []).filter(session => {
    if (!session || !session._id) return false;
    if (dateFilter && !dateFilter.has(session.date)) return false;
    return true;
  });

  const crewNames = [...new Set((rows || [])
    .filter(row => isPhotoRole(row.role) && row.availabilityStatus !== 'declined')
    .map(row => String(row.name || '').trim())
    .filter(Boolean))];

  const classifyStarted = Date.now();
  const { labels, source, classifyError, model } = await classifyWithOpenAI(sessions, crewNames, openai);
  const classifyMs = Date.now() - classifyStarted;

  const assignStarted = Date.now();
  const datesInPlay = [...new Set(sessions.map(session => session.date).filter(Boolean))].sort();
  const days = datesInPlay.map(date => assignDay(
    date,
    sessions.filter(session => session.date === date),
    rows,
    labels
  ));
  const assignMs = Date.now() - assignStarted;

  return {
    days,
    classifiedWith: source,
    classifyModel: model || null,
    classifyError: classifyError || null,
    classifyMs,
    assignMs,
    elapsedMs: classifyMs + assignMs,
    sessionCount: sessions.length
  };
}

function splitPhotographerNames(value) {
  return String(value || '').split(',').map(part => part.trim()).filter(Boolean);
}

function labelsFromProposal(sessions, proposal) {
  const byId = new Map();
  for (const day of proposal?.days || []) {
    for (const row of day.assignments || []) {
      byId.set(String(row.programId), row);
    }
  }
  const labels = new Map();
  for (const session of sessions) {
    const fallback = classifyWithKeywords(session);
    const row = byId.get(String(session._id));
    labels.set(String(session._id), {
      ...fallback,
      coverage: row?.coverage === 'dedicated' || row?.coverage === 'walk' ? row.coverage : fallback.coverage,
      isHeadshot: row?.isHeadshot != null ? !!row.isHeadshot : fallback.isHeadshot,
      walkMinutes: row?.visitMinutes || fallback.walkMinutes
    });
  }
  return labels;
}

function rebuildDayFromDesired(date, sessions, rows, labels, desired, note) {
  const photoCrew = buildPhotoCrew(rows, date);
  const sorted = [...sessions].sort((a, b) =>
    (parseTimeToMinutes(a.startTime) ?? 9999) - (parseTimeToMinutes(b.startTime) ?? 9999)
  );
  const assignments = [];

  for (const session of sorted) {
    const label = labels.get(String(session._id)) || classifyWithKeywords(session);
    const start = parseTimeToMinutes(session.startTime);
    const end = parseTimeToMinutes(session.endTime);
    const slotEnd = end != null ? end : start + (label.coverage === 'dedicated' ? 60 : VISIT_MINUTES);
    const visitMinutes = label.coverage === 'dedicated' ? null : (label.walkMinutes || VISIT_MINUTES);
    const sessionLabel = visitMinutes ? { ...label, walkMinutes: visitMinutes } : label;
    const wanted = desired.get(String(session._id));
    const chosen = [];
    const reasons = [];

    if (start != null) {
      for (const name of splitPhotographerNames(wanted)) {
        const person = matchCrew(name, photoCrew);
        if (!person || chosen.includes(person)) continue;
        const window = findWindow(person, session, sessionLabel, start, slotEnd);
        if (!window) continue;
        book(person, window, sessionLabel.coverage === 'dedicated');
        chosen.push(person);
      }
    }

    if (note && chosen.length) reasons.push(note);
    if (start == null) reasons.push('Skipped — no start time');
    else if (!chosen.length && splitPhotographerNames(wanted).length) {
      reasons.push('Requested people were off the clock or already booked');
    } else if (!chosen.length) reasons.push('Unassigned');

    const original = sessions.find(item => String(item._id) === String(session._id));
    assignments.push({
      programId: String(session._id),
      date,
      name: session.name || '',
      startTime: session.startTime || '',
      endTime: session.endTime || '',
      location: session.location || '',
      coverage: label.coverage,
      isHeadshot: !!label.isHeadshot,
      previousPhotographer: original?.previousPhotographer || session.photographer || '',
      photographer: chosen.map(person => displayName(person, photoCrew)).join(', '),
      visitMinutes,
      edited: true,
      why: [...new Set(reasons)].join('; ') || 'Unassigned'
    });
  }

  const warnings = [];
  for (const person of photoCrew.filter(item => item.sessions === 0)) {
    warnings.push({
      date,
      message: `${displayName(person, photoCrew)} unused — no session fits their call times or role windows.`,
      unused: true
    });
  }

  return {
    date,
    assignments,
    warnings,
    workload: photoCrew.map(person => ({
      name: displayName(person, photoCrew),
      fullName: person.name,
      role: person.role,
      minutes: person.minutes,
      sessions: person.sessions
    }))
  };
}

async function requestAssignmentEdits(openai, instruction, payload) {
  const attempts = [
    { model: 'gpt-5.6-luna' },
    { model: 'gpt-4o-mini', temperature: 0 }
  ];
  let lastError = null;
  const messages = [
    {
      role: 'system',
      content: `You edit conference photographer assignments. Return JSON only:
{"summary":"one or two sentences","assignments":[{"programId":"","photographer":"Name, Name"}]}
Rules:
- Only use crew display names from the payload. Never invent people.
- photographer is a comma-separated list of those display names, or "" to leave unassigned.
- Only include sessions you change.
- Honor call times and roles already described. Do not assign someone outside their hours or to a headshot-only window if they are not on booth then.
- If asked to give someone fewer rooms / fewer sessions, remove them from short visits and keep them on longer or dedicated sessions.
- If asked to give someone more work, add short visits they can take.
- Keep other people assigned unless you need their slot.
- Prefer the display names exactly as given.`
    },
    {
      role: 'user',
      content: JSON.stringify({ instruction, ...payload })
    }
  ];

  for (const attempt of attempts) {
    try {
      const completion = await openai.chat.completions.create({
        ...attempt,
        response_format: { type: 'json_object' },
        messages
      });
      const parsed = JSON.parse(completion.choices[0].message.content || '{}');
      return {
        summary: String(parsed.summary || '').trim(),
        assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
        model: attempt.model
      };
    } catch (err) {
      lastError = err;
      console.error(`[AutoAssign] ${attempt.model} edit failed:`, err.message);
    }
  }
  throw lastError || new Error('Could not edit assignments');
}

async function editAssignmentProposal({ proposal, instruction, programSchedule = [], rows = [], openai = null }) {
  const text = String(instruction || '').trim();
  if (!text) {
    const error = new Error('Tell the agent what to change');
    error.status = 400;
    throw error;
  }
  if (!openai) {
    const error = new Error('AI edits are unavailable right now');
    error.status = 503;
    throw error;
  }

  const dates = [...new Set((proposal?.days || []).map(day => day.date).filter(Boolean))];
  const sessions = (programSchedule || []).filter(session =>
    session && session._id && dates.includes(session.date)
  );
  const labels = labelsFromProposal(sessions, proposal);
  const currentRows = (proposal?.days || []).flatMap(day => day.assignments || []);
  const desired = new Map(currentRows.map(row => [String(row.programId), row.photographer || '']));

  const crewByDay = {};
  for (const date of dates) {
    const people = buildPhotoCrew(rows, date);
    crewByDay[date] = people.map(person => ({
      name: displayName(person, people),
      fullName: person.name,
      role: person.role,
      call: person.shifts.map(shift => ({
        role: shift.role,
        start: shift.start,
        end: shift.end
      }))
    }));
  }

  const { summary, assignments, model } = await requestAssignmentEdits(openai, text, {
    crewByDay,
    sessions: currentRows.map(row => ({
      programId: row.programId,
      date: row.date,
      name: row.name,
      startTime: row.startTime,
      endTime: row.endTime,
      location: row.location,
      coverage: row.coverage,
      visitMinutes: row.visitMinutes,
      photographer: row.photographer || ''
    }))
  });

  for (const row of assignments) {
    const id = String(row.programId || '');
    if (!id || !desired.has(id)) continue;
    desired.set(id, row.photographer == null ? '' : String(row.photographer));
  }

  const note = summary || 'Adjusted from your request';
  const days = dates.map(date => {
    const rebuilt = rebuildDayFromDesired(
      date,
      sessions.filter(session => session.date === date),
      rows,
      labels,
      desired,
      note
    );
    const prior = (proposal.days || []).find(day => day.date === date);
    if (prior) {
      rebuilt.swapFrom = prior.swapFrom;
      rebuilt.swapTo = prior.swapTo;
    }
    for (const row of rebuilt.assignments) {
      const before = currentRows.find(item => String(item.programId) === row.programId);
      if (before) {
        row.previousPhotographer = before.previousPhotographer || before.photographer || '';
        row.originalPhotographer = before.originalPhotographer != null
          ? before.originalPhotographer
          : (before.photographer || '');
        row.edited = row.photographer !== row.originalPhotographer;
      }
    }
    return rebuilt;
  });

  return {
    ...proposal,
    days,
    editNote: note,
    editModel: model,
    sessionCount: sessions.length
  };
}

function canAssignPhotographers(table, user) {
  if (!table || !user) return false;
  if (user.role === 'admin') return true;
  const userId = String(user.id);
  const isOwner = (table.owners || []).some(id => String(id) === userId);
  const isLead = (table.leads || []).some(id => String(id) === userId);
  return isOwner || isLead;
}

module.exports = {
  buildAssignmentProposal,
  editAssignmentProposal,
  canAssignPhotographers,
  classifyWithKeywords,
  parseTimeToMinutes
};

// Compact playbooks for Luma. Do not dump this file wholesale into the model —
// the builder sends the current page plus a short how-the-app-works section.

const PAGE_ALIASES = {
  travel: 'travel-accommodation',
  tasks: 'todos',
  notes: 'admin-notes',
  'admin-notes': 'admin-notes',
  inventory: 'inventory',
  'inventory-management': 'inventory',
  dashboard: 'events'
};

const WORKFLOWS = [
  'Crew page = call sheet (when people work). Schedule page = event rundown (what is happening). They are different lists.',
  'Crew availability: tentative → requested → accepted or declined → confirmed. Admins email requests; crew reply on a public link.',
  'Events have both client and company. Access: owners, leads, shared, assigned crew. Admins and planners can read all events.',
  'Roles: user, planner, admin, production_manager (inventory).',
  'Event to-dos live on #todos as todos[] (todo / in-progress / done). Use openTodos and todoSummary — name every open task. Dashboard My Tasks is only the current user\'s items plus private PersonalTask rows.',
  'Shotlists are per-event checklists (shotlists[] plus legacy shotlist). What shots are left = shotlistSummary.remainingTitles. Name every remaining shot.',
  'Flights: official FlightRequest records (pending / booked) plus older travel rows on the event.',
  'Gear: event reservations, packages, packed status, and optional legacy checkbox lists. What is not packed = gearSummary.unpacked. Do not answer event gear from global inventory.',
  'Card log tracks memory cards by date, camera, person, and category. Who has a card = cardLookup.',
  'Admin notes are owner/admin only. If notes say hidden, say that — do not invent an empty list.',
  'Event expenses (owner/admin) have expenseTotals like the Expenses page: crew + flights + hotels + misc + reimbursements = grand.',
  'Answer all times in 12-hour format with AM/PM (e.g. 2:00 PM, not 14:00).',
  'Day start/end on Schedule = earliest session startTime and latest session endTime that day, from scheduleByDay — not the first or last row in the list.',
  'Day start/end on Crew = earliest callTime and latest endTime that day, from crewByDay.',
  'Who is flying in = FlightRequest passengers plus travel-row names for that event. Match by event title or eventId; pending still counts. Do not say nobody if flyingInByEvent has names.',
  'Hotels live on Travel & Accommodation as accommodation rows (hotel, guest, checkin, checkout, ref). Answer "do we have hotels" from hotelsByEvent: booked / requested / not_required / none. Who is missing a hotel or flight = travelGaps.',
  'Events can have multiple owners. Who owns this event = every name in eventAccess.ownerNames. Who it is shared with = eventAccess.sharedWith (leads + shared users). Both lists are complete — name everyone.'
];

const PAGES = {
  events: {
    context: 'dashboard',
    title: 'Events dashboard',
    purpose: 'List of events the user can access, with dates, client, company, and location.',
    datasets: ['eventsOverview'],
    related: ['mySchedule'],
    ask: ['What events do I have coming up?', 'What day is the GuidePoint event?', 'Which events are in Las Vegas?']
  },
  'event-calendar': {
    context: 'dashboard',
    title: 'Event calendar',
    purpose: 'Calendar view of the same events. Answer with dates and clusters by week or month.',
    datasets: ['eventsOverview'],
    related: ['mySchedule'],
    ask: ['What is happening next week?', 'Do I have events in March?']
  },
  'my-tasks': {
    context: 'dashboard',
    title: 'My Tasks',
    purpose: 'Event to-dos assigned to the user plus private PersonalTask items.',
    datasets: ['myEventTasks', 'personalTasks'],
    related: ['eventsOverview'],
    ask: ['What is due today?', 'What tasks do I still have open?']
  },
  'call-times': {
    context: 'dashboard',
    title: 'Call Times',
    purpose: 'The user\'s crew rows across events — when they work, not the event program.',
    datasets: ['mySchedule'],
    related: ['eventsOverview'],
    ask: ['When do I work next?', 'Am I working on February 25?']
  },
  flights: {
    context: 'dashboard',
    title: 'Flight Management',
    purpose: 'Official flight requests: pending and booked, passengers, routes, confirmation codes.',
    datasets: ['flights'],
    related: ['eventsOverview'],
    ask: ['When do I fly in?', 'What flights are still pending?']
  },
  inventory: {
    context: 'dashboard',
    title: 'Inventory',
    purpose: 'Global gear catalog. Admin and production_manager.',
    datasets: ['inventorySummary'],
    related: [],
    ask: ['How many Canon R5s do we have?', 'What lenses are in inventory?'],
    roles: ['admin', 'production_manager']
  },
  'crew-planner': {
    context: 'dashboard',
    title: 'Crew Planner',
    purpose: 'Multi-event planner boards (admin). Separate from per-event crew call sheets.',
    datasets: ['crewPlanner'],
    related: ['mySchedule'],
    ask: ['Who is assigned on this planner date?'],
    roles: ['admin']
  },
  'crew-calendar': {
    context: 'dashboard',
    title: 'Crew Calendar',
    purpose: 'Aggregated crew rows across events by date.',
    datasets: ['crewCalendar'],
    related: ['eventsOverview'],
    ask: ['Who is working next week?', 'Is Germaine booked on Friday?'],
    roles: ['admin']
  },
  general: {
    context: 'event',
    title: 'Event home / General',
    purpose: 'Overview: dates, venue, client, company, contacts, locations, summary, gallery.',
    datasets: ['general', 'executiveSummary', 'eventAccess'],
    related: ['scheduleIndex', 'crewIndex'],
    ask: ['Where is this event?', 'Who is the client?', 'When does it start?']
  },
  'executive-summary': {
    context: 'event',
    title: 'Executive Summary',
    purpose: 'Account / project managers, contract and invoice status, services, deliverables.',
    datasets: ['executiveSummary', 'general'],
    related: [],
    ask: ['Who is the account manager?', 'Is the contract signed?', 'What are the deliverables?']
  },
  crew: {
    context: 'event',
    title: 'Crew (call sheet)',
    purpose: 'Staff schedules: name, role, date, call time, availabilityStatus, userId.',
    datasets: ['crew'],
    related: ['scheduleIndex'],
    ask: ['Who has not accepted yet?', 'What is my call time?', 'Who works day 1?']
  },
  schedule: {
    context: 'event',
    title: 'Schedule (event rundown)',
    purpose: 'Conference sessions: name, date, times, location, photographer, notes, done.',
    datasets: ['schedule'],
    related: ['crewIndex'],
    ask: ['When is the keynote?', 'What is after lunch on day 2?', 'Who is shooting the opening?']
  },
  shotlist: {
    context: 'event',
    title: 'Shotlist',
    purpose: 'Photo checklists and completion.',
    datasets: ['shotlists'],
    related: ['scheduleIndex'],
    ask: ['What shots are left?', 'Do we have a headshot booth?']
  },
  todos: {
    context: 'event',
    title: 'To-Dos',
    purpose: 'Collaborative event tasks: task, status, dueDate, owner, notes.',
    datasets: ['todos'],
    related: [],
    ask: ['What is still open?', 'What is due tomorrow?', 'Who owns that task?']
  },
  'travel-accommodation': {
    context: 'event',
    title: 'Travel & Accommodation',
    purpose: 'Travel rows, hotels, and official FlightRequest bookings for this event.',
    datasets: ['travel', 'accommodation', 'flightRequests'],
    related: [],
    ask: ['When do I fly in?', 'What hotel am I in?', 'Who arrives on Monday?']
  },
  gear: {
    context: 'event',
    title: 'Gear',
    purpose: 'Gear lists, checkout dates, reserved items, packages, packed status.',
    datasets: ['gear'],
    related: [],
    ask: ['What is not packed?', 'Who reserved the R5?', 'When is checkout?']
  },
  'card-log': {
    context: 'event',
    title: 'Card Log',
    purpose: 'Memory card tracking by date, camera, and person.',
    datasets: ['cardLog'],
    related: [],
    ask: ['Who has card 32?', 'What cameras were used today?']
  },
  documents: {
    context: 'event',
    title: 'Documents',
    purpose: 'Uploaded PDFs, maps, and floor plans.',
    datasets: ['documents'],
    related: [],
    ask: ['Where is the floor plan?', 'What documents are uploaded?']
  },
  expenses: {
    context: 'event',
    title: 'Expenses',
    purpose: 'Admin/owner event costs: crew, flights, hotels, misc, reimbursements.',
    datasets: ['expenses'],
    related: [],
    ask: ['What is the crew cost?', 'How much are flights?'],
    ownerAdminOnly: true
  },
  'admin-notes': {
    context: 'event',
    title: 'Admin Notes',
    purpose: 'Internal pinned notes for owners and admins.',
    datasets: ['adminNotes'],
    related: [],
    ask: ['Any important reminders?', 'What is pinned?'],
    ownerAdminOnly: true
  }
};

function normalizePageName(raw) {
  if (!raw || typeof raw !== 'string') return 'events';
  const key = raw.toLowerCase().trim();
  return PAGE_ALIASES[key] || (PAGES[key] ? key : 'events');
}

function getPlaybook(page) {
  return PAGES[normalizePageName(page)] || PAGES.events;
}

function detectIntent(message) {
  const text = String(message || '').toLowerCase();
  const intent = new Set();

  if (text.match(/schedule|session|keynote|agenda|rundown|breakout|presentation|after lunch|what(?:'s| is) happening|start and end|end times?|first session|last session|wrap|how late/)) {
    intent.add('schedule');
  }
  if (text.match(/\b(crew|call time|calltime|who's working|who is working|availability|accepted|declined|tentative|confirmed|photographer|videographer)\b/) ||
      text.match(/\b(my call|when do i (work|need)|am i working)\b/)) {
    intent.add('crew');
  }
  if (text.match(/\b(i|my|me|am i|do i|when do i)\b/) || text.includes('my call') || text.includes('my assignment')) {
    intent.add('personal');
  }
  if (text.match(/gear|camera|lens|packed|unpacked|not packed|reservation|inventory|checkout|check-out|r5|package/)) {
    intent.add('gear');
  }
  if (text.match(/\b(task|todo|to-do|to do list|deadline|due today|due tomorrow|still open|open tasks|open items)\b/) ||
      text.match(/what(?:'s|s| is) (still )?(left|open)/)) {
    intent.add('todos');
  }
  if (text.match(/travel|flight|hotel|hotels|accommodation|airline|fly|flying|flying in|who's coming|who is coming|confirmation|lodging|staying|check-?in|check-?out|missing (a )?hotel|missing (a )?flight/)) {
    intent.add('travel');
  }
  if (text.match(/\b(card log|sd card|cfexpress|memory card|who has card|card \d+)\b/) ||
      text.match(/\bcard\b/)) {
    intent.add('cardLog');
  }
  if (text.match(/shotlist|shot list|headshot|booth|checklist of shots|shot lists|remaining shots|shots? (are |is )?(left|remaining)/)) {
    intent.add('shotlists');
  }
  if (text.match(/\b(documents?|pdfs?|floor ?plans?)\b/) || text.match(/\b(map|guide)\b/)) {
    intent.add('documents');
  }
  if (text.match(/admin notes?|\bpinned\b|\breminders?\b|what(?:'s| is) pinned/)) {
    intent.add('adminNotes');
  }
  if (text.match(/expense|crew cost|hotel cost|flight cost|grand total|how much (did we|have we) spend|how much (did|does) this (event )?cost|what did (this|the) event cost/)) {
    intent.add('expenses');
  }
  if (text.match(/\bbudget\b/)) {
    intent.add('expenses');
    intent.add('general');
  }
  if (text.match(/invoice|contract|account manager|project manager|deliverable|executive summary|signed|retainer/)) {
    intent.add('executiveSummary');
  }
  if (text.match(/location|venue|client|company|contact|where is|gallery/)) {
    intent.add('general');
  }
  if (text.match(/what day is|when is the |what events|all events|other events|which events/)) {
    intent.add('crossEvent');
  }
  if (text.match(/shar(e|ed)|who has access|who can see|who(?:'s| is) this (event )?shared|who (?:is|are) the owners?|who owns|event owners?/)) {
    intent.add('share');
  }

  return [...intent];
}

function getDatasetsToLoad(page, intent, mode) {
  const playbook = getPlaybook(page);
  const datasets = new Set(playbook.datasets);

  for (const related of playbook.related || []) {
    datasets.add(related);
  }

  for (const flag of intent) {
    if (flag === 'schedule') datasets.add(mode === 'event' ? 'schedule' : 'eventsOverview');
    if (flag === 'crew' || flag === 'personal') {
      datasets.add(mode === 'event' ? 'crew' : 'mySchedule');
    }
    if (flag === 'gear') {
      datasets.add(mode === 'event' ? 'gear' : 'inventorySummary');
      if (mode !== 'event') datasets.add('gear');
    }
    if (flag === 'todos') {
      datasets.add(mode === 'event' ? 'todos' : 'myEventTasks');
      if (mode !== 'event') datasets.add('todos');
    }
    if (flag === 'travel') {
      datasets.add('travel');
      datasets.add('accommodation');
      datasets.add(mode === 'event' ? 'flightRequests' : 'flights');
    }
    if (flag === 'cardLog') datasets.add('cardLog');
    if (flag === 'shotlists') datasets.add('shotlists');
    if (flag === 'documents') datasets.add('documents');
    if (flag === 'adminNotes') datasets.add('adminNotes');
    if (flag === 'expenses') datasets.add('expenses');
    if (flag === 'executiveSummary') datasets.add('executiveSummary');
    if (flag === 'general') datasets.add('general');
    if (flag === 'crossEvent') datasets.add('eventsOverview');
    if (flag === 'share') datasets.add('eventAccess');
  }

  if (mode === 'dashboard' || mode === 'global') {
    datasets.add('eventsOverview');
  }

  return [...datasets];
}

function getHowTheAppWorks() {
  return WORKFLOWS.join('\n');
}

module.exports = {
  PAGE_ALIASES,
  PAGES,
  WORKFLOWS,
  normalizePageName,
  getPlaybook,
  detectIntent,
  getDatasetsToLoad,
  getHowTheAppWorks
};

const Table = require('../models/Table');
const FlightRequest = require('../models/FlightRequest');
const PersonalTask = require('../models/PersonalTask');
const ReservedGearItem = require('../models/ReservedGearItem');
const GearPackage = require('../models/GearPackage');
const GearInventory = require('../models/GearInventory');
const CrewPlanner = require('../models/CrewPlanner');
const User = require('../models/User');
const {
  normalizePageName,
  getPlaybook,
  detectIntent,
  getDatasetsToLoad,
  getHowTheAppWorks
} = require('./lumaPageCatalog');

function to12Hour(value) {
  if (value == null || value === '') return value ?? null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/\b(am|pm)\b/i.test(raw)) {
    return raw.replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
  }

  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?$/);
  if (!match) return raw;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] != null ? match[2] : '00';
  if (Number.isNaN(hours) || hours > 23) return raw;

  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${suffix}`;
}

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

function compareClock(a, b) {
  return (parseTimeToMinutes(a) ?? 9999) - (parseTimeToMinutes(b) ?? 9999);
}

function sortByDateAndClock(items, dateKey, timeKey) {
  return [...items].sort((a, b) => {
    const dateCmp = String(a[dateKey] || '').localeCompare(String(b[dateKey] || ''));
    if (dateCmp) return dateCmp;
    return compareClock(a[timeKey], b[timeKey]);
  });
}

function dayWindows(items, { dateKey = 'date', startKey, endKey }) {
  const buckets = {};
  for (const item of items) {
    const date = item[dateKey] || 'undated';
    if (!buckets[date]) {
      buckets[date] = {
        date,
        count: 0,
        earliestStart: null,
        latestEnd: null,
        _startMin: Infinity,
        _endMin: -1
      };
    }
    const bucket = buckets[date];
    bucket.count += 1;

    const startMin = parseTimeToMinutes(item[startKey]);
    if (startMin != null && startMin < bucket._startMin) {
      bucket._startMin = startMin;
      bucket.earliestStart = to12Hour(item[startKey]);
    }

    const endMin = parseTimeToMinutes(item[endKey]);
    const candidateMin = endMin != null ? endMin : startMin;
    if (candidateMin != null && candidateMin > bucket._endMin) {
      bucket._endMin = candidateMin;
      bucket.latestEnd = to12Hour(endMin != null ? item[endKey] : item[startKey]);
    }
  }

  return Object.values(buckets)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(({ _startMin, _endMin, ...rest }) => rest);
}

function todayParts() {
  const now = new Date();
  return {
    date: now.toISOString().split('T')[0],
    dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
    time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  };
}

function userFirstName(user) {
  return (user?.fullName || '').split(' ')[0] || '';
}

function idList(values) {
  return [...new Set((values || []).map(value => {
    if (!value) return '';
    return value._id ? String(value._id) : String(value);
  }).filter(Boolean))];
}

async function loadEventAccess(table) {
  const ownerIds = idList(table.owners);
  const leadIds = idList(table.leads);
  const sharedIds = idList(table.sharedWith);
  const allIds = [...new Set([...ownerIds, ...leadIds, ...sharedIds])];
  const users = allIds.length
    ? await User.find({ _id: { $in: allIds } }).select('fullName email role').lean()
    : [];
  const byId = new Map(users.map(user => [String(user._id), {
    name: user.fullName,
    email: user.email,
    role: user.role
  }]));
  const lookup = (ids) => ids.map(id => byId.get(id) || { name: 'Unknown user', id });

  const ownerSet = new Set(ownerIds);
  const leadSet = new Set(leadIds);
  const leadsOnly = leadIds.filter(id => !ownerSet.has(id));
  const sharedOnly = sharedIds.filter(id => !ownerSet.has(id) && !leadSet.has(id));
  const sharedWith = [...leadsOnly, ...sharedOnly];

  const owners = lookup(ownerIds);
  return {
    owners,
    ownerNames: owners.map(person => person.name),
    leads: lookup(leadsOnly),
    shared: lookup(sharedOnly),
    sharedWith: lookup(sharedWith),
    counts: {
      owners: owners.length,
      leads: leadsOnly.length,
      shared: sharedOnly.length,
      sharedWith: sharedWith.length,
      totalAccess: owners.length + leadsOnly.length + sharedOnly.length
    },
    note: 'An event can have multiple owners. ownerNames and sharedWith are complete lists — name everyone.'
  };
}

function ownerIdString(owner) {
  return owner?._id?.toString() || owner?.toString() || '';
}

function isOwnerOf(table, user) {
  const userId = user?.id?.toString();
  return Array.isArray(table?.owners) && table.owners.some(o => o.toString() === userId);
}

function eventAccessQuery(user) {
  if (user.role === 'admin' || user.role === 'planner') return {};
  return {
    $or: [
      { owners: user.id },
      { sharedWith: user.id },
      { leads: user.id },
      { 'rows.userId': user.id }
    ]
  };
}

function redactGeneral(general, canSeeAdminData) {
  const copy = { ...(general || {}) };
  if (!canSeeAdminData) {
    delete copy.budget;
    delete copy.contractUrl;
    delete copy.invoiceUrl;
  }
  return {
    location: copy.location || null,
    city: copy.city || null,
    state: copy.state || null,
    start: copy.start || null,
    end: copy.end || null,
    client: copy.client || null,
    company: copy.company || null,
    attendees: copy.attendees ?? null,
    summary: copy.summary || null,
    galleryUrl: copy.galleryUrl || null,
    contacts: (copy.contacts || []).map(c => ({
      name: c.name,
      role: c.role,
      email: c.email,
      phone: c.number,
      company: c.company,
      isMain: !!c.isMain
    })),
    locations: copy.locations || [],
    budget: copy.budget,
    contractUrl: copy.contractUrl,
    invoiceUrl: copy.invoiceUrl
  };
}

function redactExecutiveSummary(summary, canSeeAdminData) {
  if (!summary) return null;
  const base = {
    accountManager: summary.accountManager || '',
    accountManagerEmail: summary.accountManagerEmail || '',
    projectManager: summary.projectManager || '',
    projectManagerEmail: summary.projectManagerEmail || '',
    clientContact: summary.clientContact || '',
    company: summary.company || '',
    email: summary.email || '',
    phone: summary.phone || '',
    services: summary.services || [],
    deliverables: (summary.deliverables || []).map(d => ({
      item: d.item,
      dueDate: d.dueDate
    })),
    notes: summary.notes || ''
  };
  if (!canSeeAdminData) return base;
  return {
    ...base,
    contractLink: summary.contractLink || '',
    signed: summary.signed || '',
    invoiceLink: summary.invoiceLink || '',
    paid: summary.paid || ''
  };
}

function mapCrewRow(row) {
  return {
    name: row.name,
    role: row.role,
    date: row.date,
    callTime: to12Hour(row.startTime),
    endTime: to12Hour(row.endTime),
    totalHours: row.totalHours,
    notes: row.notes,
    availabilityStatus: row.availabilityStatus || 'tentative',
    userId: row.userId ? String(row.userId) : null
  };
}

function mapScheduleItem(item) {
  return {
    date: item.date,
    name: item.name,
    startTime: to12Hour(item.startTime),
    endTime: to12Hour(item.endTime),
    location: item.location,
    photographer: item.photographer,
    notes: item.notes,
    done: !!item.done,
    important: !!item.important
  };
}

function mapTodo(todo, eventTitle) {
  return {
    event: eventTitle || undefined,
    task: todo.task,
    status: todo.status,
    dueDate: todo.dueDate ? new Date(todo.dueDate).toISOString().split('T')[0] : null,
    assignedTo: todo.owner?.fullName || todo.owner?.email || (todo.owner ? 'Assigned' : 'Unassigned'),
    notes: todo.notes || ''
  };
}

function personKey(name) {
  return String(name || '').trim().toLowerCase();
}

function uniqueNames(names) {
  const seen = new Set();
  const out = [];
  for (const name of names || []) {
    const key = personKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(name).trim());
  }
  return out;
}

function parseMoney(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0;
}

function asPlainObject(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  if (typeof value.toObject === 'function') return value.toObject();
  return value;
}

function attachTodoRollups(kb, mappedTodos, today) {
  kb.todos = mappedTodos;
  kb.openTodos = mappedTodos.filter(todo => todo.status !== 'done');
  const byOwner = {};
  for (const todo of mappedTodos) {
    const owner = todo.assignedTo || 'Unassigned';
    if (!byOwner[owner]) byOwner[owner] = { assignedTo: owner, open: [], done: [] };
    (todo.status === 'done' ? byOwner[owner].done : byOwner[owner].open).push(todo.task);
  }
  kb.todosByOwner = Object.values(byOwner);
  kb.todoSummary = {
    total: mappedTodos.length,
    todo: mappedTodos.filter(todo => todo.status === 'todo').length,
    inProgress: mappedTodos.filter(todo => todo.status === 'in-progress').length,
    done: mappedTodos.filter(todo => todo.status === 'done').length,
    open: mappedTodos.filter(todo => todo.status !== 'done').length,
    overdue: mappedTodos.filter(todo => todo.dueDate && todo.dueDate < today && todo.status !== 'done').length,
    note: 'openTodos is the complete open list — name every task.'
  };
}

function mapShotlistData(table, eventTitle) {
  const lists = (table.shotlists || []).map(list => {
    const items = (list.items || []).map(item => ({
      title: item.title,
      completed: !!item.completed,
      completedBy: item.completedByName || null
    }));
    const remainingTitles = items.filter(item => !item.completed).map(item => item.title);
    return {
      event: eventTitle || undefined,
      name: list.name,
      total: items.length,
      done: items.length - remainingTitles.length,
      remaining: remainingTitles.length,
      remainingTitles,
      items
    };
  });
  const legacyShotlist = (table.shotlist || []).map(item => ({
    event: eventTitle || undefined,
    title: item.title,
    completed: !!item.completed,
    priority: item.priority || null,
    category: item.category || ''
  }));
  const remainingTitles = [
    ...lists.flatMap(list => list.remainingTitles),
    ...legacyShotlist.filter(item => !item.completed).map(item => item.title)
  ];
  return {
    shotlists: lists,
    legacyShotlist,
    shotlistSummary: {
      event: eventTitle || undefined,
      listCount: lists.length + (legacyShotlist.length ? 1 : 0),
      total: lists.reduce((sum, list) => sum + list.total, 0) + legacyShotlist.length,
      done: lists.reduce((sum, list) => sum + list.done, 0) + legacyShotlist.filter(item => item.completed).length,
      remaining: remainingTitles.length,
      remainingTitles,
      note: 'remainingTitles is complete — name every remaining shot.'
    }
  };
}

function mapLegacyGearLists(gear) {
  const lists = asPlainObject(gear?.lists);
  return Object.entries(lists).map(([listName, list]) => {
    const categories = asPlainObject(list?.categories || list);
    const mapped = {};
    for (const [category, items] of Object.entries(categories)) {
      if (!Array.isArray(items)) continue;
      mapped[category] = {
        total: items.length,
        checked: items.filter(item => item.checked).length,
        unchecked: items.filter(item => !item.checked).map(item => item.label).filter(Boolean)
      };
    }
    return { name: listName, categories: mapped };
  });
}

function mapCardLogData(table, eventTitle) {
  const cardLog = (table.cardLog || []).map(day => ({
    event: eventTitle || undefined,
    date: day.date,
    entries: (day.entries || []).map(entry => ({
      camera: entry.camera,
      card1: entry.card1,
      card2: entry.card2,
      user: entry.user,
      category: entry.category || null,
      notes: entry.notes
    }))
  }));
  const cardLookup = [];
  const byPerson = {};
  const cameras = new Set();
  for (const day of cardLog) {
    for (const entry of day.entries) {
      if (entry.camera) cameras.add(entry.camera);
      const person = entry.user || 'Unknown';
      if (!byPerson[person]) byPerson[person] = { user: person, cards: [], cameras: [] };
      if (entry.camera) byPerson[person].cameras.push(entry.camera);
      for (const card of [entry.card1, entry.card2].filter(Boolean)) {
        cardLookup.push({
          card,
          user: entry.user,
          camera: entry.camera,
          date: day.date,
          category: entry.category,
          event: eventTitle || undefined
        });
        byPerson[person].cards.push(card);
      }
    }
  }
  return {
    cardLog,
    cardLookup,
    cardsByPerson: Object.values(byPerson).map(person => ({
      ...person,
      cards: uniqueNames(person.cards),
      cameras: uniqueNames(person.cameras)
    })),
    camerasUsed: [...cameras]
  };
}

function mapAdminNotesData(notes, canSeeAdminData) {
  if (!canSeeAdminData) {
    return {
      adminNotes: { error: 'Admin notes are limited to owners and admins.' },
      notesSummary: { error: 'Admin notes are limited to owners and admins.' }
    };
  }
  const adminNotes = (notes || []).map(note => ({
    title: note.title,
    content: note.content,
    pinned: !!note.pinned,
    createdBy: note.createdByName
  }));
  return {
    adminNotes,
    notesSummary: {
      total: adminNotes.length,
      pinned: adminNotes.filter(note => note.pinned).length,
      pinnedTitles: adminNotes.filter(note => note.pinned).map(note => note.title).filter(Boolean)
    }
  };
}

function mapExpenseData(expenses, canSeeAdminData) {
  if (!canSeeAdminData) {
    return {
      expenses: { error: 'Expenses are limited to owners and admins.' },
      expenseTotals: { error: 'Expenses are limited to owners and admins.' }
    };
  }
  const data = expenses || {};
  const crew = (data.crew || []).map(row => {
    const hours = parseMoney(row.hours);
    const rate = parseMoney(row.rate);
    const additionalCost = parseMoney(row.additionalCost);
    const total = parseMoney(row.total) || parseMoney(hours * rate + additionalCost);
    return {
      name: row.name,
      role: row.role,
      hours,
      rate,
      additionalCost,
      total,
      notes: row.notes || ''
    };
  });
  const flights = (data.flights || []).map(row => ({
    passengerName: row.passengerName,
    date: row.date,
    airline: row.airline,
    refNumber: row.refNumber,
    cost: parseMoney(row.cost),
    notes: row.notes || ''
  }));
  const accommodation = (data.accommodation || []).map(row => ({
    name: row.name,
    hotel: row.hotel,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    refNumber: row.refNumber,
    cost: parseMoney(row.cost),
    notes: row.notes || ''
  }));
  const misc = (data.misc || []).map(row => ({
    item: row.item,
    description: row.description,
    cost: parseMoney(row.cost),
    notes: row.notes || ''
  }));
  const reimbursements = (data.reimbursements || []).map(row => ({
    submittedBy: row.submittedBy,
    dateSubmitted: row.dateSubmitted,
    description: row.description,
    amount: parseMoney(row.amount)
  }));
  const crewTotal = parseMoney(crew.reduce((sum, row) => sum + row.total, 0));
  const flightsTotal = parseMoney(flights.reduce((sum, row) => sum + row.cost, 0));
  const accommodationTotal = parseMoney(accommodation.reduce((sum, row) => sum + row.cost, 0));
  const miscTotal = parseMoney(misc.reduce((sum, row) => sum + row.cost, 0));
  const reimbursementsTotal = parseMoney(reimbursements.reduce((sum, row) => sum + row.amount, 0));
  return {
    expenses: { crew, flights, accommodation, misc, reimbursements },
    expenseTotals: {
      crew: crewTotal,
      flights: flightsTotal,
      accommodation: accommodationTotal,
      misc: miscTotal,
      reimbursements: reimbursementsTotal,
      grand: parseMoney(crewTotal + flightsTotal + accommodationTotal + miscTotal + reimbursementsTotal),
      note: 'grand matches the Expenses page total. Use these numbers; do not re-add from memory.'
    }
  };
}

function travelGapsForEvent(event, flyingIn = [], hotels = []) {
  const hotel = hotels.find(row => row.event === event.title) || hotelsByEventSummary([event])[0];
  const flying = flyingIn.find(row => row.event === event.title) || { passengers: [] };
  const travelNames = uniqueNames((event.travel || []).map(row => row.name));
  const flightNames = uniqueNames(flying.passengers || []);
  const travelers = uniqueNames([...travelNames, ...flightNames]);
  const guests = uniqueNames(hotel?.guests || (event.accommodation || []).map(row => row.name));
  return {
    event: event.title,
    missingHotel: hotel?.status === 'not_required'
      ? []
      : travelers.filter(name => !guests.some(guest => personKey(guest) === personKey(name))),
    missingFlight: travelNames.filter(name => !flightNames.some(guest => personKey(guest) === personKey(name)))
  };
}

const EVENT_DETAIL_SELECT = 'title general rows owners leads sharedWith todos travel accommodation badgesNotRequired badgesRequested shotlists shotlist gear cardLog expenses adminNotes';

async function hydrateNamedEvents(events) {
  const ids = (events || []).map(event => event._id).filter(Boolean);
  if (!ids.length) return [];
  const fresh = await Table.find({ _id: { $in: ids } })
    .select(EVENT_DETAIL_SELECT)
    .populate('todos.owner', 'fullName email')
    .populate('todos.createdBy', 'fullName email')
    .lean();
  const byId = new Map(fresh.map(event => [String(event._id), event]));
  return ids.map(id => byId.get(String(id))).filter(Boolean);
}

async function resolveNamedEventDetails(message, fallbackEvents = []) {
  const hints = namedEventHints(message);
  if (!hints.length) return [];
  const resolved = await resolveEventsFromHints(hints, fallbackEvents);
  return hydrateNamedEvents(resolved);
}

function canSeeEventAdmin(event, user, canSeeAdminData) {
  return !!(canSeeAdminData || user?.role === 'admin' || isOwnerOf(event, user));
}

function searchTerms(message) {
  return String(message || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(term => term.length > 2);
}

function matchesTerms(text, terms) {
  if (!terms.length) return false;
  const hay = String(text || '').toLowerCase();
  return terms.some(term => hay.includes(term));
}

function compressByDate(items, { message, today, getDate, keepFullIf, maxFull = 40 }) {
  if (!items || items.length <= maxFull) return items;
  const terms = searchTerms(message);
  const full = [];
  const rest = [];
  for (const item of items) {
    if (keepFullIf?.(item) || matchesTerms(JSON.stringify(item), terms) || getDate(item) === today) {
      full.push(item);
    } else {
      rest.push(item);
    }
  }
  const remaining = Math.max(0, maxFull - full.length);
  const extra = rest.slice(0, remaining);
  const omitted = rest.slice(remaining);
  const byDate = {};
  for (const item of omitted) {
    const date = getDate(item) || 'undated';
    byDate[date] = (byDate[date] || 0) + 1;
  }
  const result = [...full, ...extra];
  if (Object.keys(byDate).length) {
    result.push({
      _summary: true,
      omittedByDate: byDate,
      note: 'Additional items were summarized by date. Ask about a specific date or name for full rows.'
    });
  }
  return result;
}

async function loadAccessibleEvents(user, { limit = 40 } = {}) {
  return Table.find(eventAccessQuery(user))
    .select('title general rows adminNotes programSchedule owners leads sharedWith todos travel accommodation badgesNotRequired badgesRequested')
    .populate('todos.owner', 'fullName email')
    .populate('todos.createdBy', 'fullName email')
    .sort({ 'general.start': -1 })
    .limit(limit)
    .lean();
}

function mapEventOverview(event) {
  return {
    id: String(event._id),
    name: event.title,
    client: event.general?.client || null,
    company: event.general?.company || null,
    start: event.general?.start || null,
    end: event.general?.end || null,
    venue: event.general?.location || null,
    city: event.general?.city || null,
    state: event.general?.state || null
  };
}

function collectMySchedule(events, user) {
  const first = userFirstName(user).toLowerCase();
  const userId = user.id?.toString();
  const rows = [];
  for (const event of events) {
    for (const row of event.rows || []) {
      const matchesUser = (row.userId && String(row.userId) === userId) ||
        (first && row.name?.toLowerCase().includes(first));
      if (matchesUser) {
        rows.push({
          event: event.title,
          ...mapCrewRow(row)
        });
      }
    }
  }
  return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function collectMyEventTasks(events, user, today) {
  const userId = user.id?.toString();
  const email = user.email?.toLowerCase();
  const myTasks = [];
  const dueToday = [];
  for (const event of events) {
    for (const todo of event.todos || []) {
      const ownerId = ownerIdString(todo.owner);
      const createdById = ownerIdString(todo.createdBy);
      const ownerEmail = todo.owner?.email?.toLowerCase();
      const mine = ownerId === userId || createdById === userId || (email && ownerEmail === email);
      if (!mine) continue;
      const mapped = mapTodo(todo, event.title);
      mapped.overdue = !!(mapped.dueDate && mapped.dueDate < today && mapped.status !== 'done');
      myTasks.push(mapped);
      if (mapped.status !== 'done' && mapped.dueDate && (mapped.dueDate === today || mapped.dueDate < today)) {
        dueToday.push({ ...mapped, urgent: mapped.dueDate < today });
      }
    }
  }
  return { myTasks, dueToday };
}

const ACTIVE_FLIGHT_STATUSES = ['pending', 'booked', 'change_requested'];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function namedEventHints(message) {
  const text = String(message || '').trim();
  const hints = [];
  const patterns = [
    /\b(?:for|to|at|on)\s+(?:the\s+)?(.+?)(?:\s+event)?[?.!]*$/i,
    /\bshar(?:e|ed)\s+(?:the\s+)?(.+?)(?:\s+event)?\s+with\b/i,
    /\bowners? of\s+(?:the\s+)?(.+?)(?:\s+event)?[?.!]*$/i,
    /\bwho owns\s+(?:the\s+)?(.+?)(?:\s+event)?[?.!]*$/i,
    /\b(?:the\s+)?([A-Za-z0-9][\w &'/-]{1,50}?)\s+event\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const hint = match[1].trim();
    if (hint.length > 2 && !/^(this|that|the|it|there|here|an|my)$/i.test(hint)) {
      hints.push(hint);
    }
  }
  return [...new Set(hints)];
}

function eventMatchesHint(event, hint) {
  if (!hint) return false;
  const needle = hint.toLowerCase();
  const title = (event.title || '').toLowerCase();
  const hay = [event.title, event.general?.client, event.general?.company]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(needle) || (title.length > 3 && needle.includes(title));
}

function mapFlightDoc(f) {
  const populatedTitle = f.eventId && typeof f.eventId === 'object' ? f.eventId.title : null;
  const eventId = f.eventId?._id ? String(f.eventId._id) : (f.eventId ? String(f.eventId) : null);
  return {
    eventId,
    event: populatedTitle || f.eventName || null,
    from: f.from?.city || f.from?.code,
    to: f.to?.city || f.to?.code,
    departDate: f.departDate,
    returnDate: f.returnDate,
    passengers: (f.passengers || []).map(p => p.name).filter(Boolean),
    airline: f.bookedDetails?.airline || 'TBD',
    confirmationCode: f.bookedDetails?.confirmationCode || null,
    status: f.status,
    tripType: f.tripType
  };
}

function mapAccommodationRow(row, eventTitle) {
  return {
    event: eventTitle || undefined,
    hotel: row.hotel || null,
    guest: row.name || null,
    checkin: row.checkin || null,
    checkout: row.checkout || null,
    ref: row.ref || null
  };
}

function hotelsByEventSummary(events) {
  return (events || []).map(event => {
    const rows = (event.accommodation || []).map(row => mapAccommodationRow(row, event.title));
    const hotels = [...new Set(rows.map(row => row.hotel).filter(Boolean))];
    const guests = [...new Set(rows.map(row => row.guest).filter(Boolean))];
    let status = 'none';
    if (rows.length) status = 'booked';
    else if (event.badgesRequested?.hotel) status = 'requested';
    else if (event.badgesNotRequired?.hotel) status = 'not_required';
    return {
      event: event.title,
      status,
      hotelCount: hotels.length,
      bookingCount: rows.length,
      hotels,
      guests,
      bookings: rows
    };
  });
}

function flyingInSummary(flights, travelRows = []) {
  const byEvent = {};
  const add = (event, name, source) => {
    const key = event || 'Unlinked';
    if (!byEvent[key]) byEvent[key] = { event: key, passengers: [], sources: {} };
    if (!name) return;
    if (!byEvent[key].sources[name]) {
      byEvent[key].passengers.push(name);
      byEvent[key].sources[name] = source;
    }
  };
  for (const flight of flights) {
    for (const name of flight.passengers || []) add(flight.event, name, 'flightRequest');
  }
  for (const row of travelRows) {
    add(row.event, row.name, 'travelRow');
  }
  return Object.values(byEvent).map(group => ({
    event: group.event,
    passengers: group.passengers,
    count: group.passengers.length
  }));
}

async function queryFlights({ eventIds = [], nameHints = [], extraAnd = [], limit = 60 } = {}) {
  const or = [];
  if (eventIds.length) or.push({ eventId: { $in: eventIds } });
  for (const hint of nameHints) {
    if (hint && hint.length > 2) {
      or.push({ eventName: { $regex: escapeRegex(hint), $options: 'i' } });
    }
  }

  const query = { status: { $in: ACTIVE_FLIGHT_STATUSES } };
  if (or.length) query.$or = or;
  if (extraAnd.length) {
    query.$and = extraAnd;
  }

  const docs = await FlightRequest.find(query)
    .populate('eventId', 'title')
    .sort({ departDate: 1 })
    .limit(limit)
    .lean();
  return docs.map(mapFlightDoc);
}

async function resolveEventsFromHints(hints, fallbackEvents = []) {
  if (!hints.length) return fallbackEvents;
  const local = fallbackEvents.filter(event => hints.some(hint => eventMatchesHint(event, hint)));
  const found = await Table.find({
    $or: hints.map(hint => ({ title: { $regex: escapeRegex(hint), $options: 'i' } }))
  }).select('_id title general travel accommodation badgesNotRequired badgesRequested owners leads sharedWith').limit(15).lean();
  const byId = new Map();
  for (const event of [...local, ...found]) byId.set(String(event._id), event);
  return [...byId.values()];
}

async function loadFlights(user, events, firstName, message) {
  const hints = namedEventHints(message);
  const matchedEvents = hints.length
    ? await resolveEventsFromHints(hints, events)
    : events;
  const eventIds = (hints.length ? matchedEvents : events).map(e => e._id);
  const nameHints = [...hints, ...matchedEvents.map(e => e.title).filter(Boolean)];

  const extraAnd = [];
  if (user.role !== 'admin' && user.role !== 'planner') {
    extraAnd.push({
      $or: [
        { createdBy: user.id },
        { 'passengers.name': { $regex: firstName || 'a^', $options: 'i' } },
        { eventId: { $in: events.map(e => e._id) } }
      ]
    });
  }

  return queryFlights({
    eventIds,
    nameHints,
    extraAnd,
    limit: hints.length ? 50 : 40
  });
}

async function loadEventGear(table) {
  const lists = (table.gear?.gearLists || []).map(list => ({
    name: list.displayName || list.name,
    manualItems: (list.manualItems || []).map(item => ({
      text: item.text,
      completed: !!item.completed
    }))
  }));
  const legacyLists = mapLegacyGearLists(table.gear);

  let reservations = [];
  try {
    const reserved = await ReservedGearItem.find({ eventId: table._id })
      .populate('userId', 'fullName')
      .sort({ createdAt: -1 })
      .lean();
    reservations = reserved.map(item => ({
      item: `${item.brand || ''} ${item.model || ''}`.trim(),
      category: item.category,
      serial: item.serial,
      quantity: item.quantity || 1,
      listName: item.listName,
      reservedBy: item.userId?.fullName || null,
      packed: !!item.isPacked,
      checkOutDate: item.checkOutDate,
      checkInDate: item.checkInDate
    }));
  } catch (err) {
    console.error('[Luma] Reserved gear load failed:', err.message);
  }

  let packages = [];
  try {
    const pkgs = await GearPackage.find({ eventId: table._id }).lean();
    packages = pkgs.map(pkg => ({
      name: pkg.name || null,
      quantity: pkg.quantity,
      serial: pkg.serial,
      packed: !!pkg.packed
    }));
  } catch (err) {
    console.error('[Luma] Gear packages load failed:', err.message);
  }

  const unpacked = reservations.filter(item => !item.packed).map(item => item.item);
  const unpackedPackages = packages.filter(pkg => !pkg.packed).map(pkg => pkg.name).filter(Boolean);

  return {
    event: table.title || undefined,
    checkOutDate: table.gear?.checkOutDate || null,
    checkInDate: table.gear?.checkInDate || null,
    currentList: table.gear?.currentList || null,
    lists,
    legacyLists,
    reservations,
    packages,
    packingProgress: {
      total: reservations.length,
      packed: reservations.filter(item => item.packed).length
    },
    gearSummary: {
      reserved: reservations.length,
      packed: reservations.filter(item => item.packed).length,
      unpacked,
      unpackedCount: unpacked.length,
      packages: packages.length,
      unpackedPackages,
      checkOutDate: table.gear?.checkOutDate || null,
      checkInDate: table.gear?.checkInDate || null,
      note: 'unpacked is the complete not-packed reservation list — name every item.'
    }
  };
}

async function loadDashboardDatasets(datasets, { user, message, canSeeAdminData }) {
  const kb = {};
  const today = todayParts().date;
  const first = userFirstName(user);
  const needEvents = datasets.some(d =>
    ['eventsOverview', 'mySchedule', 'myEventTasks', 'crewCalendar', 'flights', 'travel', 'accommodation', 'eventAccess', 'todos', 'shotlists', 'gear', 'cardLog', 'adminNotes', 'expenses'].includes(d)
  );
  const events = needEvents ? await loadAccessibleEvents(user) : [];
  const namedEvents = await resolveNamedEventDetails(message, events);

  if (datasets.includes('eventAccess')) {
    const hints = namedEventHints(message);
    const accessSource = hints.length
      ? await resolveEventsFromHints(hints, events)
      : events;
    kb.eventAccess = await Promise.all(accessSource.slice(0, 20).map(async event => ({
      event: event.title,
      ...(await loadEventAccess(event))
    })));
  }

  if (datasets.includes('eventsOverview')) {
    kb.events = events.map(e => {
      const overview = mapEventOverview(e);
      if (canSeeAdminData || isOwnerOf(e, user)) {
        overview.notes = (e.adminNotes || []).slice(0, 5).map(n => ({
          title: n.title,
          pinned: n.pinned
        }));
      }
      return overview;
    });
  }

  if (datasets.includes('mySchedule')) {
    kb.mySchedule = collectMySchedule(events, user);
    kb.myScheduleByDay = dayWindows(kb.mySchedule, {
      startKey: 'callTime',
      endKey: 'endTime'
    });
  }

  if (datasets.includes('myEventTasks')) {
    const { myTasks, dueToday } = collectMyEventTasks(events, user, today);
    kb.myEventTasks = myTasks;
    kb.tasksDueToday = dueToday;
  }

  if (datasets.includes('personalTasks')) {
    const personal = await PersonalTask.find({ user: user.id }).sort({ dueDate: 1 }).limit(40).lean();
    kb.personalTasks = personal.map(t => ({
      task: t.task,
      status: t.status,
      dueDate: t.dueDate ? new Date(t.dueDate).toISOString().split('T')[0] : null,
      notes: t.notes || ''
    }));
  }

  if (datasets.includes('flights') || datasets.includes('travel') || datasets.includes('accommodation')) {
    const hints = namedEventHints(message);
    const travelSource = hints.length
      ? await resolveEventsFromHints(hints, events)
      : events;

    if (datasets.includes('flights') || datasets.includes('travel')) {
      kb.flights = await loadFlights(user, events, first, message);
      kb.myFlights = (kb.flights || []).filter(f =>
        (f.passengers || []).some(p => first && String(p).toLowerCase().includes(first.toLowerCase()))
      );
      kb.eventTravel = travelSource.flatMap(event =>
        (event.travel || []).map(row => ({
          event: event.title,
          name: row.name,
          date: row.date,
          fromTo: row.fromTo,
          airline: row.airline
        }))
      );
      kb.flyingInByEvent = flyingInSummary(kb.flights, kb.eventTravel);
    }

    kb.eventAccommodation = travelSource.flatMap(event =>
      (event.accommodation || []).map(row => mapAccommodationRow(row, event.title))
    );
    kb.hotelsByEvent = hotelsByEventSummary(travelSource);
    if (hints.length) {
      kb.travelGaps = travelSource.map(event =>
        travelGapsForEvent(event, kb.flyingInByEvent || [], kb.hotelsByEvent || [])
      );
    }
  }

  if (datasets.includes('todos') && namedEvents.length) {
    const mappedTodos = namedEvents.flatMap(event => (event.todos || []).map(todo => mapTodo(todo, event.title)));
    attachTodoRollups(kb, mappedTodos, today);
  }

  if (datasets.includes('shotlists') && namedEvents.length) {
    const shotData = namedEvents.map(event => mapShotlistData(event, event.title));
    kb.shotlists = shotData.flatMap(data => data.shotlists);
    kb.legacyShotlist = shotData.flatMap(data => data.legacyShotlist);
    kb.shotlistSummary = shotData.map(data => data.shotlistSummary);
  }

  if (datasets.includes('gear') && namedEvents.length) {
    kb.eventGear = await Promise.all(namedEvents.map(event => loadEventGear(event)));
    kb.gearSummary = kb.eventGear.map(gear => gear.gearSummary);
  }

  if (datasets.includes('cardLog') && namedEvents.length) {
    const cardData = namedEvents.map(event => mapCardLogData(event, event.title));
    kb.cardLog = cardData.flatMap(data => data.cardLog);
    kb.cardLookup = cardData.flatMap(data => data.cardLookup);
    kb.cardsByPerson = cardData.flatMap(data => data.cardsByPerson);
    kb.camerasUsed = uniqueNames(cardData.flatMap(data => data.camerasUsed));
  }

  if (datasets.includes('adminNotes') && namedEvents.length) {
    const notes = namedEvents.map(event => ({
      event: event.title,
      ...mapAdminNotesData(event.adminNotes, canSeeEventAdmin(event, user, canSeeAdminData))
    }));
    kb.adminNotes = notes.length === 1 ? notes[0].adminNotes : notes.map(row => ({ event: row.event, notes: row.adminNotes }));
    kb.notesSummary = notes.length === 1 ? notes[0].notesSummary : notes.map(row => ({ event: row.event, ...row.notesSummary }));
  }

  if (datasets.includes('expenses') && namedEvents.length) {
    const expenseRows = namedEvents.map(event => ({
      event: event.title,
      ...mapExpenseData(event.expenses, canSeeEventAdmin(event, user, canSeeAdminData))
    }));
    kb.expenses = expenseRows.length === 1 ? expenseRows[0].expenses : expenseRows.map(row => ({ event: row.event, ...row.expenses }));
    kb.expenseTotals = expenseRows.length === 1 ? expenseRows[0].expenseTotals : expenseRows.map(row => ({ event: row.event, ...row.expenseTotals }));
  }

  if (datasets.includes('inventorySummary')) {
    if (user.role === 'admin' || user.role === 'production_manager') {
      const items = await GearInventory.find()
        .select('label category serial quantity')
        .limit(80)
        .lean();
      const byCategory = {};
      for (const item of items) {
        const cat = item.category || 'Other';
        if (!byCategory[cat]) byCategory[cat] = { count: 0, samples: [] };
        byCategory[cat].count += item.quantity || 1;
        if (byCategory[cat].samples.length < 8) {
          byCategory[cat].samples.push({ label: item.label, serial: item.serial });
        }
      }
      kb.inventorySummary = { totalItems: items.length, byCategory };
    } else {
      kb.inventorySummary = { error: 'Inventory is limited to admins and production managers.' };
    }
  }

  if (datasets.includes('crewPlanner')) {
    if (user.role === 'admin') {
      const boards = await CrewPlanner.find().sort({ updatedAt: -1 }).limit(5).lean();
      kb.crewPlanner = boards.map(board => ({
        name: board.name,
        description: board.description,
        dates: (board.dates || []).slice(0, 12).map(d => ({
          date: d.date,
          events: (d.events || []).map(ev => ({
            name: ev.name,
            location: ev.location,
            crew: (ev.crew || []).map(c => ({ role: c.role, crewMember: c.crewMember }))
          }))
        }))
      }));
    } else {
      kb.crewPlanner = { error: 'Crew planner is admin only.' };
    }
  }

  if (datasets.includes('crewCalendar')) {
    const calendar = [];
    for (const event of events) {
      for (const row of (event.rows || []).slice(0, 30)) {
        calendar.push({
          event: event.title,
          ...mapCrewRow(row)
        });
      }
    }
    kb.crewCalendar = compressByDate(calendar, {
      message,
      today,
      getDate: row => row.date,
      maxFull: 50
    });
  }

  return kb;
}

async function loadEventDatasets(datasets, { table, user, message, canSeeAdminData }) {
  const kb = {};
  const today = todayParts().date;
  const first = userFirstName(user);

  if (table.populate) {
    await table.populate([
      { path: 'todos.owner', select: 'fullName email' },
      { path: 'todos.createdBy', select: 'fullName email' }
    ]);
  }

  if (datasets.includes('general')) {
    kb.general = redactGeneral(table.general, canSeeAdminData);
  }

  if (datasets.includes('executiveSummary')) {
    kb.executiveSummary = redactExecutiveSummary(table.executiveSummary, canSeeAdminData);
  }

  if (datasets.includes('schedule') || datasets.includes('scheduleIndex')) {
    const rawSchedule = table.programSchedule || [];
    kb.scheduleByDay = dayWindows(rawSchedule, {
      startKey: 'startTime',
      endKey: 'endTime'
    });
    const all = sortByDateAndClock(rawSchedule.map(mapScheduleItem), 'date', 'startTime');
    if (datasets.includes('schedule')) {
      kb.programSchedule = compressByDate(all, {
        message,
        today,
        getDate: item => item.date,
        keepFullIf: item => item.important,
        maxFull: 45
      });
    } else {
      kb.scheduleIndex = all.slice(0, 20).map(s => ({
        date: s.date,
        name: s.name,
        startTime: s.startTime,
        photographer: s.photographer
      }));
    }
  }

  if (datasets.includes('crew') || datasets.includes('crewIndex')) {
    const rawCrew = table.rows || [];
    kb.crewByDay = dayWindows(rawCrew, {
      startKey: 'startTime',
      endKey: 'endTime'
    });
    const all = sortByDateAndClock(rawCrew.map(mapCrewRow), 'date', 'callTime');
    if (datasets.includes('crew')) {
      kb.crew = compressByDate(all, {
        message,
        today,
        getDate: row => row.date,
        keepFullIf: row => {
          const mine = first && row.name?.toLowerCase().includes(first.toLowerCase());
          return mine || ['requested', 'tentative', 'declined'].includes(row.availabilityStatus);
        },
        maxFull: 50
      });
    } else {
      kb.crewIndex = all.slice(0, 20).map(r => ({
        name: r.name,
        role: r.role,
        date: r.date,
        callTime: r.callTime,
        availabilityStatus: r.availabilityStatus
      }));
    }
  }

  if (datasets.includes('todos')) {
    attachTodoRollups(kb, (table.todos || []).map(todo => mapTodo(todo, table.title)), today);
  }

  if (datasets.includes('shotlists')) {
    Object.assign(kb, mapShotlistData(table, table.title));
  }

  if (datasets.includes('travel') || datasets.includes('accommodation') || datasets.includes('flightRequests')) {
    if (datasets.includes('travel')) {
      kb.travel = (table.travel || []).map(row => ({
        date: row.date,
        depart: to12Hour(row.depart || row.time),
        arrive: to12Hour(row.arrive),
        airline: row.airline,
        name: row.name,
        fromTo: row.fromTo,
        ref: row.ref
      }));
    }
    if (datasets.includes('accommodation') || datasets.includes('travel')) {
      const hints = namedEventHints(message);
      const hotelEvents = hints.length ? await resolveEventsFromHints(hints, [table]) : [table];
      kb.accommodation = hotelEvents.flatMap(event =>
        (event.accommodation || []).map(row => mapAccommodationRow(row, event.title || table.title))
      );
      kb.hotelsByEvent = hotelsByEventSummary(hotelEvents);
    }
    if (datasets.includes('flightRequests') || datasets.includes('travel')) {
      const hints = namedEventHints(message);
      const namedEvents = hints.length ? await resolveEventsFromHints(hints, [table]) : [table];
      const eventIds = namedEvents.map(event => event._id);
      const nameHints = [...hints, ...namedEvents.map(event => event.title)].filter(Boolean);
      kb.flightRequests = await queryFlights({
        eventIds,
        nameHints,
        limit: 50
      });
      kb.flyingInByEvent = flyingInSummary(
        kb.flightRequests,
        (kb.travel || []).map(row => ({ event: table.title, name: row.name }))
      );
    }
    kb.travelGaps = [travelGapsForEvent(
      table,
      kb.flyingInByEvent || [],
      kb.hotelsByEvent || []
    )];
  }

  if (datasets.includes('gear')) {
    kb.gear = await loadEventGear(table);
    kb.gearSummary = kb.gear.gearSummary;
  }

  if (datasets.includes('cardLog')) {
    Object.assign(kb, mapCardLogData(table, table.title));
  }

  if (datasets.includes('documents')) {
    kb.documents = (table.documents || []).map(doc => ({
      name: doc.originalName,
      fileType: doc.fileType,
      uploadedAt: doc.uploadedAt
    }));
  }

  if (datasets.includes('adminNotes')) {
    Object.assign(kb, mapAdminNotesData(table.adminNotes, canSeeAdminData));
  }

  if (datasets.includes('expenses')) {
    Object.assign(kb, mapExpenseData(table.expenses, canSeeAdminData));
  }

  if (datasets.includes('eventsOverview')) {
    const events = await loadAccessibleEvents(user, { limit: 20 });
    kb.otherEvents = events
      .filter(e => String(e._id) !== String(table._id))
      .map(mapEventOverview);
  }

  kb.eventAccess = await loadEventAccess(table);
  kb.eventOwners = kb.eventAccess.ownerNames;
  kb.eventTitle = table.title;
  kb.eventDates = {
    start: table.general?.start || null,
    end: table.general?.end || null
  };

  return kb;
}

function eventStatus(start, end, today) {
  if (!start || !end) return 'unknown';
  if (today < start) return 'upcoming';
  if (today > end) return 'completed';
  return 'ongoing';
}

function buildSystemPrompt({ user, page, playbook, mode, canSeeAdminData, knowledgeBase, uiState }) {
  const now = todayParts();
  const pageHint = playbook
    ? `Current page: ${playbook.title} (${page}). ${playbook.purpose}`
    : `Current page: ${page}`;

  const uiBits = [];
  if (uiState?.dateFilter && uiState.dateFilter !== 'all') {
    uiBits.push(`Schedule date filter is set to ${uiState.dateFilter}.`);
  }
  if (uiState?.gearList) {
    uiBits.push(`Selected gear list: ${uiState.gearList}.`);
  }
  if (uiState?.eventTitle) {
    uiBits.push(`Open event title: ${uiState.eventTitle}.`);
  }

  return `You are Luma, the AI assistant for LumDash, an event production platform for photo/video crews.

TODAY: ${now.date} (${now.dayOfWeek}) ${now.time}
USER: ${user.fullName} (${user.role})
MODE: ${mode === 'event' ? 'single event' : 'dashboard'}
ACCESS: ${canSeeAdminData ? 'Full (you can see owner-only fields)' : 'Standard — do not invent budget, contract, invoice, expense, or admin-note details'}

HOW THE APP WORKS
${getHowTheAppWorks()}

${pageHint}
Prefer this page's data. If you use another page, say so. If data is missing, say which page would have it.
${uiBits.length ? `UI STATE\n${uiBits.join('\n')}` : ''}

ANSWER RULES
1. Use only AVAILABLE DATA below. Do not invent names, times, or bookings.
2. Be specific: dates, times, names, statuses.
3. For "I / my / me" questions, match the current user's name or userId.
4. Crew availability statuses matter: tentative, requested, accepted, declined, confirmed.
5. Crew ≠ schedule. Call times are crew rows; sessions are programSchedule.
6. Format dates as readable English (e.g. February 25, 2026).
7. Always answer times in 12-hour format with AM/PM (e.g. 2:00 PM, not 14:00).
8. For start/end, first/last, how late, or "what time does the day run" questions: use scheduleByDay or crewByDay. earliestStart is the first clock time that day; latestEnd is the last clock time that day, computed from every row, not the last row you see in the list. Do not pick a session at random.
9. Who is flying in for an event = flyingInByEvent.passengers for that event, from FlightRequest passengers and travel-row names. Match the event by title (partial is OK). Pending and change_requested still count. Only say nobody if that event's passenger list is empty.
10. "Do we have hotels" = hotelsByEvent for that event. status booked = yes (list hotel names and guests). status requested = hotel is marked requested but no bookings yet. status not_required = hotel not needed. status none = no hotel rows. Use accommodation/eventAccommodation rows for names and dates.
11. Events can have multiple owners. "Who is the owner / who owns this" = every name in eventAccess.ownerNames (or eventAccess.owners). List all of them. Do not pick one, do not use the current user, and do not use account manager. "Who did I share this event with" = eventAccess.sharedWith (leads + shared users, not owners, not crew). "Who has access" = owners + leads + shared. These lists are complete.
12. Event to-dos = todos / openTodos / todoSummary, not personalTasks unless the user asks about My Tasks. Name every open task. On the Shotlist page, "what's left" means remaining shots.
13. Remaining shots = shotlistSummary.remainingTitles. Name every remaining shot. An event can have multiple shotlists.
14. Event gear = gear / gearSummary, not inventorySummary. What is not packed = gearSummary.unpacked. Name every unpacked item.
15. Who has a memory card = cardLookup (card number → person, camera, date). Read cardsByPerson for a person's cards.
16. Who is missing a hotel or flight = travelGaps for that event.
17. Admin notes: if adminNotes or notesSummary has error, say the notes are hidden. Otherwise list every note; pin titles are in notesSummary.pinnedTitles.
18. Event cost = expenseTotals.grand (crew + flights + accommodation + misc + reimbursements). If expenseTotals has error, say expenses are owner/admin only. Invoice and contract live on Executive Summary, not Expenses.

AVAILABLE DATA
${JSON.stringify(knowledgeBase, null, 2)}`;
}

async function buildLumaContext({ message, pageContext = {}, user, mode, table = null, canSeeAdminData = false }) {
  const rawPage = pageContext.currentPage || pageContext.page || pageContext.pageData?.page;
  const page = normalizePageName(rawPage);
  const playbook = getPlaybook(page);
  const intent = detectIntent(message);
  const resolvedMode = mode === 'event' && table ? 'event' : 'global';
  const datasets = getDatasetsToLoad(page, intent, resolvedMode === 'event' ? 'event' : 'global');

  const admin = canSeeAdminData || user.role === 'admin' || (table && isOwnerOf(table, user));

  const knowledgeBase = {
    today: todayParts(),
    user: {
      name: user.fullName,
      firstName: userFirstName(user),
      role: user.role
    },
    currentPage: page,
    pageTitle: playbook.title,
    intent
  };

  if (resolvedMode === 'event') {
    Object.assign(knowledgeBase, await loadEventDatasets(datasets, {
      table,
      user,
      message,
      canSeeAdminData: admin
    }));
  } else {
    Object.assign(knowledgeBase, await loadDashboardDatasets(datasets, {
      user,
      message,
      canSeeAdminData: admin
    }));
  }

  const uiState = {
    dateFilter: pageContext.dateFilter || pageContext.pageData?.dateFilter,
    gearList: pageContext.gearList || pageContext.pageData?.gearList,
    eventTitle: pageContext.eventTitle || pageContext.pageData?.eventTitle || table?.title
  };

  const systemPrompt = buildSystemPrompt({
    user,
    page,
    playbook,
    mode: resolvedMode,
    canSeeAdminData: admin,
    knowledgeBase,
    uiState
  });

  return { systemPrompt, knowledgeBase, page, datasets };
}

module.exports = { buildLumaContext };

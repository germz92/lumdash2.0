const Table = require('../models/Table');
const FlightRequest = require('../models/FlightRequest');
const PersonalTask = require('../models/PersonalTask');
const ReservedGearItem = require('../models/ReservedGearItem');
const GearPackage = require('../models/GearPackage');
const GearInventory = require('../models/GearInventory');
const CrewPlanner = require('../models/CrewPlanner');
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
    .select('title general rows adminNotes programSchedule owners leads sharedWith todos')
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

async function loadFlights(user, events, firstName) {
  const accessibleEventIds = events.map(e => e._id);
  let flightQuery;
  if (user.role === 'admin' || user.role === 'planner') {
    flightQuery = { status: { $in: ['pending', 'booked'] } };
  } else {
    flightQuery = {
      $and: [
        { status: { $in: ['pending', 'booked'] } },
        {
          $or: [
            { createdBy: user.id },
            { 'passengers.name': { $regex: firstName || 'a^', $options: 'i' } },
            { eventId: { $in: accessibleEventIds } }
          ]
        }
      ]
    };
  }
  const flights = await FlightRequest.find(flightQuery).sort({ departDate: 1 }).limit(25).lean();
  return flights.map(f => ({
    event: f.eventName,
    from: f.from?.city || f.from?.code,
    to: f.to?.city || f.to?.code,
    departDate: f.departDate,
    returnDate: f.returnDate,
    passengers: (f.passengers || []).map(p => p.name).filter(Boolean),
    airline: f.bookedDetails?.airline || 'TBD',
    confirmationCode: f.bookedDetails?.confirmationCode || null,
    status: f.status,
    tripType: f.tripType
  }));
}

async function loadEventGear(table) {
  const lists = (table.gear?.gearLists || []).map(list => ({
    name: list.displayName || list.name,
    manualItems: (list.manualItems || []).map(item => ({
      text: item.text,
      completed: !!item.completed
    }))
  }));

  let reservations = [];
  try {
    const reserved = await ReservedGearItem.find({ eventId: table._id })
      .populate('userId', 'fullName')
      .sort({ createdAt: -1 })
      .limit(40)
      .lean();
    reservations = reserved.map(item => ({
      item: `${item.brand || ''} ${item.model || ''}`.trim(),
      category: item.category,
      serial: item.serial,
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
    const pkgs = await GearPackage.find({ eventId: table._id }).limit(20).lean();
    packages = pkgs.map(pkg => ({
      name: pkg.name || null,
      quantity: pkg.quantity,
      serial: pkg.serial,
      packed: !!pkg.packed
    }));
  } catch (err) {
    console.error('[Luma] Gear packages load failed:', err.message);
  }

  return {
    checkOutDate: table.gear?.checkOutDate || null,
    checkInDate: table.gear?.checkInDate || null,
    currentList: table.gear?.currentList || null,
    lists,
    reservations,
    packages,
    packingProgress: {
      total: reservations.length,
      packed: reservations.filter(r => r.packed).length
    }
  };
}

async function loadDashboardDatasets(datasets, { user, message, canSeeAdminData }) {
  const kb = {};
  const today = todayParts().date;
  const first = userFirstName(user);
  const needEvents = datasets.some(d =>
    ['eventsOverview', 'mySchedule', 'myEventTasks', 'crewCalendar', 'flights'].includes(d)
  );
  const events = needEvents ? await loadAccessibleEvents(user) : [];

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

  if (datasets.includes('flights')) {
    kb.flights = await loadFlights(user, events, first);
    kb.myFlights = (kb.flights || []).filter(f =>
      (f.passengers || []).some(p => first && String(p).toLowerCase().includes(first.toLowerCase()))
    );
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
    const all = (table.programSchedule || []).map(mapScheduleItem);
    if (datasets.includes('schedule')) {
      kb.programSchedule = compressByDate(all, {
        message,
        today,
        getDate: item => item.date,
        keepFullIf: item => item.important || !item.done,
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
    const all = (table.rows || []).map(mapCrewRow);
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
    kb.todos = (table.todos || []).map(t => mapTodo(t));
  }

  if (datasets.includes('shotlists')) {
    kb.shotlists = (table.shotlists || []).map(list => ({
      name: list.name,
      items: (list.items || []).map(item => ({
        title: item.title,
        completed: !!item.completed,
        completedBy: item.completedByName || null
      }))
    }));
    kb.legacyShotlist = (table.shotlist || []).map(item => ({
      title: item.title,
      completed: !!item.completed,
      priority: item.priority
    }));
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
    if (datasets.includes('accommodation')) {
      kb.accommodation = table.accommodation || [];
    }
    if (datasets.includes('flightRequests') || datasets.includes('travel')) {
      const flightDocs = await FlightRequest.find({
        eventId: table._id,
        status: { $in: ['pending', 'booked'] }
      }).limit(15).lean();
      kb.flightRequests = flightDocs.map(f => ({
        from: f.from?.city || f.from?.code,
        to: f.to?.city || f.to?.code,
        departDate: f.departDate,
        returnDate: f.returnDate,
        passengers: (f.passengers || []).map(p => p.name).filter(Boolean),
        status: f.status,
        airline: f.bookedDetails?.airline || 'TBD',
        confirmationCode: f.bookedDetails?.confirmationCode || 'Pending',
        tripType: f.tripType
      }));
    }
  }

  if (datasets.includes('gear')) {
    kb.gear = await loadEventGear(table);
  }

  if (datasets.includes('cardLog')) {
    kb.cardLog = (table.cardLog || []).map(day => ({
      date: day.date,
      entries: (day.entries || []).map(e => ({
        camera: e.camera,
        card1: e.card1,
        card2: e.card2,
        user: e.user,
        notes: e.notes
      }))
    }));
  }

  if (datasets.includes('documents')) {
    kb.documents = (table.documents || []).map(doc => ({
      name: doc.originalName,
      fileType: doc.fileType,
      uploadedAt: doc.uploadedAt
    }));
  }

  if (datasets.includes('adminNotes')) {
    kb.adminNotes = canSeeAdminData
      ? (table.adminNotes || []).map(n => ({
          title: n.title,
          content: n.content,
          pinned: n.pinned,
          createdBy: n.createdByName
        }))
      : [];
  }

  if (datasets.includes('expenses')) {
    kb.expenses = canSeeAdminData ? (table.expenses || {}) : { error: 'Expenses are limited to owners and admins.' };
  }

  if (datasets.includes('eventsOverview')) {
    const events = await loadAccessibleEvents(user, { limit: 20 });
    kb.otherEvents = events
      .filter(e => String(e._id) !== String(table._id))
      .map(mapEventOverview);
  }

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
ACCESS: ${canSeeAdminData ? 'Full (owner/admin)' : 'Standard — do not invent budget, contract, invoice, expense, or admin-note details'}

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

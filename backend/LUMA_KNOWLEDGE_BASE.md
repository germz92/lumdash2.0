# Luma AI Knowledge Base

Runtime playbooks live in `backend/services/lumaPageCatalog.js`. The context builder (`lumaContextBuilder.js`) loads **the current page first**, then related datasets if the question needs them.

Out of scope for this pass: Video Portal, Post Production, Reimbursements, Timesheets, Settings, Feedback, Folder Logs, Notifications.

---

## App structure

LumDash is an event production platform for photo/video crews.

1. **Dashboard** — views across events the user can access
2. **Event** — one event (`#page?id=EVENT_ID`)

**Crew page = call sheet** (when people work).  
**Schedule page = event rundown** (what is happening). These are different lists.

Times in answers default to **12-hour format** with AM/PM (e.g. 2:00 PM).

---

## Roles and access

| Role | Access |
|------|--------|
| `user` | Assigned events, personal call times and tasks |
| `planner` | Read all events, Flight Management |
| `admin` | All events, inventory, crew planner/calendar, expenses, admin notes |
| `production_manager` | Inventory, plus events they belong to |

Event access: **owners**, **leads**, **shared**, **assigned crew** (`rows.userId`). Admins and planners can read all events.

"Who owns this event" = every `owners[]` user — events can have multiple owners; never pick one. "Who did I share this event with" = leads + `sharedWith` (the Share modal list). Crew is separate. Use `eventAccess` — those lists are complete.

---

## Workflows Luma must know

- **Crew availability:** `tentative` → `requested` → `accepted` or `declined` → `confirmed`. Admins email requests; crew reply on a public link.
- **Events** have both `client` and `company`.
- **Event to-dos** live on `#todos` as `todos[]` (`todo` / `in-progress` / `done`).
- **My Tasks** also has private `PersonalTask` items (not tied to an event).
- **Flights:** official `FlightRequest` (`pending` / `booked`) plus older event `travel` rows.
- **Gear:** lists, reservations, packages, packed status — not the same as old checkbox lists.

---

## Dashboard pages

### Events (`#events`)
**Data:** `Table` — title, `general.start` / `end`, `client`, `company`, location/city/state.

### Event Calendar (`/pages/event-calendar.html`)
Same events, answered as a calendar (week/month clusters).

### My Tasks (`#my-tasks`)
- Event tasks: `Table.todos` assigned to the user
- General tasks: `PersonalTask` (`user`, `task`, `status`, `dueDate`, `notes`)

### Call Times (`#call-times`)
User's `Table.rows` across events (call sheet, not the program).

### Flights (`/pages/flights.html`)
`FlightRequest`: from/to, dates, passengers, status, `bookedDetails.airline`, confirmation code, `eventName`.

### Inventory (`/pages/inventory-management.html`)
`GearInventory` — admin / production_manager. Label, category, serial, quantity.

### Crew Planner (`/pages/crew-planner.html`)
`CrewPlanner` boards — admin. Dates → events → crew member + role.

### Crew Calendar (`/pages/crew-calendar.html`)
Aggregated `Table.rows` across events by date — admin.

---

## Event pages

### General (`#general`)
`Table.general`: venue, city, state, start, end, **client**, **company**, attendees, summary, gallery, contacts, locations. Budget / contract / invoice only for owners and admins.

### Executive Summary (`#executive-summary`)
`Table.executiveSummary`: account/project managers, client contact, services, deliverables. Contract/invoice/paid status for owners and admins.

### Crew (`#crew`)
`Table.rows`:

```
date, role, name, startTime (call time), endTime, totalHours, notes,
userId, availabilityStatus
```

### Schedule (`#schedule`)
`Table.programSchedule`: date, name, startTime, endTime, location, photographer, notes, done, important.

### Shotlist (`#shotlist`)
`Table.shotlists` and legacy `Table.shotlist`. Remaining shots = `shotlistSummary.remainingTitles` (complete list).

### To-Dos (`#todos`)
`Table.todos` — **not** `table.tasks`:

```
task, status (todo | in-progress | done), dueDate, owner, notes
```

Open work = `openTodos` / `todoSummary`. Named-event questions on the dashboard load that event's full list, not only My Tasks.

### Travel & Accommodation (`#travel-accommodation`)
`Table.travel`, `Table.accommodation`, plus `FlightRequest` for this event. Missing hotel/flight = `travelGaps`.

### Gear (`#gear`)
`Table.gear` lists and dates, `ReservedGearItem` (packed, dates, reservedBy), `GearPackage`, optional legacy checkbox lists. Not packed = `gearSummary.unpacked` (complete). Event gear is not global inventory.

### Card Log (`#card-log`)
`Table.cardLog` — date, camera, card1/card2, user, category. `cardLookup` maps a card number to the person holding it.

### Documents (`#documents`)
`Table.documents` — filename, type, uploadedAt.

### Expenses (`#expenses`) — owner/admin
`Table.expenses`: crew, flights, accommodation, misc, reimbursements. Totals match the Expenses page in `expenseTotals.grand`. Hidden users get an error, not an empty list. Invoice/contract live on Executive Summary.

### Admin Notes (`#admin-notes`) — owner/admin
`Table.adminNotes`: title, content, pinned, createdByName. Hidden users get an error, not an empty list.

---

## How Luma loads data

1. **Always:** user, today, how-the-app-works, current-page playbook
2. **Page-first:** full (or compressed) dataset for the current page
3. **Intent overlay:** extra datasets when the question needs them (e.g. "my call time" on Schedule still loads crew)

Large lists are compressed by date: keep matches / today / important rows in full, summarize the rest as `"Feb 25: 18 sessions"`.

Before compressing, Luma always gets rollups computed from the **full** list:

- `scheduleByDay`: earliest session start and latest session end per date
- `crewByDay`: earliest call time and latest end time per date
- `todoSummary` / `openTodos`: counts and the complete open-task list
- `shotlistSummary`: remaining titles per event
- `gearSummary`: unpacked reservation names
- `cardLookup` / `cardsByPerson`: who holds which card
- `travelGaps`: travelers missing a hotel or flight
- `expenseTotals`: crew + flights + hotels + misc + reimbursements = grand
- `notesSummary`: pinned titles; full note bodies for owners/admins

Page ids sent by `js/chat.js` must match the catalog (`todos`, `travel-accommodation`, not `tasks` / `travel`).

---

## Example questions

| Question | Asked on | Data used |
|----------|----------|-----------|
| What's after lunch on day 2? | Schedule | `programSchedule` |
| Who hasn't accepted yet? | Crew | `rows.availabilityStatus` |
| What's still open? | To-Dos | `todos` |
| What's my call time? | Schedule | crew overlay |
| What day is GuidePoint? | Events | event list + company/client |
| When do I fly in? | Travel or Flights | `FlightRequest` + travel rows |

---

*Updated: August 2026*

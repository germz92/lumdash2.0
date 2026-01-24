# 🧠 Luma AI Knowledge Base

> This document defines all pages, data structures, and query capabilities for the Luma AI assistant.
> Update this document when adding new features or pages.

---

## 📱 App Structure Overview

LumDash is an **event management platform** for production teams. It has two main contexts:

1. **Dashboard Context** - Global views across all events
2. **Event Context** - Detailed views within a specific event

---

## 🏠 DASHBOARD PAGES (Global Context)

These pages show data across ALL events the user has access to.

### 1. Events Page (`#events`)
**Purpose**: Main dashboard showing all events  
**Data Source**: `Table` collection (all user-accessible tables)  
**What users ask**:
- "What events do I have coming up?"
- "What day is the GuidePoint Event?"
- "Show me all events in February"
- "Which events am I working on?"

**Key Fields**:
- `title` - Event name
- `general.start` / `general.end` - Event dates
- `general.location` - Venue
- `general.client` - Client name
- `general.city` / `general.state` - Location details

---

### 2. Event Calendar (`/pages/event-calendar.html`)
**Purpose**: Calendar visualization of all events  
**Data Source**: `Table` collection  
**What users ask**:
- "What's happening next week?"
- "Do I have any events in March?"
- "Show me the calendar"

---

### 3. My Tasks (`#my-tasks`)
**Purpose**: Aggregated view of user's tasks across ALL events  
**Data Source**: `Table.todos` where user is owner/assigned  
**What users ask**:
- "What tasks do I have?"
- "What's due this week?"
- "Show me my to-do list"

**Key Fields**:
- `task` - Task description
- `status` - todo, in-progress, done
- `dueDate` - Deadline
- `owner` - Assigned user

---

### 4. Call Times (`#call-times`)
**Purpose**: Aggregated view of user's work schedule across ALL events  
**Data Source**: `Table.rows` where user's name matches  
**What users ask**:
- "When do I work next?"
- "What are my call times this week?"
- "Am I working on February 25?"
- "What events am I scheduled for?"

**Key Fields**:
- `date` - Work date
- `role` - Job role
- `name` - Crew member name
- `startTime` / `endTime` - Shift times
- `notes` - Special instructions

---

### 5. Flights Page (`/pages/flights.html`)
**Purpose**: Flight request management  
**Data Source**: `FlightRequest` collection  
**What users ask**:
- "When do I fly in for [event]?"
- "What flights are booked?"
- "Show me pending flight requests"

**Key Fields**:
- `from` / `to` - Airport codes and names
- `departDate` / `returnDate` - Travel dates
- `passengers` - Who's flying
- `status` - pending, booked, cancelled
- `bookedDetails.airline` - Airline name
- `bookedDetails.confirmationCode` - Booking reference
- `eventId` / `eventName` - Linked event

---

### 6. Inventory Management (`/inventory-management.html`)
**Purpose**: Global gear inventory (admin only)  
**Data Source**: `GearInventory` collection  
**What users ask**:
- "How many Canon R5s do we have?"
- "What gear is available?"
- "Show me all lenses in inventory"

**Key Fields**:
- `label` - Item name
- `brand` / `model` - Equipment details
- `category` - Cameras, Lenses, Lighting, etc.
- `serial` - Serial number
- `condition` - Equipment status

---

### 7. Crew Planner (`/pages/crew-planner.html`)
**Purpose**: Multi-event crew scheduling (admin only)  
**Data Source**: `CrewPlanner` collection  
**What users ask**:
- "Who's available on [date]?"
- "Is [person] working on [date]?"
- "Show me crew assignments for next week"

**Key Fields**:
- `dates[].date` - Schedule date
- `dates[].events[].name` - Event name
- `dates[].events[].crew[].crewMember` - Assigned person
- `dates[].events[].crew[].role` - Job role

---

### 8. Users/Admin Console (`#users`)
**Purpose**: User management (admin only)  
**Data Source**: `User` collection  
**What users ask**:
- "Who are the admins?"
- "How many users do we have?"

---

## 📋 EVENT PAGES (Single Event Context)

These pages show data for ONE specific event. User must be viewing an event.

### 1. General/Home (`#general`)
**Purpose**: Event overview and key information  
**Data Source**: `Table.general`  
**What users ask**:
- "What's the location?"
- "When does this event start?"
- "Who's the client?"
- "How many attendees?"
- "What's the budget?"

**Key Fields**:
```javascript
general: {
  location: String,      // Venue name
  city: String,          // City
  state: String,         // State
  start: String,         // Start date (YYYY-MM-DD)
  end: String,           // End date (YYYY-MM-DD)
  client: String,        // Client name
  attendees: Number,     // Expected attendance
  budget: String,        // Budget amount
  summary: String,       // Event description
  galleryUrl: String,    // Photo gallery link
  contractUrl: String,   // Contract link
  invoiceUrl: String,    // Invoice link
  contacts: [{           // Key contacts
    name, number, email, role
  }],
  locations: [{          // Multiple venues
    name, address, event
  }]
}
```

---

### 2. Crew Page (`#crew`) - STAFF CALL TIMES
**Purpose**: List of all crew/staff members and their work schedules (call times)  
**Data Source**: `Table.rows`  
**This is the CALL SHEET** - when crew members need to arrive and work

**What users ask**:
- "Who's working on day 1?"
- "What time does [person] start?"
- "What's my call time?"
- "When do I need to be there?"
- "Who's working on February 25?"
- "Show me the crew schedule"

**Key Fields**:
```javascript
rows: [{
  date: String,        // Work date
  role: String,        // Job title (Photographer, Videographer, etc.)
  name: String,        // Crew member name
  startTime: String,   // CALL TIME - when they arrive (HH:MM)
  endTime: String,     // When they finish (HH:MM)
  totalHours: Number,  // Shift duration
  notes: String        // Special instructions
}]
```

---

### 3. Schedule Page (`#schedule`) - EVENT RUNDOWN
**Purpose**: The actual conference/event session rundown and program  
**Data Source**: `Table.programSchedule`  
**This is the EVENT PROGRAM** - what's happening at the conference and when

**What users ask**:
- "When is the keynote?"
- "What sessions are on day 2?"
- "What's happening at 2pm?"
- "Where is the opening session?"
- "What sessions are in Ballroom A?"
- "Who's photographing the keynote?"

**Key Fields**:
```javascript
programSchedule: [{
  date: String,         // Session date
  name: String,         // Session name (e.g., "Keynote", "Breakout A", "Networking Lunch")
  startTime: String,    // Session start time
  endTime: String,      // Session end time
  location: String,     // Room/venue where session takes place
  photographer: String, // Assigned photographer for this session
  notes: String,        // Special notes about the session
  done: Boolean         // Whether session coverage is complete
}]
```

---

### 4. Shotlist Page (`#shotlist`)
**Purpose**: Photo checklists for coverage  
**Data Source**: `Table.shotlists` and `Table.shotlist`  
**What users ask**:
- "What shots do I need to get?"
- "Do we have a headshot booth?"
- "What's on the shotlist?"
- "How many shots are completed?"

**Key Fields**:
```javascript
shotlists: [{
  name: String,         // List name (e.g., "Day 1 Shots", "Headshots")
  items: [{
    title: String,      // Shot description
    completed: Boolean, // Done status
    completedBy: User,  // Who completed it
    completedAt: Date   // When completed
  }]
}]

// Legacy single shotlist
shotlist: [{
  title: String,
  description: String,
  priority: String,     // normal, high, critical
  category: String,
  completed: Boolean
}]
```

---

### 5. To-Dos Page (`#todos`)
**Purpose**: Task management for this event  
**Data Source**: `Table.todos`  
**What users ask**:
- "What tasks are pending?"
- "What's due tomorrow?"
- "Who owns [task]?"
- "Is [task] done?"

**Key Fields**:
```javascript
todos: [{
  task: String,         // Task description
  status: String,       // 'todo', 'in-progress', 'done'
  dueDate: Date,        // Deadline
  owner: ObjectId,      // Assigned user
  notes: String         // Additional notes
}]
```

---

### 6. Travel & Accommodation Page (`#travel-accommodation`)
**Purpose**: Flight and hotel bookings for this event  
**Data Source**: `Table.travel` + `Table.accommodation` + `FlightRequest`  
**What users ask**:
- "When do I fly in?"
- "What hotel am I staying at?"
- "What's my confirmation number?"
- "Who's arriving on [date]?"

**Key Fields**:
```javascript
travel: [{
  date: String,      // Flight date
  depart: String,    // Departure time
  arrive: String,    // Arrival time
  airline: String,   // Airline name
  name: String,      // Passenger name
  fromTo: String,    // Route (e.g., "LAX → MIA")
  ref: String        // Confirmation code
}]

accommodation: [{
  checkin: String,   // Check-in date
  checkout: String,  // Check-out date
  hotel: String,     // Hotel name
  name: String,      // Guest name
  ref: String        // Confirmation code
}]
```

---

### 7. Gear Page (`#gear`)
**Purpose**: Equipment lists and packing for this event  
**Data Source**: `Table.gear` + `ReservedGearItem`  
**What users ask**:
- "What gear do we need?"
- "Is everything packed?"
- "Who reserved the Canon R5?"
- "What's the checkout date?"

**Key Fields**:
```javascript
gear: {
  checkOutDate: String,  // When gear leaves
  checkInDate: String,   // When gear returns
  gearLists: [{
    name: String,        // List name
    manualItems: [{      // Manual additions
      text: String,
      completed: Boolean
    }]
  }]
}

// ReservedGearItem collection
{
  eventId: ObjectId,
  inventoryId: ObjectId,
  brand: String,
  model: String,
  category: String,
  serial: String,
  isPacked: Boolean,
  userId: ObjectId       // Who reserved it
}
```

---

### 8. Card Log Page (`#card-log`)
**Purpose**: Memory card tracking during shoots  
**Data Source**: `Table.cardLog`  
**What users ask**:
- "What cards are in use?"
- "Who has card 32?"
- "What cameras were used today?"

**Key Fields**:
```javascript
cardLog: [{
  date: String,        // Date
  entries: [{
    camera: String,    // Camera name/number
    card1: String,     // Primary card
    card2: String,     // Secondary card
    user: String       // Photographer name
  }]
}]
```

---

### 9. Documents/Map Page (`#documents`)
**Purpose**: Event documents, floor plans, guides  
**Data Source**: `Table.documents`  
**What users ask**:
- "Where's the floor plan?"
- "Do we have the venue map?"
- "What documents are uploaded?"

**Key Fields**:
```javascript
documents: [{
  originalName: String,  // File name
  url: String,           // Cloudinary URL
  fileType: String,      // PDF, image, etc.
  uploadedAt: Date
}]
```

---

### 10. Admin Notes Page (`#admin-notes`)
**Purpose**: Internal notes for admins (Google Keep style)  
**Data Source**: `Table.adminNotes`  
**What users ask**:
- "What notes do we have?"
- "Any important reminders?"
- "What's pinned?"

**Key Fields**:
```javascript
adminNotes: [{
  title: String,
  content: String,
  pinned: Boolean,
  color: String,       // default, red, orange, yellow, green, teal, blue, purple
  createdByName: String
}]
```

---

## 🔍 CROSS-REFERENCE QUERIES

These queries require looking across multiple data sources:

| Question | Data Sources Needed | Explanation |
|----------|-------------------|-------------|
| "Who's shooting the keynote?" | `programSchedule` (find keynote) → `photographer` field | Schedule has photographer assignment |
| "What time is John's call?" | `rows` where name = John | Crew page has call times |
| "When is the keynote?" | `programSchedule` where name contains "keynote" | Schedule has session times |
| "Who's working on Feb 25?" | `rows` where date = Feb 25 | Crew page has staff schedules |
| "What gear does [person] need?" | `rows` (check role) + `ReservedGearItem` | Cross-reference crew with gear |
| "Is [person] working on [date]?" | All `Table.rows` across events | Search crew across all events |
| "What day is [event name]?" | All `Table` titles + `general.start` | Search events by name |
| "When do I fly in for this event?" | `FlightRequest` + `travel` | Flight bookings |

### Key Distinction:
- **Crew Page (rows)** = STAFF schedules - when people WORK
- **Schedule Page (programSchedule)** = EVENT sessions - what's HAPPENING at the conference

---

## 👤 USER ROLES

| Role | Permissions |
|------|-------------|
| `user` | View assigned events, personal schedule |
| `admin` | All events, inventory, users, crew planner |
| `planner` | Event creation, crew assignment |

---

## 📅 DATE FORMATS

All dates in the system use:
- **Storage**: `YYYY-MM-DD` (ISO format string)
- **Display**: Localized based on user preference
- **Times**: `HH:MM` (24-hour format)

---

## 💡 QUERY DETECTION KEYWORDS

| Category | Keywords |
|----------|----------|
| Schedule | schedule, time, when, start, end, session, keynote, presentation, agenda |
| Crew | crew, team, photographer, people, who, assignment, role, staff, call |
| Gear | gear, camera, equipment, lens, light, audio, pack, reserved, inventory |
| Tasks | task, todo, deadline, complete, done, work, assign |
| Travel | travel, flight, hotel, accommodation, transport, airline, fly |
| Cards | card, memory, storage, sd, cf, media |
| Shots | shot, photo, picture, image, checklist, headshot, booth |
| Location | location, where, address, venue, room |
| Personal | I, my, me, am I, do I, when do I, what time do I |

---

## 🎯 EXAMPLE QUERIES & ANSWERS

### "What day is the GuidePoint Event?"
1. Search all events where `title` contains "GuidePoint"
2. Return `general.start` and `general.end` dates

### "Do we have a headshot booth for TechCon?"
1. Find event where `title` contains "TechCon"
2. Search `shotlists` for items containing "headshot" or "booth"
3. Search `programSchedule` for sessions containing "headshot"
4. Search `adminNotes` for booth setup notes

### "When do I fly in for this event?"
1. Check `FlightRequest` where `eventId` matches current event
2. Filter for passengers matching current user
3. Return `departDate`, `from`, `to`, `bookedDetails`

### "Is Germaine working on Feb 25?"
1. Search all accessible `Table.rows`
2. Filter where `name` contains "Germaine" AND `date` = "2026-02-25"
3. Return events and call times

---

*Last updated: January 2026*

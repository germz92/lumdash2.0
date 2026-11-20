const GearInventory = require('../models/GearInventory');
const ReservedGearItem = require('../models/ReservedGearItem');
const ManualReservation = require('../models/ManualReservation');

// Same overdue rule as the isOverdue field on reservation lines (see ReservedGearItem)
const OVERDUE_GRACE_MS = ReservedGearItem.OVERDUE_GRACE_MS;

// Fields needed from an event to decide who may see or change its gear
const EVENT_ACCESS_FIELDS = 'title owners leads sharedWith rows.userId';

function isOverdue(checkInDate, now = new Date()) {
  if (!checkInDate) return false;
  return now.getTime() > new Date(checkInDate).getTime() + OVERDUE_GRACE_MS;
}

/** Units of a line that were scanned out and have not come back yet. */
function scanOutstandingQty(line) {
  return Math.max(0, (line.scannedOutQty || 0) - (line.returnedQty || 0));
}

/**
 * How many units of a line are considered "out":
 * a packed line is out in full; otherwise only what was scanned;
 * a line that was never packed or scanned counts in full when it is returned.
 */
function lineOutQty(line) {
  const scanned = line.scannedOutQty || 0;
  if (line.isPacked) return line.quantity;
  return scanned > 0 ? scanned : line.quantity;
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the inventory unit for a scanned (or typed) code.
 * Order: asset tag first, then an exact serial number match.
 */
async function findUnitByCode(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return { unit: null, reason: 'empty' };

  const assetTagMatch = await GearInventory.findOne({ assetTag: code.toUpperCase() });
  if (assetTagMatch) return { unit: assetTagMatch, matchedBy: 'assetTag' };

  // 'N/A' is the placeholder for "no serial" and is shared by many items
  if (code.toUpperCase() === 'N/A') return { unit: null, reason: 'not_found' };

  const exactSerial = await GearInventory.find({ serial: code }).limit(2);
  if (exactSerial.length === 1) return { unit: exactSerial[0], matchedBy: 'serial' };
  if (exactSerial.length > 1) return { unit: null, reason: 'ambiguous' };

  // Scanners and labels do not always agree on letter case
  const anyCaseSerial = await GearInventory.find({
    serial: { $regex: `^${escapeRegex(code)}$`, $options: 'i' }
  }).limit(2);
  if (anyCaseSerial.length === 1) return { unit: anyCaseSerial[0], matchedBy: 'serial' };
  if (anyCaseSerial.length > 1) return { unit: null, reason: 'ambiguous' };

  return { unit: null, reason: 'not_found' };
}

/**
 * Reservation lines that were scanned out and are not fully back.
 * Event is populated with the fields needed for access checks.
 */
async function getOutstandingLines({ inventoryIds = null, excludeEventId = null, excludeLineId = null } = {}) {
  const query = {
    scannedOutQty: { $gt: 0 },
    $expr: { $gt: ['$scannedOutQty', { $ifNull: ['$returnedQty', 0] }] }
  };
  if (inventoryIds) query.inventoryId = { $in: inventoryIds };
  if (excludeEventId) query.eventId = { $ne: excludeEventId };
  if (excludeLineId) query._id = { $ne: excludeLineId };

  const lines = await ReservedGearItem.find(query)
    .populate('eventId', EVENT_ACCESS_FIELDS)
    .sort({ checkInDate: 1 })
    .lean();

  // Ignore leftovers from deleted events
  return lines.filter(line => line.eventId);
}

/** "Jane Doe - Family photos": what a manual reservation is called on screen */
function manualTitle(reservation) {
  return [reservation.personName, reservation.notes].filter(Boolean).join(' - ') || 'Manual reservation';
}

/**
 * Manual reservations (gear checked out with no event) that were scanned out and are
 * not fully back.
 */
async function getOutstandingManualLines({ inventoryIds = null, excludeLineId = null } = {}) {
  const query = {
    scannedOutQty: { $gt: 0 },
    $expr: { $gt: ['$scannedOutQty', { $ifNull: ['$returnedQty', 0] }] }
  };
  if (inventoryIds) query.inventoryId = { $in: inventoryIds };
  if (excludeLineId) query._id = { $ne: excludeLineId };

  return ManualReservation.find(query).sort({ endDate: 1 }).lean();
}

/**
 * "What is still out" per inventory item, on events and on manual reservations.
 * @param {Function} canViewEvent - (event) => boolean; event titles are only included when true
 * @param {boolean} canViewManual - include who a manual reservation is for (inventory managers)
 * @returns {Map<string, { outQty, overdueQty, lines: [] }>} keyed by inventory id
 */
async function getOutstandingByInventory({ inventoryIds = null, excludeEventId = null, canViewEvent = () => false, canViewManual = false } = {}) {
  const [lines, manualLines] = await Promise.all([
    getOutstandingLines({ inventoryIds, excludeEventId }),
    getOutstandingManualLines({ inventoryIds })
  ]);
  const now = new Date();
  const byInventory = new Map();

  for (const line of manualLines) {
    const id = line.inventoryId.toString();
    const quantity = scanOutstandingQty(line);
    const overdue = isOverdue(line.endDate, now);

    if (!byInventory.has(id)) {
      byInventory.set(id, { outQty: 0, overdueQty: 0, lines: [] });
    }
    const entry = byInventory.get(id);
    entry.outQty += quantity;
    if (overdue) entry.overdueQty += quantity;
    entry.lines.push({
      lineId: line._id,
      kind: 'manual',
      eventId: null,
      eventTitle: canViewManual ? manualTitle(line) : null,
      personName: canViewManual ? line.personName : null,
      listName: null,
      quantity,
      checkOutDate: line.startDate,
      checkInDate: line.endDate,
      scannedOutAt: line.packedAt || null,
      overdue
    });
  }

  for (const line of lines) {
    const id = line.inventoryId.toString();
    const quantity = scanOutstandingQty(line);
    const overdue = isOverdue(line.checkInDate, now);

    if (!byInventory.has(id)) {
      byInventory.set(id, { outQty: 0, overdueQty: 0, lines: [] });
    }
    const entry = byInventory.get(id);
    entry.outQty += quantity;
    if (overdue) entry.overdueQty += quantity;
    entry.lines.push({
      lineId: line._id,
      kind: 'event',
      eventId: line.eventId._id,
      eventTitle: canViewEvent(line.eventId) ? (line.eventId.title || 'Untitled event') : null,
      listName: line.listName,
      quantity,
      checkOutDate: line.checkOutDate,
      checkInDate: line.checkInDate,
      scannedOutAt: line.packedAt || null,
      overdue
    });
  }

  // Soonest due first, whichever kind it is
  for (const entry of byInventory.values()) {
    entry.lines.sort((a, b) => new Date(a.checkInDate) - new Date(b.checkInDate));
  }

  return byInventory;
}

/**
 * Short overdue summary for one inventory item, or null when nothing is overdue.
 * Used for the non-blocking "not returned yet" warnings.
 */
function overdueSummary(outstandingEntry) {
  if (!outstandingEntry || outstandingEntry.overdueQty <= 0) return null;
  const overdueLines = outstandingEntry.lines.filter(line => line.overdue);
  const first = overdueLines[0];
  return {
    quantity: outstandingEntry.overdueQty,
    eventTitle: first.eventTitle,
    dueDate: first.checkInDate,
    events: overdueLines.length
  };
}

/**
 * Why a unit is not available for a date range: the first overlapping reservation.
 * @returns {{ type: 'same_event'|'event'|'manual', listName?, eventTitle?, personName? } | null}
 */
async function findReservationConflict(inventoryId, checkOutDate, checkInDate, { eventId = null, canViewEvent = () => false } = {}) {
  const {
    utcDay, utcDayAfter, holdOverlaps, heldQty, holdStart, checkOutOf,
    reservedQtyForRequest, stillHoldingMongo
  } = require('./reservationHold');
  const start = utcDay(checkOutDate);
  const end = utcDay(checkInDate);

  // Listed overlaps, plus units still physically held that packed early
  const packedByEnd = utcDayAfter(end);
  const stillHolding = stillHoldingMongo();
  const candidates = await ReservedGearItem.find({
    inventoryId,
    $or: [
      { checkOutDate: { $lte: end }, checkInDate: { $gte: start } },
      { packedAt: { $ne: null, $lt: packedByEnd }, ...stillHolding }
    ]
  }).populate('eventId', EVENT_ACCESS_FIELDS).sort({ checkOutDate: 1 }).lean();

  // Ignore lines that no longer reserve any qty (e.g. fully checked in early)
  const overlapping = candidates.filter(line =>
    holdOverlaps(line, start, end) && reservedQtyForRequest(line, start, end) > 0
  );

  const sameEvent = eventId
    ? overlapping.find(line => line.eventId && line.eventId._id.toString() === eventId.toString())
    : null;
  if (sameEvent) {
    return { type: 'same_event', listName: sameEvent.listName };
  }

  const otherEvent = overlapping.find(line => line.eventId);
  if (otherEvent) {
    const listedStart = checkOutOf(otherEvent);
    const packedEarly = heldQty(otherEvent) > 0 && listedStart && listedStart > start;
    return {
      type: 'event',
      eventTitle: canViewEvent(otherEvent.eventId) ? (otherEvent.eventId.title || 'Untitled event') : null,
      checkOutDate: otherEvent.checkOutDate,
      checkInDate: otherEvent.checkInDate,
      heldSince: packedEarly ? holdStart(otherEvent) : null,
      packedEarly
    };
  }

  const manuals = await ManualReservation.find({
    inventoryId,
    $or: [
      { startDate: { $lte: end }, endDate: { $gte: start } },
      { packedAt: { $ne: null, $lt: packedByEnd }, ...stillHolding }
    ]
  }).sort({ startDate: 1 }).lean();
  const manual = manuals.find(line =>
    holdOverlaps(line, start, end) && reservedQtyForRequest(line, start, end) > 0
  );
  if (manual) {
    const listedStart = checkOutOf(manual);
    const packedEarly = heldQty(manual) > 0 && listedStart && listedStart > start;
    return {
      type: 'manual',
      personName: manual.personName,
      checkOutDate: manual.startDate,
      checkInDate: manual.endDate,
      heldSince: packedEarly ? holdStart(manual) : null,
      packedEarly
    };
  }

  return null;
}

module.exports = {
  OVERDUE_GRACE_MS,
  EVENT_ACCESS_FIELDS,
  isOverdue,
  scanOutstandingQty,
  lineOutQty,
  findUnitByCode,
  manualTitle,
  getOutstandingLines,
  getOutstandingManualLines,
  getOutstandingByInventory,
  overdueSummary,
  findReservationConflict
};

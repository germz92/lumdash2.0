const express = require('express');
const mongoose = require('mongoose');
const GearInventory = require('../models/GearInventory');
const ReservedGearItem = require('../models/ReservedGearItem');
const ManualReservation = require('../models/ManualReservation');
const GearScanLog = require('../models/GearScanLog');
const Table = require('../models/Table');
const AtomicReservationService = require('../services/AtomicReservationService');
const {
  EVENT_ACCESS_FIELDS,
  isOverdue,
  scanOutstandingQty,
  lineOutQty,
  findUnitByCode,
  manualTitle,
  getOutstandingLines,
  getOutstandingManualLines,
  getOutstandingByInventory,
  findReservationConflict
} = require('../services/gearScanStatus');

/**
 * Barcode / QR scanning for gear check-out and check-in.
 *
 * Scan outcomes (found, not on list, already scanned, ...) are always answered with
 * HTTP 200 and a { result, level, title, detail } body so the scanner UI can beep and
 * show a banner the same way for every outcome. 4xx is only used for bad requests
 * and missing permissions.
 *
 * Gear can be scanned out for an event (ReservedGearItem lines on a gear list) or with
 * no event at all, on a manual reservation for a person (ManualReservation records).
 * Both carry the same scan fields, so check-in, undo and clear work on either.
 *
 * The permission helpers live in server.js and are passed in.
 */
module.exports = function createGearScanRouter({
  hasEventAccess,
  hasEventReadAccess,
  canManageEventGearLists,
  canManageGearInventory
}) {
  const router = express.Router();

  const EVENT_SCAN_FIELDS = `${EVENT_ACCESS_FIELDS} gear.checkOutDate gear.checkInDate gear.currentList gear.gearLists.name`;
  const MAX_CODE_LENGTH = 100;
  const MAX_SCAN_QUANTITY = 9999;
  const MAX_CLEAR_LINES = 500;
  // A return scan with no scanned-out record only matches reservations that are
  // current or ended recently, so it can never close out a long-finished event.
  const RECENT_RETURN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const isId = (value) => typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);

  function cleanCode(value) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, MAX_CODE_LENGTH);
  }

  function cleanQuantity(value, fallback = 1) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, MAX_SCAN_QUANTITY);
  }

  const loadEvent = (eventId) => Table.findById(eventId).select(EVENT_SCAN_FIELDS);

  function resolveListName(event, requested) {
    const listNames = (event.gear?.gearLists || []).map(list => list.name);
    if (!requested) return event.gear?.currentList || 'Main List';
    if (requested === 'Main List' || listNames.includes(requested)) return requested;
    return null;
  }

  const canViewEventFor = (user) => (event) =>
    canManageGearInventory(user) || hasEventReadAccess(event, user);

  const populateLine = (query) => query
    .populate('inventoryId', 'label category serial quantity lensClass assetTag')
    .populate('packedBy', 'fullName')
    .populate('returnedBy', 'fullName');

  // 'event' lines are ReservedGearItem records, 'manual' lines are ManualReservation records
  const modelFor = (kind) => (kind === 'manual' ? ManualReservation : ReservedGearItem);

  const loadLinesForResponse = (ids, kind = 'event') =>
    populateLine(modelFor(kind).find({ _id: { $in: ids } }));

  function unitSummary(unit) {
    return {
      _id: unit._id,
      label: unit.label,
      category: unit.category,
      serial: unit.serial,
      assetTag: unit.assetTag || null,
      quantity: unit.quantity
    };
  }

  /** "Canon R5 · SN 12345" style text for banners */
  function unitText(unit) {
    const hasSerial = unit.serial && unit.serial !== 'N/A';
    const id = hasSerial ? `SN ${unit.serial}` : (unit.assetTag || '');
    return id ? `${unit.label} · ${id}` : unit.label;
  }

  /** Line fields a scan can change - saved in the log so the scan can be undone */
  function snapshotLine(line) {
    return {
      isPacked: !!line.isPacked,
      packedAt: line.packedAt || null,
      packedMethod: line.packedMethod || null,
      packedBy: line.packedBy || null,
      scannedOutQty: line.scannedOutQty || 0,
      returnedQty: line.returnedQty || 0,
      returnedAt: line.returnedAt || null,
      returnedBy: line.returnedBy || null,
      returnMethod: line.returnMethod || null
    };
  }

  // Matches a stored quantity, treating a missing field (older records) as 0
  const quantityGuard = (value) => (value ? value : { $in: [0, null] });

  /**
   * Update a line only if nobody else changed its scan counts since we read it.
   * Returns the updated line, or null if another scan got there first.
   */
  function updateLineIfUnchanged(line, changes, kind = 'event') {
    return modelFor(kind).findOneAndUpdate(
      {
        _id: line._id,
        scannedOutQty: quantityGuard(line.scannedOutQty),
        returnedQty: quantityGuard(line.returnedQty)
      },
      { $set: changes },
      { new: true }
    );
  }

  /** Write the audit row (when given) and send the scan outcome */
  async function finish(res, logFields, payload) {
    let logId = null;
    if (logFields) {
      try {
        const log = await GearScanLog.create({
          ...logFields,
          result: payload.result,
          effect: payload.effect || null,
          message: [payload.title, payload.detail].filter(Boolean).join(' - ')
        });
        logId = log._id;
      } catch (logError) {
        // Never fail a scan because the audit row could not be written
        console.error('[GEAR SCAN] Failed to write scan log:', logError.message);
      }
    }

    const ok = payload.result === 'ok';
    return res.json({
      ok,
      level: ok ? (payload.warnings?.length ? 'warn' : 'ok') : 'error',
      warnings: [],
      lines: [],
      ...payload,
      logId,
      canUndo: ok && !!logId && payload.canUndo !== false
    });
  }

  const busy = (res) => res.json({
    ok: false,
    result: 'busy',
    level: 'warn',
    title: 'Scan again',
    detail: 'That item was just updated by another scan.',
    warnings: [],
    lines: []
  });

  function formatDay(date) {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function conflictOutcome(conflict, unit) {
    if (conflict?.type === 'same_event') {
      return {
        result: 'on_other_list',
        title: 'On another list',
        detail: `${unitText(unit)} is on the "${conflict.listName}" list for this event.`
      };
    }
    if (conflict?.type === 'event') {
      const where = conflict.eventTitle ? `"${conflict.eventTitle}"` : 'another event';
      return {
        result: 'unavailable',
        title: conflict.packedEarly ? 'Already packed for another event' : 'Reserved for another event',
        detail: conflict.packedEarly
          ? `${unitText(unit)} was packed early for ${where} (held since ${formatDay(conflict.heldSince)}, due back ${formatDay(conflict.checkInDate)}). Use a different unit.`
          : `${unitText(unit)} is reserved for ${where} (${formatDay(conflict.checkOutDate)} - ${formatDay(conflict.checkInDate)}). Use a different unit.`
      };
    }
    if (conflict?.type === 'manual') {
      return {
        result: 'unavailable',
        title: conflict.packedEarly ? 'Already packed' : 'Reserved',
        detail: conflict.packedEarly
          ? `${unitText(unit)} was packed early for ${conflict.personName} (held since ${formatDay(conflict.heldSince)}, due back ${formatDay(conflict.checkInDate)}). Use a different unit.`
          : `${unitText(unit)} is reserved for ${conflict.personName} (${formatDay(conflict.checkOutDate)} - ${formatDay(conflict.checkInDate)}). Use a different unit.`
      };
    }
    return {
      result: 'unavailable',
      title: 'Not available',
      detail: `${unitText(unit)} is not available for this event's dates.`
    };
  }

  /**
   * A single physical unit can only be out in one place. When it is scanned out here
   * while another reservation (event gear list or manual reservation) still shows it
   * as scanned out:
   *   - an EARLIER reservation: the unit has obviously come back -> check it in there
   *   - a LATER reservation (packed ahead of time): it was pulled from that pack
   *     -> clear the scan there so that list shows it as not packed again
   * (Not done for bulk items - one shared label cannot tell units apart.)
   */
  async function closeOutEarlierScans(unit, currentLine, user) {
    if (unit.quantity !== 1) return { closed: [], warnings: [] };

    const [eventLines, manualLines] = await Promise.all([
      getOutstandingLines({ inventoryIds: [unit._id], excludeLineId: currentLine._id }),
      getOutstandingManualLines({ inventoryIds: [unit._id], excludeLineId: currentLine._id })
    ]);
    const canView = canViewEventFor(user);
    const others = [
      ...eventLines.map(line => ({
        line,
        kind: 'event',
        checkOutDate: line.checkOutDate,
        where: canView(line.eventId) ? `"${line.eventId.title || 'Untitled event'}"` : 'another event'
      })),
      ...manualLines.map(line => ({
        line,
        kind: 'manual',
        checkOutDate: line.startDate,
        where: canManageGearInventory(user) ? `"${manualTitle(line)}"` : 'a manual reservation'
      }))
    ];
    const closed = [];
    const warnings = [];

    for (const { line, kind, checkOutDate, where } of others) {
      const previous = snapshotLine(line);
      const isLaterReservation = new Date(checkOutDate) > new Date(currentLine.checkInDate);

      const updated = await updateLineIfUnchanged(line, isLaterReservation
        ? { scannedOutQty: 0, isPacked: false, packedAt: null, packedMethod: null, packedBy: null }
        : { returnedQty: lineOutQty(line), returnedAt: new Date(), returnedBy: user.id, returnMethod: 'auto' }, kind);
      if (!updated) continue;

      closed.push({ lineId: line._id, kind, previous });
      warnings.push(isLaterReservation
        ? `Was already packed for ${where} - it is no longer marked as packed there.`
        : `Was still marked out on ${where} - that has been checked in.`);
    }

    return { closed, warnings };
  }

  /**
   * Before adding a unit to an earlier event, clear scan state on a later reservation that
   * was packed ahead of time. That frees availability for the reserve step; the scan still
   * warns that it was pulled from the later pack.
   */
  async function releaseLaterEarlyPacks(unit, currentCheckIn, user) {
    if (unit.quantity !== 1 || !currentCheckIn) return { warnings: [] };

    const [eventLines, manualLines] = await Promise.all([
      getOutstandingLines({ inventoryIds: [unit._id] }),
      getOutstandingManualLines({ inventoryIds: [unit._id] })
    ]);
    const canView = canViewEventFor(user);
    const warnings = [];

    for (const { line, kind, checkOutDate, where } of [
      ...eventLines.map(line => ({
        line,
        kind: 'event',
        checkOutDate: line.checkOutDate,
        where: canView(line.eventId) ? `"${line.eventId.title || 'Untitled event'}"` : 'another event'
      })),
      ...manualLines.map(line => ({
        line,
        kind: 'manual',
        checkOutDate: line.startDate,
        where: canManageGearInventory(user) ? `"${manualTitle(line)}"` : 'a manual reservation'
      }))
    ]) {
      if (!(new Date(checkOutDate) > new Date(currentCheckIn))) continue;
      const updated = await updateLineIfUnchanged(line, {
        scannedOutQty: 0, isPacked: false, packedAt: null, packedMethod: null, packedBy: null
      }, kind);
      if (!updated) continue;
      warnings.push(`Was already packed for ${where} - it is no longer marked as packed there.`);
    }

    return { warnings };
  }

  /**
   * Returns the function that marks a line scanned out for `take` units and answers the
   * request. Shared by event gear lists (kind 'event') and manual reservations ('manual').
   * `extra` is added to the answer, e.g. which manual reservation the scan belongs to.
   */
  function createScanOutMarker({ res, unit, user, now, quantity, logBase, kind = 'event', extra = {} }) {
    return async (line, take, { effect, title, detail, previousExtra = {}, extraWarnings = [] }) => {
      const previous = snapshotLine(line);
      const scanned = Math.min(line.quantity, (line.scannedOutQty || 0) + take);
      const complete = scanned >= line.quantity;
      const changes = { scannedOutQty: scanned };
      // Record the first scan day even on a partial pack - availability holds from then
      if (!(line.scannedOutQty > 0) && !line.packedAt) {
        Object.assign(changes, { packedAt: now, packedBy: user.id, packedMethod: line.packedMethod || 'scan' });
      }
      if (complete) {
        Object.assign(changes, { isPacked: true, packedMethod: 'scan', packedAt: line.packedAt || now, packedBy: user.id });
      }

      const updated = await updateLineIfUnchanged(line, changes, kind);
      if (!updated) return busy(res);

      const { closed, warnings } = await closeOutEarlierScans(unit, updated, user);
      const allWarnings = [...extraWarnings, ...warnings];
      if (quantity > take && effect !== 'added') {
        allWarnings.push(`Only ${take} more ${take === 1 ? 'was' : 'were'} needed on this ${kind === 'manual' ? 'reservation' : 'list'} - the other ${quantity - take} ${quantity - take === 1 ? 'was' : 'were'} not counted.`);
      }

      // Allowed, but make it obvious when packing before the listed check-out day
      const checkOut = cleanDay(updated.checkOutDate != null ? updated.checkOutDate : updated.startDate);
      const today = cleanDay(now);
      if (checkOut && today && today < checkOut) {
        allWarnings.push(`Packed early - check-out is ${formatDay(checkOut)}. This unit is held from today so nobody else can reserve it.`);
      }

      const progress = updated.quantity > 1 ? ` (${scanned} of ${updated.quantity})` : '';
      const kitSuffix = updated.kitName ? ` - ${updated.kitName}` : '';
      return finish(res, {
        ...logBase,
        reservedItemId: updated._id,
        quantity: take,
        previous: { line: previous, closed, ...previousExtra }
      }, {
        result: 'ok',
        effect,
        title: `${title}${progress}${kitSuffix}`,
        detail: detail || unitText(unit),
        unit: unitSummary(unit),
        kitName: updated.kitName || null,
        kitInstanceId: updated.kitInstanceId || null,
        warnings: allWarnings,
        lines: await loadLinesForResponse([updated._id], kind),
        ...extra
      });
    };
  }

  /** A line that was checked in earlier is scanned out again */
  async function reopenLine({ res, unit, user, now, quantity, logBase, kind = 'event', extra = {} }, returnedLine) {
    const previous = snapshotLine(returnedLine);
    const take = Math.min(quantity, returnedLine.returnedQty);
    const scanned = Math.min(returnedLine.quantity, Math.max(returnedLine.scannedOutQty || 0, take));
    const changes = {
      returnedQty: returnedLine.returnedQty - take,
      returnedAt: null,
      returnedBy: null,
      returnMethod: null,
      scannedOutQty: scanned
    };
    if (scanned >= returnedLine.quantity) {
      Object.assign(changes, { isPacked: true, packedMethod: 'scan', packedAt: now, packedBy: user.id });
    }
    const updated = await updateLineIfUnchanged(returnedLine, changes, kind);
    if (!updated) return busy(res);

    return finish(res, {
      ...logBase, reservedItemId: updated._id, quantity: take, previous: { line: previous, closed: [] }
    }, {
      result: 'ok',
      effect: 'reopened',
      title: 'Checked out again',
      detail: `${unitText(unit)} was checked in earlier and is going back out.`,
      unit: unitSummary(unit),
      lines: await loadLinesForResponse([updated._id], kind),
      ...extra
    });
  }

  // ---------------------------------------------------------------------------
  // Manual reservations: gear checked out to a person with no event behind it.
  // One ManualReservation record per item; a "reservation" on screen is every record
  // with the same person and dates (the same grouping the inventory page uses).
  // Only inventory managers can see or change them.
  // ---------------------------------------------------------------------------

  // What the inventory page stores when no email address is given
  const PLACEHOLDER_EMAIL = 'noemail@placeholder.com';

  function cleanDay(value) {
    if (typeof value !== 'string' && !(value instanceof Date)) return null;
    const date = new Date(value);
    if (isNaN(date.getTime())) return null;
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }

  /** { personName, startDate, endDate } from a request, or null when it is not usable */
  function readManualKey(input) {
    if (!input || typeof input !== 'object') return null;
    const personName = typeof input.personName === 'string' ? input.personName.trim().slice(0, 120) : '';
    const startDate = cleanDay(input.startDate);
    const endDate = cleanDay(input.endDate);
    if (!personName || !startDate || !endDate || endDate < startDate) return null;
    return { personName, startDate, endDate };
  }

  const manualGroupFilter = (key) => ({ personName: key.personName, startDate: key.startDate, endDate: key.endDate });

  const manualKey = (reservation) => ({
    personName: reservation.personName,
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    reason: reservation.notes || ''
  });

  /**
   * Point a manual reservation at another unit of the same model.
   * Returns false (and changes nothing) when that unit is not free for its dates.
   */
  async function swapManualUnit(line, newUnit) {
    const available = await AtomicReservationService.getAvailableQuantity(newUnit._id, line.startDate, line.endDate);
    if (available < line.quantity) return false;

    const labelParts = newUnit.label.split(' ');
    await ManualReservation.updateOne({ _id: line._id }, {
      $set: {
        inventoryId: newUnit._id,
        brand: labelParts[0] || 'Unknown',
        model: labelParts.slice(1).join(' ') || 'Unknown',
        category: newUnit.category,
        serial: newUnit.serial
      }
    });
    return true;
  }

  /** The line with this id, whichever kind it is: { line, kind } or null */
  async function findLineOfAnyKind(id) {
    const eventLine = await ReservedGearItem.findById(id);
    if (eventLine) return { line: eventLine, kind: 'event' };
    const manualLine = await ManualReservation.findById(id);
    return manualLine ? { line: manualLine, kind: 'manual' } : null;
  }

  // ---------------------------------------------------------------------------
  // GET /api/gear-scan/resolve?code=  - look a code up without changing anything
  // ---------------------------------------------------------------------------
  router.get('/resolve', async (req, res) => {
    try {
      const code = cleanCode(req.query.code);
      if (!code) return res.status(400).json({ error: 'A code is required' });

      const found = await findUnitByCode(code);
      if (!found.unit) {
        return res.json({
          found: false,
          reason: found.reason,
          message: found.reason === 'ambiguous'
            ? `More than one item has the serial "${code}". Scan its asset tag instead.`
            : `No item found for "${code}"`
        });
      }

      const unit = await GearInventory.findById(found.unit._id)
        .select('label category serial assetTag quantity lensClass notes')
        .populate('notes.createdBy', 'fullName')
        .lean();

      const canViewEvent = canViewEventFor(req.user);
      const isInventoryManager = canManageGearInventory(req.user);
      const outstanding = await getOutstandingByInventory({ inventoryIds: [unit._id], canViewEvent, canViewManual: isInventoryManager });
      const out = outstanding.get(unit._id.toString()) || { outQty: 0, overdueQty: 0, lines: [] };

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const reservations = await ReservedGearItem.find({
        inventoryId: unit._id,
        checkInDate: { $gte: today }
      }).populate('eventId', EVENT_ACCESS_FIELDS).sort({ checkOutDate: 1 }).limit(10).lean();

      const manualReservations = await ManualReservation.find({
        inventoryId: unit._id,
        endDate: { $gte: today }
      }).sort({ startDate: 1 }).limit(10).lean();

      const notes = (unit.notes || [])
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5)
        .map(note => ({
          text: note.text,
          serial: note.serial,
          createdAt: note.createdAt,
          createdBy: note.createdBy?.fullName || null
        }));

      res.json({
        found: true,
        matchedBy: found.matchedBy,
        unit: { ...unitSummary(unit), lensClass: unit.lensClass || null, notes },
        status: {
          state: out.overdueQty > 0 ? 'overdue' : (out.outQty > 0 ? 'out' : 'in'),
          outQty: out.outQty,
          overdueQty: out.overdueQty,
          lines: out.lines
        },
        reservations: [
          ...reservations.filter(line => line.eventId).map(line => ({
            lineId: line._id,
            kind: 'event',
            eventId: line.eventId._id,
            eventTitle: canViewEvent(line.eventId) ? (line.eventId.title || 'Untitled event') : null,
            listName: line.listName,
            quantity: line.quantity,
            checkOutDate: line.checkOutDate,
            checkInDate: line.checkInDate
          })),
          ...manualReservations.map(line => ({
            lineId: line._id,
            kind: 'manual',
            eventId: null,
            eventTitle: isInventoryManager ? manualTitle(line) : null,
            listName: null,
            quantity: line.quantity,
            checkOutDate: line.startDate,
            checkInDate: line.endDate
          }))
        ].sort((a, b) => new Date(a.checkOutDate) - new Date(b.checkOutDate)).slice(0, 10)
      });
    } catch (error) {
      console.error('[GEAR SCAN] resolve failed:', error);
      res.status(500).json({ error: 'Failed to look up that code' });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/gear-scan/outstanding  - everything scanned out and not back yet
  // ---------------------------------------------------------------------------
  router.get('/outstanding', async (req, res) => {
    try {
      const outstanding = await getOutstandingByInventory({
        canViewEvent: canViewEventFor(req.user),
        canViewManual: canManageGearInventory(req.user)
      });
      const units = await GearInventory.find({ _id: { $in: [...outstanding.keys()] } })
        .select('label category serial assetTag quantity')
        .lean();

      const items = units
        .map(unit => ({ ...unitSummary(unit), ...outstanding.get(unit._id.toString()) }))
        .sort((a, b) => (b.overdueQty - a.overdueQty) || a.label.localeCompare(b.label));

      res.json({ items });
    } catch (error) {
      console.error('[GEAR SCAN] outstanding failed:', error);
      res.status(500).json({ error: 'Failed to load checked-out gear' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/gear-scan/events/:eventId/scan-out
  // body: { code, listName?, quantity?, addUnlisted? }
  //
  // In order:
  //   1. the unit is on the list            -> mark that line scanned
  //   2. another unit of the same model is  -> swap the line to the unit in hand
  //      on the list (not serial-locked)
  //   3. "add unlisted" is on               -> reserve it on this list, marked scanned
  //   4. otherwise                          -> not_on_list
  // ---------------------------------------------------------------------------
  router.post('/events/:eventId/scan-out', async (req, res) => {
    try {
      const { eventId } = req.params;
      if (!isId(eventId)) return res.status(400).json({ error: 'Invalid event ID' });

      const code = cleanCode(req.body?.code);
      if (!code) return res.status(400).json({ error: 'A scanned code is required' });

      const quantity = cleanQuantity(req.body?.quantity);
      const addUnlisted = req.body?.addUnlisted === true;

      const event = await loadEvent(eventId);
      if (!event) return res.status(404).json({ error: 'Event not found' });
      if (!hasEventAccess(event, req.user)) {
        return res.status(403).json({ error: 'Not authorized to access this event' });
      }

      const listName = resolveListName(event, req.body?.listName);
      if (!listName) return res.status(400).json({ error: 'Gear list not found' });

      const user = req.user;
      const now = new Date();
      const logBase = { code, eventId, listName, userId: user.id, action: 'scan_out', method: 'scan', quantity };

      const found = await findUnitByCode(code);
      if (!found.unit) {
        return finish(res, logBase, found.reason === 'ambiguous'
          ? { result: 'ambiguous', title: 'More than one match', detail: `Several items have the serial "${code}". Scan the asset tag instead.` }
          : { result: 'not_found', title: 'Unknown code', detail: `No item found for "${code}".` });
      }

      const unit = found.unit;
      logBase.inventoryId = unit._id;
      const unitInfo = unitSummary(unit);

      const scanContext = { res, unit, user, now, quantity, logBase, kind: 'event' };
      const markScannedOut = createScanOutMarker(scanContext);

      // ---- 1. This exact unit is on the list -------------------------------
      const unitLines = await ReservedGearItem.find({ eventId, listName, inventoryId: unit._id }).sort({ createdAt: 1 });

      const openLine = unitLines.find(line => !(line.returnedQty > 0) && (line.scannedOutQty || 0) < line.quantity);
      if (openLine) {
        const take = Math.min(quantity, openLine.quantity - (openLine.scannedOutQty || 0));
        return markScannedOut(openLine, take, { effect: 'marked', title: 'Scanned out' });
      }

      // Came back earlier and is going out again
      const returnedLine = unitLines.find(line => line.returnedQty > 0);
      if (returnedLine) return reopenLine(scanContext, returnedLine);

      // On the list and fully scanned. A bulk item can still take extra units via "add unlisted".
      const addMoreOfBulkItem = unitLines.length > 0 && addUnlisted && unit.quantity > 1;
      if (unitLines.length > 0 && !addMoreOfBulkItem) {
        const line = await populateLine(ReservedGearItem.findById(unitLines[0]._id));
        const by = line.packedBy?.fullName ? ` by ${line.packedBy.fullName}` : '';
        return finish(res, { ...logBase, reservedItemId: line._id }, {
          result: 'already_scanned',
          level: 'warn',
          title: 'Already scanned',
          detail: `${unitText(unit)} was already scanned out${by}.`,
          unit: unitInfo,
          lines: [line]
        });
      }

      if (!addMoreOfBulkItem) {
        // The unit may be on a different list of this same event
        const otherList = await ReservedGearItem.findOne({ eventId, inventoryId: unit._id, listName: { $ne: listName } });
        if (otherList) {
          return finish(res, logBase, {
            ...conflictOutcome({ type: 'same_event', listName: otherList.listName }, unit),
            unit: unitInfo
          });
        }
      }

      // ---- 2. Same model, different unit -> swap the line to the unit in hand ----
      let sameModelLines = [];
      if (!addMoreOfBulkItem) {
        const siblings = await GearInventory.find({
          label: unit.label,
          category: unit.category,
          _id: { $ne: unit._id }
        }).select('_id').lean();

        if (siblings.length > 0) {
          sameModelLines = await ReservedGearItem.find({
            eventId,
            listName,
            inventoryId: { $in: siblings.map(sibling => sibling._id) }
          }).sort({ isPacked: 1, createdAt: 1 });
        }
      }

      const swapLine = quantity === 1
        ? sameModelLines.find(line =>
            line.quantity === 1 &&
            !line.specificSerialRequested &&
            !(line.scannedOutQty > 0) &&
            !(line.returnedQty > 0))
        : null;

      if (swapLine) {
        const canView = canViewEventFor(user);
        const pulled = await releaseLaterEarlyPacks(unit, swapLine.checkInDate, user);
        const available = await AtomicReservationService.getAvailableQuantity(
          unit._id, swapLine.checkOutDate, swapLine.checkInDate
        );
        if (available < 1) {
          const conflict = await findReservationConflict(
            unit._id, swapLine.checkOutDate, swapLine.checkInDate, { eventId, canViewEvent: canView }
          );
          return finish(res, logBase, { ...conflictOutcome(conflict, unit), unit: unitInfo });
        }

        const previousInventoryId = swapLine.inventoryId;
        const previousSerial = swapLine.serial;
        try {
          await AtomicReservationService.swapReservationUnit(swapLine._id, unit._id);
        } catch (swapError) {
          if (swapError.code !== 'UNAVAILABLE') throw swapError;
          const conflict = await findReservationConflict(
            unit._id, swapLine.checkOutDate, swapLine.checkInDate, { eventId, canViewEvent: canView }
          );
          return finish(res, logBase, { ...conflictOutcome(conflict, unit), unit: unitInfo });
        }

        const swapped = await ReservedGearItem.findById(swapLine._id);
        const replaced = previousSerial && previousSerial !== 'N/A' ? `SN ${previousSerial}` : 'the unit on the list';
        return markScannedOut(swapped, 1, {
          effect: 'swapped',
          title: 'Scanned out',
          detail: `${unitText(unit)} - used in place of ${replaced}.`,
          previousExtra: { inventoryId: previousInventoryId },
          extraWarnings: pulled.warnings
        });
      }

      // ---- 3. Not on the list -> add it (when allowed) ----------------------
      if (addUnlisted) {
        if (!canManageEventGearLists(event, user)) {
          return finish(res, logBase, {
            result: 'forbidden',
            title: 'Not on this list',
            detail: `You do not have permission to add items to this list.`,
            unit: unitInfo
          });
        }

        const checkOutDate = event.gear?.checkOutDate;
        const checkInDate = event.gear?.checkInDate;
        if (!checkOutDate || !checkInDate) {
          return finish(res, logBase, {
            result: 'no_dates',
            title: 'Set gear dates first',
            detail: 'This event needs check-out and check-in dates before items can be added.',
            unit: unitInfo
          });
        }

        const canView = canViewEventFor(user);
        // Pulling for this event: undo an ahead-of-time pack on a later reservation first
        const pulled = await releaseLaterEarlyPacks(unit, checkInDate, user);

        const available = await AtomicReservationService.getAvailableQuantity(unit._id, checkOutDate, checkInDate);
        if (available < quantity) {
          if (available > 0) {
            return finish(res, logBase, {
              result: 'unavailable',
              title: 'Not enough available',
              detail: `Only ${available} of ${unit.label} ${available === 1 ? 'is' : 'are'} available for these dates.`,
              unit: unitInfo
            });
          }
          const conflict = await findReservationConflict(unit._id, checkOutDate, checkInDate, { eventId, canViewEvent: canView });
          return finish(res, logBase, { ...conflictOutcome(conflict, unit), unit: unitInfo });
        }

        let addedLine;
        try {
          addedLine = await AtomicReservationService.createReservation({
            inventoryId: unit._id,
            eventId,
            userId: user.id,
            quantity,
            checkOutDate,
            checkInDate,
            listName,
            serial: unit.serial,
            specificSerialRequested: false
          });
        } catch (reserveError) {
          if (/Insufficient availability/i.test(reserveError.message)) {
            const conflict = await findReservationConflict(unit._id, checkOutDate, checkInDate, { eventId, canViewEvent: canView });
            return finish(res, logBase, { ...conflictOutcome(conflict, unit), unit: unitInfo });
          }
          if (reserveError.name === 'ValidationError') {
            return finish(res, logBase, {
              result: 'no_dates',
              title: 'Check the gear dates',
              detail: 'This event\'s check-out and check-in dates are not valid.',
              unit: unitInfo
            });
          }
          throw reserveError;
        }

        const fresh = await ReservedGearItem.findById(addedLine._id);
        return markScannedOut(fresh, quantity, {
          effect: 'added',
          title: 'Added and scanned out',
          detail: quantity > 1 ? `${unitText(unit)} x ${quantity}` : unitText(unit),
          extraWarnings: pulled.warnings
        });
      }

      // ---- 4. Not on the list ------------------------------------------------
      const lockedLine = sameModelLines.find(line => line.specificSerialRequested && !(line.scannedOutQty > 0));
      let detail = `${unitText(unit)} is not on this list.`;
      if (lockedLine) {
        detail = `This list asks for ${unit.label} serial ${lockedLine.serial} specifically. This is a different unit.`;
      } else if (sameModelLines.length > 0) {
        detail = `Every ${unit.label} on this list has already been scanned.`;
      }

      return finish(res, logBase, {
        result: 'not_on_list',
        title: 'Not on this list',
        detail,
        unit: unitInfo
      });
    } catch (error) {
      console.error('[GEAR SCAN] scan-out failed:', error);
      res.status(500).json({ error: 'Scan failed. Please try again.' });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/gear-scan/manual  - manual reservations that can be scanned against
  // (current, upcoming, ended in the last 30 days, or with something still out)
  // ---------------------------------------------------------------------------
  router.get('/manual', async (req, res) => {
    try {
      if (!canManageGearInventory(req.user)) {
        return res.status(403).json({ error: 'Only inventory managers can use manual reservations' });
      }

      const cutoff = new Date(Date.now() - RECENT_RETURN_WINDOW_MS);
      cutoff.setUTCHours(0, 0, 0, 0);

      const records = await ManualReservation.find({
        $or: [{ endDate: { $gte: cutoff } }, { scannedOutQty: { $gt: 0 } }]
      }).select('personName personEmail notes startDate endDate scannedOutQty returnedQty')
        .sort({ startDate: 1, createdAt: 1 })
        .lean();

      const groups = new Map();
      for (const record of records) {
        const stillOut = scanOutstandingQty(record) > 0;
        if (new Date(record.endDate) < cutoff && !stillOut) continue; // long finished and back

        const key = `${record.personName}|${new Date(record.startDate).toISOString()}|${new Date(record.endDate).toISOString()}`;
        if (!groups.has(key)) {
          groups.set(key, {
            personName: record.personName,
            personEmail: record.personEmail === PLACEHOLDER_EMAIL ? '' : record.personEmail,
            reason: '',
            startDate: record.startDate,
            endDate: record.endDate,
            items: 0,
            scanned: 0,
            stillOut: 0
          });
        }
        const group = groups.get(key);
        group.items++;
        if ((record.scannedOutQty || 0) > 0) group.scanned++;
        if (stillOut) group.stillOut++;
        if (!group.reason && record.notes) group.reason = record.notes;
      }

      res.json({ reservations: [...groups.values()] });
    } catch (error) {
      console.error('[GEAR SCAN] manual list failed:', error);
      res.status(500).json({ error: 'Failed to load manual reservations' });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/gear-scan/manual/lines?personName=&startDate=&endDate=
  // The items on one manual reservation, in the same shape as an event's gear lines
  // ---------------------------------------------------------------------------
  router.get('/manual/lines', async (req, res) => {
    try {
      if (!canManageGearInventory(req.user)) {
        return res.status(403).json({ error: 'Only inventory managers can use manual reservations' });
      }
      const key = readManualKey(req.query);
      if (!key) return res.status(400).json({ error: 'A person and dates are required' });

      const lines = await populateLine(ManualReservation.find(manualGroupFilter(key))).sort({ createdAt: 1, _id: 1 });
      const withReason = lines.find(line => line.notes);

      res.json({
        reservation: { ...key, reason: withReason ? withReason.notes : '' },
        lines: lines.filter(line => line.inventoryId) // skip items deleted from inventory
      });
    } catch (error) {
      console.error('[GEAR SCAN] manual lines failed:', error);
      res.status(500).json({ error: 'Failed to load that reservation' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/gear-scan/manual/scan-out
  // body: { code, quantity?, addUnlisted?,
  //         reservation: { personName, startDate, endDate, personEmail?, reason? } }
  //
  // Same order as an event scan-out: the unit is on the reservation -> mark it scanned;
  // another unit of the same model is -> swap to the unit in hand; "add unlisted" is on
  // -> reserve it for this person and mark it scanned; otherwise -> not_on_list.
  // A reservation that does not exist yet (a walk-up check-out started at the scan
  // station) is created by its first "add unlisted" scan.
  // ---------------------------------------------------------------------------
  router.post('/manual/scan-out', async (req, res) => {
    try {
      const user = req.user;
      if (!canManageGearInventory(user)) {
        return res.status(403).json({ error: 'Only inventory managers can check gear out on a manual reservation' });
      }

      const code = cleanCode(req.body?.code);
      if (!code) return res.status(400).json({ error: 'A scanned code is required' });

      const key = readManualKey(req.body?.reservation);
      if (!key) {
        return res.status(400).json({ error: 'Say who the gear is for and when it is due back (not before it goes out)' });
      }

      const quantity = cleanQuantity(req.body?.quantity);
      const addUnlisted = req.body?.addUnlisted === true;
      const now = new Date();
      const group = manualGroupFilter(key);
      const logBase = { code, lineType: 'manual', eventId: null, listName: null, userId: user.id, action: 'scan_out', method: 'scan', quantity };

      const found = await findUnitByCode(code);
      if (!found.unit) {
        return finish(res, logBase, found.reason === 'ambiguous'
          ? { result: 'ambiguous', title: 'More than one match', detail: `Several items have the serial "${code}". Scan the asset tag instead.` }
          : { result: 'not_found', title: 'Unknown code', detail: `No item found for "${code}".` });
      }

      const unit = found.unit;
      logBase.inventoryId = unit._id;
      const unitInfo = unitSummary(unit);
      const canView = canViewEventFor(user);
      const scanContext = { res, unit, user, now, quantity, logBase, kind: 'manual', extra: { manual: { ...key } } };
      const markScannedOut = createScanOutMarker(scanContext);

      // ---- 1. This exact unit is on the reservation ---------------------------
      const unitLines = await ManualReservation.find({ ...group, inventoryId: unit._id }).sort({ createdAt: 1 });

      const openLine = unitLines.find(line => !(line.returnedQty > 0) && (line.scannedOutQty || 0) < line.quantity);
      if (openLine) {
        const take = Math.min(quantity, openLine.quantity - (openLine.scannedOutQty || 0));
        return markScannedOut(openLine, take, { effect: 'marked', title: 'Scanned out' });
      }

      const returnedLine = unitLines.find(line => line.returnedQty > 0);
      if (returnedLine) return reopenLine(scanContext, returnedLine);

      // On the reservation and fully scanned. A bulk item can still take extra units via "add unlisted".
      const addMoreOfBulkItem = unitLines.length > 0 && addUnlisted && unit.quantity > 1;
      if (unitLines.length > 0 && !addMoreOfBulkItem) {
        const line = await populateLine(ManualReservation.findById(unitLines[0]._id));
        const by = line.packedBy?.fullName ? ` by ${line.packedBy.fullName}` : '';
        return finish(res, { ...logBase, reservedItemId: line._id }, {
          result: 'already_scanned',
          level: 'warn',
          title: 'Already scanned',
          detail: `${unitText(unit)} was already scanned out${by}.`,
          unit: unitInfo,
          lines: [line],
          manual: { ...key }
        });
      }

      // ---- 2. Same model, different unit -> swap to the unit in hand -----------
      let sameModelLines = [];
      if (!addMoreOfBulkItem) {
        const siblings = await GearInventory.find({
          label: unit.label,
          category: unit.category,
          _id: { $ne: unit._id }
        }).select('_id').lean();

        if (siblings.length > 0) {
          sameModelLines = await ManualReservation.find({
            ...group,
            inventoryId: { $in: siblings.map(sibling => sibling._id) }
          }).sort({ isPacked: 1, createdAt: 1 });
        }
      }

      const swapLine = quantity === 1
        ? sameModelLines.find(line =>
            line.quantity === 1 &&
            !line.specificSerialRequested &&
            !(line.scannedOutQty > 0) &&
            !(line.returnedQty > 0))
        : null;

      if (swapLine) {
        const previousInventoryId = swapLine.inventoryId;
        // Manual reservations only store a serial when one was typed in, so ask the unit itself
        const previousUnit = swapLine.serial
          ? null
          : await GearInventory.findById(previousInventoryId).select('serial').lean();
        const previousSerial = swapLine.serial || (previousUnit && previousUnit.serial);
        if (!(await swapManualUnit(swapLine, unit))) {
          const conflict = await findReservationConflict(unit._id, key.startDate, key.endDate, { canViewEvent: canView });
          return finish(res, logBase, { ...conflictOutcome(conflict, unit), unit: unitInfo, manual: { ...key } });
        }

        const swapped = await ManualReservation.findById(swapLine._id);
        const replaced = previousSerial && previousSerial !== 'N/A' ? `SN ${previousSerial}` : 'the unit on the reservation';
        return markScannedOut(swapped, 1, {
          effect: 'swapped',
          title: 'Scanned out',
          detail: `${unitText(unit)} - used in place of ${replaced}.`,
          previousExtra: { inventoryId: previousInventoryId }
        });
      }

      // ---- 3. Not on the reservation -> add it (when allowed) -------------------
      if (addUnlisted) {
        const pulled = await releaseLaterEarlyPacks(unit, key.endDate, user);
        const available = await AtomicReservationService.getAvailableQuantity(unit._id, key.startDate, key.endDate);
        if (available < quantity) {
          if (available > 0) {
            return finish(res, logBase, {
              result: 'unavailable',
              title: 'Not enough available',
              detail: `Only ${available} of ${unit.label} ${available === 1 ? 'is' : 'are'} available for these dates.`,
              unit: unitInfo,
              manual: { ...key }
            });
          }
          const conflict = await findReservationConflict(unit._id, key.startDate, key.endDate, { canViewEvent: canView });
          return finish(res, logBase, { ...conflictOutcome(conflict, unit), unit: unitInfo, manual: { ...key } });
        }

        // Email and reason come from the reservation when it already has items
        const existing = await ManualReservation.findOne(group).sort({ createdAt: 1 }).lean();
        const requested = req.body.reservation;
        const email = typeof requested.personEmail === 'string' ? requested.personEmail.trim().toLowerCase().slice(0, 200) : '';
        const reason = typeof requested.reason === 'string' ? requested.reason.trim().slice(0, 200) : '';
        const labelParts = unit.label.split(' ');

        const added = await ManualReservation.create({
          personName: key.personName,
          personEmail: existing ? existing.personEmail : (/^\S+@\S+\.\S+$/.test(email) ? email : PLACEHOLDER_EMAIL),
          startDate: key.startDate,
          endDate: key.endDate,
          inventoryId: unit._id,
          brand: labelParts[0] || 'Unknown',
          model: labelParts.slice(1).join(' ') || 'Unknown',
          category: unit.category,
          quantity,
          serial: unit.serial,
          specificSerialRequested: false,
          createdBy: user.id,
          notes: (existing && existing.notes) || reason
        });

        return markScannedOut(added, quantity, {
          effect: 'added',
          title: 'Added and scanned out',
          detail: quantity > 1 ? `${unitText(unit)} x ${quantity}` : unitText(unit),
          extraWarnings: pulled.warnings
        });
      }

      // ---- 4. Not on the reservation ---------------------------------------------
      const lockedLine = sameModelLines.find(line => line.specificSerialRequested && !(line.scannedOutQty > 0));
      let detail = `${unitText(unit)} is not on this reservation.`;
      if (lockedLine) {
        detail = `This reservation asks for ${unit.label} serial ${lockedLine.serial} specifically. This is a different unit.`;
      } else if (sameModelLines.length > 0) {
        detail = `Every ${unit.label} on this reservation has already been scanned.`;
      }

      return finish(res, logBase, {
        result: 'not_on_list',
        title: 'Not on this reservation',
        detail,
        unit: unitInfo,
        manual: { ...key }
      });
    } catch (error) {
      console.error('[GEAR SCAN] manual scan-out failed:', error);
      res.status(500).json({ error: 'Scan failed. Please try again.' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/gear-scan/scan-in
  // body: { code, eventId?, quantity? }   - scanned return; event is optional
  //    or { lineId, quantity? }           - "Mark returned" button on a line
  //
  // With no event named (the scan station) the return may also belong to a manual
  // reservation. Inside one event's check-in mode only that event's lines are matched.
  // ---------------------------------------------------------------------------
  router.post('/scan-in', async (req, res) => {
    try {
      const user = req.user;
      const now = new Date();
      const isInventoryManager = canManageGearInventory(user);
      const lineId = req.body?.lineId;
      const eventId = req.body?.eventId;

      if (eventId !== undefined && eventId !== null && !isId(eventId)) {
        return res.status(400).json({ error: 'Invalid event ID' });
      }

      // Log fields that say where a line belongs. `where` is { kind, title, event }.
      const placeFields = (line, where) => ({
        lineType: where.kind,
        reservedItemId: line._id,
        eventId: where.event ? where.event._id : null,
        listName: where.kind === 'manual' ? null : line.listName
      });

      // Marks `line` returned for up to `requested` units and answers the request
      const markReturned = async (line, where, requested, logBase, unit, method) => {
        const previous = snapshotLine(line);
        const wasOverdue = scanOutstandingQty(line) > 0 && isOverdue(line.checkInDate, now);
        const outQty = lineOutQty(line);
        const returnable = Math.max(0, outQty - (line.returnedQty || 0));
        const take = Math.min(requested || returnable, returnable);
        const returned = (line.returnedQty || 0) + take;
        const complete = returned >= outQty;

        const changes = { returnedQty: returned };
        if (complete) {
          Object.assign(changes, { returnedAt: now, returnedBy: user.id, returnMethod: method });
        }

        const updated = await updateLineIfUnchanged(line, changes, where.kind);
        if (!updated) return busy(res);

        const warnings = [];
        if (requested && requested > take) {
          warnings.push(`Only ${take} ${take === 1 ? 'was' : 'were'} out - the other ${requested - take} ${requested - take === 1 ? 'was' : 'were'} not counted.`);
        }

        const stillOut = outQty - returned;
        return finish(res, {
          ...logBase,
          ...placeFields(updated, where),
          quantity: take,
          previous: { line: previous, closed: [] }
        }, {
          result: 'ok',
          effect: 'returned',
          title: outQty > 1 ? `Checked in ${take}${stillOut > 0 ? ` (${stillOut} still out)` : ''}` : 'Checked in',
          detail: `${unitText(unit)} - back from "${where.title}"${wasOverdue ? ' (was overdue)' : ''}`,
          unit: unitSummary(unit),
          event: where.event ? { _id: where.event._id, title: where.title } : null,
          manual: where.kind === 'manual' ? manualKey(updated) : undefined,
          warnings,
          lines: await loadLinesForResponse([updated._id], where.kind)
        });
      };

      // ---- "Mark returned" on a specific line --------------------------------
      if (lineId) {
        if (!isId(lineId)) return res.status(400).json({ error: 'Invalid line ID' });

        const foundLine = await findLineOfAnyKind(lineId);
        if (!foundLine) return res.status(404).json({ error: 'Gear list item not found' });
        const { line, kind } = foundLine;

        let where;
        if (kind === 'manual') {
          if (!isInventoryManager) {
            return res.status(403).json({ error: 'Only inventory managers can check in a manual reservation' });
          }
          where = { kind, title: manualTitle(line), event: null };
        } else {
          const event = await loadEvent(line.eventId);
          if (!event) return res.status(404).json({ error: 'Event not found' });
          if (!isInventoryManager && !hasEventAccess(event, user)) {
            return res.status(403).json({ error: 'Not authorized to access this event' });
          }
          where = { kind, title: event.title || 'Untitled event', event };
        }

        const unit = await GearInventory.findById(line.inventoryId);
        if (!unit) return res.status(404).json({ error: 'Inventory item not found' });

        const logBase = { code: '', inventoryId: unit._id, userId: user.id, action: 'scan_in', method: 'manual' };

        if (lineOutQty(line) - (line.returnedQty || 0) <= 0) {
          return finish(res, { ...logBase, ...placeFields(line, where) }, {
            result: 'already_returned',
            level: 'warn',
            title: 'Already checked in',
            detail: unitText(unit),
            unit: unitSummary(unit),
            lines: await loadLinesForResponse([line._id], kind)
          });
        }

        const requested = req.body?.quantity ? cleanQuantity(req.body.quantity) : null;
        return markReturned(line, where, requested, logBase, unit, 'manual');
      }

      // ---- Scanned return ----------------------------------------------------
      const code = cleanCode(req.body?.code);
      if (!code) return res.status(400).json({ error: 'A scanned code is required' });
      const quantity = cleanQuantity(req.body?.quantity);

      const logBase = { code, eventId: eventId || null, userId: user.id, action: 'scan_in', method: 'scan', quantity };

      const found = await findUnitByCode(code);
      if (!found.unit) {
        return finish(res, logBase, found.reason === 'ambiguous'
          ? { result: 'ambiguous', title: 'More than one match', detail: `Several items have the serial "${code}". Scan the asset tag instead.` }
          : { result: 'not_found', title: 'Unknown code', detail: `No item found for "${code}".` });
      }

      const unit = found.unit;
      logBase.inventoryId = unit._id;

      const query = { inventoryId: unit._id };
      if (eventId) query.eventId = eventId;
      const eventLines = await ReservedGearItem.find(query).sort({ checkOutDate: 1, createdAt: 1 });
      const manualLines = eventId
        ? []
        : await ManualReservation.find({ inventoryId: unit._id }).sort({ startDate: 1, createdAt: 1 });

      // Rank: scanned out and not back (0), packed by hand (1), reserved only (2)
      const rank = (line) => (scanOutstandingQty(line) > 0 ? 0 : (line.isPacked ? 1 : 2));
      const isCurrentOrRecent = (line) =>
        new Date(line.checkOutDate).getTime() <= now.getTime() &&
        new Date(line.checkInDate).getTime() >= now.getTime() - RECENT_RETURN_WINDOW_MS;
      // Without a scan-out record, only match reservations that are current or just ended
      // (inside one event's check-in mode, any line of that event may be returned)
      const canBeReturned = (line) =>
        lineOutQty(line) - (line.returnedQty || 0) > 0 &&
        (rank(line) === 0 || !!eventId || isCurrentOrRecent(line));

      const returnableEventLines = eventLines.filter(canBeReturned);
      const events = await Table.find({ _id: { $in: returnableEventLines.map(line => line.eventId) } }).select(EVENT_SCAN_FIELDS);
      const eventById = new Map(events.map(event => [event._id.toString(), event]));

      const candidates = [
        ...returnableEventLines
          .filter(line => eventById.has(line.eventId.toString()))
          .map(line => {
            const event = eventById.get(line.eventId.toString());
            return {
              line,
              where: { kind: 'event', title: event.title || 'Untitled event', event },
              allowed: isInventoryManager || hasEventAccess(event, user)
            };
          }),
        ...manualLines.filter(canBeReturned).map(line => ({
          line,
          where: { kind: 'manual', title: manualTitle(line), event: null },
          allowed: isInventoryManager
        }))
      ].sort((a, b) => (rank(a.line) - rank(b.line)) ||
        (new Date(a.line.checkOutDate) - new Date(b.line.checkOutDate)));

      if (candidates.length === 0) {
        const lastReturned = [
          ...eventLines.map(line => ({ line, kind: 'event' })),
          ...manualLines.map(line => ({ line, kind: 'manual' }))
        ].filter(entry => entry.line.returnedAt)
          .sort((a, b) => new Date(b.line.returnedAt) - new Date(a.line.returnedAt))[0];

        if (lastReturned) {
          return finish(res, { ...logBase, lineType: lastReturned.kind, reservedItemId: lastReturned.line._id }, {
            result: 'already_returned',
            level: 'warn',
            title: 'Already checked in',
            detail: `${unitText(unit)} is not checked out.`,
            unit: unitSummary(unit),
            lines: eventId ? await loadLinesForResponse([lastReturned.line._id]) : []
          });
        }

        return finish(res, logBase, {
          result: 'not_out',
          level: 'warn',
          title: 'Not checked out',
          detail: eventId
            ? `${unitText(unit)} is not on this event's gear lists.`
            : `${unitText(unit)} is not checked out on any event.`,
          unit: unitSummary(unit)
        });
      }

      const chosen = candidates.find(candidate => candidate.allowed);
      if (!chosen) {
        const isManual = candidates[0].where.kind === 'manual';
        return finish(res, logBase, {
          result: 'forbidden',
          title: isManual ? 'Manual reservation' : 'Not your event',
          detail: isManual
            ? `${unitText(unit)} is checked out on a manual reservation. An inventory manager has to check it in.`
            : `${unitText(unit)} is checked out on an event you do not have access to.`,
          unit: unitSummary(unit)
        });
      }

      return markReturned(chosen.line, chosen.where, quantity, logBase, unit, 'scan');
    } catch (error) {
      console.error('[GEAR SCAN] scan-in failed:', error);
      res.status(500).json({ error: 'Check-in failed. Please try again.' });
    }
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/gear-scan/lines/:id  - remove a line from the list (not scanned out)
  // Event gear managers / inventory managers (manual). Refuses if scannedOutQty > 0.
  // ---------------------------------------------------------------------------
  router.delete('/lines/:id', async (req, res) => {
    try {
      const { id } = req.params;
      if (!isId(id)) return res.status(400).json({ error: 'Invalid line ID' });

      const user = req.user;
      const foundLine = await findLineOfAnyKind(id);
      if (!foundLine) return res.status(404).json({ error: 'Gear list item not found' });
      const { line, kind } = foundLine;
      const isManual = kind === 'manual';

      let event = null;
      if (isManual) {
        if (!canManageGearInventory(user)) {
          return res.status(403).json({ error: 'Only inventory managers can change a manual reservation' });
        }
      } else {
        event = await loadEvent(line.eventId);
        if (!event) return res.status(404).json({ error: 'Event not found' });
        if (!canManageEventGearLists(event, user)) {
          return res.status(403).json({ error: 'Not authorized to edit gear for this event' });
        }
      }

      if ((line.scannedOutQty || 0) > 0) {
        return res.status(409).json({
          error: 'This item has been scanned out. Clear the scan before removing it from the list.'
        });
      }

      const label = `${line.brand || ''} ${line.model || ''}`.trim() || 'Item';
      const quantity = line.quantity || 1;

      if (isManual) {
        await ManualReservation.deleteOne({ _id: line._id });
      } else {
        await AtomicReservationService.releaseReservation(line._id);
      }

      GearScanLog.create({
        code: '',
        lineType: kind,
        inventoryId: line.inventoryId,
        reservedItemId: line._id,
        eventId: isManual ? null : line.eventId,
        listName: isManual ? null : line.listName,
        userId: user.id,
        action: 'undo',
        method: 'manual',
        result: 'ok',
        effect: 'removed',
        quantity,
        message: `Removed from list: ${label}`
      }).catch(logError => console.error('[GEAR SCAN] Failed to write remove log:', logError.message));

      return res.json({
        ok: true,
        removedLineId: line._id,
        title: 'Removed from list',
        detail: label
      });
    } catch (error) {
      console.error('[GEAR SCAN] remove line failed:', error);
      res.status(500).json({ error: 'Failed to remove item from the list' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/gear-scan/lines/:id/undo   (an event gear line or a manual reservation)
  // body: { logId }               - reverse exactly what that scan did
  //    or { action }              - 'scan_out' (default) clears the scan-out,
  //                                 'scan_in' clears the check-in
  // ---------------------------------------------------------------------------
  router.post('/lines/:id/undo', async (req, res) => {
    try {
      const { id } = req.params;
      if (!isId(id)) return res.status(400).json({ error: 'Invalid line ID' });

      const user = req.user;
      const logId = req.body?.logId;
      if (logId !== undefined && logId !== null && !isId(logId)) {
        return res.status(400).json({ error: 'Invalid scan ID' });
      }

      const foundLine = await findLineOfAnyKind(id);
      if (!foundLine) return res.status(404).json({ error: 'Gear list item not found' });
      const { line, kind } = foundLine;
      const Model = modelFor(kind);
      const isManual = kind === 'manual';
      const isInventoryManager = canManageGearInventory(user);

      let event = null;
      let hasAccess = isInventoryManager;
      if (!isManual) {
        event = await loadEvent(line.eventId);
        if (!event) return res.status(404).json({ error: 'Event not found' });
        hasAccess = hasEventAccess(event, user);
      }
      const noAccess = isManual ? 'Only inventory managers can change a manual reservation' : 'Not authorized to access this event';
      const warnings = [];

      const writeUndoLog = (fields) => GearScanLog.create({
        code: '',
        lineType: kind,
        inventoryId: line.inventoryId,
        reservedItemId: line._id,
        eventId: isManual ? null : line.eventId,
        listName: isManual ? null : line.listName,
        userId: user.id,
        action: 'undo',
        method: 'manual',
        result: 'ok',
        effect: 'undone',
        ...fields
      }).catch(logError => console.error('[GEAR SCAN] Failed to write undo log:', logError.message));

      // ---- Reverse one specific scan ----------------------------------------
      if (logId) {
        const log = await GearScanLog.findById(logId);
        if (!log || !log.reservedItemId || log.reservedItemId.toString() !== id ||
            log.result !== 'ok' || !['scan_out', 'scan_in'].includes(log.action)) {
          return res.status(404).json({ error: 'Scan not found' });
        }
        if (log.undoneAt) return res.status(409).json({ error: 'That scan was already undone' });

        if (!hasAccess && !(log.action === 'scan_in' && isInventoryManager)) {
          return res.status(403).json({ error: noAccess });
        }

        const latest = await GearScanLog.findOne({ reservedItemId: line._id, result: 'ok', undoneAt: null })
          .sort({ createdAt: -1, _id: -1 });
        if (!latest || latest._id.toString() !== log._id.toString()) {
          return res.status(409).json({ error: 'This item has changed since that scan. Refresh the list to see its current state.' });
        }

        const previous = log.previous || {};
        let removedLineId = null;

        if (log.effect === 'added') {
          // The scan put this line on the list - take it off again
          if (isManual) {
            await ManualReservation.deleteOne({ _id: line._id });
          } else {
            if (!canManageEventGearLists(event, user)) {
              return res.status(403).json({ error: 'Not authorized to edit gear for this event' });
            }
            await AtomicReservationService.releaseReservation(line._id);
          }
          removedLineId = line._id;
        } else {
          if (previous.line) {
            await Model.updateOne({ _id: line._id }, { $set: previous.line });
          }
          if (log.effect === 'swapped' && previous.inventoryId) {
            let swappedBack = true;
            if (isManual) {
              const original = await GearInventory.findById(previous.inventoryId);
              swappedBack = !!original && await swapManualUnit(line, original);
            } else {
              try {
                await AtomicReservationService.swapReservationUnit(line._id, previous.inventoryId);
              } catch (swapError) {
                if (swapError.code !== 'UNAVAILABLE') throw swapError;
                swappedBack = false;
              }
            }
            if (!swappedBack) {
              warnings.push(`The unit originally on the ${isManual ? 'reservation' : 'list'} is no longer available, so it keeps the scanned unit.`);
            }
          }
        }

        // Re-open anything this scan closed out on other reservations
        for (const closed of previous.closed || []) {
          await modelFor(closed.kind).updateOne({ _id: closed.lineId }, { $set: closed.previous });
        }

        log.undoneAt = new Date();
        log.undoneBy = user.id;
        await log.save();
        await writeUndoLog({ quantity: log.quantity, message: `Undid ${log.action === 'scan_in' ? 'check-in' : 'scan-out'}` });

        return res.json({
          ok: true,
          result: 'ok',
          level: warnings.length ? 'warn' : 'ok',
          title: log.action === 'scan_in' ? 'Check-in undone' : 'Scan undone',
          detail: '',
          warnings,
          removedLineId,
          manual: isManual ? manualKey(line) : undefined,
          lines: removedLineId ? [] : await loadLinesForResponse([line._id], kind)
        });
      }

      // ---- Clear the scan state of a line -------------------------------------
      const action = req.body?.action === 'scan_in' ? 'scan_in' : 'scan_out';
      if (!hasAccess && !(action === 'scan_in' && isInventoryManager)) {
        return res.status(403).json({ error: noAccess });
      }

      if (action === 'scan_in') {
        await Model.updateOne({ _id: line._id }, {
          $set: { returnedQty: 0, returnedAt: null, returnedBy: null, returnMethod: null }
        });
        await writeUndoLog({ quantity: line.returnedQty || 0, message: 'Cleared check-in' });
      } else {
        if (line.returnedQty > 0) {
          return res.status(409).json({ error: 'This item has been checked in. Undo the check-in first.' });
        }
        await Model.updateOne({ _id: line._id }, {
          $set: { scannedOutQty: 0, isPacked: false, packedAt: null, packedMethod: null, packedBy: null }
        });
        await writeUndoLog({ quantity: line.scannedOutQty || 0, message: 'Cleared scan-out' });
      }

      res.json({
        ok: true,
        result: 'ok',
        level: 'ok',
        title: action === 'scan_in' ? 'Check-in undone' : 'Scan undone',
        detail: '',
        warnings: [],
        removedLineId: null,
        manual: isManual ? manualKey(line) : undefined,
        lines: await loadLinesForResponse([line._id], kind)
      });
    } catch (error) {
      console.error('[GEAR SCAN] undo failed:', error);
      res.status(500).json({ error: 'Undo failed. Please try again.' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/gear-scan/clear  - clear many lines in one go instead of undoing one at a time
  // body: { action: 'scan_out', eventId, listName? }  - every scan on that list: the lines go back
  //                                                     to not packed, and a check-in on them is
  //                                                     cleared with it
  //    or { action: 'scan_out', reservation }         - the same for a manual reservation
  //                                                     ({ personName, startDate, endDate })
  //    or { action: 'scan_in', eventId, listName? }   - every check-in on that list
  //    or { action: 'scan_in', reservation }          - every check-in on that manual reservation
  //    or { action: 'scan_in', lineIds: [...] }       - the check-in of just those lines
  //                                                     (scan station check-in, any kind of line)
  //
  // A tick made by hand is not a scan and stays. Lines that a scan added to the list, or
  // swapped to another unit, stay on the list as they are - only their scan state is cleared.
  // ---------------------------------------------------------------------------
  router.post('/clear', async (req, res) => {
    try {
      const user = req.user;
      const action = req.body?.action;
      if (action !== 'scan_out' && action !== 'scan_in') {
        return res.status(400).json({ error: 'Choose what to clear: scans or check-ins' });
      }

      const isInventoryManager = canManageGearInventory(user);
      const lineIds = req.body?.lineIds;
      const reservation = req.body?.reservation;
      const stateFilter = action === 'scan_in' ? { returnedQty: { $gt: 0 } } : { scannedOutQty: { $gt: 0 } };
      let eventLines = [];
      let manualLines = [];
      let skipped = 0;
      let place = 'list';

      if (lineIds !== undefined && lineIds !== null) {
        if (action !== 'scan_in') {
          return res.status(400).json({ error: 'Scans are cleared a whole list at a time' });
        }
        if (!Array.isArray(lineIds) || lineIds.length === 0 || lineIds.length > MAX_CLEAR_LINES || !lineIds.every(isId)) {
          return res.status(400).json({ error: 'Invalid list of items' });
        }

        const [foundEventLines, foundManualLines] = await Promise.all([
          ReservedGearItem.find({ _id: { $in: lineIds }, ...stateFilter }),
          ManualReservation.find({ _id: { $in: lineIds }, ...stateFilter })
        ]);
        const events = await Table.find({ _id: { $in: foundEventLines.map(line => line.eventId) } }).select(EVENT_SCAN_FIELDS);
        const eventById = new Map(events.map(event => [event._id.toString(), event]));

        eventLines = foundEventLines.filter(line => {
          const event = eventById.get(line.eventId.toString());
          return event && (isInventoryManager || hasEventAccess(event, user));
        });
        manualLines = isInventoryManager ? foundManualLines : [];

        const found = foundEventLines.length + foundManualLines.length;
        skipped = found - eventLines.length - manualLines.length;
        if (found > 0 && skipped === found) {
          return res.status(403).json({ error: 'Not authorized to access those events' });
        }
      } else if (reservation !== undefined && reservation !== null) {
        if (!isInventoryManager) {
          return res.status(403).json({ error: 'Only inventory managers can change a manual reservation' });
        }
        const key = readManualKey(reservation);
        if (!key) return res.status(400).json({ error: 'A person and dates are required' });

        manualLines = await ManualReservation.find({ ...manualGroupFilter(key), ...stateFilter });
        place = 'reservation';
      } else {
        const { eventId } = req.body;
        if (!isId(eventId)) return res.status(400).json({ error: 'Invalid event ID' });

        const event = await loadEvent(eventId);
        if (!event) return res.status(404).json({ error: 'Event not found' });
        if (!hasEventAccess(event, user) && !(action === 'scan_in' && isInventoryManager)) {
          return res.status(403).json({ error: 'Not authorized to access this event' });
        }

        const listName = resolveListName(event, req.body?.listName);
        if (!listName) return res.status(400).json({ error: 'Gear list not found' });

        eventLines = await ReservedGearItem.find({ eventId, listName, ...stateFilter });
      }

      const lines = [
        ...eventLines.map(line => ({ line, kind: 'event' })),
        ...manualLines.map(line => ({ line, kind: 'manual' }))
      ];

      if (lines.length === 0) {
        return res.json({
          ok: false,
          result: 'nothing_to_clear',
          level: 'warn',
          title: 'Nothing to clear',
          detail: action === 'scan_in' ? 'None of those items are checked in.' : `Nothing on this ${place} has been scanned.`,
          warnings: [],
          lines: [],
          cleared: 0,
          lineIds: []
        });
      }

      const now = new Date();
      const returnReset = { returnedQty: 0, returnedAt: null, returnedBy: null, returnMethod: null };
      const tickedByHand = (line) => line.isPacked && line.packedMethod !== 'scan';

      for (const kind of ['event', 'manual']) {
        const ofKind = lines.filter(entry => entry.kind === kind).map(entry => entry.line);
        if (ofKind.length === 0) continue;
        const Model = modelFor(kind);

        if (action === 'scan_in') {
          await Model.updateMany({ _id: { $in: ofKind.map(line => line._id) } }, { $set: returnReset });
          continue;
        }

        // A line that was part scanned and then ticked by hand keeps its tick
        const keepTick = ofKind.filter(tickedByHand).map(line => line._id);
        const scanned = ofKind.filter(line => !tickedByHand(line)).map(line => line._id);
        if (scanned.length > 0) {
          await Model.updateMany({ _id: { $in: scanned } }, {
            $set: { scannedOutQty: 0, isPacked: false, packedAt: null, packedMethod: null, packedBy: null, ...returnReset }
          });
        }
        if (keepTick.length > 0) {
          await Model.updateMany({ _id: { $in: keepTick } }, { $set: { scannedOutQty: 0, ...returnReset } });
        }
      }

      const ids = lines.map(entry => entry.line._id);
      const checkedIn = action === 'scan_out' ? lines.filter(entry => entry.line.returnedQty > 0).length : 0;

      // Audit trail: the scans that were cleared can no longer be undone one by one, and each
      // line gets a row holding its state from before the clear
      try {
        await GearScanLog.updateMany({
          reservedItemId: { $in: ids },
          result: 'ok',
          undoneAt: null,
          action: action === 'scan_in' ? 'scan_in' : { $in: ['scan_out', 'scan_in'] }
        }, { $set: { undoneAt: now, undoneBy: user.id } });

        await GearScanLog.insertMany(lines.map(({ line, kind }) => ({
          code: '',
          lineType: kind,
          inventoryId: line.inventoryId,
          reservedItemId: line._id,
          eventId: kind === 'manual' ? null : line.eventId,
          listName: kind === 'manual' ? null : line.listName,
          userId: user.id,
          action: 'undo',
          method: 'manual',
          result: 'ok',
          effect: 'cleared',
          quantity: (action === 'scan_in' ? line.returnedQty : line.scannedOutQty) || 0,
          message: action === 'scan_in' ? 'Cleared check-in (clear all)' : 'Cleared scan-out (clear all)',
          previous: { line: snapshotLine(line) }
        })));
      } catch (logError) {
        console.error('[GEAR SCAN] Failed to write clear log:', logError.message);
      }

      const count = lines.length;
      const plural = (word) => (count === 1 ? word : `${word}s`);
      const warnings = [];
      if (skipped > 0) {
        warnings.push(`${skipped} ${skipped === 1 ? 'item is' : 'items are'} on a reservation you do not have access to and ${skipped === 1 ? 'was' : 'were'} left as ${skipped === 1 ? 'it is' : 'they are'}.`);
      }

      let detail;
      if (action === 'scan_in') {
        detail = count === 1 ? 'That item is no longer marked as returned.' : 'Those items are no longer marked as returned.';
      } else {
        detail = count === 1 ? 'That item is back to not packed.' : 'Those items are back to not packed.';
        if (checkedIn > 0) {
          detail += ` ${checkedIn === count ? (count === 1 ? 'It' : 'All of them') : checkedIn} had been checked in - that was cleared too.`;
        }
      }

      res.json({
        ok: true,
        result: 'ok',
        level: warnings.length ? 'warn' : 'ok',
        effect: 'cleared',
        title: action === 'scan_in' ? `Cleared ${count} ${plural('check-in')}` : `Cleared ${count} ${plural('scan')}`,
        detail,
        warnings,
        lines: [],
        cleared: count,
        lineIds: ids
      });
    } catch (error) {
      console.error('[GEAR SCAN] clear failed:', error);
      res.status(500).json({ error: 'Clearing failed. Please try again.' });
    }
  });

  return router;
};

/**
 * When gear is packed before its listed check-out day, the days in between still
 * need to count as taken - otherwise someone else can reserve a unit that is
 * already in a case. These helpers compute that physical hold for both event
 * gear lines and manual reservations.
 */

function utcDay(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/** Exclusive end of a calendar day - use with packedAt: { $lt: utcDayAfter(reqEnd) } */
function utcDayAfter(value) {
  const day = utcDay(value);
  if (!day) return null;
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function checkOutOf(line) {
  return utcDay(line.checkOutDate != null ? line.checkOutDate : line.startDate);
}

function checkInOf(line) {
  return utcDay(line.checkInDate != null ? line.checkInDate : line.endDate);
}

/** Units still physically out on a scan (not yet returned). */
function scanHeldQty(line) {
  return Math.max(0, (line.scannedOutQty || 0) - (line.returnedQty || 0));
}

/**
 * How many units this line is holding right now.
 * Prefers scan counts; a hand tick with nothing returned counts the whole line.
 */
function heldQty(line) {
  const scanned = scanHeldQty(line);
  if (scanned > 0) return scanned;
  if (line.isPacked && !(line.returnedQty > 0)) return line.quantity || 1;
  return 0;
}

/**
 * First day this line keeps the gear unavailable.
 * Packed early -> the pack day; otherwise the listed check-out day.
 */
function holdStart(line) {
  const checkOut = checkOutOf(line);
  if (!checkOut) return null;
  if (heldQty(line) <= 0 || !line.packedAt) return checkOut;
  const packed = utcDay(line.packedAt);
  return packed && packed < checkOut ? packed : checkOut;
}

function holdOverlaps(line, reqStart, reqEnd) {
  const start = holdStart(line);
  const end = checkInOf(line);
  if (!start || !end) return false;
  return start <= reqEnd && end >= reqStart;
}

/**
 * How much of this line to subtract from availability for a date range.
 * Inside the listed reservation window: the full reserved quantity.
 * Only in the early-pack window (before check-out): the units already in hand.
 */
function reservedQtyForRequest(line, reqStart, reqEnd) {
  if (!holdOverlaps(line, reqStart, reqEnd)) return 0;

  const checkOut = checkOutOf(line);
  const checkIn = checkInOf(line);
  const normalOverlap = checkOut && checkIn && checkOut <= reqEnd && checkIn >= reqStart;
  if (normalOverlap) return line.quantity || 1;
  return heldQty(line);
}

module.exports = {
  utcDay,
  utcDayAfter,
  checkOutOf,
  checkInOf,
  scanHeldQty,
  heldQty,
  holdStart,
  holdOverlaps,
  reservedQtyForRequest
};

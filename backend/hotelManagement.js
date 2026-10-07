const HotelRequest = require('./models/HotelRequest');

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCost(value) {
  const n = parseFloat(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function dateOnly(value) {
  if (!value) return '';
  const raw = value instanceof Date ? value.toISOString() : String(value);
  return raw.split('T')[0];
}

function eventIdOf(hotel) {
  if (!hotel || !hotel.eventId) return null;
  return hotel.eventId._id || hotel.eventId;
}

function normalizeRef(ref) {
  return String(ref || '').trim().toUpperCase();
}

async function resolveEventName(Table, eventId) {
  if (!eventId) return '';
  const linked = await Table.findById(eventId).select('title');
  return linked ? linked.title : '';
}

async function clearHotelRequestedBadge(Table, eventId) {
  if (!eventId) return;
  await Table.updateOne(
    { _id: eventId, 'badgesRequested.hotel': true },
    { $set: { 'badgesRequested.hotel': false } }
  );
}

function hotelQueryForEvent(table) {
  const eventId = table._id;
  const title = (table.title || '').trim();
  const query = {
    status: { $in: ['booked', 'cancelled'] },
    $or: [{ eventId }]
  };
  if (title) {
    query.$or.push({ eventName: new RegExp(`^${escapeRegex(title)}$`, 'i') });
  }
  return query;
}

/** One accommodation row per guest, same shape as table.accommodation */
function transformHotelToAccommodationRow(hotel, guest) {
  const details = hotel.bookedDetails || {};
  const cost = parseFloat(hotel.cost);
  const hotelName = details.hotelName || hotel.preferredHotel || '';
  const cancelled = hotel.status === 'cancelled';
  return {
    checkin: dateOnly(hotel.checkInDate),
    checkout: dateOnly(hotel.checkOutDate),
    name: guest?.name || '',
    hotel: cancelled && hotelName ? `${hotelName} (Cancelled)` : hotelName,
    ref: details.confirmationCode || '',
    cost: Number.isFinite(cost) && cost > 0 ? cost : 0,
    _fromHotelManagement: true,
    _hotelId: hotel._id ? hotel._id.toString() : ''
  };
}

async function getHotelManagementAccommodationRows(table) {
  const hotels = await HotelRequest.find(hotelQueryForEvent(table)).lean();
  const rows = [];
  hotels.forEach(hotel => {
    const guests = hotel.guests && hotel.guests.length ? hotel.guests : [{ name: '' }];
    guests.forEach(guest => rows.push(transformHotelToAccommodationRow(hotel, guest)));
  });
  return rows;
}

/** One expense row per confirmation (or per booking when there is no confirmation) */
async function buildHotelExpenseRows(table) {
  const hotels = await HotelRequest.find(hotelQueryForEvent(table)).lean();
  const byKey = new Map();

  hotels.forEach(hotel => {
    const details = hotel.bookedDetails || {};
    const ref = String(details.confirmationCode || '').trim();
    const refNorm = normalizeRef(ref);
    const key = refNorm ? `href:${refNorm}` : `hm:${hotel._id}`;
    const names = (hotel.guests || []).map(g => (g.name || '').trim()).filter(Boolean);
    const cost = parseCost(hotel.cost);
    const hotelName = details.hotelName || hotel.preferredHotel || '';

    if (!byKey.has(key)) {
      byKey.set(key, {
        sourceKey: key,
        sourceIndex: null,
        names: new Set(),
        checkIn: dateOnly(hotel.checkInDate),
        checkOut: dateOnly(hotel.checkOutDate),
        hotels: new Set(),
        refNumber: ref,
        cost: 0,
        notes: '',
        imported: true
      });
    }
    const g = byKey.get(key);
    names.forEach(n => g.names.add(n));
    if (hotelName) g.hotels.add(hotel.status === 'cancelled' ? `${hotelName} (Cancelled)` : hotelName);
    if (!g.checkIn || dateOnly(hotel.checkInDate) < g.checkIn) g.checkIn = dateOnly(hotel.checkInDate);
    if (!g.checkOut || dateOnly(hotel.checkOutDate) > g.checkOut) g.checkOut = dateOnly(hotel.checkOutDate);
    g.cost = Math.max(g.cost, cost);
  });

  return [...byKey.values()].map(g => ({
    sourceKey: g.sourceKey,
    sourceIndex: null,
    name: [...g.names].sort((a, b) => a.localeCompare(b)).join(', '),
    checkIn: g.checkIn,
    checkOut: g.checkOut,
    hotel: [...g.hotels].join(', '),
    refNumber: g.refNumber,
    cost: Math.round(g.cost * 100) / 100,
    notes: '',
    imported: true
  })).sort((a, b) => (a.checkIn || '').localeCompare(b.checkIn || ''));
}

function populateHotelQuery(query) {
  return query
    .populate('createdBy', 'fullName email')
    .populate('eventId', 'title')
    .populate('bookedDetails.bookedBy', 'fullName email')
    .populate('changeDetails.requestedBy', 'fullName email')
    .populate('changeDetails.originalHotelId');
}

function registerHotelRoutes(app, deps) {
  const {
    authenticate,
    hasPlannerAccess,
    Table,
    User,
    notifyDataChange,
    createNotification,
    createNotificationBulk
  } = deps;

  async function applyEventLink(data) {
    if (data.eventId) {
      const title = await resolveEventName(Table, data.eventId);
      if (title) data.eventName = title;
    } else if (data.eventId === null) {
      data.eventName = data.eventName || '';
    }
    if (data.cost !== undefined) data.cost = parseCost(data.cost);
    return data;
  }

  function notifyStaySynced(hotel) {
    const id = eventIdOf(hotel);
    if (!id) return;
    notifyDataChange('travelChanged', { hotelId: hotel._id }, id.toString());
  }

  app.get('/api/hotels', authenticate, async (req, res) => {
    try {
      if (!hasPlannerAccess(req.user)) {
        return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
      }
      const query = {};
      if (req.query.status) query.status = req.query.status;
      if (req.query.eventId) query.eventId = req.query.eventId;
      const hotels = await populateHotelQuery(HotelRequest.find(query)).sort({ createdAt: -1 });
      res.json(hotels);
    } catch (error) {
      console.error('Get hotels error:', error);
      res.status(500).json({ error: 'Failed to fetch hotel requests' });
    }
  });

  app.get('/api/hotels/pending', authenticate, async (req, res) => {
    try {
      if (!hasPlannerAccess(req.user)) {
        return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
      }
      const hotels = await populateHotelQuery(
        HotelRequest.find({ status: { $in: ['pending', 'change_requested'] } })
      ).sort({ checkInDate: 1 });
      res.json(hotels);
    } catch (error) {
      console.error('Get pending hotels error:', error);
      res.status(500).json({ error: 'Failed to fetch pending hotel requests' });
    }
  });

  app.get('/api/hotels/booked', authenticate, async (req, res) => {
    try {
      const { eventId, eventName } = req.query;
      if (!eventId && !eventName && !hasPlannerAccess(req.user)) {
        return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
      }
      const query = { status: { $in: ['booked', 'cancelled'] } };
      if (eventId) query.eventId = eventId;
      else if (eventName) query.eventName = { $regex: new RegExp(`^${escapeRegex(eventName)}$`, 'i') };
      const hotels = await populateHotelQuery(HotelRequest.find(query)).sort({ checkInDate: 1 });
      res.json(hotels);
    } catch (error) {
      console.error('Get booked hotels error:', error);
      res.status(500).json({ error: 'Failed to fetch booked hotels' });
    }
  });

  app.get('/api/hotels/events/search', authenticate, async (req, res) => {
    try {
      if (!hasPlannerAccess(req.user)) {
        return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
      }
      const query = { archived: { $ne: true } };
      if (req.query.q) query.title = { $regex: req.query.q, $options: 'i' };
      const events = await Table.find(query)
        .select('title general.startDate general.endDate')
        .sort({ createdAt: -1 })
        .limit(10);
      res.json(events);
    } catch (error) {
      console.error('Search events for hotels error:', error);
      res.status(500).json({ error: 'Failed to search events' });
    }
  });

  app.get('/api/hotels/:id', authenticate, async (req, res) => {
    try {
      if (!hasPlannerAccess(req.user)) {
        return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
      }
      const hotel = await populateHotelQuery(HotelRequest.findById(req.params.id));
      if (!hotel) return res.status(404).json({ error: 'Hotel request not found' });
      res.json(hotel);
    } catch (error) {
      console.error('Get hotel error:', error);
      res.status(500).json({ error: 'Failed to fetch hotel request' });
    }
  });

  app.post('/api/hotels', authenticate, async (req, res) => {
    try {
      if (!hasPlannerAccess(req.user)) {
        return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
      }
      const hotelData = await applyEventLink({
        ...req.body,
        createdBy: req.user.id,
        status: req.body.status || 'pending'
      });
      if (!hotelData.city || !String(hotelData.city).trim()) {
        return res.status(400).json({ error: 'City is required' });
      }
      if (!hotelData.checkInDate || !hotelData.checkOutDate) {
        return res.status(400).json({ error: 'Check-in and check-out dates are required' });
      }
      if (new Date(hotelData.checkOutDate) < new Date(hotelData.checkInDate)) {
        return res.status(400).json({ error: 'Check-out must be on or after check-in' });
      }
      if (hotelData.status === 'booked' && hotelData.bookedDetails) {
        hotelData.bookedDetails.bookedBy = req.user.id;
        hotelData.bookedDetails.bookedAt = new Date();
      }
      const hotel = new HotelRequest(hotelData);
      await hotel.save();
      await hotel.populate('createdBy', 'fullName email');
      if (hotel.eventId) await hotel.populate('eventId', 'title');
      if (hotel.bookedDetails?.bookedBy) await hotel.populate('bookedDetails.bookedBy', 'fullName email');

      const eventType = hotel.status === 'booked' ? 'hotelBookingCreated' : 'hotelRequestCreated';
      notifyDataChange(eventType, { hotelId: hotel._id, status: hotel.status });
      if (hotel.status === 'booked') {
        await clearHotelRequestedBadge(Table, eventIdOf(hotel));
        notifyStaySynced(hotel);
      }

      if (hotel.status === 'pending') {
        try {
          const plannerUsers = await User.find({ role: { $in: ['planner', 'admin'] } }).select('_id');
          const plannerIds = plannerUsers.map(u => u._id.toString());
          const guestNames = (hotel.guests || []).map(g => g.name).join(', ') || 'Unknown';
          const where = [hotel.city, hotel.state].filter(Boolean).join(', ');
          await createNotificationBulk(plannerIds, {
            type: 'hotel_request',
            title: 'New Hotel Request',
            message: `${guestNames} — ${where} · ${new Date(hotel.checkInDate).toLocaleDateString()}`,
            actorId: req.user.id,
            eventId: hotel.eventId || null,
            link: { page: 'hotels', params: { hotelId: hotel._id.toString() } },
            metadata: { hotelId: hotel._id.toString(), city: where, guests: guestNames }
          });
        } catch (notifErr) {
          console.error('Failed to notify planners about new hotel request:', notifErr);
        }
      }

      res.status(201).json(hotel);
    } catch (error) {
      console.error('Create hotel error:', error);
      res.status(500).json({ error: 'Failed to create hotel request' });
    }
  });

  app.put('/api/hotels/:id', authenticate, async (req, res) => {
    try {
      if (!hasPlannerAccess(req.user)) {
        return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
      }
      const updateData = await applyEventLink({ ...req.body });
      const hotel = await populateHotelQuery(
        HotelRequest.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true })
      );
      if (!hotel) return res.status(404).json({ error: 'Hotel request not found' });
      notifyDataChange('hotelRequestUpdated', { hotelId: hotel._id });
      if (hotel.status === 'booked' || hotel.status === 'cancelled') notifyStaySynced(hotel);
      res.json(hotel);
    } catch (error) {
      console.error('Update hotel error:', error);
      res.status(500).json({ error: 'Failed to update hotel request' });
    }
  });

  app.patch('/api/hotels/:id/book', authenticate, async (req, res) => {
    try {
      if (!hasPlannerAccess(req.user)) {
        return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
      }
      const { bookedDetails, cost } = req.body;
      const updateData = {
        status: 'booked',
        bookedDetails: {
          ...bookedDetails,
          bookedAt: new Date(),
          bookedBy: req.user.id
        }
      };
      if (cost !== undefined) updateData.cost = parseCost(cost);
      const hotel = await populateHotelQuery(
        HotelRequest.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true })
      );
      if (!hotel) return res.status(404).json({ error: 'Hotel request not found' });
      notifyDataChange('hotelBooked', { hotelId: hotel._id });
      await clearHotelRequestedBadge(Table, eventIdOf(hotel));
      notifyStaySynced(hotel);

      if (hotel.createdBy && hotel.createdBy._id) {
        try {
          const guestNames = (hotel.guests || []).map(g => g.name).join(', ') || 'Unknown';
          const where = hotel.bookedDetails?.hotelName || [hotel.city, hotel.state].filter(Boolean).join(', ');
          await createNotification({
            recipientId: hotel.createdBy._id.toString(),
            type: 'hotel_booked',
            title: 'Hotel Booked',
            message: `${where} for ${guestNames}`,
            actorId: req.user.id,
            eventId: eventIdOf(hotel),
            link: { page: 'hotels', params: { hotelId: hotel._id.toString() } },
            metadata: { hotelId: hotel._id.toString(), hotelName: where, guests: guestNames }
          });
        } catch (notifErr) {
          console.error('Failed to notify requester about hotel booking:', notifErr);
        }
      }
      res.json(hotel);
    } catch (error) {
      console.error('Book hotel error:', error);
      res.status(500).json({ error: 'Failed to book hotel' });
    }
  });

  app.patch('/api/hotels/:id/cancel', authenticate, async (req, res) => {
    try {
      if (!hasPlannerAccess(req.user)) {
        return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
      }
      const hotel = await HotelRequest.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true });
      if (!hotel) return res.status(404).json({ error: 'Hotel request not found' });
      notifyDataChange('hotelRequestCancelled', { hotelId: hotel._id });
      notifyStaySynced(hotel);
      res.json(hotel);
    } catch (error) {
      console.error('Cancel hotel error:', error);
      res.status(500).json({ error: 'Failed to cancel hotel request' });
    }
  });

  app.delete('/api/hotels/:id', authenticate, async (req, res) => {
    try {
      if (!hasPlannerAccess(req.user)) {
        return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
      }
      const hotel = await HotelRequest.findByIdAndDelete(req.params.id);
      if (!hotel) return res.status(404).json({ error: 'Hotel request not found' });
      notifyDataChange('hotelRequestDeleted', { hotelId: req.params.id });
      notifyStaySynced(hotel);
      res.json({ message: 'Hotel request deleted' });
    } catch (error) {
      console.error('Delete hotel error:', error);
      res.status(500).json({ error: 'Failed to delete hotel request' });
    }
  });

  app.post('/api/hotels/:id/request-change', authenticate, async (req, res) => {
    try {
      if (!hasPlannerAccess(req.user)) {
        return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
      }
      const original = await HotelRequest.findById(req.params.id);
      if (!original) return res.status(404).json({ error: 'Hotel not found' });
      if (original.status !== 'booked') {
        return res.status(400).json({ error: 'Can only request changes for booked stays' });
      }
      const { requestedChanges, changeReason } = req.body;
      const changeRequest = new HotelRequest({
        eventId: original.eventId,
        eventName: original.eventName,
        createdBy: req.user.id,
        city: original.city,
        state: original.state,
        area: original.area,
        preferredHotel: requestedChanges?.preferredHotel || original.preferredHotel,
        checkInDate: requestedChanges?.checkInDate || original.checkInDate,
        checkOutDate: requestedChanges?.checkOutDate || original.checkOutDate,
        roomPreference: requestedChanges?.roomPreference || original.roomPreference,
        guests: original.guests,
        status: 'change_requested',
        notes: requestedChanges?.notes || original.notes,
        cost: original.cost,
        changeDetails: {
          originalHotelId: original._id,
          changeReason: changeReason || '',
          requestedBy: req.user.id,
          requestedAt: new Date(),
          requestedChanges: {
            checkInDate: requestedChanges?.checkInDate || null,
            checkOutDate: requestedChanges?.checkOutDate || null,
            roomPreference: requestedChanges?.roomPreference || null,
            preferredHotel: requestedChanges?.preferredHotel || null,
            notes: requestedChanges?.notes || null,
            cancelStay: !!requestedChanges?.cancelStay
          }
        }
      });
      await changeRequest.save();
      const populated = await populateHotelQuery(HotelRequest.findById(changeRequest._id));
      notifyDataChange('hotelChangeRequested', { hotelId: changeRequest._id, originalHotelId: original._id });
      res.status(201).json(populated);
    } catch (error) {
      console.error('Request hotel change error:', error);
      res.status(500).json({ error: 'Failed to create change request' });
    }
  });

  app.patch('/api/hotels/:id/approve-change', authenticate, async (req, res) => {
    try {
      if (!hasPlannerAccess(req.user)) {
        return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
      }
      const changeRequest = await HotelRequest.findById(req.params.id);
      if (!changeRequest) return res.status(404).json({ error: 'Change request not found' });
      if (changeRequest.status !== 'change_requested') {
        return res.status(400).json({ error: 'This is not a change request' });
      }
      const originalId = changeRequest.changeDetails?.originalHotelId;
      if (!originalId) return res.status(400).json({ error: 'No original stay linked to this change request' });

      const cancelStay = !!(req.body.cancelStay || changeRequest.changeDetails?.requestedChanges?.cancelStay);
      if (cancelStay) {
        const cancelled = await HotelRequest.findByIdAndUpdate(originalId, { status: 'cancelled' }, { new: true });
        await HotelRequest.findByIdAndDelete(req.params.id);
        if (cancelled) notifyStaySynced(cancelled);
        notifyDataChange('hotelChangeApproved', { hotelId: originalId, changeRequestId: req.params.id, cancelled: true });
        return res.json(cancelled);
      }

      const updateData = {
        checkInDate: changeRequest.checkInDate,
        checkOutDate: changeRequest.checkOutDate,
        roomPreference: changeRequest.roomPreference,
        preferredHotel: changeRequest.preferredHotel,
        notes: changeRequest.notes
      };
      if (req.body.cost !== undefined) updateData.cost = parseCost(req.body.cost);

      if (req.body.updatedBookedDetails) {
        const orig = await HotelRequest.findById(originalId);
        const existing = orig?.bookedDetails?.toObject?.() || orig?.bookedDetails || {};
        const next = req.body.updatedBookedDetails;
        updateData.bookedDetails = {
          ...existing,
          ...(next.hotelName ? { hotelName: next.hotelName } : {}),
          ...(next.confirmationCode ? { confirmationCode: next.confirmationCode } : {}),
          ...(next.address ? { address: next.address } : {}),
          ...(next.roomType ? { roomType: next.roomType } : {}),
          ...(next.checkInTime ? { checkInTime: next.checkInTime } : {}),
          ...(next.checkOutTime ? { checkOutTime: next.checkOutTime } : {}),
          ...(next.numberOfRooms != null && next.numberOfRooms !== '' ? { numberOfRooms: Number(next.numberOfRooms) || 1 } : {}),
          bookedAt: new Date(),
          bookedBy: req.user.id
        };
      }

      const updated = await populateHotelQuery(
        HotelRequest.findByIdAndUpdate(originalId, updateData, { new: true, runValidators: true })
      );
      if (!updated) return res.status(404).json({ error: 'Original booked stay not found' });
      await HotelRequest.findByIdAndDelete(req.params.id);
      notifyDataChange('hotelChangeApproved', { hotelId: originalId, changeRequestId: req.params.id });
      notifyStaySynced(updated);
      res.json(updated);
    } catch (error) {
      console.error('Approve hotel change error:', error);
      res.status(500).json({ error: 'Failed to approve change request' });
    }
  });

  app.patch('/api/hotels/:id/reject-change', authenticate, async (req, res) => {
    try {
      if (!hasPlannerAccess(req.user)) {
        return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
      }
      const changeRequest = await HotelRequest.findById(req.params.id);
      if (!changeRequest) return res.status(404).json({ error: 'Change request not found' });
      if (changeRequest.status !== 'change_requested') {
        return res.status(400).json({ error: 'This is not a change request' });
      }
      await HotelRequest.findByIdAndDelete(req.params.id);
      notifyDataChange('hotelChangeRejected', { changeRequestId: req.params.id });
      res.json({ message: 'Change request rejected and removed' });
    } catch (error) {
      console.error('Reject hotel change error:', error);
      res.status(500).json({ error: 'Failed to reject change request' });
    }
  });
}

async function syncHotelEventNames(eventId, title) {
  return HotelRequest.updateMany({ eventId }, { $set: { eventName: title } });
}

async function countPendingHotelsSince(visitedAt) {
  const query = { status: { $in: ['pending', 'change_requested'] } };
  if (visitedAt) query.updatedAt = { $gt: visitedAt };
  return HotelRequest.countDocuments(query);
}

module.exports = {
  registerHotelRoutes,
  getHotelManagementAccommodationRows,
  buildHotelExpenseRows,
  syncHotelEventNames,
  countPendingHotelsSince
};

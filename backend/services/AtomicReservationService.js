const mongoose = require('mongoose');
const GearInventory = require('../models/GearInventory');
const ReservedGearItem = require('../models/ReservedGearItem');
const ManualReservation = require('../models/ManualReservation');

class AtomicReservationService {
  
  /**
   * BULLETPROOF ATOMIC RESERVATION
   * Creates reservation with:
   * - Pessimistic locking to prevent race conditions
   * - Atomic transaction (all-or-nothing)
   * - Dual collection consistency (ReservedGearItem + GearInventory cache)
   * - Comprehensive validation
   * - Automatic rollback on any failure
   */
  static async createReservation({
    inventoryId,
    eventId,
    userId,
    quantity,
    checkOutDate,
    checkInDate,
    listName,
    serial = null,
    specificSerialRequested = false
  }) {
    
    // Input validation
    if (!inventoryId || !eventId || !userId || !quantity || !checkOutDate || !checkInDate || !listName) {
      throw new Error('Missing required reservation parameters');
    }
    
    if (quantity <= 0) {
      throw new Error('Quantity must be greater than 0');
    }
    
    const session = await mongoose.startSession();
    let reservedItem = null;
    
    try {
      await session.withTransaction(async () => {
        
        // STEP 1: PESSIMISTIC LOCK - Find and lock inventory item
        const inventoryItem = await GearInventory.findById(inventoryId)
          .session(session);
          // Note: MongoDB transactions provide document-level locking
        
        if (!inventoryItem) {
          throw new Error(`Inventory item not found: ${inventoryId}`);
        }
        
        console.log(`[ATOMIC RESERVE] Locking inventory item: ${inventoryItem.label}`);
        
        // STEP 2: AVAILABILITY CHECK using NEW single source of truth
        const availableQty = await ReservedGearItem.getAvailableQuantity(
          inventoryId, 
          checkOutDate, 
          checkInDate
          // Don't exclude current event - we want to see ALL existing reservations
        );
        
        console.log(`[ATOMIC RESERVE] Available quantity: ${availableQty}, Requested: ${quantity}`);
        
        if (quantity > availableQty) {
          throw new Error(`Insufficient availability. Available: ${availableQty}, Requested: ${quantity}`);
        }
        
        // STEP 3: CREATE PRIMARY RESERVATION (Single Source of Truth)
        const labelParts = inventoryItem.label.split(' ');
        reservedItem = new ReservedGearItem({
          eventId,
          userId,
          listName,
          inventoryId: inventoryItem._id,
          brand: labelParts[0] || 'Unknown',
          model: labelParts.slice(1).join(' ') || 'Unknown',
          category: inventoryItem.category,
          quantity,
          serial: serial || inventoryItem.serial,
          specificSerialRequested,
          checkOutDate,  // NEW - Critical for availability calculations
          checkInDate,   // NEW - Critical for availability calculations
          isPacked: false
        });
        
        await reservedItem.save({ session });
        console.log(`[ATOMIC RESERVE] Created primary reservation: ${reservedItem._id}`);
        
        // STEP 4: UPDATE CACHE (Keep GearInventory.reservations for performance)
        inventoryItem.reservations.push({
          eventId,
          userId,
          quantity,
          checkOutDate,
          checkInDate,
          createdAt: new Date()
        });
        
        await inventoryItem.save({ session });
        console.log(`[ATOMIC RESERVE] Updated availability cache`);
        
        console.log(`[ATOMIC RESERVE] ✅ Successfully reserved ${quantity}x ${inventoryItem.label} for event ${eventId}`);
      });
      
      return reservedItem;
      
    } catch (error) {
      console.error(`[ATOMIC RESERVE] ❌ Transaction failed:`, error.message);
      throw error;
    } finally {
      await session.endSession();
    }
  }
  
  /**
   * BULLETPROOF ATOMIC RELEASE
   * Releases reservation with complete cleanup
   */
  static async releaseReservation(reservedItemId) {
    const session = await mongoose.startSession();
    
    try {
      await session.withTransaction(async () => {
        
        // STEP 1: Find and lock the reservation
        const reservedItem = await ReservedGearItem.findById(reservedItemId)
          .session(session);
          
        if (!reservedItem) {
          throw new Error(`Reserved item not found: ${reservedItemId}`);
        }
        
        console.log(`[ATOMIC RELEASE] Releasing: ${reservedItem.quantity}x ${reservedItem.brand} ${reservedItem.model}`);
        
        // STEP 2: Update availability cache in GearInventory
        const inventoryItem = await GearInventory.findById(reservedItem.inventoryId)
          .session(session);
          
        if (inventoryItem) {
          inventoryItem.releaseQuantity(
            reservedItem.eventId,
            reservedItem.userId,
            reservedItem.quantity
          );
          await inventoryItem.save({ session });
          console.log(`[ATOMIC RELEASE] Updated availability cache`);
        }
        
        // STEP 3: Delete primary reservation
        await ReservedGearItem.findByIdAndDelete(reservedItemId, { session });
        console.log(`[ATOMIC RELEASE] Deleted primary reservation`);
        
        console.log(`[ATOMIC RELEASE] ✅ Successfully released reservation ${reservedItemId}`);
      });
      
    } catch (error) {
      console.error(`[ATOMIC RELEASE] ❌ Transaction failed:`, error.message);
      throw error;
    } finally {
      await session.endSession();
    }
  }
  
  /**
   * BULLETPROOF BULK RESERVATION
   * Reserves multiple items atomically (all succeed or all fail)
   */
  static async createBulkReservations(reservations) {
    const session = await mongoose.startSession();
    const createdReservations = [];
    
    try {
      await session.withTransaction(async () => {
        
        console.log(`[BULK RESERVE] Processing ${reservations.length} reservations atomically`);
        
        for (const reservationData of reservations) {
          // Use individual atomic reservation logic
          const reservedItem = await this._createSingleReservation(reservationData, session);
          createdReservations.push(reservedItem);
        }
        
        console.log(`[BULK RESERVE] ✅ Successfully created ${createdReservations.length} reservations`);
      });
      
      return createdReservations;
      
    } catch (error) {
      console.error(`[BULK RESERVE] ❌ Transaction failed, rolling back all reservations:`, error.message);
      throw error;
    } finally {
      await session.endSession();
    }
  }
  
  /**
   * HELPER: Single reservation within existing transaction
   */
  static async _createSingleReservation(reservationData, session) {
    const { 
      inventoryId, eventId, userId, quantity, checkOutDate, checkInDate, 
      listName, serial, specificSerialRequested 
    } = reservationData;
    
    // Lock inventory item
    const inventoryItem = await GearInventory.findById(inventoryId)
      .session(session);
      
    if (!inventoryItem) {
      throw new Error(`Inventory item not found: ${inventoryId}`);
    }
    
    // Check availability
    const availableQty = await ReservedGearItem.getAvailableQuantity(
      inventoryId, checkOutDate, checkInDate  // Don't exclude current event
    );
    
    if (quantity > availableQty) {
      throw new Error(`${inventoryItem.label}: Insufficient availability. Available: ${availableQty}, Requested: ${quantity}`);
    }
    
    // Create primary reservation
    const labelParts = inventoryItem.label.split(' ');
    const reservedItem = new ReservedGearItem({
      eventId, userId, listName,
      inventoryId: inventoryItem._id,
      brand: labelParts[0] || 'Unknown',
      model: labelParts.slice(1).join(' ') || 'Unknown',
      category: inventoryItem.category,
      quantity,
      serial: serial || inventoryItem.serial,
      specificSerialRequested: specificSerialRequested || false,
      checkOutDate, checkInDate,
      isPacked: false
    });
    
    await reservedItem.save({ session });
    
    // Update cache
    inventoryItem.reservations.push({
      eventId, userId, quantity, checkOutDate, checkInDate,
      createdAt: new Date()
    });
    
    await inventoryItem.save({ session });
    
    return reservedItem;
  }
  
  /**
   * CLEANUP: Remove all reservations for an event
   * Used when events are deleted
   */
  static async cleanupEventReservations(eventId) {
    const session = await mongoose.startSession();
    
    try {
      await session.withTransaction(async () => {
        
        console.log(`[CLEANUP] Removing all reservations for event: ${eventId}`);
        
        // Find all reservations for this event
        const reservations = await ReservedGearItem.find({ eventId }).session(session);
        
        console.log(`[CLEANUP] Found ${reservations.length} reservations to clean up`);
        
        // Group by inventory item for efficient cache updates
        const inventoryUpdates = new Map();
        
        for (const reservation of reservations) {
          if (!inventoryUpdates.has(reservation.inventoryId.toString())) {
            inventoryUpdates.set(reservation.inventoryId.toString(), []);
          }
          inventoryUpdates.get(reservation.inventoryId.toString()).push(reservation);
        }
        
        // Update each inventory item's cache
        for (const [inventoryId, reservationsToRemove] of inventoryUpdates) {
          const inventoryItem = await GearInventory.findById(inventoryId).session(session);
          
          if (inventoryItem) {
            // Remove all reservations for this event
            inventoryItem.reservations = inventoryItem.reservations.filter(
              res => res.eventId.toString() !== eventId.toString()
            );
            
            await inventoryItem.save({ session });
            console.log(`[CLEANUP] Updated cache for ${inventoryItem.label}: removed ${reservationsToRemove.length} reservations`);
          }
        }
        
        // Delete all ReservedGearItem records for this event
        const deleteResult = await ReservedGearItem.deleteMany({ eventId }, { session });
        
        console.log(`[CLEANUP] ✅ Deleted ${deleteResult.deletedCount} primary reservations for event ${eventId}`);
      });
      
    } catch (error) {
      console.error(`[CLEANUP] ❌ Failed to cleanup event reservations:`, error.message);
      throw error;
    } finally {
      await session.endSession();
    }
  }
  
  /**
   * GET AVAILABILITY: Single source of truth
   */
  static async getAvailableQuantity(inventoryId, checkOutDate, checkInDate, excludeEventId = null) {
    return await ReservedGearItem.getAvailableQuantity(inventoryId, checkOutDate, checkInDate, excludeEventId);
  }

  /**
   * GET AVAILABILITY (BULK): Compute available quantity for MANY inventory items
   * at once using only TWO database queries instead of 3 queries per item.
   *
   * This is purely a read-side performance optimization. It uses the exact same
   * date-overlap logic as ReservedGearItem.getAvailableQuantity so the numbers are
   * identical to the per-item path. It does NOT create reservations and therefore
   * cannot affect integrity — the atomic createReservation/createBulkReservations
   * transactions remain the only place that commits a reservation, and they
   * re-validate availability inside the transaction.
   *
   * @param {Array} inventoryItems - Already-fetched GearInventory documents (need _id + quantity)
   * @param {Date|string} checkOutDate
   * @param {Date|string} checkInDate
   * @param {string|ObjectId|null} excludeEventId - Optional event to exclude (for updates)
   * @returns {Map<string, number>} Map of inventoryId (string) -> available quantity
   */
  static async getAvailableQuantitiesBulk(inventoryItems, checkOutDate, checkInDate, excludeEventId = null) {
    const result = new Map();
    if (!inventoryItems || inventoryItems.length === 0) {
      return result;
    }

    const normalizeDate = (dateStr) => {
      const date = new Date(dateStr);
      date.setUTCHours(0, 0, 0, 0);
      return date;
    };

    const reqStart = normalizeDate(checkOutDate);
    const reqEnd = normalizeDate(checkInDate);
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);

    const inventoryIds = inventoryItems.map(item => item._id);

    // Base overlap conditions, identical to getAvailableQuantity():
    //   reservation overlaps [reqStart, reqEnd] AND has not already expired
    const reservedQuery = {
      inventoryId: { $in: inventoryIds },
      $and: [
        { checkOutDate: { $lte: reqEnd } },
        { checkInDate: { $gte: reqStart } },
        { checkInDate: { $gte: now } }
      ]
    };
    if (excludeEventId) {
      reservedQuery.eventId = { $ne: excludeEventId };
    }

    const manualQuery = {
      inventoryId: { $in: inventoryIds },
      $and: [
        { startDate: { $lte: reqEnd } },
        { endDate: { $gte: reqStart } },
        { endDate: { $gte: now } }
      ]
    };

    // TWO queries total (instead of 3 per item)
    const [overlappingReservations, manualReservations] = await Promise.all([
      ReservedGearItem.find(reservedQuery).select('inventoryId quantity').lean(),
      ManualReservation.find(manualQuery).select('inventoryId quantity').lean()
    ]);

    // Aggregate reserved quantity per inventory item
    const reservedById = new Map();
    for (const res of overlappingReservations) {
      const id = res.inventoryId.toString();
      reservedById.set(id, (reservedById.get(id) || 0) + res.quantity);
    }
    for (const res of manualReservations) {
      const id = res.inventoryId.toString();
      reservedById.set(id, (reservedById.get(id) || 0) + res.quantity);
    }

    for (const item of inventoryItems) {
      const id = item._id.toString();
      const reserved = reservedById.get(id) || 0;
      result.set(id, Math.max(0, item.quantity - reserved));
    }

    return result;
  }
}

module.exports = AtomicReservationService; 
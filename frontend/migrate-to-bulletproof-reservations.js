const mongoose = require('mongoose');
require('dotenv').config(); // Load environment variables

// Import migration functions
const fixCartDates = require('./fix-cart-dates');
const fixGearReservationDates = require('./fix-gear-reservation-dates');
const migrateReservationDates = require('./migrate-reservation-dates');

async function migrateToBulletproofReservations() {
  try {
    console.log('🚀 MIGRATING TO BULLETPROOF RESERVATION SYSTEM\n');
    console.log('This migration will:');
    console.log('1. Fix cart dates to match event dates');
    console.log('2. Fix gear reservation dates in GearInventory.reservations');
    console.log('3. Add checkOutDate/checkInDate to ReservedGearItem records');
    console.log('4. Verify system integrity\n');
    
    // Connect to database once for all operations
    console.log('📡 Connecting to database...');
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/lumDash');
    console.log('✅ Connected to database\n');
    
    // STEP 1: Fix cart dates (using existing connection)
    console.log('📅 STEP 1: Fixing cart dates...');
    await fixCartDatesWithExistingConnection();
    console.log('✅ Cart dates migration completed\n');
    
    // STEP 2: Fix gear reservation dates (using existing connection)
    console.log('🎬 STEP 2: Fixing gear reservation dates...');
    await fixGearReservationDatesWithExistingConnection();
    console.log('✅ Gear reservation dates migration completed\n');
    
    // STEP 3: Migrate ReservedGearItem dates (using existing connection)
    console.log('📋 STEP 3: Migrating ReservedGearItem dates...');
    await migrateReservationDatesWithExistingConnection();
    console.log('✅ ReservedGearItem dates migration completed\n');
    
    // STEP 4: Verify system integrity (using existing connection)
    console.log('🔍 STEP 4: Verifying system integrity...');
    await verifySystemIntegrity();
    console.log('✅ System integrity verification completed\n');
    
    console.log('🎉 MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('\n📋 NEXT STEPS:');
    console.log('1. Restart your backend server to load the new AtomicReservationService');
    console.log('2. Test reservations to ensure they work correctly');
    console.log('3. Monitor logs for atomic reservation messages: [ATOMIC RESERVE], [ATOMIC RELEASE]');
    console.log('4. The system now uses ReservedGearItem as the single source of truth for availability');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n📡 Disconnected from database');
  }
}

// Helper functions that use existing database connection
async function fixCartDatesWithExistingConnection() {
  const Table = require('./models/Table');
  const Cart = require('./models/Cart');
  
  console.log('🔧 FIXING CART DATES BASED ON EVENT DATES\n');
  
  // Get all carts
  const carts = await Cart.find({}).populate('eventId', 'title gear');
  
  console.log(`Found ${carts.length} carts to check\n`);
  
  let fixedCount = 0;
  let errorCount = 0;
  
  for (const cart of carts) {
    try {
      const event = cart.eventId;
      
      if (!event) {
        console.log(`❌ Cart ${cart._id}: Event not found`);
        errorCount++;
        continue;
      }
      
      if (!event.gear?.checkOutDate || !event.gear?.checkInDate) {
        console.log(`⚠️  Cart ${cart._id} (Event: ${event.title}): Event has no gear dates set`);
        continue;
      }
      
      // Check if cart dates match event dates
      const cartCheckOut = cart.checkOutDate?.toISOString?.() || cart.checkOutDate;
      const cartCheckIn = cart.checkInDate?.toISOString?.() || cart.checkInDate;
      const eventCheckOut = new Date(event.gear.checkOutDate).toISOString();
      const eventCheckIn = new Date(event.gear.checkInDate).toISOString();
      
      if (cartCheckOut !== eventCheckOut || cartCheckIn !== eventCheckIn) {
        console.log(`🔄 Updating Cart ${cart._id} (Event: ${event.title}):`);
        console.log(`   OLD: ${cartCheckOut} to ${cartCheckIn}`);
        console.log(`   NEW: ${eventCheckOut} to ${eventCheckIn}`);
        
        // Update cart dates
        cart.checkOutDate = event.gear.checkOutDate;
        cart.checkInDate = event.gear.checkInDate;
        await cart.save();
        
        fixedCount++;
      } else {
        console.log(`✅ Cart ${cart._id} (Event: ${event.title}): Dates already correct`);
      }
      
    } catch (err) {
      console.log(`❌ Error processing cart ${cart._id}:`, err.message);
      errorCount++;
    }
  }
  
  console.log(`\n📊 SUMMARY:`);
  console.log(`   ✅ Fixed: ${fixedCount} carts`);
  console.log(`   ❌ Errors: ${errorCount} carts`);
  console.log(`   📝 Total checked: ${carts.length} carts`);
}

async function fixGearReservationDatesWithExistingConnection() {
  const Table = require('./models/Table');
  const GearInventory = require('./models/GearInventory');
  
  console.log('🔧 FIXING GEAR RESERVATION DATES BASED ON EVENT DATES\n');
  
  // Get all gear items with reservations
  const gearItems = await GearInventory.find({
    'reservations.0': { $exists: true }
  });
  
  console.log(`Found ${gearItems.length} gear items with reservations to check\n`);
  
  let fixedReservations = 0;
  let totalReservations = 0;
  let errorCount = 0;
  
  for (const gearItem of gearItems) {
    try {
      let itemChanged = false;
      
      console.log(`\n📦 Checking ${gearItem.label} (${gearItem._id}):`);
      
      for (let i = 0; i < gearItem.reservations.length; i++) {
        const reservation = gearItem.reservations[i];
        totalReservations++;
        
        // Get the event for this reservation
        const event = await Table.findById(reservation.eventId);
        
        if (!event) {
          console.log(`   ❌ Reservation ${i}: Event ${reservation.eventId} not found`);
          errorCount++;
          continue;
        }
        
        if (!event.gear?.checkOutDate || !event.gear?.checkInDate) {
          console.log(`   ⚠️  Reservation ${i} (Event: ${event.title}): Event has no gear dates set`);
          continue;
        }
        
        // Check if reservation dates match event dates
        const resCheckOut = reservation.checkOutDate?.toISOString?.() || reservation.checkOutDate;
        const resCheckIn = reservation.checkInDate?.toISOString?.() || reservation.checkInDate;
        const eventCheckOut = new Date(event.gear.checkOutDate).toISOString();
        const eventCheckIn = new Date(event.gear.checkInDate).toISOString();
        
        if (resCheckOut !== eventCheckOut || resCheckIn !== eventCheckIn) {
          console.log(`   🔄 Fixing Reservation ${i} (Event: ${event.title}):`);
          console.log(`      OLD: ${resCheckOut} to ${resCheckIn}`);
          console.log(`      NEW: ${eventCheckOut} to ${eventCheckIn}`);
          
          // Update reservation dates
          gearItem.reservations[i].checkOutDate = event.gear.checkOutDate;
          gearItem.reservations[i].checkInDate = event.gear.checkInDate;
          
          itemChanged = true;
          fixedReservations++;
        } else {
          console.log(`   ✅ Reservation ${i} (Event: ${event.title}): Dates already correct`);
        }
      }
      
      // Save if any reservations were changed
      if (itemChanged) {
        await gearItem.save();
        console.log(`   💾 Saved changes to ${gearItem.label}`);
      }
      
    } catch (err) {
      console.log(`❌ Error processing gear item ${gearItem._id}:`, err.message);
      errorCount++;
    }
  }
  
  console.log(`\n📊 SUMMARY:`);
  console.log(`   ✅ Fixed: ${fixedReservations} reservations`);
  console.log(`   ❌ Errors: ${errorCount} issues`);
  console.log(`   📝 Total reservations checked: ${totalReservations}`);
  console.log(`   📦 Gear items processed: ${gearItems.length}`);
}

async function migrateReservationDatesWithExistingConnection() {
  const ReservedGearItem = require('./models/ReservedGearItem');
  const Table = require('./models/Table');
  
  console.log('🔄 MIGRATING RESERVATION DATES\n');
  console.log('Adding checkOutDate and checkInDate to existing ReservedGearItem records...\n');
  
  // Find all ReservedGearItem records without dates
  const reservationsWithoutDates = await ReservedGearItem.find({
    $or: [
      { checkOutDate: { $exists: false } },
      { checkInDate: { $exists: false } },
      { checkOutDate: null },
      { checkInDate: null }
    ]
  }).populate('eventId', 'title gear');
  
  console.log(`Found ${reservationsWithoutDates.length} reservations needing date migration\n`);
  
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  
  for (const reservation of reservationsWithoutDates) {
    try {
      const event = reservation.eventId;
      
      if (!event) {
        console.log(`❌ Reservation ${reservation._id}: Event not found`);
        errorCount++;
        continue;
      }
      
      if (!event.gear?.checkOutDate || !event.gear?.checkInDate) {
        console.log(`⚠️  Reservation ${reservation._id} (Event: ${event.title}): Event has no gear dates - SKIPPING`);
        skippedCount++;
        continue;
      }
      
      // Update the reservation with event dates
      console.log(`🔄 Updating Reservation ${reservation._id} (Event: ${event.title}):`);
      console.log(`   Brand/Model: ${reservation.brand} ${reservation.model}`);
      console.log(`   Setting dates: ${event.gear.checkOutDate} to ${event.gear.checkInDate}`);
      
      reservation.checkOutDate = event.gear.checkOutDate;
      reservation.checkInDate = event.gear.checkInDate;
      await reservation.save();
      
      successCount++;
      console.log(`   ✅ Updated successfully\n`);
      
    } catch (err) {
      console.log(`❌ Error updating reservation ${reservation._id}:`, err.message);
      errorCount++;
    }
  }
  
  console.log(`\n📊 MIGRATION SUMMARY:`);
  console.log(`   ✅ Successfully updated: ${successCount} reservations`);
  console.log(`   ⚠️  Skipped (no event dates): ${skippedCount} reservations`);
  console.log(`   ❌ Errors: ${errorCount} reservations`);
  console.log(`   📝 Total processed: ${reservationsWithoutDates.length} reservations`);
  
  if (skippedCount > 0) {
    console.log(`\n⚠️  WARNING: ${skippedCount} reservations were skipped because their events don't have gear dates set.`);
    console.log(`   These events need to have checkOutDate and checkInDate set in their gear section.`);
    console.log(`   After setting the dates, run this migration again.`);
  }
  
  if (successCount > 0) {
    console.log(`\n🎉 Migration completed! The reservation system now has complete date information.`);
  }
}

async function verifySystemIntegrity() {
  const ReservedGearItem = require('./models/ReservedGearItem');
  const Table = require('./models/Table');
  const GearInventory = require('./models/GearInventory');
  
  // Check 1: Verify all ReservedGearItem records have dates
  const reservationsWithoutDates = await ReservedGearItem.countDocuments({
    $or: [
      { checkOutDate: { $exists: false } },
      { checkInDate: { $exists: false } },
      { checkOutDate: null },
      { checkInDate: null }
    ]
  });
  
  console.log(`   📋 ReservedGearItem records without dates: ${reservationsWithoutDates}`);
  
  // Check 2: Verify events have gear dates
  const eventsWithoutDates = await Table.countDocuments({
    $or: [
      { 'gear.checkOutDate': { $exists: false } },
      { 'gear.checkInDate': { $exists: false } },
      { 'gear.checkOutDate': null },
      { 'gear.checkInDate': null }
    ]
  });
  
  console.log(`   📅 Events without gear dates: ${eventsWithoutDates}`);
  
  // Check 3: Count total reservations in system
  const totalReservations = await ReservedGearItem.countDocuments({});
  console.log(`   📊 Total active reservations: ${totalReservations}`);
  
  // Check 4: Count gear items
  const totalGearItems = await GearInventory.countDocuments({});
  console.log(`   🎬 Total gear inventory items: ${totalGearItems}`);
  
  // Check 5: Verify availability calculation works
  if (totalGearItems > 0 && totalReservations > 0) {
    const sampleGear = await GearInventory.findOne({});
    const sampleEvent = await Table.findOne({ 'gear.checkOutDate': { $exists: true } });
    
    if (sampleGear && sampleEvent && sampleEvent.gear?.checkOutDate && sampleEvent.gear?.checkInDate) {
      try {
        const availableQty = await ReservedGearItem.getAvailableQuantity(
          sampleGear._id,
          sampleEvent.gear.checkOutDate,
          sampleEvent.gear.checkInDate
        );
        console.log(`   🧪 Sample availability calculation: ${sampleGear.label} = ${availableQty}/${sampleGear.quantity} available`);
      } catch (err) {
        console.log(`   ⚠️  Sample availability calculation failed: ${err.message}`);
      }
    }
  }
  
  // Summary
  if (reservationsWithoutDates === 0 && eventsWithoutDates === 0) {
    console.log('   ✅ System integrity: EXCELLENT - All data properly migrated');
  } else if (reservationsWithoutDates === 0) {
    console.log('   ⚠️  System integrity: GOOD - Reservations migrated, but some events need dates set');
  } else {
    console.log('   ❌ System integrity: NEEDS ATTENTION - Some reservations missing dates');
  }
}

// Run if called directly
if (require.main === module) {
  migrateToBulletproofReservations();
}

module.exports = migrateToBulletproofReservations; 
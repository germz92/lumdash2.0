const mongoose = require('mongoose');
require('dotenv').config(); // Load environment variables
const ReservedGearItem = require('./models/ReservedGearItem');
const Table = require('./models/Table');

async function migrateReservationDates() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/lumDash');
    
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
    
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await mongoose.disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  migrateReservationDates();
}

module.exports = migrateReservationDates; 
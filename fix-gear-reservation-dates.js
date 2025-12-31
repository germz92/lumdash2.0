const mongoose = require('mongoose');
require('dotenv').config(); // Load environment variables
const Table = require('./models/Table');
const GearInventory = require('./models/GearInventory');

async function fixGearReservationDates() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/lumDash');
    
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
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  fixGearReservationDates();
}

module.exports = fixGearReservationDates; 
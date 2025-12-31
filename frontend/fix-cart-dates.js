const mongoose = require('mongoose');
require('dotenv').config(); // Load environment variables
const Table = require('./models/Table');
const Cart = require('./models/Cart');

async function fixCartDates() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/lumDash');
    
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
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  fixCartDates();
}

module.exports = fixCartDates; 
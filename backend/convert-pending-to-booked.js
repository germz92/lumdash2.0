/**
 * Script to convert pending flights (that have booking details) to booked status
 * Run this once to fix the flights that were accidentally created as pending
 */

require('dotenv').config();
const mongoose = require('mongoose');
const FlightRequest = require('./models/FlightRequest');

async function convertPendingToBooked() {
  try {
    // Connect to database
    const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
    
    if (!MONGO_URI) {
      console.error('❌ Error: MONGO_URI environment variable is not set.');
      console.log('Please make sure you have a .env file with MONGO_URI configured.');
      process.exit(1);
    }
    
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    // Find pending flights that have bookedDetails (these were meant to be direct bookings)
    const pendingWithBookingDetails = await FlightRequest.find({
      status: 'pending',
      'bookedDetails.confirmationCode': { $exists: true, $ne: '' }
    });

    console.log(`\nFound ${pendingWithBookingDetails.length} pending flights with booking details:\n`);

    if (pendingWithBookingDetails.length === 0) {
      console.log('No pending flights with booking details found. Nothing to convert.');
      await mongoose.connection.close();
      return;
    }

    // Display the flights that will be converted
    pendingWithBookingDetails.forEach((flight, index) => {
      console.log(`${index + 1}. ${flight.eventName || 'Flight'}`);
      console.log(`   From: ${flight.from?.code} → To: ${flight.to?.code}`);
      console.log(`   Depart: ${flight.departDate}`);
      console.log(`   Confirmation: ${flight.bookedDetails?.confirmationCode}`);
      console.log(`   ID: ${flight._id}\n`);
    });

    // Ask for confirmation (you can comment this out if running non-interactively)
    console.log('These flights will be converted from PENDING to BOOKED status.');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to proceed...\n');
    
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Convert each flight
    let converted = 0;
    for (const flight of pendingWithBookingDetails) {
      // Update status to booked
      flight.status = 'booked';
      
      // Add bookedAt timestamp if not present
      if (flight.bookedDetails && !flight.bookedDetails.bookedAt) {
        flight.bookedDetails.bookedAt = new Date();
      }
      
      // Add bookedAt to return flight if exists
      if (flight.returnBookedDetails && !flight.returnBookedDetails.bookedAt) {
        flight.returnBookedDetails.bookedAt = new Date();
      }
      
      await flight.save();
      converted++;
      console.log(`✅ Converted: ${flight.eventName || 'Flight'} (${flight._id})`);
    }

    console.log(`\n🎉 Successfully converted ${converted} flight(s) to booked status!`);
    console.log('These flights should now appear in the Booked Flights section.\n');

    await mongoose.connection.close();
    console.log('Database connection closed.');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run the conversion
convertPendingToBooked();

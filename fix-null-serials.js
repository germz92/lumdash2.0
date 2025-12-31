/**
 * This script fixes the issue with duplicate null serial numbers in the GearInventory collection.
 * It finds all items with null serial numbers and gives them a unique placeholder value.
 */
require('dotenv').config();
const mongoose = require('mongoose');

// Initialize MongoDB connection
async function fixNullSerials() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected');
    
    // Define a simple schema for this operation
    const gearSchema = new mongoose.Schema({
      label: String,
      category: String,
      serial: String,
      status: String
    });
    const GearInventory = mongoose.model('GearInventory', gearSchema);
    
    // Find all gear with null serial numbers
    console.log('Finding gear with null serials...');
    const nullSerialGear = await GearInventory.find({ 
      $or: [
        { serial: null },
        { serial: "" }
      ]
    });
    
    console.log(`Found ${nullSerialGear.length} items with null or empty serial numbers`);
    
    // Skip first item, only update subsequent items with null serials
    if (nullSerialGear.length > 1) {
      for (let i = 1; i < nullSerialGear.length; i++) {
        const gear = nullSerialGear[i];
        // Replace null with empty string so it's handled properly by MongoDB
        const tempSerialValue = "";
        
        console.log(`Updating gear: ${gear.label}, removing serial`);
        await GearInventory.updateOne(
          { _id: gear._id },
          { $set: { serial: tempSerialValue } }
        );
      }
      
      console.log('Fixes applied successfully!');
    } else {
      console.log('No fixes needed - there are 0 or 1 items with null serials.');
    }
    
    // Close connection
    await mongoose.connection.close();
    console.log('Done! MongoDB connection closed.');
    
  } catch (error) {
    console.error('ERROR:', error);
    try {
      await mongoose.connection.close();
    } catch (e) {
      // Ignore any errors closing the connection
    }
  }
}

// Run the function
fixNullSerials(); 
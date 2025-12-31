const mongoose = require('mongoose');
require('dotenv').config();

async function removeSerialIndex() {
  try {
    // Connect to MongoDB using the same connection string as your app
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/test';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');
    
    // Get the database and collection
    const db = mongoose.connection.db;
    const collection = db.collection('gearinventories');
    
    // List current indexes
    console.log('Current indexes:');
    const indexes = await collection.indexes();
    indexes.forEach(index => {
      console.log(`- ${index.name}: ${JSON.stringify(index.key)}`);
    });
    
    // Drop the serial index
    try {
      await collection.dropIndex('serial_1');
      console.log('\n✅ Successfully removed serial_1 index');
    } catch (error) {
      if (error.code === 27) {
        console.log('\n✅ Serial index does not exist (already removed)');
      } else {
        throw error;
      }
    }
    
    // Verify the index was removed
    console.log('\nRemaining indexes:');
    const remainingIndexes = await collection.indexes();
    remainingIndexes.forEach(index => {
      console.log(`- ${index.name}: ${JSON.stringify(index.key)}`);
    });
    
    console.log('\n✅ Done! You can now add multiple items with N/A serial numbers.');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
  }
}

removeSerialIndex(); 
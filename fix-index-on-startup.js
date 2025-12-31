/**
 * Function to remove the serial number unique index that's causing duplicate key errors
 * This should be called once during server startup after MongoDB connection is established
 */

async function fixSerialIndex(mongoose) {
  try {
    console.log('🔧 Checking for problematic serial index...');
    
    const db = mongoose.connection.db;
    const collection = db.collection('gearinventories');
    
    // Check if the problematic index exists
    const indexes = await collection.indexes();
    const serialIndex = indexes.find(idx => idx.name === 'serial_1' && idx.unique);
    
    if (serialIndex) {
      console.log('⚠️  Found unique serial index that needs to be removed...');
      await collection.dropIndex('serial_1');
      console.log('✅ Successfully removed serial_1 unique index');
      console.log('✅ Multiple items with N/A serial numbers are now allowed');
    } else {
      console.log('✅ No problematic serial index found - system ready');
    }
    
  } catch (error) {
    if (error.code === 27) {
      console.log('✅ Serial index does not exist - system ready');
    } else {
      console.error('❌ Error fixing serial index:', error.message);
    }
  }
}

module.exports = { fixSerialIndex }; 
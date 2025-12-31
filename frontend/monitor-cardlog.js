require('dotenv').config();
const mongoose = require('mongoose');

async function monitorCardLog() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('🔍 Monitoring CardLog data...');
    
    const Table = mongoose.model('Table', new mongoose.Schema({}, {strict: false}));
    
    // Get current state
    const tables = await Table.find({}).sort({updatedAt: -1});
    
    console.log('\n📊 Current CardLog Status:');
    console.log('='.repeat(50));
    
    tables.forEach((table, i) => {
      const cardLogCount = table.cardLog ? table.cardLog.length : 0;
      if (cardLogCount > 0) {
        console.log(`Table ${i+1}: ${table._id}`);
        console.log(`  CardLog entries: ${cardLogCount}`);
        console.log(`  Last updated: ${table.updatedAt}`);
        
        // Show recent entries
        table.cardLog.forEach((day, dayIndex) => {
          const entriesCount = day.entries ? day.entries.length : 0;
          console.log(`    Day ${dayIndex + 1} (${day.date}): ${entriesCount} entries`);
        });
        console.log('');
      }
    });
    
    console.log('✅ Monitoring complete');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

monitorCardLog(); 
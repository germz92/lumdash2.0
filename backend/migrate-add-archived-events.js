// Migration script to add archivedEvents field to existing users
const mongoose = require('mongoose');
require('dotenv').config();

async function migrateUsers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('✅ Connected to MongoDB');

    const User = require('./models/User');

    // Find all users that don't have the archivedEvents field
    const usersWithoutField = await User.find({ 
      archivedEvents: { $exists: false } 
    });

    console.log(`Found ${usersWithoutField.length} users without archivedEvents field`);

    if (usersWithoutField.length > 0) {
      // Update all users to have an empty archivedEvents array
      const result = await User.updateMany(
        { archivedEvents: { $exists: false } },
        { $set: { archivedEvents: [] } }
      );

      console.log(`✅ Updated ${result.modifiedCount} users with archivedEvents field`);
    } else {
      console.log('✅ All users already have archivedEvents field');
    }

    // Verify the migration
    const totalUsers = await User.countDocuments();
    const usersWithField = await User.countDocuments({ 
      archivedEvents: { $exists: true } 
    });

    console.log(`Total users: ${totalUsers}`);
    console.log(`Users with archivedEvents field: ${usersWithField}`);

    if (totalUsers === usersWithField) {
      console.log('🎉 Migration completed successfully!');
    } else {
      console.log('❌ Migration incomplete');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

// Run if called directly
if (require.main === module) {
  migrateUsers();
}

module.exports = migrateUsers;

// Migration script: give every existing inventory item an asset tag (e.g. LD-00123).
// Asset tags are what the printed QR / barcode labels encode.
//
// Usage (from the backend folder):
//   node migrate-add-asset-tags.js --dry-run   # report only, change nothing
//   node migrate-add-asset-tags.js             # assign tags
//
// Safe to run more than once: items that already have a tag are left alone.
const mongoose = require('mongoose');
require('dotenv').config();

async function migrateAssetTags({ dryRun = false } = {}) {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI environment variable is not set.');
    process.exitCode = 1;
    return;
  }

  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const GearInventory = require('./models/GearInventory');

    // Make sure the unique asset tag index exists before assigning
    await GearInventory.init();

    const total = await GearInventory.countDocuments();
    const result = await GearInventory.assignMissingAssetTags({ dryRun });

    console.log(`Inventory items: ${total}`);
    console.log(`Items without an asset tag: ${result.missing}`);

    if (dryRun) {
      console.log('Dry run - nothing was changed. Run again without --dry-run to assign tags.');
      return;
    }

    console.log(`✅ Assigned ${result.assigned} asset tag(s)`);

    // Verify the migration
    const stillMissing = await GearInventory.countDocuments({
      $or: [{ assetTag: { $exists: false } }, { assetTag: null }, { assetTag: '' }]
    });
    if (stillMissing === 0) {
      console.log('🎉 Migration completed successfully - every item has an asset tag');
    } else {
      console.log(`❌ Migration incomplete - ${stillMissing} item(s) still have no asset tag`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

// Run if called directly
if (require.main === module) {
  migrateAssetTags({ dryRun: process.argv.includes('--dry-run') });
}

module.exports = migrateAssetTags;

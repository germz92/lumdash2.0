// Temp diagnostic: look up a crew availability token in the connected DB
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const CrewAvailabilityRequest = require('../models/CrewAvailabilityRequest');

const token = process.argv[2];
if (!token) {
  console.log('Usage: node check-crew-token.js <token>');
  process.exit(1);
}

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to DB:', mongoose.connection.name);

    const doc = await CrewAvailabilityRequest.findOne({ token }).lean();
    if (!doc) {
      const total = await CrewAvailabilityRequest.countDocuments();
      console.log('TOKEN NOT FOUND in this database.');
      console.log(`Total crew availability requests in this DB: ${total}`);
      const recent = await CrewAvailabilityRequest.find().sort({ createdAt: -1 }).limit(5)
        .select('name email token sentAt revokedAt respondedAt').lean();
      recent.forEach(r => {
        console.log(`- ${r.name} <${r.email}> sent=${r.sentAt?.toISOString()} revoked=${!!r.revokedAt} responded=${!!r.respondedAt} token=${r.token.slice(0, 12)}...`);
      });
    } else {
      console.log('TOKEN FOUND:');
      console.log(`  name: ${doc.name} <${doc.email}>`);
      console.log(`  eventId: ${doc.eventId}`);
      console.log(`  sentAt: ${doc.sentAt}`);
      console.log(`  revokedAt: ${doc.revokedAt || 'not revoked'}`);
      console.log(`  respondedAt: ${doc.respondedAt || 'not responded'}`);
      console.log(`  expiresAt: ${doc.expiresAt} (expired: ${doc.expiresAt <= new Date()})`);
      console.log(`  rowIds: ${doc.rowIds.length}`);
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await mongoose.disconnect();
  }
})();

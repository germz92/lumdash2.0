const mongoose = require('mongoose');
const GearPackage = require('./models/GearPackage');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    
    try {
      // Find all packages
      const packages = await GearPackage.find({});
      console.log('Total packages found:', packages.length);
      
      if (packages.length > 0) {
        // Log details about each package
        packages.forEach((pkg, i) => {
          console.log(`Package ${i+1}:`);
          console.log('  ID:', pkg._id);
          console.log('  Name:', pkg.name);
          console.log('  User ID:', pkg.userId);
          console.log('  User ID Type:', typeof pkg.userId);
          console.log('  Created:', pkg.createdAt);
          console.log('  Has categories:', !!pkg.categories);
          console.log('----------------------------------------');
        });
        
        // Find unique user IDs
        const userIds = [...new Set(packages.map(p => String(p.userId)))];
        console.log('\nUnique user IDs in packages:', userIds);
      }
    } catch (err) {
      console.error('Error querying packages:', err);
    }
    
    mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err);
  }); 
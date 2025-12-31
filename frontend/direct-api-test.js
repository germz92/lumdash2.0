/**
 * API Test Script for Gear Packages
 * This script tests direct communication with MongoDB and the API
 */
const mongoose = require('mongoose');
const express = require('express');
const app = express();
require('dotenv').config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB successfully!");
    return true;
  } catch (err) {
    console.error("MongoDB connection error:", err);
    return false;
  }
};

// Define GearPackage schema
const gearPackageSchema = new mongoose.Schema({
  name: String,
  description: String,
  userId: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  categories: {
    type: Map,
    of: [Object]
  },
  inventoryIds: [String]
});
const GearPackage = mongoose.model('GearPackage', gearPackageSchema);

// Helper to normalize user ID
function normalizeUserId(id) {
  if (!id) return null;
  // First ensure it's a string
  const idStr = String(id);
  // Clean up any MongoDB ObjectId artifacts
  return idStr.replace(/^new ObjectId\(['"](.+)['"]\)$/, '$1');
}

// Setup Express server for testing
const setupServer = () => {
  app.use(express.json());
  
  // Test endpoint - direct MongoDB query
  app.get('/test/packages', async (req, res) => {
    try {
      console.log("Running test query for all packages");
      const packages = await GearPackage.find({});
      console.log(`Found ${packages.length} total packages`);
      
      if (packages.length > 0) {
        console.log("Sample package:", {
          id: packages[0]._id,
          name: packages[0].name,
          userId: packages[0].userId,
          userIdType: typeof packages[0].userId
        });
      }
      
      res.json({
        success: true,
        count: packages.length,
        packages: packages.map(p => ({
          id: p._id,
          name: p.name,
          userId: p.userId,
          normalizedId: normalizeUserId(p.userId)
        }))
      });
    } catch (err) {
      console.error("Test query error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  
  // Test endpoint - query by user ID
  app.get('/test/packages/:userId', async (req, res) => {
    try {
      const userId = req.params.userId;
      console.log(`Testing package query for user: ${userId}`);
      
      // Try exact match first
      let packages = await GearPackage.find({ userId: userId });
      console.log(`Found ${packages.length} packages with exact userId match`);
      
      // If not found, try normalized version
      if (packages.length === 0) {
        const normalizedId = normalizeUserId(userId);
        console.log(`Trying normalized ID: ${normalizedId}`);
        packages = await GearPackage.find({ userId: normalizedId });
        console.log(`Found ${packages.length} packages with normalized userId match`);
        
        // If still not found, try flexible search
        if (packages.length === 0) {
          console.log("Trying flexible search through all packages");
          const allPackages = await GearPackage.find({});
          packages = allPackages.filter(p => normalizeUserId(p.userId) === normalizedId);
          console.log(`Found ${packages.length} packages with flexible search`);
        }
      }
      
      res.json({
        success: true,
        userId: userId,
        normalizedId: normalizeUserId(userId),
        count: packages.length,
        packages: packages.map(p => ({
          id: p._id,
          name: p.name,
          createdAt: p.createdAt
        }))
      });
    } catch (err) {
      console.error("User package test error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  
  const PORT = 3333;
  app.listen(PORT, () => {
    console.log(`Test server running on port ${PORT}`);
    console.log(`- Access all packages: http://localhost:${PORT}/test/packages`);
    console.log(`- Test with your user ID: http://localhost:${PORT}/test/packages/YOUR_USER_ID`);
  });
};

// Run diagnostics
const runDiagnostics = async () => {
  // Test database connection
  const dbConnected = await connectDB();
  if (!dbConnected) {
    console.error("Failed to connect to MongoDB. Exiting.");
    process.exit(1);
  }
  
  // Count all packages
  const packageCount = await GearPackage.countDocuments();
  console.log(`Total packages in database: ${packageCount}`);
  
  if (packageCount > 0) {
    // Get a sample of packages
    const samplePackages = await GearPackage.find().limit(5);
    console.log("\nSample packages:");
    samplePackages.forEach((pkg, i) => {
      console.log(`Package ${i+1}:`);
      console.log(`  ID: ${pkg._id}`);
      console.log(`  Name: ${pkg.name}`);
      console.log(`  User ID: ${pkg.userId}`);
      console.log(`  User ID type: ${typeof pkg.userId}`);
      console.log(`  Normalized User ID: ${normalizeUserId(pkg.userId)}`);
      console.log(`  Created: ${pkg.createdAt}`);
      console.log(`  Has categories: ${!!pkg.categories}`);
    });
    
    // Find unique user IDs
    const allUserIds = await GearPackage.distinct('userId');
    console.log(`\nFound ${allUserIds.length} unique user IDs:`);
    allUserIds.forEach(id => console.log(`  - ${id} (normalized: ${normalizeUserId(id)})`));
  }
  
  // Start test server
  setupServer();
};

// Run the script
runDiagnostics().catch(err => {
  console.error("Error in diagnostics:", err);
  process.exit(1);
}); 
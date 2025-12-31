const express = require('express');
const router = express.Router();
const ReservedGearItem = require('../models/ReservedGearItem');

// Helper function to normalize user ID format
function normalizeUserId(id) {
  if (!id) return null;
  // First ensure it's a string
  const idStr = String(id);
  // Then clean up any MongoDB ObjectId artifacts if present
  return idStr.replace(/^new ObjectId\(['"](.+)['"]\)$/, '$1');
}

// Create a new gear package
router.post('/', async (req, res) => {
  try {
    console.log('[GearPackage] Received POST request to create package');
    
    // Log request details
    console.log('[GearPackage] Request body:', JSON.stringify(req.body, null, 2));
    console.log('[GearPackage] Raw User ID from token:', req.user?.id);
    console.log('[GearPackage] User ID type:', typeof req.user?.id);
    
    const { name, description, categories, inventoryIds } = req.body;
    
    // Validate required fields
    if (!name || !categories) {
      console.error('[GearPackage] Missing required fields:', { name: !!name, categories: !!categories });
      return res.status(400).json({ error: 'Name and categories are required' });
    }
    
    const userId = normalizeUserId(req.user.id);
    console.log('[GearPackage] Normalized user ID for save:', userId);
    
    // Create reserved item document with user ID - req.user is set by authenticate middleware
    // Note: This route is for creating individual reserved items (legacy compatibility)
    const reservedItem = new ReservedGearItem({
      eventId: req.body.eventId || null, // Event ID should be provided
      userId: userId, // Use normalized ID
      listName: req.body.listName || 'Main List',
      inventoryId: inventoryIds?.[0] || null, // Take first inventory ID
      brand: name || 'Unknown',
      model: description || 'Unknown',
      category: categories || 'Accessories',
      quantity: req.body.quantity || 1,
      serial: req.body.serial || null,
      specificSerialRequested: req.body.specificSerialRequested || false,
      isPacked: false
    });
    
    console.log('[ReservedGearItem] Item created, about to save:', reservedItem._id);
    
    // Save to database
    await reservedItem.save();
    
    console.log('[ReservedGearItem] Item saved successfully with ID:', reservedItem._id);
    console.log('[ReservedGearItem] Saved with user ID:', reservedItem.userId);
    
    // Create a log file entry
    const fs = require('fs');
    const logEntry = `${new Date().toISOString()} - Reserved Item saved: ${reservedItem._id} - User: ${userId} - Name: ${name}\n`;
    fs.appendFile('./logs/gear-packages.log', logEntry, err => {
      if (err) console.error('[ReservedGearItem] Error writing to log file:', err);
    });
    
    res.status(201).json(reservedItem);
  } catch (err) {
    console.error('[GearPackage] Error creating gear package:', err);
    
    // Log detailed error information
    if (err.name === 'ValidationError') {
      console.error('[GearPackage] Validation error details:', err.errors);
      return res.status(400).json({ 
        error: 'Validation error', 
        details: Object.keys(err.errors).map(key => ({ 
          field: key, 
          message: err.errors[key].message 
        }))
      });
    }
    
    if (err.code === 11000) {
      console.error('[GearPackage] Duplicate key error:', err.keyValue);
      return res.status(409).json({ 
        error: 'Duplicate key error', 
        field: Object.keys(err.keyValue)[0] 
      });
    }
    
    res.status(500).json({ 
      error: 'Server error',
      message: err.message
    });
  }
});

// Get all gear packages for the current user
router.get('/', async (req, res) => {
  try {
    console.log('[GearPackage] Received GET request to list packages');
    console.log('[GearPackage] Raw User ID from token:', req.user?.id);
    console.log('[GearPackage] User ID type:', typeof req.user?.id);
    
    const userId = normalizeUserId(req.user.id);
    console.log('[GearPackage] Normalized User ID for query:', userId);
    
    // Test directly filtering by the normalized ID as a string
    const packages = await ReservedGearItem.find({ userId: userId })
      .sort({ createdAt: -1 }) // Newest first
      .select('_id brand model category listName createdAt'); // Use new schema fields
    
    console.log(`[GearPackage] Found ${packages.length} packages for user`);
    
    // Log the package IDs for debugging
    if (packages.length > 0) {
      console.log('[GearPackage] Package IDs found:', packages.map(p => p._id));
    } else {
      console.log('[GearPackage] No packages found - checking with alternative query approach');
      
      // Try a more flexible query approach - just log for now
      const allPackages = await ReservedGearItem.find().limit(10);
      console.log(`[GearPackage] Total packages in database: ${allPackages.length}`);
      
      if (allPackages.length > 0) {
        // Map each package with diagnostic info
        const packageDetails = allPackages.map(p => ({ 
          id: p._id, 
          brand: p.brand,
          model: p.model,
          listName: p.listName,
          userId: p.userId,
          normalizedPackageUserId: normalizeUserId(p.userId),
          currentUserId: userId,
          matchesCurrent: normalizeUserId(p.userId) === userId
        }));
        
        console.log('[GearPackage] Package details:', JSON.stringify(packageDetails, null, 2));
        
        // Check if we can find ANY packages for this user with a flexible approach
        const userPackages = allPackages.filter(p => normalizeUserId(p.userId) === userId);
        if (userPackages.length > 0) {
          console.log('[GearPackage] Found packages with flexible query!', userPackages.length);
          
          // Since we found packages, return those instead
          return res.json(userPackages.map(p => ({
            _id: p._id,
            brand: p.brand,
            model: p.model,
            category: p.category,
            listName: p.listName,
            createdAt: p.createdAt
          })));
        }
      }
    }
    
    res.json(packages);
  } catch (err) {
    console.error('[GearPackage] Error fetching gear packages:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get a specific gear package by ID
router.get('/:id', async (req, res) => {
  try {
    const reservedItem = await ReservedGearItem.findOne({
      _id: req.params.id,
      userId: req.user.id
    });
    
    if (!reservedItem) {
      return res.status(404).json({ error: 'Reserved item not found' });
    }
    
    res.json(reservedItem);
  } catch (err) {
    console.error('Error fetching gear package:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update a gear package
router.put('/:id', async (req, res) => {
  try {
    const { name, description, categories, inventoryIds } = req.body;
    
    // Find and update
    const reservedItem = await ReservedGearItem.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { 
        brand: name, // Update to match new schema
        model: description, 
        category: categories, 
        inventoryId: inventoryIds?.[0] || null, // Take first inventory ID
        updatedAt: Date.now()
      },
      { new: true }
    );
    
    if (!reservedItem) {
      return res.status(404).json({ error: 'Reserved item not found' });
    }
    
    res.json(reservedItem);
  } catch (err) {
    console.error('Error updating gear package:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a gear package and release inventory reservations
router.delete('/:id', async (req, res) => {
  console.log(`[DELETE GEAR PACKAGE] Starting delete for item: ${req.params.id}, user: ${req.user?.id || 'UNKNOWN'}`);
  
  try {
    const { id: itemId } = req.params;
    const userId = req.user.id;

    console.log(`[DELETE GEAR PACKAGE] Looking for gear package with ID: ${itemId}, userId: ${userId}`);
    
    const GearPackage = require('../models/GearPackage');
    const gearPackage = await ReservedGearItem.findOne({ 
      _id: itemId, 
      userId 
    });

    if (!gearPackage) {
      console.log(`[DELETE GEAR PACKAGE] Gear package not found for ID: ${itemId}, userId: ${userId}`);
      return res.status(404).json({ error: 'Gear package not found' });
    }

    console.log(`[DELETE GEAR PACKAGE] Found gear package:`, {
      id: gearPackage._id,
      inventoryId: gearPackage.inventoryId,
      eventId: gearPackage.eventId,
      listName: gearPackage.listName,
      quantity: gearPackage.quantity,
      serial: gearPackage.serial
    });

    // If this is an individual gear package, remove the reservation from inventory
    if (gearPackage.inventoryId && gearPackage.eventId) {
      console.log(`[DELETE GEAR PACKAGE] Processing reservation release...`);
      
      // Get the event to retrieve checkout dates (not needed for new release method but kept for verification)
      const Table = require('../models/Table');
      const event = await Table.findById(gearPackage.eventId);
      if (!event) {
        console.log(`[DELETE GEAR PACKAGE] Event not found: ${gearPackage.eventId}`);
        return res.status(400).json({ error: 'Event not found' });
      }

      console.log(`[DELETE GEAR PACKAGE] Found event: ${event._id}`);

      const GearInventory = require('../models/GearInventory');
      const inventoryItem = await GearInventory.findById(gearPackage.inventoryId);
      if (inventoryItem) {
        console.log(`[DELETE GEAR PACKAGE] Found inventory item: ${inventoryItem.label}`);
        console.log(`[DELETE GEAR PACKAGE] Reservations before release: ${inventoryItem.reservations.length}`);
        
        console.log(`[DELETE GEAR PACKAGE] Releasing ${gearPackage.quantity} units of ${inventoryItem.label} for event ${gearPackage.eventId}`);
        
        // Use the simplified releaseQuantity method with event, user, and quantity
        const releasedQuantity = inventoryItem.releaseQuantity(
          gearPackage.eventId.toString(),
          userId,
          gearPackage.quantity
        );

        await inventoryItem.save();
        console.log(`[DELETE GEAR PACKAGE] Successfully released ${releasedQuantity} units for ${inventoryItem.label}`);
        console.log(`[DELETE GEAR PACKAGE] Reservations after release: ${inventoryItem.reservations.length}`);
      } else {
        console.log(`[DELETE GEAR PACKAGE] Inventory item not found: ${gearPackage.inventoryId}`);
      }
    } else {
      console.log(`[DELETE GEAR PACKAGE] No inventory/event IDs found, skipping reservation release`);
    }

    // Delete the gear package
    console.log(`[DELETE GEAR PACKAGE] Deleting gear package: ${itemId}`);
    const deleteResult = await ReservedGearItem.findOneAndDelete({ _id: itemId, userId });
    
    if (deleteResult) {
      console.log(`[DELETE GEAR PACKAGE] Successfully deleted gear package: ${itemId}`);
    } else {
      console.log(`[DELETE GEAR PACKAGE] Gear package not found for deletion: ${itemId}`);
    }

    console.log(`[DELETE GEAR PACKAGE] Delete operation completed successfully`);
    res.json({ success: true, message: 'Gear package deleted and reservation released' });
  } catch (error) {
    console.error('[DELETE GEAR PACKAGE] Error deleting gear package:', error);
    res.status(500).json({ error: 'Failed to delete gear package: ' + error.message });
  }
});

module.exports = router; 
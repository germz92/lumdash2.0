// Backend v4.1 - COMPLETION_SCHEMA_FIX - Added completedBy and completedByName fields to shotlist schema
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const sgMail = require('@sendgrid/mail');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const OpenAI = require('openai');
const { buildLumaContext } = require('./services/lumaContextBuilder');
const { buildAssignmentProposal, canAssignPhotographers } = require('./services/photographerAssigner');
require('dotenv').config();
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
console.log('SENDGRID_API_KEY loaded:', !!process.env.SENDGRID_API_KEY);
console.log('SENDGRID_FROM_EMAIL:', process.env.SENDGRID_FROM_EMAIL);
// Friendly sender name shown in inboxes ("LumDash <info@...>"). Set per message,
// so it never affects other platforms sending from the same address.
const SENDGRID_FROM = {
  email: process.env.SENDGRID_FROM_EMAIL,
  name: process.env.SENDGRID_FROM_NAME || 'LumDash'
};
console.log('APP_URL:', process.env.APP_URL);

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true // Ensure HTTPS URLs
});

// Debug Cloudinary configuration
console.log('Cloudinary Environment Variables:');
console.log('CLOUDINARY_CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME ? 'SET' : 'NOT SET');
console.log('CLOUDINARY_API_KEY:', process.env.CLOUDINARY_API_KEY ? 'SET' : 'NOT SET');
console.log('CLOUDINARY_API_SECRET:', process.env.CLOUDINARY_API_SECRET ? 'SET' : 'NOT SET');
console.log('Cloudinary config:', {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY ? '***' + process.env.CLOUDINARY_API_KEY.slice(-4) : 'NOT SET',
  api_secret: process.env.CLOUDINARY_API_SECRET ? '***' + process.env.CLOUDINARY_API_SECRET.slice(-4) : 'NOT SET'
});

// Configure OpenAI
let openai = null;
if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here') {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  console.log('✅ OpenAI configured successfully');
} else {
  console.log('⚠️  OpenAI API key not configured - chat feature disabled');
}

// Simple in-memory cache for AI responses (expires after 5 minutes)
const responseCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function generateCacheKey(message, tableId, relevantDataHash) {
  return `${tableId}-${message.toLowerCase().trim()}-${relevantDataHash}`;
}

function getCachedResponse(cacheKey) {
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.response;
  }
  responseCache.delete(cacheKey);
  return null;
}

function setCachedResponse(cacheKey, response) {
  responseCache.set(cacheKey, {
    response: response,
    timestamp: Date.now()
  });
  
  // Clean old cache entries (simple cleanup)
  if (responseCache.size > 100) {
    const oldestKeys = Array.from(responseCache.keys()).slice(0, 20);
    oldestKeys.forEach(key => responseCache.delete(key));
  }
}

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, PNG, and PDF files are allowed.'), false);
    }
  }
});

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: function(origin, callback) {
      // In production, allow any origin (Render generates dynamic URLs)
      // In development, be more specific
      const allowedOrigins = [
        'https://www.lumdash.app',
        'https://lumdash.app', 
        'https://beta.lumdash.app',
        'https://www.beta.lumdash.app',
        'https://spa-lumdash-backend.onrender.com',
        'https://lumdash-beta-backend.onrender.com',
        'https://germainedavid.github.io',
        'https://lumquote.com',           // LumQuote Invoice App
        'https://www.lumquote.com',
        'https://quote-generator-kixj.onrender.com', // LumQuote production (Render)
        'http://localhost:8000',          // LumQuote local development
        'http://127.0.0.1:8000',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5000',
        'http://127.0.0.1:5000'
      ];
      
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);
      
      // For Render deployment, allow any .onrender.com domain
      if (origin.includes('.onrender.com')) return callback(null, true);
      
      // For GitHub Pages, allow any github.io domain
      if (origin.includes('.github.io')) return callback(null, true);
      
      // For lumdash.app domains (including subdomains like beta.lumdash.app)
      if (origin.includes('lumdash.app')) return callback(null, true);
      
      // Check explicit allowed origins
      if (allowedOrigins.includes(origin)) return callback(null, true);
      
      // In development, allow localhost with any port
      if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) {
        return callback(null, true);
      }
      
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true
  },
  // Essential for Render deployment
  transports: ['websocket', 'polling'],
  // Increase timeouts for stability on cloud platforms
  pingTimeout: 60000,
  pingInterval: 25000,
  // Allow upgrade from polling to websocket
  allowUpgrades: true,
  // Handle connection issues gracefully
  maxHttpBufferSize: 1e6,
  connectTimeout: 45000
});

io.on('connection', (socket) => {
  console.log('Socket.IO: Client connected', socket.id);
  
  // Handle joining table-specific rooms
  socket.on('joinTable', (tableId) => {
    if (tableId) {
      socket.join(`table-${tableId}`);
      console.log(`Socket.IO: Client ${socket.id} joined table room: table-${tableId}`);
    }
  });
  
  socket.on('leaveTable', (tableId) => {
    if (tableId) {
      socket.leave(`table-${tableId}`);
      console.log(`Socket.IO: Client ${socket.id} left table room: table-${tableId}`);
    }
  });
  
  // Join user-specific room for targeted notifications
  socket.on('joinUserRoom', (userId) => {
    if (userId) {
      const roomId = userId.toString();
      socket.join(`user-${roomId}`);
      socket.userId = roomId;
      console.log(`Socket.IO: Client ${socket.id} joined user room: user-${roomId}`);
    }
  });
  
  // Collaborative editing event handlers
  socket.on('joinEventRoom', (data) => {
    const { eventId, userId, userName, userColor } = data;
    if (eventId && userId) {
      const roomName = `event-${eventId}`;
      socket.join(roomName);
      socket.eventId = eventId;
      socket.userId = userId;
      socket.userName = userName;
      socket.userColor = userColor;
      
      console.log(`Socket.IO: User ${userName} (${userId}) joined event room: ${roomName}`);
      
      // Broadcast to other users in the room that this user joined
      socket.to(roomName).emit('userJoined', {
        userId,
        userName,
        userColor,
        timestamp: Date.now()
      });
    }
  });
  
  socket.on('leaveEventRoom', (data) => {
    const { eventId, userId } = data;
    if (eventId && userId) {
      const roomName = `event-${eventId}`;
      socket.leave(roomName);
      
      // Broadcast to other users that this user left
      socket.to(roomName).emit('userLeft', {
        userId,
        timestamp: Date.now()
      });
      
      console.log(`Socket.IO: User ${userId} left event room: ${roomName}`);
    }
  });

  // Schedule-specific collaboration handlers
  socket.on('joinScheduleCollaboration', (data) => {
    const { eventId, userId, userName, userColor } = data;
    if (eventId && userId) {
      const roomName = `event-${eventId}`;
      
      console.log(`Socket.IO: User ${userName} (${userId}) joined schedule collaboration in room: ${roomName}`);
      
      // Broadcast to other users in the room that this user joined schedule collaboration
      socket.to(roomName).emit('scheduleUserJoined', {
        userId,
        userName,
        userColor,
        timestamp: Date.now()
      });
    }
  });
  
  socket.on('leaveScheduleCollaboration', (data) => {
    const { eventId, userId } = data;
    if (eventId && userId) {
      const roomName = `event-${eventId}`;
      
      // Broadcast to other users that this user left schedule collaboration
      socket.to(roomName).emit('scheduleUserLeft', {
        userId,
        timestamp: Date.now()
      });
      
      console.log(`Socket.IO: User ${userId} left schedule collaboration in room: ${roomName}`);
    }
  });

  // Card-log-specific collaboration handlers
  socket.on('joinCardLogCollaboration', (data) => {
    const { eventId, userId, userName } = data;
    if (eventId && userId) {
      const roomName = `event-${eventId}`;
      
      console.log(`Socket.IO: User ${userName} (${userId}) joined card-log collaboration in room: ${roomName}`);
      
      // Broadcast to other users in the room that this user joined card-log collaboration
      socket.to(roomName).emit('cardLogUserJoined', {
        userId,
        userName,
        timestamp: Date.now()
      });
    }
  });
  
  socket.on('leaveCardLogCollaboration', (data) => {
    const { eventId, userId } = data;
    if (eventId && userId) {
      const roomName = `event-${eventId}`;
      
      // Broadcast to other users that this user left card-log collaboration
      socket.to(roomName).emit('cardLogUserLeft', {
        userId,
        timestamp: Date.now()
      });
      
      console.log(`Socket.IO: User ${userId} left card-log collaboration in room: ${roomName}`);
    }
  });
  
  socket.on('startFieldEdit', (data) => {
    const { eventId, fieldId, userId, userName, userColor } = data;
    if (eventId && fieldId && userId) {
      const roomName = `event-${eventId}`;
      
      // Broadcast to other users that this field is being edited
      socket.to(roomName).emit('fieldEditStarted', {
        fieldId,
        userId,
        userName,
        userColor,
        timestamp: Date.now()
      });
      
      console.log(`Socket.IO: User ${userName} started editing field ${fieldId} in event ${eventId}`);
    }
  });
  
  socket.on('stopFieldEdit', (data) => {
    const { eventId, fieldId, userId } = data;
    if (eventId && fieldId && userId) {
      const roomName = `event-${eventId}`;
      
      // Broadcast to other users that this field is no longer being edited
      socket.to(roomName).emit('fieldEditStopped', {
        fieldId,
        userId,
        timestamp: Date.now()
      });
      
      console.log(`Socket.IO: User ${userId} stopped editing field ${fieldId} in event ${eventId}`);
    }
  });
  
  socket.on('programOperation', (data) => {
    const { eventId, operation, userId, userName } = data;
    if (eventId && operation && userId) {
      const roomName = `event-${eventId}`;
      
      // Broadcast the operation to other users in the room
      socket.to(roomName).emit('programOperationReceived', {
        operation,
        userId,
        userName,
        timestamp: Date.now()
      });
      
      const fieldName = operation.data ? operation.data.field : 'unknown';
      const programId = operation.data ? operation.data.programId : 'unknown';
      console.log(`Socket.IO: User ${userName} performed operation on field ${fieldName} (program: ${programId}) in event ${eventId}`);
      console.log(`Operation details:`, JSON.stringify(operation, null, 2));
    }
  });
  
  // Card Log Collaborative Operations
  socket.on('cardLogOperation', (data) => {
    const { eventId, operation, userId, userName } = data;
    if (eventId && operation && userId) {
      const roomName = `event-${eventId}`;
      
      // Broadcast the card log operation to other users in the room
      socket.to(roomName).emit('cardLogOperationReceived', {
        operation,
        userId,
        userName,
        timestamp: Date.now()
      });
      
      const fieldName = operation.fieldId || 'unknown field';
      console.log(`Socket.IO: User ${userName} performed card log operation on field ${fieldName} in event ${eventId}`);
    }
  });
  
  socket.on('updatePresence', (data) => {
    const { eventId, userId, userName, userColor, currentField } = data;
    if (eventId && userId) {
      const roomName = `event-${eventId}`;
      
      // Broadcast presence update to other users
      socket.to(roomName).emit('presenceUpdated', {
        userId,
        userName,
        userColor,
        currentField,
        lastSeen: Date.now()
      });
    }
  });

  // =============================================================================
  // SIMPLE COLLABORATION HANDLERS (Clean Slate System)
  // =============================================================================

  // When user starts editing a field
  socket.on('startEditing', (data) => {
    console.log('📝 [SIMPLE] User started editing:', data);
    
    const { eventId, programId, field, userId, sessionId, userName, color } = data;
    if (eventId && programId && field && userId) {
      const roomName = `event-${eventId}`;
      
      // Broadcast to all other users in the same event
      socket.to(roomName).emit('userStartedEditing', {
        eventId,
        programId,
        field,
        userId,
        sessionId,
        userName,
        color
      });
      
      console.log(`✅ [SIMPLE] Broadcasted startEditing for ${userName} on ${field}`);
    }
  });

  // When user stops editing a field
  socket.on('stopEditing', (data) => {
    console.log('✅ [SIMPLE] User stopped editing:', data);
    
    const { eventId, programId, field, userId, sessionId } = data;
    if (eventId && programId && field && userId) {
      const roomName = `event-${eventId}`;
      
      // Broadcast to all other users in the same event
      socket.to(roomName).emit('userStoppedEditing', {
        eventId,
        programId,
        field,
        userId,
        sessionId
      });
      
      console.log(`✅ [SIMPLE] Broadcasted stopEditing for user ${userId} on ${field}`);
    }
  });

  // When user updates a field
  socket.on('updateField', async (data) => {
    console.log('⚡ [SIMPLE] Field update received:', data);
    
    const { eventId, programId, field, value, userId, sessionId, userName } = data;
    if (eventId && programId && field && userId) {
      try {
        const roomName = `event-${eventId}`;
        
        // Save to database first
        await updateProgramInDatabase({
          eventId,
          programId,
          field,
          value,
          userId
        });
        
        // Broadcast to all other users in the same event
        socket.to(roomName).emit('fieldUpdated', {
          eventId,
          programId,
          field,
          value,
          userId,
          sessionId,
          userName
        });
        
        console.log(`✅ [SIMPLE] Broadcasted field update: ${field} = ${value} by ${userName}`);
        
      } catch (error) {
        console.error('❌ [SIMPLE] Error updating field:', error);
        
        // Send error back to user
        socket.emit('updateError', {
          eventId,
          programId,
          field,
          error: 'Failed to update field'
        });
      }
    }
  });
  
  // =============================================================================
  // STRUCTURAL CHANGE HANDLERS (NEW)
  // =============================================================================
  
  // Handle program addition
  socket.on('programAdded', (data) => {
    console.log('📋 [SIMPLE] Program addition received:', JSON.stringify(data, null, 2));
    
    const { eventId, userId, sessionId, userName, date, program } = data;
    console.log(`📋 [SIMPLE] Extracted fields: eventId=${eventId}, userId=${userId}, sessionId=${sessionId}, userName=${userName}`);
    
    if (eventId && userId && sessionId) {
      const roomName = `event-${eventId}`;
      
      const broadcastData = {
        eventId,
        userId,
        sessionId,
        userName,
        date,
        program
      };
      
      console.log(`📋 [SIMPLE] Broadcasting to room ${roomName}:`, JSON.stringify(broadcastData, null, 2));
      
      // Broadcast to all other users in the same event
      socket.to(roomName).emit('programAdded', broadcastData);
      
      console.log(`✅ [SIMPLE] Broadcasted program addition by ${userName} on ${date}`);
    } else {
      console.log(`❌ [SIMPLE] Missing required fields for program addition broadcast`);
    }
  });
  
  // Handle program deletion
  socket.on('programDeleted', (data) => {
    console.log('🗑️ [SIMPLE] Program deletion received:', JSON.stringify(data, null, 2));
    
    const { eventId, userId, sessionId, userName, program } = data;
    console.log(`🗑️ [SIMPLE] Extracted fields: eventId=${eventId}, userId=${userId}, sessionId=${sessionId}, userName=${userName}`);
    
    if (eventId && userId && sessionId) {
      const roomName = `event-${eventId}`;
      
      const broadcastData = {
        eventId,
        userId,
        sessionId,
        userName,
        program
      };
      
      console.log(`🗑️ [SIMPLE] Broadcasting to room ${roomName}:`, JSON.stringify(broadcastData, null, 2));
      
      // Broadcast to all other users in the same event
      socket.to(roomName).emit('programDeleted', broadcastData);
      
      console.log(`✅ [SIMPLE] Broadcasted program deletion by ${userName}`);
    } else {
      console.log(`❌ [SIMPLE] Missing required fields for program deletion broadcast`);
    }
  });
  
  // Handle schedule reload
  socket.on('scheduleReloaded', (data) => {
    console.log('🔄 [SIMPLE] Schedule reload received:', data);
    
    const { eventId, userId, sessionId, userName } = data;
    if (eventId && userId && sessionId) {
      const roomName = `event-${eventId}`;
      
      // Broadcast to all other users in the same event
      socket.to(roomName).emit('scheduleReloaded', {
        eventId,
        userId,
        sessionId,
        userName
      });
      
      console.log(`✅ [SIMPLE] Broadcasted schedule reload by ${userName}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket.IO: Client disconnected', socket.id);
    
    // If user was in an event room, notify others they left
    if (socket.eventId && socket.userId) {
      const roomName = `event-${socket.eventId}`;
      socket.to(roomName).emit('userLeft', {
        userId: socket.userId,
        timestamp: Date.now()
      });
    }
  });
});

// =============================================================================
// DATABASE UPDATE FUNCTION FOR SIMPLE COLLABORATION
// =============================================================================

// Update program field in database
async function updateProgramInDatabase({ eventId, programId, field, value, userId }) {
  try {
    console.log(`💾 [SIMPLE] Updating database: ${field} = ${value} for program ${programId}`);
    
    const Table = require('./models/Table');
    
    // Update the specific program field in the programSchedule array
    const result = await Table.updateOne(
      { 
        _id: eventId,
        'programSchedule._id': programId 
      },
      { 
        $set: { 
          [`programSchedule.$.${field}`]: value,
          [`programSchedule.$.lastModified`]: new Date(),
          [`programSchedule.$.lastModifiedBy`]: userId
        } 
      }
    );
    
    if (result.matchedCount === 0) {
      console.warn(`⚠️ [SIMPLE] Program not found: ${programId} in event ${eventId}`);
      throw new Error('Program not found');
    }
    
    if (result.modifiedCount === 0) {
      console.warn(`⚠️ [SIMPLE] No changes made to program ${programId}`);
    } else {
      console.log(`✅ [SIMPLE] Database updated successfully: ${field} = ${value}`);
    }
    
  } catch (error) {
    console.error(`❌ [SIMPLE] Database update failed:`, error);
    throw error;
  }
}

// CORS configuration
const corsOptions = {
  origin: function(origin, callback) {
    // Allow any origin
    callback(null, true);
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  credentials: true,
  optionsSuccessStatus: 204,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['rndr-id'],
  preflightContinue: false
};

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json());

// Debug: Log all incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Centralized date normalization utility
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

// Utility to ensure consistent date comparison
function datesEqual(date1, date2) {
  if (!date1 || !date2) return false;
  const norm1 = normalizeDate(date1);
  const norm2 = normalizeDate(date2);
  return norm1.getTime() === norm2.getTime();
}

// Helper function to calculate proper availability for cart items
async function calculateCartItemAvailability(cartItem, cart, allCartItems) {
  if (!cartItem.inventoryId) return 0;
  
  const inventoryItem = await GearInventory.findById(cartItem.inventoryId._id || cartItem.inventoryId);
  if (!inventoryItem) return 0;
  
  // For specific serial requests, just return individual item availability
  if (cartItem.specificSerial) {
    return await AtomicReservationService.getAvailableQuantity(
      inventoryItem._id, cart.checkOutDate, cart.checkInDate
    );
  }
  
  // For grouped items, calculate availability across all similar items
  const [brand, model] = inventoryItem.label.split(' ', 2);
  
  // Find all inventory items with same brand/model
  const similarItems = await GearInventory.find({
    label: { $regex: `^${brand} ${model}`, $options: 'i' }
  });
  
  // Calculate total available quantity using BULLETPROOF atomic service
  let totalAvailable = 0;
  for (const item of similarItems) {
    totalAvailable += await AtomicReservationService.getAvailableQuantity(
      item._id, cart.checkOutDate, cart.checkInDate
    );
  }
  
  // For display purposes, show how many MORE can be added for this brand/model
  // Calculate total quantity of this brand/model already in cart (all cart items, not just this one)
  const existingCartQuantity = allCartItems
    .filter(ci => {
      if (ci._id === cartItem._id) return true; // Include current item
      const ciInventoryId = ci.inventoryId._id ? ci.inventoryId._id.toString() : ci.inventoryId.toString();
      const ciInventory = similarItems.find(si => si._id.toString() === ciInventoryId);
      return ciInventory && !ci.specificSerial;
    })
    .reduce((sum, ci) => sum + ci.quantity, 0);
  
  // Available for addition = Total available - total cart quantity for this brand/model
  return Math.max(0, totalAvailable - existingCartQuantity);
}

// BULK version of calculateCartItemAvailability.
// Computes availableQuantity for EVERY cart item using a bounded number of
// queries (~4 total) instead of the per-item N+1 explosion. It mutates each
// item object in `cartItemsObjects`, setting `item.availableQuantity`, and
// produces values identical to calling calculateCartItemAvailability per item.
//
// This is a read-side display optimization only. It never creates reservations,
// so it cannot affect integrity — the atomic reserve flow remains the sole
// authority and re-validates availability inside a transaction.
async function assignCartItemAvailabilityBulk(cart, cartItemsObjects) {
  if (!cartItemsObjects || cartItemsObjects.length === 0) return;

  // Resolve the base inventory id for each cart item (handles populated or raw)
  const getInvId = (ci) => {
    if (!ci.inventoryId) return null;
    return (ci.inventoryId._id ? ci.inventoryId._id : ci.inventoryId).toString();
  };

  const baseIds = [...new Set(cartItemsObjects.map(getInvId).filter(Boolean))];
  if (baseIds.length === 0) {
    cartItemsObjects.forEach(ci => { ci.availableQuantity = 0; });
    return;
  }

  // 1. Fetch base inventory items (ONE query)
  const baseItems = await GearInventory.find({ _id: { $in: baseIds } }).lean();
  const baseById = new Map(baseItems.map(it => [it._id.toString(), it]));

  // 2. Build brand/model group keys (replicating label.split(' ', 2) prefix logic)
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyForLabel = (label) => {
    const parts = (label || '').split(' ');
    return `${parts[0] || ''} ${parts[1] || ''}`.trim();
  };

  const groupKeys = new Set();
  for (const item of baseItems) {
    groupKeys.add(keyForLabel(item.label));
  }

  // 3. Find ALL similar items for every group in ONE $or query
  const orConditions = [...groupKeys].map(key => ({
    label: { $regex: `^${escapeRegex(key)}`, $options: 'i' }
  }));
  const allSimilarItems = orConditions.length > 0
    ? await GearInventory.find({ $or: orConditions }).lean()
    : [];

  // Group similar items by their group key
  const similarByKey = new Map();
  for (const item of allSimilarItems) {
    const key = keyForLabel(item.label);
    if (!similarByKey.has(key)) similarByKey.set(key, []);
    similarByKey.get(key).push(item);
  }

  // 4. Bulk availability for ALL similar items (TWO queries)
  const availabilityMap = await AtomicReservationService.getAvailableQuantitiesBulk(
    allSimilarItems, cart.checkOutDate, cart.checkInDate
  );

  // 5. Total available + total cart quantity per group
  const totalAvailableByKey = new Map();
  for (const [key, items] of similarByKey) {
    const total = items.reduce(
      (sum, it) => sum + (availabilityMap.get(it._id.toString()) ?? 0), 0
    );
    totalAvailableByKey.set(key, total);
  }

  // Map each similar inventory id -> its group key (to attribute cart items)
  const keyByInventoryId = new Map();
  for (const [key, items] of similarByKey) {
    for (const it of items) keyByInventoryId.set(it._id.toString(), key);
  }

  const cartQtyByKey = new Map();
  for (const ci of cartItemsObjects) {
    if (ci.specificSerial) continue; // mirror original (grouped-only aggregation)
    const invId = getInvId(ci);
    const key = keyByInventoryId.get(invId);
    if (!key) continue;
    cartQtyByKey.set(key, (cartQtyByKey.get(key) || 0) + ci.quantity);
  }

  // 6. Assign availableQuantity to each cart item
  for (const ci of cartItemsObjects) {
    const invId = getInvId(ci);
    const baseItem = baseById.get(invId);
    if (!baseItem) { ci.availableQuantity = 0; continue; }

    if (ci.specificSerial) {
      ci.availableQuantity = availabilityMap.get(invId) ?? 0;
      continue;
    }

    const key = keyForLabel(baseItem.label);
    const totalAvailable = totalAvailableByKey.get(key) || 0;
    const groupCartQty = cartQtyByKey.get(key) || 0;
    ci.availableQuantity = Math.max(0, totalAvailable - groupCartQty);
  }
}

// Helper function to notify clients about data changes
function notifyDataChange(eventType, additionalData = null, tableId = null) {
  console.log(`📢 Emitting ${eventType} event for tableId: ${tableId || 'all'}`);
  
  // Always include the tableId in the event data to help clients filter relevant events
  const eventData = tableId 
    ? { ...(additionalData || {}), tableId } 
    : additionalData;
    
  if (tableId) {
    // Emit to specific table room for better performance and targeting
    const roomName = `table-${tableId}`;
    console.log(`📢 Emitting to room: ${roomName}`);
    io.to(roomName).emit(eventType, eventData);
    
    // Also emit globally for backwards compatibility (but with tableId for filtering)
    io.emit(eventType, eventData);
  } else {
    // Global events (no specific table)
    if (eventData) {
      io.emit(eventType, eventData);
    } else {
      io.emit(eventType, {});
    }
  }
}

// =============================================================================
// NOTIFICATION SYSTEM - Create & push notifications
// =============================================================================

/**
 * Creates a notification in MongoDB and pushes it via Socket.IO.
 * This is the SINGLE function to call from any endpoint to send a notification.
 * Non-blocking: catches errors so the parent operation never fails due to notifications.
 *
 * @param {Object} opts
 * @param {string} opts.recipientId  - User ID to notify
 * @param {string} opts.type         - Notification type (from the enum)
 * @param {string} opts.title        - Short title
 * @param {string} opts.message      - Longer description
 * @param {Object} opts.link         - { page, eventId, params } for navigation
 * @param {string} opts.actorId      - User who caused the notification
 * @param {string} opts.eventId      - Related event ID
 * @param {Object} opts.metadata     - Extra data specific to this type
 */
async function createNotification({ recipientId, type, title, message = '', link = {}, actorId = null, eventId = null, metadata = {} }) {
  try {
    const recipientStr = recipientId?.toString();
    if (!recipientStr) return null;

    // Don't notify yourself
    if (actorId && recipientStr && actorId.toString() === recipientStr) {
      console.log(`🔔 Notification skipped (self): [${type}] → user ${recipientStr}`);
      return null;
    }

    const {
      isNotificationChannelEnabled
    } = require('./lib/userSettings');
    const recipientUser = await User.findById(recipientStr).select('settings role').lean();
    const showToast = recipientUser
      ? isNotificationChannelEnabled(recipientUser, type, 'toast')
      : true;

    const NotificationModel = require('./models/Notification');
    const notification = await NotificationModel.create({
      recipient: recipientStr,
      type,
      title,
      message,
      link,
      actor: actorId,
      eventId,
      metadata
    });

    // Populate actor name for the real-time push
    await notification.populate('actor', 'fullName');

    // Push via Socket.IO (instant delivery if user is online)
    io.to(`user-${recipientStr}`).emit('new-notification', {
      _id: notification._id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      link: notification.link,
      actor: notification.actor,
      eventId: notification.eventId,
      metadata: notification.metadata,
      read: false,
      createdAt: notification.createdAt,
      showToast
    });

    console.log(`🔔 Notification created: [${type}] "${title}" → user ${recipientStr}`);
    return notification;
  } catch (err) {
    console.error('🔔 Failed to create notification:', err);
    return null;
  }
}

/**
 * Send the same notification to multiple users at once.
 * @param {Array<string>} recipientIds - Array of user IDs
 * @param {Object} opts - Same options as createNotification (minus recipientId)
 */
async function createNotificationBulk(recipientIds, opts) {
  const uniqueIds = [...new Set(recipientIds.map(String))];
  const results = await Promise.allSettled(
    uniqueIds.map(id => createNotification({ ...opts, recipientId: id }))
  );
  results.forEach((r, i) => {
    const id = uniqueIds[i];
    if (r.status === 'rejected') {
      console.error(`🔔 Notification FAILED for user ${id}:`, r.reason?.message || r.reason);
    } else if (r.status === 'fulfilled' && !r.value) {
      console.log(`🔔 Notification skipped for user ${id}`);
    }
  });
  return results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
}

/** Normalize user id for notification queries */
function toRecipientId(userId) {
  if (!userId) return null;
  const str = userId.toString();
  return mongoose.Types.ObjectId.isValid(str) ? new mongoose.Types.ObjectId(str) : str;
}

/** Find all system admin users (case-insensitive role match) */
async function findSystemAdminUsers() {
  return User.find({ role: { $regex: /^admin$/i } }).select('_id email fullName role').lean();
}

/** Escape string for safe use inside MongoDB $regex */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve LumDash event from reimbursement (by eventId or matching eventName → Table.title).
 */
async function resolveReimbursementEvent(request) {
  if (!request) return null;

  if (request.eventId) {
    const byId = await Table.findById(request.eventId).select('_id title owners').lean();
    if (byId) return byId;
  }

  const eventName = (request.eventName || '').trim();
  if (!eventName) return null;

  const exact = await Table.findOne({
    title: { $regex: new RegExp(`^${escapeRegex(eventName)}$`, 'i') }
  }).select('_id title owners').lean();
  if (exact) return exact;

  return Table.findOne({
    title: { $regex: escapeRegex(eventName), $options: 'i' }
  }).select('_id title owners').lean();
}

/**
 * Enrich reimbursement docs (lean objects) with:
 *  - ownerName: comma-separated full names of the event's owner(s)
 *  - reviewedByName: full name of the reviewer (backfilled from reviewedBy if not stored)
 * Batches DB lookups so it can be used on a list or a single request.
 */
async function enrichReimbursements(requests) {
  const list = Array.isArray(requests) ? requests : [requests];
  if (!list.length) return requests;

  // Resolve the LumDash event (Table) for each request, cached by id/name.
  const eventCache = new Map();
  const eventIds = [...new Set(list.filter(r => r.eventId).map(r => r.eventId.toString()))];
  if (eventIds.length) {
    const tables = await Table.find({ _id: { $in: eventIds } }).select('_id title owners').lean();
    tables.forEach(t => eventCache.set('id:' + t._id.toString(), t));
  }
  for (const r of list) {
    if (r.eventId && eventCache.has('id:' + r.eventId.toString())) continue;
    const name = (r.eventName || '').trim();
    if (!name) continue;
    const key = 'name:' + name.toLowerCase();
    if (!eventCache.has(key)) {
      eventCache.set(key, (await resolveReimbursementEvent(r)) || null);
    }
  }

  const tableForRequest = new Map();
  const userIds = new Set();
  list.forEach(r => {
    let table = r.eventId ? eventCache.get('id:' + r.eventId.toString()) : null;
    if (!table) {
      const name = (r.eventName || '').trim();
      if (name) table = eventCache.get('name:' + name.toLowerCase());
    }
    tableForRequest.set(r, table || null);
    if (table?.owners) table.owners.forEach(id => userIds.add(id.toString()));
    if (r.reviewedBy && !r.reviewedByName) userIds.add(r.reviewedBy.toString());
  });

  const userMap = {};
  if (userIds.size) {
    const users = await User.find({ _id: { $in: [...userIds] } }).select('fullName email').lean();
    users.forEach(u => { userMap[u._id.toString()] = u.fullName || u.email || ''; });
  }

  list.forEach(r => {
    const table = tableForRequest.get(r);
    if (table?.owners?.length) {
      r.ownerName = table.owners.map(id => userMap[id.toString()]).filter(Boolean).join(', ');
    } else {
      r.ownerName = r.ownerName || '';
    }
    if (!r.reviewedByName && r.reviewedBy) {
      r.reviewedByName = userMap[r.reviewedBy.toString()] || '';
    }
  });

  return requests;
}

/**
 * Resolve real submitter name/email from reimbursement doc + User collection.
 */
function normalizeReimbursementUserId(request) {
  const raw = request?.userId || request?.user_id;
  if (!raw) return null;
  if (raw instanceof mongoose.Types.ObjectId) return raw;
  const str = String(raw).trim();
  return mongoose.Types.ObjectId.isValid(str) ? new mongoose.Types.ObjectId(str) : null;
}

async function resolveReimbursementSubmitter(request) {
  const PLACEHOLDER = /^(submitter|someone|unknown|user)$/i;
  let userName = (request.userName || '').trim();
  let userEmail = (request.userEmail || '').trim() || null;

  const userId = normalizeReimbursementUserId(request);
  if (userId) {
    const user = await User.findById(userId).select('fullName email').lean();
    if (user) {
      if (!userName || PLACEHOLDER.test(userName)) {
        userName = (user.fullName || user.email || '').trim();
      }
      userEmail = userEmail || user.email || null;
    }
  }

  if ((!userName || PLACEHOLDER.test(userName)) && userEmail) {
    const user = await User.findOne({ email: userEmail.toLowerCase() }).select('fullName email').lean();
    if (user) userName = (user.fullName || user.email || '').trim();
  }

  if (!userName || PLACEHOLDER.test(userName)) {
    userName = userEmail || 'Unknown submitter';
  }

  return { userName, userEmail };
}

/**
 * Users who should be notified about a new reimbursement submission.
 * All system admins + owners of the event (matched by eventId or eventName).
 */
async function getReimbursementReviewerUsers(request) {
  const recipientIds = new Set();

  const admins = await findSystemAdminUsers();
  admins.forEach(u => recipientIds.add(u._id.toString()));

  const table = await resolveReimbursementEvent(request);
  if (table?.owners?.length) {
    table.owners.forEach(id => recipientIds.add(id.toString()));
    console.log(`📋 Event owners for "${table.title}": ${table.owners.length} owner(s)`);
  } else if (request?.eventName) {
    console.warn(`📋 No LumDash event matched for reimbursement event name: "${request.eventName}"`);
  }

  if (!recipientIds.size) return [];

  const users = await User.find({ _id: { $in: [...recipientIds] } })
    .select('_id email fullName role settings')
    .lean();

  if (!users.length) {
    console.warn('📋 Reimbursement reviewers: matched IDs but no User documents found');
  } else {
    const withEmail = users.filter(u => u.email);
    console.log(
      `📋 Reimbursement reviewers (${users.length} user(s), ${withEmail.length} with email):`,
      users.map(u => `${u.fullName || '(no name)'} <${u.email || 'no email'}> [${u._id}]`).join('; ')
    );
  }

  return users;
}

/** @returns {string[]} User ids for in-app notifications */
async function getReimbursementNotificationRecipients(request) {
  const users = await getReimbursementReviewerUsers(request);
  return users.map(u => u._id.toString());
}

/**
 * Send reimbursement submitted emails to reviewers (non-blocking per recipient).
 */
async function sendReimbursementSubmittedEmails(request, reviewers, submitter) {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    console.warn('📧 Reimbursement emails skipped: SendGrid not configured');
    return;
  }

  if (!reviewers.length) return;

  const {
    buildReimbursementSubmittedSubject,
    buildReimbursementSubmittedEmail,
    buildReimbursementSubmittedText
  } = require('./emails/reimbursementSubmittedEmail');

  const requestId = request._id.toString();
  const appUrl = (process.env.APP_URL || 'https://beta.lumdash.app').replace(/\/$/, '');
  const reviewUrl = `${appUrl}/dashboard.html#reimbursements?reimbursementId=${requestId}`;

  const baseData = {
    submitterName: submitter.userName,
    submitterEmail: submitter.userEmail || null,
    eventName: request.eventName || 'Unknown event',
    totalAmount: request.totalAmount,
    dateSubmitted: request.dateSubmitted || request.createdAt,
    description: request.description
      || (Array.isArray(request.items) && request.items[0]?.notes)
      || '',
    itemCount: Array.isArray(request.items) ? request.items.length : null,
    reviewUrl
  };

  const { isNotificationChannelEnabled } = require('./lib/userSettings');

  const results = await Promise.allSettled(
    reviewers.map(async (reviewer) => {
      const reviewerDoc = await User.findById(reviewer._id).select('settings role email fullName').lean();
      if (!reviewerDoc) return;
      if (!isNotificationChannelEnabled(reviewerDoc, 'reimbursement_submitted', 'email')) {
        console.log(`📧 Reimbursement email skipped (user pref): ${reviewer.email}`);
        return;
      }

      const to = (reviewerDoc.email || '').trim().toLowerCase();
      if (!to) {
        console.log(`📧 Reimbursement email skipped (no email): ${reviewerDoc.fullName || reviewer._id}`);
        return;
      }
      const data = {
        ...baseData,
        recipientName: reviewerDoc.fullName || reviewerDoc.email
      };

      await sgMail.send({
        to,
        from: SENDGRID_FROM,
        subject: buildReimbursementSubmittedSubject(data),
        html: buildReimbursementSubmittedEmail(data),
        text: buildReimbursementSubmittedText(data)
      });

      console.log(`📧 Reimbursement email sent to ${to}`);
    })
  );

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const email = reviewers[i]?.email || 'unknown';
      console.error(`📧 Reimbursement email failed for ${email}:`, r.reason?.response?.body || r.reason?.message || r.reason);
    }
  });
}

/**
 * Email submitter when their reimbursement is approved.
 */
async function sendReimbursementApprovedEmail(request) {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    console.warn('📧 Reimbursement approved email skipped: SendGrid not configured');
    return;
  }

  const { userName, userEmail } = await resolveReimbursementSubmitter(request);
  const to = (userEmail || '').trim().toLowerCase();
  if (!to) {
    console.warn(`📧 Reimbursement approved email skipped: no email for request ${request._id}`);
    return;
  }

  if (request.userId) {
    const submitter = await User.findById(request.userId).select('settings role').lean();
    const { isNotificationChannelEnabled } = require('./lib/userSettings');
    if (submitter && !isNotificationChannelEnabled(submitter, 'reimbursement_approved', 'email')) {
      console.log(`📧 Reimbursement approved email skipped (user pref): ${to}`);
      return;
    }
  }

  const {
    buildReimbursementApprovedSubject,
    buildReimbursementApprovedEmail,
    buildReimbursementApprovedText
  } = require('./emails/reimbursementApprovedEmail');

  const table = await resolveReimbursementEvent(request);
  const data = {
    submitterName: userName,
    eventName: request.eventName || table?.title || 'your event',
    totalAmount: request.totalAmount,
    dateSubmitted: request.dateSubmitted || request.createdAt,
    description: request.description
      || (Array.isArray(request.items) && request.items[0]?.notes)
      || ''
  };

  try {
    await sgMail.send({
      to,
      from: SENDGRID_FROM,
      subject: buildReimbursementApprovedSubject(data),
      html: buildReimbursementApprovedEmail(data),
      text: buildReimbursementApprovedText(data)
    });
    console.log(`📧 Reimbursement approved email sent to ${to}`);
  } catch (err) {
    console.error(`📧 Reimbursement approved email failed for ${to}:`, err.response?.body || err.message || err);
  }
}

/** Event IDs this user may review reimbursements for (null = all events, admin) */
async function getReimbursementEventScope(user) {
  if (!user) return [];
  if (user.role === 'admin') return null;
  const tables = await Table.find({ owners: user.id }).select('_id').lean();
  return tables.map(t => t._id);
}

/** Whether the user can access reimbursement review APIs (admins + event owners only) */
async function canReviewReimbursements(user, request = null) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const table = await resolveReimbursementEvent(request);
  if (!table) return false;
  const uid = user.id.toString();
  return (table.owners || []).some(id => id.toString() === uid);
}

/**
 * Notify reviewers when a reimbursement request is submitted.
 * External app should call POST /api/reimbursements/submitted-hook after save.
 * Change stream / reconcile are fallbacks; atomic claim prevents double delivery.
 * @param {Object} options.force — skip duplicate check (admin resend only)
 */
async function notifyReimbursementSubmitted(request, options = {}) {
  const { force = false } = options;
  let notifyClaimed = false;
  try {
    const requestId = request._id.toString();

    if (!force) {
      const ReimbursementRequestModel = require('./models/ReimbursementRequest');
      const NotificationModel = require('./models/Notification');

      const alreadyMarked = await ReimbursementRequestModel.exists({
        _id: request._id,
        submissionNotifiedAt: { $exists: true, $ne: null }
      });
      if (alreadyMarked) {
        console.log(`📋 Reimbursement ${requestId} already notified — skipping (submissionNotifiedAt set)`);
        return;
      }

      // Legacy rows: notifications sent before submissionNotifiedAt existed
      const alreadyNotified = await NotificationModel.exists({
        type: 'reimbursement_submitted',
        'metadata.reimbursementId': requestId
      });
      if (alreadyNotified) {
        await ReimbursementRequestModel.updateOne(
          { _id: request._id, submissionNotifiedAt: { $exists: false } },
          { $set: { submissionNotifiedAt: new Date() } }
        );
        console.log(`📋 Reimbursement ${requestId} already notified — backfilled submissionNotifiedAt`);
        return;
      }

      // Atomic claim: only one of webhook / change stream / reconcile may proceed
      const claimed = await ReimbursementRequestModel.findOneAndUpdate(
        {
          _id: request._id,
          status: 'submitted',
          submissionNotifiedAt: { $exists: false }
        },
        { $set: { submissionNotifiedAt: new Date() } }
      );
      if (!claimed) {
        console.log(`📋 Reimbursement ${requestId} notify claim lost — skipping duplicate (parallel webhook/change stream)`);
        return;
      }
      notifyClaimed = true;
    }

    const reviewers = await getReimbursementReviewerUsers(request);
    if (!reviewers.length) {
      console.warn(`📋 Reimbursement ${requestId}: no reviewers (no admins and/or event owners)`);
      if (notifyClaimed) {
        const ReimbursementRequestModel = require('./models/ReimbursementRequest');
        await ReimbursementRequestModel.updateOne(
          { _id: request._id },
          { $unset: { submissionNotifiedAt: 1 } }
        );
        notifyClaimed = false;
      }
      return;
    }

    const { userName, userEmail } = await resolveReimbursementSubmitter(request);

    const table = await resolveReimbursementEvent(request);
    const eventName = request.eventName || table?.title || 'Unknown event';
    const amountStr = typeof request.totalAmount === 'number'
      ? `$${request.totalAmount.toFixed(2)}`
      : '';
    const message = [userName, eventName, amountStr].filter(Boolean).join(' — ');
    const recipientIds = reviewers.map(u => u._id.toString());

    await createNotificationBulk(recipientIds, {
      type: 'reimbursement_submitted',
      title: 'New Reimbursement Request',
      message,
      // actorId omitted so event owners who submitted still receive the alert
      eventId: request.eventId || table?._id || null,
      link: { page: 'reimbursements', params: { reimbursementId: requestId } },
      metadata: {
        reimbursementId: requestId,
        eventName,
        userName,
        totalAmount: request.totalAmount
      }
    });

    try {
      await sendReimbursementSubmittedEmails(request, reviewers, {
        userName,
        userEmail
      });
    } catch (emailErr) {
      console.error('📧 Reimbursement email batch failed (in-app notifications still sent):', emailErr);
    }

    console.log(`📋 Reimbursement alerts sent to ${recipientIds.length} reviewer(s) (in-app + email)`);
  } catch (err) {
    if (notifyClaimed) {
      try {
        const ReimbursementRequestModel = require('./models/ReimbursementRequest');
        await ReimbursementRequestModel.updateOne(
          { _id: request._id },
          { $unset: { submissionNotifiedAt: 1 } }
        );
      } catch (rollbackErr) {
        console.error('📋 Failed to release reimbursement notify claim:', rollbackErr);
      }
    }
    console.error('🔔 Failed to notify reviewers about reimbursement submission:', err);
  }
}

let reimbursementChangeStreamStarted = false;
let reimbursementReconcileInProgress = false;
let reimbursementReconcileLastRun = 0;
const REIMBURSE_RECONCILE_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Backfill notifications for submitted reimbursements that were never alerted.
 * Used on startup and when an admin opens reimbursements (debounced) — not on a timer.
 */
async function reconcileUnnotifiedReimbursementSubmissions(options = {}) {
  const { force = false } = options;
  if (reimbursementReconcileInProgress) return;

  const now = Date.now();
  if (!force && now - reimbursementReconcileLastRun < REIMBURSE_RECONCILE_COOLDOWN_MS) {
    return;
  }

  reimbursementReconcileInProgress = true;
  reimbursementReconcileLastRun = now;

  try {
    const missing = await ReimbursementRequest.find({
      status: 'submitted',
      submissionNotifiedAt: { $exists: false }
    }).lean();

    if (!missing.length) return;

    console.log(`📋 Reimbursement reconcile: ${missing.length} submitted request(s) without submissionNotifiedAt`);
    for (const request of missing) {
      await notifyReimbursementSubmitted(request);
    }
  } catch (err) {
    console.error('📋 Reimbursement reconcile failed:', err);
  } finally {
    reimbursementReconcileInProgress = false;
  }
}

/** One-time backfill after deploy (change stream / webhook may have missed prior submissions). */
function scheduleReimbursementReconcileOnStartup() {
  setTimeout(() => reconcileUnnotifiedReimbursementSubmissions({ force: true }), 5000);
  console.log('📋 Reimbursement reconcile scheduled once on startup');
}

/**
 * Watch reimbursementrequests collection for external-app submissions.
 * Fires when status becomes 'submitted' (insert or update).
 */
function setupReimbursementChangeStream() {
  if (reimbursementChangeStreamStarted) return;
  try {
    const collection = mongoose.connection.collection('reimbursementrequests');
    const pipeline = [
      {
        $match: {
          $or: [
            { operationType: 'insert', 'fullDocument.status': 'submitted' },
            { operationType: 'update', 'updateDescription.updatedFields.status': 'submitted' }
          ]
        }
      }
    ];

    const changeStream = collection.watch(pipeline, { fullDocument: 'updateLookup' });

    changeStream.on('change', async (change) => {
      let doc = change.fullDocument;
      if (!doc && change.documentKey?._id) {
        doc = await ReimbursementRequest.findById(change.documentKey._id).lean();
      }
      if (!doc || doc.status !== 'submitted') return;
      console.log('📋 Reimbursement submitted (change stream):', doc._id);
      await notifyReimbursementSubmitted(doc);
    });

    changeStream.on('error', (err) => {
      console.error('📋 Reimbursement change stream error:', err);
    });

    reimbursementChangeStreamStarted = true;
    console.log('📋 Reimbursement change stream watcher started');
  } catch (err) {
    console.warn('📋 Could not start reimbursement change stream (requires replica set):', err.message);
    console.warn('📋 Use /api/reimbursements/submitted-hook from the submit app, or reconcile on startup / reimbursements page load');
  }
  scheduleReimbursementReconcileOnStartup();
}

const User = require('./models/User');
const Invite = require('./models/Invite');
const Table = require('./models/Table');
const GearInventory = require('./models/GearInventory');
const GearPackage = require('./models/GearPackage');
const ReservedGearItem = require('./models/ReservedGearItem');
const PackageTemplate = require('./models/PackageTemplate');
const Cart = require('./models/Cart');
const FolderLog = require('./models/FolderLog');
const ManualReservation = require('./models/ManualReservation');
const FlightRequest = require('./models/FlightRequest');
const Passenger = require('./models/Passenger');
const Notification = require('./models/Notification');
const ReimbursementRequest = require('./models/ReimbursementRequest');
const PostProductionItem = require('./models/PostProductionItem');
const PostProductionUpdateRead = require('./models/PostProductionUpdateRead');
const PostProductionAssignmentSeen = require('./models/PostProductionAssignmentSeen');
const DashboardNavVisit = require('./models/DashboardNavVisit');
const CrewAvailabilityRequest = require('./models/CrewAvailabilityRequest');
const Feedback = require('./models/Feedback');
const Client = require('./models/Client');
const VideoProject = require('./models/VideoProject');
const VideoComment = require('./models/VideoComment');
const VideoPortalActivity = require('./models/VideoPortalActivity');



// Connect to MongoDB
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('MONGO_URI environment variable is not set!');
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected');
    // Fix the serial number index issue
    const { fixSerialIndex } = require('./fix-index-on-startup');
    await fixSerialIndex(mongoose);
    const startupAdmins = await findSystemAdminUsers();
    console.log(
      '🔔 System admins at startup:',
      startupAdmins.map(a => `${a.fullName} <${a.email}> [${a._id}]`).join('; ') || '(none)'
    );
    setupReimbursementChangeStream();
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  
  // Extract token from "Bearer <token>" format
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    if (user?.id) user.id = user.id.toString();
    req.user = user;
    next();
  });
}

// Helper function to check if user has access to an event (admin, owner, lead, or shared)
function hasEventAccess(table, user, requireOwner = false) {
  if (!table || !user) return false;
  
  // Admin users have access to all events
  if (user.role === 'admin') return true;
  
  const userId = user.id;
  const isOwner = table.owners && table.owners.map(String).includes(userId);
  
  if (requireOwner) {
    return isOwner;
  }
  
  const isLead = table.leads && table.leads.map(String).includes(userId);
  const isShared = table.sharedWith && table.sharedWith.map(String).includes(userId);
  const isCrew = isAssignedCrewMember(table, user);
  
  return isOwner || isLead || isShared || isCrew;
}

/** True if the user appears on the event crew schedule (rows.userId). */
function isAssignedCrewMember(table, user) {
  if (!table || !user) return false;
  const userId = String(user.id);
  return (table.rows || []).some(r => r.userId && String(r.userId) === userId);
}

/**
 * Can create/rename/delete gear lists, edit dates, reserve items, and manage
 * manual items for an event.
 * Admins: any event. Production managers / owners / leads / shared / crew: events they belong to.
 */
function canManageEventGearLists(table, user) {
  if (!table || !user) return false;
  if (user.role === 'admin') return true;
  // Production managers (and other members) manage gear on events they're on
  return hasEventAccess(table, user);
}

/** Can edit global gear inventory (catalog, notes, repairs, manual reservations). */
function canManageGearInventory(user) {
  return !!user && (user.role === 'admin' || user.role === 'production_manager');
}

// Read-only access check: planners can view all events, but cannot edit unless they are owners/leads/sharedWith
function hasEventReadAccess(table, user) {
  if (!table || !user) return false;
  
  // Admin and planner users have read access to all events
  if (user.role === 'admin' || user.role === 'planner') return true;
  
  // Otherwise, fall back to normal access check
  return hasEventAccess(table, user);
}

// AUTH
function buildInviteRegisterUrl(token) {
  const base = (process.env.APP_URL || 'https://beta.lumdash.app').replace(/\/$/, '');
  return `${base}/register.html?invite=${encodeURIComponent(token)}`;
}

async function sendInviteEmail(invite, inviteUrl, inviterName) {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) return;
  const to = invite.email.trim().toLowerCase();
  if (!to) return;
  try {
    await sgMail.send({
      to,
      from: SENDGRID_FROM,
      subject: 'You\'re invited to LumDash',
      html: `
        <p>Hello,</p>
        <p>${inviterName || 'An administrator'} invited you to join LumDash as a <strong>${invite.role}</strong>.</p>
        <p><a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#CC0007;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Create your account</a></p>
        <p>Or copy this link: ${inviteUrl}</p>
        <p>This invite expires on ${invite.expiresAt.toLocaleDateString()}.</p>
      `,
      text: `You were invited to LumDash as ${invite.role}. Create your account: ${inviteUrl}`
    });
    console.log(`📧 Invite email sent to ${to}`);
  } catch (err) {
    console.error(`📧 Invite email failed for ${to}:`, err.response?.body || err.message || err);
  }
}

app.get('/api/invites/validate/:token', async (req, res) => {
  try {
    const invite = await Invite.findOne({ token: String(req.params.token || '').trim() });
    if (!invite || !invite.isActive()) {
      return res.status(404).json({ valid: false, error: 'Invalid or expired invite' });
    }
    const existing = await User.findOne({ email: invite.email });
    if (existing) {
      return res.status(400).json({ valid: false, error: 'An account with this email already exists' });
    }
    res.json({
      valid: true,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt
    });
  } catch (err) {
    console.error('Invite validate error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const normalizedEmail = String(req.body.email || '').trim().toLowerCase();
    const fullName = String(req.body.fullName || '').trim();
    const password = String(req.body.password || '');
    const inviteToken = String(req.body.inviteToken || '').trim();

    if (!normalizedEmail || !fullName || !password) {
      return res.status(400).json({ error: 'Email, full name, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (await User.findOne({ email: normalizedEmail })) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const userCount = await User.countDocuments();
    let invite = null;

    if (userCount > 0) {
      if (!inviteToken) {
        return res.status(403).json({ error: 'Registration is invite-only. Use the link from your administrator.' });
      }
      invite = await Invite.findOne({ token: inviteToken });
      if (!invite || !invite.isActive()) {
        return res.status(400).json({ error: 'Invalid or expired invite' });
      }
      if (invite.email !== normalizedEmail) {
        return res.status(400).json({ error: 'Email must match the invited address' });
      }
    }

    const hashed = await bcrypt.hash(password, 10);
    const role = invite ? invite.role : 'admin';

    const user = new User({
      email: normalizedEmail,
      password: hashed,
      fullName,
      role
    });
    await user.save();

    if (invite) {
      invite.usedAt = new Date();
      invite.usedBy = user._id;
      await invite.save();
    }

    io.emit('usersChanged');
    res.json({ message: 'User created' });
  } catch (err) {
    console.error('Register error:', err);
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/invites', authenticate, async (req, res) => {
  try {
    if (!/^admin$/i.test(req.user.role || '')) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const invites = await Invite.find()
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('createdBy', 'fullName email')
      .populate('usedBy', 'fullName email')
      .lean();

    res.json({
      invites: invites.map(inv => ({
        _id: inv._id,
        email: inv.email,
        token: inv.token,
        role: inv.role,
        expiresAt: inv.expiresAt,
        usedAt: inv.usedAt,
        revokedAt: inv.revokedAt,
        createdAt: inv.createdAt,
        createdByName: inv.createdBy?.fullName || inv.createdBy?.email || '',
        usedByName: inv.usedBy?.fullName || inv.usedBy?.email || '',
        status: inv.revokedAt ? 'revoked' : inv.usedAt ? 'used' : (new Date(inv.expiresAt) <= new Date() ? 'expired' : 'pending'),
        inviteUrl: buildInviteRegisterUrl(inv.token)
      }))
    });
  } catch (err) {
    console.error('List invites error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/invites', authenticate, async (req, res) => {
  try {
    if (!/^admin$/i.test(req.user.role || '')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const email = String(req.body.email || '').trim().toLowerCase();
    const role = ['user', 'planner', 'admin', 'production_manager'].includes(req.body.role) ? req.body.role : 'user';
    const sendEmail = req.body.sendEmail !== false;
    const expiresInDays = Math.min(Math.max(parseInt(req.body.expiresInDays, 10) || 7, 1), 30);

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (await User.findOne({ email })) {
      return res.status(400).json({ error: 'A user with this email already exists' });
    }

    const pending = await Invite.findOne({
      email,
      usedAt: null,
      revokedAt: null,
      expiresAt: { $gt: new Date() }
    });
    if (pending) {
      return res.status(400).json({ error: 'A pending invite already exists for this email' });
    }

    const inviter = await User.findById(req.user.id).select('fullName email').lean();
    const invite = await Invite.create({
      email,
      role,
      createdBy: req.user.id,
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    });

    const inviteUrl = buildInviteRegisterUrl(invite.token);
    if (sendEmail) {
      await sendInviteEmail(invite, inviteUrl, inviter?.fullName || inviter?.email);
    }

    res.status(201).json({
      invite: {
        _id: invite._id,
        email: invite.email,
        token: invite.token,
        role: invite.role,
        expiresAt: invite.expiresAt,
        inviteUrl,
        status: 'pending'
      }
    });
  } catch (err) {
    console.error('Create invite error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/invites/:id', authenticate, async (req, res) => {
  try {
    if (!/^admin$/i.test(req.user.role || '')) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const invite = await Invite.findById(req.params.id);
    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    if (invite.usedAt) {
      return res.status(400).json({ error: 'Cannot revoke an invite that was already used' });
    }
    invite.revokedAt = new Date();
    await invite.save();
    res.json({ message: 'Invite revoked' });
  } catch (err) {
    console.error('Revoke invite error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/bootstrap-status', async (req, res) => {
  try {
    const count = await User.countDocuments();
    res.json({ allowOpenRegistration: count === 0, userCount: count });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: user._id.toString(), fullName: user.fullName, role: user.role },
    process.env.JWT_SECRET
  );
  res.json({ token, fullName: user.fullName, role: user.role });
});

// ===========================================
// AUTH REDIRECT - For Cross-App Authentication
// Allows external apps (like LumQuote) to get a valid token via redirect
// Flow: ExternalApp -> LumDash /auth/redirect -> Frontend auth-redirect.html handles the logic
// ===========================================
app.get('/auth/redirect', (req, res) => {
  const { callback, app } = req.query;
  
  if (!callback) {
    return res.status(400).send('Missing callback parameter');
  }
  
  // Validate callback URL is from allowed origins
  const allowedCallbackDomains = [
    'lumquote.com',
    'www.lumquote.com',
    'quote-generator-kixj.onrender.com', // LumQuote production
    'localhost',
    '127.0.0.1'
  ];
  
  try {
    const callbackUrl = new URL(callback);
    const isAllowed = allowedCallbackDomains.some(domain => 
      callbackUrl.hostname === domain || callbackUrl.hostname.endsWith('.' + domain)
    );
    
    if (!isAllowed) {
      console.log('Auth redirect blocked for domain:', callbackUrl.hostname);
      return res.status(403).send('Callback domain not allowed');
    }
  } catch (e) {
    return res.status(400).send('Invalid callback URL');
  }
  
  // Redirect to frontend auth-redirect page which handles the token check
  // (Token is stored in localStorage on the frontend, not accessible from backend)
  // Use the request's host to determine the correct frontend URL for local development
  const requestHost = req.get('host');
  let frontendUrl;
  
  if (requestHost && (requestHost.includes('localhost') || requestHost.includes('127.0.0.1'))) {
    // Local development - use the same host
    const protocol = req.protocol || 'http';
    frontendUrl = `${protocol}://${requestHost}`;
  } else {
    // Production - use APP_URL or default to beta.lumdash.app
    frontendUrl = process.env.APP_URL || 'https://beta.lumdash.app';
  }
  
  const redirectUrl = `${frontendUrl}/auth-redirect.html?callback=${encodeURIComponent(callback)}&app=${encodeURIComponent(app || 'external')}`;
  
  console.log(`Auth redirect: ${requestHost} -> ${redirectUrl}`);
  return res.redirect(redirectUrl);
});

// Verify token endpoint (for external apps to validate tokens)
app.get('/api/auth/verify', authenticate, (req, res) => {
  res.json({ 
    valid: true, 
    user: {
      id: req.user.id,
      fullName: req.user.fullName,
      role: req.user.role
    }
  });
});

// Forgot Password Endpoint
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) {
    // For security, always respond with success
    return res.json({ message: 'If that email is registered, a reset link has been sent.' });
  }
  const token = require('crypto').randomBytes(32).toString('hex');
  user.resetPasswordToken = token;
  user.resetPasswordExpires = Date.now() + 1000 * 60 * 60; // 1 hour
  await user.save();

  const resetUrl = `${process.env.APP_URL}/reset-password.html?token=${token}`;
  const msg = {
    to: user.email,
    from: SENDGRID_FROM,
    subject: 'Password Reset Request',
    html: `<p>You requested a password reset for your LumDash account.</p>
           <p><a href="${resetUrl}">Click here to reset your password</a></p>
           <p>If you did not request this, you can ignore this email.</p>`
  };
  try {
    await sgMail.send(msg);
    res.json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    console.error('SendGrid error:', err);
    res.status(500).json({ error: 'Failed to send reset email.' });
  }
});

// Reset Password Endpoint
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  const user = await User.findOne({
    resetPasswordToken: token,
    resetPasswordExpires: { $gt: Date.now() }
  });
  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired token.' });
  }
  user.password = await bcrypt.hash(password, 10);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();
  res.json({ message: 'Password has been reset.' });
});

// ========================================
// NOTIFICATION ENDPOINTS
// ========================================

// GET /api/users/me/notification-debug — Diagnose notification delivery for current user
app.get('/api/users/me/notification-debug', authenticate, async (req, res) => {
  try {
    const dbUser = await User.findById(req.user.id).select('_id email fullName role').lean();
    const admins = await findSystemAdminUsers();
    const adminIds = admins.map(a => a._id.toString());
    const recipientId = toRecipientId(req.user.id);

    const [myReimbNotifs, totalNotifs] = await Promise.all([
      Notification.find({ recipient: recipientId, type: 'reimbursement_submitted' })
        .sort({ createdAt: -1 }).limit(5).lean(),
      Notification.countDocuments({ recipient: recipientId })
    ]);

    res.json({
      sessionUserId: req.user.id,
      sessionRole: req.user.role,
      dbUser: dbUser ? {
        id: dbUser._id.toString(),
        email: dbUser.email,
        fullName: dbUser.fullName,
        role: dbUser.role
      } : null,
      isListedAsSystemAdmin: adminIds.includes(req.user.id.toString()),
      systemAdmins: admins.map(a => ({
        id: a._id.toString(),
        email: a.email,
        fullName: a.fullName,
        role: a.role
      })),
      reimbursementNotificationsForYou: myReimbNotifs.length,
      totalNotificationsForYou: totalNotifs,
      recentReimbursementNotifications: myReimbNotifs.map(n => ({
        id: n._id,
        title: n.title,
        createdAt: n.createdAt
      }))
    });
  } catch (err) {
    console.error('Notification debug error:', err);
    res.status(500).json({ error: 'Debug failed', details: err.message });
  }
});

// GET /api/notifications — Fetch current user's notifications
app.get('/api/notifications', authenticate, async (req, res) => {
  try {
    const { unreadOnly, limit = 50, offset = 0 } = req.query;
    const recipientId = toRecipientId(req.user.id);
    if (!recipientId) {
      return res.status(400).json({ error: 'Invalid user id in session' });
    }

    const filter = { recipient: recipientId };
    if (unreadOnly === 'true') filter.read = false;

    const [notifications, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(Number(offset))
        .limit(Number(limit))
        .populate('actor', 'fullName')
        .lean(),
      Notification.countDocuments({ recipient: recipientId, read: false })
    ]);

    res.json({ notifications, unreadCount });
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// PATCH /api/notifications/read-all — Mark all notifications as read
// IMPORTANT: This must come BEFORE the :id route to avoid "read-all" matching as an :id
app.patch('/api/notifications/read-all', authenticate, async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { recipient: toRecipientId(req.user.id), read: false },
      { read: true }
    );
    res.json({ message: 'All notifications marked as read', modified: result.modifiedCount });
  } catch (err) {
    console.error('Error marking all notifications as read:', err);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// PATCH /api/notifications/:id/read — Mark one notification as read
app.patch('/api/notifications/:id/read', authenticate, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: toRecipientId(req.user.id) },
      { read: true },
      { new: true }
    );
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    res.json({ notification });
  } catch (err) {
    console.error('Error marking notification as read:', err);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// DELETE /api/notifications/:id — Delete a single notification
app.delete('/api/notifications/:id', authenticate, async (req, res) => {
  try {
    const result = await Notification.findOneAndDelete({
      _id: req.params.id,
      recipient: toRecipientId(req.user.id)
    });
    if (!result) return res.status(404).json({ error: 'Notification not found' });
    res.json({ message: 'Notification deleted' });
  } catch (err) {
    console.error('Error deleting notification:', err);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// DELETE /api/notifications — Delete all notifications for current user
app.delete('/api/notifications', authenticate, async (req, res) => {
  try {
    const result = await Notification.deleteMany({
      recipient: toRecipientId(req.user.id)
    });
    res.json({ message: 'All notifications deleted', deleted: result.deletedCount });
  } catch (err) {
    console.error('Error deleting all notifications:', err);
    res.status(500).json({ error: 'Failed to delete notifications' });
  }
});

// ========================================
// OWNER ACCESS REQUEST ENDPOINTS
// ========================================

// Request owner access to an event
app.post('/api/tables/:id/request-owner', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) return res.status(404).json({ error: 'Event not found' });

    const userId = req.user.id;

    // Must be a planner or admin to request
    if (!['planner', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only planners and admins can request owner access' });
    }

    // Already an owner?
    if (table.owners.some(id => id.toString() === userId)) {
      return res.status(400).json({ error: 'You are already an owner of this event' });
    }

    // Already have a pending request?
    const pendingRequest = (table.ownerRequests || []).find(
      r => r.userId.toString() === userId && r.status === 'pending'
    );
    if (pendingRequest) {
      return res.status(400).json({ error: 'You already have a pending request for this event' });
    }

    // Add the request
    table.ownerRequests = table.ownerRequests || [];
    table.ownerRequests.push({ userId });
    await table.save();

    // Get the new request's _id
    const newRequest = table.ownerRequests[table.ownerRequests.length - 1];

    // Notify the primary (first) owner
    const primaryOwnerId = table.owners[0];
    if (primaryOwnerId) {
      const requester = await User.findById(userId).select('fullName');
      await createNotification({
        recipientId: primaryOwnerId,
        type: 'owner_request',
        title: 'Owner Access Requested',
        message: `${requester?.fullName || 'A planner'} is requesting owner access to "${table.title || 'an event'}"`,
        link: { page: 'events', eventId: req.params.id, params: { ownerRequestId: newRequest._id.toString() } },
        actorId: userId,
        eventId: req.params.id,
        metadata: { requestId: newRequest._id.toString(), requesterId: userId, eventTitle: table.title }
      });
    }

    console.log(`🔑 Owner access requested by ${userId} for event ${req.params.id}`);
    res.json({ message: 'Owner access request sent', requestId: newRequest._id });
  } catch (err) {
    console.error('Error requesting owner access:', err);
    res.status(500).json({ error: 'Failed to submit owner access request' });
  }
});

// Approve owner access request
app.post('/api/tables/:id/owner-requests/:requestId/approve', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) return res.status(404).json({ error: 'Event not found' });

    // Only current owners can approve
    const isOwner = table.owners.some(id => id.toString() === req.user.id);
    if (!isOwner) {
      return res.status(403).json({ error: 'Only event owners can approve owner requests' });
    }

    // Find the request
    const request = (table.ownerRequests || []).find(
      r => r._id.toString() === req.params.requestId && r.status === 'pending'
    );
    if (!request) {
      return res.status(404).json({ error: 'Pending request not found' });
    }

    // Approve: update request status
    request.status = 'approved';
    request.resolvedAt = new Date();

    // Add user to owners (and remove from leads/sharedWith if present)
    const requesterId = request.userId;
    if (!table.owners.some(id => id.equals(requesterId))) {
      table.owners.push(requesterId);
    }
    table.leads = table.leads.filter(id => !id.equals(requesterId));
    table.sharedWith = table.sharedWith.filter(id => !id.equals(requesterId));

    await table.save();
    notifyDataChange('tableUpdated', { tableId: table._id });

    // Notify the requester
    await createNotification({
      recipientId: requesterId,
      type: 'owner_request_approved',
      title: 'Owner Access Approved!',
      message: `Your request for owner access to "${table.title || 'an event'}" has been approved`,
      link: { page: 'general', eventId: req.params.id },
      actorId: req.user.id,
      eventId: req.params.id,
      metadata: { eventTitle: table.title }
    });

    console.log(`✅ Owner access approved for user ${requesterId} on event ${req.params.id}`);
    res.json({ message: 'Owner access approved' });
  } catch (err) {
    console.error('Error approving owner request:', err);
    res.status(500).json({ error: 'Failed to approve owner request' });
  }
});

// Admin: Add self as owner (no approval needed)
app.post('/api/tables/:id/add-me-as-owner', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can directly add themselves as owner' });
    }

    const table = await Table.findById(req.params.id);
    if (!table) return res.status(404).json({ error: 'Event not found' });

    const userId = req.user.id;

    // Already an owner?
    if (table.owners.some(id => id.toString() === userId)) {
      return res.status(400).json({ error: 'You are already an owner of this event' });
    }

    // Add to owners and remove from leads/sharedWith if present
    table.owners.push(userId);
    table.leads = table.leads.filter(id => id.toString() !== userId);
    table.sharedWith = table.sharedWith.filter(id => id.toString() !== userId);

    await table.save();
    notifyDataChange('tableUpdated', { tableId: table._id });

    console.log(`🔑 Admin ${userId} added self as owner of event ${req.params.id}`);
    res.json({ message: 'You have been added as an owner' });
  } catch (err) {
    console.error('Error adding admin as owner:', err);
    res.status(500).json({ error: 'Failed to add as owner' });
  }
});

// Deny owner access request
app.post('/api/tables/:id/owner-requests/:requestId/deny', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) return res.status(404).json({ error: 'Event not found' });

    // Only current owners can deny
    const isOwner = table.owners.some(id => id.toString() === req.user.id);
    if (!isOwner) {
      return res.status(403).json({ error: 'Only event owners can deny owner requests' });
    }

    // Find the request
    const request = (table.ownerRequests || []).find(
      r => r._id.toString() === req.params.requestId && r.status === 'pending'
    );
    if (!request) {
      return res.status(404).json({ error: 'Pending request not found' });
    }

    // Deny: update request status
    request.status = 'denied';
    request.resolvedAt = new Date();
    await table.save();

    // Notify the requester
    await createNotification({
      recipientId: request.userId,
      type: 'owner_request_denied',
      title: 'Owner Access Denied',
      message: `Your request for owner access to "${table.title || 'an event'}" was denied`,
      link: { page: 'events' },
      actorId: req.user.id,
      eventId: req.params.id,
      metadata: { eventTitle: table.title }
    });

    console.log(`❌ Owner access denied for user ${request.userId} on event ${req.params.id}`);
    res.json({ message: 'Owner access request denied' });
  } catch (err) {
    console.error('Error denying owner request:', err);
    res.status(500).json({ error: 'Failed to deny owner request' });
  }
});

// ========================================
// LUMA AI CHAT
// IMPORTANT: /api/chat/global must be defined BEFORE /api/chat/:tableId
// ========================================

async function streamLumaResponse(res, messages) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });

  const stream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    max_tokens: 800,
    temperature: 0.4,
    stream: true
  });

  let fullResponse = '';
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    if (content) {
      fullResponse += content;
      res.write(`data: ${JSON.stringify({ content, done: false })}\n\n`);
    }
  }
  res.write(`data: ${JSON.stringify({ content: '', done: true, fullResponse })}\n\n`);
  res.end();
}

function lumaChatErrorMessage(error) {
  if (error.status === 429) {
    return 'OpenAI quota exceeded. Please add billing to your OpenAI account at platform.openai.com/billing';
  }
  if (error.status === 401) {
    return 'Invalid OpenAI API key. Please check your configuration.';
  }
  if (error.message?.includes('context_length_exceeded')) {
    return 'Query too complex. Try asking a more specific question.';
  }
  return 'AI service temporarily unavailable. Please try again.';
}

async function handleLumaChatError(res, error, label) {
  console.error(label, error);
  const errorMessage = lumaChatErrorMessage(error);
  try {
    res.write(`data: ${JSON.stringify({ error: errorMessage, done: true })}\n\n`);
    res.end();
  } catch (writeError) {
    if (!res.headersSent) {
      res.status(500).json({ error: errorMessage });
    }
  }
}

app.post('/api/chat/global', authenticate, async (req, res) => {
  try {
    const { message, conversationHistory = [], pageContext = {} } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (!openai) {
      return res.status(503).json({
        error: 'AI chat feature is not available. Please configure OpenAI API key.'
      });
    }

    const { systemPrompt, knowledgeBase, page } = await buildLumaContext({
      message,
      pageContext,
      user: req.user,
      mode: 'global'
    });

    const kbSize = JSON.stringify(knowledgeBase).length;
    console.log(`[Luma] global page=${page} | KB ${(kbSize / 1024).toFixed(1)}KB`);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-6),
      { role: 'user', content: message }
    ];

    await streamLumaResponse(res, messages);
  } catch (error) {
    await handleLumaChatError(res, error, 'Global chat error:');
  }
});

app.post('/api/chat/:tableId', authenticate, async (req, res) => {
  try {
    const { message, conversationHistory = [], pageContext = {} } = req.body;
    const tableId = req.params.tableId;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (!openai) {
      return res.status(503).json({
        error: 'AI chat feature is not available. Please configure OpenAI API key.'
      });
    }

    const table = await Table.findById(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }
    if (!hasEventReadAccess(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized to access this event' });
    }

    const isAdmin = req.user.role === 'admin';
    const isOwner = Array.isArray(table.owners) && table.owners.map(o => o.toString()).includes(req.user.id);
    const canSeeAdminData = isOwner || isAdmin;

    const { systemPrompt, knowledgeBase, page } = await buildLumaContext({
      message,
      pageContext,
      user: req.user,
      mode: 'event',
      table,
      canSeeAdminData
    });

    const kbSize = JSON.stringify(knowledgeBase).length;
    console.log(`[Luma] event=${table.title} page=${page} | KB ${(kbSize / 1024).toFixed(1)}KB`);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-6),
      { role: 'user', content: message }
    ];

    await streamLumaResponse(res, messages);
  } catch (error) {
    await handleLumaChatError(res, error, 'Chat API error:');
  }
});

// TABLE ROUTES
app.post('/api/tables', authenticate, async (req, res) => {
  const { title, general } = req.body;

  const table = new Table({
    title,
    owners: [req.user.id],  // ✅ Corrected here
    sharedWith: [],
    rows: [],
    general: {
      client: general?.client || '',
      company: general?.company || '',
      city: general?.city || '',
      state: general?.state || '',
      start: general?.start || '',
      end: general?.end || ''
    },
    gear: {
      lists: {
        Default: {
          Cameras: [],
          Lenses: [],
          Lighting: [],
          Support: [],
          Accessories: []
        }
      }
    }
  });

  // Initialize default gear list
  if (!table.gear) {
    table.gear = {};
  }
  if (!table.gear.gearLists) {
    table.gear.gearLists = [{
      name: 'Main List',
      createdBy: req.user.id,
      createdAt: new Date()
    }];
  }
  if (!table.gear.currentList) {
    table.gear.currentList = 'Main List';
  }
  
  await table.save();
  
  // Notify clients about the new table
  notifyDataChange('tableCreated', { tableId: table._id });
  
  res.json(table);
});

// ===========================================
// EXTERNAL EVENT CREATION API
// Allows external apps (like Invoice App) to create events in LumDash
// Both apps must share the same JWT_SECRET and users collection
// ===========================================
app.post('/api/events/external-create', authenticate, async (req, res) => {
  try {
    const { 
      name,           // Required: Event name
      startDate,      // Optional: Start date (YYYY-MM-DD or ISO format)
      endDate,        // Optional: End date (YYYY-MM-DD or ISO format)
      city,           // Optional: City
      state,          // Optional: State
      client,         // Optional: Client name
      company,        // Optional: Company name
      companyName,    // Optional alias used by LumQuote
      location,       // Optional: Location/venue name
      externalSource, // Required: Source app identifier (e.g., 'invoice-app')
      externalId      // Optional: ID from source app for linking/dedup
    } = req.body;
    
    // Validate required fields
    if (!name || name.trim() === '') {
      return res.status(400).json({ 
        success: false,
        error: 'Event name is required' 
      });
    }
    
    if (!externalSource) {
      return res.status(400).json({ 
        success: false,
        error: 'externalSource is required (e.g., "invoice-app")' 
      });
    }
    
    // Check for duplicate (prevent double-transfers)
    if (externalId) {
      const existing = await Table.findOne({ 
        externalId: externalId,
        externalSource: externalSource 
      });
      
      if (existing) {
        console.log(`External event already exists: ${existing.title} (${existing._id}) from ${externalSource}:${externalId}`);
        return res.json({ 
          success: true, 
          eventId: existing._id.toString(),
          alreadyExists: true,
          message: 'Event already exists',
          redirectUrl: `/dashboard.html#general?id=${existing._id}`
        });
      }
    }
    
    // Create the event
    const newTable = new Table({
      title: name.trim(),
      owners: [req.user.id],
      leads: [],
      sharedWith: [],
      rows: [],
      externalSource: externalSource,
      externalId: externalId || null,
      general: {
        start: startDate || '',
        end: endDate || '',
        city: city || '',
        state: state || '',
        client: client || '',
        company: company || companyName || '',
        location: location || ''
      },
      executiveSummary: {
        company: company || companyName || ''
      },
      gear: {
        lists: {
          Default: {
            Cameras: [],
            Lenses: [],
            Lighting: [],
            Support: [],
            Accessories: []
          }
        },
        gearLists: [{
          name: 'Main List',
          createdBy: req.user.id,
          createdAt: new Date()
        }],
        currentList: 'Main List'
      }
    });
    
    await newTable.save();
    
    // Notify clients about the new table
    notifyDataChange('tableCreated', { tableId: newTable._id });
    
    console.log(`External event created: "${newTable.title}" (${newTable._id}) by user ${req.user.id} from ${externalSource}${externalId ? `:${externalId}` : ''}`);
    
    res.json({ 
      success: true, 
      eventId: newTable._id.toString(),
      alreadyExists: false,
      message: 'Event created successfully',
      redirectUrl: `/dashboard.html#general?id=${newTable._id}`
    });
    
  } catch (err) {
    console.error('External create error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to create event' 
    });
  }
});

app.get('/api/tables', authenticate, async (req, res) => {
  try {
    // Get the user to check their archived events and role
    const User = require('./models/User');
    const user = await User.findById(req.user.id);
    
    let tables;
    
    // Admin and planner users can see ALL events
    if (req.user.role === 'admin' || req.user.role === 'planner') {
      tables = await Table.find({}).populate('owners', 'fullName');
    } else {
      // Regular users: own / shared / lead / assigned on crew schedule
      tables = await Table.find({
      $or: [
        { owners: req.user.id },
        { sharedWith: req.user.id },
        { leads: req.user.id },
        { 'rows.userId': req.user.id }
      ]
      }).populate('owners', 'fullName');
    }

    // Add user-specific archive status to each table
    const tablesWithUserArchiveStatus = tables.map(table => {
      const tableObj = table.toObject();
      // Convert ObjectIds to strings for comparison
      // Handle case where user.archivedEvents doesn't exist (for existing users in production)
      const userArchivedEvents = user && user.archivedEvents ? user.archivedEvents : [];
      const userArchivedIds = userArchivedEvents.map(id => id.toString());
      tableObj.userArchived = userArchivedIds.includes(table._id.toString());
      
      // Extract owner names for display
      tableObj.ownerNames = (tableObj.owners || [])
        .filter(owner => owner && owner.fullName)
        .map(owner => owner.fullName);
      
      return tableObj;
    });

    res.json(tablesWithUserArchiveStatus);
  } catch (error) {
    console.error('Error fetching tables:', error);
    res.status(500).json({ error: 'Failed to fetch tables' });
  }
});

app.get('/api/tables/:id', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  const table = await Table.findById(req.params.id);
  if (!table) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  if (!hasEventReadAccess(table, req.user)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  res.json(table);
});

// --- TOGGLE BADGE NOT-REQUIRED STATUS ---
app.patch('/api/tables/:id/badge-required', authenticate, async (req, res) => {
  try {
    const { badge } = req.body; // 'flight', 'hotel', 'share', 'schedule', 'gear'
    const validBadges = ['flight', 'hotel', 'share', 'schedule', 'gear'];
    
    if (!badge || !validBadges.includes(badge)) {
      return res.status(400).json({ error: 'Invalid badge type. Must be one of: ' + validBadges.join(', ') });
    }
    
    const table = await Table.findById(req.params.id);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Only owners and admins can toggle badge requirements
    const isOwner = Array.isArray(table.owners) && table.owners.map(o => o.toString()).includes(req.user.id);
    const isAdmin = req.user.role === 'admin';
    
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Only owners and admins can change badge requirements' });
    }
    
    // Initialize badgesNotRequired if it doesn't exist
    if (!table.badgesNotRequired) {
      table.badgesNotRequired = {};
    }
    
    // Toggle the badge's not-required status
    table.badgesNotRequired[badge] = !table.badgesNotRequired[badge];
    // Clear "requested" mark when marking not required
    if (table.badgesNotRequired[badge] && table.badgesRequested?.[badge]) {
      table.badgesRequested[badge] = false;
      table.markModified('badgesRequested');
    }
    await table.save();
    
    notifyDataChange('badgeRequirementChanged', { 
      badge, 
      notRequired: table.badgesNotRequired[badge] 
    }, req.params.id);
    
    res.json({ 
      badge, 
      notRequired: table.badgesNotRequired[badge],
      badgesNotRequired: table.badgesNotRequired,
      badgesRequested: table.badgesRequested || {}
    });
  } catch (error) {
    console.error('Error toggling badge requirement:', error);
    res.status(500).json({ error: 'Failed to update badge requirement' });
  }
});

// --- TOGGLE BADGE REQUESTED MARK (manual flag, e.g. hotels awaiting info) ---
app.patch('/api/tables/:id/badge-requested', authenticate, async (req, res) => {
  try {
    const { badge, requested } = req.body;
    const validBadges = ['hotel'];

    if (!badge || !validBadges.includes(badge)) {
      return res.status(400).json({ error: 'Invalid badge type. Must be one of: ' + validBadges.join(', ') });
    }

    const table = await Table.findById(req.params.id);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const isOwner = Array.isArray(table.owners) && table.owners.map(o => o.toString()).includes(req.user.id);
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Only owners and admins can change badge requested status' });
    }

    if (!table.badgesRequested) table.badgesRequested = {};
    const next = requested === undefined
      ? !table.badgesRequested[badge]
      : !!requested;
    table.badgesRequested[badge] = next;

    // Requested implies required — clear not-required if set
    if (next && table.badgesNotRequired?.[badge]) {
      table.badgesNotRequired[badge] = false;
      table.markModified('badgesNotRequired');
    }

    table.markModified('badgesRequested');
    await table.save();

    notifyDataChange('badgeRequestedChanged', {
      badge,
      requested: table.badgesRequested[badge]
    }, req.params.id);

    res.json({
      badge,
      requested: table.badgesRequested[badge],
      badgesRequested: table.badgesRequested,
      badgesNotRequired: table.badgesNotRequired || {}
    });
  } catch (error) {
    console.error('Error toggling badge requested:', error);
    res.status(500).json({ error: 'Failed to update badge requested status' });
  }
});

// --- TASKS ENDPOINTS (COLLABORATIVE TO-DO LIST) ---
// --- TODO LIST ENDPOINTS ---

// Get all todos across all events for the current user
app.get('/api/tasks/all', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    const myTasksOnly = req.query.myTasks === 'true';
    
    // Find all tables the user has access to
    let query = {};
    if (!isAdmin) {
      // Non-admins only see events they have access to
      query = {
        $or: [
          { owners: userId },
          { leads: userId },
          { sharedWith: userId }
        ]
      };
    }
    
    const tables = await Table.find(query)
      .populate('todos.owner', 'fullName photo email')
      .populate('owners', 'fullName')
      .select('title todos owners general');
    
    // Flatten todos from all tables and add event info
    let allTodos = [];
    
    for (const table of tables) {
      if (!table.todos || table.todos.length === 0) continue;
      
      const isOwner = table.owners.some(o => o._id.toString() === userId);
      
      for (const todo of table.todos) {
        // If myTasksOnly filter is on, only include tasks assigned to this user
        if (myTasksOnly && todo.owner && todo.owner._id.toString() !== userId) {
          continue;
        }
        
        allTodos.push({
          _id: todo._id.toString(),
          task: todo.task,
          status: todo.status,
          dueDate: todo.dueDate,
          owner: todo.owner,
          notes: todo.notes,
          createdAt: todo.createdAt,
          event: {
            _id: table._id.toString(),
            title: table.title || 'Untitled Event'
          },
          canEdit: isAdmin || isOwner,
          canChangeStatus: true
        });
      }
    }
    
    // Sort by due date (soonest first, nulls last), then alphabetically
    allTodos.sort((a, b) => {
      // Handle null due dates (put them last)
      if (!a.dueDate && !b.dueDate) {
        return (a.task || '').localeCompare(b.task || '');
      }
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      
      const dateCompare = new Date(a.dueDate) - new Date(b.dueDate);
      if (dateCompare !== 0) return dateCompare;
      
      // Secondary sort: alphabetical by task name
      return (a.task || '').localeCompare(b.task || '');
    });
    
    res.json({ 
      todos: allTodos,
      totalCount: allTodos.length,
      isAdmin
    });
  } catch (err) {
    console.error('Error fetching all todos:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===========================================
// PERSONAL TASKS - User-specific general tasks (not tied to events)
// ===========================================
const PersonalTask = require('./models/PersonalTask');

// Get all personal tasks for the current user
app.get('/api/personal-tasks', authenticate, async (req, res) => {
  try {
    const tasks = await PersonalTask.find({ user: req.user.id })
      .sort({ createdAt: -1 });
    
    res.json({ tasks });
  } catch (err) {
    console.error('Error fetching personal tasks:', err);
    res.status(500).json({ error: 'Failed to fetch personal tasks' });
  }
});

// Create a new personal task
app.post('/api/personal-tasks', authenticate, async (req, res) => {
  try {
    const { task, status, dueDate, notes } = req.body;
    
    if (!task || !task.trim()) {
      return res.status(400).json({ error: 'Task description is required' });
    }
    
    const newTask = new PersonalTask({
      user: req.user.id,
      task: task.trim(),
      status: status || 'todo',
      dueDate: dueDate || null,
      notes: notes || ''
    });
    
    await newTask.save();
    
    res.status(201).json({ task: newTask });
  } catch (err) {
    console.error('Error creating personal task:', err);
    res.status(500).json({ error: 'Failed to create personal task' });
  }
});

// Update a personal task
app.put('/api/personal-tasks/:id', authenticate, async (req, res) => {
  try {
    const { task, status, dueDate, notes } = req.body;
    
    const existingTask = await PersonalTask.findOne({ 
      _id: req.params.id, 
      user: req.user.id 
    });
    
    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Update fields if provided
    if (task !== undefined) existingTask.task = task.trim();
    if (status !== undefined) existingTask.status = status;
    if (dueDate !== undefined) existingTask.dueDate = dueDate || null;
    if (notes !== undefined) existingTask.notes = notes;
    
    await existingTask.save();
    
    res.json({ task: existingTask });
  } catch (err) {
    console.error('Error updating personal task:', err);
    res.status(500).json({ error: 'Failed to update personal task' });
  }
});

// Delete a personal task
app.delete('/api/personal-tasks/:id', authenticate, async (req, res) => {
  try {
    const result = await PersonalTask.findOneAndDelete({ 
      _id: req.params.id, 
      user: req.user.id 
    });
    
    if (!result) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    console.error('Error deleting personal task:', err);
    res.status(500).json({ error: 'Failed to delete personal task' });
  }
});

// ===========================================
// CALL TIMES - Get all crew call times across all events
// ===========================================
app.get('/api/calltimes/all', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const userFullName = req.user.fullName;
    const isAdmin = req.user.role === 'admin';
    const myCallsOnly = req.query.myCalls === 'true';
    const statusFilter = req.query.status || 'all'; // 'all', 'live', 'upcoming', 'past'
    const dateFilter = req.query.dateFilter || 'all'; // 'all', 'this-month', 'last-month', 'last-3-months', 'this-year', 'last-year', 'custom'
    const customStart = req.query.customStart; // ISO date string
    const customEnd = req.query.customEnd; // ISO date string
    
    // Find all tables the user has access to
    let query = {};
    if (!isAdmin) {
      // Non-admins only see events they have access to
      query = {
        $or: [
          { owners: userId },
          { leads: userId },
          { sharedWith: userId }
        ]
      };
    }
    
    const tables = await Table.find(query)
      .populate('owners', 'fullName')
      .select('title rows general');
    
    // Get today's date at midnight for comparisons (local time simulation)
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    
    // Calculate date filter range
    let filterStartDate = null;
    let filterEndDate = null;
    
    if (dateFilter === 'this-month') {
      filterStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
      filterEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (dateFilter === 'last-month') {
      filterStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      filterEndDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    } else if (dateFilter === 'last-3-months') {
      filterStartDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      filterEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (dateFilter === 'this-year') {
      filterStartDate = new Date(now.getFullYear(), 0, 1);
      filterEndDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    } else if (dateFilter === 'last-year') {
      filterStartDate = new Date(now.getFullYear() - 1, 0, 1);
      filterEndDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
    } else if (dateFilter === 'custom' && customStart && customEnd) {
      filterStartDate = new Date(customStart);
      filterEndDate = new Date(customEnd);
      filterEndDate.setHours(23, 59, 59, 999);
    }
    
    // Helper to parse date string as local date
    function parseLocalDate(dateStr) {
      if (!dateStr) return null;
      const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const [, year, month, day] = match;
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0, 0);
      }
      return new Date(dateStr);
    }
    
    // Flatten call times from all tables
    let allCallTimes = [];
    
    for (const table of tables) {
      if (!table.rows || table.rows.length === 0) continue;
      
      for (const row of table.rows) {
        // Skip if name doesn't exist
        if (!row.name) continue;
        
        // If myCallsOnly filter is on, only include calls for this user
        if (myCallsOnly && row.name.toLowerCase() !== userFullName.toLowerCase()) {
          continue;
        }
        
        // For non-admins, only show their own call times
        if (!isAdmin && row.name.toLowerCase() !== userFullName.toLowerCase()) {
          continue;
        }
        
        // Parse the crew call date
        const callDate = parseLocalDate(row.date);
        
        // Apply status filter based on crew call date
        if (statusFilter !== 'all' && callDate) {
          if (statusFilter === 'live') {
            // Live = call date is today
            if (callDate < todayStart || callDate > todayEnd) continue;
          } else if (statusFilter === 'upcoming') {
            // Upcoming = call date is after today
            if (callDate <= todayEnd) continue;
          } else if (statusFilter === 'past') {
            // Past = call date is before today
            if (callDate >= todayStart) continue;
          }
        }
        
        // Apply date range filter
        if (filterStartDate && filterEndDate && callDate) {
          if (callDate < filterStartDate || callDate > filterEndDate) continue;
        }
        
        allCallTimes.push({
          _id: row._id.toString(),
          name: row.name || '',
          date: row.date || '',
          startTime: row.startTime || '',
          endTime: row.endTime || '',
          totalHours: row.totalHours || 0,
          role: row.role || '',
          notes: row.notes || '',
          event: {
            _id: table._id.toString(),
            title: table.title || 'Untitled Event',
            city: table.general?.city || '',
            state: table.general?.state || ''
          }
        });
      }
    }
    
    // Sort by date (soonest first), then by event name
    allCallTimes.sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(0);
      const dateB = b.date ? new Date(b.date) : new Date(0);
      const dateCompare = dateA - dateB;
      if (dateCompare !== 0) return dateCompare;
      return (a.event.title || '').localeCompare(b.event.title || '');
    });
    
    res.json({ 
      callTimes: allCallTimes,
      totalCount: allCallTimes.length,
      isAdmin
    });
  } catch (err) {
    console.error('Error fetching all call times:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all todos for a table
app.get('/api/tables/:id/todos', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id).populate('todos.owner', 'fullName photo');
  if (!table) return res.status(404).json({ error: 'Table not found' });
    if (!hasEventReadAccess(table, req.user)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
    res.json({ todos: table.todos || [] });
  } catch (err) {
    console.error('Error fetching todos:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a new todo (owners and admins only)
app.post('/api/tables/:id/todos', authenticate, async (req, res) => {
  try {
  const table = await Table.findById(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
    
    // Only owners and admins can create todos
    if (!hasEventAccess(table, req.user, true)) {
      return res.status(403).json({ error: 'Only owners and admins can add tasks' });
  }
    
    const { task, status, dueDate, owner, notes } = req.body;
    if (!task) return res.status(400).json({ error: 'Task is required' });
    
    const newTodo = {
      task,
      status: status || 'todo',
      dueDate: dueDate ? new Date(dueDate) : null,
      owner: owner || null,
      notes: notes || '',
      createdBy: req.user.id,
      createdAt: new Date(),
      updatedAt: new Date()
  };
    
    table.todos.push(newTodo);
  await table.save();
    
    // Populate the owner before returning
    await table.populate('todos.owner', 'fullName photo');
    const savedTodo = table.todos[table.todos.length - 1];
    
    notifyDataChange('todoAdded', { todo: savedTodo }, req.params.id);
    
    // 🔔 Notify the assigned user (if different from creator)
    if (newTodo.owner && newTodo.owner.toString() !== req.user.id) {
      createNotification({
        recipientId: newTodo.owner,
        type: 'task_assigned',
        title: 'New task assigned to you',
        message: `"${task}" in ${table.title || 'an event'}`,
        link: { page: 'todos', eventId: req.params.id },
        actorId: req.user.id,
        eventId: req.params.id
      });
    }
    
    res.json({ todo: savedTodo });
  } catch (err) {
    console.error('Error creating todo:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update a todo
app.put('/api/tables/:id/todos/:todoId', authenticate, async (req, res) => {
  try {
  const table = await Table.findById(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
    
    const todo = table.todos.id(req.params.todoId);
    if (!todo) return res.status(404).json({ error: 'Todo not found' });
    
    const isOwnerOrAdmin = hasEventAccess(table, req.user, true);
    const isAssignee = todo.owner && todo.owner.toString() === req.user.id;
    
    // Regular users can only update status and notes on tasks assigned to them
    if (!isOwnerOrAdmin && !isAssignee) {
      return res.status(403).json({ error: 'Not authorized to edit this task' });
    }
    
    // 🔔 Track previous owner for notification
    const previousOwnerId = todo.owner ? todo.owner.toString() : null;
    
    // If not owner/admin, only allow status and notes changes
    if (!isOwnerOrAdmin) {
      if (typeof req.body.status === 'string' && ['todo', 'in-progress', 'done'].includes(req.body.status)) {
        todo.status = req.body.status;
      }
      if (typeof req.body.notes === 'string') {
        todo.notes = req.body.notes;
      }
    } else {
      // Owners/admins can update all fields
      if (typeof req.body.task === 'string') todo.task = req.body.task;
      if (typeof req.body.status === 'string' && ['todo', 'in-progress', 'done'].includes(req.body.status)) {
        todo.status = req.body.status;
      }
      if (req.body.dueDate !== undefined) {
        todo.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
      }
      if (req.body.owner !== undefined) {
        todo.owner = req.body.owner || null;
      }
      if (typeof req.body.notes === 'string') {
        todo.notes = req.body.notes;
      }
    }
    
    todo.updatedAt = new Date();
  await table.save();
    
    // Populate owner before returning
    await table.populate('todos.owner', 'fullName photo');
    const updatedTodo = table.todos.id(req.params.todoId);
    
    notifyDataChange('todoUpdated', { todo: updatedTodo }, req.params.id);
    
    // 🔔 Notify if task was reassigned to a new person
    const newOwnerId = todo.owner ? todo.owner.toString() : null;
    if (newOwnerId && newOwnerId !== previousOwnerId && newOwnerId !== req.user.id) {
      createNotification({
        recipientId: newOwnerId,
        type: 'task_assigned',
        title: 'Task assigned to you',
        message: `"${todo.task}" in ${table.title || 'an event'}`,
        link: { page: 'todos', eventId: req.params.id },
        actorId: req.user.id,
        eventId: req.params.id
      });
    }
    
    res.json({ todo: updatedTodo });
  } catch (err) {
    console.error('Error updating todo:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a todo (owners and admins only)
app.delete('/api/tables/:id/todos/:todoId', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) return res.status(404).json({ error: 'Table not found' });
    
    if (!hasEventAccess(table, req.user, true)) {
      return res.status(403).json({ error: 'Only owners and admins can delete tasks' });
    }
    
    const todoIndex = table.todos.findIndex(t => t._id && t._id.toString() === req.params.todoId);
    if (todoIndex === -1) {
      return res.status(404).json({ error: 'Todo not found' });
    }
    
    table.todos.splice(todoIndex, 1);
    await table.save();
    
    notifyDataChange('todoDeleted', { todoId: req.params.todoId }, req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting todo:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- ADMIN NOTES ENDPOINTS (MULTI-NOTE - Google Keep Style) ---
// Get all admin notes for a table (owners and admins only)
app.get('/api/tables/:id/admin-notes', authenticate, async (req, res) => {
  const table = await Table.findById(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  
  // Check if user is owner, admin, or planner (read access)
  const isOwner = table.owners.map(String).includes(req.user.id);
  const isAdmin = req.user.role === 'admin';
  const isPlanner = req.user.role === 'planner';
  
  if (!isOwner && !isAdmin && !isPlanner) {
    return res.status(403).json({ error: 'Only owners, admins, and planners can view admin notes' });
  }
  res.json({ adminNotes: table.adminNotes || [] });
});

// Add a new admin note (owners and admins only)
app.post('/api/tables/:id/admin-notes', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) return res.status(404).json({ error: 'Table not found' });
    
    // Check if user is owner or admin
    const isOwner = table.owners.map(String).includes(req.user.id);
    const isAdmin = req.user.role === 'admin';
    
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Only owners and admins can add admin notes' });
    }
    
    const { title, content, pinned, color } = req.body;
    
    // Get user name for the note
    const User = require('./models/User');
    const user = await User.findById(req.user.id);
    const userName = user ? user.name : 'Unknown';
    
    const note = {
      title: title || '',
      content: content || '',
      pinned: pinned || false,
      color: color || 'default',
      createdBy: req.user.id,
      createdByName: userName,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    table.adminNotes.push(note);
    await table.save();
    
    // Notify about notes change with tableId
    notifyDataChange('notesChanged', null, req.params.id);
    res.json({ adminNotes: table.adminNotes });
  } catch (err) {
    console.error('[ADMIN-NOTES] Error creating note:', err);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// Edit an admin note (owners and admins only)
app.put('/api/tables/:id/admin-notes/:noteId', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) return res.status(404).json({ error: 'Table not found' });
    
    // Check if user is owner or admin
    const isOwner = table.owners.map(String).includes(req.user.id);
    const isAdmin = req.user.role === 'admin';
    
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Only owners and admins can edit admin notes' });
    }
    
    const note = table.adminNotes.id(req.params.noteId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    
    // Update fields
    if (req.body.title !== undefined) note.title = req.body.title;
    if (req.body.content !== undefined) note.content = req.body.content;
    if (req.body.pinned !== undefined) note.pinned = req.body.pinned;
    if (req.body.color !== undefined) note.color = req.body.color;
    note.updatedAt = new Date();
    
    await table.save();
    
    // Notify about notes change with tableId
    notifyDataChange('notesChanged', null, req.params.id);
    res.json({ adminNotes: table.adminNotes });
  } catch (err) {
    console.error('[ADMIN-NOTES] Error updating note:', err);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Delete an admin note (owners and admins only)
app.delete('/api/tables/:id/admin-notes/:noteId', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) return res.status(404).json({ error: 'Table not found' });
    
    // Check if user is owner or admin
    const isOwner = table.owners.map(String).includes(req.user.id);
    const isAdmin = req.user.role === 'admin';
    
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Only owners and admins can delete admin notes' });
    }
    
    table.adminNotes = table.adminNotes.filter(n => n._id.toString() !== req.params.noteId);
    await table.save();
    
    // Notify about notes change with tableId
    notifyDataChange('notesChanged', null, req.params.id);
    res.json({ adminNotes: table.adminNotes });
  } catch (err) {
    console.error('[ADMIN-NOTES] Error deleting note:', err);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

app.post('/api/tables/:id/rows', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  try {
    const table = await Table.findById(req.params.id).select('owners leads sharedWith rows');
    if (!table || !hasEventAccess(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized or not found' });
    }
    table.rows.push(req.body);
    await table.save();
    
    // Return ONLY the newly created row (last one pushed)
    const newRow = table.rows[table.rows.length - 1];
    notifyDataChange('crewChanged', null, req.params.id);
    res.json({ row: newRow });
  } catch (err) {
    console.error('Error adding row:', err);
    res.status(500).json({ error: 'Failed to add row' });
  }
});

app.put('/api/tables/:id', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  try {
    const table = await Table.findById(req.params.id).select('owners leads sharedWith rows');
    if (!table || !hasEventAccess(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized or not found' });
    }
    table.rows = req.body.rows;
    await table.save();
    
    notifyDataChange('crewChanged', null, req.params.id);
    notifyDataChange('tableUpdated', null, req.params.id);
    res.json({ message: 'Table updated' });
  } catch (err) {
    console.error('Error updating table rows:', err);
    res.status(500).json({ error: 'Failed to update table' });
  }
});

// Helper to ensure _id is a valid ObjectId
function ensureObjectId(id) {
  if (!id) return new mongoose.Types.ObjectId();
  if (mongoose.Types.ObjectId.isValid(id) && (typeof id !== 'string' || id.length === 24)) {
    return new mongoose.Types.ObjectId(id);
  }
  return new mongoose.Types.ObjectId();
}

function sanitizeCardLog(cardLog) {
  return (Array.isArray(cardLog) ? cardLog : []).map(day => ({
    _id: ensureObjectId(day._id),
    date: day.date,
    entries: Array.isArray(day.entries)
      ? day.entries.map(entry => ({
          _id: ensureObjectId(entry._id),
          camera: entry.camera || '',
          card1: entry.card1 || '',
          card2: entry.card2 || '',
          user: entry.user || '',
          createdBy: entry.createdBy || null,
          createdAt: entry.createdAt || new Date(),
          updatedAt: entry.updatedAt || new Date()
        }))
      : []
  }));
}

// ✅ Save card log data
app.put('/api/tables/:id/cardlog', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  
  try {
    console.log(`[CARDLOG] Received PUT request for card log, table ID: ${req.params.id}`);
    
    // Safely extract the card log data
    let newCardLog = [];
    try {
      newCardLog = Array.isArray(req.body.cardLog) ? req.body.cardLog : [];
      console.log(`[CARDLOG] Received ${newCardLog.length} entries`);
      
      // Basic validation - log date presence
      const entriesWithoutDates = newCardLog.filter(entry => !entry || !entry.date).length;
      if (entriesWithoutDates > 0) {
        console.warn(`[CARDLOG] Warning: ${entriesWithoutDates} entries are missing dates`);
      }
    } catch (err) {
      console.error('[CARDLOG] Error parsing card log data:', err);
      return res.status(400).json({ error: "Invalid card log data format" });
    }
    
    // Sanitize card log to ensure all _id fields are ObjectId
    const sanitizedCardLog = sanitizeCardLog(newCardLog);
    
    // Get the current card log for comparison
    const oldTable = await Table.findById(req.params.id);
    if (!oldTable) {
      console.error(`[CARDLOG] Table not found: ${req.params.id}`);
      return res.status(404).json({ error: "Table not found" });
    }
    
    // Check permissions
    if (!oldTable.owners.includes(req.user.id) && !oldTable.sharedWith.includes(req.user.id)) {
      console.error(`[CARDLOG] Unauthorized access: ${req.user.id}`);
      return res.status(403).json({ error: "Not authorized" });
    }
    
    // Safely extract old card log
    const oldCardLog = Array.isArray(oldTable.cardLog) ? oldTable.cardLog : [];
    console.log(`[CARDLOG] Current card log has ${oldCardLog.length} entries`);
    
    // Get dates from both logs for basic diffing
    const oldDates = new Set(oldCardLog.filter(entry => entry && entry.date).map(entry => entry.date));
    const newDates = new Set(sanitizedCardLog.filter(entry => entry && entry.date).map(entry => entry.date));
    
    console.log(`[CARDLOG] Old dates: ${Array.from(oldDates).join(', ')}`);
    console.log(`[CARDLOG] New dates: ${Array.from(newDates).join(', ')}`);
    
    // Simple diffing for notifications
    const addedDates = Array.from(newDates).filter(date => !oldDates.has(date));
    const deletedDates = Array.from(oldDates).filter(date => !newDates.has(date));
    
    console.log(`[CARDLOG] Added dates: ${addedDates.join(', ')}`);
    console.log(`[CARDLOG] Deleted dates: ${deletedDates.join(', ')}`);
    
    // Enhanced diffing: detect row-level changes within existing dates
    const updatedDates = [];
    for (const date of newDates) {
      if (oldDates.has(date)) {
        // Date exists in both - check if entries changed
        const oldEntry = oldCardLog.find(e => e && e.date === date);
        const newEntry = sanitizedCardLog.find(e => e && e.date === date);
        
        if (oldEntry && newEntry) {
          const oldEntriesCount = Array.isArray(oldEntry.entries) ? oldEntry.entries.length : 0;
          const newEntriesCount = Array.isArray(newEntry.entries) ? newEntry.entries.length : 0;
          
          console.log(`[CARDLOG] Comparing entries for date ${date}: old=${oldEntriesCount}, new=${newEntriesCount}`);
          
          // Simple check: if entry count changed or content changed
          const entriesChanged = oldEntriesCount !== newEntriesCount || 
            JSON.stringify(oldEntry.entries || []) !== JSON.stringify(newEntry.entries || []);
          
          if (entriesChanged) {
            updatedDates.push(date);
            console.log(`[CARDLOG] Date ${date} has row changes: ${oldEntriesCount} -> ${newEntriesCount} entries`);
            
            // Log the actual differences for debugging
            if (oldEntriesCount !== newEntriesCount) {
              console.log(`[CARDLOG] Entry count changed for ${date}`);
            } else {
              console.log(`[CARDLOG] Entry content changed for ${date}`);
            }
          } else {
            console.log(`[CARDLOG] No changes detected for date ${date}`);
          }
        }
      }
    }
    
    console.log(`[CARDLOG] Updated dates: ${updatedDates.join(', ')}`);
    
    // Update with retry logic
    let updateSuccessful = false;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (!updateSuccessful && retryCount < maxRetries) {
      try {
        // Use findOneAndUpdate to avoid race conditions
        const result = await Table.findOneAndUpdate(
          { 
            _id: req.params.id,
            $or: [
              { owners: req.user.id },
              { sharedWith: req.user.id }
            ]
          },
          { $set: { cardLog: sanitizedCardLog } },
          { new: true }
        );
        
        if (!result) {
          console.error(`[CARDLOG] Update failed: No document returned`);
          return res.status(404).json({ error: "Update failed - table not found or permissions changed" });
        }
        
        updateSuccessful = true;
        console.log(`[CARDLOG] Update successful on attempt ${retryCount + 1}`);
        
        // Emit basic events
        try {
          // Emit events for added dates
          for (const date of addedDates) {
            const entry = sanitizedCardLog.find(e => e && e.date === date);
            if (entry) {
              console.log(`[CARDLOG] Emitting cardLogAdded for date: ${date}`);
              notifyDataChange('cardLogAdded', { cardLog: entry }, req.params.id);
            }
          }
          
          // Emit events for updated dates (row-level changes)
          for (const date of updatedDates) {
            const entry = sanitizedCardLog.find(e => e && e.date === date);
            if (entry) {
              console.log(`[CARDLOG] Emitting cardLogUpdated for date: ${date}`);
              notifyDataChange('cardLogUpdated', { cardLog: entry }, req.params.id);
            }
          }
          
          // Emit events for deleted dates
          for (const date of deletedDates) {
            const entry = oldCardLog.find(e => e && e.date === date);
            if (entry) {
              console.log(`[CARDLOG] Emitting cardLogDeleted for date: ${date}`);
              notifyDataChange('cardLogDeleted', { cardLog: entry }, req.params.id);
            }
          }
        } catch (err) {
          console.error('[CARDLOG] Error emitting events:', err);
          // Continue - the save was successful even if notifications fail
        }
        
      } catch (err) {
        console.error(`[CARDLOG] Update attempt ${retryCount + 1} failed:`, err);
        retryCount++;
        
        if (retryCount >= maxRetries) {
          return res.status(500).json({ 
            error: "Failed to update card log after multiple attempts",
            details: err.message
          });
        }
        
        // Wait a bit before retry
        await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
      }
    }
    
    return res.json({ message: 'Card log saved successfully' });
  } catch (err) {
    console.error('[CARDLOG] Unhandled error in card log update:', err);
    return res.status(500).json({ error: 'Failed to update card log', details: err.message });
  }
});

// ✅ Save SD Card Calculator data
app.put('/api/tables/:id/sd-calculator', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  
  try {
    const { numDays, camerasPerDay } = req.body;
    
    const table = await Table.findById(req.params.id);
    if (!table) {
      return res.status(404).json({ error: "Table not found" });
    }
    
    // Check permissions - admin users have access to all events
    if (!hasEventAccess(table, req.user)) {
      return res.status(403).json({ error: "Not authorized" });
    }
    
    // Update the calculator data
    table.sdCardCalculator = {
      numDays: numDays || 1,
      camerasPerDay: Array.isArray(camerasPerDay) ? camerasPerDay : [],
      lastUpdated: new Date()
    };
    
    await table.save();
    
    console.log(`[SD-CALC] Saved calculator data for table ${req.params.id}: ${numDays} days`);
    return res.json({ message: 'Calculator data saved successfully', sdCardCalculator: table.sdCardCalculator });
  } catch (err) {
    console.error('[SD-CALC] Error saving calculator data:', err);
    return res.status(500).json({ error: 'Failed to save calculator data', details: err.message });
  }
});

// ✅ Get SD Card Calculator data
app.get('/api/tables/:id/sd-calculator', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  
  try {
    const table = await Table.findById(req.params.id).select('sdCardCalculator');
    if (!table) {
      return res.status(404).json({ error: "Table not found" });
    }
    
    return res.json({ sdCardCalculator: table.sdCardCalculator || { numDays: 1, camerasPerDay: [] } });
  } catch (err) {
    console.error('[SD-CALC] Error loading calculator data:', err);
    return res.status(500).json({ error: 'Failed to load calculator data', details: err.message });
  }
});

// ✅ Save shotlist data
app.put('/api/tables/:id/shotlist', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  
  try {
    console.log(`[SHOTLIST] Received PUT request for shotlist, table ID: ${req.params.id}`);
    
    // Safely extract the shotlist data
    let newShotlist = [];
    try {
      newShotlist = Array.isArray(req.body.shotlist) ? req.body.shotlist : [];
      console.log(`[SHOTLIST] Received ${newShotlist.length} shots`);
    } catch (err) {
      console.error('[SHOTLIST] Error parsing shotlist data:', err);
      return res.status(400).json({ error: "Invalid shotlist data format" });
    }
    
    // Get the current table
    const table = await Table.findById(req.params.id);
    if (!table) {
      console.error(`[SHOTLIST] Table not found: ${req.params.id}`);
      return res.status(404).json({ error: "Table not found" });
    }
    
    // Check permissions - only owners and leads can edit
    const canEdit = table.owners.includes(req.user.id) || 
                   (Array.isArray(table.leads) && table.leads.includes(req.user.id));
    
    if (!canEdit && !table.sharedWith.includes(req.user.id)) {
      console.error(`[SHOTLIST] Unauthorized access: ${req.user.id}`);
      return res.status(403).json({ error: "Not authorized" });
    }
    
    // If user is only a shared member (not owner/lead), they can only update completion status
    if (!canEdit && table.sharedWith.includes(req.user.id)) {
      const oldShotlist = Array.isArray(table.shotlist) ? table.shotlist : [];
      
      // Validate that only completion status changed
      if (newShotlist.length !== oldShotlist.length) {
        return res.status(403).json({ error: "Only owners and leads can add/remove shots" });
      }
      
      for (let i = 0; i < newShotlist.length; i++) {
        const newShot = newShotlist[i];
        const oldShot = oldShotlist[i];
        
        // Allow only completed and completedAt fields to change
        const allowedFields = ['completed', 'completedAt'];
        for (const key in newShot) {
          if (!allowedFields.includes(key) && newShot[key] !== oldShot[key]) {
            return res.status(403).json({ 
              error: "Only owners and leads can edit shot details. You can only check/uncheck completion." 
            });
          }
        }
      }
    }
    
    // Sanitize shotlist data
    const sanitizedShotlist = newShotlist.map(shot => ({
      ...shot,
      _id: shot._id || `shot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: shot.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
    
    // Update with retry logic
    let updateSuccessful = false;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (!updateSuccessful && retryCount < maxRetries) {
      try {
        const result = await Table.findOneAndUpdate(
          { 
            _id: req.params.id,
            $or: [
              { owners: req.user.id },
              { leads: req.user.id },
              { sharedWith: req.user.id }
            ]
          },
          { $set: { shotlist: sanitizedShotlist } },
          { new: true }
        );
        
        if (!result) {
          console.error(`[SHOTLIST] Update failed: No document returned`);
          return res.status(404).json({ error: "Update failed - table not found or permissions changed" });
        }
        
        updateSuccessful = true;
        console.log(`[SHOTLIST] Update successful on attempt ${retryCount + 1}`);
        
        // Emit socket event for real-time updates
        try {
          console.log(`[SHOTLIST] Emitting shotlistUpdated event`);
          notifyDataChange('shotlistUpdated', { shotlist: sanitizedShotlist }, req.params.id);
        } catch (err) {
          console.error('[SHOTLIST] Error emitting events:', err);
          // Continue - the save was successful even if notifications fail
        }
        
      } catch (err) {
        console.error(`[SHOTLIST] Update attempt ${retryCount + 1} failed:`, err);
        retryCount++;
        
        if (retryCount >= maxRetries) {
          return res.status(500).json({ 
            error: "Failed to update shotlist after multiple attempts",
            details: err.message
          });
        }
        
        // Wait a bit before retry
        await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
      }
    }
    
    return res.json({ message: 'Shotlist saved successfully' });
  } catch (err) {
    console.error('[SHOTLIST] Unhandled error in shotlist update:', err);
    return res.status(500).json({ error: 'Failed to update shotlist', details: err.message });
  }
});

// ✅ Save shotlists data (multiple lists)
app.put('/api/tables/:id/shotlists', authenticate, async (req, res) => {
  const maxRetries = 3;
  let retryCount = 0;

  try {
    console.log(`[SHOTLISTS] Received PUT request for shotlists, table ID: ${req.params.id}`);
    
    // Safely extract the shotlists data
    let newShotlists = [];
    try {
      newShotlists = Array.isArray(req.body.shotlists) ? req.body.shotlists : [];
      console.log(`[SHOTLISTS] Received ${newShotlists.length} lists`);
    } catch (err) {
      console.error('[SHOTLISTS] Error parsing shotlists data:', err);
      return res.status(400).json({ error: "Invalid shotlists data format" });
    }

    const table = await Table.findById(req.params.id);
    if (!table) {
      console.error(`[SHOTLISTS] Table not found: ${req.params.id}`);
      return res.status(404).json({ error: 'Table not found' });
    }

    // Check if user has permission to access
    const userId = req.user.id;
    const isOwner = table.owners && table.owners.some(ownerId => ownerId.toString() === userId);
    const isLead = table.leads && table.leads.some(leadId => leadId.toString() === userId);
    const isShared = table.sharedWith && table.sharedWith.some(sharedId => sharedId.toString() === userId);

    if (!isOwner && !isLead && !isShared) {
      console.error(`[SHOTLISTS] Unauthorized access: ${req.user.id}`);
      return res.status(403).json({ error: 'Unauthorized: No access to this table' });
    }

    console.log(`[SHOTLISTS] User permissions - Owner: ${isOwner}, Lead: ${isLead}, Shared: ${isShared}`);

    // Sanitize shotlists data - let mongoose handle ObjectId creation automatically
    const sanitizedShotlists = newShotlists.map(list => {
              const sanitizedList = {
        name: typeof list.name === 'string' ? list.name.trim() : '',
        items: Array.isArray(list.items) ? list.items.map(item => {
          const sanitizedItem = {
            title: typeof item.title === 'string' ? item.title.trim() : '',
            completed: Boolean(item.completed),
            completedAt: item.completed && item.completedAt ? new Date(item.completedAt) : null,
            completedBy: item.completed && item.completedBy ? item.completedBy : null,
            completedByName: item.completed && item.completedByName ? item.completedByName : null,
            createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
            createdBy: item.createdBy || req.user.id,
            updatedAt: new Date()
          };
          
          // Only preserve _id if it's a valid MongoDB ObjectId
          if (item._id && mongoose.Types.ObjectId.isValid(item._id)) {
            sanitizedItem._id = item._id;
          }
          
          return sanitizedItem;
        }) : [],
        createdAt: list.createdAt ? new Date(list.createdAt) : new Date(),
        createdBy: list.createdBy || req.user.id,
        updatedAt: new Date()
      };
      
      // Only preserve _id if it's a valid MongoDB ObjectId
      if (list._id && mongoose.Types.ObjectId.isValid(list._id)) {
        sanitizedList._id = list._id;
      }
      
      return sanitizedList;
    });

    while (retryCount < maxRetries) {
      try {
        const updatedTable = await Table.findByIdAndUpdate(
          req.params.id,
          { $set: { shotlists: sanitizedShotlists } },
          { new: true, runValidators: true }
        );

        if (!updatedTable) {
          console.error(`[SHOTLISTS] Update failed: No document returned`);
          return res.status(404).json({ error: 'Table not found' });
        }

        console.log(`[SHOTLISTS] Update successful on attempt ${retryCount + 1}`);

        // Emit Socket.IO event for real-time updates
        try {
          console.log(`[SHOTLISTS] Emitting shotlistsUpdated event`);
          // Send the actual saved data from MongoDB, not the sanitized input
          notifyDataChange('shotlistsUpdated', { shotlists: updatedTable.shotlists }, req.params.id);
        } catch (err) {
          console.error('[SHOTLISTS] Error emitting events:', err);
        }

        break;

      } catch (err) {
        console.error(`[SHOTLISTS] Update attempt ${retryCount + 1} failed:`, err);
        retryCount++;
        
        if (retryCount >= maxRetries) {
          console.error('[SHOTLISTS] Max retries reached');
          return res.status(500).json({ 
            error: "Failed to update shotlists after multiple attempts",
            details: err.message 
          });
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
      }
    }

    return res.json({ message: 'Shotlists saved successfully' });

  } catch (err) {
    console.error('[SHOTLISTS] Unhandled error in shotlists update:', err);
    return res.status(500).json({ error: 'Failed to update shotlists', details: err.message });
  }
});

// GENERAL INFO
app.get('/api/tables/:id/general', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  const table = await Table.findById(req.params.id);
  if (!table || !hasEventReadAccess(table, req.user)) {
    return res.status(403).json({ error: 'Not authorized or not found' });
  }
  res.json(table.general || {});
});

app.put('/api/tables/:id/general', authenticate, async (req, res) => {
  const { title, general } = req.body;
  const table = await Table.findById(req.params.id);
  if (!table || !hasEventAccess(table, req.user)) {
    return res.status(403).json({ error: 'Not authorized or not found' });
  }
  
  // Allow owners and admins to update title
  const canEditTitle = req.user.role === 'admin' || table.owners.includes(req.user.id);
  const oldTitle = table.title;
  if (canEditTitle && title) {
    table.title = title;
  }
  
  // Update general info if provided
  if (general) {
    table.general = {
      ...table.general,
      ...general
    };
  }
  
  await table.save();

  // If the title was changed, sync eventName on all linked flights
  if (canEditTitle && title && title !== oldTitle) {
    try {
      const result = await FlightRequest.updateMany(
        { eventId: table._id },
        { $set: { eventName: title } }
      );
      if (result.modifiedCount > 0) {
        console.log(`✈️ Synced eventName on ${result.modifiedCount} flight(s) for renamed event "${oldTitle}" → "${title}"`);
      }
    } catch (syncErr) {
      console.error('Failed to sync flight eventNames after event rename:', syncErr);
    }
  }
  
  // Notify clients about the general info update
  notifyDataChange('generalChanged', null, req.params.id);
  notifyDataChange('tableUpdated', { tableId: req.params.id });
  
  res.json(table);
});

//GEAR
// ✅ GET gear checklist(s)
app.get('/api/tables/:id/gear', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  try {
    const table = await Table.findById(req.params.id);
    if (!table || !hasEventReadAccess(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized or not found' });
    }

    // Extract gear data
    const lists = table.gear?.lists ? Object.fromEntries(table.gear.lists) : {};
    const checkOutDate = table.gear?.checkOutDate || '';
    const checkInDate = table.gear?.checkInDate || '';
    
    console.log("Sending gear data:", {
      tableId: req.params.id,
      checkOutDate, 
      checkInDate,
      listsCount: Object.keys(lists).length
    });
    
    res.json({ lists, checkOutDate, checkInDate });
  } catch (err) {
    console.error('Error getting gear:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ UPDATE gear checklist
app.put('/api/tables/:id/gear', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
    }
  try {
    // Get the old gear lists for diffing
    const oldTable = await Table.findById(req.params.id);
    if (!oldTable) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if (!canManageEventGearLists(oldTable, req.user)) {
      return res.status(403).json({ error: 'Not authorized to edit gear for this event' });
    }
    const oldLists = oldTable.gear && oldTable.gear.lists ? Object.fromEntries(oldTable.gear.lists) : {};

    // Find and update in one atomic operation (fixes versioning issues)
    const result = await Table.findOneAndUpdate(
      { _id: req.params.id },
      {
        $set: {
          'gear.lists': req.body.lists ? new Map(Object.entries(req.body.lists)) : new Map(),
          'gear.checkOutDate': req.body.checkOutDate || '',
          'gear.checkInDate': req.body.checkInDate || ''
        }
      },
      { new: true, runValidators: true }
    );

    if (!result) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // --- Granular event emission ---
    const newLists = result.gear && result.gear.lists ? Object.fromEntries(result.gear.lists) : {};
    const oldListNames = new Set(Object.keys(oldLists));
    const newListNames = new Set(Object.keys(newLists));

    // Additions
    for (const name of newListNames) {
      if (!oldListNames.has(name)) {
        notifyDataChange('gearListAdded', { listName: name, list: newLists[name] }, req.params.id);
      }
    }
    // Updates
    for (const name of newListNames) {
      if (oldListNames.has(name)) {
        // Compare JSON for simplicity
        if (JSON.stringify(oldLists[name]) !== JSON.stringify(newLists[name])) {
          notifyDataChange('gearListUpdated', { listName: name, list: newLists[name] }, req.params.id);
        }
      }
    }
    // Deletions
    for (const name of oldListNames) {
      if (!newListNames.has(name)) {
        notifyDataChange('gearListDeleted', { listName: name }, req.params.id);
      }
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error updating gear:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// TRAVEL / ACCOMMODATION
app.get('/api/tables/:id/travel', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  const table = await Table.findById(req.params.id);
  if (!table || !hasEventReadAccess(table, req.user)) {
    return res.status(403).json({ error: 'Not authorized or not found' });
  }
  res.json({
    travel: table.travel || [],
    accommodation: table.accommodation || []
  });
});

/** Admin/owner access for event expenses page */
function canAccessEventExpenses(table, user) {
  if (!table || !user) return false;
  if (user.role === 'admin') return true;
  const uid = user.id.toString();
  return (table.owners || []).some(id => id.toString() === uid);
}

/** Hours from crew call times (startTime → endTime), same logic as crew page */
function calculateCrewCallHours(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = String(start).trim().split(':').map(Number);
  const [eh, em] = String(end).trim().split(':').map(Number);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return 0;
  const startDate = new Date(0, 0, 0, sh, sm || 0);
  let endDate = new Date(0, 0, 0, eh, em || 0);
  let diff = (endDate - startDate) / (1000 * 60 * 60);
  if (diff < 0) diff += 24;
  return Math.max(Math.round(diff * 100) / 100, 0);
}

function getCrewRowHours(row) {
  if (row.startTime && row.endTime) {
    return calculateCrewCallHours(row.startTime, row.endTime);
  }
  return parseFloat(row.totalHours) || 0;
}

/** Same key format as crew page cost calculator (name||role) */
function crewExpenseKey(name, role) {
  return `${(name || '').trim()}||${(role || '').trim()}`;
}

function recalcCrewExpenseRow(c) {
  const hours = Math.round((parseFloat(c.hours) || 0) * 100) / 100;
  const rate = parseFloat(c.rate) || 0;
  const additionalCost = parseFloat(c.additionalCost) || 0;
  const labor = Math.round(hours * rate * 100) / 100;
  return {
    ...c,
    hours,
    rate,
    additionalCost: Math.round(additionalCost * 100) / 100,
    total: Math.round((labor + additionalCost) * 100) / 100
  };
}

/** Match travel page: manual table.travel + booked Flight Management rows */
function transformFlightRequestToTravelRow(flight, passenger, isReturn = false) {
  const mainBookedDetails = flight.bookedDetails || {};
  const returnBookedDetails = flight.returnBookedDetails || {};
  const flightDetails = isReturn ? returnBookedDetails : mainBookedDetails;
  const fromCode = isReturn ? (flight.to?.code || '') : (flight.from?.code || '');
  const toCode = isReturn ? (flight.from?.code || '') : (flight.to?.code || '');
  const rawDate = isReturn ? flight.returnDate : flight.departDate;
  const dateStr = rawDate
    ? (rawDate instanceof Date ? rawDate.toISOString() : String(rawDate)).split('T')[0]
    : '';

  const flightCost = parseFloat(flight.cost);
  return {
    date: dateStr,
    depart: flightDetails.departTime || '',
    arrive: flightDetails.arriveTime || '',
    name: passenger.name || '',
    airline: mainBookedDetails.airline || '',
    fromTo: `${fromCode} → ${toCode}`,
    ref: mainBookedDetails.confirmationCode || '',
    cost: Number.isFinite(flightCost) && flightCost > 0 ? flightCost : 0,
    _fromFlightManagement: true,
    _flightId: flight._id ? flight._id.toString() : '',
    _isReturn: !!isReturn
  };
}

async function getEventTravelRows(table) {
  const manual = [...(table.travel || [])];
  const eventId = table._id;
  const title = (table.title || '').trim();

  const flightQuery = {
    status: { $in: ['booked', 'cancelled'] },
    $or: [{ eventId }]
  };
  if (title) {
    flightQuery.$or.push({ eventName: new RegExp(`^${escapeRegex(title)}$`, 'i') });
  }

  const bookedFlights = await FlightRequest.find(flightQuery).lean();
  const fmRows = [];

  bookedFlights.forEach(flight => {
    const passengers = flight.passengers || [];
    passengers.forEach(passenger => {
      fmRows.push(transformFlightRequestToTravelRow(flight, passenger, false));
    });
    if (flight.tripType === 'roundtrip' && flight.returnBookedDetails) {
      passengers.forEach(passenger => {
        fmRows.push(transformFlightRequestToTravelRow(flight, passenger, true));
      });
    }
  });

  return [...fmRows, ...manual];
}

function flightExpenseSourceKey(t, manualIdx) {
  if (t._flightId) {
    return `fm:${t._flightId}:${t._isReturn ? 'return' : 'out'}:${(t.name || '').trim()}`;
  }
  return `travel:${manualIdx}`;
}

function travelRowToExpenseFlight(t, manualIdx) {
  const idx = manualIdx == null ? null : manualIdx;
  const rowCost = parseFloat(t.cost);
  const cost = Number.isFinite(rowCost) && rowCost >= 0 ? rowCost : 0;
  return {
    sourceKey: flightExpenseSourceKey(t, idx == null ? 0 : idx),
    sourceIndex: idx,
    passengerName: t.name || '',
    date: t.date || '',
    airline: t.airline || '',
    refNumber: (t.ref || '').trim(),
    cost: Math.round(cost * 100) / 100,
    notes: '',
    imported: true
  };
}

function normalizeFlightRef(ref) {
  return String(ref || '').trim().toUpperCase();
}

/** Legacy sync used to stuff route/times into flight notes — drop on merge */
function isLikelyAutoImportedFlightNotes(notes) {
  const t = String(notes || '').trim();
  if (!t) return false;
  return (
    (/→|->|\bto\b/i.test(t) && /\d{1,2}:\d{2}/.test(t)) ||
    /\b(DEP|ARR|Depart|Arrive)\b/i.test(t)
  );
}

function mergeSavedFlightNotes(savedNotes, freshNotes) {
  const n = savedNotes != null ? savedNotes : freshNotes;
  return isLikelyAutoImportedFlightNotes(n) ? '' : (n || '');
}

/** Imported flight rows always use cost from Flight Management on sync */
function mergeSavedFlightCost(savedCost, freshCost, imported) {
  const fresh = parseFloat(freshCost);
  const freshRounded = Number.isFinite(fresh) ? Math.round(fresh * 100) / 100 : 0;
  if (imported !== false) return freshRounded;
  if (freshRounded > 0) return freshRounded;
  const saved = parseFloat(savedCost);
  if (Number.isFinite(saved) && saved >= 0) return Math.round(saved * 100) / 100;
  return 0;
}

/** Booked Flight Management costs keyed by confirmation REF */
async function getFlightManagementCostsByRef(table) {
  const eventId = table._id;
  const title = (table.title || '').trim();
  const flightQuery = {
    status: { $in: ['booked', 'cancelled'] },
    $or: [{ eventId }]
  };
  if (title) {
    flightQuery.$or.push({ eventName: new RegExp(`^${escapeRegex(title)}$`, 'i') });
  }

  const bookedFlights = await FlightRequest.find(flightQuery)
    .select('cost bookedDetails.confirmationCode')
    .lean();

  const byRef = new Map();
  bookedFlights.forEach(flight => {
    const refNorm = normalizeFlightRef(flight.bookedDetails?.confirmationCode);
    if (!refNorm) return;
    const cost = parseFloat(flight.cost);
    if (!Number.isFinite(cost) || cost < 0) return;
    const rounded = Math.round(cost * 100) / 100;
    byRef.set(refNorm, Math.max(byRef.get(refNorm) || 0, rounded));
  });
  return byRef;
}

function applyFlightManagementCostsToExpenseFlights(flightRows, costsByRef) {
  return flightRows.map(row => {
    if (row.imported === false) return row;
    const refNorm = normalizeFlightRef(row.refNumber);
    if (!refNorm) return row;
    const fmCost = costsByRef.get(refNorm);
    if (fmCost == null || fmCost <= 0) return row;
    return {
      ...row,
      cost: fmCost,
      imported: true
    };
  });
}

function parseFlightCostInput(value) {
  const n = parseFloat(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/** One expense row per confirmation (REF); legs/passengers on same ref are booked together */
function groupFlightsByRefNumber(flightRows) {
  const byRef = new Map();
  const withoutRef = [];

  flightRows.forEach(row => {
    const refNorm = normalizeFlightRef(row.refNumber);
    if (!refNorm) {
      withoutRef.push({ ...row });
      return;
    }

    if (!byRef.has(refNorm)) {
      byRef.set(refNorm, {
        sourceKey: `ref:${refNorm}`,
        refNumber: row.refNumber.trim(),
        passengerNames: new Set(),
        dates: [],
        airlines: new Set(),
        cost: 0,
        imported: true
      });
    }
    const g = byRef.get(refNorm);
    const name = (row.passengerName || '').trim();
    if (name) {
      name.split(',').map(n => n.trim()).filter(Boolean).forEach(n => g.passengerNames.add(n));
    }
    if (row.date && !g.dates.includes(row.date)) g.dates.push(row.date);
    if (row.airline) g.airlines.add(row.airline.trim());
    g.cost = Math.max(g.cost, parseFloat(row.cost) || 0);
    if (row.imported === false) g.imported = false;
  });

  const grouped = [...byRef.entries()].map(([, g]) => {
    g.dates.sort();
    const dateDisplay = g.dates.length === 0
      ? ''
      : g.dates.length === 1
        ? g.dates[0]
        : `${g.dates[0]} – ${g.dates[g.dates.length - 1]}`;
    const airlines = [...g.airlines];
    const airline = airlines.length === 1 ? airlines[0] : airlines.join(', ');
    const passengers = [...g.passengerNames].sort((a, b) => a.localeCompare(b)).join(', ');

    return {
      sourceKey: g.sourceKey,
      sourceIndex: null,
      passengerName: passengers,
      date: dateDisplay,
      airline,
      refNumber: g.refNumber,
      cost: Math.round(g.cost * 100) / 100,
      notes: '',
      imported: g.imported !== false
    };
  });

  grouped.sort((a, b) => a.refNumber.localeCompare(b.refNumber));
  return [...grouped, ...withoutRef];
}

function getSavedFlightBooking(flightRows, refNorm) {
  const matching = (flightRows || []).filter(f => normalizeFlightRef(f.refNumber) === refNorm);
  if (!matching.length) return null;

  const grouped = matching.find(f => f.sourceKey === `ref:${refNorm}`);
  if (grouped) {
    return { cost: parseFloat(grouped.cost) || 0, notes: grouped.notes || '' };
  }

  const costs = matching.map(f => parseFloat(f.cost) || 0).filter(c => c > 0);
  return {
    cost: costs.length ? Math.max(...costs) : 0,
    notes: matching.find(f => f.notes)?.notes || ''
  };
}

async function buildExpensesFromSources(table) {
  const crewRates = table.crewRates || {};
  const crewMap = {};

  (table.rows || []).forEach(row => {
    if (!row.name || row.role === '__placeholder__') return;
    const name = (row.name || '').trim();
    const role = (row.role || '').trim();
    const key = crewExpenseKey(name, role);
    if (!crewMap[key]) {
      const rateKey = crewExpenseKey(name, role);
      const rate = parseFloat(crewRates[rateKey] ?? crewRates[`${name}|${role}`]) || 0;
      crewMap[key] = {
        sourceId: row._id ? row._id.toString() : '',
        name,
        role,
        hours: 0,
        rate,
        additionalCost: 0,
        total: 0,
        notes: '',
        imported: true
      };
    }
    crewMap[key].hours += getCrewRowHours(row);
    if (row.notes && !crewMap[key].notes) crewMap[key].notes = row.notes;
  });

  const crew = Object.values(crewMap)
    .map(recalcCrewExpenseRow)
    .sort((a, b) => {
      const nc = a.name.localeCompare(b.name);
      return nc !== 0 ? nc : a.role.localeCompare(b.role);
    });

  const travelRows = await getEventTravelRows(table);
  let manualIdx = 0;
  const flatFlights = travelRows.map((t) => {
    if (t._flightId) {
      return travelRowToExpenseFlight(t, null);
    }
    const row = travelRowToExpenseFlight(t, manualIdx);
    manualIdx += 1;
    return row;
  });
  const costsByRef = await getFlightManagementCostsByRef(table);
  const flights = applyFlightManagementCostsToExpenseFlights(
    groupFlightsByRefNumber(flatFlights),
    costsByRef
  );

  const accommodation = (table.accommodation || []).map((a, i) => ({
    sourceIndex: i,
    name: a.name || '',
    checkIn: a.checkin || '',
    checkOut: a.checkout || '',
    hotel: a.hotel || '',
    refNumber: a.ref || '',
    cost: 0,
    notes: '',
    imported: true
  }));

  const reimbursements = await getApprovedReimbursementsForEvent(table);

  return { crew, flights, accommodation, misc: [], reimbursements };
}

function formatExpenseDateSubmitted(d) {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().split('T')[0];
}

/** Approved reimbursement requests linked to this event (by eventId or event name) */
async function getApprovedReimbursementsForEvent(table) {
  const eventId = table._id;
  const title = (table.title || '').trim();

  const query = {
    status: 'approved',
    $or: [{ eventId }]
  };
  if (title) {
    query.$or.push({ eventName: new RegExp(`^${escapeRegex(title)}$`, 'i') });
  }

  let requests = await ReimbursementRequest.find(query)
    .sort({ dateSubmitted: -1 })
    .lean();

  const needsUser = requests.filter(r => !r.userName && r.userId);
  if (needsUser.length > 0) {
    const userIds = [...new Set(needsUser.map(r => r.userId.toString()))];
    const users = await User.find({ _id: { $in: userIds } }, 'fullName email').lean();
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });
    requests = requests.map(r => {
      if (!r.userName && r.userId) {
        const u = userMap[r.userId.toString()];
        if (u) r.userName = u.fullName || u.email || '—';
      }
      return r;
    });
  }

  const rows = [];
  for (const r of requests) {
    const submitter = await resolveReimbursementSubmitter(r);
    const amount = parseFloat(r.totalAmount);
    rows.push({
      sourceId: r._id ? r._id.toString() : '',
      submittedBy: submitter.userName || '—',
      dateSubmitted: formatExpenseDateSubmitted(r.dateSubmitted),
      description: (r.description || '').trim(),
      amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0,
      imported: true
    });
  }

  return rows;
}

async function mergeExpensesWithSources(table, existing) {
  const fresh = await buildExpensesFromSources(table);
  const prev = existing || {};
  const prevCrewByKey = {};
  (prev.crew || []).forEach(c => {
    prevCrewByKey[crewExpenseKey(c.name, c.role)] = c;
  });
  fresh.crew = fresh.crew.map(c => {
    const old = prevCrewByKey[crewExpenseKey(c.name, c.role)];
    if (!old) return c;
    return recalcCrewExpenseRow({
      ...c,
      rate: old.rate != null ? old.rate : c.rate,
      additionalCost: old.additionalCost != null ? old.additionalCost : c.additionalCost,
      notes: old.notes != null ? old.notes : c.notes
    });
  });

  const prevFlightsList = prev.flights || [];
  fresh.flights = fresh.flights.map(f => {
    const refNorm = normalizeFlightRef(f.refNumber);
    if (!refNorm) {
      const legacy = prevFlightsList.find(
        p => !normalizeFlightRef(p.refNumber) && p.sourceKey === f.sourceKey
      );
      if (!legacy) return f;
      return {
        ...f,
        cost: mergeSavedFlightCost(legacy.cost, f.cost, f.imported !== false),
        notes: mergeSavedFlightNotes(legacy.notes, f.notes)
      };
    }
    const saved = getSavedFlightBooking(prevFlightsList, refNorm);
    if (!saved) return f;
    return {
      ...f,
      cost: mergeSavedFlightCost(saved.cost, f.cost, f.imported !== false),
      notes: mergeSavedFlightNotes(saved.notes, f.notes)
    };
  });

  const prevAcc = {};
  (prev.accommodation || []).forEach(a => {
    if (a.sourceIndex != null) prevAcc[a.sourceIndex] = a;
  });
  fresh.accommodation = fresh.accommodation.map(a => {
    const old = prevAcc[a.sourceIndex];
    if (!old) return a;
    return {
      ...a,
      cost: old.cost != null ? old.cost : a.cost,
      notes: old.notes != null ? old.notes : a.notes
    };
  });

  fresh.misc = Array.isArray(prev.misc) ? prev.misc : [];
  fresh.reimbursements = await getApprovedReimbursementsForEvent(table);
  return fresh;
}

function normalizeExpensesPayload(body) {
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const str = (v) => (v == null ? '' : String(v));

  return {
    crew: (body.crew || []).map(c => recalcCrewExpenseRow({
      sourceId: str(c.sourceId),
      name: str(c.name),
      role: str(c.role),
      hours: num(c.hours),
      rate: num(c.rate),
      additionalCost: num(c.additionalCost),
      total: num(c.total),
      notes: str(c.notes),
      imported: !!c.imported
    })),
    flights: groupFlightsByRefNumber((body.flights || []).map(f => ({
      sourceKey: str(f.sourceKey),
      sourceIndex: f.sourceIndex != null ? Number(f.sourceIndex) : null,
      passengerName: str(f.passengerName),
      date: str(f.date),
      airline: str(f.airline),
      refNumber: str(f.refNumber).trim(),
      cost: num(f.cost),
      notes: str(f.notes),
      imported: !!f.imported
    }))),
    accommodation: (body.accommodation || []).map(a => ({
      sourceIndex: a.sourceIndex != null ? Number(a.sourceIndex) : null,
      name: str(a.name),
      checkIn: str(a.checkIn),
      checkOut: str(a.checkOut),
      hotel: str(a.hotel),
      refNumber: str(a.refNumber),
      cost: num(a.cost),
      notes: str(a.notes),
      imported: !!a.imported
    })),
    misc: (body.misc || []).map(m => ({
      item: str(m.item),
      description: str(m.description),
      cost: num(m.cost),
      notes: str(m.notes)
    })),
    reimbursements: (body.reimbursements || []).map(r => ({
      sourceId: str(r.sourceId),
      submittedBy: str(r.submittedBy),
      dateSubmitted: str(r.dateSubmitted),
      description: str(r.description),
      amount: num(r.amount),
      imported: r.imported !== false
    }))
  };
}

app.get('/api/tables/:id/expenses', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) return res.status(404).json({ error: 'Event not found' });
    if (!canAccessEventExpenses(table, req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const saved = table.expenses && (
      (table.expenses.crew && table.expenses.crew.length) ||
      (table.expenses.flights && table.expenses.flights.length) ||
      (table.expenses.accommodation && table.expenses.accommodation.length) ||
      (table.expenses.misc && table.expenses.misc.length) ||
      (table.expenses.reimbursements && table.expenses.reimbursements.length)
    );

    const expenses = saved
      ? await mergeExpensesWithSources(table, table.expenses.toObject ? table.expenses.toObject() : table.expenses)
      : await buildExpensesFromSources(table);

    res.json({
      title: table.title,
      expenses,
      crewRates: table.crewRates || {}
    });
  } catch (err) {
    console.error('Error fetching expenses:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/tables/:id/expenses', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) return res.status(404).json({ error: 'Event not found' });
    if (!canAccessEventExpenses(table, req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    table.expenses = normalizeExpensesPayload(req.body.expenses || req.body);
    await table.save();
    res.json({ message: 'Expenses saved', expenses: table.expenses });
  } catch (err) {
    console.error('Error saving expenses:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/tables/:id/expenses/sync', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) return res.status(404).json({ error: 'Event not found' });
    if (!canAccessEventExpenses(table, req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const existing = table.expenses && (table.expenses.toObject ? table.expenses.toObject() : table.expenses);
    table.expenses = await mergeExpensesWithSources(table, existing);
    await table.save();
    res.json({ message: 'Synced from crew and travel', expenses: table.expenses });
  } catch (err) {
    console.error('Error syncing expenses:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/tables/:id/travel', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  const table = await Table.findById(req.params.id);
  if (!table || !hasEventAccess(table, req.user)) {
    return res.status(403).json({ error: 'Not authorized or not found' });
  }
  table.travel = req.body.travel || [];
  table.accommodation = req.body.accommodation || [];

  // Hotel info entered → clear manual "hotels requested" mark
  const hasHotelInfo = (table.accommodation || []).some(a => a?.hotel && String(a.hotel).trim());
  if (hasHotelInfo && table.badgesRequested?.hotel) {
    table.badgesRequested.hotel = false;
    table.markModified('badgesRequested');
  }

  await table.save();
  
  notifyDataChange('travelChanged', null, req.params.id); // Notify about travel/accommodation changes with tableId
  res.json({ message: 'Travel and accommodation saved' });
});

// Executive Summary
app.get('/api/tables/:id/executive-summary', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) return res.status(404).json({ error: 'Event not found' });
    res.json({
      executiveSummary: table.executiveSummary || {},
      general: table.general || {},
      rows: table.rows || [],
      travel: table.travel || [],
      accommodation: table.accommodation || [],
      title: table.title
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tables/:id/executive-summary', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) return res.status(404).json({ error: 'Event not found' });
    table.executiveSummary = { ...table.executiveSummary?.toObject?.() || {}, ...req.body };
    await table.save();
    res.json({ message: 'Executive summary saved', executiveSummary: table.executiveSummary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE
app.delete('/api/tables/:id', authenticate, async (req, res) => {
  const table = await Table.findById(req.params.id);
  // Only owners and admins can delete events
  if (!table || !hasEventAccess(table, req.user, true)) {
    return res.status(403).json({ error: 'Not authorized or not found' });
  }
  
  try {
    // Before deleting the table, release all gear items reserved for this event
    console.log(`[DELETE EVENT] Releasing all gear items for event ${req.params.id}`);
    
    // Find all gear items that have ANY association with this event
    const gearItems = await GearInventory.find({
      $or: [
        { 'reservations.eventId': req.params.id },  // Multi-quantity items with reservations
        { 'checkedOutEvent': req.params.id },       // Single-quantity items checked out
        { 'history.event': req.params.id }          // Items with history entries for this event
      ]
    });
    
    console.log(`[DELETE EVENT] Found ${gearItems.length} gear items associated with this event`);
    
    // BULLETPROOF ATOMIC CLEANUP - Remove all reservations for this event
    try {
      await AtomicReservationService.cleanupEventReservations(req.params.id);
      console.log(`[DELETE EVENT] ✅ Atomically cleaned up all reservations for event ${req.params.id}`);
    } catch (cleanupError) {
      console.error(`[DELETE EVENT] ❌ Failed to cleanup reservations:`, cleanupError.message);
      // Continue with event deletion even if cleanup fails
    }
    
    // Legacy cleanup for single-quantity items (backward compatibility)
    for (const gear of gearItems) {
      // Update status for single-quantity items if they were checked out for this event
      if (gear.quantity === 1 && gear.checkedOutEvent && gear.checkedOutEvent.toString() === req.params.id.toString()) {
        gear.status = 'available';
        gear.checkedOutBy = null;
        gear.checkedOutEvent = null;
        gear.checkOutDate = null;
        gear.checkInDate = null;
        await gear.save();
        console.log(`[DELETE EVENT] Reset status to available for ${gear.label}`);
      }
    }
    
    // Now delete the table
    await Table.findByIdAndDelete(req.params.id);
    
    // Notify clients about the table being deleted
    notifyDataChange('tableDeleted', { tableId: req.params.id });
    
    console.log(`[DELETE EVENT] Successfully deleted event ${req.params.id} and released all associated gear`);
    res.json({ success: true, message: `Event deleted and ${gearItems.length} gear items released` });
    
  } catch (error) {
    console.error('[DELETE EVENT] Error deleting event and releasing gear:', error);
    res.status(500).json({ error: 'Failed to delete event and release gear items' });
  }
});

app.delete('/api/tables/:id/rows/:index', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  const table = await Table.findById(req.params.id);
  if (!table || (!table.owners.includes(req.user.id) && !table.sharedWith.includes(req.user.id))) {
    return res.status(403).json({ error: 'Not authorized or not found' });
  }

  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= table.rows.length) {
    return res.status(400).json({ error: 'Invalid row index' });
  }

  table.rows.splice(idx, 1);
  await table.save();
  
  notifyDataChange('crewChanged', null, req.params.id); // Notify about crew change with tableId
  res.json({ message: 'Row deleted' });
});

// USERS (all authenticated users can view)
app.get('/api/users', authenticate, async (req, res) => {
  const users = await User.find({}, 'fullName email role profilePhoto').sort({ fullName: 1 });
  res.json(users.map(u => ({
    _id: u._id,
    name: u.fullName,
    email: u.email,
    role: u.role || 'user',
    profilePhoto: u.profilePhoto || null
  })));
});

// Get single user by ID (for profile/photo display)
app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.params.id, 'fullName email role profilePhoto');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      _id: user._id,
      name: user.fullName,
      email: user.email,
      role: user.role || 'user',
      profilePhoto: user.profilePhoto || null
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── User settings ────────────────────────────────────────
app.get('/api/users/me/settings', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('role settings').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { buildSettingsResponse } = require('./lib/userSettings');
    res.json(buildSettingsResponse(user));
  } catch (err) {
    console.error('Error fetching user settings:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/me/settings/notifications', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('role settings').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { getMergedSettings } = require('./lib/userSettings');
    res.json({ notifications: getMergedSettings(user).notifications });
  } catch (err) {
    console.error('Error fetching notification preferences:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/users/me/settings', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const {
      sanitizeNotificationPatch,
      buildSettingsResponse
    } = require('./lib/userSettings');

    if (req.body?.notifications && typeof req.body.notifications === 'object') {
      const patch = sanitizeNotificationPatch(user.role, req.body.notifications);
      if (!user.settings) user.settings = {};
      if (!user.settings.notifications) user.settings.notifications = {};
      Object.entries(patch).forEach(([key, value]) => {
        user.settings.notifications[key] = {
          ...(user.settings.notifications[key] || {}),
          ...value
        };
      });
      user.markModified('settings.notifications');
    }

    await user.save();
    res.json(buildSettingsResponse(user.toObject()));
  } catch (err) {
    console.error('Error updating user settings:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload profile photo
const profilePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit for profile photos
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, PNG, and WebP images are allowed.'), false);
    }
  }
});

app.post('/api/users/me/profile-photo', authenticate, profilePhotoUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete old photo from Cloudinary if exists
    if (user.profilePhotoPublicId) {
      try {
        await cloudinary.uploader.destroy(user.profilePhotoPublicId, { resource_type: 'image' });
        console.log(`Deleted old profile photo from Cloudinary: ${user.profilePhotoPublicId}`);
      } catch (deleteErr) {
        console.error('Error deleting old profile photo from Cloudinary:', deleteErr);
      }
    }

    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          folder: 'lumdash/profile-photos',
          public_id: `user_${req.user.id}_${Date.now()}`,
          transformation: [
            { width: 300, height: 300, crop: 'fill', gravity: 'face' },
            { quality: 'auto', fetch_format: 'auto' }
          ]
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary profile photo upload error:', error);
            reject(error);
          } else {
            resolve(result);
          }
        }
      );
      uploadStream.end(req.file.buffer);
    });

    // Update user record
    user.profilePhoto = uploadResult.secure_url;
    user.profilePhotoPublicId = uploadResult.public_id;
    await user.save();

    console.log(`Profile photo uploaded for user ${req.user.id}: ${uploadResult.secure_url}`);

    res.json({
      success: true,
      profilePhoto: uploadResult.secure_url
    });
  } catch (error) {
    console.error('Error uploading profile photo:', error);
    res.status(500).json({ error: 'Failed to upload profile photo' });
  }
});

// Delete profile photo
app.delete('/api/users/me/profile-photo', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete from Cloudinary if exists
    if (user.profilePhotoPublicId) {
      try {
        await cloudinary.uploader.destroy(user.profilePhotoPublicId, { resource_type: 'image' });
      } catch (deleteErr) {
        console.error('Error deleting profile photo from Cloudinary:', deleteErr);
      }
    }

    user.profilePhoto = null;
    user.profilePhotoPublicId = null;
    await user.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting profile photo:', error);
    res.status(500).json({ error: 'Failed to delete profile photo' });
  }
});

// Admin: Upload profile photo for any user
app.post('/api/users/:id/profile-photo', authenticate, profilePhotoUpload.single('photo'), async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized. Admin only.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete old photo from Cloudinary if exists
    if (user.profilePhotoPublicId) {
      try {
        await cloudinary.uploader.destroy(user.profilePhotoPublicId, { resource_type: 'image' });
        console.log(`Deleted old profile photo from Cloudinary: ${user.profilePhotoPublicId}`);
      } catch (deleteErr) {
        console.error('Error deleting old profile photo from Cloudinary:', deleteErr);
      }
    }

    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          folder: 'lumdash/profile-photos',
          public_id: `user_${req.params.id}_${Date.now()}`,
          transformation: [
            { width: 300, height: 300, crop: 'fill', gravity: 'face' },
            { quality: 'auto', fetch_format: 'auto' }
          ]
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary profile photo upload error:', error);
            reject(error);
          } else {
            resolve(result);
          }
        }
      );
      uploadStream.end(req.file.buffer);
    });

    // Update user record
    user.profilePhoto = uploadResult.secure_url;
    user.profilePhotoPublicId = uploadResult.public_id;
    await user.save();

    console.log(`Admin uploaded profile photo for user ${req.params.id}: ${uploadResult.secure_url}`);

    res.json({
      success: true,
      profilePhoto: uploadResult.secure_url
    });
  } catch (error) {
    console.error('Error uploading profile photo for user:', error);
    res.status(500).json({ error: 'Failed to upload profile photo' });
  }
});

app.put('/api/users/:id', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });
  const { name, email, role } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.fullName = name;
  user.email = email;
  if (role) {
    if (!['user', 'planner', 'admin', 'production_manager'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    user.role = role;
  }
  await user.save();
  io.emit('usersChanged'); // Notify all clients
  res.json({ message: 'User updated' });
});

app.delete('/api/users/:id', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  io.emit('usersChanged'); // Notify all clients
  res.json({ message: 'User deleted' });
});

app.post('/api/users/:id/reset-password', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.password = await bcrypt.hash(password, 10);
  await user.save();
  io.emit('usersChanged'); // Notify all clients
  res.json({ message: 'Password reset' });
});

// PROGRAM SCHEDULE
app.get('/api/tables/:id/program-schedule', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  const table = await Table.findById(req.params.id);
  if (!table || !hasEventReadAccess(table, req.user)) {
    return res.status(403).json({ error: 'Not authorized or not found' });
  }
  res.json({ programSchedule: table.programSchedule || [] });
});

app.put('/api/tables/:id/program-schedule', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  
  try {
    // CRITICAL: Validate request body to prevent data loss
    if (!req.body || typeof req.body !== 'object') {
      console.error('❌ [SCHEDULE UPDATE] Invalid request body');
      return res.status(400).json({ error: 'Invalid request body' });
    }
    
    const newSchedule = req.body.programSchedule;
    
    // CRITICAL: Validate that programSchedule is an array
    if (!Array.isArray(newSchedule)) {
      console.error('❌ [SCHEDULE UPDATE] programSchedule is not an array:', typeof newSchedule);
      return res.status(400).json({ error: 'programSchedule must be an array' });
    }
    
    // Get the old schedule for diffing and validation
    const oldTable = await Table.findById(req.params.id);
    if (!oldTable) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    const oldSchedule = oldTable.programSchedule || [];
    
    // CRITICAL: Prevent accidental data deletion
    // If old schedule has data but new schedule is empty, require explicit confirmation
    if (oldSchedule.length > 0 && newSchedule.length === 0) {
      console.warn(`⚠️ [SCHEDULE UPDATE] WARNING: Attempting to delete all ${oldSchedule.length} programs for event ${req.params.id}`);
      
      // Only allow if explicitly marked as intentional deletion
      if (!req.body._intentionalDeletion) {
        console.error('❌ [SCHEDULE UPDATE] BLOCKED: Refusing to save empty schedule when data exists. This prevents accidental data loss.');
        return res.status(400).json({ 
          error: 'Cannot delete all schedule data without explicit confirmation',
          oldCount: oldSchedule.length,
          newCount: 0
        });
      } else {
        console.warn('⚠️ [SCHEDULE UPDATE] Intentional deletion confirmed, proceeding...');
      }
    }
    
    console.log(`💾 [SCHEDULE UPDATE] Updating schedule for event ${req.params.id}: ${oldSchedule.length} → ${newSchedule.length} programs`);
    
    // Use findOneAndUpdate instead of find + save to avoid version conflicts
    const result = await Table.findOneAndUpdate(
      { 
        _id: req.params.id,
        $or: [
          { owners: req.user.id },
          { sharedWith: req.user.id }
        ]
      },
      { $set: { programSchedule: newSchedule } },
      { new: true, runValidators: true }
    );
    
    if (!result) {
      return res.status(403).json({ error: 'Not authorized or not found' });
    }
    
    console.log(`✅ [SCHEDULE UPDATE] Successfully updated schedule for event ${req.params.id}`);
    
    // --- Partial update events ---
    // Build maps for fast lookup
    const oldMap = new Map(oldSchedule.map(p => [p._id?.toString?.(), p]));
    const newMap = new Map(newSchedule.map(p => [p._id?.toString?.(), p]));
    
    // Added
    for (const p of newSchedule) {
      if (!oldMap.has(p._id?.toString?.())) {
        notifyDataChange('programAdded', { program: p }, req.params.id);
      }
    }
    // Updated
    for (const p of newSchedule) {
      const old = oldMap.get(p._id?.toString?.());
      if (old && JSON.stringify(p) !== JSON.stringify(old)) {
        notifyDataChange('programUpdated', { program: p }, req.params.id);
      }
    }
    // Deleted
    for (const p of oldSchedule) {
      if (!newMap.has(p._id?.toString?.())) {
        notifyDataChange('programDeleted', { program: p }, req.params.id);
      }
    }
    
    res.json({ message: 'Program schedule updated' });
  } catch (err) {
    console.error('❌ [SCHEDULE UPDATE] Error updating program schedule:', err);
    res.status(500).json({ error: 'Failed to update program schedule' });
  }
});

// UPDATE SINGLE PROGRAM FIELD - prevents data corruption from full saves
app.patch('/api/tables/:id/program-field', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  
  const { programId, field, value, userId, sessionId } = req.body;
  if (!programId || !field) {
    return res.status(400).json({ error: "programId and field are required" });
  }
  
  try {
    console.log(`🔧 [ATOMIC] Updating single field: ${field} = "${value}" for program ${programId} by user ${req.user.id}`);
    
    // Get current state first for conflict detection
    const currentTable = await Table.findById(req.params.id);
    if (!currentTable) {
      return res.status(404).json({ error: 'Table not found' });
    }
    
    // Check permissions (admin, owner, lead, or shared user)
    const isAdmin = req.user.role === 'admin';
    const isOwner = currentTable.owners.includes(req.user.id);
    const isLead = Array.isArray(currentTable.leads) && currentTable.leads.includes(req.user.id);
    const isShared = currentTable.sharedWith.includes(req.user.id);
    if (!isAdmin && !isOwner && !isLead && !isShared) {
      return res.status(403).json({ error: 'Not authorized to edit this table' });
    }
    
    // Find the current program
    const currentProgram = currentTable.programSchedule.find(p => p._id.toString() === programId);
    if (!currentProgram) {
      return res.status(404).json({ error: 'Program not found' });
    }
    
    const oldValue = currentProgram[field];
    
    // Use MongoDB's positional operator to update only the specific field atomically.
    // $inc rev gives clients a monotonically increasing revision for ordering.
    const result = await Table.findOneAndUpdate(
      { 
        _id: req.params.id,
        'programSchedule._id': programId
      },
      { 
        $set: { 
          [`programSchedule.$.${field}`]: value,
          [`programSchedule.$.lastModified`]: new Date(),
          [`programSchedule.$.lastModifiedBy`]: req.user.id
        },
        $inc: { 'programSchedule.$.rev': 1 }
      },
      { new: true, runValidators: true }
    );
    
    if (!result) {
      return res.status(500).json({ error: 'Failed to update program field' });
    }
    
    // Find the updated program for notification
    const updatedProgram = result.programSchedule.find(p => p._id.toString() === programId);
    if (updatedProgram) {
      console.log(`✅ [ATOMIC] Updated field ${field}: "${oldValue}" → "${value}" for program ${programId}`);
      
      // Broadcast field-level update to all users in the room except the sender
      io.to(`event-${req.params.id}`).emit('programFieldUpdated', { 
        eventId: req.params.id,
        programId, 
        field, 
        value, 
        oldValue,
        rev: updatedProgram.rev,
        userId: req.user.id,
        sessionId: sessionId || null,
        userName: req.user.fullName || req.user.name || 'Unknown User',
        timestamp: Date.now()
      });
      
      console.log(`📡 [ATOMIC] Broadcasted field update to event-${req.params.id} room`);
    }
    
    res.json({ 
      message: 'Program field updated successfully',
      field,
      value,
      oldValue
    });
  } catch (err) {
    console.error('❌ [ATOMIC] Error updating program field:', err);
    res.status(500).json({ error: 'Failed to update program field', details: err.message });
  }
});

async function applyPhotographerField(tableId, programId, value, user, sessionId) {
  const result = await Table.findOneAndUpdate(
    { _id: tableId, 'programSchedule._id': programId },
    {
      $set: {
        'programSchedule.$.photographer': value,
        'programSchedule.$.lastModified': new Date(),
        'programSchedule.$.lastModifiedBy': user.id
      },
      $inc: { 'programSchedule.$.rev': 1 }
    },
    { new: true }
  );
  if (!result) return null;
  const updatedProgram = result.programSchedule.find(p => p._id.toString() === programId);
  if (updatedProgram) {
    io.to(`event-${tableId}`).emit('programFieldUpdated', {
      eventId: tableId,
      programId,
      field: 'photographer',
      value,
      oldValue: null,
      rev: updatedProgram.rev,
      userId: user.id,
      sessionId: sessionId || null,
      userName: user.fullName || user.name || 'Unknown User',
      timestamp: Date.now()
    });
  }
  return updatedProgram;
}

app.post('/api/tables/:id/auto-assign-photographers', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === 'null') {
    return res.status(400).json({ error: 'Invalid table ID' });
  }
  try {
    const table = await Table.findById(req.params.id)
      .select('title owners leads programSchedule rows')
      .lean();
    if (!table) return res.status(404).json({ error: 'Table not found' });
    if (!canAssignPhotographers(table, req.user)) {
      return res.status(403).json({ error: 'Only owners and leads can auto-assign photographers' });
    }

    const dates = Array.isArray(req.body?.dates) ? req.body.dates : null;
    const proposal = await buildAssignmentProposal({
      programSchedule: table.programSchedule || [],
      rows: table.rows || [],
      dates,
      openai
    });
    res.json(proposal);
  } catch (err) {
    console.error('[AutoAssign] Preview failed:', err);
    res.status(500).json({ error: 'Failed to build photographer assignments' });
  }
});

app.post('/api/tables/:id/auto-assign-photographers/apply', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === 'null') {
    return res.status(400).json({ error: 'Invalid table ID' });
  }
  const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
  if (!assignments.length) {
    return res.status(400).json({ error: 'assignments are required' });
  }
  try {
    const table = await Table.findById(req.params.id).select('owners leads programSchedule');
    if (!table) return res.status(404).json({ error: 'Table not found' });
    if (!canAssignPhotographers(table, req.user)) {
      return res.status(403).json({ error: 'Only owners and leads can auto-assign photographers' });
    }

    const sessionId = req.body.sessionId || null;
    const updated = [];
    const skipped = [];
    for (const row of assignments) {
      const programId = row.programId;
      if (!programId) continue;
      const program = table.programSchedule.find(item => item._id.toString() === programId);
      if (!program) {
        skipped.push({ programId, reason: 'Session not found' });
        continue;
      }
      const value = row.photographer == null ? '' : String(row.photographer);
      const saved = await applyPhotographerField(req.params.id, programId, value, req.user, sessionId);
      if (saved) updated.push({ programId, photographer: value });
      else skipped.push({ programId, reason: 'Save failed' });
    }
    res.json({ updated: updated.length, skipped });
  } catch (err) {
    console.error('[AutoAssign] Apply failed:', err);
    res.status(500).json({ error: 'Failed to apply photographer assignments' });
  }
});

// FOLDER LOGS
app.get('/api/tables/:id/folder-logs', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  
  try {
    const table = await Table.findById(req.params.id);
    if (!table || !hasEventReadAccess(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized or not found' });
    }
    
    // Find folder log for this table or create a new one if it doesn't exist
    let folderLog = await FolderLog.findOne({ tableId: req.params.id });
    if (!folderLog) {
      folderLog = { folders: [] };
    }
    
    res.json({ folders: folderLog.folders || [] });
  } catch (err) {
    console.error('Error getting folder logs:', err);
    res.status(500).json({ error: 'Failed to get folder logs' });
  }
});

app.put('/api/tables/:id/folder-logs', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  
  try {
    const table = await Table.findById(req.params.id);
    if (!table || (!table.owners.includes(req.user.id) && !table.sharedWith.includes(req.user.id))) {
      return res.status(403).json({ error: 'Not authorized or not found' });
    }
    
    // Use findOneAndUpdate with upsert to create if it doesn't exist
    const result = await FolderLog.findOneAndUpdate(
      { tableId: req.params.id },
      { $set: { folders: req.body.folders || [] } },
      { new: true, upsert: true, runValidators: true }
    );
    
    // Notify clients about the folder logs update
    notifyDataChange('folderLogsChanged', null, req.params.id);
    res.json({ message: 'Folder logs updated' });
  } catch (err) {
    console.error('Error updating folder logs:', err);
    res.status(500).json({ error: 'Failed to update folder logs' });
  }
});

// Serve SPA shell and root from project root
app.use(express.static(path.join(__dirname, '..')));

// Serve static frontend assets from project root
app.use('/pages', express.static(path.join(__dirname, '../pages')));
app.use('/js', express.static(path.join(__dirname, '../js')));
app.use('/css', express.static(path.join(__dirname, '../css')));
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// VERIFY TOKEN
app.get('/api/verify-token', authenticate, async (req, res) => {
  try {
    const dbUser = await User.findById(req.user.id).select('role fullName email').lean();
    res.json({
      valid: true,
      user: req.user,
      dbRole: dbUser?.role || null,
      roleMismatch: !!(dbUser && dbUser.role !== req.user.role)
    });
  } catch (err) {
    res.json({ valid: true, user: req.user });
  }
});

// GEAR INVENTORY API
// List all gear
app.get('/api/gear-inventory', authenticate, async (req, res) => {
  try {
    const gear = await GearInventory.find().populate('notes.createdBy', 'fullName email');
    res.json(gear);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch gear inventory' });
  }
});

// Get inventory with availability for specific date range
app.get('/api/gear-inventory/availability', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }
    
    const gear = await GearInventory.find().lean();

    // Calculate availability for ALL items in just TWO queries (bulk),
    // instead of 3 queries per item. Same overlap logic, same results.
    const availabilityMap = await AtomicReservationService.getAvailableQuantitiesBulk(
      gear, startDate, endDate
    );

    const gearWithAvailability = gear.map((item) => {
      const availableQty = availabilityMap.get(item._id.toString()) ?? 0;
      const reservedQty = item.quantity - availableQty;
      return {
        ...item,
        availableQuantity: availableQty,
        reservedQuantity: reservedQty,
        isAvailable: availableQty > 0
      };
    });

    res.json(gearWithAvailability);
  } catch (err) {
    console.error('Error fetching gear inventory with availability:', err);
    res.status(500).json({ error: 'Failed to fetch gear inventory with availability' });
  }
});

// List gear inventory with availability for specific event dates
app.get('/api/gear-inventory/available/:eventId', authenticate, async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // Get cart to get the checkout/checkin dates
    let cart = await Cart.findOne({ userId: req.user.id, eventId });
    if (!cart) {
      // If no cart exists, try to get dates from event
      const event = await Table.findById(eventId);
      if (!event || !event.gear?.checkOutDate || !event.gear?.checkInDate) {
        return res.status(400).json({ error: 'No dates set for this event' });
      }
      cart = { checkOutDate: event.gear.checkOutDate, checkInDate: event.gear.checkInDate };
    }
    
    const gear = await GearInventory.find().lean();

    // Calculate availability for ALL items in just TWO queries (bulk),
    // instead of 3 queries per item. Same overlap logic, same results.
    // Don't exclude current event - we want to see ALL existing reservations.
    const availabilityMap = await AtomicReservationService.getAvailableQuantitiesBulk(
      gear, cart.checkOutDate, cart.checkInDate
    );

    const gearWithAvailability = gear.map((item) => ({
      ...item,
      availableQuantity: availabilityMap.get(item._id.toString()) ?? 0
    }));

    res.json(gearWithAvailability);
  } catch (err) {
    console.error('Error fetching gear inventory with availability:', err);
    res.status(500).json({ error: 'Failed to fetch gear inventory with availability' });
  }
});

// Check out gear
app.post('/api/gear-inventory/checkout', authenticate, async (req, res) => {
  const { gearId, eventId, checkOutDate, checkInDate, quantity = 1 } = req.body;
  if (!gearId || !eventId || !checkOutDate || !checkInDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  console.log("Checkout request:", { gearId, eventId, checkOutDate, checkInDate, quantity });
  
  const gear = await GearInventory.findById(gearId);
  if (!gear) return res.status(404).json({ error: 'Gear not found' });

  // Log current gear state before processing
  console.log(`[DEBUG] Gear before checkout for ${gear.label} (${gear._id}):`, {
    quantity: gear.quantity,
    reservations: gear.reservations?.length || 0,
    status: gear.status
  });

  try {
    // NEW: Handle quantity-based items
    if (gear.quantity > 1) {
      // Check if this event already has a reservation for these dates
      const existingReservation = gear.reservations.find(res => 
        res.eventId.toString() === eventId &&
        res.checkOutDate.toISOString().split('T')[0] === checkOutDate &&
        res.checkInDate.toISOString().split('T')[0] === checkInDate
      );
      
      if (existingReservation) {
        // Update existing reservation quantity
        const newQuantity = existingReservation.quantity + quantity;
        
        existingReservation.quantity = newQuantity;
        
        // Update history entry
        const historyEntry = gear.history.find(entry => 
          entry.event.toString() === eventId &&
          entry.checkOutDate.toISOString().split('T')[0] === checkOutDate &&
          entry.checkInDate.toISOString().split('T')[0] === checkInDate
        );
        if (historyEntry) {
          historyEntry.quantity = newQuantity;
        }
        
        await gear.save();
        return res.json({ 
          message: `Reservation updated to ${newQuantity} units`, 
          gear,
          reservedQuantity: newQuantity,
          availableQuantity: await AtomicReservationService.getAvailableQuantity(
            gear._id, checkOutDate, checkInDate
          )
        });
      } else {
        // Create new reservation using BULLETPROOF atomic service
        await AtomicReservationService.createReservation({
          inventoryId: gearId,
          eventId,
          userId: req.user.id,
          quantity,
          checkOutDate,
          checkInDate,
          listName: 'Main List', // Default list for direct checkout
          serial: gear.serial,
          specificSerialRequested: gear.serial && gear.serial !== 'N/A'
        });
        
        return res.json({ 
          message: `${quantity} units reserved`, 
          gear,
          reservedQuantity: quantity,
          availableQuantity: await AtomicReservationService.getAvailableQuantity(
            gear._id, checkOutDate, checkInDate
          )
        });
      }
    }

    // EXISTING: Handle single-quantity items (backward compatibility)
    // Enforce exclusive reservation by serial (if present)
    if (gear.serial && gear.serial !== 'N/A') {
      // Find any other gear with the same serial
      const otherWithSerial = await GearInventory.findOne({ serial: gear.serial, _id: { $ne: gear._id } });
      if (otherWithSerial && otherWithSerial.status === 'checked_out') {
        console.log(`[DEBUG] Serial conflict: another item with serial ${gear.serial} is already checked out.`);
        return res.status(409).json({ error: 'Another item with this serial is already checked out.' });
      }
    }

    // If gear is already checked out to this event, allow updating the dates
    if (gear.status === 'checked_out' && gear.checkedOutEvent && 
        gear.checkedOutEvent.toString() === eventId) {
      console.log("Gear already checked out to this event, updating dates");
      
      // Update the dates
      gear.checkOutDate = checkOutDate;
      gear.checkInDate = checkInDate;
      
      // Update the history entry for this event
      const historyEntry = gear.history.find(
        entry => entry.event && entry.event.toString() === eventId
      );
      
      if (historyEntry) {
        historyEntry.checkOutDate = checkOutDate;
        historyEntry.checkInDate = checkInDate;
      }
      
      await gear.save();
      console.log(`[DEBUG] Gear history after update for ${gear.label} (${gear._id}):`, JSON.stringify(gear.history, null, 2));
      return res.json({ message: 'Gear reservation updated', gear });
    }

    // Use centralized date normalization function

    // Prevent overlapping reservations
    const reqStart = normalizeDate(checkOutDate);
    const reqEnd = normalizeDate(checkInDate);
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    
    const overlaps = (entry) => {
      if (!entry.checkOutDate || !entry.checkInDate) return false;
      
      // Always compare event IDs as strings
      const entryEventId = entry.event ? entry.event.toString() : null;
      
      // Skip entries for this event
      if (entryEventId === eventId) {
        console.log(`[DEBUG] Skipping entry for current event: ${entryEventId}`);
        return false;
      }
      
      const entryStart = normalizeDate(entry.checkOutDate);
      const entryEnd = normalizeDate(entry.checkInDate);
      
      // Only consider reservations that are not fully in the past
      if (entryEnd < now) {
        console.log("[DEBUG] Skipping past reservation (end < now)");
        return false;
      }
      
      // Overlap if: (startA <= endB) && (endA >= startB)
      const isOverlap = reqStart <= entryEnd && reqEnd >= entryStart;
      if (isOverlap) {
        console.log("[DEBUG] OVERLAP DETECTED!");
      }
      return isOverlap;
    };
    
    if (gear.history && gear.history.some(overlaps)) {
      console.log("[DEBUG] Reservation rejected: overlapping dates");
      return res.status(409).json({ error: 'Gear is already reserved for overlapping dates.' });
    }

    // Also check for other gear with the same serial (if present) for overlapping reservations
    if (gear.serial && gear.serial !== 'N/A') {
      const others = await GearInventory.find({ serial: gear.serial, _id: { $ne: gear._id } });
      for (const other of others) {
        if (other.history && other.history.some(overlaps)) {
          console.log(`[DEBUG] Serial overlap detected for other item with serial ${gear.serial}`);
          return res.status(409).json({ error: 'Another item with this serial has an overlapping reservation.' });
        }
      }
    }

    // Store dates as strings for UI consistency
    gear.status = 'checked_out';
    gear.checkedOutBy = req.user.id;
    gear.checkedOutEvent = eventId;
    gear.checkOutDate = checkOutDate;
    gear.checkInDate = checkInDate;
    
    gear.history.push({
      user: req.user.id,
      event: eventId,
      checkOutDate: checkOutDate,
      checkInDate: checkInDate,
      quantity: 1
    });
    
    await gear.save();
    console.log("Single item reservation successful");
    res.json({ message: 'Gear checked out', gear });
    
  } catch (error) {
    console.error('Error during checkout:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check in gear
app.post('/api/gear-inventory/checkin', authenticate, async (req, res) => {
  const { gearId, eventId, checkOutDate, checkInDate, quantity } = req.body;
  if (!gearId) return res.status(400).json({ error: 'Missing gearId' });
  
  console.log(`[CHECKIN DEBUG] Request:`, { gearId, eventId, checkOutDate, checkInDate, quantity });
  console.log(`[CHECKIN DEBUG] Quantity type:`, typeof quantity, `Value:`, quantity);
  
  const gear = await GearInventory.findById(gearId);
  if (!gear) return res.status(404).json({ error: 'Gear not found' });

  console.log(`[CHECKIN DEBUG] Gear found:`, { 
    label: gear.label, 
    quantity: gear.quantity, 
    reservationsCount: gear.reservations?.length || 0 
  });

  try {
    // NEW: Handle quantity-based items
    if (gear.quantity > 1) {
      if (!eventId || !checkOutDate || !checkInDate) {
        return res.status(400).json({ error: 'Event ID and dates required for quantity items' });
      }
      
      // Release the quantity reservation
      gear.releaseQuantity(eventId, checkOutDate, checkInDate, quantity);
      
      // Remove from history - only the specific quantity
      // Use centralized date normalization function
      
      const requestOutDate = normalizeDate(checkOutDate);
      const requestInDate = normalizeDate(checkInDate);
      
      // Remove specific quantity from history using overlap logic
      let remainingToRemove = quantity || 1; // Default to 1 if quantity is undefined
      const newHistory = [];
      const rangesOverlap = (startA, endA, startB, endB) => (startA <= endB && endA >= startB);
      for (const entry of gear.history) {
        if (!entry.event || !entry.checkOutDate || !entry.checkInDate || remainingToRemove <= 0) {
          newHistory.push(entry);
          continue;
        }
        const eventMatches = entry.event.toString() === eventId;
        if (!eventMatches) {
          newHistory.push(entry);
          continue;
        }
        const entryOutDate = normalizeDate(entry.checkOutDate);
        const entryInDate = normalizeDate(entry.checkInDate);
        // Use overlap logic
        if (rangesOverlap(entryOutDate, entryInDate, requestOutDate, requestInDate)) {
          const entryQuantity = entry.quantity || 1;
          if (entryQuantity <= remainingToRemove) {
            remainingToRemove -= entryQuantity;
          } else {
            const modifiedEntry = { ...entry.toObject() };
            modifiedEntry.quantity = entryQuantity - remainingToRemove;
            remainingToRemove = 0;
            newHistory.push(modifiedEntry);
          }
        } else {
          newHistory.push(entry);
        }
      }
      gear.history = newHistory;
      
      await gear.save();
      
      // Remove from event gear lists if eventId is provided
      if (eventId) {
        await removeGearFromEventLists(eventId, gearId, gear.label, quantity);
      }
      
      const availableQty = await AtomicReservationService.getAvailableQuantity(
        gear._id, checkOutDate, checkInDate
      );
      return res.json({ 
        message: 'Quantity reservation released', 
        gear,
        availableQuantity: availableQty
      });
    }

    // EXISTING: Handle single-quantity items (backward compatibility)
    gear.status = 'available';
    gear.checkedOutBy = null;
    gear.checkedOutEvent = null;
    gear.checkOutDate = null;
    gear.checkInDate = null;

    // Remove reservation from history if eventId and dates are provided
    if (eventId && checkOutDate && checkInDate) {
      // Use centralized date normalization function
      
      const requestOutDate = normalizeDate(checkOutDate);
      const requestInDate = normalizeDate(checkInDate);
      
      gear.history = gear.history.filter(entry => {
        if (!entry.event || !entry.checkOutDate || !entry.checkInDate) return true;
        const eventMatches = entry.event.toString() === eventId;
        if (!eventMatches) return true;
        const entryOutDate = normalizeDate(entry.checkOutDate);
        const entryInDate = normalizeDate(entry.checkInDate);
        // Use overlap logic
        const rangesOverlap = (startA, endA, startB, endB) => (startA <= endB && endA >= startB);
        return !rangesOverlap(entryOutDate, entryInDate, requestOutDate, requestInDate);
      });
      
      // Remove from event gear lists
      await removeGearFromEventLists(eventId, gearId, gear.label, 1);
    }

    await gear.save();
    res.json({ message: 'Gear checked in', gear });
    
  } catch (error) {
    console.error('Error during checkin:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to remove gear from event gear lists
async function removeGearFromEventLists(eventId, gearId, gearLabel, quantityToRemove = 1) {
  try {
    console.log(`[REMOVE FROM LISTS] Removing ${gearLabel} (${gearId}) from event ${eventId} gear lists`);
    
    // Find the event/table
    const table = await Table.findById(eventId);
    if (!table) {
      console.log(`[REMOVE FROM LISTS] Event ${eventId} not found`);
      return;
    }
    
    console.log(`[REMOVE FROM LISTS] Found event: ${table.title}`);
    
    let tableModified = false;
    const lists = table.gear?.lists || new Map();
    
    // Convert Map to Object if needed for consistent iteration
    let listsObj;
    if (lists instanceof Map) {
      listsObj = Object.fromEntries(lists);
    } else if (lists && lists._doc) {
      // Handle Mongoose Map - the actual data is in _doc
      listsObj = lists._doc;
    } else {
      listsObj = lists;
    }
    
    console.log(`[REMOVE FROM LISTS] Processing ${Object.keys(listsObj).length} gear lists`);
    
    // Iterate through each list in the table
    for (const [listName, listData] of Object.entries(listsObj)) {
      if (!listData || typeof listData !== 'object') {
        console.log(`[REMOVE FROM LISTS] Skipping invalid list data for ${listName}`);
        continue;
      }
      
      console.log(`[REMOVE FROM LISTS] Checking list: ${listName}`);
      
      // Handle the case where listData might also be a Mongoose document
      let actualListData = listData;
      if (listData._doc) {
        actualListData = listData._doc;
      }
      
      // Iterate through each category in the list
      let categoriesToCheck = actualListData;
      
      // Check if the list has a 'categories' property (new structure)
      if (actualListData.categories && typeof actualListData.categories === 'object') {
        console.log(`[REMOVE FROM LISTS] Found categories structure in ${listName}`);
        categoriesToCheck = actualListData.categories;
        
        // Handle case where categories might also be a Mongoose document
        if (categoriesToCheck._doc) {
          categoriesToCheck = categoriesToCheck._doc;
        }
      }
      
      console.log(`[REMOVE FROM LISTS] Categories to check:`, Object.keys(categoriesToCheck));
      
      for (const [categoryName, items] of Object.entries(categoriesToCheck)) {
        if (!Array.isArray(items)) {
          console.log(`[REMOVE FROM LISTS] Skipping non-array category: ${categoryName}`);
          continue;
        }
        
        console.log(`[REMOVE FROM LISTS] Checking category: ${categoryName} with ${items.length} items`);
        
        // Find and remove/reduce items that match this gear
        const originalLength = items.length;
        let removedCount = 0;
        
        const filteredItems = [];
        let remainingToRemove = quantityToRemove;
        
        for (const item of items) {
          // Match by inventoryId (primary) or label (fallback)
          const matchesId = item.inventoryId && item.inventoryId.toString() === gearId.toString();
          const matchesLabel = item.label && (
            item.label === gearLabel || 
            item.label.startsWith(gearLabel + ' (') // Handle quantity labels like "Sony NP-FZ100 (5 units)"
          );
          
          if ((matchesId || matchesLabel) && remainingToRemove > 0) {
            console.log(`[REMOVE FROM LISTS] Found matching item: ${item.label || item.inventoryId}`);
            
            // For quantity-based items, check if we need to reduce quantity or remove entirely
            if (item.quantity && item.quantity > 1) {
              const itemQuantity = parseInt(item.quantity) || 1;
              
              if (itemQuantity <= remainingToRemove) {
                // Remove the entire item
                console.log(`[REMOVE FROM LISTS] Removing entire item (quantity: ${itemQuantity})`);
                remainingToRemove -= itemQuantity;
                removedCount += itemQuantity;
                // Don't add to filteredItems (effectively removing it)
              } else {
                // Reduce the quantity
                const newQuantity = itemQuantity - remainingToRemove;
                console.log(`[REMOVE FROM LISTS] Reducing item quantity from ${itemQuantity} to ${newQuantity}`);
                
                const updatedItem = { ...item };
                updatedItem.quantity = newQuantity;
                
                // Update the label if it includes quantity info
                if (updatedItem.label && updatedItem.label.includes('(') && updatedItem.label.includes('units)')) {
                  const baseName = updatedItem.label.split(' (')[0];
                  updatedItem.label = newQuantity === 1 ? baseName : `${baseName} (${newQuantity} units)`;
                }
                
                filteredItems.push(updatedItem);
                removedCount += remainingToRemove;
                remainingToRemove = 0;
              }
            } else {
              // Single quantity item - remove it entirely
              console.log(`[REMOVE FROM LISTS] Removing single quantity item`);
              remainingToRemove -= 1;
              removedCount += 1;
              // Don't add to filteredItems (effectively removing it)
            }
          } else {
            // Keep this item
            filteredItems.push(item);
          }
        }
        
        if (removedCount > 0) {
          categoriesToCheck[categoryName] = filteredItems;
          tableModified = true;
          console.log(`[REMOVE FROM LISTS] Removed/reduced ${removedCount} units from ${categoryName} in ${listName}`);
        }
      }
    }
    
    // Save the table if it was modified
    if (tableModified) {
      // Convert back to Map if the original was a Map
      if (lists instanceof Map) {
        table.gear.lists = new Map(Object.entries(listsObj));
      } else {
        table.gear.lists = listsObj;
      }
      
      await table.save();
      console.log(`[REMOVE FROM LISTS] Updated gear lists for event: ${table.title}`);
      
      // Notify clients about the gear list change
      notifyDataChange('gearListUpdated', { 
        message: `${gearLabel} removed from gear lists due to reservation removal` 
      }, table._id.toString());
    } else {
      console.log(`[REMOVE FROM LISTS] No modifications needed for event: ${table.title}`);
    }
    
  } catch (error) {
    console.error('[REMOVE FROM LISTS] Error:', error);
    // Don't throw the error - we don't want to fail the check-in if gear list removal fails
  }
}

// Add new gear to inventory
app.post('/api/gear-inventory', authenticate, async (req, res) => {
  if (!canManageGearInventory(req.user)) {
    return res.status(403).json({ error: 'Not authorized to edit gear inventory' });
  }
  const { label, category, serial, quantity = 1 } = req.body;
  if (!label || !category) {
    return res.status(400).json({ error: 'Label and category are required' });
  }
  
  // Validate quantity
  if (quantity < 1 || !Number.isInteger(quantity)) {
    return res.status(400).json({ error: 'Quantity must be a positive integer' });
  }
  
  try {
    // Convert empty strings to "N/A"
    const serialValue = serial && typeof serial === 'string' && serial.trim() !== '' ? serial.trim() : 'N/A';
    
    // Check for duplicate serial (only if serial is not blank/N/A)
    if (serialValue !== 'N/A') {
    const existingWithSerial = await GearInventory.findOne({ serial: serialValue });
    if (existingWithSerial) {
      return res.status(409).json({ 
        error: `Duplicate serial: this value already exists.`
      });
      }
    }
    
    // Note: We allow duplicate labels (same brand+model) as long as serials are different
    // This allows multiple units of the same item with different serial numbers
    
    const gear = new GearInventory({ 
      label, 
      category, 
      serial: serialValue,
      quantity
    });
    await gear.save();
    res.json({ message: 'Gear added', gear });
  } catch (err) {
    console.error('Error adding gear:', err);
    res.status(500).json({ error: 'Failed to add gear: ' + err.message });
  }
});

// Delete gear from inventory
app.delete('/api/gear-inventory/:id', authenticate, async (req, res) => {
  try {
    if (!canManageGearInventory(req.user)) {
      return res.status(403).json({ error: 'Not authorized to edit gear inventory' });
    }
    const gearId = req.params.id;
    if (!gearId) return res.status(400).json({ error: 'Missing gear ID' });
    
    const gear = await GearInventory.findById(gearId);
    if (!gear) return res.status(404).json({ error: 'Gear not found' });
    
    // Don't allow deletion of checked out gear
    if (gear.status === 'checked_out') {
      return res.status(400).json({ error: 'Cannot delete gear that is currently checked out' });
    }
    
    await gear.deleteOne();
    res.json({ message: 'Gear deleted successfully' });
  } catch (err) {
    console.error('Error deleting gear:', err);
    res.status(500).json({ error: 'Failed to delete gear' });
  }
});

// Edit gear in inventory 
app.put('/api/gear-inventory/:id', authenticate, async (req, res) => {
  try {
    if (!canManageGearInventory(req.user)) {
      return res.status(403).json({ error: 'Not authorized to edit gear inventory' });
    }
    const gearId = req.params.id;
    const { label, category, serial, quantity = 1 } = req.body;
    
    if (!gearId) return res.status(400).json({ error: 'Missing gear ID' });
    if (!label || !category) return res.status(400).json({ error: 'Label and category are required' });
    
    // Validate quantity
    if (quantity < 1 || !Number.isInteger(quantity)) {
      return res.status(400).json({ error: 'Quantity must be a positive integer' });
    }
    
    const gear = await GearInventory.findById(gearId);
    if (!gear) return res.status(404).json({ error: 'Gear not found' });
    
    // Don't allow editing of checked out gear (for single-quantity items)
    if (gear.quantity === 1 && gear.status === 'checked_out') {
      return res.status(400).json({ error: 'Cannot edit gear that is currently checked out' });
    }
    
    // Convert empty strings to "N/A"
    const serialValue = serial && typeof serial === 'string' && serial.trim() !== '' ? serial.trim() : 'N/A';
    
    // Check for duplicate serial when changed (only if serial is not blank/N/A)
    if (serialValue !== gear.serial && serialValue !== 'N/A') {
      const existingWithSerial = await GearInventory.findOne({ 
        serial: serialValue,
        _id: { $ne: gearId } // Exclude current gear
      });
      if (existingWithSerial) {
        return res.status(409).json({ 
          error: `Duplicate serial: this value already exists.`
        });
      }
    }
    
    // Note: We allow duplicate labels (same brand+model) as long as serials are different
    // This allows multiple units of the same item with different serial numbers
    
    gear.label = label;
    gear.category = category;
    gear.serial = serialValue;
    gear.quantity = quantity;
    
    await gear.save();
    const updated = await GearInventory.findById(gearId).populate('notes.createdBy', 'fullName email');
    res.json({ message: 'Gear updated successfully', gear: updated });
  } catch (err) {
    console.error('Error updating gear:', err);
    res.status(500).json({ error: 'Failed to update gear: ' + err.message });
  }
});

// Add a note to an inventory item (scoped to a specific serial number)
app.post('/api/gear-inventory/:id/notes', authenticate, async (req, res) => {
  try {
    if (!canManageGearInventory(req.user)) {
      return res.status(403).json({ error: 'Not authorized to edit gear inventory' });
    }
    const gearId = req.params.id;
    const { text, serial } = req.body;

    if (!gearId) return res.status(400).json({ error: 'Missing gear ID' });
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Note text is required' });
    }

    const gear = await GearInventory.findById(gearId);
    if (!gear) return res.status(404).json({ error: 'Gear not found' });

    const serialValue = (serial && typeof serial === 'string' && serial.trim() !== '')
      ? serial.trim()
      : (gear.serial || 'N/A');

    let targetGear = gear;
    if (serialValue !== gear.serial) {
      const sibling = await GearInventory.findOne({
        label: gear.label,
        serial: serialValue
      });
      if (!sibling) {
        return res.status(404).json({
          error: `No inventory unit found with serial "${serialValue}" for ${gear.label}`
        });
      }
      targetGear = sibling;
    }

    if (!targetGear.notes) targetGear.notes = [];
    targetGear.notes.push({
      serial: serialValue,
      text: text.trim(),
      createdAt: new Date(),
      createdBy: req.user.id
    });
    await targetGear.save();

    const savedGear = await GearInventory.findById(targetGear._id).populate('notes.createdBy', 'fullName email');
    const savedNote = savedGear.notes[savedGear.notes.length - 1];
    const allWithLabel = await GearInventory.find({ label: gear.label }).populate('notes.createdBy', 'fullName email');

    res.json({
      message: 'Note added',
      note: savedNote,
      gear: savedGear,
      serial: serialValue,
      relatedItems: allWithLabel
    });
  } catch (err) {
    console.error('Error adding inventory note:', err);
    res.status(500).json({ error: 'Failed to add note: ' + err.message });
  }
});

// Repair gear inventory data
app.post('/api/gear-inventory/repair', authenticate, async (req, res) => {
  try {
    if (!canManageGearInventory(req.user)) {
      return res.status(403).json({ error: 'Not authorized to edit gear inventory' });
    }
    console.log("Starting gear inventory repair...");
    
    // Get all gear
    const allGear = await GearInventory.find();
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    
    const repairResults = [];
    
    for (const gear of allGear) {
      const originalHistoryCount = gear.history.length;
      let modified = false;
      
      // Repair 1: Remove any history entries with missing event IDs
      gear.history = gear.history.filter(entry => {
        if (!entry.event) {
          console.log(`Removing history entry without event ID from ${gear.label}`);
          modified = true;
          return false;
        }
        return true;
      });
      
      // Repair 2: Remove duplicate history entries for the same event
      const seenEvents = new Map();
      gear.history = gear.history.filter(entry => {
        const eventId = entry.event.toString();
        
        if (seenEvents.has(eventId)) {
          console.log(`Removing duplicate history entry for event ${eventId} from ${gear.label}`);
          modified = true;
          return false;
        }
        
        seenEvents.set(eventId, true);
        return true;
      });
      
      // Repair 3: Ensure gear status is correct
      if (gear.status === 'checked_out') {
        // If no checkedOutEvent but status is checked_out, fix it
        if (!gear.checkedOutEvent) {
          console.log(`Fixing gear ${gear.label} with checked_out status but no event`);
          gear.status = 'available';
          gear.checkOutDate = null;
          gear.checkInDate = null;
          modified = true;
        }
        // If gear is checked out but the check-in date is in the past, fix it
        else if (gear.checkInDate) {
          const checkInDate = new Date(gear.checkInDate);
          checkInDate.setUTCHours(0, 0, 0, 0);
          
          if (checkInDate < now) {
            console.log(`Auto-checking in gear ${gear.label} with past check-in date`);
            gear.status = 'available';
            gear.checkedOutEvent = null;
            gear.checkedOutBy = null;
            gear.checkOutDate = null;
            gear.checkInDate = null;
            modified = true;
          }
        }
      }
      
      if (modified) {
        await gear.save();
        repairResults.push({
          label: gear.label,
          historyBefore: originalHistoryCount,
          historyAfter: gear.history.length,
          statusChanged: modified,
          newStatus: gear.status
        });
      }
    }
    
    console.log("Repair complete:", repairResults);
    
    res.json({
      message: 'Repair complete',
      itemsRepaired: repairResults.length,
      details: repairResults
    });
  } catch (err) {
    console.error("Error during repair:", err);
    res.status(500).json({ error: 'Repair failed: ' + err.message });
  }
});

// Release all reservations for a gear item
app.post('/api/gear-inventory/:id/release-all', authenticate, async (req, res) => {
  try {
    if (!canManageGearInventory(req.user)) {
      return res.status(403).json({ error: 'Not authorized to edit gear inventory' });
    }
    const gearId = req.params.id;
    if (!gearId) return res.status(400).json({ error: 'Missing gear ID' });
    
    const gear = await GearInventory.findById(gearId);
    if (!gear) return res.status(404).json({ error: 'Gear not found' });
    
    console.log(`[Release All] Starting release for gear: ${gear.label} (${gear._id})`);
    console.log(`[Release All] Current reservations: ${gear.reservations?.length || 0}`);
    console.log(`[Release All] Current history entries: ${gear.history?.length || 0}`);
    
    // Step 1: Clear all reservations and history from the gear item
    gear.reservations = [];
    gear.history = [];
    
    // Reset status for single-quantity items
    if (gear.quantity === 1) {
      gear.status = 'available';
      gear.checkedOutBy = null;
      gear.checkedOutEvent = null;
      gear.checkOutDate = null;
      gear.checkInDate = null;
    }
    
    await gear.save();
    
    // Step 2: Remove this gear item from all gear lists in all events
    console.log(`[Release All] Removing ${gear.label} from all gear lists...`);
    console.log(`[Release All] Looking for gear with ID: ${gearId} and label: "${gear.label}"`);
    
    // Find all tables that might have this gear item in their gear lists
    const allTables = await Table.find({
      'gear.lists': { $exists: true }
    });
    
    console.log(`[Release All] Found ${allTables.length} tables with gear lists to check`);
    
    let removedFromEvents = 0;
    let totalItemsRemoved = 0;
    const affectedEventTitles = [];
    
    for (const table of allTables) {
      let tableModified = false;
      const lists = table.gear?.lists || new Map();
      
      console.log(`[Release All] Checking table: ${table.title} (${table._id})`);
      console.log(`[Release All] Lists type: ${lists.constructor.name}, size: ${lists instanceof Map ? lists.size : Object.keys(lists).length}`);
      
      // Convert Map to Object if needed for consistent iteration
      let listsObj;
      if (lists instanceof Map) {
        listsObj = Object.fromEntries(lists);
      } else if (lists && lists._doc) {
        // Handle Mongoose Map - the actual data is in _doc
        listsObj = lists._doc;
      } else {
        listsObj = lists;
      }
      
      // Log the structure of the gear lists for debugging
      console.log(`[Release All] Gear lists structure for ${table.title}:`, Object.keys(listsObj));
      
      // Iterate through each list in the table
      for (const [listName, listData] of Object.entries(listsObj)) {
        if (!listData || typeof listData !== 'object') {
          console.log(`[Release All] Skipping invalid list data for ${listName}`);
          continue;
        }
        
        console.log(`[Release All] Checking list: ${listName}`);
        
        // Handle the case where listData might also be a Mongoose document
        let actualListData = listData;
        if (listData._doc) {
          actualListData = listData._doc;
        }
        
        console.log(`[Release All] List data structure:`, Object.keys(actualListData));
        
        // Iterate through each category in the list
        let categoriesToCheck = actualListData;
        
        // Check if the list has a 'categories' property (new structure)
        if (actualListData.categories && typeof actualListData.categories === 'object') {
          console.log(`[Release All] Found categories structure in ${listName}`);
          categoriesToCheck = actualListData.categories;
          
          // Handle case where categories might also be a Mongoose document
          if (categoriesToCheck._doc) {
            categoriesToCheck = categoriesToCheck._doc;
          }
        }
        
        console.log(`[Release All] Categories to check:`, Object.keys(categoriesToCheck));
        
        for (const [categoryName, items] of Object.entries(categoriesToCheck)) {
          if (!Array.isArray(items)) {
            console.log(`[Release All] Skipping non-array category: ${categoryName}`);
            continue;
          }
          
          console.log(`[Release All] Checking category: ${categoryName} with ${items.length} items`);
          
          // Log all items in this category for debugging
          items.forEach((item, index) => {
            console.log(`[Release All] Item ${index}: inventoryId="${item.inventoryId}", label="${item.label}"`);
          });
          
          // Filter out items that match this gear (by inventoryId or label)
          const originalLength = items.length;
          const filteredItems = items.filter(item => {
            // Match by inventoryId (primary) or label (fallback)
            const matchesId = item.inventoryId && item.inventoryId.toString() === gearId.toString();
            const matchesLabel = item.label && (
              item.label === gear.label || 
              item.label.startsWith(gear.label + ' (') // Handle quantity labels like "Sony NP-FZ100 (5 units)"
            );
            
            console.log(`[Release All] Comparing item: inventoryId="${item.inventoryId}" vs "${gearId}", label="${item.label}" vs "${gear.label}"`);
            console.log(`[Release All] Match results: matchesId=${matchesId}, matchesLabel=${matchesLabel}`);
            
            if (matchesId || matchesLabel) {
              console.log(`[Release All] MATCH FOUND! Removing item from ${table.title} -> ${listName} -> ${categoryName}: ${item.label || item.inventoryId}`);
              return false; // Remove this item
            }
            return true; // Keep this item
          });
          
          if (filteredItems.length !== originalLength) {
            categoriesToCheck[categoryName] = filteredItems;
            tableModified = true;
            totalItemsRemoved += (originalLength - filteredItems.length);
            console.log(`[Release All] Removed ${originalLength - filteredItems.length} items from ${categoryName}`);
          }
        }
      }
      
      // Save the table if it was modified
      if (tableModified) {
        // Convert back to Map if the original was a Map
        if (lists instanceof Map) {
          table.gear.lists = new Map(Object.entries(listsObj));
        } else {
          table.gear.lists = listsObj;
        }
        
        await table.save();
        removedFromEvents++;
        affectedEventTitles.push(table.title);
        console.log(`[Release All] Updated gear lists for event: ${table.title}`);
        
        // Notify clients about the gear list change
        notifyDataChange('gearListUpdated', { 
          message: `${gear.label} removed from all lists due to release all` 
        }, table._id.toString());
      } else {
        console.log(`[Release All] No modifications needed for table: ${table.title}`);
      }
    }
    
    console.log(`[Release All] Successfully released all reservations for ${gear.label}`);
    console.log(`[Release All] Removed from ${removedFromEvents} events, total ${totalItemsRemoved} items removed from gear lists`);
    
    res.json({ 
      message: `All reservations released for ${gear.label}. Removed from ${removedFromEvents} event(s).`,
      gear: gear,
      releasedReservations: true,
      removedFromLists: totalItemsRemoved,
      affectedEvents: removedFromEvents,
      affectedEventTitles: affectedEventTitles,
      reservationCount: gear.reservations?.length || 0
    });
    
  } catch (error) {
    console.error('[Release All] Error:', error);
    res.status(500).json({ error: 'Failed to release reservations: ' + error.message });
  }
});

// ========= GEAR PACKAGES API =========

// Get list of events that have gear reserved (for dashboard badges)
// This route MUST be defined BEFORE the gearPackagesRoutes router to avoid being caught by /:id
app.get('/api/gear-packages/events-with-gear', authenticate, async (req, res) => {
  try {
    // Get distinct eventIds that have reserved gear items
    const eventIds = await ReservedGearItem.distinct('eventId');
    res.json({ eventIds });
  } catch (err) {
    console.error('[EVENTS WITH GEAR] Error:', err);
    res.status(500).json({ error: 'Failed to fetch events with gear' });
  }
});

// Use the gear packages routes
const gearPackagesRoutes = require('./routes/gearPackages');
app.use('/api/gear-packages', authenticate, gearPackagesRoutes);

// Fallback route in case the module doesn't load properly
app.get('/api/gear-packages-fallback', authenticate, async (req, res) => {
  try {
    console.log('[Fallback] GET gear packages for user:', req.user.id);
    const ReservedGearItem = require('./models/ReservedGearItem');
    const packages = await ReservedGearItem.find({ userId: String(req.user.id) })
      .sort({ createdAt: -1 })
      .select('_id name description createdAt');
    
    console.log(`[Fallback] Found ${packages.length} packages`);
    res.json(packages);
  } catch (err) {
    console.error('[Fallback] Error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// Add a direct test endpoint for diagnostic purposes
app.get('/api/gear-packages-test/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const ReservedGearItem = require('./models/ReservedGearItem');
    
    console.log('[Test] Directly testing user ID:', userId);
    console.log('[Test] Authenticated user ID:', req.user.id);
    
    // Helper to normalize user ID
    function normalizeUserId(id) {
      if (!id) return null;
      return String(id);
    }
    
    // First, try with exact match
    let packages = await ReservedGearItem.find({ userId: userId })
      .sort({ createdAt: -1 })
      .select('_id name description createdAt');
    
    console.log(`[Test] Found ${packages.length} packages with exact userId match`);
    
    // If none found, try with normalized version
    if (packages.length === 0) {
      const normalizedId = normalizeUserId(userId);
      console.log(`[Test] Trying with normalized ID: ${normalizedId}`);
      
      packages = await ReservedGearItem.find({ userId: normalizedId })
        .sort({ createdAt: -1 })
        .select('_id name description createdAt');
      
      console.log(`[Test] Found ${packages.length} packages with normalized userId match`);
      
      // If still none found, do a flexible search through all packages
      if (packages.length === 0) {
        console.log('[Test] Trying flexible search through all packages');
        const allPackages = await ReservedGearItem.find()
          .select('_id name description createdAt userId');
        
        console.log(`[Test] Total packages in database: ${allPackages.length}`);
        
        // Log details of found packages
        if (allPackages.length > 0) {
          console.log('[Test] Sample of packages found:');
          allPackages.slice(0, 3).forEach((pkg, i) => {
            console.log(`  ${i+1}. ID: ${pkg._id}, Name: ${pkg.name}, UserId: ${pkg.userId}`);
          });
          
          // Try to find matches using flexible comparison
          const matchedPackages = allPackages.filter(pkg => normalizeUserId(pkg.userId) === normalizedId);
          console.log(`[Test] Found ${matchedPackages.length} packages with flexible comparison`);
          
          if (matchedPackages.length > 0) {
            packages = matchedPackages;
          }
        }
      }
    }
    
    res.json({
      requestedUserId: userId,
      normalizedUserId: normalizeUserId(userId),
      authenticatedUserId: req.user.id,
      normalizedAuthUserId: normalizeUserId(req.user.id),
      count: packages.length,
      packages: packages
    });
  } catch (err) {
    console.error('[Test] Error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// Add a simple endpoint to get ALL gear packages (no filtering)
app.get('/api/gear-packages-all', authenticate, async (req, res) => {
  try {
    console.log('[ALL] Getting all reserved items');
    const ReservedGearItem = require('./models/ReservedGearItem');
    
    // Get all packages in the database
    const packages = await ReservedGearItem.find()
      .sort({ createdAt: -1 })
      .select('_id name description createdAt userId');
    
    console.log(`[ALL] Found ${packages.length} total packages`);
    
    // Return all packages with user ID info
    res.json({
      count: packages.length,
      packages: packages
    });
  } catch (err) {
    console.error('[ALL] Error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// ========= RESERVATION MANAGEMENT API =========

// Get all reservations for a specific inventory item (Admin / production manager)
app.get('/api/inventory/:inventoryId/reservations', authenticate, async (req, res) => {
  try {
    const { inventoryId } = req.params;
    
    if (!canManageGearInventory(req.user)) {
      return res.status(403).json({ error: 'Inventory manager access required' });
    }
    
    console.log(`[RESERVATIONS] Getting reservations for inventory item: ${inventoryId}`);
    
    // Get inventory item details
    const inventoryItem = await GearInventory.findById(inventoryId);
    if (!inventoryItem) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }
    
    // Get all ReservedGearItem entries for this inventory item (user-facing reservations)
    const reservedItems = await ReservedGearItem.find({ inventoryId })
      .populate('eventId', 'title general.start general.end gear.checkOutDate gear.checkInDate')
      .populate('userId', 'fullName email')
      .sort({ createdAt: -1 });
    
    console.log(`[RESERVATIONS] Found ${reservedItems.length} user-facing reservations`);
    
    // Get availability statistics from GearInventory for admin info
    const totalReservedQuantity = inventoryItem.reservations.reduce((sum, res) => sum + res.quantity, 0);
    const availableQuantity = inventoryItem.quantity - totalReservedQuantity;
    
    res.json({
      inventoryItem: {
        _id: inventoryItem._id,
        label: inventoryItem.label,
        category: inventoryItem.category,
        serial: inventoryItem.serial,
        quantity: inventoryItem.quantity,
        totalReserved: totalReservedQuantity,
        available: availableQuantity
      },
      reservedItems
    });
    
  } catch (error) {
    console.error('[RESERVATIONS] Error getting reservations:', error);
    res.status(500).json({ error: 'Failed to get reservations' });
  }
});

// Release specific reservation (Admin / production manager) - Atomically releases from both models
app.delete('/api/reservations/:reservationId', authenticate, async (req, res) => {
  try {
    const { reservationId } = req.params;
    
    if (!canManageGearInventory(req.user)) {
      return res.status(403).json({ error: 'Inventory manager access required' });
    }
    
    console.log(`[RELEASE] Releasing reservation: ${reservationId}`);
    
    // Start atomic transaction
    const session = await mongoose.startSession();
    
    try {
      await session.withTransaction(async () => {
        // Find the ReservedGearItem
        const reservedItem = await ReservedGearItem.findById(reservationId).session(session);
        if (!reservedItem) {
          throw new Error('Reserved item not found');
        }
        
        console.log(`[RELEASE] Found reservation: ${reservedItem.brand} ${reservedItem.model} for event ${reservedItem.eventId}`);
        
        // Release from GearInventory model (availability engine)
        const inventoryItem = await GearInventory.findById(reservedItem.inventoryId).session(session);
        if (inventoryItem) {
          inventoryItem.releaseQuantity(
            reservedItem.eventId,
            reservedItem.userId,
            reservedItem.quantity
          );
          await inventoryItem.save({ session });
          console.log(`[RELEASE] Released ${reservedItem.quantity} units from availability engine`);
        }
        
        // Delete the ReservedGearItem (user-facing reservation)
        await ReservedGearItem.findByIdAndDelete(reservationId, { session });
        console.log(`[RELEASE] Deleted user-facing reservation: ${reservationId}`);
      });
      
      console.log(`[RELEASE] Successfully released reservation atomically`);
      res.json({ message: 'Reservation released successfully' });
      
    } finally {
      await session.endSession();
    }
    
  } catch (error) {
    console.error('[RELEASE] Error releasing reservation:', error);
    res.status(500).json({ error: error.message || 'Failed to release reservation' });
  }
});

// Release all reservations for an inventory item (Admin / production manager)
app.delete('/api/inventory/:inventoryId/reservations/all', authenticate, async (req, res) => {
  try {
    const { inventoryId } = req.params;
    
    if (!canManageGearInventory(req.user)) {
      return res.status(403).json({ error: 'Inventory manager access required' });
    }
    
    console.log(`[RELEASE ALL] Releasing all reservations for inventory: ${inventoryId}`);
    
    // Start atomic transaction
    const session = await mongoose.startSession();
    
    try {
      let releasedCount = 0;
      
      await session.withTransaction(async () => {
        // Get inventory item
        const inventoryItem = await GearInventory.findById(inventoryId).session(session);
        if (!inventoryItem) {
          throw new Error('Inventory item not found');
        }
        
        // Count reservations before release
        const reservedItemsCount = await ReservedGearItem.countDocuments({ inventoryId }).session(session);
        const activeReservationsCount = inventoryItem.reservations.length;
        releasedCount = reservedItemsCount;
        
        console.log(`[RELEASE ALL] Found ${reservedItemsCount} user-facing reservations and ${activeReservationsCount} availability reservations`);
        
        // Clear all active reservations from GearInventory (availability engine)
        inventoryItem.reservations = [];
        await inventoryItem.save({ session });
        
        // Delete all ReservedGearItem entries (user-facing reservations)
        await ReservedGearItem.deleteMany({ inventoryId }, { session });
        
        console.log(`[RELEASE ALL] Atomically released all reservations for ${inventoryItem.label}`);
      });
      
      res.json({ 
        message: 'All reservations released successfully',
        releasedCount: releasedCount
      });
      
    } finally {
      await session.endSession();
    }
    
  } catch (error) {
    console.error('[RELEASE ALL] Error releasing all reservations:', error);
    res.status(500).json({ error: error.message || 'Failed to release all reservations' });
  }
});

// ========= ATOMIC RESERVATION SERVICE =========
const AtomicReservationService = require('./services/AtomicReservationService');

// Legacy helper for backward compatibility (now uses bulletproof service)
async function createAtomicReservation(inventoryId, eventId, userId, quantity, checkOutDate, checkInDate, listName, serial = null, specificSerialRequested = false) {
  return await AtomicReservationService.createReservation({
    inventoryId, eventId, userId, quantity, checkOutDate, checkInDate, listName, serial, specificSerialRequested
  });
}

// Legacy helper for backward compatibility (now uses bulletproof service)
async function releaseAtomicReservation(reservedItemId) {
  return await AtomicReservationService.releaseReservation(reservedItemId);
}

// ========= END ATOMIC RESERVATION HELPERS =========

// ========= END RESERVATION MANAGEMENT API =========

// ========= END GEAR PACKAGES API =========

// Get gear packages for a specific event
app.get('/api/gear-packages/event/:eventId', authenticate, async (req, res) => {
  try {
    const { eventId } = req.params;
    const { listName } = req.query; // Get list name from query parameter
    const userId = req.user.id;

    console.log(`[GEAR LOAD] Loading gear for event ${eventId}, list: ${listName || 'Main List'} (collaborative mode)`);

    // Check if user has access to this event (planners get read-only access)
    const table = await Table.findById(eventId);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    if (!hasEventReadAccess(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized to access this event' });
    }

    // Find ALL reserved gear items for this event and list (collaborative mode)
    const reservedItems = await ReservedGearItem.find({ 
      eventId,
      listName: listName || 'Main List'
    }).populate('inventoryId', 'label category serial quantity');

    console.log(`[GEAR LOAD] Found ${reservedItems.length} reserved items (all users)`);

    // Filter out items with null inventoryId (orphaned items)
    const validItems = reservedItems.filter(item => item.inventoryId !== null);
    const orphanedItems = reservedItems.filter(item => item.inventoryId === null);
    
    if (orphanedItems.length > 0) {
      console.warn(`[GEAR LOAD] Found ${orphanedItems.length} orphaned items with null inventoryId, filtering them out`);
      orphanedItems.forEach(item => {
        console.warn(`[GEAR LOAD] Orphaned item: ${item._id} - ${item.brand} ${item.model}`);
      });
      
      // Clean up orphaned items asynchronously (don't block the response)
      ReservedGearItem.deleteMany({ 
        _id: { $in: orphanedItems.map(item => item._id) }
      }).then(result => {
        console.log(`[GEAR LOAD] Cleaned up ${result.deletedCount} orphaned items`);
      }).catch(err => {
        console.error(`[GEAR LOAD] Error cleaning up orphaned items:`, err);
      });
    }

    // If no valid reserved items found, still return manual items
    if (!validItems || validItems.length === 0) {
      console.log(`[GEAR LOAD] No valid reserved items found, checking for manual items`);
      const currentGearList = table.gear?.gearLists?.find(list => list.name === (listName || 'Main List'));
      const manualItems = currentGearList?.manualItems || [];
      return res.json({ 
        reservedItems: [],
        manualItems: manualItems,
        userPermissions: {
          canReserve: canManageEventGearLists(table, req.user),
          canManageLists: canManageEventGearLists(table, req.user),
          canPack: true
        }
      });
    }
    
    // Log sample data for debugging
    if (validItems.length > 0) {
      console.log(`[GEAR LOAD] Sample valid reserved item:`, {
        _id: validItems[0]._id,
        inventoryId: validItems[0].inventoryId,
        quantity: validItems[0].quantity,
        isPacked: validItems[0].isPacked,
        brand: validItems[0].brand,
        model: validItems[0].model
      });
    }
    
    // Get manual items for the current list
    const currentGearList = table.gear?.gearLists?.find(list => list.name === (listName || 'Main List'));
    const manualItems = currentGearList?.manualItems || [];

    res.json({ 
      reservedItems: validItems,
      manualItems: manualItems,
      userPermissions: {
        canReserve: canManageEventGearLists(table, req.user),
        canManageLists: canManageEventGearLists(table, req.user),
        canPack: true
      }
    });
  } catch (error) {
    console.error('Error getting reserved items for event:', error);
    res.status(500).json({ error: 'Failed to get reserved items' });
  }
});

// Get packing progress for ALL gear lists in an event
app.get('/api/gear-packages/event/:eventId/all-progress', authenticate, async (req, res) => {
  try {
    const { eventId } = req.params;

    const table = await Table.findById(eventId);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (!hasEventReadAccess(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized to access this event' });
    }

    const gearLists = table.gear?.gearLists || [];
    const listNames = gearLists.map(l => l.name);

    // If no lists exist, ensure Main List is included
    if (listNames.length === 0) {
      listNames.push('Main List');
    }

    // Aggregate reserved items progress per list
    const progressAgg = await ReservedGearItem.aggregate([
      { $match: { eventId: table._id } },
      { $group: {
        _id: '$listName',
        total: { $sum: 1 },
        packed: { $sum: { $cond: ['$isPacked', 1, 0] } }
      }}
    ]);

    // Build a map from aggregation results
    const progressMap = {};
    progressAgg.forEach(item => {
      progressMap[item._id] = { total: item.total, packed: item.packed };
    });

    // Build per-list progress including manual items
    const lists = listNames.map(name => {
      const reservedProgress = progressMap[name] || { total: 0, packed: 0 };
      const gearList = gearLists.find(l => l.name === name);
      const manualItems = gearList?.manualItems || [];
      const manualTotal = manualItems.length;
      const manualPacked = manualItems.filter(m => m.completed).length;

      return {
        name,
        displayName: gearList?.displayName || null,
        total: reservedProgress.total + manualTotal,
        packed: reservedProgress.packed + manualPacked
      };
    });

    const overallTotal = lists.reduce((sum, l) => sum + l.total, 0);
    const overallPacked = lists.reduce((sum, l) => sum + l.packed, 0);

    res.json({ lists, overallTotal, overallPacked });
  } catch (error) {
    console.error('Error getting all-lists progress:', error);
    res.status(500).json({ error: 'Failed to get progress' });
  }
});

// Get saved packages for an event (for package management)
app.get('/api/gear-packages/event/:eventId/packages', authenticate, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    // For now, return empty array as package management is not fully implemented
    // In a full implementation, this would return saved gear packages
    res.json([]);
  } catch (error) {
    console.error('Error getting saved packages:', error);
    res.status(500).json({ error: 'Failed to get saved packages' });
  }
});

// Toggle packed status for a gear item
app.patch('/api/gear-packages/:itemId/toggle-packed', authenticate, async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.user.id;

    console.log(`[TOGGLE PACKED] Toggling packed status for item ${itemId}, user ${userId}`);

    const reservedItem = await ReservedGearItem.findById(itemId);

    if (!reservedItem) {
      console.log(`[TOGGLE PACKED] Reserved item not found`);
      return res.status(404).json({ error: 'Reserved item not found' });
    }

    // Verify user has access to this event
    const table = await Table.findById(reservedItem.eventId);
    if (!table || !hasEventAccess(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized to access this event' });
    }

    // Toggle packed status (ReservedGearItem uses isPacked field)
    reservedItem.isPacked = !reservedItem.isPacked;
    reservedItem.packedAt = reservedItem.isPacked ? new Date() : null;
    await reservedItem.save();

    console.log(`[TOGGLE PACKED] Updated packed status to: ${reservedItem.isPacked}`);

    res.json({ success: true, packed: reservedItem.isPacked });
  } catch (error) {
    console.error('Error toggling packed status:', error);
    res.status(500).json({ error: 'Failed to toggle packed status' });
  }
});

// Test endpoint to verify server is working
app.get('/api/test-delete/:itemId', (req, res) => {
  console.log(`[TEST] Test endpoint called with itemId: ${req.params.itemId}`);
  console.log(`[TEST] Headers:`, req.headers);
  res.json({ message: 'Test endpoint working', itemId: req.params.itemId });
});

// Note: DELETE /api/gear-packages/:itemId is handled by routes/gearPackages.js

// PACKAGE TEMPLATES API ENDPOINTS
// Get all package templates (global)
app.get('/api/package-templates', authenticate, async (req, res) => {
  try {
    const templates = await PackageTemplate.find()
      .populate('createdBy', 'fullName')
      .sort({ name: 1 });
    
    res.json(templates);
  } catch (error) {
    console.error('Error fetching package templates:', error);
    res.status(500).json({ error: 'Failed to fetch package templates' });
  }
});

// Create new package template
app.post('/api/package-templates', authenticate, async (req, res) => {
  try {
    const { name, description, items } = req.body;
    
    if (!name || !items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Name and items array are required' });
    }
    
    const template = new PackageTemplate({
      name,
      description: description || '',
      items,
      createdBy: req.user.id
    });
    
    await template.save();
    await template.populate('createdBy', 'fullName');
    
    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating package template:', error);
    res.status(500).json({ error: 'Failed to create package template' });
  }
});

// Update package template
app.put('/api/package-templates/:id', authenticate, async (req, res) => {
  try {
    const { name, description, items } = req.body;
    
    const template = await PackageTemplate.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ error: 'Package template not found' });
    }
    
    // Allow update if user is creator or admin
    if (template.createdBy.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to edit this template' });
    }
    
    template.name = name || template.name;
    template.description = description !== undefined ? description : template.description;
    template.items = items || template.items;
    
    await template.save();
    await template.populate('createdBy', 'fullName');
    
    res.json(template);
  } catch (error) {
    console.error('Error updating package template:', error);
    res.status(500).json({ error: 'Failed to update package template' });
  }
});

// Delete package template
app.delete('/api/package-templates/:id', authenticate, async (req, res) => {
  try {
    const template = await PackageTemplate.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ error: 'Package template not found' });
    }
    
    // Allow deletion if user is creator or admin
    if (template.createdBy.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to delete this template' });
    }
    
    await PackageTemplate.findByIdAndDelete(req.params.id);
    res.json({ message: 'Package template deleted successfully' });
  } catch (error) {
    console.error('Error deleting package template:', error);
    res.status(500).json({ error: 'Failed to delete package template' });
  }
});

// GEAR LISTS API ENDPOINTS
// Get gear lists for an event
app.get('/api/tables/:eventId/gear-lists', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.eventId);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check access (planners get read-only access to all events)
    if (!hasEventReadAccess(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized to access this event' });
    }
    
    let gearLists = table.gear?.gearLists || [];
    
    // Ensure Main List always exists
    if (gearLists.length === 0 || !gearLists.find(list => list.name === 'Main List')) {
      // Initialize gear structure if needed
      if (!table.gear) {
        table.gear = {};
      }
      if (!table.gear.gearLists) {
        table.gear.gearLists = [];
      }
      
      // Add Main List if it doesn't exist
      if (!gearLists.find(list => list.name === 'Main List')) {
        table.gear.gearLists.unshift({
          name: 'Main List',
          createdAt: new Date(),
          createdBy: null // System created
        });
        await table.save();
        gearLists = table.gear.gearLists;
      }
    }
    
    const currentList = table.gear?.currentList || 'Main List';
    const canManage = canManageEventGearLists(table, req.user);
    
    res.json({
      gearLists,
      currentList,
      userPermissions: {
        canReserve: canManage,
        canManageLists: canManage,
        canPack: true
      }
    });
  } catch (error) {
    console.error('Error fetching gear lists:', error);
    res.status(500).json({ error: 'Failed to fetch gear lists' });
  }
});

// Create new gear list
app.post('/api/tables/:eventId/gear-lists', authenticate, async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'List name is required' });
    }
    
    const table = await Table.findById(req.params.eventId);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Owners, leads, shared collaborators, assigned crew, and admins can create lists
    if (!canManageEventGearLists(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized to create gear lists for this event' });
    }
    
    // Check if list name already exists
    const existingList = table.gear?.gearLists?.find(list => list.name === name.trim());
    if (existingList) {
      return res.status(409).json({ error: 'A list with this name already exists' });
    }
    
    // Initialize gear if not exists
    if (!table.gear) {
      table.gear = {};
    }
    if (!table.gear.gearLists) {
      table.gear.gearLists = [];
    }
    
    // Add new list
    table.gear.gearLists.push({
      name: name.trim(),
      createdBy: req.user.id,
      createdAt: new Date()
    });
    
    await table.save();
    
    res.status(201).json({ message: 'Gear list created successfully', name: name.trim() });
  } catch (error) {
    console.error('Error creating gear list:', error);
    res.status(500).json({ error: 'Failed to create gear list' });
  }
});

// Update gear list name
app.put('/api/tables/:eventId/gear-lists/:listName', authenticate, async (req, res) => {
  try {
    const { newName } = req.body;
    const { listName } = req.params;
    
    if (!newName || !newName.trim()) {
      return res.status(400).json({ error: 'New list name is required' });
    }
    
    const table = await Table.findById(req.params.eventId);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check access - only owners and admins can update lists
    if (!canManageEventGearLists(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized to update gear lists for this event' });
    }
    
    // Find the list
    const listIndex = table.gear?.gearLists?.findIndex(list => list.name === listName);
    if (listIndex === -1) {
      return res.status(404).json({ error: 'Gear list not found' });
    }
    
    // For "Main List", only update the displayName alias (keeps backend stable)
    if (listName === 'Main List') {
      const trimmedName = newName.trim();
      // Check display name doesn't clash with another list's real name or display name
      const clash = table.gear.gearLists.find(list => 
        list.name !== 'Main List' && (list.name === trimmedName || list.displayName === trimmedName)
      );
      if (clash) {
        return res.status(409).json({ error: 'A list with this name already exists' });
      }
      
      // If renaming back to "Main List", clear the displayName
      table.gear.gearLists[listIndex].displayName = trimmedName === 'Main List' ? null : trimmedName;
      await table.save();
      
      return res.json({ 
        message: 'Gear list display name updated successfully', 
        oldName: listName, 
        newName: listName, // Internal name stays the same
        displayName: table.gear.gearLists[listIndex].displayName 
      });
    }
    
    // For non-Main lists, rename normally
    // Check if new name already exists (check both name and displayName)
    const existingList = table.gear.gearLists.find(list => {
      if (list.name === listName) return false; // Skip self
      return list.name === newName.trim() || list.displayName === newName.trim();
    });
    if (existingList) {
      return res.status(409).json({ error: 'A list with this name already exists' });
    }
    
    // Update list name
    const oldName = table.gear.gearLists[listIndex].name;
    table.gear.gearLists[listIndex].name = newName.trim();
    // Clear displayName since the real name is changing
    table.gear.gearLists[listIndex].displayName = null;
    
    // Update current list if it was the renamed one
    if (table.gear.currentList === oldName) {
      table.gear.currentList = newName.trim();
    }
    
    // Update all reserved items with this list name
    await ReservedGearItem.updateMany(
      { eventId: req.params.eventId, listName: oldName },
      { listName: newName.trim() }
    );
    
    await table.save();
    
    res.json({ message: 'Gear list renamed successfully', oldName, newName: newName.trim() });
  } catch (error) {
    console.error('Error updating gear list:', error);
    res.status(500).json({ error: 'Failed to update gear list' });
  }
});

// Delete gear list
app.delete('/api/tables/:eventId/gear-lists/:listName', authenticate, async (req, res) => {
  try {
    const { listName } = req.params;
    
    const table = await Table.findById(req.params.eventId);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check access - only owners and admins can delete lists
    if (!canManageEventGearLists(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized to delete gear lists for this event' });
    }
    
    // Check if trying to delete Main List
    if (listName === 'Main List') {
      return res.status(400).json({ error: 'Cannot delete the Main List.' });
    }
    
    // Check if it's the only list
    if (table.gear?.gearLists?.length <= 1) {
      return res.status(400).json({ error: 'Cannot delete the only gear list. At least one list must exist.' });
    }
    
    // Find and remove the list
    const listIndex = table.gear.gearLists.findIndex(list => list.name === listName);
    if (listIndex === -1) {
      return res.status(404).json({ error: 'Gear list not found' });
    }
    
    // Get count of reserved items in this list
    const reservedItemsCount = await ReservedGearItem.countDocuments({
      eventId: req.params.eventId,
      listName: listName
    });
    
    // Remove all reserved items in this list (this will release reservations)
    const reservedItems = await ReservedGearItem.find({
      eventId: req.params.eventId,
      listName: listName
    });
    
    // Release inventory reservations for each item
    for (const item of reservedItems) {
      if (item.inventoryId) {
        try {
          const inventoryItem = await GearInventory.findById(item.inventoryId);
          if (inventoryItem) {
            inventoryItem.releaseQuantity(
              req.params.eventId,
              item.userId,
              item.quantity
            );
            await inventoryItem.save();
          }
        } catch (error) {
          console.error(`Error releasing reservation for item ${item._id}:`, error);
        }
      }
    }
    
    // Delete all reserved items in this list
    await ReservedGearItem.deleteMany({
      eventId: req.params.eventId,
      listName: listName
    });
    
    // Remove the list from the table
    table.gear.gearLists.splice(listIndex, 1);
    
    // Update current list if it was the deleted one
    if (table.gear.currentList === listName) {
      table.gear.currentList = table.gear.gearLists[0]?.name || 'Main List';
    }
    
    await table.save();
    
    res.json({ 
      message: 'Gear list deleted successfully', 
      deletedList: listName,
      releasedItems: reservedItemsCount,
      newCurrentList: table.gear.currentList
    });
  } catch (error) {
    console.error('Error deleting gear list:', error);
    res.status(500).json({ error: 'Failed to delete gear list' });
  }
});

// MANUAL ITEMS API ENDPOINTS
// Add manual item to gear list
app.post('/api/tables/:eventId/gear-lists/:listName/manual-items', authenticate, async (req, res) => {
  try {
    const { eventId, listName } = req.params;
    const { text } = req.body;
    
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Item text is required' });
    }
    
    const table = await Table.findById(eventId);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check permissions - only owners and admins can add manual items
    if (!canManageEventGearLists(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized to add manual items for this event' });
    }
    
    // Find the gear list
    const gearList = table.gear?.gearLists?.find(list => list.name === listName);
    if (!gearList) {
      return res.status(404).json({ error: 'Gear list not found' });
    }
    
    // Add manual item
    if (!gearList.manualItems) {
      gearList.manualItems = [];
    }
    
    const newItem = {
      text: text.trim(),
      completed: false,
      createdBy: req.user.id,
      createdAt: new Date()
    };
    
    gearList.manualItems.push(newItem);
    await table.save();
    
    res.status(201).json({ 
      message: 'Manual item added successfully',
      item: newItem
    });
  } catch (error) {
    console.error('Error adding manual item:', error);
    res.status(500).json({ error: 'Failed to add manual item' });
  }
});

// Toggle manual item completion
app.patch('/api/tables/:eventId/gear-lists/:listName/manual-items/:itemId/toggle', authenticate, async (req, res) => {
  try {
    const { eventId, listName, itemId } = req.params;
    
    const table = await Table.findById(eventId);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check access to the event
    if (!hasEventAccess(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized to access this event' });
    }
    
    // Find the gear list
    const gearList = table.gear?.gearLists?.find(list => list.name === listName);
    if (!gearList) {
      return res.status(404).json({ error: 'Gear list not found' });
    }
    
    // Find the manual item
    const manualItem = gearList.manualItems?.find(item => item._id.toString() === itemId);
    if (!manualItem) {
      return res.status(404).json({ error: 'Manual item not found' });
    }
    
    // Toggle completion status
    manualItem.completed = !manualItem.completed;
    await table.save();
    
    res.json({ 
      message: 'Manual item updated successfully',
      item: manualItem
    });
  } catch (error) {
    console.error('Error toggling manual item:', error);
    res.status(500).json({ error: 'Failed to toggle manual item' });
  }
});

// Delete manual item
app.delete('/api/tables/:eventId/gear-lists/:listName/manual-items/:itemId', authenticate, async (req, res) => {
  try {
    const { eventId, listName, itemId } = req.params;
    
    const table = await Table.findById(eventId);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check permissions - only owners and admins can delete manual items
    if (!canManageEventGearLists(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized to delete manual items for this event' });
    }
    
    // Find the gear list
    const gearList = table.gear?.gearLists?.find(list => list.name === listName);
    if (!gearList) {
      return res.status(404).json({ error: 'Gear list not found' });
    }
    
    // Find and remove the manual item
    const itemIndex = gearList.manualItems?.findIndex(item => item._id.toString() === itemId);
    if (itemIndex === -1) {
      return res.status(404).json({ error: 'Manual item not found' });
    }
    
    gearList.manualItems.splice(itemIndex, 1);
    await table.save();
    
    res.json({ message: 'Manual item deleted successfully' });
  } catch (error) {
    console.error('Error deleting manual item:', error);
    res.status(500).json({ error: 'Failed to delete manual item' });
  }
});

// Set current gear list
app.put('/api/tables/:eventId/gear-lists/:listName/set-current', authenticate, async (req, res) => {
  try {
    const { listName } = req.params;
    
    const table = await Table.findById(req.params.eventId);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Check access (owners, leads, sharedWith, and admins)
    if (!hasEventAccess(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized to access this event' });
    }
    
    // Check if list exists
    const listExists = table.gear?.gearLists?.some(list => list.name === listName);
    if (!listExists) {
      return res.status(404).json({ error: 'Gear list not found' });
    }
    
    // Set as current list
    if (!table.gear) {
      table.gear = {};
    }
    table.gear.currentList = listName;
    
    await table.save();
    
    res.json({ message: 'Current gear list updated', currentList: listName });
  } catch (error) {
    console.error('Error setting current gear list:', error);
    res.status(500).json({ error: 'Failed to set current gear list' });
  }
});

// Get all events/tables that contain a specific gear item
app.get('/api/events/by-gear/:gearId', authenticate, async (req, res) => {
  try {
    const gearId = req.params.gearId;
    if (!gearId) {
      return res.status(400).json({ error: 'Gear ID is required' });
    }

    // First, get the gear item with populated user references
    const gearItem = await GearInventory.findById(gearId)
      .populate('checkedOutBy', 'fullName email')
      .populate('reservations.userId', 'fullName email')
      .populate('history.user', 'fullName email');
      
    if (!gearItem) {
      return res.status(404).json({ error: 'Gear item not found' });
    }

    console.log(`[Events by Gear] Looking for events containing gear: ${gearItem.label} (${gearId})`);
    console.log(`[Events by Gear] User role: ${req.user.role}, User ID: ${req.user.id}`);

    // Find tables based on user role
    let tables;
    if (req.user.role === 'admin') {
      // Admin can see all tables
      tables = await Table.find({});
      console.log(`[Events by Gear] Admin user - found ${tables.length} total tables`);
    } else {
      // Regular users can only see tables they own or are shared with
      tables = await Table.find({
        $or: [
          { owners: req.user.id },
          { sharedWith: req.user.id }
        ]
      });
      console.log(`[Events by Gear] Regular user - found ${tables.length} accessible tables`);
    }

    console.log(`[Events by Gear] Found ${tables.length} accessible tables:`);
    tables.forEach(table => {
      console.log(`[Events by Gear] - Table ID: ${table._id.toString()}, Title: "${table.title}"`);
    });

    const eventsWithGear = [];
    const eventIds = new Set(); // To avoid duplicates

    // Method 1: Check gear lists in events
    for (const table of tables) {
      if (table.gear && table.gear.lists) {
        const lists = table.gear.lists instanceof Map ? 
          Object.fromEntries(table.gear.lists) : table.gear.lists;
        
        for (const [listName, listData] of Object.entries(lists)) {
          if (!listData || !listData.categories) continue;
          
          for (const [categoryName, items] of Object.entries(listData.categories)) {
            if (!Array.isArray(items)) continue;
            
            const hasMatchingItem = items.some(item => {
              if (item.label === gearItem.label) return true;
              if (item.gearId && item.gearId === gearId) return true;
              if (item.inventoryId && item.inventoryId === gearId) return true;
              return false;
            });
            
            if (hasMatchingItem && !eventIds.has(table._id.toString())) {
              eventIds.add(table._id.toString());
              console.log(`[Events by Gear] Found ${gearItem.label} in event gear list: ${table.title}`);
              
              eventsWithGear.push({
                _id: table._id,
                title: table.title,
                startDate: table.gear?.checkOutDate || table.general?.start,
                endDate: table.gear?.checkInDate || table.general?.end,
                location: table.general?.location,
                client: table.general?.client,
                company: table.general?.company,
                isOwner: table.owners.includes(req.user.id),
                isShared: table.sharedWith.includes(req.user.id),
                isAdmin: req.user.role === 'admin',
                associationType: 'gear_list',
                gearListDetails: {
                  listName,
                  categoryName
                }
              });
              break;
            }
          }
        }
      }
    }

    // Method 2: Check gear item reservations for event associations
    if (gearItem.reservations && gearItem.reservations.length > 0) {
      for (const reservation of gearItem.reservations) {
        if (reservation.eventId) {
          console.log(`[Events by Gear] Checking reservation with event ID: ${reservation.eventId}`);
          
          const reservationEventId = reservation.eventId.toString();
          const table = tables.find(t => t._id.toString() === reservationEventId);
          
          if (table && !eventIds.has(table._id.toString())) {
            eventIds.add(table._id.toString());
            console.log(`[Events by Gear] Found ${gearItem.label} reserved for event: ${table.title}`);
            
            eventsWithGear.push({
              _id: table._id,
              title: table.title,
              startDate: reservation.checkOutDate || table.gear?.checkOutDate || table.general?.start,
              endDate: reservation.checkInDate || table.gear?.checkInDate || table.general?.end,
              location: table.general?.location,
              client: table.general?.client,
              company: table.general?.company,
              isOwner: table.owners.includes(req.user.id),
              isShared: table.sharedWith.includes(req.user.id),
              isAdmin: req.user.role === 'admin',
              associationType: 'reservation',
              reservationDetails: {
                checkOutDate: reservation.checkOutDate,
                checkInDate: reservation.checkInDate,
                quantity: reservation.quantity,
                reservedBy: reservation.userId ? {
                  _id: reservation.userId._id,
                  name: reservation.userId.fullName,
                  email: reservation.userId.email
                } : null,
                createdAt: reservation.createdAt
              }
            });
          } else if (!table) {
            console.log(`[Events by Gear] No accessible table found for reservation event ID: ${reservationEventId}`);
          }
        }
      }
    }

    // Method 3: Check gear item history for event associations - THIS IS THE KEY FIX
    if (gearItem.history && gearItem.history.length > 0) {
      console.log(`[Events by Gear] Checking ${gearItem.history.length} history entries for ${gearItem.label}`);
      
      for (const historyEntry of gearItem.history) {
        if (historyEntry.event) {
          console.log(`[Events by Gear] Checking history entry with event ObjectId: ${historyEntry.event}`);
          console.log(`[Events by Gear] Event ObjectId type: ${typeof historyEntry.event}, value: "${historyEntry.event}"`);
          console.log(`[Events by Gear] Event ObjectId constructor: ${historyEntry.event.constructor.name}`);
          console.log(`[Events by Gear] Raw event object:`, historyEntry.event);
          
          // Convert the ObjectId to string for comparison
          const historyEventId = historyEntry.event.toString();
          console.log(`[Events by Gear] Converted to string: "${historyEventId}"`);
          console.log(`[Events by Gear] String length: ${historyEventId.length}`);
          
          // Log all available tables for comparison
          console.log(`[Events by Gear] Available tables for comparison:`);
          tables.forEach((table, index) => {
            const tableId = table._id.toString();
            console.log(`[Events by Gear]   ${index + 1}. Table ID: "${tableId}" (length: ${tableId.length}), Title: "${table.title}"`);
            console.log(`[Events by Gear]      Exact match check: "${historyEventId}" === "${tableId}" = ${historyEventId === tableId}`);
            console.log(`[Events by Gear]      Case-insensitive match: ${historyEventId.toLowerCase() === tableId.toLowerCase()}`);
            console.log(`[Events by Gear]      Includes check: "${tableId}".includes("${historyEventId}") = ${tableId.includes(historyEventId)}`);
          });
          
          // Find the matching table by comparing _id
          const table = tables.find(t => {
            const tableId = t._id.toString();
            console.log(`[Events by Gear] Comparing history event ID "${historyEventId}" with table ID "${tableId}" for table "${t.title}"`);
            const isMatch = tableId === historyEventId;
            console.log(`[Events by Gear] Match result: ${isMatch}`);
            return isMatch;
          });
          
          if (table && !eventIds.has(table._id.toString())) {
            eventIds.add(table._id.toString());
            console.log(`[Events by Gear] ✅ MATCH FOUND! ${gearItem.label} in history for event: ${table.title}`);
            
            eventsWithGear.push({
              _id: table._id,
              title: table.title,
              startDate: historyEntry.checkOutDate || table.gear?.checkOutDate || table.general?.start,
              endDate: historyEntry.checkInDate || table.gear?.checkInDate || table.general?.end,
              location: table.general?.location,
              client: table.general?.client,
              company: table.general?.company,
              isOwner: table.owners.includes(req.user.id),
              isShared: table.sharedWith.includes(req.user.id),
              isAdmin: req.user.role === 'admin',
              associationType: 'history',
              historyDetails: {
                checkOutDate: historyEntry.checkOutDate,
                checkInDate: historyEntry.checkInDate,
                quantity: historyEntry.quantity,
                reservedBy: historyEntry.user ? {
                  _id: historyEntry.user._id,
                  name: historyEntry.user.fullName,
                  email: historyEntry.user.email
                } : null
              }
            });
          } else if (!table) {
            console.log(`[Events by Gear] ❌ No accessible table found for history event ID: ${historyEventId}`);
            console.log(`[Events by Gear] Available table IDs: [${tables.map(t => `"${t._id.toString()}"`).join(', ')}]`);
            
            // Additional debugging: Check if the event exists in ALL tables (not just accessible ones)
            console.log(`[Events by Gear] Checking if event exists in ALL tables (including non-accessible)...`);
            const allTables = await Table.find({});
            console.log(`[Events by Gear] Total tables in database: ${allTables.length}`);
            
            const matchingTableInAll = allTables.find(t => t._id.toString() === historyEventId);
            if (matchingTableInAll) {
              console.log(`[Events by Gear] ⚠️ Event found in database but user doesn't have access: "${matchingTableInAll.title}"`);
              console.log(`[Events by Gear] Table owners: [${matchingTableInAll.owners.map(o => o.toString()).join(', ')}]`);
              console.log(`[Events by Gear] Table sharedWith: [${matchingTableInAll.sharedWith.map(s => s.toString()).join(', ')}]`);
              console.log(`[Events by Gear] Current user ID: ${req.user.id}`);
              
              // For non-admin users, add the event with limited access info
              if (req.user.role !== 'admin' && !eventIds.has(matchingTableInAll._id.toString())) {
                eventIds.add(matchingTableInAll._id.toString());
                console.log(`[Events by Gear] Adding limited access event for regular user: ${matchingTableInAll.title}`);
                
                eventsWithGear.push({
                  _id: matchingTableInAll._id,
                  title: matchingTableInAll.title,
                  startDate: historyEntry.checkOutDate || matchingTableInAll.gear?.checkOutDate || matchingTableInAll.general?.start,
                  endDate: historyEntry.checkInDate || matchingTableInAll.gear?.checkInDate || matchingTableInAll.general?.end,
                  location: matchingTableInAll.general?.location,
                  client: matchingTableInAll.general?.client,
                  company: matchingTableInAll.general?.company,
                  isOwner: false,
                  isShared: false,
                  isAdmin: false,
                  hasLimitedAccess: true,
                  associationType: 'history',
                  historyDetails: {
                    checkOutDate: historyEntry.checkOutDate,
                    checkInDate: historyEntry.checkInDate,
                    quantity: historyEntry.quantity,
                    reservedBy: historyEntry.user ? {
                      _id: historyEntry.user._id,
                      name: historyEntry.user.fullName,
                      email: historyEntry.user.email
                    } : null
                  }
                });
              }
            } else {
              console.log(`[Events by Gear] ❌ Event not found in database at all - may have been deleted`);
            }
          } else {
            console.log(`[Events by Gear] Table ${table.title} already added to results`);
          }
        } else {
          console.log(`[Events by Gear] History entry has no event field`);
        }
      }
    }

    // Method 4: Check if gear is currently checked out to an event
    if (gearItem.status === 'checked_out' && gearItem.checkedOutEvent) {
      console.log(`[Events by Gear] Checking current checkout with event ID: ${gearItem.checkedOutEvent}`);
      
      const checkedOutEventId = gearItem.checkedOutEvent.toString();
      const table = tables.find(t => t._id.toString() === checkedOutEventId);
      
      if (table && !eventIds.has(table._id.toString())) {
        eventIds.add(table._id.toString());
        console.log(`[Events by Gear] Found ${gearItem.label} currently checked out to event: ${table.title}`);
        
        eventsWithGear.push({
          _id: table._id,
          title: table.title,
          startDate: gearItem.checkOutDate || table.gear?.checkOutDate || table.general?.start,
          endDate: gearItem.checkInDate || table.gear?.checkInDate || table.general?.end,
          location: table.general?.location,
          client: table.general?.client,
          company: table.general?.company,
          isOwner: table.owners.includes(req.user.id),
          isShared: table.sharedWith.includes(req.user.id),
          isAdmin: req.user.role === 'admin',
          associationType: 'checked_out',
          checkoutDetails: {
            checkOutDate: gearItem.checkOutDate,
            checkInDate: gearItem.checkInDate,
            checkedOutBy: gearItem.checkedOutBy ? {
              _id: gearItem.checkedOutBy._id,
              name: gearItem.checkedOutBy.fullName,
              email: gearItem.checkedOutBy.email
            } : null
          }
        });
      } else if (!table) {
        console.log(`[Events by Gear] No accessible table found for checked out event ID: ${checkedOutEventId}`);
      }
    }

    // Sort events by start date (most recent first)
    eventsWithGear.sort((a, b) => {
      const dateA = new Date(a.startDate || '1970-01-01');
      const dateB = new Date(b.startDate || '1970-01-01');
      return dateB - dateA;
    });

    console.log(`[Events by Gear] Final result: Found ${eventsWithGear.length} events containing ${gearItem.label}`);
    eventsWithGear.forEach(event => {
      console.log(`[Events by Gear] - Event: "${event.title}" (${event.associationType}${event.hasLimitedAccess ? ' - Limited Access' : ''})`);
    });

    res.json(eventsWithGear);

  } catch (error) {
    console.error('[Events by Gear] Error:', error);
    res.status(500).json({ error: 'Failed to fetch events for gear item: ' + error.message });
  }
});

// Test endpoint to debug gear item associations
app.get('/api/debug/gear/:gearId', authenticate, async (req, res) => {
  try {
    const gearId = req.params.gearId;
    const gearItem = await GearInventory.findById(gearId);
    
    if (!gearItem) {
      return res.status(404).json({ error: 'Gear item not found' });
    }
    
    console.log(`[DEBUG] Gear item ${gearItem.label} debug info:`);
    console.log(`[DEBUG] - Reservations:`, gearItem.reservations);
    console.log(`[DEBUG] - History:`, gearItem.history);
    console.log(`[DEBUG] - Status:`, gearItem.status);
    console.log(`[DEBUG] - Checked out event:`, gearItem.checkedOutEvent);
    
    // Find all tables
    const allTables = await Table.find();
    console.log(`[DEBUG] - Total tables in database:`, allTables.length);
    
    // Find accessible tables
    const accessibleTables = await Table.find({
      $or: [
        { owners: req.user.id },
        { sharedWith: req.user.id }
      ]
    });
    console.log(`[DEBUG] - Accessible tables:`, accessibleTables.length);
    
    res.json({
      gearItem: {
        _id: gearItem._id,
        label: gearItem.label,
        reservations: gearItem.reservations,
        history: gearItem.history,
        status: gearItem.status,
        checkedOutEvent: gearItem.checkedOutEvent
      },
      totalTables: allTables.length,
      accessibleTables: accessibleTables.length,
      tableIds: accessibleTables.map(t => ({ id: t._id.toString(), title: t.title }))
    });
  } catch (error) {
    console.error('[DEBUG] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DOCUMENT MANAGEMENT ENDPOINTS

// Get all documents for an event
app.get('/api/tables/:id/documents', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table || !hasEventReadAccess(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized or not found' });
    }
    
    res.json(table.documents || []);
  } catch (err) {
    console.error('Error fetching documents:', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Get a specific document
app.get('/api/tables/:id/documents/:documentId', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table || !hasEventReadAccess(table, req.user)) {
      return res.status(403).json({ error: 'Not authorized or not found' });
    }
    
    const document = table.documents.id(req.params.documentId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    res.json(document);
  } catch (err) {
    console.error('Error fetching document:', err);
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

// Upload a new document
app.post('/api/tables/:id/documents', authenticate, upload.single('file'), async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table || !table.owners.includes(req.user.id)) {
      return res.status(403).json({ error: 'Not authorized or not found' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      // Clean the filename - remove extension for public_id since Cloudinary adds it automatically
      const cleanFilename = req.file.originalname.replace(/\.[^/.]+$/, ""); // Remove extension
      const sanitizedFilename = cleanFilename.replace(/[^a-zA-Z0-9.-]/g, '_');
      
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'image', // Use 'image' for all files including PDFs
          folder: `lumdash/events/${req.params.id}/documents`,
          public_id: `${Date.now()}_${sanitizedFilename}`, // Don't include extension here
          use_filename: false, // Don't use original filename to avoid conflicts
          unique_filename: true,
          // Ensure files are publicly accessible for viewing (not downloading)
          type: 'upload',
          access_mode: 'public',
          // For PDFs, add flags to prevent download and enable inline viewing
          ...(req.file.mimetype === 'application/pdf' && {
            flags: 'attachment:false'
          })
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary upload error:', error);
            reject(error);
          } else {
            // For PDFs, modify the URL to force inline viewing
            let finalUrl = result.secure_url;
            if (req.file.mimetype === 'application/pdf') {
              // For raw PDFs, we need to use a different approach
              // Replace the /raw/upload/ with /image/upload/ and add fl_attachment:false
              finalUrl = result.secure_url.replace('/raw/upload/', '/image/upload/fl_attachment:false/');
            }
            
            console.log('Cloudinary upload success:', {
              public_id: result.public_id,
              secure_url: result.secure_url,
              final_url: finalUrl,
              resource_type: result.resource_type,
              format: result.format
            });
            
            // Return the modified result
            resolve({
              ...result,
              secure_url: finalUrl
            });
          }
        }
      );
      uploadStream.end(req.file.buffer);
    });
    
    // Add document to table
    const newDocument = {
      originalName: req.file.originalname,
      cloudinaryPublicId: uploadResult.public_id,
      url: uploadResult.secure_url,
      fileType: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.user.id,
      uploadedAt: new Date()
    };
    
    table.documents.push(newDocument);
    await table.save();
    
    // Notify clients about the new document
    notifyDataChange('documentsChanged', null, req.params.id);
    
    res.json({
      message: 'Document uploaded successfully',
      document: table.documents[table.documents.length - 1]
    });
    
  } catch (err) {
    console.error('Error uploading document:', err);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// Delete a document
app.delete('/api/tables/:id/documents/:documentId', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table || !table.owners.includes(req.user.id)) {
      return res.status(403).json({ error: 'Not authorized or not found' });
    }
    
    const document = table.documents.id(req.params.documentId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    // Delete from Cloudinary
    try {
      // Determine resource type based on file type
      const resourceType = document.fileType === 'application/pdf' ? 'raw' : 'image';
      await cloudinary.uploader.destroy(document.cloudinaryPublicId, { resource_type: resourceType });
      console.log(`Deleted from Cloudinary: ${document.cloudinaryPublicId} (${resourceType})`);
    } catch (cloudinaryError) {
      console.error('Error deleting from Cloudinary:', cloudinaryError);
      // Continue with database deletion even if Cloudinary deletion fails
    }
    
    // Remove from database
    table.documents.pull(req.params.documentId);
    await table.save();
    
    // Notify clients about the document deletion
    notifyDataChange('documentsChanged', null, req.params.id);
    
    res.json({ message: 'Document deleted successfully' });
    
  } catch (err) {
    console.error('Error deleting document:', err);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// ===============================================
// CART API ROUTES (must be before catch-all route)
// ===============================================

// Get cart for user and event
app.get('/api/carts/:eventId', authenticate, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    let cart = await Cart.findOne({ userId, eventId })
      .populate('items.inventoryId', 'label category serial quantity status');

    if (!cart) {
      // Create empty cart if none exists
      const event = await Table.findById(eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      // Validate that event has proper gear dates set
      if (!event.gear?.checkOutDate || !event.gear?.checkInDate) {
        return res.status(400).json({ 
          error: 'Event must have checkout and checkin dates set before items can be added to cart. Please set dates in the gear section of this event.' 
        });
      }

      cart = new Cart({
        userId,
        eventId,
        checkOutDate: event.gear.checkOutDate,
        checkInDate: event.gear.checkInDate,
        items: []
      });
      await cart.save();
    }

    // Add availability information to each item
    const cartWithAvailability = cart.toObject();
    await assignCartItemAvailabilityBulk(cart, cartWithAvailability.items);

    res.json(cartWithAvailability);
  } catch (err) {
    console.error('Error fetching cart:', err);
    res.status(500).json({ error: 'Failed to fetch cart' });
  }
});

// Add item to cart
app.post('/api/carts/:eventId/items', authenticate, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;
    const { inventoryId, quantity = 1, specificSerial = null } = req.body;

    if (!inventoryId) {
      return res.status(400).json({ error: 'Inventory ID is required' });
    }

    const eventForAccess = await Table.findById(eventId);
    if (!eventForAccess) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if (!canManageEventGearLists(eventForAccess, req.user)) {
      return res.status(403).json({ error: 'Not authorized to edit gear for this event' });
    }

    // Get or create cart
    let cart = await Cart.findOne({ userId, eventId });
    if (!cart) {
      // Validate that event has proper gear dates set
      if (!eventForAccess.gear?.checkOutDate || !eventForAccess.gear?.checkInDate) {
        return res.status(400).json({ 
          error: 'Event must have checkout and checkin dates set before items can be added to cart. Please set dates in the gear section of this event.' 
        });
      }

      cart = new Cart({
        userId,
        eventId,
        checkOutDate: eventForAccess.gear.checkOutDate,
        checkInDate: eventForAccess.gear.checkInDate,
        items: []
      });
    }

    // Get inventory item
    const inventoryItem = await GearInventory.findById(inventoryId);
    if (!inventoryItem) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    // A real serial number identifies ONE physical unit and can never be
    // reserved more than once. Multiple units must use different serials.
    // ('N/A' means no serial, so it behaves like a normal grouped/bulk add.)
    if (specificSerial && specificSerial !== 'N/A') {
      const serialAvailable = await AtomicReservationService.getAvailableQuantity(
        inventoryItem._id, cart.checkOutDate, cart.checkInDate
      );
      const alreadyInCart = cart.items
        .filter(ci => ci.inventoryId.toString() === inventoryId &&
                      ci.specificSerialRequested && ci.serial === specificSerial)
        .reduce((sum, ci) => sum + ci.quantity, 0);

      if (quantity > 1 || alreadyInCart + quantity > Math.min(serialAvailable, 1)) {
        return res.status(400).json({
          error: `Serial ${specificSerial} is a single unit — it can't be reserved more than once. Choose a different serial for additional units.`,
          availableQuantity: Math.max(0, Math.min(serialAvailable, 1) - alreadyInCart)
        });
      }

      cart.addItem(inventoryItem, 1, specificSerial);
      await cart.save();
      await cart.populate('items.inventoryId', 'label category serial quantity status');
      const cartObj = cart.toObject();
      await assignCartItemAvailabilityBulk(cart, cartObj.items);
      return res.json(cartObj);
    }

    // Check availability across all similar items (same brand/model)
    const [brand, model] = inventoryItem.label.split(' ', 2);
    
    // Find all inventory items with same brand/model
    const similarItems = await GearInventory.find({
      label: { $regex: `^${brand} ${model}`, $options: 'i' }
    });
    
    // Calculate total available quantity in bulk (2 queries instead of 3 per item)
    const addAvailabilityMap = await AtomicReservationService.getAvailableQuantitiesBulk(
      similarItems, cart.checkOutDate, cart.checkInDate
    );
    let totalAvailableQty = 0;
    for (const item of similarItems) {
      totalAvailableQty += addAvailabilityMap.get(item._id.toString()) ?? 0;
    }
    
    // Check how many of this brand/model are already in the cart
    const existingCartQuantity = cart.items
      .filter(cartItem => {
        const cartItemInventory = similarItems.find(si => si._id.toString() === cartItem.inventoryId.toString());
        return cartItemInventory && !cartItem.specificSerial;
      })
      .reduce((sum, cartItem) => sum + cartItem.quantity, 0);
    
    // Total requested = existing in cart + new quantity
    const totalRequestedQuantity = existingCartQuantity + quantity;
    
    console.log(`[AVAILABILITY CHECK] ${brand} ${model}: Total=${totalAvailableQty}, InCart=${existingCartQuantity}, Requesting=${quantity}, TotalRequested=${totalRequestedQuantity}`);
    
    if (totalRequestedQuantity > totalAvailableQty) {
      return res.status(400).json({ 
        error: `Only ${totalAvailableQty} units available for selected dates (you have ${existingCartQuantity} in cart)`,
        availableQuantity: Math.max(0, totalAvailableQty - existingCartQuantity)
      });
    }

    // Add item to cart
    cart.addItem(inventoryItem, quantity, specificSerial);
    await cart.save();

    // Populate and return updated cart with availability info
    await cart.populate('items.inventoryId', 'label category serial quantity status');
    
    // Add availability information to each item
    const cartWithAvailability = cart.toObject();
    await assignCartItemAvailabilityBulk(cart, cartWithAvailability.items);

    res.json(cartWithAvailability);
  } catch (err) {
    console.error('Error adding item to cart:', err);
    res.status(500).json({ error: 'Failed to add item to cart' });
  }
});

// Batch add items to cart (optimized for package loading)
app.post('/api/carts/:eventId/items/batch', authenticate, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;
    const { items } = req.body; // Array of { inventoryId, quantity, specificSerial }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    const eventForAccess = await Table.findById(eventId);
    if (!eventForAccess) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if (!canManageEventGearLists(eventForAccess, req.user)) {
      return res.status(403).json({ error: 'Not authorized to edit gear for this event' });
    }

    // 1. Get or create cart (ONE query)
    let cart = await Cart.findOne({ userId, eventId });
    if (!cart) {
      const event = eventForAccess;
      if (!event.gear?.checkOutDate || !event.gear?.checkInDate) {
        return res.status(400).json({ 
          error: 'Event must have checkout and checkin dates set before items can be added to cart.' 
        });
      }
      cart = new Cart({
        userId,
        eventId,
        checkOutDate: event.gear.checkOutDate,
        checkInDate: event.gear.checkInDate,
        items: []
      });
    }

    // 2. Collect all unique inventory IDs from request
    const requestedInventoryIds = [...new Set(items.map(i => i.inventoryId))];

    // 3. Fetch ALL needed inventory items in ONE query
    const allInventoryItems = await GearInventory.find({
      _id: { $in: requestedInventoryIds }
    });
    const inventoryMap = new Map(allInventoryItems.map(item => [item._id.toString(), item]));

    // 4. Build a set of all brand/model combos to look up similar items
    const brandModelPairs = new Set();
    for (const invItem of allInventoryItems) {
      const parts = invItem.label.split(' ');
      const brand = parts[0] || '';
      const model = parts.slice(1).join(' ') || '';
      brandModelPairs.add(`${brand}|||${model}`);
    }

    // 5. Find ALL similar inventory items (same brand/model) in ONE query using $or
    const orConditions = [];
    for (const pair of brandModelPairs) {
      const [brand, model] = pair.split('|||');
      orConditions.push({ label: { $regex: `^${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' } });
    }
    const allSimilarItems = orConditions.length > 0 
      ? await GearInventory.find({ $or: orConditions })
      : [];
    
    // Group similar items by brand/model key
    const similarItemsByKey = new Map();
    for (const item of allSimilarItems) {
      const parts = item.label.split(' ');
      const key = `${parts[0] || ''}|||${parts.slice(1).join(' ') || ''}`;
      if (!similarItemsByKey.has(key)) similarItemsByKey.set(key, []);
      similarItemsByKey.get(key).push(item);
    }

    // 6. Get ALL overlapping reservations and manual reservations in TWO queries
    const allSimilarIds = allSimilarItems.map(item => item._id);
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    const checkOutDate = cart.checkOutDate;
    const checkInDate = cart.checkInDate;

    const [overlappingReservations, manualReservations] = await Promise.all([
      ReservedGearItem.find({
        inventoryId: { $in: allSimilarIds },
        $and: [
          { checkOutDate: { $lte: checkInDate } },
          { checkInDate: { $gte: checkOutDate } },
          { checkInDate: { $gte: now } }
        ]
      }),
      ManualReservation.find({
        inventoryId: { $in: allSimilarIds },
        $and: [
          { startDate: { $lte: checkInDate } },
          { endDate: { $gte: checkOutDate } },
          { endDate: { $gte: now } }
        ]
      })
    ]);

    // 7. Build availability map: inventoryId -> reservedQuantity
    const reservedByInventoryId = new Map();
    for (const res of overlappingReservations) {
      const id = res.inventoryId.toString();
      reservedByInventoryId.set(id, (reservedByInventoryId.get(id) || 0) + res.quantity);
    }
    for (const res of manualReservations) {
      const id = res.inventoryId.toString();
      reservedByInventoryId.set(id, (reservedByInventoryId.get(id) || 0) + res.quantity);
    }

    // Helper: get available quantity from pre-fetched data
    function getAvailableQty(inventoryItem) {
      const reserved = reservedByInventoryId.get(inventoryItem._id.toString()) || 0;
      return Math.max(0, inventoryItem.quantity - reserved);
    }

    // Helper: get total available for a brand/model
    function getTotalAvailableForBrandModel(invItem) {
      const parts = invItem.label.split(' ');
      const key = `${parts[0] || ''}|||${parts.slice(1).join(' ') || ''}`;
      const similarItems = similarItemsByKey.get(key) || [invItem];
      return similarItems.reduce((sum, item) => sum + getAvailableQty(item), 0);
    }

    // 8. Process each item — check availability and add to cart
    const results = [];
    // Track quantities being added in this batch to prevent over-allocation
    const batchAddedByBrandModel = new Map();
    // Track quantities being added per specific serial in this batch (key: inventoryId|||serial)
    const batchAddedBySerial = new Map();

    for (const reqItem of items) {
      const { inventoryId, quantity = 1, specificSerial = null } = reqItem;
      const inventoryItem = inventoryMap.get(inventoryId);

      if (!inventoryItem) {
        results.push({ inventoryId, success: false, error: 'Inventory item not found' });
        continue;
      }

      const parts = inventoryItem.label.split(' ');
      const bmKey = `${parts[0] || ''}|||${parts.slice(1).join(' ') || ''}`;

      if (specificSerial) {
        // For specific serial: check individual item availability.
        // A real serial number identifies ONE physical unit, so it can never be
        // reserved more than once. (Multiple units must use different serials.)
        // 'N/A' means the item simply has no serial, so it behaves like a bulk unit.
        const isRealSerial = specificSerial !== 'N/A';
        const itemAvailable = getAvailableQty(inventoryItem);
        const maxForSerial = isRealSerial ? Math.min(itemAvailable, 1) : itemAvailable;

        // Use the ACTUAL cart item fields (serial + specificSerialRequested)
        const existingSerialInCart = cart.items
          .filter(ci => ci.inventoryId.toString() === inventoryId &&
                        ci.specificSerialRequested && ci.serial === specificSerial)
          .reduce((sum, ci) => sum + ci.quantity, 0);

        const serialKey = `${inventoryId}|||${specificSerial}`;
        const batchSerialAdded = batchAddedBySerial.get(serialKey) || 0;

        if (existingSerialInCart + batchSerialAdded + quantity > maxForSerial) {
          results.push({
            inventoryId,
            success: false,
            error: isRealSerial
              ? `Serial ${specificSerial} is already reserved/in your cart`
              : 'Serial not available'
          });
          continue;
        }
      } else {
        // For no-preference: check brand/model total availability
        const totalAvailable = getTotalAvailableForBrandModel(inventoryItem);

        // How many of this brand/model already in cart (before this batch)
        const similarItems = similarItemsByKey.get(bmKey) || [inventoryItem];
        const similarIds = new Set(similarItems.map(si => si._id.toString()));
        const existingCartQty = cart.items
          .filter(ci => similarIds.has(ci.inventoryId.toString()) && !ci.specificSerial)
          .reduce((sum, ci) => sum + ci.quantity, 0);

        // How many already added in this batch for the same brand/model
        const batchAdded = batchAddedByBrandModel.get(bmKey) || 0;
        const totalRequested = existingCartQty + batchAdded + quantity;

        if (totalRequested > totalAvailable) {
          const remaining = Math.max(0, totalAvailable - existingCartQty - batchAdded);
          results.push({ 
            inventoryId, 
            success: false, 
            error: `Only ${remaining} more units available`,
            availableQuantity: remaining
          });
          continue;
        }
      }

      // Add to cart
      cart.addItem(inventoryItem, quantity, specificSerial);
      if (!specificSerial) {
        const batchAdded = batchAddedByBrandModel.get(bmKey) || 0;
        batchAddedByBrandModel.set(bmKey, batchAdded + quantity);
      } else {
        const serialKey = `${inventoryId}|||${specificSerial}`;
        batchAddedBySerial.set(serialKey, (batchAddedBySerial.get(serialKey) || 0) + quantity);
      }
      results.push({ inventoryId, success: true, quantity });
    }

    // 9. Save cart ONCE
    await cart.save();

    // 10. Return results (skip expensive per-item availability recalculation)
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    res.json({
      message: `Added ${successCount} item(s) to cart${failCount > 0 ? `, ${failCount} failed` : ''}`,
      results,
      successCount,
      failCount,
      totalCartItems: cart.items.length
    });

  } catch (err) {
    console.error('Error batch adding items to cart:', err);
    res.status(500).json({ error: 'Failed to batch add items to cart' });
  }
});

// Update item quantity in cart
app.put('/api/carts/:eventId/items/:itemId', authenticate, async (req, res) => {
  try {
    const { eventId, itemId } = req.params;
    const userId = req.user.id;
    const { quantity } = req.body;

    if (!quantity || quantity < 0) {
      return res.status(400).json({ error: 'Valid quantity is required' });
    }

    const cart = await Cart.findOne({ userId, eventId });
    if (!cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    // Find the item to check availability before updating
    const cartItem = cart.items.find(item => item._id.toString() === itemId);
    if (!cartItem) {
      return res.status(404).json({ error: 'Item not found in cart' });
    }

    // Check if the new quantity exceeds availability
    const inventoryItem = await GearInventory.findById(cartItem.inventoryId);
    if (!inventoryItem) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    // Check availability across all similar items (same brand/model)
    const [brand, model] = inventoryItem.label.split(' ', 2);
    
    // Find all inventory items with same brand/model
    const similarItems = await GearInventory.find({
      label: { $regex: `^${brand} ${model}`, $options: 'i' }
    });
    
    // Calculate total available quantity using BULLETPROOF atomic service
    let totalAvailableQty = 0;
    for (const item of similarItems) {
      totalAvailableQty += await AtomicReservationService.getAvailableQuantity(
        item._id, cart.checkOutDate, cart.checkInDate
      );
    }
    
    // Check how many of this brand/model are already in the cart (excluding this item)
    const existingCartQuantity = cart.items
      .filter(ci => {
        const ciInventory = similarItems.find(si => si._id.toString() === ci.inventoryId.toString());
        return ciInventory && !ci.specificSerial && ci._id.toString() !== itemId;
      })
      .reduce((sum, ci) => sum + ci.quantity, 0);
    
    // Total requested = other cart items + new quantity for this item
    const totalRequestedQuantity = existingCartQuantity + quantity;
    
    console.log(`[UPDATE QUANTITY CHECK] ${brand} ${model}: Total=${totalAvailableQty}, OtherInCart=${existingCartQuantity}, RequestingForThisItem=${quantity}, TotalRequested=${totalRequestedQuantity}`);
    
    if (totalRequestedQuantity > totalAvailableQty) {
      return res.status(400).json({ 
        error: `Only ${totalAvailableQty} units available for selected dates (other items in cart: ${existingCartQuantity})`,
        availableQuantity: Math.max(0, totalAvailableQty - existingCartQuantity)
      });
    }

    // Update item quantity
    cart.updateItemQuantity(itemId, quantity);
    await cart.save();

    // Populate and return updated cart with availability info
    await cart.populate('items.inventoryId', 'label category serial quantity status');
    
    // Add availability information to each item
    const cartWithAvailability = cart.toObject();
    await assignCartItemAvailabilityBulk(cart, cartWithAvailability.items);

    res.json(cartWithAvailability);
  } catch (err) {
    console.error('Error updating cart item:', err);
    res.status(500).json({ error: 'Failed to update cart item' });
  }
});

// Remove item from cart
app.delete('/api/carts/:eventId/items/:itemId', authenticate, async (req, res) => {
  try {
    const { eventId, itemId } = req.params;
    const userId = req.user.id;

    const cart = await Cart.findOne({ userId, eventId });
    if (!cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    // Remove item from cart
    cart.removeItem(itemId);
    await cart.save();

    // Populate and return updated cart with availability info
    await cart.populate('items.inventoryId', 'label category serial quantity status');
    
    // Add availability information to each item
    const cartWithAvailability = cart.toObject();
    await assignCartItemAvailabilityBulk(cart, cartWithAvailability.items);

    res.json(cartWithAvailability);
  } catch (err) {
    console.error('Error removing item from cart:', err);
    res.status(500).json({ error: 'Failed to remove item from cart' });
  }
});

// Clear entire cart
app.delete('/api/carts/:eventId', authenticate, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    const cart = await Cart.findOne({ userId, eventId });
    if (!cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    cart.clearCart();
    await cart.save();

    res.json({ message: 'Cart cleared successfully', cart });
  } catch (err) {
    console.error('Error clearing cart:', err);
    res.status(500).json({ error: 'Failed to clear cart' });
  }
});

// Reserve all items in cart
app.post('/api/carts/:eventId/reserve', authenticate, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    const cart = await Cart.findOne({ userId, eventId })
      .populate('items.inventoryId');

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const reservationResults = [];
    const errors = [];

    // Get current list from event (needed for all reservations)
    const eventTable = await Table.findById(eventId);
    if (!eventTable || !canManageEventGearLists(eventTable, req.user)) {
      return res.status(403).json({ error: 'Not authorized to edit gear for this event' });
    }
    const currentListName = eventTable?.gear?.currentList || 'Main List';

    // BULLETPROOF ATOMIC BULK RESERVATION
    // Prepare all reservations for atomic bulk processing
    const reservationRequests = [];
    
    for (const cartItem of cart.items) {
      if (cartItem.specificSerialRequested && cartItem.serial) {
        // Handle specific serial request
        reservationRequests.push({
          inventoryId: cartItem.inventoryId._id,
          eventId,
          userId,
          quantity: cartItem.quantity,
          checkOutDate: cart.checkOutDate,
          checkInDate: cart.checkInDate,
          listName: currentListName,
          serial: cartItem.serial,
          specificSerialRequested: true
        });
      } else {
        // Handle grouped items (same brand/model) - need to split into individual units
        const baseItem = cartItem.inventoryId;
        const labelParts = baseItem.label.split(' ');
        const brand = labelParts[0];
        const model = labelParts.slice(1).join(' ');
        
        // Find all similar items (same brand/model/category)
        const similarItems = await GearInventory.find({
          category: baseItem.category,
          label: { $regex: `^${brand}\\s+${model}`, $options: 'i' }
        }).sort({ serial: 1 }); // Sort by serial for consistent allocation
        
        let remainingToReserve = cartItem.quantity;
        
        // Prepare reservations for similar items in order
        for (const item of similarItems) {
          if (remainingToReserve <= 0) break;
          
          // Check availability using NEW atomic service
          const availableQty = await AtomicReservationService.getAvailableQuantity(
            item._id, cart.checkOutDate, cart.checkInDate  // Don't exclude current event
          );
          
          if (availableQty > 0) {
            const quantityToReserve = Math.min(remainingToReserve, availableQty);
            
            reservationRequests.push({
              inventoryId: item._id,
              eventId,
              userId,
              quantity: quantityToReserve,
              checkOutDate: cart.checkOutDate,
              checkInDate: cart.checkInDate,
              listName: currentListName,
              serial: item.serial,
              specificSerialRequested: false
            });
            
            remainingToReserve -= quantityToReserve;
          }
        }
        
        // Track if we couldn't reserve all requested units
        if (remainingToReserve > 0) {
          errors.push({
            item: `${brand} ${model}`,
            requested: cartItem.quantity,
            available: cartItem.quantity - remainingToReserve,
            message: `${brand} ${model}: Only ${cartItem.quantity - remainingToReserve} units available (requested ${cartItem.quantity})`
          });
        }
      }
    }
    
    // Execute ALL reservations atomically (all succeed or all fail)
    try {
      console.log(`[CART RESERVE] Processing ${reservationRequests.length} reservations atomically`);
      
      const createdReservations = await AtomicReservationService.createBulkReservations(reservationRequests);
      
      // Convert to response format
      for (const reservation of createdReservations) {
        reservationResults.push({
          item: `${reservation.brand} ${reservation.model}`,
          quantity: reservation.quantity,
          serial: reservation.serial,
          status: 'reserved'
        });
      }
      
      console.log(`[CART RESERVE] ✅ Successfully reserved ${createdReservations.length} items atomically`);
      
    } catch (bulkError) {
      console.error(`[CART RESERVE] ❌ Bulk reservation failed:`, bulkError.message);
      errors.push({
        item: 'Bulk Reservation',
        message: `Reservation failed: ${bulkError.message}`
      });
    }

    // Clear cart after successful reservations
    if (reservationResults.length > 0) {
      cart.clearCart();
      await cart.save();
    }

    res.json({
      message: 'Reservation process completed',
      reserved: reservationResults,
      errors: errors,
      success: reservationResults.length,
      failed: errors.length
    });

  } catch (err) {
    console.error('Error reserving cart items:', err);
    res.status(500).json({ error: 'Failed to reserve items' });
  }
});

// Get available serials for an inventory item
app.get('/api/inventory/:id/available-serials', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { eventId, checkOutDate, checkInDate } = req.query;

    if (!eventId || !checkOutDate || !checkInDate) {
      return res.status(400).json({ error: 'Event ID and dates are required' });
    }

    // Find all items with same brand/model
    const baseItem = await GearInventory.findById(id);
    if (!baseItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Extract brand and model from label (assumes format "Brand Model Details")
    const labelParts = baseItem.label.split(' ');
    const brand = labelParts[0];
    const model = labelParts[1] || '';

    // Find all items with same brand and model
    const similarItems = await GearInventory.find({
      $and: [
        { label: { $regex: `^${brand}\\s+${model}`, $options: 'i' } },
        { category: baseItem.category }
      ]
    });

    const availableSerials = [];
    for (const item of similarItems) {
      const availableQty = await AtomicReservationService.getAvailableQuantity(
        item._id, checkOutDate, checkInDate  // Don't exclude current event
      );
      if (availableQty > 0) {
        availableSerials.push({
          id: item._id,
          serial: item.serial,
          label: item.label,
          availableQty: availableQty
        });
      }
    }

    res.json({
      brand,
      model,
      availableSerials
    });

  } catch (err) {
    console.error('Error fetching available serials:', err);
    res.status(500).json({ error: 'Failed to fetch available serials' });
  }
});

// Update grouped item quantity with sequential reservation
app.put('/api/carts/:eventId/grouped-quantity', authenticate, async (req, res) => {
  try {
    const { eventId } = req.params;
    const { brand, model, newQuantity } = req.body;
    const userId = req.user.id;

    if (!brand || !model || newQuantity < 0) {
      return res.status(400).json({ error: 'Brand, model, and valid quantity are required' });
    }

    console.log(`[GROUPED QUANTITY] Updating ${brand} ${model} to quantity ${newQuantity} for user ${userId}, event ${eventId}`);

    // Get current cart
    const cart = await Cart.findOne({ userId, eventId });
    if (!cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    // Find all current cart items for this brand/model (non-specific)
    const currentItems = cart.items.filter(item => 
      !item.specificSerialRequested && 
      !item.serial &&
      item.brand === brand && 
      item.model === model
    );

    const currentQuantity = currentItems.reduce((sum, item) => sum + item.quantity, 0);
    console.log(`[GROUPED QUANTITY] Current quantity: ${currentQuantity}, requested: ${newQuantity}`);

    if (newQuantity === currentQuantity) {
      return res.json({ message: 'Quantity unchanged', cart });
    }

    if (newQuantity > currentQuantity) {
      // Increasing quantity - add more items sequentially
      const quantityToAdd = newQuantity - currentQuantity;
      console.log(`[GROUPED QUANTITY] Adding ${quantityToAdd} more items`);

      // Find available inventory items with same brand/model
      const inventoryItems = await GearInventory.find({
        label: { $regex: `^${brand}\\s+${model}`, $options: 'i' }
      }).sort({ serial: 1 }); // Sort by serial for sequential allocation

      // Check total available quantity using BULLETPROOF atomic service
      let totalAvailableQty = 0;
      for (const item of inventoryItems) {
        totalAvailableQty += await AtomicReservationService.getAvailableQuantity(
          item._id, cart.checkOutDate, cart.checkInDate
        );
      }
      
      if (newQuantity > totalAvailableQty) {
        return res.status(400).json({ 
          error: `Only ${totalAvailableQty} units available for selected dates (requested ${newQuantity})` 
        });
      }

      let remainingToAdd = quantityToAdd;
      const addedItems = [];

      for (const inventoryItem of inventoryItems) {
        if (remainingToAdd <= 0) break;

        // Check availability using BULLETPROOF atomic service
        const availableQty = await AtomicReservationService.getAvailableQuantity(
          inventoryItem._id, cart.checkOutDate, cart.checkInDate
        );
        console.log(`[GROUPED QUANTITY] Item ${inventoryItem.serial}: ${availableQty} available`);

        if (availableQty > 0) {
          const quantityToTake = Math.min(remainingToAdd, availableQty);
          
          // Add to cart
          const cartItem = {
            inventoryId: inventoryItem._id,
            brand: brand,
            model: model,
            quantity: quantityToTake,
            specificSerialRequested: false
          };

          cart.items.push(cartItem);
          addedItems.push(`${inventoryItem.serial} (${quantityToTake})`);
          remainingToAdd -= quantityToTake;

          console.log(`[GROUPED QUANTITY] Added ${quantityToTake} units of ${inventoryItem.serial}`);
        }
      }

      if (remainingToAdd > 0) {
        return res.status(400).json({ 
          error: `Only ${quantityToAdd - remainingToAdd} additional units available (requested ${quantityToAdd})` 
        });
      }

      await cart.save();
      
      // Populate and return updated cart with availability info
      await cart.populate('items.inventoryId', 'label category serial quantity status');
      
      // Add availability information to each item
      const cartWithAvailability = cart.toObject();
      await assignCartItemAvailabilityBulk(cart, cartWithAvailability.items);
      
      const message = `Added ${quantityToAdd} units: ${addedItems.join(', ')}`;
      console.log(`[GROUPED QUANTITY] Success: ${message}`);
      
      res.json({ message, cart: cartWithAvailability });

    } else {
      // Decreasing quantity - remove items (most recent first)
      const quantityToRemove = currentQuantity - newQuantity;
      console.log(`[GROUPED QUANTITY] Removing ${quantityToRemove} items`);

      // Sort current items by when they were added (most recent first)
      currentItems.sort((a, b) => {
        const aIndex = cart.items.findIndex(item => item === a);
        const bIndex = cart.items.findIndex(item => item === b);
        return bIndex - aIndex; // Reverse order (most recent first)
      });

      let remainingToRemove = quantityToRemove;
      const removedItems = [];

      for (const item of currentItems) {
        if (remainingToRemove <= 0) break;

        const itemQuantity = item.quantity;
        if (itemQuantity <= remainingToRemove) {
          // Remove entire item
          const itemIndex = cart.items.findIndex(cartItem => cartItem === item);
          cart.items.splice(itemIndex, 1);
          remainingToRemove -= itemQuantity;
          removedItems.push(`${itemQuantity} units`);
          console.log(`[GROUPED QUANTITY] Removed entire item (${itemQuantity} units)`);
        } else {
          // Reduce item quantity
          item.quantity -= remainingToRemove;
          removedItems.push(`${remainingToRemove} units`);
          console.log(`[GROUPED QUANTITY] Reduced item quantity by ${remainingToRemove}`);
          remainingToRemove = 0;
        }
      }

      await cart.save();
      
      // Populate and return updated cart with availability info
      await cart.populate('items.inventoryId', 'label category serial quantity status');
      
      // Add availability information to each item
      const cartWithAvailability = cart.toObject();
      await assignCartItemAvailabilityBulk(cart, cartWithAvailability.items);
      
      const message = `Removed ${quantityToRemove} units: ${removedItems.join(', ')}`;
      console.log(`[GROUPED QUANTITY] Success: ${message}`);
      
      res.json({ message, cart: cartWithAvailability });
    }

  } catch (error) {
    console.error('[GROUPED QUANTITY] Error:', error);
    res.status(500).json({ error: 'Failed to update grouped quantity' });
  }
});

// ========= MANUAL RESERVATIONS API =========

// Helper function to format reservation email
function formatReservationEmail(reservations, personName) {
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  const studioAddress = "Lumetry Media<br>7940 Silverton Ave Ste 101B<br>San Diego, CA 92126";
  const contactInfo = "Phone: <a href='tel:+18583291444' style='color: #CC0007; text-decoration: none;'>858.329.1444</a><br>Email: <a href='mailto:info@lumetrymedia.com' style='color: #CC0007; text-decoration: none;'>info@lumetrymedia.com</a>";

  // Group reservations by date range
  const groupedReservations = {};
  reservations.forEach(reservation => {
    const key = `${reservation.startDate}_${reservation.endDate}`;
    if (!groupedReservations[key]) {
      groupedReservations[key] = {
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        items: []
      };
    }
    groupedReservations[key].items.push(reservation);
  });

  const dateRanges = Object.values(groupedReservations);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Gear Reservation Confirmation</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #CC0007; }
        .logo { color: #CC0007; font-size: 24px; font-weight: bold; margin-bottom: 10px; }
        .title { color: #333; font-size: 20px; margin: 0; }
        .section { margin: 25px 0; }
        .section-title { color: #CC0007; font-size: 18px; font-weight: bold; margin-bottom: 15px; }
        .item-list { background: #f8f9fa; padding: 20px; border-radius: 6px; margin: 10px 0; }
        .item { margin: 8px 0; padding: 8px 0; border-bottom: 1px solid #e9ecef; }
        .item:last-child { border-bottom: none; }
        .item-name { font-weight: bold; color: #333; }
        .item-details { color: #666; font-size: 14px; }
        .date-range { background: #e3f2fd; padding: 15px; border-radius: 6px; margin: 15px 0; }
        .date-range-title { font-weight: bold; color: #1976d2; margin-bottom: 8px; }
        .info-box { background: #f5f5f5; padding: 20px; border-radius: 6px; margin: 20px 0; }
        .info-title { font-weight: bold; color: #333; margin-bottom: 10px; }
        .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef; color: #666; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">Lumetry Media</div>
          <h1 class="title">Gear Reservation Confirmation</h1>
        </div>

        <p>Dear ${personName},</p>
        <p>Thank you for your gear reservation! Below are the details of your reserved items:</p>

        ${dateRanges.map(dateRange => `
          <div class="date-range">
            <div class="date-range-title">Reservation Period</div>
            <strong>Pickup:</strong> ${formatDate(dateRange.startDate)}<br>
            <strong>Return:</strong> ${formatDate(dateRange.endDate)}
          </div>

          <div class="section">
            <div class="section-title">Reserved Items</div>
            <div class="item-list">
              ${dateRange.items.map(item => `
                <div class="item">
                  <div class="item-name">${item.brand} ${item.model}</div>
                  <div class="item-details">
                    Category: ${item.category} | Quantity: ${item.quantity}
                    ${item.serial ? ` | Serial: ${item.serial}` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}

        <div class="info-box">
          <div class="info-title">📍 Studio Address</div>
          ${studioAddress}
        </div>

        <div class="info-box">
          <div class="info-title">📞 Contact Information</div>
          ${contactInfo}
        </div>

                 <div class="info-box">
           <div class="info-title">🕐 Business Hours</div>
           <strong>Monday - Friday: 8:00 AM - 5:00 PM</strong><br>
           <em>Closed weekends and holidays</em>
         </div>

         <div class="section">
           <p><strong>Important:</strong></p>
           <ul>
             <li>Please arrive during business hours (8 AM - 5 PM, Mon-Fri) for pickup and return</li>
             <li>All items must be returned in the same condition as received</li>
             <li>Contact us if you have any questions about your reservation</li>
             <li>Late returns may incur additional fees</li>
           </ul>
         </div>

        <div class="footer">
          <p>This is an automated email from Lumetry Media's LumDash system.</p>
          <p>If you have any questions, please contact us at info@lumetrymedia.com</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Get all manual reservations (admin only)
app.get('/api/manual-reservations', authenticate, async (req, res) => {
  try {
    if (!canManageGearInventory(req.user)) {
      return res.status(403).json({ error: 'Access denied. Inventory manager privileges required.' });
    }

    const reservations = await ManualReservation.find({})
      .populate('inventoryId', 'label category serial quantity')
      .populate('createdBy', 'fullName email')
      .sort({ createdAt: -1 });

    res.json(reservations);
  } catch (error) {
    console.error('Error fetching manual reservations:', error);
    res.status(500).json({ error: 'Failed to fetch manual reservations' });
  }
});

// Create multiple manual reservations in bulk (admin only)
app.post('/api/manual-reservations/bulk', authenticate, async (req, res) => {
  try {
    if (!canManageGearInventory(req.user)) {
      return res.status(403).json({ error: 'Access denied. Inventory manager privileges required.' });
    }

    const { personName, personEmail, startDate, endDate, items, notes } = req.body;

    // Validate required fields
    if (!personName || !personEmail || !startDate || !endDate || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Missing required fields: personName, personEmail, startDate, endDate, items (array)' });
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (start >= end) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }

    const createdReservations = [];
    const errors = [];

    // Process each item
    for (const item of items) {
      try {
        const { inventoryId, quantity, serial, specificSerialRequested } = item;

        if (!inventoryId || !quantity) {
          errors.push(`Missing inventoryId or quantity for item: ${JSON.stringify(item)}`);
          continue;
        }

        // Get inventory item
        const inventoryItem = await GearInventory.findById(inventoryId);
        if (!inventoryItem) {
          errors.push(`Inventory item not found: ${inventoryId}`);
          continue;
        }

        // Check availability using BULLETPROOF atomic service
        const availableQty = await AtomicReservationService.getAvailableQuantity(
          inventoryId, startDate, endDate
        );
        if (quantity > availableQty) {
          errors.push(`Only ${availableQty} units available for ${inventoryItem.label} (requested ${quantity})`);
          continue;
        }

        // Extract brand and model from label
        const labelParts = inventoryItem.label.split(' ');
        const brand = labelParts[0] || 'Unknown';
        const model = labelParts.slice(1).join(' ') || 'Unknown';

        // Create manual reservation
        const reservation = new ManualReservation({
          personName: personName.trim(),
          personEmail: personEmail.trim().toLowerCase(),
          startDate: startDate,
          endDate: endDate,
          inventoryId: inventoryId,
          brand: brand,
          model: model,
          category: inventoryItem.category,
          quantity: quantity,
          serial: serial || null,
          specificSerialRequested: specificSerialRequested || false,
          createdBy: req.user.id,
          notes: notes || ''
        });

        await reservation.save();
        await reservation.populate('inventoryId', 'label category serial quantity');
        await reservation.populate('createdBy', 'fullName email');
        
        createdReservations.push(reservation);
      } catch (error) {
        console.error('Error creating individual reservation:', error);
        errors.push(`Failed to create reservation for item ${item.inventoryId}: ${error.message}`);
      }
    }

    // If no reservations were created successfully, return error
    if (createdReservations.length === 0) {
      return res.status(400).json({ 
        error: 'Failed to create any reservations', 
        details: errors 
      });
    }

    // Send ONE confirmation email for all created reservations
    try {
      const emailHtml = formatReservationEmail(createdReservations, personName);

      const msg = {
        to: personEmail.trim().toLowerCase(),
        from: SENDGRID_FROM,
        subject: 'Gear Reservation Confirmation - Lumetry Media',
        html: emailHtml
      };

      await sgMail.send(msg);
      console.log(`Bulk reservation confirmation email sent to ${personEmail} for ${createdReservations.length} items`);
    } catch (emailError) {
      console.error('Failed to send bulk reservation confirmation email:', emailError);
      // Don't fail the request if email fails - reservations were created successfully
    }

    res.status(201).json({
      message: `Successfully created ${createdReservations.length} manual reservations${errors.length > 0 ? ` (${errors.length} failed)` : ''}`,
      reservations: createdReservations,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Error creating bulk manual reservations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new manual reservation (admin only)
app.post('/api/manual-reservations', authenticate, async (req, res) => {
  try {
    if (!canManageGearInventory(req.user)) {
      return res.status(403).json({ error: 'Access denied. Inventory manager privileges required.' });
    }

    const { personName, personEmail, startDate, endDate, inventoryId, quantity, serial, specificSerialRequested, notes } = req.body;

    // Validate required fields
    if (!personName || !personEmail || !startDate || !endDate || !inventoryId || !quantity) {
      return res.status(400).json({ error: 'Missing required fields: personName, personEmail, startDate, endDate, inventoryId, quantity' });
    }

    // Validate dates - use the original date strings, let the model handle normalization
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (start >= end) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }

    // Get inventory item
    const inventoryItem = await GearInventory.findById(inventoryId);
    if (!inventoryItem) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    // Check availability using BULLETPROOF atomic service
    const availableQty = await AtomicReservationService.getAvailableQuantity(
      inventoryId, startDate, endDate
    );
    if (quantity > availableQty) {
      return res.status(400).json({ 
        error: `Only ${availableQty} units available for the requested dates (requested ${quantity})` 
      });
    }

    // Extract brand and model from label
    const labelParts = inventoryItem.label.split(' ');
    const brand = labelParts[0] || 'Unknown';
    const model = labelParts.slice(1).join(' ') || 'Unknown';

    // Create manual reservation - pass original date strings to let model handle normalization
    const reservation = new ManualReservation({
      personName: personName.trim(),
      personEmail: personEmail.trim().toLowerCase(),
      startDate: startDate,  // Pass original string, let model normalize
      endDate: endDate,      // Pass original string, let model normalize
      inventoryId: inventoryId,
      brand: brand,
      model: model,
      category: inventoryItem.category,
      quantity: quantity,
      serial: serial || null,
      specificSerialRequested: specificSerialRequested || false,
      createdBy: req.user.id,
      notes: notes || ''
    });

    await reservation.save();

    // Populate the response
    await reservation.populate('inventoryId', 'label category serial quantity');
    await reservation.populate('createdBy', 'fullName email');

    // Send confirmation email
    try {
      // Find all reservations for this person and date range to send one comprehensive email
      const allPersonReservations = await ManualReservation.find({
        personEmail: personEmail.trim().toLowerCase(),
        startDate: startDate,
        endDate: endDate
      }).populate('inventoryId', 'label category serial quantity');

      const emailHtml = formatReservationEmail(allPersonReservations, personName);

      const msg = {
        to: personEmail.trim().toLowerCase(),
        from: SENDGRID_FROM,
        subject: 'Gear Reservation Confirmation - Lumetry Media',
        html: emailHtml
      };

      await sgMail.send(msg);
      console.log(`Reservation confirmation email sent to ${personEmail}`);
    } catch (emailError) {
      console.error('Failed to send reservation confirmation email:', emailError);
      // Don't fail the request if email fails - reservation was created successfully
    }

    res.status(201).json({
      message: 'Manual reservation created successfully',
      reservation: reservation
    });

  } catch (error) {
    console.error('Error creating manual reservation:', error);
    res.status(500).json({ error: 'Failed to create manual reservation' });
  }
});

// Delete a manual reservation (admin only)
app.delete('/api/manual-reservations/:id', authenticate, async (req, res) => {
  try {
    if (!canManageGearInventory(req.user)) {
      return res.status(403).json({ error: 'Access denied. Inventory manager privileges required.' });
    }

    const { id } = req.params;

    const reservation = await ManualReservation.findById(id);
    if (!reservation) {
      return res.status(404).json({ error: 'Manual reservation not found' });
    }

    await ManualReservation.findByIdAndDelete(id);

    res.json({ message: 'Manual reservation deleted successfully' });

  } catch (error) {
    console.error('Error deleting manual reservation:', error);
    res.status(500).json({ error: 'Failed to delete manual reservation' });
  }
});

// Send email summary for manual reservations (admin only)
app.post('/api/manual-reservations/send-email', authenticate, async (req, res) => {
  try {
    if (!canManageGearInventory(req.user)) {
      return res.status(403).json({ error: 'Access denied. Inventory manager privileges required.' });
    }

    const { personName, personEmail, startDate, endDate } = req.body;

    // Validate required fields
    if (!personName || !personEmail || !startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required fields: personName, personEmail, startDate, endDate' });
    }

    // Find all reservations for this person and date range
    const reservations = await ManualReservation.find({
      personName: personName,
      startDate: startDate,
      endDate: endDate
    }).populate('inventoryId', 'label category serial quantity');

    if (reservations.length === 0) {
      return res.status(404).json({ error: 'No reservations found for the specified criteria' });
    }

    // Generate and send email
    const emailHtml = formatReservationEmail(reservations, personName);

    const msg = {
      to: personEmail.trim().toLowerCase(),
      from: SENDGRID_FROM,
      subject: 'Gear Reservation Summary - Lumetry Media',
      html: emailHtml
    };

    await sgMail.send(msg);
    console.log(`Reservation summary email sent to ${personEmail}`);

    res.json({ 
      message: `Email summary sent successfully to ${personEmail}`,
      reservationCount: reservations.length
    });

  } catch (error) {
    console.error('Error sending reservation email summary:', error);
    res.status(500).json({ error: 'Failed to send email summary' });
  }
});

// Get manual reservations for a specific inventory item (admin only)
app.get('/api/manual-reservations/inventory/:inventoryId', authenticate, async (req, res) => {
  try {
    if (!canManageGearInventory(req.user)) {
      return res.status(403).json({ error: 'Access denied. Inventory manager privileges required.' });
    }

    const { inventoryId } = req.params;

    const reservations = await ManualReservation.find({ inventoryId })
      .populate('createdBy', 'fullName email')
      .sort({ startDate: 1 });

    res.json(reservations);

  } catch (error) {
    console.error('Error fetching manual reservations for inventory:', error);
    res.status(500).json({ error: 'Failed to fetch manual reservations' });
  }
});

// ========= END MANUAL RESERVATIONS API =========

// ========= CREW PLANNER API =========

const CrewPlanner = require('./models/CrewPlanner');

// Get all crew planner tables for the current user (admin only)
app.get('/api/crew-planner', authenticate, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    const tables = await CrewPlanner.find()
      .populate('createdBy', 'fullName email')
      .sort({ updatedAt: -1 });

    res.json(tables);
  } catch (error) {
    console.error('Error fetching crew planner tables:', error);
    res.status(500).json({ error: 'Failed to fetch crew planner tables' });
  }
});

// Get specific crew planner table by ID
app.get('/api/crew-planner/:id', authenticate, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    const table = await CrewPlanner.findById(req.params.id)
      .populate('createdBy', 'fullName email');

    if (!table) {
      return res.status(404).json({ error: 'Crew planner table not found' });
    }

    res.json(table);
  } catch (error) {
    console.error('Error fetching crew planner table:', error);
    res.status(500).json({ error: 'Failed to fetch crew planner table' });
  }
});

// Create new crew planner table
app.post('/api/crew-planner', authenticate, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Table name is required' });
    }

    // Check if table with same name already exists
    const existingTable = await CrewPlanner.findOne({ 
      name: name.trim(),
      createdBy: req.user.id 
    });

    if (existingTable) {
      return res.status(400).json({ error: 'A table with this name already exists' });
    }

    const table = new CrewPlanner({
      name: name.trim(),
      description: description?.trim() || '',
      createdBy: req.user.id,
      dates: []
    });

    await table.save();

    const populatedTable = await CrewPlanner.findById(table._id)
      .populate('createdBy', 'fullName email');

    res.status(201).json(populatedTable);
  } catch (error) {
    console.error('Error creating crew planner table:', error);
    res.status(500).json({ error: 'Failed to create crew planner table' });
  }
});

// Update crew planner table
app.put('/api/crew-planner/:id', authenticate, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    const table = await CrewPlanner.findById(req.params.id);

    if (!table) {
      return res.status(404).json({ error: 'Crew planner table not found' });
    }

    const { name, description, dates } = req.body;

    if (name && name.trim()) {
      table.name = name.trim();
    }

    if (description !== undefined) {
      table.description = description.trim();
    }

    if (dates !== undefined) {
      table.dates = dates;
    }

    table.updatedAt = new Date();
    await table.save();

    const populatedTable = await CrewPlanner.findById(table._id)
      .populate('createdBy', 'fullName email');

    res.json(populatedTable);
  } catch (error) {
    console.error('Error updating crew planner table:', error);
    res.status(500).json({ error: 'Failed to update crew planner table' });
  }
});

// Delete crew planner table
app.delete('/api/crew-planner/:id', authenticate, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    const table = await CrewPlanner.findById(req.params.id);

    if (!table) {
      return res.status(404).json({ error: 'Crew planner table not found' });
    }

    await CrewPlanner.findByIdAndDelete(req.params.id);

    res.json({ message: 'Crew planner table deleted successfully' });
  } catch (error) {
    console.error('Error deleting crew planner table:', error);
    res.status(500).json({ error: 'Failed to delete crew planner table' });
  }
});

// ========= END CREW PLANNER API =========

// ========= CREW CALENDAR API =========

// Get all crew assignments across all events for calendar view (admin only)
app.get('/api/crew-calendar', authenticate, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    // Fetch all tables (including archived) with crew data
    const tables = await Table.find({})
      .select('title archived rows')
      .lean();

    // Transform data to include only crew rows with dates
    const eventsWithCrew = tables.map(table => ({
      _id: table._id,
      title: table.title,
      archived: table.archived || false,
      crew: (table.rows || [])
        .filter(row => row.date && row.name && row.role !== '__placeholder__')
        .map(row => ({
          date: row.date,
          name: row.name,
          role: row.role,
          _id: row._id
        }))
    })).filter(event => event.crew.length > 0); // Only include events with crew data

    res.json({ events: eventsWithCrew });
  } catch (error) {
    console.error('Error fetching crew calendar data:', error);
    res.status(500).json({ error: 'Failed to fetch crew calendar data' });
  }
});

// ========= END CREW CALENDAR API =========

// ===========================================
// FLIGHT MANAGEMENT API ROUTES
// ===========================================

// Helper function to check if user has planner/admin access
// Note: 'owner' role is for event ownership, not system-wide admin access
function hasPlannerAccess(user) {
  return user && (user.role === 'admin' || user.role === 'planner');
}

// ===== PASSENGER ROUTES =====

// Get all passengers
app.get('/api/passengers', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const passengers = await Passenger.find({ isActive: true })
      .populate('userId', 'fullName email')
      .sort({ lastName: 1, firstName: 1 });
    
    res.json(passengers);
  } catch (error) {
    console.error('Get passengers error:', error);
    res.status(500).json({ error: 'Failed to fetch passengers' });
  }
});

// Get single passenger
app.get('/api/passengers/:id', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const passenger = await Passenger.findById(req.params.id)
      .populate('userId', 'fullName email');
    if (!passenger) {
      return res.status(404).json({ error: 'Passenger not found' });
    }
    
    res.json(passenger);
  } catch (error) {
    console.error('Get passenger error:', error);
    res.status(500).json({ error: 'Failed to fetch passenger' });
  }
});

// Create new passenger
app.post('/api/passengers', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const passengerData = {
      ...req.body,
      createdBy: req.user.id
    };

    const passenger = new Passenger(passengerData);
    await passenger.save();
    
    console.log('✅ New passenger created:', passenger.fullName);
    res.status(201).json(passenger);
  } catch (error) {
    console.error('Create passenger error:', error);
    res.status(500).json({ error: 'Failed to create passenger' });
  }
});

// Update passenger
app.put('/api/passengers/:id', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const passenger = await Passenger.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!passenger) {
      return res.status(404).json({ error: 'Passenger not found' });
    }
    
    console.log('✅ Passenger updated:', passenger.fullName);
    res.json(passenger);
  } catch (error) {
    console.error('Update passenger error:', error);
    res.status(500).json({ error: 'Failed to update passenger' });
  }
});

// Delete (soft delete) passenger
app.delete('/api/passengers/:id', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const passenger = await Passenger.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    
    if (!passenger) {
      return res.status(404).json({ error: 'Passenger not found' });
    }
    
    console.log('✅ Passenger deleted (soft):', passenger.fullName);
    res.json({ message: 'Passenger deleted', passenger });
  } catch (error) {
    console.error('Delete passenger error:', error);
    res.status(500).json({ error: 'Failed to delete passenger' });
  }
});

// ===== FLIGHT REQUEST ROUTES =====

// Get all flight requests (with optional status filter)
app.get('/api/flights', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const { status, eventId } = req.query;
    const query = {};
    
    if (status) {
      query.status = status;
    }
    if (eventId) {
      query.eventId = eventId;
    }

    const flights = await FlightRequest.find(query)
      .populate('createdBy', 'fullName email')
      .populate('eventId', 'title')
      .populate('bookedDetails.bookedBy', 'fullName email')
      .populate('returnBookedDetails.bookedBy', 'fullName email')
      .sort({ createdAt: -1 });
    
    res.json(flights);
  } catch (error) {
    console.error('Get flights error:', error);
    res.status(500).json({ error: 'Failed to fetch flight requests' });
  }
});

// Get pending requests (includes both pending and change_requested)
app.get('/api/flights/pending', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const flights = await FlightRequest.find({ status: { $in: ['pending', 'change_requested'] } })
      .populate('createdBy', 'fullName email')
      .populate('eventId', 'title')
      .populate('bookedDetails.bookedBy', 'fullName email')
      .populate('returnBookedDetails.bookedBy', 'fullName email')
      .populate('changeDetails.requestedBy', 'fullName email')
      .populate('changeDetails.originalFlightId')
      .sort({ departDate: 1 });
    
    res.json(flights);
  } catch (error) {
    console.error('Get pending flights error:', error);
    res.status(500).json({ error: 'Failed to fetch pending requests' });
  }
});

// Get booked flights
app.get('/api/flights/booked', authenticate, async (req, res) => {
  try {
    const { eventId, eventName } = req.query;
    
    // If filtering by eventId or eventName, allow any authenticated user
    // (they can only see flights for events they have access to via travel page)
    // If no filter, require planner access (for Flight Management page)
    if (!eventId && !eventName && !hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    // Build query - include both booked and cancelled flights
    const query = { status: { $in: ['booked', 'cancelled'] } };
    
    // Prefer filtering by eventId (source of truth), fall back to eventName for backward compat
    if (eventId) {
      query.eventId = eventId;
    } else if (eventName) {
      query.eventName = { $regex: new RegExp(`^${eventName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
    }

    const flights = await FlightRequest.find(query)
      .populate('createdBy', 'fullName email')
      .populate('bookedDetails.bookedBy', 'fullName email')
      .populate('returnBookedDetails.bookedBy', 'fullName email')
      .populate('eventId', 'title')
      .sort({ departDate: 1 });
    
    res.json(flights);
  } catch (error) {
    console.error('Get booked flights error:', error);
    res.status(500).json({ error: 'Failed to fetch booked flights' });
  }
});

// Get events for linking to flight requests (autocomplete) - must be before :id route
app.get('/api/flights/events/search', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const { q } = req.query;
    const query = { archived: { $ne: true } };
    
    if (q) {
      query.title = { $regex: q, $options: 'i' };
    }

    const events = await Table.find(query)
      .select('title general.startDate general.endDate')
      .sort({ createdAt: -1 })
      .limit(10);
    
    res.json(events);
  } catch (error) {
    console.error('Search events error:', error);
    res.status(500).json({ error: 'Failed to search events' });
  }
});

// Get single flight request
app.get('/api/flights/:id', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const flight = await FlightRequest.findById(req.params.id)
      .populate('createdBy', 'fullName email')
      .populate('eventId', 'title')
      .populate('bookedDetails.bookedBy', 'fullName email')
      .populate('returnBookedDetails.bookedBy', 'fullName email');
    
    if (!flight) {
      return res.status(404).json({ error: 'Flight request not found' });
    }
    
    res.json(flight);
  } catch (error) {
    console.error('Get flight error:', error);
    res.status(500).json({ error: 'Failed to fetch flight request' });
  }
});

// Create new flight request
app.post('/api/flights', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const flightData = {
      ...req.body,
      createdBy: req.user.id,
      status: req.body.status || 'pending'  // Use provided status or default to 'pending'
    };

    // Auto-sync eventName from eventId (eventId is the source of truth)
    if (flightData.eventId) {
      try {
        const linkedEvent = await Table.findById(flightData.eventId).select('title');
        if (linkedEvent) {
          flightData.eventName = linkedEvent.title;
        }
      } catch (e) {
        console.warn('Could not resolve eventId to event title:', e.message);
      }
    }

    if (flightData.cost !== undefined) {
      flightData.cost = parseFlightCostInput(flightData.cost);
    }

    // If status is 'booked', add bookedBy and bookedAt to bookedDetails
    if (flightData.status === 'booked' && flightData.bookedDetails) {
      flightData.bookedDetails.bookedBy = req.user.id;
      flightData.bookedDetails.bookedAt = new Date();
      
      // Also for return flight if exists
      if (flightData.returnBookedDetails) {
        flightData.returnBookedDetails.bookedBy = req.user.id;
        flightData.returnBookedDetails.bookedAt = new Date();
      }
    }

    const flight = new FlightRequest(flightData);
    await flight.save();
    
    // Populate for response
    await flight.populate('createdBy', 'fullName email');
    if (flight.eventId) {
      await flight.populate('eventId', 'title');
    }
    if (flight.bookedDetails?.bookedBy) {
      await flight.populate('bookedDetails.bookedBy', 'fullName email');
    }
    if (flight.returnBookedDetails?.bookedBy) {
      await flight.populate('returnBookedDetails.bookedBy', 'fullName email');
    }
    
    console.log(`✅ New flight ${flight.status === 'booked' ? 'booking' : 'request'} created:`, flight._id);
    
    // Notify connected clients
    const eventType = flight.status === 'booked' ? 'flightBookingCreated' : 'flightRequestCreated';
    notifyDataChange(eventType, { flightId: flight._id, status: flight.status });

    // 🔔 Notify all planners & admins about new pending flight request
    if (flight.status === 'pending') {
      try {
        const plannerUsers = await User.find({ role: { $in: ['planner', 'admin'] } }).select('_id');
        const plannerIds = plannerUsers.map(u => u._id.toString());
        const passengerNames = (flight.passengers || []).map(p => p.name).join(', ') || 'Unknown';
        const routeStr = `${flight.from?.code || ''} → ${flight.to?.code || ''}`;

        await createNotificationBulk(plannerIds, {
          type: 'flight_request',
          title: 'New Flight Request',
          message: `${passengerNames} — ${routeStr} on ${new Date(flight.departDate).toLocaleDateString()}`,
          actorId: req.user.id,
          eventId: flight.eventId || null,
          link: { page: 'flights', params: { flightId: flight._id.toString() } },
          metadata: { flightId: flight._id.toString(), route: routeStr, passengers: passengerNames }
        });
      } catch (notifErr) {
        console.error('🔔 Failed to notify planners about new flight request:', notifErr);
      }
    }
    
    res.status(201).json(flight);
  } catch (error) {
    console.error('Create flight error:', error);
    res.status(500).json({ error: 'Failed to create flight request' });
  }
});

// Update flight request
app.put('/api/flights/:id', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const updateData = { ...req.body };

    if (updateData.cost !== undefined) {
      updateData.cost = parseFlightCostInput(updateData.cost);
    }

    // Auto-sync eventName from eventId (eventId is the source of truth)
    if (updateData.eventId) {
      try {
        const linkedEvent = await Table.findById(updateData.eventId).select('title');
        if (linkedEvent) {
          updateData.eventName = linkedEvent.title;
        }
      } catch (e) {
        console.warn('Could not resolve eventId to event title:', e.message);
      }
    } else if (updateData.eventId === null) {
      // Explicitly clearing the event association
      updateData.eventName = updateData.eventName || '';
    }

    const flight = await FlightRequest.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'fullName email')
     .populate('eventId', 'title')
     .populate('bookedDetails.bookedBy', 'fullName email')
     .populate('returnBookedDetails.bookedBy', 'fullName email');
    
    if (!flight) {
      return res.status(404).json({ error: 'Flight request not found' });
    }
    
    console.log('✅ Flight request updated:', flight._id);
    
    // Notify connected clients
    notifyDataChange('flightRequestUpdated', { flightId: flight._id });
    
    res.json(flight);
  } catch (error) {
    console.error('Update flight error:', error);
    res.status(500).json({ error: 'Failed to update flight request' });
  }
});

// Book a flight (update status to booked with booking details)
app.patch('/api/flights/:id/book', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const { bookedDetails, returnBookedDetails, cost } = req.body;

    const updateData = {
      status: 'booked',
      bookedDetails: {
        ...bookedDetails,
        bookedAt: new Date(),
        bookedBy: req.user.id
      }
    };

    if (cost !== undefined) {
      updateData.cost = parseFlightCostInput(cost);
    }

    // If roundtrip and return details provided
    if (returnBookedDetails) {
      updateData.returnBookedDetails = {
        ...returnBookedDetails,
        bookedAt: new Date(),
        bookedBy: req.user.id
      };
    }

    const flight = await FlightRequest.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'fullName email')
     .populate('bookedDetails.bookedBy', 'fullName email')
     .populate('returnBookedDetails.bookedBy', 'fullName email')
     .populate('eventId', 'title');
    
    if (!flight) {
      return res.status(404).json({ error: 'Flight request not found' });
    }
    
    console.log('✅ Flight booked:', flight._id);
    
    // Notify connected clients
    notifyDataChange('flightBooked', { flightId: flight._id });

    // 🔔 Notify the original requester that their flight has been booked
    if (flight.createdBy && flight.createdBy._id) {
      try {
        const passengerNames = (flight.passengers || []).map(p => p.name).join(', ') || 'Unknown';
        const routeStr = `${flight.from?.code || ''} → ${flight.to?.code || ''}`;
        const airline = flight.bookedDetails?.airline || '';
        const flightNum = flight.bookedDetails?.flightNumber || '';
        const bookingInfo = [airline, flightNum].filter(Boolean).join(' ');

        await createNotification({
          recipientId: flight.createdBy._id.toString(),
          type: 'flight_booked',
          title: 'Flight Booked',
          message: `${routeStr}${bookingInfo ? ` — ${bookingInfo}` : ''} for ${passengerNames}`,
          actorId: req.user.id,
          eventId: flight.eventId?._id || flight.eventId || null,
          link: { page: 'flights', params: { flightId: flight._id.toString() } },
          metadata: { flightId: flight._id.toString(), route: routeStr, passengers: passengerNames, airline, flightNumber: flightNum }
        });
      } catch (notifErr) {
        console.error('🔔 Failed to notify requester about flight booking:', notifErr);
      }
    }
    
    res.json(flight);
  } catch (error) {
    console.error('Book flight error:', error);
    res.status(500).json({ error: 'Failed to book flight' });
  }
});

// Cancel flight request
app.patch('/api/flights/:id/cancel', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const flight = await FlightRequest.findByIdAndUpdate(
      req.params.id,
      { status: 'cancelled' },
      { new: true }
    );
    
    if (!flight) {
      return res.status(404).json({ error: 'Flight request not found' });
    }
    
    console.log('✅ Flight request cancelled:', flight._id);
    
    // Notify connected clients
    notifyDataChange('flightRequestCancelled', { flightId: flight._id });
    
    res.json(flight);
  } catch (error) {
    console.error('Cancel flight error:', error);
    res.status(500).json({ error: 'Failed to cancel flight request' });
  }
});

// Delete flight request (hard delete - use with caution)
app.delete('/api/flights/:id', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const flight = await FlightRequest.findByIdAndDelete(req.params.id);
    
    if (!flight) {
      return res.status(404).json({ error: 'Flight request not found' });
    }
    
    console.log('✅ Flight request deleted:', req.params.id);
    
    // Notify connected clients
    notifyDataChange('flightRequestDeleted', { flightId: req.params.id });
    
    res.json({ message: 'Flight request deleted' });
  } catch (error) {
    console.error('Delete flight error:', error);
    res.status(500).json({ error: 'Failed to delete flight request' });
  }
});

// Request a change to a booked flight (creates a change_requested entry in pending)
app.post('/api/flights/:id/request-change', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const originalFlight = await FlightRequest.findById(req.params.id);
    if (!originalFlight) {
      return res.status(404).json({ error: 'Flight not found' });
    }
    if (originalFlight.status !== 'booked') {
      return res.status(400).json({ error: 'Can only request changes for booked flights' });
    }

    const { requestedChanges, changeReason } = req.body;

    // Create a new pending request that represents the change request
    const changeRequest = new FlightRequest({
      eventId: originalFlight.eventId,
      eventName: originalFlight.eventName,
      createdBy: req.user.id,
      tripType: originalFlight.tripType,
      from: originalFlight.from,
      to: originalFlight.to,
      // Use requested dates if provided, otherwise keep originals
      departDate: requestedChanges?.departDate || originalFlight.departDate,
      returnDate: requestedChanges?.returnDate !== undefined ? requestedChanges.returnDate : originalFlight.returnDate,
      departTimePreference: requestedChanges?.departTimePreference || originalFlight.departTimePreference,
      returnTimePreference: requestedChanges?.returnTimePreference || originalFlight.returnTimePreference,
      passengers: originalFlight.passengers,
      status: 'change_requested',
      notes: requestedChanges?.notes || originalFlight.notes,
      changeDetails: {
        originalFlightId: originalFlight._id,
        changeReason: changeReason || '',
        requestedBy: req.user.id,
        requestedAt: new Date(),
        requestedChanges: {
          departDate: requestedChanges?.departDate || null,
          returnDate: requestedChanges?.returnDate || null,
          departTimePreference: requestedChanges?.departTimePreference || null,
          returnTimePreference: requestedChanges?.returnTimePreference || null,
          notes: requestedChanges?.notes || null,
          cancelFlight: requestedChanges?.cancelFlight || false
        }
      }
    });

    await changeRequest.save();

    const populated = await FlightRequest.findById(changeRequest._id)
      .populate('createdBy', 'fullName email')
      .populate('eventId', 'title')
      .populate('changeDetails.requestedBy', 'fullName email')
      .populate('changeDetails.originalFlightId');

    console.log('✅ Flight change requested:', changeRequest._id, 'for original:', originalFlight._id);

    // Notify connected clients
    notifyDataChange('flightChangeRequested', { flightId: changeRequest._id, originalFlightId: originalFlight._id });

    res.status(201).json(populated);
  } catch (error) {
    console.error('Request flight change error:', error);
    res.status(500).json({ error: 'Failed to create change request' });
  }
});

// Approve a change request (apply changes to original flight and delete the change request)
app.patch('/api/flights/:id/approve-change', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const changeRequest = await FlightRequest.findById(req.params.id);
    if (!changeRequest) {
      return res.status(404).json({ error: 'Change request not found' });
    }
    if (changeRequest.status !== 'change_requested') {
      return res.status(400).json({ error: 'This is not a change request' });
    }

    const originalFlightId = changeRequest.changeDetails?.originalFlightId;
    if (!originalFlightId) {
      return res.status(400).json({ error: 'No original flight linked to this change request' });
    }

    const { updatedBookedDetails, updatedReturnBookedDetails, cost } = req.body;

    // Build update object from the change request's top-level fields (which already have the new values)
    const updateData = {
      departDate: changeRequest.departDate,
      returnDate: changeRequest.returnDate,
      departTimePreference: changeRequest.departTimePreference,
      returnTimePreference: changeRequest.returnTimePreference,
      notes: changeRequest.notes
    };

    if (cost !== undefined) {
      updateData.cost = parseFlightCostInput(cost);
    }

    // If new booking details were provided, merge them into the existing booked details
    if (updatedBookedDetails) {
      // Get the original flight to preserve existing fields not being overwritten
      const origFlight = await FlightRequest.findById(originalFlightId);
      const existingBooked = origFlight?.bookedDetails?.toObject?.() || origFlight?.bookedDetails || {};
      
      updateData.bookedDetails = {
        ...existingBooked,
        // Only overwrite fields that have non-empty values
        ...(updatedBookedDetails.confirmationCode ? { confirmationCode: updatedBookedDetails.confirmationCode } : {}),
        ...(updatedBookedDetails.airline ? { airline: updatedBookedDetails.airline } : {}),
        ...(updatedBookedDetails.flightNumber ? { flightNumber: updatedBookedDetails.flightNumber } : {}),
        ...(updatedBookedDetails.departTime ? { departTime: updatedBookedDetails.departTime } : {}),
        ...(updatedBookedDetails.arriveTime ? { arriveTime: updatedBookedDetails.arriveTime } : {}),
        bookedAt: new Date(),
        bookedBy: req.user.id
      };

      // Handle return flight details for roundtrip
      if (updatedReturnBookedDetails && changeRequest.tripType === 'roundtrip') {
        const existingReturn = origFlight?.returnBookedDetails?.toObject?.() || origFlight?.returnBookedDetails || {};
        updateData.returnBookedDetails = {
          ...existingReturn,
          ...(updatedReturnBookedDetails.flightNumber ? { flightNumber: updatedReturnBookedDetails.flightNumber } : {}),
          ...(updatedReturnBookedDetails.departTime ? { departTime: updatedReturnBookedDetails.departTime } : {}),
          ...(updatedReturnBookedDetails.arriveTime ? { arriveTime: updatedReturnBookedDetails.arriveTime } : {}),
          // Carry forward confirmation code and airline from outbound
          ...(updatedBookedDetails.confirmationCode ? { confirmationCode: updatedBookedDetails.confirmationCode } : {}),
          ...(updatedBookedDetails.airline ? { airline: updatedBookedDetails.airline } : {}),
          bookedAt: new Date(),
          bookedBy: req.user.id
        };
      }
    }

    // Apply changes to the original booked flight
    const updatedFlight = await FlightRequest.findByIdAndUpdate(
      originalFlightId,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'fullName email')
     .populate('bookedDetails.bookedBy', 'fullName email')
     .populate('returnBookedDetails.bookedBy', 'fullName email')
     .populate('eventId', 'title');

    if (!updatedFlight) {
      return res.status(404).json({ error: 'Original booked flight not found' });
    }

    // Delete the change request
    await FlightRequest.findByIdAndDelete(req.params.id);

    console.log('✅ Flight change approved:', req.params.id, '→ updated original:', originalFlightId);

    // Notify connected clients
    notifyDataChange('flightChangeApproved', { flightId: originalFlightId, changeRequestId: req.params.id });

    res.json(updatedFlight);
  } catch (error) {
    console.error('Approve flight change error:', error);
    res.status(500).json({ error: 'Failed to approve change request' });
  }
});

// Reject a change request (just delete it)
app.patch('/api/flights/:id/reject-change', authenticate, async (req, res) => {
  try {
    if (!hasPlannerAccess(req.user)) {
      return res.status(403).json({ error: 'Access denied. Planner or Admin privileges required.' });
    }

    const changeRequest = await FlightRequest.findById(req.params.id);
    if (!changeRequest) {
      return res.status(404).json({ error: 'Change request not found' });
    }
    if (changeRequest.status !== 'change_requested') {
      return res.status(400).json({ error: 'This is not a change request' });
    }

    await FlightRequest.findByIdAndDelete(req.params.id);

    console.log('✅ Flight change rejected and deleted:', req.params.id);

    // Notify connected clients
    notifyDataChange('flightChangeRejected', { changeRequestId: req.params.id });

    res.json({ message: 'Change request rejected and removed' });
  } catch (error) {
    console.error('Reject flight change error:', error);
    res.status(500).json({ error: 'Failed to reject change request' });
  }
});

// ========= END FLIGHT MANAGEMENT API =========

// ========= TIMESHEETS API =========

// Debug endpoint to see raw timesheets data structure
app.get('/api/timesheets/debug', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const timesheetsCollection = mongoose.connection.collection('timesheets');
    const sample = await timesheetsCollection.find({}).limit(5).toArray();
    const count = await timesheetsCollection.countDocuments();
    
    console.log('[TIMESHEETS DEBUG] Collection count:', count);
    console.log('[TIMESHEETS DEBUG] Sample documents:', JSON.stringify(sample, null, 2));
    
    res.json({ 
      count, 
      sample,
      fields: sample.length > 0 ? Object.keys(sample[0]) : []
    });
  } catch (error) {
    console.error('Timesheets debug error:', error);
    res.status(500).json({ error: 'Debug failed', message: error.message });
  }
});

// Get all timesheets (admin only)
app.get('/api/timesheets', authenticate, async (req, res) => {
  try {
    // Check if user is admin
    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // Get timesheets collection directly from MongoDB
    const timesheetsCollection = mongoose.connection.collection('timesheets');
    const timesheets = await timesheetsCollection.find({}).toArray();
    
    console.log('[TIMESHEETS] Found', timesheets.length, 'total entries');
    
    res.json(timesheets);
  } catch (error) {
    console.error('Get timesheets error:', error);
    res.status(500).json({ error: 'Failed to fetch timesheets' });
  }
});

// Get timesheets for a specific user (admin only)
app.get('/api/timesheets/user/:userId', authenticate, async (req, res) => {
  try {
    // Check if user is admin
    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const timesheetsCollection = mongoose.connection.collection('timesheets');
    
    // Try multiple possible field names for userId
    const timesheets = await timesheetsCollection.find({ 
      $or: [
        { userId: req.params.userId },
        { user_id: req.params.userId },
        { user: req.params.userId },
        { userId: new mongoose.Types.ObjectId(req.params.userId) }
      ]
    }).sort({ date: -1, timestamp: -1, createdAt: -1 }).toArray();
    
    res.json(timesheets);
  } catch (error) {
    console.error('Get user timesheets error:', error);
    res.status(500).json({ error: 'Failed to fetch user timesheets' });
  }
});

// Get timesheet summary by user (aggregated hours)
app.get('/api/timesheets/summary', authenticate, async (req, res) => {
  try {
    // Check if user is admin
    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { startDate, endDate } = req.query;
    
    const timesheetsCollection = mongoose.connection.collection('timesheets');
    
    // Get all timesheet documents (each document = one user with their entries array)
    const allDocs = await timesheetsCollection.find({}).toArray();
    console.log('[TIMESHEETS SUMMARY] Total user documents in collection:', allDocs.length);
    
    if (allDocs.length === 0) {
      return res.json([]);
    }
    
    // Parse date filters
    const filterStartDate = startDate ? new Date(startDate) : null;
    const filterEndDate = endDate ? new Date(endDate) : null;
    
    // Process each user's timesheet document
    const summaries = await Promise.all(allDocs.map(async (doc) => {
      let userName = 'Unknown User';
      let userEmail = '';
      
      // Get user info
      try {
        let userDoc = null;
        if (doc.userId && mongoose.Types.ObjectId.isValid(doc.userId)) {
          userDoc = await User.findById(doc.userId);
        }
        if (!userDoc && doc.userId) {
          userDoc = await User.findOne({ _id: doc.userId });
        }
        
        if (userDoc) {
          userName = userDoc.fullName || userDoc.name || userDoc.email;
          userEmail = userDoc.email;
        }
      } catch (e) {
        console.log('Could not find user:', doc.userId, e.message);
      }
      
      // Get entries array and filter by date if needed
      let entries = doc.entries || [];
      
      if (filterStartDate && filterEndDate) {
        entries = entries.filter(entry => {
          const entryDate = new Date(entry.date);
          return entryDate >= filterStartDate && entryDate <= filterEndDate;
        });
      }
      
      console.log('[TIMESHEETS SUMMARY] User', userName, 'has', entries.length, 'entries in date range');
      
      return {
        userId: doc.userId,
        userName,
        userEmail,
        totalEntries: entries.length,
        entries: entries
      };
    }));
    
    // Filter out users with no entries in the date range
    const filteredSummaries = summaries.filter(s => s.totalEntries > 0);
    
    console.log('[TIMESHEETS SUMMARY] Returning', filteredSummaries.length, 'user summaries');
    res.json(filteredSummaries);
  } catch (error) {
    console.error('Get timesheet summary error:', error);
    res.status(500).json({ error: 'Failed to fetch timesheet summary' });
  }
});

// Update a timesheet entry
app.put('/api/timesheets/entry', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { userId, entryId, type, date, time, hours, notes } = req.body;
    
    if (!userId || !entryId) {
      return res.status(400).json({ error: 'userId and entryId are required' });
    }

    console.log('[TIMESHEETS] Updating entry:', { userId, entryId, type, date, time, hours, notes });

    const timesheetsCollection = mongoose.connection.collection('timesheets');
    
    // Find the user's timesheet document
    const timesheetDoc = await timesheetsCollection.findOne({ userId: userId });
    if (!timesheetDoc) {
      return res.status(404).json({ error: 'Timesheet not found for user' });
    }

    // Find and update the entry in the entries array
    const entryIndex = timesheetDoc.entries.findIndex(e => 
      e._id && e._id.toString() === entryId
    );

    if (entryIndex === -1) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    // Build the update object
    const updatedEntry = {
      ...timesheetDoc.entries[entryIndex],
      type: type,
      date: new Date(date),
      notes: notes || ''
    };

    // Set time or hours based on type
    if (type === 'travel') {
      updatedEntry.time = null;
      updatedEntry.hours = hours || 4;
    } else {
      updatedEntry.time = time;
      updatedEntry.hours = null;
    }

    // Update the entry in the array
    const updateResult = await timesheetsCollection.updateOne(
      { userId: userId },
      { $set: { [`entries.${entryIndex}`]: updatedEntry } }
    );

    console.log('[TIMESHEETS] Entry updated:', updateResult.modifiedCount);
    res.json({ success: true, message: 'Entry updated' });
  } catch (error) {
    console.error('Update timesheet entry error:', error);
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

// Delete a timesheet entry
app.delete('/api/timesheets/entry', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { userId, entryId } = req.body;
    
    if (!userId || !entryId) {
      return res.status(400).json({ error: 'userId and entryId are required' });
    }

    console.log('[TIMESHEETS] Deleting entry:', { userId, entryId });

    const timesheetsCollection = mongoose.connection.collection('timesheets');
    
    // Remove the entry from the entries array using $pull
    const updateResult = await timesheetsCollection.updateOne(
      { userId: userId },
      { $pull: { entries: { _id: new mongoose.Types.ObjectId(entryId) } } }
    );

    if (updateResult.modifiedCount === 0) {
      // Try with string comparison if ObjectId didn't work
      const timesheetDoc = await timesheetsCollection.findOne({ userId: userId });
      if (timesheetDoc && timesheetDoc.entries) {
        const filteredEntries = timesheetDoc.entries.filter(e => 
          !(e._id && e._id.toString() === entryId)
        );
        
        if (filteredEntries.length < timesheetDoc.entries.length) {
          await timesheetsCollection.updateOne(
            { userId: userId },
            { $set: { entries: filteredEntries } }
          );
          console.log('[TIMESHEETS] Entry deleted via filter');
          return res.json({ success: true, message: 'Entry deleted' });
        }
      }
      return res.status(404).json({ error: 'Entry not found' });
    }

    console.log('[TIMESHEETS] Entry deleted:', updateResult.modifiedCount);
    res.json({ success: true, message: 'Entry deleted' });
  } catch (error) {
    console.error('Delete timesheet entry error:', error);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

// ========= END TIMESHEETS API =========

// ========= POST PRODUCTION API =========

function isPostProductionAdmin(user) {
  return /^admin$/i.test(user?.role || '');
}

function isPostProductionItemComplete(doc) {
  return doc.editStatus === 'done' && doc.qcStatus === 'approved' && doc.deliveryStatus === 'done';
}

async function resolvePostProductionProject(projectText, eventId) {
  const name = String(projectText || '').trim();
  if (eventId) {
    const table = await Table.findById(eventId).select('title owners').lean();
    if (table) {
      return {
        eventId: table._id,
        project: table.title || name,
        owners: (table.owners || []).map(id => id.toString())
      };
    }
  }
  if (!name) {
    return { eventId: null, project: '', owners: [] };
  }
  const exact = await Table.findOne({
    title: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') }
  }).select('title owners').lean();
  if (exact) {
    return {
      eventId: exact._id,
      project: exact.title,
      owners: (exact.owners || []).map(id => id.toString())
    };
  }
  return { eventId: null, project: name, owners: [] };
}

async function userOwnsPostProductionEvent(userId, eventId) {
  if (!eventId) return false;
  const table = await Table.findById(eventId).select('owners').lean();
  if (!table) return false;
  const uid = userId.toString();
  return (table.owners || []).some(id => id.toString() === uid);
}

function normalizePostProductionUserIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(String).filter(id => mongoose.Types.ObjectId.isValid(id)))];
}

function getPostProductionEditorIds(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  const ids = new Set();
  (o.editorIds || []).forEach(id => {
    if (id) ids.add(id.toString());
  });
  if (o.editorId) ids.add(o.editorId.toString());
  return [...ids];
}

function getPostProductionCollaboratorIds(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return (o.collaboratorIds || [])
    .map(id => id?.toString?.() || String(id))
    .filter(id => mongoose.Types.ObjectId.isValid(id));
}

function syncPostProductionAssigneeFields(doc) {
  const editorIds = getPostProductionEditorIds(doc);
  const collaboratorIds = getPostProductionCollaboratorIds(doc);
  doc.editorIds = editorIds;
  doc.collaboratorIds = collaboratorIds;
  doc.editorId = editorIds[0] || null;
}

function formatPostProductionUserList(ids, usersById) {
  return ids.map(id => {
    const u = usersById[id];
    return {
      _id: id,
      name: u?.fullName || u?.email || '',
      profilePhoto: u?.profilePhoto || null
    };
  });
}

function postProductionUsersSortName(users) {
  return users.map(u => u.name).filter(Boolean).join(', ').toLowerCase();
}

/** Assigned as editor, collaborator, or post-production owner (not the event's owners list). */
function isAssignedToPostProductionItem(user, doc) {
  const uid = user.id.toString();
  const ownerId = doc.ownerId ? doc.ownerId.toString() : null;
  if (ownerId === uid) return true;
  return getPostProductionEditorIds(doc).includes(uid)
    || getPostProductionCollaboratorIds(doc).includes(uid);
}

/**
 * Read/update access: admins see all; event owners (Table.owners) see items for their events;
 * everyone else only sees items where they are editor or assignee owner.
 */
async function canAccessPostProductionItem(user, doc) {
  if (isPostProductionAdmin(user)) return true;
  if (doc.eventId && await userOwnsPostProductionEvent(user.id, doc.eventId)) return true;
  return isAssignedToPostProductionItem(user, doc);
}

/** MongoDB filter for non-admin list/detail queries; null = no restriction (admin). */
async function buildPostProductionAccessFilter(user) {
  if (isPostProductionAdmin(user)) return null;

  const uid = user.id;
  const ownedEvents = await Table.find({ owners: uid }).select('_id').lean();
  const ownedEventIds = ownedEvents.map(t => t._id);

  const or = [
    { editorId: uid },
    { editorIds: uid },
    { collaboratorIds: uid },
    { ownerId: uid }
  ];
  if (ownedEventIds.length) {
    or.push({ eventId: { $in: ownedEventIds } });
  }

  return { $or: or };
}

async function canEditPostProductionProject(user, resolved) {
  if (isPostProductionAdmin(user)) return true;
  if (!resolved.eventId) return false;
  return userOwnsPostProductionEvent(user.id, resolved.eventId);
}

async function canCreatePostProductionItem(user, payload) {
  if (isPostProductionAdmin(user)) return true;
  const resolved = await resolvePostProductionProject(payload.project, payload.eventId);
  if (!resolved.eventId) return false;
  return userOwnsPostProductionEvent(user.id, resolved.eventId);
}

async function postProductionUsersById(docs) {
  const list = Array.isArray(docs) ? docs : [docs];
  const ids = new Set();
  list.forEach(doc => {
    const o = doc.toObject ? doc.toObject() : doc;
    getPostProductionEditorIds(o).forEach(id => ids.add(id));
    getPostProductionCollaboratorIds(o).forEach(id => ids.add(id));
    if (o.ownerId) ids.add(o.ownerId.toString());
  });
  if (!ids.size) return {};
  const users = await User.find(
    { _id: { $in: [...ids] } },
    'fullName email profilePhoto'
  ).lean();
  const usersById = {};
  users.forEach(u => { usersById[u._id.toString()] = u; });
  return usersById;
}

function formatPostProductionUpdates(rawDoc) {
  const o = rawDoc.toObject ? rawDoc.toObject() : rawDoc;
  let updates = [...(o.updates || [])];
  if (!updates.length && (o.notes || []).length) {
    updates = (o.notes || []).map(n => ({
      _id: n._id,
      text: n.text,
      authorId: n.authorId,
      authorName: n.authorName,
      mentionIds: [],
      replies: [],
      createdAt: n.createdAt
    }));
  }
  updates.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const mapEntry = (entry) => ({
    ...entry,
    mentionIds: (entry.mentionIds || []).map(id => id?.toString?.() || id),
    links: (entry.links || []).map(l => ({
      _id: l._id,
      url: l.url || '',
      label: l.label || ''
    })),
    attachments: (entry.attachments || []).map(a => ({
      _id: a._id,
      url: sanitizePostProductionAttachmentUrl(a.url || ''),
      originalName: a.originalName || '',
      fileType: a.fileType || '',
      size: a.size || 0,
      cloudinaryPublicId: a.cloudinaryPublicId || ''
    }))
  });
  updates = updates.map(u => ({
    ...mapEntry(u),
    replies: [...(u.replies || [])]
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map(r => mapEntry(r))
  }));
  const updateCount = updates.reduce((n, u) => n + 1 + (u.replies?.length || 0), 0);
  const latestUpdate = updates[0] || null;
  return { updates, updateCount, latestUpdate };
}

function isUnreadPostProductionEntry(entry, lastReadAt, userId) {
  const authorId = entry?.authorId?.toString?.() || String(entry?.authorId || '');
  if (authorId && authorId === userId) return false;
  const createdAt = entry?.createdAt ? new Date(entry.createdAt) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return false;
  if (!lastReadAt) return false;
  return createdAt > new Date(lastReadAt);
}

function countUnreadPostProductionUpdates(updates, lastReadAt, userId) {
  const uid = userId?.toString?.() || String(userId || '');
  if (!uid) return 0;
  return (updates || []).reduce((n, u) => {
    let count = isUnreadPostProductionEntry(u, lastReadAt, uid) ? 1 : 0;
    for (const reply of u.replies || []) {
      if (isUnreadPostProductionEntry(reply, lastReadAt, uid)) count += 1;
    }
    return n + count;
  }, 0);
}

async function postProductionLastReadMap(userId, itemIds) {
  const ids = [...new Set((itemIds || []).map(id => id?.toString?.() || String(id)).filter(Boolean))];
  if (!ids.length) return new Map();
  const reads = await PostProductionUpdateRead.find({
    userId,
    itemId: { $in: ids }
  }).select('itemId lastReadAt').lean();
  return new Map(reads.map(r => [r.itemId.toString(), r.lastReadAt]));
}

async function markPostProductionUpdatesRead(userId, itemId) {
  const now = new Date();
  await PostProductionUpdateRead.findOneAndUpdate(
    { userId, itemId },
    { $set: { lastReadAt: now } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return now;
}

/** First-time recipients get a baseline just before the new message so only that update counts as unread. */
async function ensurePostProductionUnreadBaseline(userId, itemId, updateTime) {
  const t = updateTime instanceof Date ? updateTime : new Date(updateTime);
  const markBefore = new Date(t.getTime() - 1);
  await PostProductionUpdateRead.findOneAndUpdate(
    { userId, itemId },
    { $setOnInsert: { lastReadAt: markBefore } },
    { upsert: true }
  );
}

/** Everyone who can view the item except the author should get unread tracking for a new update. */
async function getPostProductionUpdateRecipientIds(doc, actorId, mentionIds = []) {
  const ids = new Set();
  const add = (id) => {
    if (!id) return;
    const s = id?.toString?.() || String(id);
    if (mongoose.Types.ObjectId.isValid(s)) ids.add(s);
  };
  getPostProductionEditorIds(doc).forEach(add);
  getPostProductionCollaboratorIds(doc).forEach(add);
  add(doc.ownerId);
  (mentionIds || []).forEach(add);
  if (doc.eventId) {
    const table = await Table.findById(doc.eventId).select('owners').lean();
    (table?.owners || []).forEach(o => add(o));
  }
  const admins = await User.find({ role: { $regex: /^admin$/i } }).select('_id').lean();
  admins.forEach(u => add(u._id));
  const actorStr = ppIdStr(actorId);
  if (actorStr) ids.delete(actorStr);
  return [...ids];
}

async function bumpPostProductionUnreadForRecipients(doc, actorId, mentionIds, updateTime) {
  const recipientIds = await getPostProductionUpdateRecipientIds(doc, actorId, mentionIds);
  await Promise.all(
    recipientIds.map(rid => ensurePostProductionUnreadBaseline(rid, doc._id, updateTime))
  );
}

async function markPostProductionAssignmentNew(userId, itemId) {
  await PostProductionAssignmentSeen.deleteOne({ userId, itemId });
}

async function markPostProductionAssignmentsVisited(user, userId) {
  const accessFilter = await buildPostProductionAccessFilter(user);
  const query = { archived: { $ne: true } };
  if (accessFilter) Object.assign(query, accessFilter);
  const items = await PostProductionItem.find(query).select('editorId editorIds collaboratorIds ownerId').lean();
  const uid = userId?.toString?.() || String(userId);
  const ops = [];
  for (const item of items) {
    const isAssigned = item.ownerId?.toString() === uid
      || getPostProductionEditorIds(item).includes(uid)
      || getPostProductionCollaboratorIds(item).includes(uid);
    if (!isAssigned) continue;
    ops.push({
      updateOne: {
        filter: { userId, itemId: item._id },
        update: { $set: { seenAt: new Date() } },
        upsert: true
      }
    });
  }
  if (ops.length) await PostProductionAssignmentSeen.bulkWrite(ops);
}

async function getPostProductionSidebarIndicator(user) {
  const userId = user.id;
  const uid = userId?.toString?.() || String(userId);
  const accessFilter = await buildPostProductionAccessFilter(user);
  const query = { archived: { $ne: true } };
  if (accessFilter) Object.assign(query, accessFilter);

  const items = await PostProductionItem.find(query)
    .select('updates editorId editorIds collaboratorIds ownerId notes')
    .lean();
  if (!items.length) return { hasNew: false };

  const itemIds = items.map(i => i._id);
  const readMap = await postProductionLastReadMap(userId, itemIds);

  let hasUnread = false;
  for (const item of items) {
    const { updates } = formatPostProductionUpdates(item);
    const lastReadAt = readMap.get(item._id.toString()) || null;
    if (countUnreadPostProductionUpdates(updates, lastReadAt, uid) > 0) {
      hasUnread = true;
      break;
    }
  }

  const assignedIds = items
    .filter(i => i.ownerId?.toString() === uid
      || getPostProductionEditorIds(i).includes(uid)
      || getPostProductionCollaboratorIds(i).includes(uid))
    .map(i => i._id);
  let hasNewAssignment = false;
  if (assignedIds.length) {
    const seen = await PostProductionAssignmentSeen.find({
      userId,
      itemId: { $in: assignedIds }
    }).select('itemId').lean();
    const seenSet = new Set(seen.map(s => s.itemId.toString()));
    hasNewAssignment = assignedIds.some(id => !seenSet.has(id.toString()));
  }

  return { hasNew: hasUnread || hasNewAssignment };
}

function formatPostProductionVersions(o) {
  const list = (o.versions || []).map(v => ({
    _id: v._id,
    url: v.url || '',
    name: v.name || '',
    description: v.description || '',
    addedByName: v.addedByName || '',
    createdAt: v.createdAt || null
  }));
  // Legacy single-link fallback (display only) when no versions recorded yet
  if (!list.length && o.latestVersionUrl) {
    list.push({
      _id: 'legacy',
      url: o.latestVersionUrl,
      name: '',
      description: '',
      addedByName: o.latestVersionByName || '',
      createdAt: o.latestVersionAt || null
    });
  }
  return list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

/** Move a legacy single-link (latestVersionUrl) into versions[] before mutating versions. */
function migrateLegacyPostProductionVersion(doc) {
  if ((!doc.versions || doc.versions.length === 0) && doc.latestVersionUrl) {
    doc.versions.push({
      url: doc.latestVersionUrl,
      name: '',
      description: '',
      addedById: doc.latestVersionById || null,
      addedByName: doc.latestVersionByName || '',
      createdAt: doc.latestVersionAt || new Date()
    });
  }
  if (doc.latestVersionUrl || doc.latestVersionAt || doc.latestVersionById || doc.latestVersionByName) {
    doc.latestVersionUrl = '';
    doc.latestVersionAt = null;
    doc.latestVersionById = null;
    doc.latestVersionByName = '';
  }
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function formatPostProductionItem(doc, usersById = {}, readOptions = {}) {
  const o = doc.toObject ? doc.toObject() : doc;
  const editorIds = getPostProductionEditorIds(o);
  const collaboratorIds = getPostProductionCollaboratorIds(o);
  const editors = formatPostProductionUserList(editorIds, usersById);
  const collaborators = formatPostProductionUserList(collaboratorIds, usersById);
  const firstEditor = editors[0] || null;
  const owner = o.ownerId ? usersById[o.ownerId.toString()] : null;
  const { updates, updateCount, latestUpdate } = formatPostProductionUpdates(o);
  const userId = readOptions.userId?.toString?.() || (readOptions.userId ? String(readOptions.userId) : null);
  const unreadUpdateCount = userId
    ? countUnreadPostProductionUpdates(updates, readOptions.lastReadAt ?? null, userId)
    : 0;
  return {
    _id: o._id,
    item: o.item || '',
    project: o.project || '',
    eventId: o.eventId || null,
    editStatus: o.editStatus || '',
    qcStatus: o.qcStatus || '',
    deliveryStatus: o.deliveryStatus || '',
    editorIds,
    editors,
    editorsSortName: postProductionUsersSortName(editors),
    editorId: editorIds[0] || null,
    editorName: firstEditor?.name || '',
    editorPhoto: firstEditor?.profilePhoto || null,
    collaboratorIds,
    collaborators,
    collaboratorsSortName: postProductionUsersSortName(collaborators),
    ownerId: o.ownerId || null,
    ownerName: owner?.fullName || owner?.email || '',
    ownerPhoto: owner?.profilePhoto || null,
    dueDate: o.dueDate || null,
    versions: formatPostProductionVersions(o),
    updates,
    updateCount,
    unreadUpdateCount,
    latestUpdate,
    completed: isPostProductionItemComplete(o),
    archived: !!o.archived,
    archivedAt: o.archivedAt || null,
    createdBy: o.createdBy,
    updatedBy: o.updatedBy,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt
  };
}

const PP_STATUS_LABELS = {
  editStatus: {
    '': '—',
    working: 'Working on it',
    awaiting_client: 'Awaiting Client',
    stuck: 'Stuck',
    done: 'Done'
  },
  qcStatus: {
    '': '—',
    needs_revision: 'Needs Revision',
    approved: 'Approved'
  },
  deliveryStatus: {
    '': '—',
    working: 'Working on it',
    awaiting_client: 'Awaiting Client',
    stuck: 'Stuck',
    done: 'Done'
  }
};

const PP_STATUS_FIELD_LABELS = {
  editStatus: 'Edit',
  qcStatus: 'QC',
  deliveryStatus: 'Delivery'
};

function ppStatusLabel(field, value) {
  const map = PP_STATUS_LABELS[field] || {};
  return map[value ?? ''] ?? (value || '—');
}

function ppIdStr(id) {
  return id ? id.toString() : null;
}

function postProductionPageUrl(itemId, extraParams = {}) {
  const appUrl = (process.env.APP_URL || 'https://beta.lumdash.app').replace(/\/$/, '');
  const id = ppIdStr(itemId);
  if (!id) return `${appUrl}/dashboard.html#post-production`;
  const params = new URLSearchParams({ itemId: id, ...extraParams });
  return `${appUrl}/dashboard.html#post-production?${params.toString()}`;
}

function normalizePostProductionMentionIds(body) {
  if (!Array.isArray(body.mentionIds)) return [];
  return [...new Set(body.mentionIds.map(String).filter(id => mongoose.Types.ObjectId.isValid(id)))];
}

function normalizePostProductionLinks(body) {
  const raw = body?.links;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw.slice(0, 10)) {
    const url = String(item?.url || item || '').trim();
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      out.push({
        url: parsed.href,
        label: String(item?.label || '').trim().slice(0, 200)
      });
    } catch (_) { /* skip invalid */ }
  }
  return out;
}

function normalizePostProductionAttachments(body) {
  const raw = body?.attachments;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 10).map(a => ({
    url: String(a?.url || '').trim(),
    originalName: String(a?.originalName || '').trim().slice(0, 255),
    fileType: String(a?.fileType || '').trim(),
    size: Math.max(0, Number(a?.size) || 0),
    cloudinaryPublicId: String(a?.cloudinaryPublicId || '').trim()
  })).filter(a => a.url);
}

function postProductionUpdatePreviewText(text, links, attachments) {
  const trimmed = String(text || '').trim();
  if (trimmed) return trimmed;
  if (links.length && attachments.length) return 'Shared links and attachments';
  if (links.length > 1) return `Shared ${links.length} links`;
  if (links.length === 1) return links[0].label || links[0].url;
  if (attachments.length > 1) return `Shared ${attachments.length} attachments`;
  if (attachments.length === 1) return attachments[0].originalName || 'Shared an attachment';
  return '';
}

const ppUpdateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf'
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: JPG, PNG, GIF, WebP, and PDF.'), false);
    }
  }
});

async function uploadPostProductionAttachment(file, itemId) {
  const mimetype = file.mimetype || '';
  const isImage = mimetype.startsWith('image/');
  const isPdf = mimetype === 'application/pdf';
  // Cloudinary rasterizes PDFs under the "image" resource type. Uploading them as
  // "raw" and then rewriting the URL to /image/upload/ produces a 404 because the
  // asset only exists under the raw resource type. Match the (working) documents
  // path: PDFs and images both go through resource_type "image".
  const resourceType = (isImage || isPdf) ? 'image' : 'raw';
  const cleanFilename = file.originalname.replace(/\.[^/.]+$/, '');
  const sanitizedFilename = cleanFilename.replace(/[^a-zA-Z0-9.-]/g, '_');

  const uploadResult = await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: resourceType,
        folder: `lumdash/post-production/${itemId}`,
        public_id: `${Date.now()}_${sanitizedFilename}`,
        use_filename: false,
        unique_filename: true,
        type: 'upload',
        access_mode: 'public'
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    uploadStream.end(file.buffer);
  });

  // Deliver the asset as-is. For image-resource PDFs the secure_url already ends
  // in .pdf and serves inline with the correct content type. Do NOT append
  // fl_attachment:false — Cloudinary interprets "false" as the download filename.
  return {
    url: sanitizePostProductionAttachmentUrl(uploadResult.secure_url),
    originalName: file.originalname,
    fileType: file.mimetype,
    size: file.size,
    cloudinaryPublicId: uploadResult.public_id
  };
}

// Strip the legacy fl_attachment:false transformation that caused PDFs to download
// with the filename "false"; leaves other URLs untouched.
function sanitizePostProductionAttachmentUrl(url) {
  if (typeof url !== 'string' || !url) return '';
  return url.replace('/fl_attachment:false/', '/');
}

async function sendPostProductionUpdateEmail(recipient, data) {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) return;
  const { isNotificationChannelEnabled } = require('./lib/userSettings');
  if (!isNotificationChannelEnabled(recipient, 'post_production_update', 'email')) return;
  const to = (recipient.email || '').trim().toLowerCase();
  if (!to) return;

  const {
    buildPostProductionUpdateSubject,
    buildPostProductionUpdateEmail,
    buildPostProductionUpdateText
  } = require('./emails/postProductionEmail');

  const payload = {
    recipientName: recipient.fullName || recipient.email,
    actorName: data.actorName,
    itemName: data.itemName,
    project: data.project,
    previewText: data.previewText,
    isReply: data.isReply,
    pageUrl: data.pageUrl
  };

  try {
    await sgMail.send({
      to,
      from: SENDGRID_FROM,
      subject: buildPostProductionUpdateSubject(payload),
      html: buildPostProductionUpdateEmail(payload),
      text: buildPostProductionUpdateText(payload)
    });
    console.log(`📧 Post production update email sent to ${to}`);
  } catch (err) {
    console.error(`📧 Post production update email failed for ${to}:`, err.response?.body || err.message || err);
  }
}

/**
 * Notify editor, assignee owner, and @mentioned users about a new update or reply.
 */
async function notifyPostProductionUpdate(doc, actorId, { isReply, previewText, mentionIds = [], updateTime = null }) {
  try {
    const actor = await User.findById(actorId).select('fullName email').lean();
    const actorName = actor?.fullName || actor?.email || 'Someone';
    const itemId = doc._id.toString();
    const itemName = doc.item || 'Deliverable';
    const project = doc.project || 'Unknown project';
    const pageUrl = postProductionPageUrl(itemId, { openUpdates: '1' });
    const link = { page: 'post-production', params: { itemId, openUpdates: true } };
    const actorStr = ppIdStr(actorId);
    const snippet = String(previewText || '').trim().slice(0, 280);

    const recipientIds = await getPostProductionUpdateRecipientIds(doc, actorId, mentionIds);
    if (!recipientIds.length) return;

    const recipients = await User.find({ _id: { $in: recipientIds } }).select('fullName email settings role').lean();
    const title = isReply ? 'New reply on post production item' : 'New update on post production item';
    const message = `${actorName} ${isReply ? 'replied on' : 'posted an update on'} "${itemName}": ${snippet}`;

    for (const recipient of recipients) {
      const rid = recipient._id.toString();
      await createNotification({
        recipientId: rid,
        type: 'post_production_update',
        title,
        message,
        link,
        actorId,
        eventId: doc.eventId ? doc.eventId.toString() : null,
        metadata: { itemId, isReply: !!isReply }
      });
      await sendPostProductionUpdateEmail(recipient, {
        actorName,
        itemName,
        project,
        previewText: snippet,
        isReply: !!isReply,
        pageUrl
      });
    }
  } catch (err) {
    console.error('Post production update notifications:', err);
  }
}

async function sendPostProductionAssignedEmail(recipient, data) {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) return;
  const { isNotificationChannelEnabled } = require('./lib/userSettings');
  if (!isNotificationChannelEnabled(recipient, 'post_production_assigned', 'email')) return;
  const to = (recipient.email || '').trim().toLowerCase();
  if (!to) return;

  const {
    buildPostProductionAssignedSubject,
    buildPostProductionAssignedEmail,
    buildPostProductionAssignedText
  } = require('./emails/postProductionEmail');

  const payload = {
    recipientName: recipient.fullName || recipient.email,
    actorName: data.actorName,
    itemName: data.itemName,
    project: data.project,
    role: data.role,
    pageUrl: data.pageUrl
  };

  try {
    await sgMail.send({
      to,
      from: SENDGRID_FROM,
      subject: buildPostProductionAssignedSubject(payload),
      html: buildPostProductionAssignedEmail(payload),
      text: buildPostProductionAssignedText(payload)
    });
    console.log(`📧 Post production assignment email sent to ${to}`);
  } catch (err) {
    console.error(`📧 Post production assignment email failed for ${to}:`, err.response?.body || err.message || err);
  }
}

async function sendPostProductionStatusChangedEmail(recipient, data) {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) return;
  const { isNotificationChannelEnabled } = require('./lib/userSettings');
  if (!isNotificationChannelEnabled(recipient, 'post_production_status_changed', 'email')) return;
  const to = (recipient.email || '').trim().toLowerCase();
  if (!to) return;

  const {
    buildPostProductionStatusChangedSubject,
    buildPostProductionStatusChangedEmail,
    buildPostProductionStatusChangedText
  } = require('./emails/postProductionEmail');

  const payload = {
    recipientName: recipient.fullName || recipient.email,
    actorName: data.actorName,
    itemName: data.itemName,
    project: data.project,
    changes: data.changes,
    pageUrl: data.pageUrl
  };

  try {
    await sgMail.send({
      to,
      from: SENDGRID_FROM,
      subject: buildPostProductionStatusChangedSubject(payload),
      html: buildPostProductionStatusChangedEmail(payload),
      text: buildPostProductionStatusChangedText(payload)
    });
    console.log(`📧 Post production status email sent to ${to}`);
  } catch (err) {
    console.error(`📧 Post production status email failed for ${to}:`, err.response?.body || err.message || err);
  }
}

/**
 * Notify assignees and owner about post production updates (non-blocking).
 * @param {Object|null} before - Prior state (null on create)
 * @param {Object} after - Saved item document
 * @param {string} actorId - User who made the change
 */
async function notifyPostProductionUpdates(before, after, actorId) {
  try {
    const actor = await User.findById(actorId).select('fullName email').lean();
    const actorName = actor?.fullName || actor?.email || 'Someone';
    const itemId = after._id.toString();
    const itemName = after.item || 'Deliverable';
    const project = after.project || 'Unknown project';
    const pageUrl = postProductionPageUrl(itemId);
    const link = { page: 'post-production', params: { itemId } };
    const actorStr = ppIdStr(actorId);

    const prevEditors = new Set(before ? (before.editorIds || []) : []);
    const prevCollaborators = new Set(before ? (before.collaboratorIds || []) : []);
    const prevOwner = before ? ppIdStr(before.ownerId) : null;
    const newEditorIds = getPostProductionEditorIds(after);
    const newCollaboratorIds = getPostProductionCollaboratorIds(after);
    const newOwner = ppIdStr(after.ownerId);

    const assignmentTargets = [];
    for (const userId of newEditorIds) {
      if (!prevEditors.has(userId) && userId !== actorStr) {
        assignmentTargets.push({ userId, role: 'editor' });
      }
    }
    for (const userId of newCollaboratorIds) {
      if (!prevCollaborators.has(userId) && userId !== actorStr) {
        assignmentTargets.push({ userId, role: 'collaborator' });
      }
    }
    if (newOwner && newOwner !== prevOwner && newOwner !== actorStr) {
      assignmentTargets.push({ userId: newOwner, role: 'owner' });
    }

    if (assignmentTargets.length) {
      const assigneeIds = assignmentTargets.map(t => t.userId);
      const assignees = await User.find({ _id: { $in: assigneeIds } }).select('fullName email settings role').lean();
      const assigneeById = {};
      assignees.forEach(u => { assigneeById[u._id.toString()] = u; });

      for (const target of assignmentTargets) {
        await markPostProductionAssignmentNew(target.userId, after._id);
        const roleLabel = target.role === 'owner'
          ? 'Owner'
          : (target.role === 'collaborator' ? 'Collaborator' : 'Editor');
        await createNotification({
          recipientId: target.userId,
          type: 'post_production_assigned',
          title: `Assigned as ${roleLabel}`,
          message: `${actorName} assigned you as ${roleLabel} on "${itemName}" (${project})`,
          link,
          actorId,
          eventId: after.eventId || null,
          metadata: { itemId, role: target.role }
        });

        const recipient = assigneeById[target.userId];
        if (recipient) {
          await sendPostProductionAssignedEmail(recipient, {
            actorName,
            itemName,
            project,
            role: target.role,
            pageUrl
          });
        }
      }
    }

    if (newOwner && newOwner !== actorStr) {
      const statusFields = ['editStatus', 'qcStatus', 'deliveryStatus'];
      const changes = [];
      for (const field of statusFields) {
        const fromVal = before ? (before[field] ?? '') : '';
        const toVal = after[field] ?? '';
        if (fromVal !== toVal) {
          changes.push({
            label: PP_STATUS_FIELD_LABELS[field],
            fromLabel: ppStatusLabel(field, fromVal),
            toLabel: ppStatusLabel(field, toVal)
          });
        }
      }

      if (changes.length) {
        const changeSummary = changes.map(c => `${c.label}: ${c.toLabel}`).join(', ');
        await createNotification({
          recipientId: newOwner,
          type: 'post_production_status_changed',
          title: 'Post production status updated',
          message: `${actorName} updated ${itemName}: ${changeSummary}`,
          link,
          actorId,
          eventId: after.eventId || null,
          metadata: { itemId, changes }
        });

        const owner = await User.findById(newOwner).select('fullName email settings role').lean();
        if (owner) {
          await sendPostProductionStatusChangedEmail(owner, {
            actorName,
            itemName,
            project,
            changes,
            pageUrl
          });
        }
      }
    }
  } catch (err) {
    console.error('🔔 Post production notifications failed:', err);
  }
}

async function getDashboardNavVisitedAt(userId, page) {
  const doc = await DashboardNavVisit.findOne({ userId, page }).select('visitedAt').lean();
  return doc?.visitedAt || null;
}

async function markDashboardNavVisited(userId, page) {
  const now = new Date();
  await DashboardNavVisit.findOneAndUpdate(
    { userId, page },
    { $set: { visitedAt: now } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return now;
}

async function userCanReviewAnyReimbursement(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const scope = await getReimbursementEventScope(user);
  return Array.isArray(scope) && scope.length > 0;
}

async function getFlightsSidebarIndicator(user) {
  if (!hasPlannerAccess(user)) return { hasNew: false };
  const visitedAt = await getDashboardNavVisitedAt(user.id, 'flights');
  const query = { status: { $in: ['pending', 'change_requested'] } };
  if (visitedAt) query.updatedAt = { $gt: visitedAt };
  const count = await FlightRequest.countDocuments(query);
  return { hasNew: count > 0 };
}

async function getReimbursementsSidebarIndicator(user) {
  if (!(await userCanReviewAnyReimbursement(user))) return { hasNew: false };
  const visitedAt = await getDashboardNavVisitedAt(user.id, 'reimbursements');
  const query = { status: 'submitted' };
  const eventScope = await getReimbursementEventScope(user);
  if (eventScope) query.eventId = { $in: eventScope };
  if (visitedAt) query.dateSubmitted = { $gt: visitedAt };
  const count = await ReimbursementRequest.countDocuments(query);
  return { hasNew: count > 0 };
}

app.get('/api/dashboard/sidebar-indicators', authenticate, async (req, res) => {
  try {
    const [postProduction, flights, reimbursements] = await Promise.all([
      getPostProductionSidebarIndicator(req.user),
      getFlightsSidebarIndicator(req.user),
      getReimbursementsSidebarIndicator(req.user)
    ]);
    res.json({
      postProduction: !!postProduction.hasNew,
      flights: !!flights.hasNew,
      reimbursements: !!reimbursements.hasNew
    });
  } catch (err) {
    console.error('Error fetching dashboard sidebar indicators:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/dashboard/sidebar-visited', authenticate, async (req, res) => {
  try {
    const page = String(req.body.page || '').trim();
    if (page === 'post-production') {
      await markPostProductionAssignmentsVisited(req.user, req.user.id);
      const indicator = await getPostProductionSidebarIndicator(req.user);
      return res.json({ page, hasNew: !!indicator.hasNew });
    }
    if (page === 'flights') {
      if (!hasPlannerAccess(req.user)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      await markDashboardNavVisited(req.user.id, 'flights');
      const indicator = await getFlightsSidebarIndicator(req.user);
      return res.json({ page, hasNew: !!indicator.hasNew });
    }
    if (page === 'reimbursements') {
      if (!(await userCanReviewAnyReimbursement(req.user))) {
        return res.status(403).json({ error: 'Access denied' });
      }
      await markDashboardNavVisited(req.user.id, 'reimbursements');
      const indicator = await getReimbursementsSidebarIndicator(req.user);
      return res.json({ page, hasNew: !!indicator.hasNew });
    }
    return res.status(400).json({ error: 'Invalid page' });
  } catch (err) {
    console.error('Error marking dashboard sidebar visited:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/post-production/sidebar-indicator', authenticate, async (req, res) => {
  try {
    const indicator = await getPostProductionSidebarIndicator(req.user);
    res.json(indicator);
  } catch (err) {
    console.error('Error fetching post production sidebar indicator:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/post-production/mark-visited', authenticate, async (req, res) => {
  try {
    await markPostProductionAssignmentsVisited(req.user, req.user.id);
    const indicator = await getPostProductionSidebarIndicator(req.user);
    res.json(indicator);
  } catch (err) {
    console.error('Error marking post production visited:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/post-production', authenticate, async (req, res) => {
  try {
    const { search, filter, sort, order } = req.query;
    const showArchived = filter === 'archived';
    const query = showArchived ? { archived: true } : { archived: { $ne: true } };
    const accessFilter = await buildPostProductionAccessFilter(req.user);
    if (accessFilter) {
      Object.assign(query, accessFilter);
    }
    let items = await PostProductionItem.find(query).lean();

    const usersById = await postProductionUsersById(items);
    const readMap = await postProductionLastReadMap(req.user.id, items.map(i => i._id));
    let rows = items.map(i => formatPostProductionItem(i, usersById, {
      userId: req.user.id,
      lastReadAt: readMap.get(i._id.toString()) || null
    }));

    // Attach linked video-portal projects (VideoProject.postProductionItemId → this row)
    if (rows.length) {
      const portalProjects = await VideoProject.find({
        postProductionItemId: { $in: rows.map(r => r._id) }
      }).select('_id title status postProductionItemId').lean();
      const portalByPp = {};
      portalProjects.forEach(p => {
        if (p.postProductionItemId) portalByPp[p.postProductionItemId.toString()] = p;
      });
      rows = rows.map(r => {
        const linked = portalByPp[r._id.toString()];
        return {
          ...r,
          portalProjectId: linked?._id || null,
          portalProjectTitle: linked?.title || '',
          portalProjectStatus: linked?.status || ''
        };
      });
    }

    const q = String(search || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter(r => {
        const updateText = (r.updates || []).flatMap(u => [
          u.text || '',
          ...(u.replies || []).map(rep => rep.text || '')
        ]).join(' ');
        return (
          (r.item || '').toLowerCase().includes(q) ||
          (r.project || '').toLowerCase().includes(q) ||
          (r.editorName || '').toLowerCase().includes(q) ||
          (r.editorsSortName || '').includes(q) ||
          (r.collaboratorsSortName || '').includes(q) ||
          (r.ownerName || '').toLowerCase().includes(q) ||
          updateText.toLowerCase().includes(q)
        );
      });
    }

    if (!showArchived) {
      if (filter === 'pending') {
        rows = rows.filter(r => !r.completed);
      } else if (filter === 'completed') {
        rows = rows.filter(r => r.completed);
      }
    }

    const sortField = sort || 'dueDate';
    const sortDir = order === 'desc' ? -1 : 1;
    const sortKey = {
      item: 'item',
      project: 'project',
      editStatus: 'editStatus',
      editorName: 'editorsSortName',
      collaboratorsSortName: 'collaboratorsSortName',
      qcStatus: 'qcStatus',
      deliveryStatus: 'deliveryStatus',
      ownerName: 'ownerName',
      dueDate: 'dueDate'
    }[sortField] || 'dueDate';

    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (sortKey === 'dueDate') {
        const aEmpty = !av;
        const bEmpty = !bv;
        if (aEmpty && !bEmpty) return 1;
        if (!aEmpty && bEmpty) return -1;
        if (aEmpty && bEmpty) return 0;
        return sortDir * (new Date(av) - new Date(bv));
      }
      const as = (av == null ? '' : String(av)).toLowerCase();
      const bs = (bv == null ? '' : String(bv)).toLowerCase();
      if (as < bs) return -1 * sortDir;
      if (as > bs) return 1 * sortDir;
      return 0;
    });

    let canCreate = isPostProductionAdmin(req.user);
    if (!canCreate) {
      const ownedEvent = await Table.findOne({ owners: req.user.id }).select('_id').lean();
      canCreate = !!ownedEvent;
    }

    res.json({
      items: rows,
      permissions: {
        isAdmin: isPostProductionAdmin(req.user),
        canCreate
      }
    });
  } catch (err) {
    console.error('Error fetching post production items:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/post-production/project-suggestions', authenticate, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    let query = {};
    if (!isPostProductionAdmin(req.user)) {
      query = { owners: req.user.id };
    }
    const tables = await Table.find(query).select('title').sort({ title: 1 }).lean();
    let list = tables.map(t => ({ eventId: t._id, title: t.title }));
    if (q) {
      const lower = q.toLowerCase();
      list = list.filter(t => (t.title || '').toLowerCase().includes(lower));
    }
    res.json(list.slice(0, 20));
  } catch (err) {
    console.error('Error fetching project suggestions:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/post-production', authenticate, async (req, res) => {
  try {
    if (!(await canCreatePostProductionItem(req.user, req.body))) {
      return res.status(403).json({
        error: 'You can only create items for events you own. Admins can create for any project.'
      });
    }

    const resolved = await resolvePostProductionProject(req.body.project, req.body.eventId);

    const editorIds = normalizePostProductionUserIds(req.body.editorIds
      || (req.body.editorId ? [req.body.editorId] : []));
    const collaboratorIds = normalizePostProductionUserIds(req.body.collaboratorIds || []);

    const doc = await PostProductionItem.create({
      item: String(req.body.item || '').trim(),
      project: resolved.project,
      eventId: resolved.eventId,
      editStatus: req.body.editStatus || '',
      qcStatus: req.body.qcStatus || '',
      deliveryStatus: req.body.deliveryStatus || '',
      editorIds,
      collaboratorIds,
      editorId: editorIds[0] || null,
      ownerId: req.body.ownerId || null,
      dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
      updates: [],
      notes: [],
      createdBy: req.user.id,
      updatedBy: req.user.id
    });

    const usersById = await postProductionUsersById(doc);
    notifyPostProductionUpdates(null, doc, req.user.id).catch(err =>
      console.error('Post production create notifications:', err)
    );
    const read = await PostProductionUpdateRead.findOne({ userId: req.user.id, itemId: doc._id }).select('lastReadAt').lean();
    res.status(201).json(formatPostProductionItem(doc, usersById, {
      userId: req.user.id,
      lastReadAt: read?.lastReadAt || null
    }));
  } catch (err) {
    console.error('Error creating post production item:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

async function duplicatePostProductionItem(source, userId) {
  const updates = (source.updates || []).map(u => ({
    text: u.text || '',
    authorId: u.authorId,
    authorName: u.authorName,
    mentionIds: u.mentionIds || [],
    links: u.links || [],
    attachments: u.attachments || [],
    createdAt: u.createdAt || new Date(),
    replies: (u.replies || []).map(r => ({
      text: r.text,
      authorId: r.authorId,
      authorName: r.authorName,
      mentionIds: r.mentionIds || [],
      links: r.links || [],
      attachments: r.attachments || [],
      createdAt: r.createdAt || new Date()
    }))
  }));
  const itemName = String(source.item || '').trim();
  const editorIds = getPostProductionEditorIds(source);
  const collaboratorIds = getPostProductionCollaboratorIds(source);
  return PostProductionItem.create({
    item: itemName ? `${itemName} (copy)` : 'Copy',
    project: source.project || '',
    eventId: source.eventId || null,
    editStatus: source.editStatus || '',
    qcStatus: source.qcStatus || '',
    deliveryStatus: source.deliveryStatus || '',
    editorIds,
    collaboratorIds,
    editorId: editorIds[0] || null,
    ownerId: source.ownerId || null,
    dueDate: source.dueDate || null,
    updates,
    notes: [],
    archived: false,
    archivedAt: null,
    createdBy: userId,
    updatedBy: userId
  });
}

app.post('/api/post-production/bulk', authenticate, async (req, res) => {
  try {
    const action = String(req.body.action || '').trim();
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: 'No items selected' });

    const objectIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id));
    if (!objectIds.length) return res.status(400).json({ error: 'Invalid item ids' });

    const docs = await PostProductionItem.find({ _id: { $in: objectIds } });
    if (!docs.length) return res.status(404).json({ error: 'No items found' });

    if (action === 'delete') {
      if (!isPostProductionAdmin(req.user)) {
        return res.status(403).json({ error: 'Only admins can delete post production items' });
      }
      await PostProductionItem.deleteMany({ _id: { $in: objectIds } });
      return res.json({ action, affected: docs.length });
    }

    const accessibleDocs = [];
    for (const doc of docs) {
      if (await canAccessPostProductionItem(req.user, doc)) accessibleDocs.push(doc);
    }
    if (!accessibleDocs.length) {
      return res.status(403).json({ error: 'You do not have access to the selected items' });
    }
    const accessibleIds = accessibleDocs.map(d => d._id);

    if (action === 'archive') {
      const result = await PostProductionItem.updateMany(
        { _id: { $in: accessibleIds } },
        { $set: { archived: true, archivedAt: new Date(), updatedBy: req.user.id } }
      );
      return res.json({
        action,
        affected: result.modifiedCount,
        skipped: docs.length - accessibleDocs.length
      });
    }

    if (action === 'restore') {
      const result = await PostProductionItem.updateMany(
        { _id: { $in: accessibleIds } },
        { $set: { archived: false, archivedAt: null, updatedBy: req.user.id } }
      );
      return res.json({
        action,
        affected: result.modifiedCount,
        skipped: docs.length - accessibleDocs.length
      });
    }

    if (action === 'duplicate') {
      const created = [];
      for (const doc of accessibleDocs) {
        if (doc.archived) continue;
        const canCreate = await canCreatePostProductionItem(req.user, {
          project: doc.project,
          eventId: doc.eventId
        });
        if (!canCreate) continue;
        const copy = await duplicatePostProductionItem(doc, req.user.id);
        created.push(copy);
        notifyPostProductionUpdates(null, copy, req.user.id).catch(err =>
          console.error('Post production duplicate notifications:', err)
        );
      }
      const usersById = await postProductionUsersById(created);
      const readMap = await postProductionLastReadMap(req.user.id, created.map(c => c._id));
      return res.json({
        action,
        affected: created.length,
        skipped: docs.length - created.length,
        items: created.map(c => formatPostProductionItem(c, usersById, {
          userId: req.user.id,
          lastReadAt: readMap.get(c._id.toString()) || null
        }))
      });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    console.error('Post production bulk action:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/post-production/:id', authenticate, async (req, res) => {
  try {
    const doc = await PostProductionItem.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Item not found' });
    if (!(await canAccessPostProductionItem(req.user, doc))) {
      return res.status(403).json({ error: 'You do not have access to this item' });
    }
    const usersById = await postProductionUsersById([doc]);
    const read = await PostProductionUpdateRead.findOne({ userId: req.user.id, itemId: doc._id }).select('lastReadAt').lean();
    res.json(formatPostProductionItem(doc, usersById, {
      userId: req.user.id,
      lastReadAt: read?.lastReadAt || null
    }));
  } catch (err) {
    console.error('Error fetching post production item:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/post-production/:id', authenticate, async (req, res) => {
  try {
    const doc = await PostProductionItem.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Item not found' });
    if (!(await canAccessPostProductionItem(req.user, doc))) {
      return res.status(403).json({ error: 'You do not have access to this item' });
    }

    const before = {
      editorIds: getPostProductionEditorIds(doc),
      collaboratorIds: getPostProductionCollaboratorIds(doc),
      ownerId: doc.ownerId,
      editStatus: doc.editStatus,
      qcStatus: doc.qcStatus,
      deliveryStatus: doc.deliveryStatus,
      item: doc.item,
      project: doc.project,
      eventId: doc.eventId
    };

    if (req.body.item != null) doc.item = String(req.body.item).trim();
    if (req.body.editStatus != null) doc.editStatus = req.body.editStatus;
    if (req.body.qcStatus != null) doc.qcStatus = req.body.qcStatus;
    if (req.body.deliveryStatus != null) doc.deliveryStatus = req.body.deliveryStatus;

    const reassignFields = ['editorIds', 'collaboratorIds', 'editorId', 'ownerId'];
    const hasReassign = reassignFields.some(f => req.body[f] !== undefined);
    if (hasReassign) {
      const canReassign = isPostProductionAdmin(req.user)
        || (doc.eventId && await userOwnsPostProductionEvent(req.user.id, doc.eventId));
      if (!canReassign) {
        return res.status(403).json({
          error: 'Only admins and event owners can change editor, collaborator, or owner assignments'
        });
      }
      if (req.body.editorIds !== undefined) {
        doc.editorIds = normalizePostProductionUserIds(req.body.editorIds);
      } else if (req.body.editorId !== undefined) {
        doc.editorIds = req.body.editorId ? [req.body.editorId] : [];
      }
      if (req.body.collaboratorIds !== undefined) {
        doc.collaboratorIds = normalizePostProductionUserIds(req.body.collaboratorIds);
      }
      if (req.body.ownerId !== undefined) doc.ownerId = req.body.ownerId || null;
      syncPostProductionAssigneeFields(doc);
    }

    if (req.body.project != null || req.body.eventId !== undefined) {
      const resolved = await resolvePostProductionProject(
        req.body.project != null ? req.body.project : doc.project,
        req.body.eventId !== undefined ? req.body.eventId : doc.eventId
      );
      if (!(await canEditPostProductionProject(req.user, resolved))) {
        return res.status(403).json({
          error: 'You can only set the project to an event you own. Admins can use any project.'
        });
      }
      doc.project = resolved.project;
      doc.eventId = resolved.eventId;
    }

    if (req.body.dueDate !== undefined) {
      doc.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
    }

    doc.updatedBy = req.user.id;
    await doc.save();

    notifyPostProductionUpdates(before, doc, req.user.id).catch(err =>
      console.error('Post production update notifications:', err)
    );

    const usersById = await postProductionUsersById(doc);
    const read = await PostProductionUpdateRead.findOne({ userId: req.user.id, itemId: doc._id }).select('lastReadAt').lean();
    res.json(formatPostProductionItem(doc, usersById, {
      userId: req.user.id,
      lastReadAt: read?.lastReadAt || null
    }));
  } catch (err) {
    console.error('Error updating post production item:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add a version link to an item's history (owner/editor/collaborator/admin/event owner)
app.post('/api/post-production/:id/versions', authenticate, async (req, res) => {
  try {
    const doc = await PostProductionItem.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Item not found' });
    if (!(await canAccessPostProductionItem(req.user, doc))) {
      return res.status(403).json({ error: 'You do not have access to this item' });
    }

    const url = String(req.body.url || '').trim();
    if (!isValidHttpUrl(url)) {
      return res.status(400).json({ error: 'Enter a valid http or https link' });
    }
    const name = String(req.body.name || '').trim().slice(0, 200);
    const description = String(req.body.description || '').trim().slice(0, 2000);

    migrateLegacyPostProductionVersion(doc);

    const versionUser = await User.findById(req.user.id).select('fullName email').lean();
    doc.versions.push({
      url,
      name,
      description,
      addedById: req.user.id,
      addedByName: versionUser?.fullName || versionUser?.email || 'Unknown',
      createdAt: new Date()
    });
    doc.updatedBy = req.user.id;
    await doc.save();

    const usersById = await postProductionUsersById(doc);
    const read = await PostProductionUpdateRead.findOne({ userId: req.user.id, itemId: doc._id }).select('lastReadAt').lean();
    res.status(201).json(formatPostProductionItem(doc, usersById, {
      userId: req.user.id,
      lastReadAt: read?.lastReadAt || null
    }));
  } catch (err) {
    console.error('Error adding post production version:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove a version link from an item's history
app.delete('/api/post-production/:id/versions/:versionId', authenticate, async (req, res) => {
  try {
    const doc = await PostProductionItem.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Item not found' });
    if (!(await canAccessPostProductionItem(req.user, doc))) {
      return res.status(403).json({ error: 'You do not have access to this item' });
    }

    migrateLegacyPostProductionVersion(doc);

    const exists = doc.versions.id(req.params.versionId);
    if (!exists) return res.status(404).json({ error: 'Version not found' });
    doc.versions.pull({ _id: req.params.versionId });
    doc.updatedBy = req.user.id;
    await doc.save();

    const usersById = await postProductionUsersById(doc);
    const read = await PostProductionUpdateRead.findOne({ userId: req.user.id, itemId: doc._id }).select('lastReadAt').lean();
    res.json(formatPostProductionItem(doc, usersById, {
      userId: req.user.id,
      lastReadAt: read?.lastReadAt || null
    }));
  } catch (err) {
    console.error('Error removing post production version:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/post-production/:id/updates/attachments', authenticate, ppUpdateUpload.single('file'), async (req, res) => {
  try {
    const doc = await PostProductionItem.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Item not found' });
    if (!(await canAccessPostProductionItem(req.user, doc))) {
      return res.status(403).json({ error: 'You do not have access to this item' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const attachment = await uploadPostProductionAttachment(req.file, doc._id.toString());
    res.json({ attachment });
  } catch (err) {
    console.error('Error uploading post production attachment:', err);
    res.status(500).json({ error: err.message || 'Failed to upload attachment' });
  }
});

app.post('/api/post-production/:id/updates/mark-read', authenticate, async (req, res) => {
  try {
    const doc = await PostProductionItem.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Item not found' });
    if (!(await canAccessPostProductionItem(req.user, doc))) {
      return res.status(403).json({ error: 'You do not have access to this item' });
    }

    const lastReadAt = await markPostProductionUpdatesRead(req.user.id, doc._id);
    res.json({ unreadUpdateCount: 0, lastReadAt });
  } catch (err) {
    console.error('Error marking post production updates read:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/post-production/:id/updates', authenticate, async (req, res) => {
  try {
    const text = String(req.body.text || '').trim();
    const links = normalizePostProductionLinks(req.body);
    const attachments = normalizePostProductionAttachments(req.body);
    if (!text && !links.length && !attachments.length) {
      return res.status(400).json({ error: 'Add a message, link, or attachment' });
    }

    const doc = await PostProductionItem.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Item not found' });
    if (!(await canAccessPostProductionItem(req.user, doc))) {
      return res.status(403).json({ error: 'You do not have access to this item' });
    }

    const user = await User.findById(req.user.id).select('fullName email').lean();
    const authorName = user?.fullName || user?.email || 'Unknown';
    const mentionIds = normalizePostProductionMentionIds(req.body);
    const parentUpdateId = req.body.parentUpdateId ? String(req.body.parentUpdateId) : null;
    const updateTime = new Date();
    const previewText = postProductionUpdatePreviewText(text, links, attachments);

    const entryPayload = {
      text,
      authorId: req.user.id,
      authorName,
      mentionIds,
      links,
      attachments,
      createdAt: updateTime
    };

    if (parentUpdateId) {
      const parent = doc.updates.id(parentUpdateId);
      if (!parent) return res.status(404).json({ error: 'Update not found' });
      parent.replies.push(entryPayload);
    } else {
      doc.updates.push({ ...entryPayload, replies: [] });
    }

    doc.updatedBy = req.user.id;
    await doc.save();

    await bumpPostProductionUnreadForRecipients(doc, req.user.id, mentionIds, updateTime);

    notifyPostProductionUpdate(doc, req.user.id, {
      isReply: !!parentUpdateId,
      previewText,
      mentionIds,
      updateTime
    }).catch(err => console.error('Post production update notifications:', err));

    const usersById = await postProductionUsersById(doc);
    const read = await PostProductionUpdateRead.findOne({ userId: req.user.id, itemId: doc._id }).select('lastReadAt').lean();
    res.json(formatPostProductionItem(doc, usersById, {
      userId: req.user.id,
      lastReadAt: read?.lastReadAt || null
    }));
  } catch (err) {
    console.error('Error adding post production update:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Only the author of an entry (or a post-production admin) may edit/delete it.
function canManagePostProductionEntry(user, entry) {
  if (!entry) return false;
  if (isPostProductionAdmin(user)) return true;
  const authorId = entry.authorId ? String(entry.authorId) : '';
  return !!authorId && authorId === String(user.id);
}

async function respondWithPostProductionItem(req, res, doc) {
  doc.updatedBy = req.user.id;
  await doc.save();
  const usersById = await postProductionUsersById(doc);
  const read = await PostProductionUpdateRead.findOne({ userId: req.user.id, itemId: doc._id }).select('lastReadAt').lean();
  res.json(formatPostProductionItem(doc, usersById, {
    userId: req.user.id,
    lastReadAt: read?.lastReadAt || null
  }));
}

// Apply an edit to an update/reply subdocument. Text is always updated; links,
// attachments and mentions are only touched when included in the request body.
function applyPostProductionEntryEdit(entry, req) {
  if (req.body.text !== undefined) entry.text = String(req.body.text || '').trim();
  if (req.body.text !== undefined || req.body.mentionIds !== undefined) {
    entry.mentionIds = normalizePostProductionMentionIds(req.body);
  }
  if (req.body.links !== undefined) entry.links = normalizePostProductionLinks(req.body);
  if (req.body.attachments !== undefined) entry.attachments = normalizePostProductionAttachments(req.body);
  entry.editedAt = new Date();
}

function postProductionEntryIsEmpty(entry) {
  return !String(entry.text || '').trim()
    && !(entry.links || []).length
    && !(entry.attachments || []).length;
}

// Edit an update
app.put('/api/post-production/:id/updates/:updateId', authenticate, async (req, res) => {
  try {
    const doc = await PostProductionItem.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Item not found' });
    if (!(await canAccessPostProductionItem(req.user, doc))) {
      return res.status(403).json({ error: 'You do not have access to this item' });
    }
    const update = doc.updates.id(req.params.updateId);
    if (!update) return res.status(404).json({ error: 'Update not found' });
    if (!canManagePostProductionEntry(req.user, update)) {
      return res.status(403).json({ error: 'You can only edit your own updates' });
    }
    applyPostProductionEntryEdit(update, req);
    if (postProductionEntryIsEmpty(update)) {
      return res.status(400).json({ error: 'An update needs a message, link, or attachment' });
    }
    await respondWithPostProductionItem(req, res, doc);
  } catch (err) {
    console.error('Error editing post production update:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete an update
app.delete('/api/post-production/:id/updates/:updateId', authenticate, async (req, res) => {
  try {
    const doc = await PostProductionItem.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Item not found' });
    if (!(await canAccessPostProductionItem(req.user, doc))) {
      return res.status(403).json({ error: 'You do not have access to this item' });
    }
    const update = doc.updates.id(req.params.updateId);
    if (!update) return res.status(404).json({ error: 'Update not found' });
    if (!canManagePostProductionEntry(req.user, update)) {
      return res.status(403).json({ error: 'You can only delete your own updates' });
    }
    if ((update.replies || []).length) {
      // Preserve the thread (and others' replies): tombstone instead of removing.
      update.deleted = true;
      update.deletedAt = new Date();
      update.text = '';
      update.links = [];
      update.attachments = [];
      update.mentionIds = [];
    } else {
      update.deleteOne();
    }
    await respondWithPostProductionItem(req, res, doc);
  } catch (err) {
    console.error('Error deleting post production update:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Edit a reply
app.put('/api/post-production/:id/updates/:updateId/replies/:replyId', authenticate, async (req, res) => {
  try {
    const doc = await PostProductionItem.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Item not found' });
    if (!(await canAccessPostProductionItem(req.user, doc))) {
      return res.status(403).json({ error: 'You do not have access to this item' });
    }
    const update = doc.updates.id(req.params.updateId);
    if (!update) return res.status(404).json({ error: 'Update not found' });
    const reply = update.replies.id(req.params.replyId);
    if (!reply) return res.status(404).json({ error: 'Reply not found' });
    if (!canManagePostProductionEntry(req.user, reply)) {
      return res.status(403).json({ error: 'You can only edit your own replies' });
    }
    applyPostProductionEntryEdit(reply, req);
    if (postProductionEntryIsEmpty(reply)) {
      return res.status(400).json({ error: 'A reply needs a message, link, or attachment' });
    }
    await respondWithPostProductionItem(req, res, doc);
  } catch (err) {
    console.error('Error editing post production reply:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a reply
app.delete('/api/post-production/:id/updates/:updateId/replies/:replyId', authenticate, async (req, res) => {
  try {
    const doc = await PostProductionItem.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Item not found' });
    if (!(await canAccessPostProductionItem(req.user, doc))) {
      return res.status(403).json({ error: 'You do not have access to this item' });
    }
    const update = doc.updates.id(req.params.updateId);
    if (!update) return res.status(404).json({ error: 'Update not found' });
    const reply = update.replies.id(req.params.replyId);
    if (!reply) return res.status(404).json({ error: 'Reply not found' });
    if (!canManagePostProductionEntry(req.user, reply)) {
      return res.status(403).json({ error: 'You can only delete your own replies' });
    }
    reply.deleteOne();
    // If this was the last reply on a tombstoned update, clean up the tombstone.
    if (update.deleted && !(update.replies || []).length) {
      update.deleteOne();
    }
    await respondWithPostProductionItem(req, res, doc);
  } catch (err) {
    console.error('Error deleting post production reply:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/post-production/:id', authenticate, async (req, res) => {
  try {
    if (!isPostProductionAdmin(req.user)) {
      return res.status(403).json({ error: 'Only admins can delete post production items' });
    }
    const doc = await PostProductionItem.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Item not found' });
    await VideoProject.updateMany(
      { postProductionItemId: doc._id },
      { $set: { postProductionItemId: null } }
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Error deleting post production item:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Link / unlink a Video Portal project to this post-production item
app.put('/api/post-production/:id/portal-project', authenticate, async (req, res) => {
  try {
    const item = await PostProductionItem.findById(req.params.id).select('_id item project archived');
    if (!item || item.archived) return res.status(404).json({ error: 'Item not found' });

    const rawId = req.body.videoProjectId;
    // Unlink
    if (rawId === null || rawId === '' || rawId === undefined) {
      await VideoProject.updateMany(
        { postProductionItemId: item._id },
        { $set: { postProductionItemId: null } }
      );
      return res.json({
        portalProjectId: null,
        portalProjectTitle: '',
        portalProjectStatus: ''
      });
    }

    const project = await VideoProject.findById(rawId);
    if (!project) return res.status(404).json({ error: 'Video portal project not found' });

    // One PP item ↔ one portal project
    await VideoProject.updateMany(
      {
        $or: [
          { postProductionItemId: item._id },
          { _id: project._id }
        ]
      },
      { $set: { postProductionItemId: null } }
    );
    project.postProductionItemId = item._id;
    await project.save();

    res.json({
      portalProjectId: project._id,
      portalProjectTitle: project.title || '',
      portalProjectStatus: project.status || ''
    });
  } catch (err) {
    console.error('Error linking portal project to post-production:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ========= REIMBURSEMENT REQUESTS API =========

// List reimbursement requests (admins + event owners, excludes drafts)
app.get('/api/reimbursements', authenticate, async (req, res) => {
  try {
    const eventScope = await getReimbursementEventScope(req.user);
    if (Array.isArray(eventScope) && eventScope.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { status, eventId, userId, sort } = req.query;
    const query = { status: { $ne: 'draft' } };
    if (eventScope) {
      if (eventId) {
        const allowed = eventScope.some(id => id.toString() === eventId);
        if (!allowed) return res.status(403).json({ error: 'Access denied' });
        query.eventId = eventId;
      } else {
        query.eventId = { $in: eventScope };
      }
    } else if (eventId) {
      query.eventId = eventId;
    }
    if (status && status !== 'all') query.status = status;
    if (userId) query.userId = userId;

    let sortObj = { dateSubmitted: -1 };
    if (sort === 'date_asc') sortObj = { dateSubmitted: 1 };
    else if (sort === 'date_desc') sortObj = { dateSubmitted: -1 };
    else if (sort === 'amount_desc') sortObj = { totalAmount: -1 };
    else if (sort === 'amount_asc') sortObj = { totalAmount: 1 };

    let requests = await ReimbursementRequest.find(query).sort(sortObj).lean();

    // Catch missed submission alerts (debounced — max once per 5 min)
    reconcileUnnotifiedReimbursementSubmissions().catch(err =>
      console.error('📋 Reimbursement reconcile on list failed:', err)
    );

    // Backfill userName/userEmail from the users collection for any docs missing them
    const needsUser = requests.filter(r => !r.userName && r.userId);
    if (needsUser.length > 0) {
      const userIds = [...new Set(needsUser.map(r => r.userId.toString()))];
      const users = await User.find({ _id: { $in: userIds } }, 'fullName email').lean();
      const userMap = {};
      users.forEach(u => { userMap[u._id.toString()] = u; });
      requests = requests.map(r => {
        if (!r.userName && r.userId) {
          const u = userMap[r.userId.toString()];
          if (u) {
            r.userName = u.fullName || u.email || '—';
            r.userEmail = r.userEmail || u.email || '';
          }
        }
        return r;
      });
    }

    await enrichReimbursements(requests);

    res.json(requests);
  } catch (err) {
    console.error('Error fetching reimbursements:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single reimbursement request detail
app.get('/api/reimbursements/:id', authenticate, async (req, res) => {
  try {
    const request = await ReimbursementRequest.findById(req.params.id).lean();
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status === 'draft') return res.status(404).json({ error: 'Request not found' });
    if (!(await canReviewReimbursements(req.user, request))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Backfill userName/userEmail if missing
    if (!request.userName && request.userId) {
      const user = await User.findById(request.userId, 'fullName email').lean();
      if (user) {
        request.userName = user.fullName || user.email || '—';
        request.userEmail = request.userEmail || user.email || '';
      }
    }

    await enrichReimbursements(request);

    res.json(request);
  } catch (err) {
    console.error('Error fetching reimbursement:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Approve reimbursement request
app.put('/api/reimbursements/:id/approve', authenticate, async (req, res) => {
  try {
    const request = await ReimbursementRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!(await canReviewReimbursements(req.user, request))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (request.status !== 'submitted') {
      return res.status(400).json({ error: `Cannot approve a request with status "${request.status}"` });
    }

    request.status = 'approved';
    request.reviewedBy = req.user.id;
    request.reviewedByName = req.user.fullName || '';
    request.reviewedAt = new Date();
    request.reviewNotes = req.body.reviewNotes || '';
    await request.save();

    try {
      await sendReimbursementApprovedEmail(request);
    } catch (emailErr) {
      console.error('📧 Reimbursement approved email failed (request still approved):', emailErr);
    }

    res.json({ message: 'Request approved', request });
  } catch (err) {
    console.error('Error approving reimbursement:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reject reimbursement request
app.put('/api/reimbursements/:id/reject', authenticate, async (req, res) => {
  try {
    const request = await ReimbursementRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!(await canReviewReimbursements(req.user, request))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (request.status !== 'submitted') {
      return res.status(400).json({ error: `Cannot reject a request with status "${request.status}"` });
    }
    if (!req.body.reviewNotes) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    request.status = 'rejected';
    request.reviewedBy = req.user.id;
    request.reviewedByName = req.user.fullName || '';
    request.reviewedAt = new Date();
    request.reviewNotes = req.body.reviewNotes;
    await request.save();

    res.json({ message: 'Request rejected', request });
  } catch (err) {
    console.error('Error rejecting reimbursement:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get unique events and users for filter dropdowns
app.get('/api/reimbursements-filters', authenticate, async (req, res) => {
  try {
    const eventScope = await getReimbursementEventScope(req.user);
    if (Array.isArray(eventScope) && eventScope.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const scopeFilter = { status: { $ne: 'draft' } };
    if (eventScope) scopeFilter.eventId = { $in: eventScope };

    const [events, storedNames] = await Promise.all([
      ReimbursementRequest.distinct('eventName', scopeFilter),
      ReimbursementRequest.distinct('userName', scopeFilter)
    ]);

    let userNames = storedNames.filter(Boolean);

    // If most docs lack userName, resolve from userId
    if (userNames.length === 0) {
      const userIds = await ReimbursementRequest.distinct('userId', scopeFilter);
      if (userIds.length > 0) {
        const usersFromDb = await User.find({ _id: { $in: userIds } }, 'fullName').lean();
        userNames = usersFromDb.map(u => u.fullName).filter(Boolean);
      }
    }

    res.json({ events: events.filter(Boolean).sort(), users: userNames.sort() });
  } catch (err) {
    console.error('Error fetching reimbursement filters:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Webhook for external reimbursement app to trigger notifications (optional secret)
app.post('/api/reimbursements/submitted-hook', async (req, res) => {
  try {
    const secret = req.headers['x-reimbursement-hook-secret'] || req.body?.secret;
    if (process.env.REIMBURSEMENT_HOOK_SECRET && secret !== process.env.REIMBURSEMENT_HOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const requestId = req.body?.requestId || req.body?._id;
    if (!requestId) {
      return res.status(400).json({ error: 'requestId is required' });
    }

    const request = await ReimbursementRequest.findById(requestId).lean();
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'submitted') {
      return res.status(400).json({ error: 'Request is not submitted' });
    }

    await notifyReimbursementSubmitted(request);
    res.json({ message: 'Notifications sent (duplicates skipped if already sent)', requestId: request._id.toString() });
  } catch (err) {
    console.error('Reimbursement submitted-hook error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete reimbursement request (admin only)
app.delete('/api/reimbursements/:id', authenticate, async (req, res) => {
  try {
    if (!/^admin$/i.test(req.user.role || '')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const requestId = req.params.id;
    const request = await ReimbursementRequest.findByIdAndDelete(requestId);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    await Notification.deleteMany({
      $or: [
        { 'metadata.reimbursementId': requestId },
        { 'link.params.reimbursementId': requestId }
      ]
    });

    console.log(`📋 Reimbursement deleted by admin ${req.user.id}: ${requestId}`);
    res.json({ message: 'Reimbursement deleted' });
  } catch (err) {
    console.error('Error deleting reimbursement:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Resend reimbursement notifications (admin only — for testing or missed alerts)
app.post('/api/reimbursements/:id/resend-notifications', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const request = await ReimbursementRequest.findById(req.params.id).lean();
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status === 'draft') {
      return res.status(400).json({ error: 'Cannot notify for draft requests' });
    }
    await notifyReimbursementSubmitted(request, { force: true });
    res.json({ message: 'Notifications resent' });
  } catch (err) {
    console.error('Error resending reimbursement notifications:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ========= END REIMBURSEMENT REQUESTS API =========

// SERVER
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server started on port ${PORT}`));

// --- SHARE TABLE WITH USER (OWNER/LEAD/SHARED) ---
app.post('/api/tables/:id/share', authenticate, async (req, res) => {
  const { email, makeOwner, makeLead, unshare } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const table = await Table.findById(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });

  // Handle unshare: remove from sharedWith and leads (and owners if present, but only if not last owner)
  if (unshare) {
    table.sharedWith = table.sharedWith.filter(id => !id.equals(user._id));
    table.leads = table.leads.filter(id => !id.equals(user._id));
    // Only remove from owners if more than one owner remains
    if (table.owners.includes(user._id) && table.owners.length > 1) {
      table.owners = table.owners.filter(id => !id.equals(user._id));
    }
    await table.save();
    notifyDataChange('tableUpdated', { tableId: table._id });
    return res.json({ message: 'User unshared from event.' });
  }

  // Add as owner if requested
  if (makeOwner && !table.owners.includes(user._id)) {
    table.owners.push(user._id);
    // Remove from leads/sharedWith if promoted
    table.leads = table.leads.filter(id => !id.equals(user._id));
    table.sharedWith = table.sharedWith.filter(id => !id.equals(user._id));
  } else if (makeLead && !table.leads.includes(user._id)) {
    table.leads.push(user._id);
  } else if (!table.sharedWith.includes(user._id)) {
    table.sharedWith.push(user._id);
  }

  await table.save();
  notifyDataChange('tableUpdated', { tableId: table._id });

  // 🔔 In-app notification for the shared user
  if (user._id.toString() !== req.user.id) {
    const roleLabel = makeOwner ? 'owner' : makeLead ? 'lead' : 'collaborator';
    createNotification({
      recipientId: user._id,
      type: 'event_shared',
      title: `Added to event as ${roleLabel}`,
      message: `You were added to "${table.title || 'an event'}"`,
      link: { page: 'general', eventId: req.params.id },
      actorId: req.user.id,
      eventId: req.params.id,
      metadata: { role: roleLabel }
    });
  }

  // Send notification email to the user
  try {
    const { isNotificationChannelEnabled } = require('./lib/userSettings');
    const userPrefs = await User.findById(user._id).select('settings role email fullName').lean();
    if (userPrefs && !isNotificationChannelEnabled(userPrefs, 'event_shared', 'email')) {
      console.log(`📧 Event shared email skipped (user pref): ${user.email}`);
    } else if (process.env.SENDGRID_FROM_EMAIL) {
      let subject = 'You have been added to an event in LumDash';
      let html = `<p>Hello ${user.fullName || user.email},</p>`;
      if (makeOwner) {
        html += `<p>You have been made an <b>owner</b> of the event: <b>${table.title}</b>.</p>`;
      } else if (makeLead) {
        html += `<p>You have been given <b>lead access</b> to the event: <b>${table.title}</b>.<br>
        This gives you full schedule access for this event only.</p>`;
      } else {
        html += `<p>You have been added as a collaborator to the event: <b>${table.title}</b>.</p>`;
      }
      const eventUrl = `${process.env.APP_URL}/dashboard.html?id=${table._id}`;
      html += `
      <div style="margin: 24px 0;">
        <a href="${eventUrl}" style="display:inline-block;padding:12px 28px;background:#CC0007;color:#fff;text-decoration:none;font-size:17px;font-weight:600;border-radius:8px;">View Event</a>
      </div>
    `;
      html += `<p>Log in to LumDash to view the event.</p>`;

      await sgMail.send({
        to: user.email,
        from: SENDGRID_FROM,
        subject,
        html
      });
    }
  } catch (err) {
    console.error('Failed to send share notification email:', err);
    // Don't fail the request if email fails
  }

  res.json({ message: 'User shared and role updated.' });
});

// --- Add/Update/Delete single crew row by _id ---
app.put('/api/tables/:id/rows/:rowId', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null" || !req.params.rowId) {
    return res.status(400).json({ error: "Invalid table ID or row ID" });
  }
  try {
    // Use atomic MongoDB update to avoid version conflicts
    const result = await Table.updateOne(
      { _id: req.params.id, 'rows._id': req.params.rowId, owners: req.user.id },
      { $set: {
        'rows.$.date': req.body.date,
        'rows.$.name': req.body.name,
        'rows.$.role': req.body.role,
        'rows.$.startTime': req.body.startTime,
        'rows.$.endTime': req.body.endTime,
        'rows.$.totalHours': req.body.totalHours,
        'rows.$.notes': req.body.notes
      }}
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Row not found or not authorized' });
    }
    notifyDataChange('crewChanged', null, req.params.id);
    res.json({ message: 'Row updated' });
  } catch (err) {
    console.error('Error updating row:', err);
    res.status(500).json({ error: 'Failed to update row' });
  }
});

app.delete('/api/tables/:id/rows-by-id/:rowId', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null" || !req.params.rowId) {
    return res.status(400).json({ error: "Invalid table ID or row ID" });
  }
  try {
    // Use atomic MongoDB $pull to avoid version conflicts
    const result = await Table.updateOne(
      { _id: req.params.id, owners: req.user.id },
      { $pull: { rows: { _id: req.params.rowId } } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Table not found or not authorized' });
    }
    notifyDataChange('crewChanged', null, req.params.id);
    res.json({ message: 'Row deleted' });
  } catch (err) {
    console.error('Error deleting row:', err);
    res.status(500).json({ error: 'Failed to delete row' });
  }
});

// Bulk crew update endpoint - handles multiple updates and deletes in one request
app.put('/api/tables/:id/crew-bulk', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  try {
    const { updates, deletes } = req.body;
    // updates: [{ rowId, data: { name, role, startTime, endTime, totalHours, notes, date } }]
    // deletes: [rowId, rowId, ...]
    
    // Verify ownership once
    const table = await Table.findById(req.params.id).select('owners');
    if (!table || !table.owners.includes(req.user.id)) {
      return res.status(403).json({ error: 'Not authorized or not found' });
    }
    
    let successCount = 0;
    
    // Process deletes first (as a single atomic $pull)
    if (Array.isArray(deletes) && deletes.length > 0) {
      const deleteIds = deletes.map(id => new mongoose.Types.ObjectId(id));
      await Table.updateOne(
        { _id: req.params.id },
        { $pull: { rows: { _id: { $in: deleteIds } } } }
      );
      successCount += deletes.length;
    }
    
    // Process updates one by one using atomic $set (no version conflicts)
    if (Array.isArray(updates) && updates.length > 0) {
      for (const { rowId, data } of updates) {
        if (!rowId || !data) continue;
        const setFields = {};
        for (const field of ['date', 'name', 'role', 'startTime', 'endTime', 'totalHours', 'notes', 'userId']) {
          if (data[field] !== undefined) {
            setFields[`rows.$.${field}`] = data[field];
          }
        }
        // Changing who is assigned resets the availability workflow for that row
        if (data.name !== undefined && data.resetAvailability) {
          setFields['rows.$.availabilityStatus'] = 'tentative';
          setFields['rows.$.availabilityRespondedAt'] = null;
        }
        if (Object.keys(setFields).length > 0) {
          await Table.updateOne(
            { _id: req.params.id, 'rows._id': rowId },
            { $set: setFields }
          );
          successCount++;
        }
      }
    }
    
    // Single notification after all changes
    if (successCount > 0) {
      notifyDataChange('crewChanged', null, req.params.id);
    }
    
    res.json({ message: `${successCount} operations completed`, successCount });
  } catch (err) {
    console.error('Error in bulk crew update:', err);
    res.status(500).json({ error: 'Failed to process bulk update' });
  }
});

// ========= CREW AVAILABILITY REQUESTS API =========
// Per-day availability workflow: tentative → requested → accepted/declined → confirmed.
// Crew respond via a public magic-link page (no login), same token pattern as invites.

/** Format a crew-row date string ("YYYY-MM-DD") for messages without timezone shifting */
function formatCrewDay(dateStr) {
  if (!dateStr) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr).trim());
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Email the request sender (falling back to all event owners) when a crew
 * member responds. Non-blocking; respects each recipient's email preference.
 */
async function sendCrewAvailabilityResponseEmails(request, table, applied) {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    console.warn('📧 Crew availability response email skipped: SendGrid not configured');
    return;
  }

  // Prefer the owner who sent the request; fall back to all event owners
  let recipientIds = request.sentBy ? [request.sentBy.toString()] : [];
  if (recipientIds.length === 0) {
    recipientIds = (table.owners || []).map(String);
  }
  if (recipientIds.length === 0) return;

  const recipients = await User.find({ _id: { $in: recipientIds } })
    .select('fullName email settings role').lean();

  const { isNotificationChannelEnabled } = require('./lib/userSettings');
  const {
    buildCrewAvailabilityResponseSubject,
    buildCrewAvailabilityResponseEmail,
    buildCrewAvailabilityResponseText
  } = require('./emails/crewAvailabilityResponseEmail');

  const appUrl = (process.env.APP_URL || 'https://beta.lumdash.app').replace(/\/$/, '');
  const crewUrl = `${appUrl}/dashboard.html#crew?id=${table._id.toString()}`;

  const sends = recipients.map(async (recipient) => {
    if (!recipient.email) return;
    if (!isNotificationChannelEnabled(recipient, 'crew_availability_response', 'email')) {
      console.log(`📧 Crew availability response email skipped (user pref): ${recipient.email}`);
      return;
    }

    const data = {
      recipientName: (recipient.fullName || '').split(' ')[0] || 'there',
      crewName: request.name || 'A crew member',
      crewEmail: request.email || '',
      eventName: table.title || 'your event',
      responses: applied,
      crewUrl
    };

    await sgMail.send({
      to: recipient.email,
      from: SENDGRID_FROM,
      subject: buildCrewAvailabilityResponseSubject(data),
      html: buildCrewAvailabilityResponseEmail(data),
      text: buildCrewAvailabilityResponseText(data)
    });
    console.log(`📧 Crew availability response email sent to ${recipient.email}`);
  });

  const results = await Promise.allSettled(sends);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`📧 Crew availability response email failed for ${recipients[i]?.email}:`, r.reason?.response?.body || r.reason?.message || r.reason);
    }
  });
}

// Bulk send availability requests — one email per person covering their selected days
app.post('/api/tables/:id/crew-requests', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id).select('title owners rows general');
    if (!table) return res.status(404).json({ error: 'Event not found' });
    if (!hasEventAccess(table, req.user, true)) {
      return res.status(403).json({ error: 'Only event owners can send availability requests' });
    }

    const rowIds = Array.isArray(req.body.rowIds) ? req.body.rowIds.map(String) : [];
    if (rowIds.length === 0) {
      return res.status(400).json({ error: 'rowIds is required' });
    }

    // Eligible rows: selected, named, and not already confirmed
    const rows = table.rows.filter(r =>
      rowIds.includes(r._id.toString()) &&
      (r.name || '').trim() &&
      r.availabilityStatus !== 'confirmed'
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No eligible rows to request (rows must have a name and not be confirmed)' });
    }

    // Group rows by person (prefer userId link, fall back to name)
    const groups = new Map();
    rows.forEach(r => {
      const key = r.userId ? `id:${r.userId.toString()}` : `name:${r.name.trim().toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, { userId: r.userId || null, name: r.name.trim(), rows: [] });
      groups.get(key).rows.push(r);
    });

    // Resolve emails from User accounts
    const idsToLookup = [...groups.values()].filter(g => g.userId).map(g => g.userId.toString());
    const usersById = {};
    if (idsToLookup.length) {
      (await User.find({ _id: { $in: idsToLookup } }).select('fullName email').lean())
        .forEach(u => { usersById[u._id.toString()] = u; });
    }

    // Requests stay valid until well after the event ends (fallback: 60 days)
    let expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const eventEnd = new Date(table.general?.end || '');
    if (!Number.isNaN(eventEnd.getTime())) {
      expiresAt = new Date(eventEnd.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    const appUrl = (process.env.APP_URL || 'https://beta.lumdash.app').replace(/\/$/, '');
    const {
      buildCrewAvailabilitySubject,
      buildCrewAvailabilityEmail,
      buildCrewAvailabilityText
    } = require('./emails/crewAvailabilityEmail');

    const results = [];
    const requestedRowIds = [];

    for (const group of groups.values()) {
      let user = group.userId ? usersById[group.userId.toString()] : null;
      if (!user) {
        user = await User.findOne({
          fullName: { $regex: new RegExp(`^${escapeRegex(group.name)}$`, 'i') }
        }).select('fullName email').lean();
      }

      if (!user?.email) {
        results.push({ name: group.name, email: null, sent: false, error: 'No user account / email found' });
        continue;
      }

      // Roll this person's still-unanswered "requested" days into the new request,
      // since sending revokes their older link — keeps one live link covering all open days
      const groupRowIds = new Set(group.rows.map(r => r._id.toString()));
      table.rows.forEach(r => {
        if (groupRowIds.has(r._id.toString())) return;
        if (r.availabilityStatus !== 'requested') return;
        const sameById = group.userId && r.userId && r.userId.toString() === group.userId.toString();
        const sameByName = (r.name || '').trim().toLowerCase() === group.name.toLowerCase();
        if (sameById || sameByName) {
          group.rows.push(r);
          groupRowIds.add(r._id.toString());
        }
      });

      const sortedRows = [...group.rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const days = sortedRows.map(r => ({ date: r.date, role: r.role || '' }));

      // Revoke older unanswered requests for the same person+event so only one link is live
      await CrewAvailabilityRequest.updateMany(
        { eventId: table._id, email: user.email.toLowerCase(), revokedAt: null, respondedAt: null },
        { $set: { revokedAt: new Date() } }
      );

      const request = await CrewAvailabilityRequest.create({
        eventId: table._id,
        userId: user._id || group.userId || null,
        email: user.email,
        name: user.fullName || group.name,
        rowIds: sortedRows.map(r => r._id),
        sentBy: req.user.id,
        expiresAt
      });

      const responseUrl = `${appUrl}/crew-response.html?token=${request.token}`;
      console.log(`🔗 Crew availability link for ${user.email}: ${responseUrl}`);
      const emailData = {
        recipientName: (user.fullName || group.name).split(' ')[0],
        eventName: table.title || 'an event',
        location: [table.general?.city, table.general?.state].map(s => (s || '').trim()).filter(Boolean).join(', '),
        senderName: req.user.fullName || '',
        days,
        responseUrl,
        acceptAllUrl: `${responseUrl}&preselect=accept`
      };

      if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
        results.push({ name: group.name, email: user.email, sent: false, error: 'Email not configured (SendGrid)' });
        continue;
      }

      try {
        await sgMail.send({
          to: user.email,
          from: SENDGRID_FROM,
          subject: buildCrewAvailabilitySubject(emailData),
          html: buildCrewAvailabilityEmail(emailData),
          text: buildCrewAvailabilityText(emailData)
        });
        requestedRowIds.push(...sortedRows.map(r => r._id));
        results.push({ name: group.name, email: user.email, sent: true, days: days.length });
        console.log(`📬 Crew availability request sent to ${user.email} (${days.length} day(s), event "${table.title}")`);
      } catch (err) {
        await CrewAvailabilityRequest.updateOne({ _id: request._id }, { $set: { revokedAt: new Date() } });
        console.error(`📬 Crew availability email failed for ${user.email}:`, err.response?.body || err.message || err);
        results.push({ name: group.name, email: user.email, sent: false, error: 'Email send failed' });
      }
    }

    // Mark successfully-requested rows
    if (requestedRowIds.length > 0) {
      await Table.updateOne(
        { _id: table._id },
        { $set: { 'rows.$[r].availabilityStatus': 'requested' } },
        { arrayFilters: [{ 'r._id': { $in: requestedRowIds } }] }
      );
      notifyDataChange('crewChanged', null, req.params.id);
    }

    res.json({ results, requested: requestedRowIds.length });
  } catch (err) {
    console.error('Error sending crew availability requests:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Public: fetch request details for the response page (magic link, no auth)
app.get('/api/crew-availability/:token', async (req, res) => {
  try {
    const request = await CrewAvailabilityRequest.findOne({ token: req.params.token }).lean();
    if (!request || request.revokedAt) {
      return res.status(404).json({ error: 'This request link is no longer valid. Please ask for a new one.' });
    }

    const table = await Table.findById(request.eventId).select('title rows general').lean();
    if (!table) return res.status(404).json({ error: 'Event not found' });

    const rowMap = {};
    (table.rows || []).forEach(r => { rowMap[r._id.toString()] = r; });

    const days = (request.rowIds || [])
      .map(id => rowMap[id.toString()])
      .filter(Boolean)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(r => ({
        rowId: r._id,
        date: r.date,
        role: r.role || '',
        status: r.availabilityStatus || 'requested'
      }));

    res.json({
      eventName: table.title || 'Event',
      name: request.name,
      expired: request.expiresAt <= new Date(),
      respondedAt: request.respondedAt,
      days
    });
  } catch (err) {
    console.error('Error fetching crew availability request:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Public: submit per-day accept/decline responses (magic link, no auth)
app.post('/api/crew-availability/:token/respond', async (req, res) => {
  try {
    const request = await CrewAvailabilityRequest.findOne({ token: req.params.token });
    if (!request || request.revokedAt) {
      return res.status(404).json({ error: 'This request link is no longer valid. Please ask for a new one.' });
    }
    if (request.expiresAt <= new Date()) {
      return res.status(410).json({ error: 'This request has expired. Please ask for a new one.' });
    }

    const allowedRowIds = new Set((request.rowIds || []).map(id => id.toString()));
    const responses = (Array.isArray(req.body.responses) ? req.body.responses : [])
      .filter(r => r && allowedRowIds.has(String(r.rowId)) && ['accepted', 'declined'].includes(r.status));
    if (responses.length === 0) {
      return res.status(400).json({ error: 'No valid responses provided' });
    }

    const table = await Table.findById(request.eventId).select('title owners leads sharedWith rows');
    if (!table) return res.status(404).json({ error: 'Event not found' });

    const rowMap = {};
    table.rows.forEach(r => { rowMap[r._id.toString()] = r; });

    const now = new Date();
    const applied = [];
    for (const resp of responses) {
      const row = rowMap[String(resp.rowId)];
      // Confirmed rows are locked — the owner has committed them
      if (!row || row.availabilityStatus === 'confirmed') continue;

      await Table.updateOne(
        { _id: table._id, 'rows._id': row._id },
        { $set: {
          'rows.$.availabilityStatus': resp.status,
          'rows.$.availabilityRespondedAt': now
        }}
      );
      applied.push({ rowId: row._id, date: row.date, role: row.role || '', status: resp.status });
    }

    if (applied.length === 0) {
      return res.status(400).json({ error: 'These days can no longer be changed' });
    }

    // Store/refresh response snapshot on the request
    const responseByRowId = {};
    (request.responses || []).forEach(r => { responseByRowId[r.rowId.toString()] = r; });
    applied.forEach(a => { responseByRowId[a.rowId.toString()] = a; });
    request.responses = Object.values(responseByRowId);
    request.respondedAt = now;
    await request.save();

    notifyDataChange('crewChanged', null, table._id.toString());

    // Auto-share the event with the crew member once they accept a day,
    // so it shows up on their own dashboard (same as the manual Share button)
    const acceptedAny = applied.some(a => a.status === 'accepted');
    if (acceptedAny) {
      try {
        let crewUser = request.userId
          ? await User.findById(request.userId).select('_id fullName').lean()
          : null;
        if (!crewUser && request.email) {
          crewUser = await User.findOne({ email: request.email.toLowerCase() }).select('_id fullName').lean();
        }

        if (crewUser) {
          const uid = crewUser._id.toString();
          const alreadyHasAccess =
            (table.owners || []).some(id => id.toString() === uid) ||
            (table.leads || []).some(id => id.toString() === uid) ||
            (table.sharedWith || []).some(id => id.toString() === uid);

          if (!alreadyHasAccess) {
            await Table.updateOne(
              { _id: table._id },
              { $addToSet: { sharedWith: crewUser._id } }
            );
            notifyDataChange('tableUpdated', { tableId: table._id });
            console.log(`🤝 Event "${table.title}" auto-shared with ${request.name || uid} (accepted availability)`);

            createNotification({
              recipientId: uid,
              type: 'event_shared',
              title: 'Added to event as collaborator',
              message: `You were added to "${table.title || 'an event'}" after accepting the availability request`,
              link: { page: 'general', eventId: table._id.toString() },
              actorId: null,
              eventId: table._id.toString(),
              metadata: { role: 'collaborator', autoShared: true }
            });
          }
        }
      } catch (shareErr) {
        console.error('🤝 Auto-share after accept failed (response still saved):', shareErr);
      }
    }

    // Notify event owners in-app
    const accepted = applied.filter(a => a.status === 'accepted').map(a => formatCrewDay(a.date));
    const declined = applied.filter(a => a.status === 'declined').map(a => formatCrewDay(a.date));
    const parts = [];
    if (accepted.length) parts.push(`accepted ${accepted.join(', ')}`);
    if (declined.length) parts.push(`declined ${declined.join(', ')}`);
    const message = `${request.name || 'A crew member'} ${parts.join(' and ')} for ${table.title || 'your event'}`;

    createNotificationBulk((table.owners || []).map(String), {
      type: 'crew_availability_response',
      title: 'Crew Availability Response',
      message,
      link: { page: 'crew', eventId: table._id.toString(), params: null },
      actorId: request.userId ? request.userId.toString() : null,
      eventId: table._id,
      metadata: { crewRequestId: request._id.toString() }
    }).catch(err => console.error('🔔 Crew availability notification failed:', err));

    // Email the owner(s): the sender of the request, falling back to all event owners
    sendCrewAvailabilityResponseEmails(request, table, applied)
      .catch(err => console.error('📧 Crew availability response email failed:', err));

    res.json({ message: 'Response saved', applied: applied.length });
  } catch (err) {
    console.error('Error saving crew availability response:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Manually set a row's availability (commit to confirmed, or reset to tentative)
app.put('/api/tables/:id/rows/:rowId/availability', authenticate, async (req, res) => {
  try {
    const status = req.body.status;
    if (!['tentative', 'confirmed'].includes(status)) {
      return res.status(400).json({ error: 'status must be "tentative" or "confirmed"' });
    }

    const table = await Table.findById(req.params.id).select('owners leads sharedWith');
    if (!table) return res.status(404).json({ error: 'Event not found' });
    if (!hasEventAccess(table, req.user, true)) {
      return res.status(403).json({ error: 'Only event owners can change availability status' });
    }

    const setFields = { 'rows.$.availabilityStatus': status };
    if (status === 'tentative') setFields['rows.$.availabilityRespondedAt'] = null;

    const result = await Table.updateOne(
      { _id: req.params.id, 'rows._id': req.params.rowId },
      { $set: setFields }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Row not found' });
    }

    notifyDataChange('crewChanged', null, req.params.id);
    res.json({ message: 'Availability updated', status });
  } catch (err) {
    console.error('Error updating row availability:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ========= END CREW AVAILABILITY REQUESTS API =========

// PATCH endpoint for partial updates (e.g., crewRates)
app.patch('/api/tables/:id', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  const table = await Table.findById(req.params.id);
  if (!table || !table.owners.includes(req.user.id)) {
    return res.status(403).json({ error: 'Not authorized or not found' });
  }
  // Only allow updating crewRates for now
  if (req.body.crewRates) {
    table.crewRates = { ...table.crewRates, ...req.body.crewRates };
    await table.save();
    return res.json({ crewRates: table.crewRates });
  }
  res.status(400).json({ error: 'No valid fields to update' });
});

// PATCH endpoint for archiving events
app.patch('/api/tables/:id/archive', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  
  try {
    const table = await Table.findById(req.params.id);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    if (!table.owners.includes(req.user.id)) {
      return res.status(403).json({ error: 'Not authorized - only owners can archive events' });
    }
    
    // Update the archived status
    table.archived = req.body.archived !== undefined ? req.body.archived : true;
    await table.save();
    
    // Notify clients of the change
    notifyDataChange('tableArchived', { tableId: table._id, archived: table.archived });
    
    res.json({ 
      message: table.archived ? 'Event archived successfully' : 'Event unarchived successfully',
      archived: table.archived 
    });
    
  } catch (error) {
    console.error('Archive endpoint error:', error);
    res.status(500).json({ error: 'Failed to archive event' });
  }
});

// User-specific event archiving endpoint
app.patch('/api/tables/:id/user-archive', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }

  try {
    const table = await Table.findById(req.params.id);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check if user has access to this event (owner, lead, or shared with)
    const userId = req.user.id;
    const hasAccess = table.owners.includes(userId) || 
                     table.leads.includes(userId) || 
                     table.sharedWith.includes(userId);
    
    if (!hasAccess) {
      return res.status(403).json({ error: 'Not authorized - no access to this event' });
    }

    // Get the user document
    const User = require('./models/User');
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const archive = req.body.archive !== undefined ? req.body.archive : true;
    const tableId = table._id;

    // Initialize archivedEvents if it doesn't exist (for existing users in production)
    if (!user.archivedEvents) {
      user.archivedEvents = [];
    }

    if (archive) {
      // Add to user's archived events if not already there
      const userArchivedIds = user.archivedEvents.map(id => id.toString());
      if (!userArchivedIds.includes(tableId.toString())) {
        user.archivedEvents.push(tableId);
      }
    } else {
      // Remove from user's archived events
      user.archivedEvents = user.archivedEvents.filter(id => id.toString() !== tableId.toString());
    }

    await user.save();

    // Notify clients of the change
    notifyDataChange('userEventArchived', { 
      userId: userId,
      tableId: tableId, 
      archived: archive 
    });

    res.json({ 
      message: archive ? 'Event archived for you' : 'Event unarchived for you',
      archived: archive 
    });

  } catch (error) {
    console.error('User archive endpoint error:', error);
    res.status(500).json({ error: 'Failed to archive event for user' });
  }
});

// Convert PDF to image
app.post('/api/tables/:id/documents/:documentId/convert-to-image', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table || !table.owners.includes(req.user.id)) {
      return res.status(403).json({ error: 'Not authorized or not found' });
    }
    
    const document = table.documents.id(req.params.documentId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    if (document.fileType !== 'application/pdf') {
      return res.status(400).json({ error: 'Document is not a PDF' });
    }
    
    // Create image URL using Cloudinary transformation
    const imageUrl = cloudinary.url(document.cloudinaryPublicId, {
      resource_type: 'image',
      format: 'jpg',
      quality: 'auto',
      width: 1200,
      crop: 'limit'
    });
    
    console.log('Generated image URL for PDF:', imageUrl);
    
    res.json({
      message: 'PDF conversion URL generated',
      imageUrl: imageUrl,
      originalDocument: document
    });
    
  } catch (err) {
    console.error('Error converting PDF to image:', err);
    res.status(500).json({ error: 'Failed to convert PDF to image' });
  }
});

// Get specific document
app.get('/api/tables/:id/documents/:documentId', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const document = table.documents.id(req.params.documentId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json(document);
  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({ error: 'Failed to get document' });
  }
});

// Serve PDF for inline viewing (prevents download)
app.get('/api/tables/:id/documents/:documentId/view', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const document = table.documents.id(req.params.documentId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // For PDFs, redirect to Cloudinary URL with inline viewing parameters
    if (document.fileType === 'application/pdf') {
      const inlineUrl = document.url + (document.url.includes('?') ? '&' : '?') + 'inline=true';
      res.redirect(inlineUrl);
    } else {
      // For images, just redirect to the URL
      res.redirect(document.url);
    }
  } catch (error) {
    console.error('View document error:', error);
    res.status(500).json({ error: 'Failed to view document' });
  }
});

// =============== FEEDBACK (bug reports & feature requests) ===============

const FEEDBACK_STATUSES = ['new', 'in_progress', 'completed', 'declined'];
const FEEDBACK_STATUS_LABELS = {
  new: 'New',
  in_progress: 'In Progress',
  completed: 'Completed',
  declined: 'Declined'
};

const feedbackScreenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, PNG, WebP, and GIF images are allowed.'), false);
    }
  }
});

function isFeedbackAdmin(user) {
  return /^admin$/i.test(user?.role || '');
}

// Create a bug report / feature request (optionally with screenshot)
app.post('/api/feedback', authenticate, feedbackScreenshotUpload.single('screenshot'), async (req, res) => {
  try {
    const type = String(req.body.type || '').toLowerCase();
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const page = String(req.body.page || '').trim();

    if (!['bug', 'feature'].includes(type)) {
      return res.status(400).json({ error: 'type must be "bug" or "feature"' });
    }
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    let screenshotUrl = '';
    let screenshotPublicId = '';
    if (req.file) {
      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            resource_type: 'image',
            folder: 'lumdash/feedback',
            public_id: `feedback_${req.user.id}_${Date.now()}`,
            transformation: [{ quality: 'auto', fetch_format: 'auto' }]
          },
          (error, result) => error ? reject(error) : resolve(result)
        );
        uploadStream.end(req.file.buffer);
      });
      screenshotUrl = uploadResult.secure_url;
      screenshotPublicId = uploadResult.public_id;
    }

    const item = await Feedback.create({
      type,
      title,
      description,
      page,
      screenshotUrl,
      screenshotPublicId,
      submittedBy: req.user.id,
      submittedByName: req.user.fullName || req.user.email || ''
    });

    // Alert admins (skips the submitter automatically if they are an admin)
    try {
      const admins = await findSystemAdminUsers();
      const typeLabel = type === 'bug' ? 'bug report' : 'feature request';
      await createNotificationBulk(admins.map(a => a._id.toString()), {
        type: 'feedback_submitted',
        title: `New ${typeLabel}`,
        message: `${item.submittedByName || 'Someone'}: "${title}"`,
        link: { page: 'feedback', params: { feedbackId: item._id.toString() } },
        actorId: req.user.id,
        metadata: { feedbackId: item._id.toString(), feedbackType: type }
      });
    } catch (notifyErr) {
      console.error('Feedback admin notification failed:', notifyErr);
    }

    res.status(201).json(item);
  } catch (err) {
    console.error('Error creating feedback:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// List feedback — visible to all authenticated users (helps avoid duplicate reports)
app.get('/api/feedback', authenticate, async (req, res) => {
  try {
    const query = {};
    if (req.query.type && ['bug', 'feature'].includes(req.query.type)) {
      query.type = req.query.type;
    }
    if (req.query.status && FEEDBACK_STATUSES.includes(req.query.status)) {
      query.status = req.query.status;
    }
    if (req.query.mine === '1') {
      query.submittedBy = req.user.id;
    }
    const items = await Feedback.find(query).sort({ createdAt: -1 }).lean();
    res.json(items);
  } catch (err) {
    console.error('Error listing feedback:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Edit title/description/page — own items while still "new", admins anytime
app.put('/api/feedback/:id', authenticate, async (req, res) => {
  try {
    const item = await Feedback.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Feedback not found' });

    const isOwn = item.submittedBy.toString() === req.user.id;
    const admin = isFeedbackAdmin(req.user);
    if (!admin && (!isOwn || item.status !== 'new')) {
      return res.status(403).json({ error: 'You can only edit your own feedback while it is still new' });
    }

    if (req.body.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title) return res.status(400).json({ error: 'Title is required' });
      item.title = title;
    }
    if (req.body.description !== undefined) item.description = String(req.body.description).trim();
    if (req.body.page !== undefined) item.page = String(req.body.page).trim();
    if (req.body.type !== undefined && ['bug', 'feature'].includes(req.body.type)) {
      item.type = req.body.type;
    }

    await item.save();
    res.json(item);
  } catch (err) {
    console.error('Error updating feedback:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update status + admin note (admin only); notifies the submitter
app.put('/api/feedback/:id/status', authenticate, async (req, res) => {
  try {
    if (!isFeedbackAdmin(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const item = await Feedback.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Feedback not found' });

    const status = String(req.body.status || '').toLowerCase();
    if (!FEEDBACK_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const statusChanged = item.status !== status;
    item.status = status;
    if (req.body.adminNote !== undefined) item.adminNote = String(req.body.adminNote).trim();
    item.updatedBy = req.user.id;
    item.updatedByName = req.user.fullName || req.user.email || '';
    if (statusChanged) item.statusChangedAt = new Date();
    await item.save();

    if (statusChanged) {
      try {
        const typeLabel = item.type === 'bug' ? 'bug report' : 'feature request';
        await createNotification({
          recipientId: item.submittedBy.toString(),
          type: 'feedback_status_changed',
          title: `Your ${typeLabel} is now ${FEEDBACK_STATUS_LABELS[status]}`,
          message: `"${item.title}"${item.adminNote ? ` — ${item.adminNote}` : ''}`,
          link: { page: 'feedback', params: { feedbackId: item._id.toString() } },
          actorId: req.user.id,
          metadata: { feedbackId: item._id.toString(), status }
        });
      } catch (notifyErr) {
        console.error('Feedback status notification failed:', notifyErr);
      }
    }

    res.json(item);
  } catch (err) {
    console.error('Error updating feedback status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete — own items while still "new", admins anytime
app.delete('/api/feedback/:id', authenticate, async (req, res) => {
  try {
    const item = await Feedback.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Feedback not found' });

    const isOwn = item.submittedBy.toString() === req.user.id;
    const admin = isFeedbackAdmin(req.user);
    if (!admin && (!isOwn || item.status !== 'new')) {
      return res.status(403).json({ error: 'You can only delete your own feedback while it is still new' });
    }

    if (item.screenshotPublicId) {
      try {
        await cloudinary.uploader.destroy(item.screenshotPublicId, { resource_type: 'image' });
      } catch (cloudErr) {
        console.error('Failed to delete feedback screenshot from Cloudinary:', cloudErr);
      }
    }

    await Feedback.deleteOne({ _id: item._id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting feedback:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// =============== VIDEO PORTAL (clients, projects, review comments) ===============

const bunnyStream = require('./lib/bunnyStream');
const { buildPortalInviteSubject, buildPortalInviteEmail, buildPortalInviteText } = require('./emails/portalInviteEmail');
const { buildPortalShareSubject, buildPortalShareEmail, buildPortalShareText } = require('./emails/portalShareEmail');
const { buildPortalNewVersionSubject, buildPortalNewVersionEmail, buildPortalNewVersionText } = require('./emails/portalNewVersionEmail');

const portalVideoUpload = multer({
  storage: multer.diskStorage({ destination: require('os').tmpdir() }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB — larger masters stay in Drive
  fileFilter: (req, file, cb) => {
    if (/^video\//.test(file.mimetype) || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.originalname || '')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files can be uploaded.'), false);
    }
  }
});

const portalThumbnailUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WebP, or GIF images are allowed.'), false);
  }
});

function projectThumbnailUrl(project, latestReadyVersion = null) {
  if (project?.customThumbnailUrl) {
    // Cache-bust so gallery refreshes after a replace
    const sep = project.customThumbnailUrl.includes('?') ? '&' : '?';
    const stamp = project.updatedAt ? new Date(project.updatedAt).getTime() : Date.now();
    return `${project.customThumbnailUrl}${sep}v=${stamp}`;
  }
  if (latestReadyVersion?.bunnyVideoId && bunnyStream.isConfigured()) {
    return bunnyStream.getThumbnailUrl(latestReadyVersion.bunnyVideoId);
  }
  return null;
}

function isPortalAdmin(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'production_manager';
}

function normalizePortalAccent(color) {
  const raw = String(color || '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return raw.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(raw)) {
    const [, a, b, c] = raw;
    return `#${a}${a}${b}${b}${c}${c}`.toUpperCase();
  }
  return null;
}

function portalBrandingPayload(client) {
  const b = client?.branding || {};
  return {
    displayName: String(b.displayName || '').trim() || client?.name || '',
    logoUrl: b.logoUrl || '',
    accentColor: normalizePortalAccent(b.accentColor) || '#CC0007'
  };
}

function portalFoldersPayload(client) {
  return [...(client?.folders || [])]
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.name).localeCompare(String(b.name)))
    .map(f => ({ _id: f._id, name: f.name, sortOrder: f.sortOrder || 0 }));
}

function findClientFolder(client, folderId) {
  if (!folderId || !client) return null;
  const id = String(folderId);
  if (typeof client.folders?.id === 'function') {
    const sub = client.folders.id(folderId);
    if (sub) return sub;
  }
  return (client.folders || []).find(f => String(f._id) === id) || null;
}

async function applyProjectFolder(project, client, folderId) {
  if (folderId === null || folderId === '' || folderId === undefined) {
    project.folderId = null;
    if (folderId === null || folderId === '') project.category = '';
    return;
  }
  const folder = findClientFolder(client, folderId);
  if (!folder) {
    const err = new Error('Folder not found on this client');
    err.status = 400;
    throw err;
  }
  project.folderId = folder._id;
  project.category = folder.name || '';
}

function buildPortalUrl(token, projectId = null) {
  const base = (process.env.APP_URL || 'https://beta.lumdash.app').replace(/\/$/, '');
  return `${base}/portal.html?token=${encodeURIComponent(token)}${projectId ? `&project=${projectId}` : ''}`;
}

/** Person links must never reuse the company preview token (that URL sees every video). */
function ensurePersonShareToken(contact, client) {
  if (!contact) return false;
  const current = String(contact.token || '').trim();
  const company = String(client?.shareToken || '').trim();
  if (current && current !== company) return false;
  contact.token = require('crypto').randomBytes(32).toString('hex');
  return true;
}

function personPortalUrl(contact, client, projectId = null) {
  ensurePersonShareToken(contact, client);
  return buildPortalUrl(contact.token, projectId);
}

function formatTimecode(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return null;
  const s = Math.max(0, Math.floor(Number(seconds)));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function formatTimecodeRange(start, end) {
  const a = formatTimecode(start);
  if (!a) return null;
  const b = formatTimecode(end);
  if (b && Number(end) > Number(start)) return `${a}–${b}`;
  return a;
}

/** Parse optional start/end timecodes from a comment create body */
function parseTimecodeFields(body = {}) {
  const rawStart = body.timecodeSeconds;
  const rawEnd = body.timecodeEndSeconds;
  if (rawStart === null || rawStart === undefined || rawStart === '') {
    return { timecodeSeconds: null, timecodeEndSeconds: null };
  }
  const start = Math.max(0, Math.floor(Number(rawStart)));
  if (!Number.isFinite(start)) return { timecodeSeconds: null, timecodeEndSeconds: null };

  if (rawEnd === null || rawEnd === undefined || rawEnd === '') {
    return { timecodeSeconds: start, timecodeEndSeconds: null };
  }
  const end = Math.max(0, Math.floor(Number(rawEnd)));
  if (!Number.isFinite(end) || end <= start) {
    return { timecodeSeconds: start, timecodeEndSeconds: null };
  }
  return { timecodeSeconds: start, timecodeEndSeconds: end };
}

/** Public-safe payload for one version (signed playback link only when transcoded) */
function portalVersionPayload(v) {
  const ready = v.videoStatus === 'ready' && v.bunnyVideoId && bunnyStream.isConfigured();
  return {
    _id: v._id,
    versionNumber: v.versionNumber,
    videoStatus: v.videoStatus,
    durationSeconds: v.durationSeconds || 0,
    notes: v.notes || '',
    uploadedByName: v.uploadedByName || '',
    uploadedAt: v.uploadedAt,
    embedUrl: ready ? bunnyStream.getSignedEmbedUrl(v.bunnyVideoId) : null,
    thumbnailUrl: ready ? bunnyStream.getThumbnailUrl(v.bunnyVideoId) : null
  };
}

function portalCommentPayload(c) {
  return {
    _id: c._id,
    versionId: c.versionId,
    timecodeSeconds: c.timecodeSeconds,
    timecodeEndSeconds: c.timecodeEndSeconds ?? null,
    text: c.text,
    mustFix: !!c.mustFix,
    annotation: c.annotation || null,
    mentions: (c.mentions || []).map(m => ({
      userId: m.userId,
      name: m.name || ''
    })),
    authorType: c.authorType,
    authorName: c.authorName || (c.authorType === 'client' ? 'Client' : 'Lumetry Media'),
    resolved: !!c.resolved,
    resolvedByName: c.resolvedByName || '',
    createdAt: c.createdAt,
    replies: (c.replies || []).map(r => ({
      _id: r._id,
      text: r.text,
      authorType: r.authorType,
      authorName: r.authorName || (r.authorType === 'client' ? 'Client' : 'Lumetry Media'),
      createdAt: r.createdAt
    }))
  };
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** Normalize / cap drawing payload from clients */
function sanitizeAnnotation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const strokes = [];
  for (const s of (Array.isArray(raw.strokes) ? raw.strokes : []).slice(0, 40)) {
    if (!s || !Array.isArray(s.points) || s.points.length < 2) continue;
    strokes.push({
      color: String(s.color || '#FF3B30').slice(0, 20),
      width: Math.max(1, Math.min(12, Number(s.width) || 3)),
      points: s.points.slice(0, 500).map(p => ({ x: clamp01(p?.x), y: clamp01(p?.y) }))
    });
  }
  const arrows = [];
  for (const a of (Array.isArray(raw.arrows) ? raw.arrows : []).slice(0, 20)) {
    if (!a?.from || !a?.to) continue;
    arrows.push({
      color: String(a.color || '#FF3B30').slice(0, 20),
      width: Math.max(1, Math.min(12, Number(a.width) || 3)),
      from: { x: clamp01(a.from.x), y: clamp01(a.from.y) },
      to: { x: clamp01(a.to.x), y: clamp01(a.to.y) }
    });
  }
  if (!strokes.length && !arrows.length) return null;
  return { strokes, arrows };
}

function portalMasterDownloadUrl(project) {
  if (project.status !== 'delivered') return '';
  if (project.allowClientDownload === false) return '';
  return project.masterFileUrl || '';
}

async function resolvePortalMentions(ids) {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).map(id => String(id || '').trim()).filter(Boolean))].slice(0, 20);
  if (!unique.length) return [];
  const users = await User.find({ _id: { $in: unique } }).select('fullName email').lean();
  return users.map(u => ({ userId: u._id, name: u.fullName || u.email || '' }));
}

async function notifyPortalMentions({ project, mentions, actorName, text }) {
  if (!mentions?.length) return;
  const recipients = [...new Set(mentions.map(m => m.userId.toString()))];
  if (!recipients.length) return;

  await createNotificationBulk(recipients, {
    type: 'portal_mention',
    title: `${actorName} mentioned you on "${project.title}"`,
    message: text.length > 140 ? `${text.slice(0, 140)}…` : text,
    link: { page: 'video-portal', params: { projectId: project._id.toString() } },
    metadata: { projectId: project._id.toString() }
  });

  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) return;
  try {
    const { isNotificationChannelEnabled } = require('./lib/userSettings');
    const users = await User.find({ _id: { $in: recipients } }).select('email fullName settings role').lean();
    const appUrl = (process.env.APP_URL || 'https://beta.lumdash.app').replace(/\/$/, '');
    const pageUrl = `${appUrl}/dashboard.html#video-portal`;
    for (const u of users) {
      if (!u.email || !isNotificationChannelEnabled(u, 'portal_mention', 'email')) continue;
      await sgMail.send({
        to: u.email.trim().toLowerCase(),
        from: SENDGRID_FROM,
        subject: `Mentioned on ${project.title}`,
        html: `<p>Hi ${(u.fullName || '').split(' ')[0] || 'there'},</p>
               <p><strong>${String(actorName).replace(/</g, '&lt;')}</strong> mentioned you on <strong>${String(project.title).replace(/</g, '&lt;')}</strong>:</p>
               <p>${String(text).replace(/</g, '&lt;').slice(0, 500)}</p>
               <p><a href="${pageUrl}" style="color:#CC0007;font-weight:600;">Open the Video Portal</a></p>`
      });
    }
  } catch (emailErr) {
    console.error('Portal mention email failed:', emailErr);
  }
}

/**
 * Resolve a portal magic-link token to { client, contact, shared, person }.
 * Company shareToken: full preview (shared, no contact).
 * Person (contact) tokens: scoped share links — still ask for a reviewer name.
 */
async function resolvePortalToken(token) {
  if (!token) return null;
  const client = await Client.findOne({
    $or: [{ 'contacts.token': token }, { shareToken: token }],
    archived: false
  });
  if (!client) return null;

  const contact = (client.contacts || []).find(c => c.token === token && !c.revokedAt);
  if (contact) {
    return { client, contact, shared: true, person: true };
  }
  if (client.shareToken === token) {
    return { client, contact: null, shared: true, person: false };
  }
  return null;
}

/** Company preview sees every project; a person link only sees assigned videos. */
function projectVisibleToPortal(project, resolved) {
  if (!project || !resolved) return false;
  if (!resolved.person || !resolved.contact) return true;
  return (project.viewerIds || []).some(id => String(id) === String(resolved.contact._id));
}

function sanitizeViewerIds(client, raw) {
  const allowed = new Set(
    (client?.contacts || []).filter(c => !c.revokedAt).map(c => String(c._id))
  );
  const ids = Array.isArray(raw) ? raw.map(String).filter(id => allowed.has(id)) : [];
  return [...new Set(ids)];
}

function viewerNamesForProject(project, client) {
  const contacts = client?.contacts || [];
  return (project.viewerIds || []).map(id => {
    const ct = contacts.find(c => String(c._id) === String(id));
    return ct ? (ct.name || ct.email || 'Person') : null;
  }).filter(Boolean);
}

/** Strip PIN hash from admin API responses; expose portalPinEnabled instead. */
function sanitizePortalClient(client) {
  const obj = client?.toObject ? client.toObject() : { ...(client || {}) };
  const enabled = !!obj.portalPinHash;
  delete obj.portalPinHash;
  obj.portalPinEnabled = enabled;
  return obj;
}

function clientHasPortalPin(client) {
  return !!(client && String(client.portalPinHash || '').trim());
}

function verifyPortalUnlockHeader(req, client) {
  if (!clientHasPortalPin(client)) return true;
  const unlock = String(req.headers['x-portal-unlock'] || '').trim();
  if (!unlock || !process.env.JWT_SECRET) return false;
  try {
    const payload = jwt.verify(unlock, process.env.JWT_SECRET);
    return payload?.purpose === 'portal_unlock'
      && String(payload.clientId) === String(client._id);
  } catch {
    return false;
  }
}

function portalPinRequiredResponse(client) {
  return {
    pinRequired: true,
    error: 'PIN required',
    clientName: client.name,
    branding: portalBrandingPayload(client)
  };
}

/** Team members who should hear about client activity on a project (creators, uploaders, admins). */
async function portalTeamRecipients(project) {
  const ids = new Set();
  if (project.createdBy) ids.add(project.createdBy.toString());
  (project.versions || []).forEach(v => { if (v.uploadedBy) ids.add(v.uploadedBy.toString()); });
  try {
    const admins = await User.find({
      role: { $regex: /^(admin|production_manager)$/i }
    }).select('_id').lean();
    admins.forEach(a => ids.add(a._id.toString()));
  } catch (err) {
    console.error('Failed to load portal admin recipients:', err.message);
  }
  return [...ids];
}

async function logPortalActivity({
  projectId,
  clientId = null,
  type,
  actorType = 'team',
  actorName = '',
  actorEmail = '',
  actorId = null,
  message = '',
  metadata = {}
}) {
  try {
    await VideoPortalActivity.create({
      projectId,
      clientId,
      type,
      actorType,
      actorName,
      actorEmail,
      actorId,
      message,
      metadata
    });
  } catch (err) {
    console.error('Portal activity log failed:', err.message);
  }
}

async function notifyTeamPortalEvent({
  project,
  type,
  title,
  message = '',
  emailSubject = null,
  emailHtmlExtra = null
}) {
  const recipients = await portalTeamRecipients(project);
  if (recipients.length === 0) return;

  await createNotificationBulk(recipients, {
    type,
    title,
    message,
    link: { page: 'video-portal', params: { projectId: project._id.toString() } },
    metadata: { projectId: project._id.toString(), clientId: project.clientId?.toString?.() || project.clientId }
  });

  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) return;
  try {
    const { isNotificationChannelEnabled } = require('./lib/userSettings');
    const users = await User.find({ _id: { $in: recipients } }).select('email fullName settings role').lean();
    const appUrl = (process.env.APP_URL || 'https://beta.lumdash.app').replace(/\/$/, '');
    const pageUrl = `${appUrl}/dashboard.html#video-portal`;
    for (const u of users) {
      if (!u.email || !isNotificationChannelEnabled(u, type, 'email')) continue;
      const body = emailHtmlExtra || `<p>${String(message || title).replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>
               <p><a href="${pageUrl}" style="color:#CC0007;font-weight:600;">Open the Video Portal in LumDash</a></p>`;
      await sgMail.send({
        to: u.email.trim().toLowerCase(),
        from: SENDGRID_FROM,
        subject: emailSubject || title,
        html: `<p>Hi ${(u.fullName || '').split(' ')[0] || 'there'},</p>
               <p>${String(title).replace(/</g, '&lt;')}</p>
               ${body}`
      });
    }
  } catch (emailErr) {
    console.error('Portal team email failed:', emailErr);
  }
}

/** In-app notification + (preference-gated) email to the team about a client comment/reply.
 * Rapid comments on the same project are batched so 10 comments in one session
 * become one toast + one email after a quiet period.
 */
const PORTAL_COMMENT_BATCH_MS = Math.max(
  15000,
  Number(process.env.PORTAL_COMMENT_BATCH_MS) || 5 * 60 * 1000
);
const portalCommentBatches = new Map(); // projectId -> { timer, project, client, items[] }

function queuePortalCommentNotify({
  project,
  client,
  authorName,
  text,
  timecodeSeconds = null,
  timecodeEndSeconds = null,
  isReply = false
}) {
  const key = project._id.toString();
  let batch = portalCommentBatches.get(key);
  if (!batch) {
    batch = { projectId: key, project, client, items: [], timer: null };
    portalCommentBatches.set(key, batch);
  } else {
    batch.project = project;
    batch.client = client;
  }

  batch.items.push({
    authorName: authorName || client?.name || 'Client',
    text: String(text || '').trim(),
    timecodeSeconds,
    timecodeEndSeconds,
    isReply: !!isReply,
    at: new Date()
  });

  if (batch.timer) clearTimeout(batch.timer);
  batch.timer = setTimeout(() => {
    flushPortalCommentBatch(key).catch(err =>
      console.error('Portal comment batch flush failed:', err)
    );
  }, PORTAL_COMMENT_BATCH_MS);
}

async function flushPortalCommentBatch(projectId) {
  const batch = portalCommentBatches.get(projectId);
  if (!batch) return;
  portalCommentBatches.delete(projectId);
  if (batch.timer) {
    clearTimeout(batch.timer);
    batch.timer = null;
  }

  const items = batch.items || [];
  if (!items.length) return;

  const project = batch.project;
  const client = batch.client;
  const authors = [...new Set(items.map(i => i.authorName).filter(Boolean))];
  const who = authors.length === 1
    ? authors[0]
    : (authors.length > 1 ? `${authors.length} reviewers` : (client?.name || 'Client'));
  const n = items.length;
  const replyOnly = items.every(i => i.isReply);

  let title;
  if (n === 1) {
    const one = items[0];
    const tc = formatTimecodeRange(one.timecodeSeconds, one.timecodeEndSeconds);
    title = one.isReply
      ? `${who} replied on "${project.title}"`
      : `${who} commented on "${project.title}"${tc ? ` at ${tc}` : ''}`;
  } else if (replyOnly) {
    title = `${who} left ${n} replies on "${project.title}"`;
  } else {
    title = `${who} left ${n} comments on "${project.title}"`;
  }

  const previewLines = items.slice(0, 12).map(i => {
    const tc = formatTimecodeRange(i.timecodeSeconds, i.timecodeEndSeconds);
    const prefix = i.isReply ? 'Reply' : (tc ? tc : 'Note');
    const body = i.text.length > 120 ? `${i.text.slice(0, 120)}…` : i.text;
    return `${prefix}: ${body}`;
  });
  const message = previewLines.join('\n');
  const more = n > 12 ? `\n…and ${n - 12} more` : '';

  await notifyTeamPortalEvent({
    project,
    type: 'portal_comment',
    title,
    message: (message + more).slice(0, 2000),
    emailSubject: n === 1
      ? `Client feedback — ${project.title}`
      : `${n} new comments — ${project.title}`,
    emailHtmlExtra: buildPortalCommentBatchEmailHtml(items, project)
  });
}

function buildPortalCommentBatchEmailHtml(items, project) {
  const appUrl = (process.env.APP_URL || 'https://beta.lumdash.app').replace(/\/$/, '');
  const pageUrl = `${appUrl}/dashboard.html#video-portal`;
  const lis = items.slice(0, 20).map(i => {
    const tc = formatTimecodeRange(i.timecodeSeconds, i.timecodeEndSeconds);
    const who = String(i.authorName || 'Client').replace(/</g, '&lt;');
    const body = String(i.text || '').replace(/</g, '&lt;');
    const meta = [
      i.isReply ? 'Reply' : 'Comment',
      tc ? `at ${tc}` : null
    ].filter(Boolean).join(' · ');
    return `<li style="margin:0 0 10px;">
      <div style="font-size:12px;color:#666;margin-bottom:2px;"><strong>${who}</strong> · ${meta}</div>
      <div style="font-size:14px;color:#222;">${body}</div>
    </li>`;
  }).join('');
  const more = items.length > 20
    ? `<p style="color:#666;font-size:13px;">…and ${items.length - 20} more</p>`
    : '';
  return `
    <p><strong>${items.length}</strong> new note${items.length === 1 ? '' : 's'} on
       <strong>${String(project.title).replace(/</g, '&lt;')}</strong>:</p>
    <ul style="padding-left:18px;margin:12px 0;">${lis}</ul>
    ${more}
    <p><a href="${pageUrl}" style="color:#CC0007;font-weight:600;">Open the Video Portal in LumDash</a></p>`;
}

async function notifyTeamOfPortalComment(project, client, authorName, text, timecodeSeconds, isReply = false, timecodeEndSeconds = null) {
  queuePortalCommentNotify({
    project,
    client,
    authorName,
    text,
    timecodeSeconds,
    timecodeEndSeconds,
    isReply
  });
}

async function sendPortalNewVersionEmails(project, versionNumber, notes) {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    return { sent: 0, error: 'Email is not configured on the server' };
  }
  const client = await Client.findById(project.clientId?._id || project.clientId);
  if (!client) return { sent: 0, error: 'Client not found' };

  const assignedIds = (project.viewerIds || []).map(String);
  const contacts = (client.contacts || []).filter(c => {
    if (c.revokedAt || !c.email) return false;
    if (!assignedIds.length) return false;
    return assignedIds.includes(String(c._id));
  });
  let tokenDirty = false;
  for (const contact of contacts) {
    if (ensurePersonShareToken(contact, client)) tokenDirty = true;
  }
  if (tokenDirty) await client.save();

  let sent = 0;
  for (const contact of contacts) {
    try {
      const data = {
        recipientName: (contact.name || '').split(' ')[0] || 'there',
        projectTitle: project.title,
        versionNumber,
        notes: notes || '',
        reviewUrl: buildPortalUrl(contact.token, project._id.toString())
      };
      await sgMail.send({
        to: contact.email,
        from: SENDGRID_FROM,
        subject: buildPortalNewVersionSubject(data),
        html: buildPortalNewVersionEmail(data),
        text: buildPortalNewVersionText(data)
      });
      sent += 1;
    } catch (emailErr) {
      console.error(`Portal new-version email failed for ${contact.email}:`, emailErr);
    }
  }
  return { sent, total: contacts.length };
}

async function checkPortalFeedbackDueReminders() {
  try {
    const now = new Date();
    const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dueProjects = await VideoProject.find({
      status: 'in_review',
      feedbackDueAt: { $ne: null, $lte: soon },
      feedbackReminderSentAt: null,
      $or: [
        { 'reviewDecision.status': 'none' },
        { 'reviewDecision.status': { $exists: false } },
        { reviewDecision: null },
        { reviewDecision: { $exists: false } }
      ]
    }).limit(50);

    for (const project of dueProjects) {
      const due = new Date(project.feedbackDueAt);
      const past = due < now;
      const dueLabel = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      await notifyTeamPortalEvent({
        project,
        type: 'portal_feedback_due',
        title: past
          ? `Feedback overdue — "${project.title}"`
          : `Feedback due soon — "${project.title}"`,
        message: past
          ? `Client feedback was due ${dueLabel}.`
          : `Client feedback is due ${dueLabel}.`,
        emailSubject: past
          ? `Overdue feedback — ${project.title}`
          : `Feedback due soon — ${project.title}`
      });
      project.feedbackReminderSentAt = now;
      await project.save();
      await logPortalActivity({
        projectId: project._id,
        clientId: project.clientId,
        type: 'due_set',
        actorType: 'system',
        actorName: 'LumDash',
        message: past ? `Overdue reminder sent (due ${dueLabel})` : `Due-soon reminder sent (due ${dueLabel})`
      });
    }
  } catch (err) {
    console.error('Portal feedback due reminder check failed:', err);
  }
}

// Kick off due-date reminder sweep shortly after boot, then hourly
setTimeout(() => {
  checkPortalFeedbackDueReminders();
  setInterval(checkPortalFeedbackDueReminders, 60 * 60 * 1000);
}, 15000);

// ---------- Internal: clients ----------

// List clients with project counts
app.get('/api/portal-clients', authenticate, async (req, res) => {
  try {
    // Backfill share tokens for clients created before shared links existed
    const missingShare = await Client.find({ $or: [{ shareToken: { $exists: false } }, { shareToken: null }, { shareToken: '' }] });
    for (const c of missingShare) {
      c.shareToken = require('crypto').randomBytes(32).toString('hex');
      await c.save();
    }

    const includeArchived = req.query.archived === '1';
    const clients = await Client.find(includeArchived ? {} : { archived: false }).sort({ name: 1 });
    for (const c of clients) {
      let dirty = false;
      for (const ct of c.contacts || []) {
        if (!ct.revokedAt && ensurePersonShareToken(ct, c)) dirty = true;
      }
      if (dirty) await c.save();
    }
    const counts = await VideoProject.aggregate([
      { $group: { _id: { clientId: '$clientId', status: '$status' }, n: { $sum: 1 } } }
    ]);
    const countMap = {};
    counts.forEach(c => {
      const id = c._id.clientId.toString();
      countMap[id] = countMap[id] || { total: 0, in_review: 0, delivered: 0, archived: 0 };
      countMap[id][c._id.status] = c.n;
      countMap[id].total += c.n;
    });
    res.json(clients.map(c => ({
      ...sanitizePortalClient(c),
      projectCounts: countMap[c._id.toString()] || { total: 0, in_review: 0, delivered: 0, archived: 0 }
    })));
  } catch (err) {
    console.error('Error listing portal clients:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create client (optionally with initial contacts)
app.post('/api/portal-clients', authenticate, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Client name is required' });

    const contacts = (Array.isArray(req.body.contacts) ? req.body.contacts : [])
      .map(c => ({ name: String(c.name || '').trim(), email: String(c.email || '').trim().toLowerCase() }))
      .filter(c => c.email);

    const client = await Client.create({
      name,
      notes: String(req.body.notes || '').trim(),
      contacts,
      createdBy: req.user.id,
      createdByName: req.user.fullName || req.user.email || ''
    });
    res.status(201).json(sanitizePortalClient(client));
  } catch (err) {
    console.error('Error creating portal client:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Edit client name/notes/archived/folders/branding/PIN
app.put('/api/portal-clients/:id', authenticate, async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'Client name is required' });
      client.name = name;
    }
    if (req.body.notes !== undefined) client.notes = String(req.body.notes).trim();
    if (req.body.archived !== undefined) client.archived = !!req.body.archived;

    if (req.body.clearPortalPin === true) {
      client.portalPinHash = '';
    } else if (req.body.portalPin !== undefined) {
      const pin = String(req.body.portalPin || '').trim();
      if (!pin) {
        client.portalPinHash = '';
      } else if (!/^\d{4,8}$/.test(pin)) {
        return res.status(400).json({ error: 'PIN must be 4–8 digits' });
      } else {
        client.portalPinHash = await bcrypt.hash(pin, 10);
      }
    }

    if (req.body.branding && typeof req.body.branding === 'object') {
      if (!client.branding) client.branding = {};
      if (req.body.branding.displayName !== undefined) {
        client.branding.displayName = String(req.body.branding.displayName || '').trim();
      }
      if (req.body.branding.accentColor !== undefined) {
        const accent = normalizePortalAccent(req.body.branding.accentColor);
        if (!accent) return res.status(400).json({ error: 'Accent color must be a hex value like #CC0007' });
        client.branding.accentColor = accent;
      }
      client.markModified('branding');
    }

    if (Array.isArray(req.body.folders)) {
      const oldIds = (client.folders || []).map(f => String(f._id));
      const incoming = req.body.folders
        .map((f, i) => ({
          _id: f._id || f.id || null,
          name: String(f.name || '').trim(),
          sortOrder: Number.isFinite(Number(f.sortOrder)) ? Number(f.sortOrder) : i
        }))
        .filter(f => f.name);

      const nextFolders = [];
      for (const item of incoming) {
        const existing = item._id ? findClientFolder(client, item._id) : null;
        if (existing) {
          existing.name = item.name;
          existing.sortOrder = item.sortOrder;
          nextFolders.push(existing);
        } else {
          nextFolders.push({ name: item.name, sortOrder: item.sortOrder });
        }
      }
      client.folders = nextFolders;
      await client.save();

      const stillIds = new Set((client.folders || []).map(f => String(f._id)));
      const removed = oldIds.filter(id => !stillIds.has(id));
      if (removed.length) {
        await VideoProject.updateMany(
          { clientId: client._id, folderId: { $in: removed } },
          { $set: { folderId: null, category: '' } }
        );
      }
      for (const folder of client.folders) {
        await VideoProject.updateMany(
          { clientId: client._id, folderId: folder._id },
          { $set: { category: folder.name } }
        );
      }
      return res.json(sanitizePortalClient(client));
    }

    await client.save();
    res.json(sanitizePortalClient(client));
  } catch (err) {
    console.error('Error updating portal client:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload / replace client portal logo
app.post('/api/portal-clients/:id/logo', authenticate, portalThumbnailUpload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          folder: 'lumdash/portal-client-logos',
          public_id: `client_logo_${client._id}_${Date.now()}`,
          transformation: [
            { width: 400, height: 400, crop: 'limit' },
            { quality: 'auto', fetch_format: 'auto' }
          ]
        },
        (error, result) => error ? reject(error) : resolve(result)
      );
      uploadStream.end(req.file.buffer);
    });

    if (!client.branding) client.branding = {};
    if (client.branding.logoPublicId) {
      try {
        await cloudinary.uploader.destroy(client.branding.logoPublicId, { resource_type: 'image' });
      } catch (cloudErr) {
        console.error('Failed to delete old client logo:', cloudErr);
      }
    }
    client.branding.logoUrl = uploadResult.secure_url;
    client.branding.logoPublicId = uploadResult.public_id;
    client.markModified('branding');
    await client.save();
    res.json({ branding: portalBrandingPayload(client), logoPublicId: client.branding.logoPublicId });
  } catch (err) {
    console.error('Error uploading client logo:', err);
    res.status(500).json({ error: err.message || 'Failed to upload logo' });
  }
});

app.delete('/api/portal-clients/:id/logo', authenticate, async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (!client.branding) client.branding = {};
    if (client.branding.logoPublicId) {
      try {
        await cloudinary.uploader.destroy(client.branding.logoPublicId, { resource_type: 'image' });
      } catch (cloudErr) {
        console.error('Failed to delete client logo:', cloudErr);
      }
    }
    client.branding.logoUrl = '';
    client.branding.logoPublicId = '';
    client.markModified('branding');
    await client.save();
    res.json({ branding: portalBrandingPayload(client) });
  } catch (err) {
    console.error('Error removing client logo:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create folders from distinct project category strings and assign matching projects
app.post('/api/portal-clients/:id/folders/from-categories', authenticate, async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const projects = await VideoProject.find({
      clientId: client._id,
      $or: [{ folderId: null }, { folderId: { $exists: false } }],
      category: { $nin: [null, ''] }
    }).select('_id category');

    const byCat = new Map();
    for (const p of projects) {
      const cat = String(p.category || '').trim();
      if (!cat) continue;
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(p._id);
    }

    const existingNames = new Set((client.folders || []).map(f => f.name.toLowerCase()));
    let sortBase = (client.folders || []).reduce((m, f) => Math.max(m, f.sortOrder || 0), -1) + 1;
    let created = 0;

    for (const [cat, ids] of byCat.entries()) {
      let folder = (client.folders || []).find(f => f.name.toLowerCase() === cat.toLowerCase());
      if (!folder) {
        client.folders.push({ name: cat, sortOrder: sortBase++ });
        created++;
        await client.save();
        folder = client.folders[client.folders.length - 1];
      } else if (!existingNames.has(cat.toLowerCase())) {
        // already counted
      }
      await VideoProject.updateMany(
        { _id: { $in: ids }, clientId: client._id },
        { $set: { folderId: folder._id, category: folder.name } }
      );
    }

    await client.save();
    res.json({ client: sanitizePortalClient(client), created, assigned: projects.length });
  } catch (err) {
    console.error('Error converting categories to folders:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete client (admin) — only when it has no projects
app.delete('/api/portal-clients/:id', authenticate, async (req, res) => {
  try {
    if (!isPortalAdmin(req.user)) return res.status(403).json({ error: 'Admin access required' });
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const projectCount = await VideoProject.countDocuments({ clientId: client._id });
    if (projectCount > 0) {
      return res.status(400).json({ error: `This client has ${projectCount} project(s). Delete or move them first.` });
    }
    if (client.branding?.logoPublicId) {
      try {
        await cloudinary.uploader.destroy(client.branding.logoPublicId, { resource_type: 'image' });
      } catch (_) { /* ignore */ }
    }
    await Client.deleteOne({ _id: client._id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting portal client:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add contact
app.post('/api/portal-clients/:id/contacts', authenticate, async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const email = String(req.body.email || '').trim().toLowerCase();
    if (email && client.contacts.some(c => c.email && c.email === email && !c.revokedAt)) {
      return res.status(400).json({ error: 'This email is already a person on this client' });
    }

    client.contacts.push({
      name,
      email,
      token: require('crypto').randomBytes(32).toString('hex')
    });
    await client.save();
    res.status(201).json(sanitizePortalClient(client));
  } catch (err) {
    console.error('Error adding portal contact:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove contact (revokes their portal link)
app.delete('/api/portal-clients/:id/contacts/:contactId', authenticate, async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const contact = client.contacts.id(req.params.contactId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const contactId = contact._id;
    contact.deleteOne();
    await client.save();
    await VideoProject.updateMany(
      { clientId: client._id },
      { $pull: { viewerIds: contactId } }
    );
    res.json(sanitizePortalClient(client));
  } catch (err) {
    console.error('Error removing portal contact:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Replace which of this client's projects a person can see
app.put('/api/portal-clients/:id/contacts/:contactId/projects', authenticate, async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const contact = client.contacts.id(req.params.contactId);
    if (!contact || contact.revokedAt) return res.status(404).json({ error: 'Contact not found' });

    const wanted = new Set(
      (Array.isArray(req.body.projectIds) ? req.body.projectIds : []).map(String)
    );
    const personId = String(contact._id);
    const clientProjects = await VideoProject.find({
      clientId: client._id,
      status: { $ne: 'archived' }
    });

    for (const project of clientProjects) {
      const others = (project.viewerIds || [])
        .map(id => id.toString())
        .filter(id => id !== personId);
      if (wanted.has(project._id.toString())) others.push(personId);
      project.viewerIds = sanitizeViewerIds(client, others);
      await project.save();
    }

    res.json({ success: true, projectIds: [...wanted] });
  } catch (err) {
    console.error('Error updating person project access:', err);
    res.status(500).json({ error: 'Failed to update video access' });
  }
});

// Send (or resend) a portal invite email to a contact
app.post('/api/portal-clients/:id/contacts/:contactId/invite', authenticate, async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const contact = client.contacts.id(req.params.contactId);
    if (!contact || contact.revokedAt) return res.status(404).json({ error: 'Contact not found' });
    if (!contact.email) return res.status(400).json({ error: 'Add an email for this person before sending their link' });

    if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
      return res.status(400).json({ error: 'Email is not configured on the server' });
    }

    ensurePersonShareToken(contact, client);
    const data = {
      recipientName: (contact.name || '').split(' ')[0] || 'there',
      clientName: portalBrandingPayload(client).displayName || client.name,
      senderName: req.user.fullName || '',
      portalUrl: buildPortalUrl(contact.token)
    };
    await sgMail.send({
      to: contact.email,
      from: SENDGRID_FROM,
      subject: buildPortalInviteSubject(data),
      html: buildPortalInviteEmail(data),
      text: buildPortalInviteText(data)
    });

    contact.invitedAt = new Date();
    await client.save();
    res.json({ success: true, invitedAt: contact.invitedAt });
  } catch (err) {
    console.error('Error sending portal invite:', err);
    res.status(500).json({ error: 'Failed to send invite email' });
  }
});

// Rotate the company preview shareToken — old full-gallery URL stops working.
// Person links are unchanged.
app.post('/api/portal-clients/:id/share-token/reroll', authenticate, async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    client.shareToken = require('crypto').randomBytes(32).toString('hex');
    await client.save();
    res.json(sanitizePortalClient(client));
  } catch (err) {
    console.error('Error rerolling company preview link:', err);
    res.status(500).json({ error: 'Failed to regenerate company preview link' });
  }
});

// Share team portal link to selected contacts (optional PIN + copy to sender)
app.post('/api/portal-clients/:id/share', authenticate, async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (!client.shareToken) {
      return res.status(400).json({ error: 'This client does not have a team portal link yet' });
    }
    if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
      return res.status(400).json({ error: 'Email is not configured on the server' });
    }

    const contactIds = Array.isArray(req.body.contactIds)
      ? req.body.contactIds.map(String)
      : [];
    const includeSelf = req.body.includeSelf === true || req.body.includeSelf === '1';
    if (!contactIds.length && !includeSelf) {
      return res.status(400).json({ error: 'Select at least one contact, or send a copy to yourself' });
    }

    const activeContacts = (client.contacts || []).filter(c => !c.revokedAt && c.email);
    const selected = activeContacts.filter(c => contactIds.includes(String(c._id)));
    if (contactIds.length && selected.length !== contactIds.length) {
      return res.status(400).json({ error: 'One or more selected contacts were not found' });
    }

    let portalPin = '';
    if (clientHasPortalPin(client)) {
      const pin = String(req.body.portalPin || '').trim();
      if (!pin) {
        return res.status(400).json({ error: 'Enter the portal PIN so it can be included in the email' });
      }
      const ok = await bcrypt.compare(pin, client.portalPinHash);
      if (!ok) return res.status(400).json({ error: 'PIN does not match this portal' });
      portalPin = pin;
    }

    const portalUrl = buildPortalUrl(client.shareToken);
    const clientName = portalBrandingPayload(client).displayName || client.name;
    const senderName = req.user.fullName || req.user.email || '';
    const now = new Date();
    let sent = 0;
    const failures = [];

    for (const contact of selected) {
      try {
        const data = {
          recipientName: (contact.name || '').split(' ')[0] || 'there',
          clientName,
          senderName,
          portalUrl,
          portalPin,
          isCopy: false
        };
        await sgMail.send({
          to: contact.email,
          from: SENDGRID_FROM,
          subject: buildPortalShareSubject(data),
          html: buildPortalShareEmail(data),
          text: buildPortalShareText(data)
        });
        contact.invitedAt = now;
        sent += 1;
      } catch (emailErr) {
        console.error(`Portal share email failed for ${contact.email}:`, emailErr);
        failures.push(contact.email);
      }
    }

    let selfSent = false;
    if (includeSelf) {
      const user = await User.findById(req.user.id).select('email fullName').lean();
      const selfEmail = String(user?.email || '').trim().toLowerCase();
      if (!selfEmail) {
        return res.status(400).json({ error: 'Your account has no email address for a copy' });
      }
      try {
        const data = {
          recipientName: (user.fullName || senderName || '').split(' ')[0] || 'there',
          clientName,
          senderName,
          portalUrl,
          portalPin,
          isCopy: true
        };
        await sgMail.send({
          to: selfEmail,
          from: SENDGRID_FROM,
          subject: buildPortalShareSubject(data),
          html: buildPortalShareEmail(data),
          text: buildPortalShareText(data)
        });
        selfSent = true;
        sent += 1;
      } catch (emailErr) {
        console.error(`Portal share self-copy failed for ${selfEmail}:`, emailErr);
        failures.push(selfEmail);
      }
    }

    if (selected.length) await client.save();

    if (!sent) {
      return res.status(500).json({ error: 'Failed to send portal share emails' });
    }

    res.json({
      success: true,
      sent,
      selfSent,
      failed: failures
    });
  } catch (err) {
    console.error('Error sharing portal:', err);
    res.status(500).json({ error: err.message || 'Failed to share portal' });
  }
});

// ---------- Internal: video projects ----------

// List projects (optionally by client)
app.get('/api/video-projects', authenticate, async (req, res) => {
  try {
    const query = {};
    if (req.query.clientId) query.clientId = req.query.clientId;
    if (req.query.status && ['in_review', 'delivered', 'archived'].includes(req.query.status)) {
      query.status = req.query.status;
    }
    const projects = await VideoProject.find(query).sort({ createdAt: -1 }).populate('clientId', 'name contacts').lean();

    // Unresolved client comment counts for the list badges
    const ids = projects.map(p => p._id);
    const openCounts = await VideoComment.aggregate([
      { $match: { projectId: { $in: ids }, resolved: false } },
      { $group: { _id: '$projectId', n: { $sum: 1 } } }
    ]);
    const openMap = Object.fromEntries(openCounts.map(c => [c._id.toString(), c.n]));

    res.json(projects.map(p => {
      const versions = p.versions || [];
      const latest = versions[versions.length - 1] || null;
      const latestReady = [...versions].reverse().find(v => v.videoStatus === 'ready' && v.bunnyVideoId) || null;
      const latestPayload = latest ? portalVersionPayload(latest) : null;
      if (latestPayload) {
        latestPayload.thumbnailUrl = projectThumbnailUrl(p, latestReady) || latestPayload.thumbnailUrl;
      }
      return {
        ...p,
        clientName: p.clientId?.name || '',
        clientId: p.clientId?._id || p.clientId,
        viewerIds: (p.viewerIds || []).map(id => id.toString()),
        viewerNames: viewerNamesForProject(p, p.clientId),
        openCommentCount: openMap[p._id.toString()] || 0,
        thumbnailUrl: projectThumbnailUrl(p, latestReady),
        latestVersion: latestPayload
      };
    }));
  } catch (err) {
    console.error('Error listing video projects:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create project
app.post('/api/video-projects', authenticate, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const client = await Client.findById(req.body.clientId);
    if (!client) return res.status(400).json({ error: 'Client not found' });

    const project = new VideoProject({
      clientId: client._id,
      eventId: req.body.eventId || null,
      title,
      category: String(req.body.category || '').trim(),
      createdBy: req.user.id,
      createdByName: req.user.fullName || req.user.email || ''
    });
    if (req.body.folderId !== undefined) {
      try {
        await applyProjectFolder(project, client, req.body.folderId);
      } catch (folderErr) {
        return res.status(folderErr.status || 400).json({ error: folderErr.message });
      }
    }
    if (req.body.viewerIds !== undefined) {
      project.viewerIds = sanitizeViewerIds(client, req.body.viewerIds);
    }
    await project.save();
    res.status(201).json(project);
  } catch (err) {
    console.error('Error creating video project:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Project detail (versions with signed playback + comments)
app.get('/api/video-projects/:id', authenticate, async (req, res) => {
  try {
    const project = await VideoProject.findById(req.params.id).populate('clientId', 'name contacts folders branding').lean();
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const comments = await VideoComment.find({ projectId: project._id }).sort({ createdAt: 1 }).lean();
    const latestReady = [...(project.versions || [])].reverse().find(v => v.videoStatus === 'ready' && v.bunnyVideoId) || null;

    let postProductionItem = null;
    if (project.postProductionItemId) {
      postProductionItem = await PostProductionItem.findById(project.postProductionItemId)
        .select('item project editStatus qcStatus deliveryStatus')
        .lean();
    }

    const activity = await VideoPortalActivity.find({ projectId: project._id })
      .sort({ createdAt: -1 })
      .limit(40)
      .lean();

    const clientDoc = project.clientId;
    res.json({
      ...project,
      clientName: clientDoc?.name || '',
      clientContacts: (clientDoc?.contacts || []).filter(c => !c.revokedAt).map(c => ({
        _id: c._id, name: c.name, email: c.email, invitedAt: c.invitedAt, lastAccessAt: c.lastAccessAt, token: c.token
      })),
      clientFolders: portalFoldersPayload(clientDoc),
      clientId: clientDoc?._id || project.clientId,
      folderId: project.folderId || null,
      viewerIds: (project.viewerIds || []).map(id => id.toString()),
      viewerNames: viewerNamesForProject(project, clientDoc),
      thumbnailUrl: projectThumbnailUrl(project, latestReady),
      postProductionItem,
      activity,
      versions: (project.versions || []).map(portalVersionPayload),
      comments: comments.map(portalCommentPayload)
    });
  } catch (err) {
    console.error('Error loading video project:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Edit project (title/category/status/masterFileUrl/due date/PP link); delivering stamps who/when
app.put('/api/video-projects/:id', authenticate, async (req, res) => {
  try {
    const project = await VideoProject.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (req.body.title !== undefined) {
      if (!isPortalAdmin(req.user)) {
        return res.status(403).json({ error: 'Admin access required to rename projects' });
      }
      const title = String(req.body.title).trim();
      if (!title) return res.status(400).json({ error: 'Title is required' });
      project.title = title;
    }
    if (req.body.folderId !== undefined) {
      const client = await Client.findById(project.clientId);
      if (!client) return res.status(400).json({ error: 'Client not found' });
      try {
        await applyProjectFolder(project, client, req.body.folderId);
      } catch (folderErr) {
        return res.status(folderErr.status || 400).json({ error: folderErr.message });
      }
    } else if (req.body.category !== undefined) {
      project.category = String(req.body.category).trim();
    }
    if (req.body.viewerIds !== undefined) {
      const client = await Client.findById(project.clientId);
      if (!client) return res.status(400).json({ error: 'Client not found' });
      project.viewerIds = sanitizeViewerIds(client, req.body.viewerIds);
    }
    if (req.body.masterFileUrl !== undefined) project.masterFileUrl = String(req.body.masterFileUrl).trim();
    if (req.body.allowClientDownload !== undefined) {
      project.allowClientDownload = !!req.body.allowClientDownload;
    }

    if (req.body.feedbackDueAt !== undefined) {
      const raw = req.body.feedbackDueAt;
      if (raw === null || raw === '') {
        project.feedbackDueAt = null;
        project.feedbackReminderSentAt = null;
      } else {
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid feedback due date' });
        project.feedbackDueAt = d;
        project.feedbackReminderSentAt = null;
        await logPortalActivity({
          projectId: project._id,
          clientId: project.clientId,
          type: 'due_set',
          actorType: 'team',
          actorId: req.user.id,
          actorName: req.user.fullName || req.user.email || '',
          message: `Feedback due set to ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        });
      }
    }

    if (req.body.postProductionItemId !== undefined) {
      const ppId = req.body.postProductionItemId;
      if (ppId === null || ppId === '') {
        project.postProductionItemId = null;
      } else {
        const item = await PostProductionItem.findById(ppId).select('_id item project');
        if (!item) return res.status(400).json({ error: 'Post-production item not found' });
        project.postProductionItemId = item._id;
        await logPortalActivity({
          projectId: project._id,
          clientId: project.clientId,
          type: 'pp_linked',
          actorType: 'team',
          actorId: req.user.id,
          actorName: req.user.fullName || req.user.email || '',
          message: `Linked to post-production: ${item.item || item.project || item._id}`,
          metadata: { postProductionItemId: item._id.toString() }
        });
      }
    }

    if (req.body.status !== undefined && ['in_review', 'delivered', 'archived'].includes(req.body.status)) {
      if (req.body.status === 'delivered' && project.status !== 'delivered') {
        project.deliveredAt = new Date();
        project.deliveredBy = req.user.id;
        project.deliveredByName = req.user.fullName || req.user.email || '';
        await logPortalActivity({
          projectId: project._id,
          clientId: project.clientId,
          type: 'delivered',
          actorType: 'team',
          actorId: req.user.id,
          actorName: req.user.fullName || req.user.email || '',
          message: 'Marked delivered'
        });
      }
      project.status = req.body.status;
    }

    await project.save();
    res.json(project);
  } catch (err) {
    console.error('Error updating video project:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete project (admin) — removes Bunny videos and comments too
app.delete('/api/video-projects/:id', authenticate, async (req, res) => {
  try {
    if (!isPortalAdmin(req.user)) return res.status(403).json({ error: 'Admin access required' });
    const project = await VideoProject.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    for (const v of project.versions || []) {
      if (v.bunnyVideoId && bunnyStream.isConfigured()) {
        try { await bunnyStream.deleteVideo(v.bunnyVideoId); }
        catch (bunnyErr) { console.error('Failed to delete Bunny video:', bunnyErr.message); }
      }
    }
    if (project.customThumbnailPublicId) {
      try {
        await cloudinary.uploader.destroy(project.customThumbnailPublicId, { resource_type: 'image' });
      } catch (cloudErr) {
        console.error('Failed to delete portal thumbnail:', cloudErr);
      }
    }
    await VideoComment.deleteMany({ projectId: project._id });
    await VideoProject.deleteOne({ _id: project._id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting video project:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a single version (admin) — removes Bunny video + that version's comments
app.delete('/api/video-projects/:id/versions/:versionId', authenticate, async (req, res) => {
  try {
    if (!isPortalAdmin(req.user)) return res.status(403).json({ error: 'Admin access required' });
    const project = await VideoProject.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const version = project.versions.id(req.params.versionId);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const versionNumber = version.versionNumber;
    const bunnyVideoId = version.bunnyVideoId;
    const versionId = version._id.toString();

    if (bunnyVideoId && bunnyStream.isConfigured()) {
      try { await bunnyStream.deleteVideo(bunnyVideoId); }
      catch (bunnyErr) { console.error('Failed to delete Bunny video:', bunnyErr.message); }
    }

    project.versions.pull({ _id: version._id });

    // Clear approval if it pointed at the deleted cut
    if (project.reviewDecision?.versionId && String(project.reviewDecision.versionId) === versionId) {
      project.reviewDecision = {
        status: 'none',
        note: '',
        versionId: null,
        versionNumber: null,
        decidedByName: '',
        decidedByEmail: '',
        decidedAt: null
      };
    }

    await project.save();
    await VideoComment.deleteMany({ projectId: project._id, versionId: version._id });

    await logPortalActivity({
      projectId: project._id,
      clientId: project.clientId,
      type: 'version_deleted',
      actorType: 'team',
      actorId: req.user.id,
      actorName: req.user.fullName || req.user.email || '',
      message: `Deleted version ${versionNumber}`,
      metadata: { versionNumber, versionId }
    });

    res.json({
      success: true,
      versions: (project.versions || []).map(portalVersionPayload)
    });
  } catch (err) {
    console.error('Error deleting video version:', err);
    res.status(500).json({ error: err.message || 'Failed to delete version' });
  }
});

function tusCredentialPayload(guid) {
  const tus = bunnyStream.createTusUploadCredentials(guid, 86400);
  return {
    ...tus,
    expirationTime: tus.expirationTime,
    AuthorizationExpire: String(tus.expirationTime),
    AuthorizationSignature: tus.signature,
    VideoId: tus.videoId,
    LibraryId: tus.libraryId
  };
}

// Admin: prepare replace of an existing version's file (new Bunny video; swap on complete)
app.post('/api/video-projects/:id/versions/:versionId/replace/prepare', authenticate, async (req, res) => {
  try {
    if (!isPortalAdmin(req.user)) return res.status(403).json({ error: 'Admin access required' });
    if (!bunnyStream.isConfigured()) {
      return res.status(400).json({ error: 'Video hosting is not configured on the server' });
    }

    const project = await VideoProject.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const version = project.versions.id(req.params.versionId);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    // Drop a previous unfinished replace attempt
    if (version.pendingReplaceBunnyVideoId) {
      try { await bunnyStream.deleteVideo(version.pendingReplaceBunnyVideoId); }
      catch (bunnyErr) { console.error('Failed to clean pending replace video:', bunnyErr.message); }
      version.pendingReplaceBunnyVideoId = '';
    }

    const created = await bunnyStream.createVideo(`${project.title} — v${version.versionNumber} (replace)`);
    version.pendingReplaceBunnyVideoId = created.guid;
    await project.save();

    res.json({
      success: true,
      versionId: version._id.toString(),
      versionNumber: version.versionNumber,
      bunnyVideoId: created.guid,
      tus: tusCredentialPayload(created.guid)
    });
  } catch (err) {
    console.error('Error preparing version replace:', err);
    res.status(500).json({ error: err.message || 'Failed to prepare replace' });
  }
});

// Admin: finish replace — swap Bunny ids, keep version + comments
app.post('/api/video-projects/:id/versions/:versionId/replace/complete', authenticate, async (req, res) => {
  try {
    if (!isPortalAdmin(req.user)) return res.status(403).json({ error: 'Admin access required' });

    const project = await VideoProject.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const version = project.versions.id(req.params.versionId);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const pendingId = String(version.pendingReplaceBunnyVideoId || '').trim();
    if (!pendingId) {
      return res.status(400).json({ error: 'No replace upload in progress for this version' });
    }

    const oldBunnyId = version.bunnyVideoId;
    version.bunnyVideoId = pendingId;
    version.pendingReplaceBunnyVideoId = '';
    version.videoStatus = 'processing';
    version.durationSeconds = 0;
    version.uploadedBy = req.user.id;
    version.uploadedByName = req.user.fullName || req.user.email || '';
    version.uploadedAt = new Date();

    // Replacing the cut invalidates approval on this version
    if (project.reviewDecision?.versionId && String(project.reviewDecision.versionId) === String(version._id)) {
      project.reviewDecision = {
        status: 'none',
        note: '',
        versionId: null,
        versionNumber: null,
        decidedByName: '',
        decidedByEmail: '',
        decidedAt: null
      };
    }

    await project.save();

    if (oldBunnyId && oldBunnyId !== pendingId && bunnyStream.isConfigured()) {
      try { await bunnyStream.deleteVideo(oldBunnyId); }
      catch (bunnyErr) { console.error('Failed to delete replaced Bunny video:', bunnyErr.message); }
    }

    await logPortalActivity({
      projectId: project._id,
      clientId: project.clientId,
      type: 'version_replaced',
      actorType: 'team',
      actorId: req.user.id,
      actorName: req.user.fullName || req.user.email || '',
      message: `Replaced file for version ${version.versionNumber}`,
      metadata: { versionNumber: version.versionNumber, versionId: version._id.toString() }
    });

    res.json({ success: true, version: portalVersionPayload(version) });
  } catch (err) {
    console.error('Error completing version replace:', err);
    res.status(500).json({ error: err.message || 'Failed to complete replace' });
  }
});

// Admin: abort replace — delete pending Bunny video, keep current file
app.post('/api/video-projects/:id/versions/:versionId/replace/fail', authenticate, async (req, res) => {
  try {
    if (!isPortalAdmin(req.user)) return res.status(403).json({ error: 'Admin access required' });

    const project = await VideoProject.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const version = project.versions.id(req.params.versionId);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const pendingId = String(version.pendingReplaceBunnyVideoId || '').trim();
    if (pendingId && bunnyStream.isConfigured()) {
      try { await bunnyStream.deleteVideo(pendingId); }
      catch (bunnyErr) { console.error('Failed to delete pending replace video:', bunnyErr.message); }
    }
    version.pendingReplaceBunnyVideoId = '';
    await project.save();

    res.json({ success: true, version: portalVersionPayload(version) });
  } catch (err) {
    console.error('Error failing version replace:', err);
    res.status(500).json({ error: err.message || 'Failed to abort replace' });
  }
});

async function notifyClientsNewVersion({ project, versionNumber, notes, notifyClient }) {
  if (!notifyClient || !process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) return;
  const client = project.clientId?.contacts
    ? project.clientId
    : await Client.findById(project.clientId).select('name contacts shareToken');
  if (!client) return;
  const assignedIds = (project.viewerIds || []).map(String);
  const contacts = (client.contacts || [])
    .filter(c => !c.revokedAt && c.email && assignedIds.includes(String(c._id)))
    .map(c => ({ name: c.name, email: c.email, token: c.token }));
  const projectId = project._id.toString();
  const projectTitle = project.title;
  for (const contact of contacts) {
    try {
      const data = {
        recipientName: (contact.name || '').split(' ')[0] || 'there',
        projectTitle,
        versionNumber,
        notes,
        reviewUrl: buildPortalUrl(contact.token, projectId)
      };
      await sgMail.send({
        to: contact.email,
        from: SENDGRID_FROM,
        subject: buildPortalNewVersionSubject(data),
        html: buildPortalNewVersionEmail(data),
        text: buildPortalNewVersionText(data)
      });
    } catch (emailErr) {
      console.error(`Portal new-version email failed for ${contact.email}:`, emailErr);
    }
  }
}

// Prepare a version for direct browser → Bunny TUS upload (no file through Render).
app.post('/api/video-projects/:id/versions/prepare', authenticate, async (req, res) => {
  try {
    if (!bunnyStream.isConfigured()) {
      return res.status(400).json({ error: 'Video hosting is not configured on the server' });
    }

    const project = await VideoProject.findById(req.params.id).populate('clientId', 'name contacts shareToken');
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const versionNumber = (project.versions || []).reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;
    const notes = String(req.body.notes || '').trim();
    const notifyClient = req.body.notifyClient === true || req.body.notifyClient === '1';
    const created = await bunnyStream.createVideo(`${project.title} — v${versionNumber}`);

    project.versions.push({
      versionNumber,
      bunnyVideoId: created.guid,
      videoStatus: 'uploading',
      notes,
      uploadedBy: req.user.id,
      uploadedByName: req.user.fullName || req.user.email || ''
    });
    project.reviewDecision = {
      status: 'none',
      note: '',
      versionId: null,
      versionNumber: null,
      decidedByName: '',
      decidedByEmail: '',
      decidedAt: null
    };
    if (project.status === 'archived' || project.status === 'delivered') project.status = 'in_review';
    await project.save();

    const versionId = project.versions[project.versions.length - 1]._id.toString();
    await logPortalActivity({
      projectId: project._id,
      clientId: project.clientId?._id || project.clientId,
      type: 'version_uploaded',
      actorType: 'team',
      actorId: req.user.id,
      actorName: req.user.fullName || req.user.email || '',
      message: `Uploading version ${versionNumber}${notes ? ` — ${notes}` : ''}`,
      metadata: { versionNumber, notifyClient, directBunny: true }
    });

    // Stash notify preference on the version notes metadata via a lightweight field on activity;
    // complete endpoint reads notifyClient from the request body again.
    const tus = bunnyStream.createTusUploadCredentials(created.guid, 86400);
    res.status(201).json({
      success: true,
      versionNumber,
      versionId,
      bunnyVideoId: created.guid,
      notifyClient,
      tus: {
        ...tus,
        // Headers must be strings for some browsers / tus clients
        expirationTime: tus.expirationTime,
        AuthorizationExpire: String(tus.expirationTime),
        AuthorizationSignature: tus.signature,
        VideoId: tus.videoId,
        LibraryId: tus.libraryId
      }
    });
  } catch (err) {
    console.error('Error preparing video version upload:', err);
    res.status(500).json({ error: err.message || 'Failed to prepare upload' });
  }
});

// Mark direct Bunny upload finished → processing + optional client email
app.post('/api/video-projects/:id/versions/:versionId/complete', authenticate, async (req, res) => {
  try {
    const project = await VideoProject.findById(req.params.id).populate('clientId', 'name contacts shareToken');
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const version = project.versions.id(req.params.versionId);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    if (version.videoStatus === 'uploading' || version.videoStatus === 'error') {
      version.videoStatus = 'processing';
      await project.save();
    }

    const notifyClient = req.body.notifyClient === true || req.body.notifyClient === '1';
    if (notifyClient) {
      setImmediate(() => {
        notifyClientsNewVersion({
          project,
          versionNumber: version.versionNumber,
          notes: version.notes || '',
          notifyClient: true
        }).catch(err => console.error('Notify clients after direct upload failed:', err));
      });
    }

    res.json({ success: true, version: portalVersionPayload(version) });
  } catch (err) {
    console.error('Error completing video version upload:', err);
    res.status(500).json({ error: err.message || 'Failed to complete upload' });
  }
});

// Mark direct Bunny upload failed
app.post('/api/video-projects/:id/versions/:versionId/fail', authenticate, async (req, res) => {
  try {
    const project = await VideoProject.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const version = project.versions.id(req.params.versionId);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    if (version.videoStatus === 'uploading') {
      version.videoStatus = 'error';
      await project.save();
    }
    res.json({ success: true, version: portalVersionPayload(version) });
  } catch (err) {
    console.error('Error failing video version upload:', err);
    res.status(500).json({ error: err.message || 'Failed to mark upload error' });
  }
});

// Legacy path: browser → Render → Bunny (kept for fallback; prefer /versions/prepare + TUS).
// Respond as soon as the file is on our server + a Bunny video object exists,
// then push the bytes to Bunny in the background so the browser can show real upload %.
app.post('/api/video-projects/:id/versions', authenticate, portalVideoUpload.single('video'), async (req, res) => {
  const tempPath = req.file?.path;
  let handedOff = false;
  try {
    if (!bunnyStream.isConfigured()) {
      return res.status(400).json({ error: 'Video hosting is not configured on the server' });
    }
    if (!req.file) return res.status(400).json({ error: 'No video file provided' });

    const project = await VideoProject.findById(req.params.id).populate('clientId', 'name contacts shareToken');
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const versionNumber = (project.versions || []).reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;
    const notes = String(req.body.notes || '').trim();
    const notifyClient = req.body.notifyClient === '1';
    const created = await bunnyStream.createVideo(`${project.title} — v${versionNumber}`);

    project.versions.push({
      versionNumber,
      bunnyVideoId: created.guid,
      videoStatus: 'uploading',
      notes,
      uploadedBy: req.user.id,
      uploadedByName: req.user.fullName || req.user.email || ''
    });
    // New cut starts a fresh review round
    project.reviewDecision = {
      status: 'none',
      note: '',
      versionId: null,
      versionNumber: null,
      decidedByName: '',
      decidedByEmail: '',
      decidedAt: null
    };
    if (project.status === 'archived' || project.status === 'delivered') project.status = 'in_review';
    await project.save();

    await logPortalActivity({
      projectId: project._id,
      clientId: project.clientId?._id || project.clientId,
      type: 'version_uploaded',
      actorType: 'team',
      actorId: req.user.id,
      actorName: req.user.fullName || req.user.email || '',
      message: `Uploaded version ${versionNumber}${notes ? ` — ${notes}` : ''}`,
      metadata: { versionNumber, notifyClient }
    });

    const versionId = project.versions[project.versions.length - 1]._id.toString();
    const projectId = project._id.toString();
    const projectTitle = project.title;
    const assignedIds = (project.viewerIds || []).map(String);
    const contacts = (project.clientId?.contacts || [])
      .filter(c => !c.revokedAt && c.email && assignedIds.includes(String(c._id)))
      .map(c => ({ name: c.name, email: c.email, token: c.token }));

    // Client upload is done — return now so the progress bar can finish
    res.status(201).json({
      success: true,
      versionNumber,
      bunnyVideoId: created.guid,
      versionId
    });
    handedOff = true;

    // Background: stream file to Bunny, then mark processing + email clients
    setImmediate(async () => {
      try {
        await bunnyStream.uploadVideoFile(created.guid, tempPath);

        const fresh = await VideoProject.findById(projectId);
        if (fresh) {
          const v = fresh.versions.id(versionId);
          if (v && v.videoStatus === 'uploading') {
            v.videoStatus = 'processing';
            await fresh.save();
          }
        }

        if (notifyClient && process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL) {
          for (const contact of contacts) {
            try {
              const data = {
                recipientName: (contact.name || '').split(' ')[0] || 'there',
                projectTitle,
                versionNumber,
                notes,
                reviewUrl: buildPortalUrl(contact.token, projectId)
              };
              await sgMail.send({
                to: contact.email,
                from: SENDGRID_FROM,
                subject: buildPortalNewVersionSubject(data),
                html: buildPortalNewVersionEmail(data),
                text: buildPortalNewVersionText(data)
              });
            } catch (emailErr) {
              console.error(`Portal new-version email failed for ${contact.email}:`, emailErr);
            }
          }
        }
      } catch (bgErr) {
        console.error('Background Bunny upload failed:', bgErr);
        try {
          const fresh = await VideoProject.findById(projectId);
          const v = fresh?.versions.id(versionId);
          if (v) {
            v.videoStatus = 'error';
            await fresh.save();
          }
        } catch (saveErr) {
          console.error('Failed to mark version as error:', saveErr);
        }
      } finally {
        if (tempPath) {
          require('fs').promises.unlink(tempPath).catch(() => {});
        }
      }
    });
  } catch (err) {
    console.error('Error uploading video version:', err);
    if (tempPath && !handedOff) {
      require('fs').promises.unlink(tempPath).catch(() => {});
    }
    if (!handedOff) {
      res.status(500).json({ error: err.message || 'Upload failed' });
    }
  }
});

// Poll transcoding status for a version (updates duration when ready)
app.get('/api/video-projects/:id/versions/:versionId/status', authenticate, async (req, res) => {
  try {
    const project = await VideoProject.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const version = project.versions.id(req.params.versionId);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    if (version.bunnyVideoId && version.videoStatus !== 'ready' && bunnyStream.isConfigured()) {
      try {
        const info = await bunnyStream.getVideo(version.bunnyVideoId);
        // Bunny status: 4 = finished, 5/6 = failed
        if (info.status === 4) {
          version.videoStatus = 'ready';
          version.durationSeconds = info.length || 0;
          await project.save();
        } else if (info.status === 5 || info.status === 6) {
          version.videoStatus = 'error';
          await project.save();
        }
      } catch (bunnyErr) {
        console.error('Bunny status check failed:', bunnyErr.message);
      }
    }
    res.json(portalVersionPayload(version));
  } catch (err) {
    console.error('Error checking version status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Team comment on a version
app.post('/api/video-projects/:id/comments', authenticate, async (req, res) => {
  try {
    const project = await VideoProject.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const version = project.versions.id(req.body.versionId);
    if (!version) return res.status(400).json({ error: 'Version not found' });

    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Comment text is required' });

    const { timecodeSeconds, timecodeEndSeconds } = parseTimecodeFields(req.body);
    const mentions = await resolvePortalMentions(req.body.mentionUserIds || req.body.mentions);
    const annotation = sanitizeAnnotation(req.body.annotation);
    const comment = await VideoComment.create({
      projectId: project._id,
      versionId: version._id,
      timecodeSeconds,
      timecodeEndSeconds,
      text,
      mustFix: !!req.body.mustFix,
      annotation,
      mentions,
      authorType: 'team',
      authorId: req.user.id,
      authorName: req.user.fullName || req.user.email || ''
    });

    notifyPortalMentions({
      project,
      mentions,
      actorName: comment.authorName,
      text
    }).catch(err => console.error('Portal mention notify failed:', err));

    res.status(201).json(portalCommentPayload(comment));
  } catch (err) {
    console.error('Error creating team comment:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Team reply to a comment
app.post('/api/video-comments/:commentId/replies', authenticate, async (req, res) => {
  try {
    const comment = await VideoComment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Reply text is required' });

    comment.replies.push({
      text,
      authorType: 'team',
      authorId: req.user.id,
      authorName: req.user.fullName || req.user.email || ''
    });
    await comment.save();

    const mentionIds = req.body.mentionUserIds || req.body.mentions;
    if (mentionIds?.length) {
      const project = await VideoProject.findById(comment.projectId);
      const mentions = await resolvePortalMentions(mentionIds);
      if (project && mentions.length) {
        notifyPortalMentions({
          project,
          mentions,
          actorName: req.user.fullName || req.user.email || 'Team',
          text
        }).catch(err => console.error('Portal mention notify failed:', err));
      }
    }

    res.json(portalCommentPayload(comment));
  } catch (err) {
    console.error('Error replying to comment:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Resolve / unresolve a comment
app.put('/api/video-comments/:commentId/resolve', authenticate, async (req, res) => {
  try {
    const comment = await VideoComment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    comment.resolved = !!req.body.resolved;
    if (comment.resolved) {
      comment.resolvedBy = req.user.id;
      comment.resolvedByName = req.user.fullName || req.user.email || '';
      comment.resolvedAt = new Date();
    } else {
      comment.resolvedBy = null;
      comment.resolvedByName = '';
      comment.resolvedAt = null;
    }
    await comment.save();
    res.json(portalCommentPayload(comment));
  } catch (err) {
    console.error('Error resolving comment:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Toggle must-fix priority on a comment
app.put('/api/video-comments/:commentId/priority', authenticate, async (req, res) => {
  try {
    const comment = await VideoComment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    comment.mustFix = !!req.body.mustFix;
    await comment.save();
    res.json(portalCommentPayload(comment));
  } catch (err) {
    console.error('Error updating comment priority:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- Public: client portal (magic link, no auth) ----------

// Unlock a PIN-protected portal (returns short-lived unlock JWT for X-Portal-Unlock)
app.post('/api/portal/:token/unlock', async (req, res) => {
  try {
    const resolved = await resolvePortalToken(req.params.token);
    if (!resolved) return res.status(404).json({ error: 'This portal link is no longer valid. Please contact us for a new one.' });
    const { client } = resolved;

    if (!clientHasPortalPin(client)) {
      return res.json({ success: true, unlockToken: null, pinRequired: false });
    }

    const pin = String(req.body.pin || '').trim();
    if (!pin) return res.status(400).json({ error: 'PIN is required' });
    const ok = await bcrypt.compare(pin, client.portalPinHash);
    if (!ok) return res.status(401).json({ error: 'Incorrect PIN' });

    const unlockToken = jwt.sign(
      { purpose: 'portal_unlock', clientId: client._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ success: true, unlockToken, pinRequired: true });
  } catch (err) {
    console.error('Error unlocking portal:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Portal home: client info + their projects
app.get('/api/portal/:token', async (req, res) => {
  try {
    const resolved = await resolvePortalToken(req.params.token);
    if (!resolved) return res.status(404).json({ error: 'This portal link is no longer valid. Please contact us for a new one.' });
    const { client, contact, shared } = resolved;

    if (!verifyPortalUnlockHeader(req, client)) {
      return res.status(403).json(portalPinRequiredResponse(client));
    }

    if (contact) {
      contact.lastAccessAt = new Date();
      client.save().catch(() => {});
    }

    logPortalActivity({
      clientId: client._id,
      type: 'portal_opened',
      actorType: 'client',
      actorName: contact?.name || (shared ? 'Shared link visitor' : ''),
      actorEmail: contact?.email || '',
      message: 'Opened the client portal'
    });

    const projects = await VideoProject.find({
      clientId: client._id,
      status: { $in: ['in_review', 'delivered'] }
    }).sort({ createdAt: -1 }).lean();

    const visible = projects.filter(p => projectVisibleToPortal(p, resolved));

    res.json({
      clientName: client.name,
      contactName: contact?.name || '',
      shared: true,
      person: !!resolved.person,
      pinRequired: clientHasPortalPin(client),
      branding: portalBrandingPayload(client),
      folders: portalFoldersPayload(client),
      projects: visible.map(p => {
        const versions = p.versions || [];
        const latest = versions[versions.length - 1] || null;
        const latestReady = [...versions].reverse().find(v => v.videoStatus === 'ready' && v.bunnyVideoId) || null;
        return {
          _id: p._id,
          title: p.title,
          category: p.category || '',
          folderId: p.folderId || null,
          status: p.status,
          reviewDecision: p.reviewDecision || { status: 'none' },
          feedbackDueAt: p.feedbackDueAt || null,
          deliveredAt: p.deliveredAt,
          masterFileUrl: portalMasterDownloadUrl(p),
          allowClientDownload: p.allowClientDownload !== false,
          versionCount: versions.length,
          latestVersionNumber: latest ? latest.versionNumber : 0,
          latestVersionStatus: latest ? latest.videoStatus : null,
          thumbnailUrl: projectThumbnailUrl(p, latestReady),
          updatedAt: p.updatedAt
        };
      })
    });
  } catch (err) {
    console.error('Error loading portal:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Portal project detail: playable versions + comment threads
app.get('/api/portal/:token/projects/:projectId', async (req, res) => {
  try {
    const resolved = await resolvePortalToken(req.params.token);
    if (!resolved) return res.status(404).json({ error: 'This portal link is no longer valid. Please contact us for a new one.' });
    const { client, contact, shared } = resolved;

    if (!verifyPortalUnlockHeader(req, client)) {
      return res.status(403).json(portalPinRequiredResponse(client));
    }

    const project = await VideoProject.findOne({ _id: req.params.projectId, clientId: client._id }).lean();
    if (!project || project.status === 'archived') return res.status(404).json({ error: 'Project not found' });
    if (!projectVisibleToPortal(project, resolved)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    logPortalActivity({
      projectId: project._id,
      clientId: client._id,
      type: 'project_viewed',
      actorType: 'client',
      actorName: contact?.name || (shared ? 'Shared link visitor' : ''),
      actorEmail: contact?.email || '',
      message: `Viewed "${project.title}"`
    });

    const comments = await VideoComment.find({ projectId: project._id }).sort({ createdAt: 1 }).lean();
    res.json({
      _id: project._id,
      title: project.title,
      category: project.category || '',
      folderId: project.folderId || null,
      status: project.status,
      reviewDecision: project.reviewDecision || { status: 'none' },
      feedbackDueAt: project.feedbackDueAt || null,
      deliveredAt: project.deliveredAt,
      masterFileUrl: portalMasterDownloadUrl(project),
      allowClientDownload: project.allowClientDownload !== false,
      branding: portalBrandingPayload(client),
      versions: (project.versions || []).map(portalVersionPayload),
      comments: comments.map(portalCommentPayload)
    });
  } catch (err) {
    console.error('Error loading portal project:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Client approve on the current cut
app.post('/api/portal/:token/projects/:projectId/decision', async (req, res) => {
  try {
    const resolved = await resolvePortalToken(req.params.token);
    if (!resolved) return res.status(404).json({ error: 'This portal link is no longer valid. Please contact us for a new one.' });
    const { client, contact } = resolved;

    if (!verifyPortalUnlockHeader(req, client)) {
      return res.status(403).json(portalPinRequiredResponse(client));
    }

    const decision = String(req.body.decision || '').toLowerCase();
    if (decision !== 'approved') {
      return res.status(400).json({ error: 'decision must be "approved"' });
    }

    const project = await VideoProject.findOne({ _id: req.params.projectId, clientId: client._id });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!projectVisibleToPortal(project, resolved)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    if (project.status !== 'in_review') {
      return res.status(400).json({ error: 'This project is no longer open for review' });
    }

    const versions = project.versions || [];
    const latest = versions[versions.length - 1];
    if (!latest) return res.status(400).json({ error: 'No version to review yet' });

    const authorName = String(req.body.authorName || '').trim().slice(0, 80);
    if (!authorName) return res.status(400).json({ error: 'Please enter your name' });

    project.reviewDecision = {
      status: 'approved',
      note: '',
      versionId: latest._id,
      versionNumber: latest.versionNumber,
      decidedByName: authorName,
      decidedByEmail: contact?.email || '',
      decidedAt: new Date()
    };
    await project.save();

    await logPortalActivity({
      projectId: project._id,
      clientId: client._id,
      type: 'approved',
      actorType: 'client',
      actorName: authorName,
      actorEmail: contact?.email || '',
      message: `Approved v${latest.versionNumber}`,
      metadata: { versionNumber: latest.versionNumber }
    });

    notifyTeamPortalEvent({
      project,
      type: 'portal_decision',
      title: `${authorName} approved "${project.title}"`,
      message: `${authorName} approved version ${latest.versionNumber}.`,
      emailSubject: `Approved — ${project.title}`
    }).catch(err => console.error('Portal decision notification failed:', err));

    res.json({ success: true, reviewDecision: project.reviewDecision });
  } catch (err) {
    console.error('Error saving portal decision:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Client adds a comment (timestamped or general)
app.post('/api/portal/:token/projects/:projectId/comments', async (req, res) => {
  try {
    const resolved = await resolvePortalToken(req.params.token);
    if (!resolved) return res.status(404).json({ error: 'This portal link is no longer valid. Please contact us for a new one.' });
    const { client, contact } = resolved;

    if (!verifyPortalUnlockHeader(req, client)) {
      return res.status(403).json(portalPinRequiredResponse(client));
    }

    const project = await VideoProject.findOne({ _id: req.params.projectId, clientId: client._id });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!projectVisibleToPortal(project, resolved)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const version = project.versions.id(req.body.versionId);
    if (!version) return res.status(400).json({ error: 'Version not found' });

    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Comment text is required' });
    if (text.length > 5000) return res.status(400).json({ error: 'Comment is too long' });

    const authorName = String(req.body.authorName || '').trim().slice(0, 80);
    if (!authorName) return res.status(400).json({ error: 'Please enter your name so we know who this feedback is from' });

    const { timecodeSeconds, timecodeEndSeconds } = parseTimecodeFields(req.body);
    const annotation = sanitizeAnnotation(req.body.annotation);
    const comment = await VideoComment.create({
      projectId: project._id,
      versionId: version._id,
      timecodeSeconds,
      timecodeEndSeconds,
      text,
      mustFix: !!req.body.mustFix,
      annotation,
      authorType: 'client',
      authorName,
      authorEmail: contact?.email || ''
    });

    notifyTeamOfPortalComment(project, client, authorName, text, comment.timecodeSeconds, false, comment.timecodeEndSeconds)
      .catch(err => console.error('Portal comment notification failed:', err));

    logPortalActivity({
      projectId: project._id,
      clientId: client._id,
      type: 'commented',
      actorType: 'client',
      actorName: authorName,
      actorEmail: contact?.email || '',
      message: text.length > 120 ? `${text.slice(0, 120)}…` : text,
      metadata: {
        versionId: version._id.toString(),
        timecodeSeconds: comment.timecodeSeconds,
        timecodeEndSeconds: comment.timecodeEndSeconds
      }
    });

    res.status(201).json(portalCommentPayload(comment));
  } catch (err) {
    console.error('Error creating portal comment:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Client replies to a comment thread
app.post('/api/portal/:token/comments/:commentId/replies', async (req, res) => {
  try {
    const resolved = await resolvePortalToken(req.params.token);
    if (!resolved) return res.status(404).json({ error: 'This portal link is no longer valid. Please contact us for a new one.' });
    const { client, contact } = resolved;

    if (!verifyPortalUnlockHeader(req, client)) {
      return res.status(403).json(portalPinRequiredResponse(client));
    }

    const comment = await VideoComment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    const project = await VideoProject.findOne({ _id: comment.projectId, clientId: client._id });
    if (!project) return res.status(404).json({ error: 'Comment not found' });
    if (!projectVisibleToPortal(project, resolved)) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Reply text is required' });
    if (text.length > 5000) return res.status(400).json({ error: 'Reply is too long' });

    const authorName = String(req.body.authorName || '').trim().slice(0, 80);
    if (!authorName) return res.status(400).json({ error: 'Please enter your name so we know who this feedback is from' });

    comment.replies.push({
      text,
      authorType: 'client',
      authorName
    });
    await comment.save();

    notifyTeamOfPortalComment(project, client, authorName, text, null, true)
      .catch(err => console.error('Portal reply notification failed:', err));

    logPortalActivity({
      projectId: project._id,
      clientId: client._id,
      type: 'replied',
      actorType: 'client',
      actorName: authorName,
      actorEmail: contact?.email || '',
      message: text.length > 120 ? `${text.slice(0, 120)}…` : text
    });

    res.json(portalCommentPayload(comment));
  } catch (err) {
    console.error('Error creating portal reply:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Bulk email all client contacts that a version is ready for review
app.post('/api/video-projects/:id/notify-clients', authenticate, async (req, res) => {
  try {
    const project = await VideoProject.findById(req.params.id).populate('clientId', 'name contacts shareToken');
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const versions = project.versions || [];
    const latest = versions[versions.length - 1];
    if (!latest) return res.status(400).json({ error: 'Upload a version before notifying clients' });

    const notes = String(req.body.notes || latest.notes || '').trim();
    const result = await sendPortalNewVersionEmails(project, latest.versionNumber, notes);

    await logPortalActivity({
      projectId: project._id,
      clientId: project.clientId?._id || project.clientId,
      type: 'clients_notified',
      actorType: 'team',
      actorId: req.user.id,
      actorName: req.user.fullName || req.user.email || '',
      message: `Notified ${result.sent} contact${result.sent !== 1 ? 's' : ''} about v${latest.versionNumber}`,
      metadata: result
    });

    if (result.error && result.sent === 0) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ success: true, ...result, versionNumber: latest.versionNumber });
  } catch (err) {
    console.error('Error notifying portal clients:', err);
    res.status(500).json({ error: 'Failed to notify clients' });
  }
});

// Lightweight PP item picker for linking
app.get('/api/portal-post-production-options', authenticate, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const filter = { archived: { $ne: true } };
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ item: rx }, { project: rx }];
    }
    const items = await PostProductionItem.find(filter)
      .select('item project editStatus qcStatus deliveryStatus')
      .sort({ updatedAt: -1 })
      .limit(40)
      .lean();
    res.json(items);
  } catch (err) {
    console.error('Error listing PP options for portal:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload / replace a custom project thumbnail (gallery cover + Bunny player cover when possible)
app.post('/api/video-projects/:id/thumbnail', authenticate, portalThumbnailUpload.single('thumbnail'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });

    const project = await VideoProject.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          folder: 'lumdash/portal-thumbnails',
          public_id: `portal_${project._id}_${Date.now()}`,
          transformation: [
            { width: 1280, height: 720, crop: 'fill', gravity: 'auto' },
            { quality: 'auto', fetch_format: 'auto' }
          ]
        },
        (error, result) => error ? reject(error) : resolve(result)
      );
      uploadStream.end(req.file.buffer);
    });

    // Remove previous Cloudinary asset if any
    if (project.customThumbnailPublicId) {
      try {
        await cloudinary.uploader.destroy(project.customThumbnailPublicId, { resource_type: 'image' });
      } catch (cloudErr) {
        console.error('Failed to delete old portal thumbnail:', cloudErr);
      }
    }

    project.customThumbnailUrl = uploadResult.secure_url;
    project.customThumbnailPublicId = uploadResult.public_id;
    await project.save();

    // Best-effort: also push onto Bunny for ready versions so the player cover matches
    if (bunnyStream.isConfigured()) {
      const readyIds = (project.versions || [])
        .filter(v => v.videoStatus === 'ready' && v.bunnyVideoId)
        .map(v => v.bunnyVideoId);
      for (const videoId of readyIds) {
        try {
          await bunnyStream.setThumbnail(videoId, req.file.buffer, req.file.mimetype);
        } catch (bunnyErr) {
          console.error(`Bunny thumbnail sync failed for ${videoId}:`, bunnyErr.message);
        }
      }
    }

    const latestReady = [...(project.versions || [])].reverse().find(v => v.videoStatus === 'ready' && v.bunnyVideoId) || null;
    res.json({
      success: true,
      customThumbnailUrl: project.customThumbnailUrl,
      thumbnailUrl: projectThumbnailUrl(project, latestReady)
    });
  } catch (err) {
    console.error('Error uploading portal thumbnail:', err);
    res.status(500).json({ error: err.message || 'Thumbnail upload failed' });
  }
});

// Capture approximate frame at playhead (Bunny seek sprite) → custom project thumbnail
app.post('/api/video-projects/:id/thumbnail-from-frame', authenticate, async (req, res) => {
  try {
    if (!bunnyStream.isConfigured()) {
      return res.status(503).json({ error: 'Video hosting is not configured' });
    }

    const timeSeconds = Number(req.body?.timeSeconds);
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
      return res.status(400).json({ error: 'timeSeconds is required' });
    }

    const project = await VideoProject.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const versionId = req.body?.versionId || null;
    let version = versionId
      ? (project.versions || []).id(versionId) || (project.versions || []).find(v => String(v._id) === String(versionId))
      : null;
    if (!version) {
      version = [...(project.versions || [])].reverse().find(v => v.videoStatus === 'ready' && v.bunnyVideoId) || null;
    }
    if (!version?.bunnyVideoId || version.videoStatus !== 'ready') {
      return res.status(400).json({ error: 'No ready video version to capture a frame from' });
    }

    const frame = await bunnyStream.extractFrameAtTime(version.bunnyVideoId, timeSeconds);

    const transformation = frame.crop
      ? [
          { crop: 'crop', x: frame.crop.x, y: frame.crop.y, width: frame.crop.width, height: frame.crop.height },
          { width: 1280, height: 720, crop: 'fill', gravity: 'center' },
          { quality: 'auto', fetch_format: 'auto' }
        ]
      : [
          { width: 1280, height: 720, crop: 'fill', gravity: 'center' },
          { quality: 'auto', fetch_format: 'auto' }
        ];

    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          folder: 'lumdash/portal-thumbnails',
          public_id: `portal_${project._id}_${Date.now()}`,
          transformation
        },
        (error, result) => error ? reject(error) : resolve(result)
      );
      uploadStream.end(frame.buffer);
    });

    if (project.customThumbnailPublicId) {
      try {
        await cloudinary.uploader.destroy(project.customThumbnailPublicId, { resource_type: 'image' });
      } catch (cloudErr) {
        console.error('Failed to delete old portal thumbnail:', cloudErr);
      }
    }

    project.customThumbnailUrl = uploadResult.secure_url;
    project.customThumbnailPublicId = uploadResult.public_id;
    await project.save();

    // Best-effort: sync player cover on Bunny for ready versions
    const readyIds = (project.versions || [])
      .filter(v => v.videoStatus === 'ready' && v.bunnyVideoId)
      .map(v => v.bunnyVideoId);
    for (const videoId of readyIds) {
      try {
        await bunnyStream.setThumbnailFromUrl(videoId, project.customThumbnailUrl);
      } catch (bunnyErr) {
        console.error(`Bunny thumbnail sync failed for ${videoId}:`, bunnyErr.message);
      }
    }

    const latestReady = [...(project.versions || [])].reverse().find(v => v.videoStatus === 'ready' && v.bunnyVideoId) || null;
    res.json({
      success: true,
      customThumbnailUrl: project.customThumbnailUrl,
      thumbnailUrl: projectThumbnailUrl(project, latestReady),
      capturedAtSeconds: frame.timeSeconds,
      captureSource: frame.source
    });
  } catch (err) {
    console.error('Error capturing portal thumbnail from frame:', err);
    res.status(500).json({ error: err.message || 'Could not capture frame thumbnail' });
  }
});

// Clear custom thumbnail (falls back to Bunny auto-generated)
app.delete('/api/video-projects/:id/thumbnail', authenticate, async (req, res) => {
  try {
    const project = await VideoProject.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (project.customThumbnailPublicId) {
      try {
        await cloudinary.uploader.destroy(project.customThumbnailPublicId, { resource_type: 'image' });
      } catch (cloudErr) {
        console.error('Failed to delete portal thumbnail from Cloudinary:', cloudErr);
      }
    }
    project.customThumbnailUrl = '';
    project.customThumbnailPublicId = '';
    await project.save();

    const latestReady = [...(project.versions || [])].reverse().find(v => v.videoStatus === 'ready' && v.bunnyVideoId) || null;
    res.json({
      success: true,
      thumbnailUrl: projectThumbnailUrl(project, latestReady)
    });
  } catch (err) {
    console.error('Error deleting portal thumbnail:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Catch-all for SPA routing — must be registered after every other route
app.get('/folder-logs.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../folder-logs.html'));
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, '../dashboard.html'));
});

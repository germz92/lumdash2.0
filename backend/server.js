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
require('dotenv').config();
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
console.log('SENDGRID_API_KEY loaded:', !!process.env.SENDGRID_API_KEY);
console.log('SENDGRID_FROM_EMAIL:', process.env.SENDGRID_FROM_EMAIL);
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
        'https://spa-lumdash-backend.onrender.com',
        'https://germainedavid.github.io',
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
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
  optionsSuccessStatus: 204,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['rndr-id']
};
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

const User = require('./models/User');
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
    req.user = user;
    next();
  });
}

// AUTH
app.post('/api/auth/register', async (req, res) => {
  const { email, password, fullName, role } = req.body; // 🔥 updated

  const hashed = await bcrypt.hash(password, 10);
  const user = new User({ email, password: hashed, fullName, role: role || 'user' }); // 🔥 updated

  await user.save();
  io.emit('usersChanged'); // Notify all clients
  res.json({ message: 'User created' });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user._id, fullName: user.fullName, role: user.role }, process.env.JWT_SECRET);
  res.json({ token, fullName: user.fullName, role: user.role });
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
    from: process.env.SENDGRID_FROM_EMAIL,
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

// AI CHAT ENDPOINT
app.post('/api/chat/:tableId', authenticate, async (req, res) => {
  try {
    const { message, conversationHistory = [], pageContext = {} } = req.body;
    const tableId = req.params.tableId;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Check if OpenAI is configured
    if (!openai) {
      return res.status(503).json({ 
        error: 'AI chat feature is not available. Please configure OpenAI API key.' 
      });
    }

    // Get the table and verify access
    const table = await Table.findById(tableId);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }
    
    if (!table.owners.includes(req.user.id) && !table.sharedWith.includes(req.user.id)) {
      return res.status(403).json({ error: 'Not authorized to access this event' });
    }

    // Improved data collection - include more context but keep it structured
    const messageKeywords = message.toLowerCase();
    
    // Define broader keyword matching for better data inclusion
    const isScheduleQuery = messageKeywords.match(/schedule|time|when|start|end|session|keynote|presentation|meeting|event|program|agenda/);
    const isCrewQuery = messageKeywords.match(/crew|team|photographer|people|who|assignment|role|staff|person|name|call/);
    const isGearQuery = messageKeywords.match(/gear|camera|equipment|lens|light|audio|pack|reserved|inventory|serial/);
    const isTaskQuery = messageKeywords.match(/task|todo|deadline|complete|done|work|assign/);
    const isTravelQuery = messageKeywords.match(/travel|flight|hotel|accommodation|transport|airline|check/);
    const isCardQuery = messageKeywords.match(/card|memory|storage|sd|cf|media/);
    const isShotQuery = messageKeywords.match(/shot|photo|picture|image|list|checklist/);
    const isGeneralQuery = messageKeywords.match(/location|where|address|contact|client|budget|summary|general|info/);
    
    // Detect personal queries (questions about the current user)
    const isPersonalQuery = messageKeywords.match(/\b(i|my|me|am|do i|when do i|what time do i|where do i|should i)\b/) || 
                            messageKeywords.includes('my call') || 
                            messageKeywords.includes('my time') ||
                            messageKeywords.includes('my assignment') ||
                            messageKeywords.includes('my role');

    const relevantData = {
      eventTitle: table.title,
      currentUser: req.user.fullName,
      currentDate: new Date().toISOString()
    };

    // Always include general info as it's often needed for context
    relevantData.general = table.general || {};
    
    // Add user-specific context
    relevantData.currentUser = {
      id: req.user.id,
      fullName: req.user.fullName,
      role: req.user.role,
      email: req.user.email
    };
    
    // Include data based on broader keyword matching with smart filtering
    if (isScheduleQuery || messageKeywords.includes('today') || messageKeywords.includes('now') || messageKeywords.includes('next') || messageKeywords.includes('keynote')) {
      const allSchedule = table.programSchedule || [];
      
      // Smart filtering: prioritize relevant items to avoid data truncation
      const relevantScheduleItems = [];
      const otherScheduleItems = [];
      
      // Extract search terms from the message for better matching
      const searchTerms = message.toLowerCase()
        .replace(/[^\w\s]/g, ' ') // Remove punctuation
        .split(/\s+/)
        .filter(term => term.length > 2); // Only words longer than 2 chars
      
      for (const item of allSchedule) {
        const itemText = `${item.name || ''} ${item.location || ''} ${item.notes || ''}`.toLowerCase();
        const isRelevant = searchTerms.some(term => itemText.includes(term));
        
        if (isRelevant) {
          relevantScheduleItems.push(item);
        } else {
          otherScheduleItems.push(item);
        }
      }
      
      // Include relevant items first, then add others up to a reasonable limit
      const maxItems = 25; // Reasonable limit to prevent data truncation
      relevantData.programSchedule = [
        ...relevantScheduleItems,
        ...otherScheduleItems.slice(0, Math.max(0, maxItems - relevantScheduleItems.length))
      ];
      
      console.log(`📅 Including schedule data: ${relevantData.programSchedule.length} items (${relevantScheduleItems.length} relevant, ${Math.min(otherScheduleItems.length, maxItems - relevantScheduleItems.length)} others)`);
    }
    
    if (isCrewQuery || isPersonalQuery || messageKeywords.includes('today') || messageKeywords.includes('assigned')) {
      const allCrew = table.rows || [];
      const searchTerms = message.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(term => term.length > 2);
      
      // Filter crew by relevance (name, role, notes) and prioritize current user
      const userCrew = []; // Current user's call times
      const relevantCrew = [];
      const otherCrew = [];
      
      for (const member of allCrew) {
        const memberText = `${member.name || ''} ${member.role || ''} ${member.notes || ''}`.toLowerCase();
        const isCurrentUser = member.name && member.name.toLowerCase().includes(req.user.fullName.toLowerCase().split(' ')[0]);
        const isRelevant = searchTerms.some(term => memberText.includes(term));
        
        if (isCurrentUser) {
          userCrew.push(member); // Always include current user's data
        } else if (isRelevant) {
          relevantCrew.push(member);
        } else {
          otherCrew.push(member);
        }
      }
      
      const maxCrewItems = 20;
      relevantData.rows = [
        ...userCrew, // Current user's call times first
        ...relevantCrew,
        ...otherCrew.slice(0, Math.max(0, maxCrewItems - userCrew.length - relevantCrew.length))
      ];
      
      console.log(`👥 Including crew data: ${relevantData.rows.length} items (${userCrew.length} user, ${relevantCrew.length} relevant)`);
      if (isPersonalQuery) {
        console.log(`👤 Personal query detected for user: ${req.user.fullName}`);
      }
    }
    
    if (isGearQuery) {
      relevantData.gear = table.gear || {};
    }
    
    if (isTaskQuery) {
      relevantData.tasks = table.tasks || [];
    }
    
    if (isTravelQuery) {
      relevantData.travel = table.travel || [];
      relevantData.accommodation = table.accommodation || [];
    }
    
    if (isCardQuery) {
      relevantData.cardLog = table.cardLog || [];
    }
    
    if (isShotQuery) {
      relevantData.shotlists = table.shotlists || [];
    }

    // Add documents and admin notes data
    if (messageKeywords.match(/document|pdf|file|map|floor.*plan|guide|manual/)) {
      relevantData.documents = table.documents || [];
    }
    
    if (messageKeywords.match(/note|admin|important|reminder/)) {
      relevantData.adminNotes = table.adminNotes || [];
    }

    // For general questions or when no specific keywords match, include core data (limited)
    if (!isScheduleQuery && !isCrewQuery && !isGearQuery && !isTaskQuery && !isTravelQuery && !isCardQuery && !isShotQuery) {
      // Include minimal core data for general questions
      relevantData.programSchedule = (table.programSchedule || []).slice(0, 3);
      relevantData.rows = (table.rows || []).slice(0, 3);
      relevantData.tasks = (table.tasks || []).slice(0, 3);
      relevantData.documents = (table.documents || []).slice(0, 2);
      console.log(`📊 General query: Including minimal core data`);
    }

    // Generate cache key for this request
    const crypto = require('crypto');
    const relevantDataHash = crypto.createHash('md5').update(JSON.stringify(relevantData)).digest('hex').substring(0, 8);
    const cacheKey = generateCacheKey(message, tableId, relevantDataHash);
    
    // Check cache for common queries (don't cache personalized responses)
    if (!message.toLowerCase().includes(req.user.fullName.split(' ')[0].toLowerCase())) {
      const cachedResponse = getCachedResponse(cacheKey);
      if (cachedResponse) {
        // Send cached response
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        
        res.write(`data: ${JSON.stringify({ content: cachedResponse, done: true, fullResponse: cachedResponse })}\n\n`);
        res.end();
        return;
      }
    }

    // Add gear inventory data if gear-related query
    if (isGearQuery) {
      try {
        // Get reserved gear items for this event (limited for performance)
        const reservedGearItems = await ReservedGearItem.find({ eventId: table._id })
          .populate('inventoryId', 'label category')
          .populate('userId', 'fullName')
          .limit(15) // Limit to reduce response time
          .sort({ createdAt: -1 });

        // Simplified gear data
        relevantData.gearInventorySystem = {
          packingProgress: {
            totalItems: reservedGearItems.length,
            packedItems: reservedGearItems.filter(item => item.isPacked).length
          },
          recentReservations: reservedGearItems.slice(0, 8).map(item => ({
            item: `${item.brand || 'Unknown'} ${item.model || 'Unknown'}`,
            category: item.category,
            reservedBy: item.userId?.fullName,
            packed: item.isPacked,
            serial: item.serial
          })),
        eventDates: {
          checkOutDate: table.gear?.checkOutDate,
          checkInDate: table.gear?.checkInDate
        }
      };

    } catch (gearError) {
        console.error('Error fetching gear inventory:', gearError);
        relevantData.gearInventorySystem = { error: 'Gear data unavailable' };
      }
    }

    // Get current date and time information
    const now = new Date();
    const currentDateTime = {
      date: now.toISOString().split('T')[0], // YYYY-MM-DD format
      time: now.toTimeString().split(' ')[0], // HH:MM:SS format
      dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
      timestamp: now.toISOString(),
      localDateTime: now.toLocaleString()
    };

    // Get event dates if available
    const eventDates = {
      start: table.general?.start || null,
      end: table.general?.end || null
    };

    // Calculate event status
    let eventStatus = 'unknown';
    if (eventDates.start && eventDates.end) {
      const startDate = new Date(eventDates.start);
      const endDate = new Date(eventDates.end);
      const today = new Date(now.toISOString().split('T')[0]);
      
      if (today < startDate) {
        eventStatus = 'upcoming';
      } else if (today >= startDate && today <= endDate) {
        eventStatus = 'ongoing';
      } else {
        eventStatus = 'completed';
      }
    }

    // Check data size and truncate if too large to prevent token limit issues
    const dataString = JSON.stringify(relevantData);
    const dataSize = dataString.length;
    
    console.log(`📊 Data size for query: ${dataSize} characters`);
    
    // If data is too large, use minimal version to prevent errors
    let finalData = relevantData;
    if (dataSize > 6000) { // More conservative limit to prevent truncation
      console.log('⚠️  Data too large, using minimal version');
      finalData = {
        eventTitle: table.title,
        currentUser: req.user.fullName,
        currentDate: new Date().toISOString(),
        general: {
          location: table.general?.location,
          start: table.general?.start,
          end: table.general?.end,
          client: table.general?.client
        },
        dataStatus: `Full data available but truncated due to size (${dataSize} chars). Ask more specific questions.`
      };
      
      // Add small samples of relevant data (preserving smart filtering)
      if (relevantData.programSchedule?.length > 0) {
        // Take the first items which should be the most relevant due to our smart filtering
        finalData.programSchedule = relevantData.programSchedule.slice(0, 5);
      }
      if (relevantData.rows?.length > 0) {
        finalData.rows = relevantData.rows.slice(0, 5);
      }
      if (relevantData.tasks?.length > 0) {
        finalData.tasks = relevantData.tasks.slice(0, 3);
      }
    }

    // Comprehensive system prompt with full event management context
    const systemPrompt = `You are Luma, the AI assistant for "${table.title}" event management.

📅 Today: ${currentDateTime.date} (${eventStatus})
👤 User: ${req.user.fullName} (${req.user.role})
📄 Current Page: ${pageContext.currentPage || 'dashboard'}
🆔 User ID: ${req.user.id}

🎯 EVENT MANAGEMENT EXPERTISE:
I understand all aspects of your event:

📅 SCHEDULE PAGE (programSchedule):
- Event sessions with times, locations, speakers, photographers
- Search by: session name, speaker, time, location, date
- Example: "keynote time" → find items where name contains "keynote"

👥 CREW PAGE (rows) - CALL TIMES:
- Call times for each crew member showing when they need to arrive/work
- Fields: name, role, date, startTime, endTime, totalHours, notes
- This is the CALL SHEET - when people need to show up for work
- Search by: person name, role, date, call time
- Example: "What time do I need to be there?" → find user's call time for the date

📷 GEAR PAGE (gear/gearInventorySystem):
- Equipment lists, reservations, packing status
- Categories: Cameras, Lenses, Lighting, Support, Audio, etc.
- Search by: equipment type, brand, model, serial, packed status

✅ TASKS PAGE (tasks):
- To-do items with deadlines and completion status
- Search by: title keywords, deadline dates, completion status

✈️ TRAVEL & ACCOMMODATION (travel/accommodation):
- Flight details, hotel bookings, transportation
- Search by: person name, dates, airline, hotel, confirmation numbers

💾 CARD LOG (cardLog):
- Memory card usage tracking by date and person
- Search by: date, card type, person, usage status

📸 SHOTLIST PAGE (shotlists):
- Photo checklists with completion tracking
- Search by: shot type, completion status, list name

📄 DOCUMENTS (documents):
- PDFs, maps, floor plans, guides
- Search by: filename, type, upload date

📝 NOTES (adminNotes):
- Important reminders and administrative notes
- Search by: date, content, importance

🏢 GENERAL INFO (general):
- Event location, dates, client, budget, contacts, attendees
- Core event details and contact information

🔍 SMART SEARCH RULES:
1. Always search the exact data below for answers
2. Understand relationships: link crew to schedule, gear to crew, etc.
3. Be time-aware: prioritize current/upcoming items
4. Cross-reference data: if someone asks about "today's photographer", check both schedule and crew
5. Use specific details: times, names, locations, dates
6. If data missing, suggest which page/section to check

🧠 INTELLIGENT CROSS-PAGE QUERIES:
- "Who's shooting the keynote?" → Check schedule for keynote, then crew for photographer
- "What gear does John need today?" → Check crew for John's assignments, then gear lists
- "Are we ready for tomorrow's sessions?" → Check schedule + crew assignments + gear packed
- "What's missing for the 2pm session?" → Check schedule, crew, gear, tasks for that time
- "Who has the Canon 5D?" → Check gear reservations and crew assignments

📱 PAGE CONTEXT AWARENESS:
- If on Schedule page: Prioritize schedule-related answers and cross-reference crew
- If on Crew page: Focus on assignments and link to schedule sessions
- If on Gear page: Emphasize equipment status and link to crew who need it
- If on Tasks page: Show deadlines relative to schedule timing
- Suggest relevant pages: "You can find more details on the [Page Name] page"

💡 PROACTIVE ASSISTANCE:
- Alert about conflicts: crew assigned to multiple sessions, gear double-booked
- Remind about deadlines: tasks due before event dates
- Suggest preparations: gear packing for upcoming sessions
- Flag missing data: sessions without photographers, unpacked essential gear

👤 PERSONALIZED USER RESPONSES:
- Recognize when user asks about themselves: "What time do I need to be there?" "Am I working tomorrow?" "What's my call time?"
- For personal questions, search the crew data (rows) for the current user's name
- Show user's specific call times, roles, and assignments first
- Provide personalized context: "Your call time is..." vs "John's call time is..."
- If user is admin, provide management overview; if user, focus on personal schedule
- Understand possessive questions: "my call time", "my assignments", "when do I work"

📊 AVAILABLE DATA:
${JSON.stringify(finalData, null, 2)}`;

    // Build messages array with conversation history for context awareness
    const messages = [
      { role: "system", content: systemPrompt }
    ];
    
    // Add conversation history (keep last 4 messages for context to reduce tokens)
    const recentHistory = conversationHistory.slice(-4);
    messages.push(...recentHistory);
    
    // Add the current message
    messages.push({ role: "user", content: message });

    // Set up Server-Sent Events for streaming response
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });

    const stream = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Faster model
      messages: messages,
      max_tokens: 300, // Reduced for faster response
      temperature: 0.2, // Lower for more focused responses
      presence_penalty: 0.2, // Higher to encourage brevity
      frequency_penalty: 0.1,
      stream: true
    });

    let fullResponse = '';

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
        // Send each chunk to the client
        res.write(`data: ${JSON.stringify({ content, done: false })}\n\n`);
      }
    }

    // Send completion signal
    res.write(`data: ${JSON.stringify({ content: '', done: true, fullResponse })}\n\n`);
    res.end();

    // Cache the response if it's not personalized
    if (fullResponse && !message.toLowerCase().includes(req.user.fullName.split(' ')[0].toLowerCase())) {
      setCachedResponse(cacheKey, fullResponse);
    }

    // Log for debugging data comprehension issues
    console.log(`Chat query: "${message}"`);
    console.log(`Data sections included:`, Object.keys(relevantData));
    if (relevantData.programSchedule) console.log(`Schedule items: ${relevantData.programSchedule.length}`);
    if (relevantData.rows) console.log(`Crew rows: ${relevantData.rows.length}`);
    if (relevantData.tasks) console.log(`Tasks: ${relevantData.tasks.length}`);

  } catch (error) {
    console.error('Chat API error:', error);
    console.error('Error details:', {
      message: error.message,
      status: error.status,
      type: error.type,
      code: error.code
    });
    
    // Handle different types of OpenAI errors for streaming
    let errorMessage = 'AI service temporarily unavailable. Please try again later.';
    
    if (error.status === 429) {
      errorMessage = 'OpenAI quota exceeded. Please add billing to your OpenAI account at platform.openai.com/billing';
    } else if (error.status === 401) {
      errorMessage = 'Invalid OpenAI API key. Please check your configuration.';
    } else if (error.message?.includes('context_length_exceeded')) {
      errorMessage = 'Query too complex. Try asking a more specific question.';
    } else if (error.message?.includes('invalid_request_error')) {
      errorMessage = 'Invalid request format. Please try a different question.';
    } else if (error.type === 'invalid_request_error') {
      errorMessage = 'Request format error. The data might be too large or malformed.';
    }

    // Send error as streaming event
    try {
      res.write(`data: ${JSON.stringify({ error: errorMessage, done: true })}\n\n`);
      res.end();
    } catch (writeError) {
      // If we can't write to stream, fall back to regular error response
      if (!res.headersSent) {
        res.status(500).json({ error: errorMessage });
      }
    }
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

app.get('/api/tables', authenticate, async (req, res) => {
  try {
    // Get the user to check their archived events
    const User = require('./models/User');
    const user = await User.findById(req.user.id);
    
    // Also include leads in the query
    const tables = await Table.find({
      $or: [
        { owners: req.user.id },
        { sharedWith: req.user.id },
        { leads: req.user.id }
      ]
    });

    // Add user-specific archive status to each table
    const tablesWithUserArchiveStatus = tables.map(table => {
      const tableObj = table.toObject();
      // Convert ObjectIds to strings for comparison
      // Handle case where user.archivedEvents doesn't exist (for existing users in production)
      const userArchivedEvents = user && user.archivedEvents ? user.archivedEvents : [];
      const userArchivedIds = userArchivedEvents.map(id => id.toString());
      tableObj.userArchived = userArchivedIds.includes(table._id.toString());
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
  if (!table || (!table.owners.includes(req.user.id) && !table.sharedWith.includes(req.user.id))) {
    return res.status(403).json({ error: 'Not authorized or not found' });
  }
  res.json(table);
});

// --- TASKS ENDPOINTS (COLLABORATIVE TO-DO LIST) ---
app.get('/api/tables/:id/tasks', authenticate, async (req, res) => {
  const table = await Table.findById(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  if (!table.owners.map(String).includes(req.user.id) && !table.sharedWith.map(String).includes(req.user.id)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  res.json({ tasks: table.tasks || [] });
});

app.post('/api/tables/:id/tasks', authenticate, async (req, res) => {
  const table = await Table.findById(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  if (!table.owners.map(String).includes(req.user.id)) {
    return res.status(403).json({ error: 'Only owners can add tasks' });
  }
  const { title, deadline } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const task = {
    title,
    deadline: deadline || '',
    completed: false,
    createdBy: req.user.id
  };
  table.tasks.push(task);
  await table.save();
  const newTask = table.tasks[table.tasks.length - 1];
  notifyDataChange('taskAdded', { task: newTask }, req.params.id);
  res.json({ task: newTask });
});

app.put('/api/tables/:id/tasks/:taskId', authenticate, async (req, res) => {
  const table = await Table.findById(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  if (!table.owners.map(String).includes(req.user.id)) {
    return res.status(403).json({ error: 'Only owners can edit tasks' });
  }
  const task = table.tasks.id(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (typeof req.body.title === 'string') task.title = req.body.title;
  if (typeof req.body.deadline === 'string') task.deadline = req.body.deadline;
  if (typeof req.body.completed === 'boolean') task.completed = req.body.completed;
  await table.save();
  notifyDataChange('taskUpdated', { task }, req.params.id);
  res.json({ task });
});

app.delete('/api/tables/:id/tasks/:taskId', authenticate, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) return res.status(404).json({ error: 'Table not found' });
    if (!table.owners.map(String).includes(req.user.id)) {
      return res.status(403).json({ error: 'Only owners can delete tasks' });
    }
    const taskIndex = table.tasks.findIndex(t => t._id && t._id.toString() === req.params.taskId);
    if (taskIndex === -1) {
      console.error(`Task not found: ${req.params.taskId} in table ${req.params.id}`);
      return res.status(404).json({ error: 'Task not found' });
    }
    table.tasks.splice(taskIndex, 1);
    await table.save();
    notifyDataChange('taskDeleted', { taskId: req.params.taskId }, req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting task:', err);
    res.status(500).json({ error: 'Server error while deleting task' });
  }
});

// --- ADMIN NOTES ENDPOINTS (MULTI-NOTE) ---
// Get all admin notes for a table (owners only)
app.get('/api/tables/:id/admin-notes', authenticate, async (req, res) => {
  const table = await Table.findById(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  if (!table.owners.map(String).includes(req.user.id)) {
    return res.status(403).json({ error: 'Only owners can view admin notes' });
  }
  res.json({ adminNotes: table.adminNotes || [] });
});

// Add a new admin note (owners only)
app.post('/api/tables/:id/admin-notes', authenticate, async (req, res) => {
  const table = await Table.findById(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  if (!table.owners.map(String).includes(req.user.id)) {
    return res.status(403).json({ error: 'Only owners can add admin notes' });
  }
  const { title, content, date } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  let noteDate = date;
  if (!noteDate) {
    const now = new Date();
    noteDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10);
  }
  const note = {
    title,
    content: content || '',
    date: noteDate
  };
  table.adminNotes.push(note);
  await table.save();
  
  // Notify about notes change with tableId
  notifyDataChange('notesChanged', null, req.params.id);
  res.json({ adminNotes: table.adminNotes });
});

// Edit an admin note (owners only)
app.put('/api/tables/:id/admin-notes/:noteId', authenticate, async (req, res) => {
  const table = await Table.findById(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  if (!table.owners.map(String).includes(req.user.id)) {
    return res.status(403).json({ error: 'Only owners can edit admin notes' });
  }
  const note = table.adminNotes.id(req.params.noteId);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  note.title = req.body.title || note.title;
  note.content = req.body.content || note.content;
  await table.save();
  
  // Notify about notes change with tableId
  notifyDataChange('notesChanged', null, req.params.id);
  res.json({ adminNotes: table.adminNotes });
});

// Delete an admin note (owners only)
app.delete('/api/tables/:id/admin-notes/:noteId', authenticate, async (req, res) => {
  const table = await Table.findById(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  if (!table.owners.map(String).includes(req.user.id)) {
    return res.status(403).json({ error: 'Only owners can delete admin notes' });
  }
  table.adminNotes = table.adminNotes.filter(n => n._id.toString() !== req.params.noteId);
  await table.save();
  
  // Notify about notes change with tableId
  notifyDataChange('notesChanged', null, req.params.id);
  res.json({ adminNotes: table.adminNotes });
});

app.post('/api/tables/:id/rows', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  const table = await Table.findById(req.params.id);
  if (!table || (!table.owners.includes(req.user.id) && !table.sharedWith.includes(req.user.id))) {
    return res.status(403).json({ error: 'Not authorized or not found' });
  }
  table.rows.push(req.body);
  await table.save();
  
  io.emit('crewChanged'); // Notify about crew change
  res.json(table);
});

app.put('/api/tables/:id', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  const table = await Table.findById(req.params.id);
  if (!table || !table.owners.includes(req.user.id)) {
    return res.status(403).json({ error: 'Not authorized or not found' });
  }
  table.rows = req.body.rows;
  await table.save();
  
  notifyDataChange('crewChanged', null, req.params.id); // Notify about crew change with tableId
  notifyDataChange('tableUpdated', null, req.params.id); // Also notify about general table update with tableId
  res.json({ message: 'Table updated' });
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
  if (!table || (!table.owners.includes(req.user.id) && !table.sharedWith.includes(req.user.id))) {
    return res.status(403).json({ error: 'Not authorized or not found' });
  }
  res.json(table.general || {});
});

app.put('/api/tables/:id/general', authenticate, async (req, res) => {
  const { title, general } = req.body;
  const table = await Table.findById(req.params.id);
  if (!table || (!table.owners.includes(req.user.id) && !table.sharedWith.includes(req.user.id))) {
    return res.status(403).json({ error: 'Not authorized or not found' });
  }
  
  // Only allow owners to update title
  if (table.owners.includes(req.user.id) && title) {
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
    if (!table || (!table.owners.includes(req.user.id) && !table.sharedWith.includes(req.user.id))) {
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
    const oldLists = oldTable && oldTable.gear && oldTable.gear.lists ? Object.fromEntries(oldTable.gear.lists) : {};

    // Find and update in one atomic operation (fixes versioning issues)
    const result = await Table.findOneAndUpdate(
      {
        _id: req.params.id,
        $or: [
          { owners: req.user.id },
          { sharedWith: req.user.id }
        ]
      },
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
      return res.status(403).json({ error: 'Not authorized or not found' });
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
  try {
    const table = await Table.findById(req.params.id);
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    
    if (!table) {
      return res.status(404).json({ error: 'Not found' });
    }
    
    // Check authorization: admins, owners, leads, or shared users
    const isOwner = table.owners && table.owners.map(String).includes(String(userId));
    const isLead = table.leads && table.leads.map(String).includes(String(userId));
    const isShared = table.sharedWith && table.sharedWith.map(String).includes(String(userId));
    
    if (!isAdmin && !isOwner && !isLead && !isShared) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    // Start with manual travel entries
    const manualTravel = (table.travel || []).map(t => ({
      date: t.date || '',
      depart: t.depart || t.time || '',
      arrive: t.arrive || '',
      name: t.name || '',
      airline: t.airline || '',
      fromTo: t.fromTo || '',
      ref: t.ref || '',
      source: 'manual'
    }));
    
    // Fetch booked flights from FlightRequest collection tied to this event
    // Match by eventId OR by eventName (for requests where eventId wasn't set)
    let bookedFlights = [];
    try {
      const eventTitle = table.title || '';
      const flightRequests = await FlightRequest.find({
        status: 'booked',
        $or: [
          { eventId: req.params.id },
          ...(eventTitle ? [{ eventId: null, eventName: eventTitle }] : [])
        ]
      });
      
      for (const request of flightRequests) {
        if (!request.passengers || request.passengers.length === 0) continue;
        
        for (const passenger of request.passengers) {
          // Resolve passenger display name
          let passengerDisplayName = passenger.name || '';
          
          if (passenger.passengerId) {
            try {
              const passengerRecord = await Passenger.findById(passenger.passengerId).populate('userId', 'fullName');
              if (passengerRecord && passengerRecord.userId) {
                passengerDisplayName = passengerRecord.userId.fullName || passengerRecord.name || passenger.name || '';
              } else if (passengerRecord) {
                passengerDisplayName = passengerRecord.name || passenger.name || '';
              }
            } catch (lookupErr) {
              console.warn('Passenger lookup failed:', lookupErr.message);
            }
          }
          
          if (!passengerDisplayName) continue;
          
          // Build from/to strings
          let outboundFromTo = '';
          let returnFromTo = '';
          if (request.from && request.to) {
            const fromStr = request.from.city || request.from.code || '';
            const toStr = request.to.city || request.to.code || '';
            if (fromStr && toStr) {
              outboundFromTo = `${fromStr} → ${toStr}`;
              returnFromTo = `${toStr} → ${fromStr}`;
            }
          }
          
          // Outbound booked details
          const outboundAirline = request.bookedDetails?.airline || '';
          const outboundConfCode = (request.bookedDetails?.confirmationCode || '').trim();
          const outboundRef = outboundConfCode || request.bookedDetails?.flightNumber || '';
          const outboundDepartTime = request.bookedDetails?.departTime || '';
          const outboundArriveTime = request.bookedDetails?.arriveTime || '';
          
          // Return booked details — prefer confirmation code, fall back to outbound confirmation code (same booking)
          const returnAirline = request.returnBookedDetails?.airline || outboundAirline;
          const returnConfCode = (request.returnBookedDetails?.confirmationCode || '').trim();
          const returnRef = returnConfCode || outboundConfCode || request.returnBookedDetails?.flightNumber || '';
          const returnDepartTime = request.returnBookedDetails?.departTime || '';
          const returnArriveTime = request.returnBookedDetails?.arriveTime || '';
          
          // Format dates as YYYY-MM-DD strings
          const formatDateStr = (d) => {
            if (!d) return '';
            const dt = new Date(d);
            if (isNaN(dt.getTime())) return '';
            return dt.toISOString().split('T')[0];
          };
          
          // Outbound flight
          if (request.departDate) {
            bookedFlights.push({
              date: formatDateStr(request.departDate),
              depart: outboundDepartTime,
              arrive: outboundArriveTime,
              name: passengerDisplayName,
              airline: outboundAirline,
              fromTo: outboundFromTo,
              ref: outboundRef,
              source: 'booked',
              flightType: request.returnDate ? 'outbound' : 'one-way'
            });
          }
          
          // Return flight
          if (request.returnDate) {
            bookedFlights.push({
              date: formatDateStr(request.returnDate),
              depart: returnDepartTime,
              arrive: returnArriveTime,
              name: passengerDisplayName,
              airline: returnAirline,
              fromTo: returnFromTo,
              ref: returnRef,
              source: 'booked',
              flightType: 'return'
            });
          }
        }
      }
    } catch (flightReqErr) {
      console.error('Error fetching booked flights for event:', flightReqErr);
      // Continue even if flight requests fail
    }
    
    // Combine manual + booked flights and sort by date
    const allTravel = [...manualTravel, ...bookedFlights].sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });
    
    res.json({
      travel: allTravel,
      accommodation: table.accommodation || []
    });
  } catch (err) {
    console.error('Error fetching travel data:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/tables/:id/travel', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  const table = await Table.findById(req.params.id);
  if (!table) {
    return res.status(404).json({ error: 'Not found' });
  }
  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin';
  const isOwner = table.owners && table.owners.map(String).includes(String(userId));
  const isLead = table.leads && table.leads.map(String).includes(String(userId));
  if (!isAdmin && !isOwner && !isLead) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  // Only save manual entries (filter out booked entries that came from FlightRequest)
  const manualTravel = (req.body.travel || []).filter(t => t.source !== 'booked');
  table.travel = manualTravel;
  table.accommodation = req.body.accommodation || [];
  await table.save();
  
  notifyDataChange('travelChanged', null, req.params.id); // Notify about travel/accommodation changes with tableId
  res.json({ message: 'Travel and accommodation saved' });
});

// DELETE
app.delete('/api/tables/:id', authenticate, async (req, res) => {
  const table = await Table.findById(req.params.id);
  if (!table || !table.owners.includes(req.user.id)) {
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
  
  io.emit('crewChanged'); // Notify about crew change
  res.json({ message: 'Row deleted' });
});

// USERS (all authenticated users can view)
app.get('/api/users', authenticate, async (req, res) => {
  const users = await User.find({}, 'fullName email role').sort({ fullName: 1 });
  res.json(users.map(u => ({
    _id: u._id,
    name: u.fullName,
    email: u.email,
    role: u.role || 'user'
  })));
});

app.put('/api/users/:id', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });
  const { name, email, role } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.fullName = name;
  user.email = email;
  if (role) user.role = role;
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
  if (!table || (!table.owners.includes(req.user.id) && !table.sharedWith.includes(req.user.id))) {
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
    
    // Check permissions
    const isOwner = currentTable.owners.includes(req.user.id);
    const isShared = currentTable.sharedWith.includes(req.user.id);
    if (!isOwner && !isShared) {
      return res.status(403).json({ error: 'Not authorized to edit this table' });
    }
    
    // Find the current program
    const currentProgram = currentTable.programSchedule.find(p => p._id.toString() === programId);
    if (!currentProgram) {
      return res.status(404).json({ error: 'Program not found' });
    }
    
    const oldValue = currentProgram[field];
    
    // Use MongoDB's positional operator to update only the specific field atomically
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
        }
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

// FOLDER LOGS
app.get('/api/tables/:id/folder-logs', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null") {
    return res.status(400).json({ error: "Invalid table ID" });
  }
  
  try {
    const table = await Table.findById(req.params.id);
    if (!table || (!table.owners.includes(req.user.id) && !table.sharedWith.includes(req.user.id))) {
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

// ========================================
// SCHEDULE SHARING (Public Read-Only Link)
// ========================================

// Generate or retrieve share token for a schedule
app.post('/api/tables/:id/share-schedule', authenticate, async (req, res) => {
  try {
    if (!req.params.id || req.params.id === 'null') {
      return res.status(400).json({ error: 'Invalid table ID' });
    }

    const table = await Table.findById(req.params.id);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Only owners and leads can generate share links
    const isOwner = table.owners.includes(req.user.id);
    const isLead = table.leads && table.leads.includes(req.user.id);
    if (!isOwner && !isLead) {
      return res.status(403).json({ error: 'Only owners and leads can share the schedule' });
    }

    // Generate a token if one doesn't exist
    if (!table.shareToken) {
      const crypto = require('crypto');
      table.shareToken = crypto.randomBytes(24).toString('hex');
      await table.save();
    }

    res.json({ shareToken: table.shareToken });
  } catch (err) {
    console.error('Error generating share token:', err);
    res.status(500).json({ error: 'Failed to generate share link' });
  }
});

// Revoke (disable) share token for a schedule
app.delete('/api/tables/:id/share-schedule', authenticate, async (req, res) => {
  try {
    if (!req.params.id || req.params.id === 'null') {
      return res.status(400).json({ error: 'Invalid table ID' });
    }

    const table = await Table.findById(req.params.id);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Only owners can revoke share links
    if (!table.owners.includes(req.user.id)) {
      return res.status(403).json({ error: 'Only owners can revoke share links' });
    }

    table.shareToken = null;
    await table.save();

    res.json({ message: 'Share link revoked' });
  } catch (err) {
    console.error('Error revoking share token:', err);
    res.status(500).json({ error: 'Failed to revoke share link' });
  }
});

// Public endpoint: Get shared schedule data (NO authentication required)
app.get('/api/shared-schedule/:shareToken', async (req, res) => {
  try {
    const { shareToken } = req.params;
    if (!shareToken) {
      return res.status(400).json({ error: 'Share token is required' });
    }

    const table = await Table.findOne({ shareToken });
    if (!table) {
      return res.status(404).json({ error: 'Schedule not found or link has expired' });
    }

    // Return only the schedule data needed for display (no sensitive info)
    res.json({
      title: table.title || 'Program Schedule',
      programSchedule: table.programSchedule || []
    });
  } catch (err) {
    console.error('Error fetching shared schedule:', err);
    res.status(500).json({ error: 'Failed to load schedule' });
  }
});

// Serve SPA shell and root
app.use(express.static(path.join(__dirname, '../frontend')));

// Serve static frontend assets
app.use('/pages', express.static(path.join(__dirname, '../frontend/pages')));
app.use('/js', express.static(path.join(__dirname, '../frontend/js')));
app.use('/css', express.static(path.join(__dirname, '../frontend/css')));
app.use('/assets', express.static(path.join(__dirname, '../frontend/assets')));

// Serve SPA shell and root
app.use(express.static(path.join(__dirname, '../frontend')));

// VERIFY TOKEN
app.get('/api/verify-token', authenticate, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// GEAR INVENTORY API
// List all gear
app.get('/api/gear-inventory', authenticate, async (req, res) => {
  try {
    const gear = await GearInventory.find();
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
    
    const gear = await GearInventory.find();
    
    // Calculate availability using BULLETPROOF atomic service
    const gearWithAvailability = await Promise.all(gear.map(async (item) => {
      try {
        const availableQty = await AtomicReservationService.getAvailableQuantity(
          item._id, startDate, endDate
        );
        const reservedQty = item.quantity - availableQty;
        
        return {
          ...item.toObject(),
          availableQuantity: availableQty,
          reservedQuantity: reservedQty,
          isAvailable: availableQty > 0
        };
      } catch (error) {
        console.error(`Error calculating availability for item ${item._id}:`, error);
        return {
          ...item.toObject(),
          availableQuantity: 0,
          reservedQuantity: item.quantity,
          isAvailable: false
        };
      }
    }));
    
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
    
    const gear = await GearInventory.find();
    
    // Calculate availability using BULLETPROOF atomic service
    const gearWithAvailability = await Promise.all(gear.map(async (item) => {
      const availableQty = await AtomicReservationService.getAvailableQuantity(
        item._id, cart.checkOutDate, cart.checkInDate  // Don't exclude current event
      );
      return {
        ...item.toObject(),
        availableQuantity: availableQty
      };
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
    res.json({ message: 'Gear updated successfully', gear });
  } catch (err) {
    console.error('Error updating gear:', err);
    res.status(500).json({ error: 'Failed to update gear: ' + err.message });
  }
});

// Repair gear inventory data
app.post('/api/gear-inventory/repair', authenticate, async (req, res) => {
  try {
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

// Get all reservations for a specific inventory item (Admin only)
app.get('/api/inventory/:inventoryId/reservations', authenticate, async (req, res) => {
  try {
    const { inventoryId } = req.params;
    
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
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

// Release specific reservation (Admin only) - Atomically releases from both models
app.delete('/api/reservations/:reservationId', authenticate, async (req, res) => {
  try {
    const { reservationId } = req.params;
    
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
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

// Release all reservations for an inventory item (Admin only) - Atomically releases from both models
app.delete('/api/inventory/:inventoryId/reservations/all', authenticate, async (req, res) => {
  try {
    const { inventoryId } = req.params;
    
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
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

    // Check if user has access to this event
    const table = await Table.findById(eventId);
    if (!table) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    if (!table.owners.includes(userId) && !table.sharedWith.includes(userId)) {
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

    // If no valid items found, return empty result
    if (!validItems || validItems.length === 0) {
      console.log(`[GEAR LOAD] No valid reserved items found, returning empty array`);
      return res.json({ 
        reservedItems: [],
        userPermissions: {
          canReserve: table.owners.includes(userId) || req.user.role === 'admin',
          canManageLists: table.owners.includes(userId) || req.user.role === 'admin',
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
        canReserve: table.owners.includes(userId) || req.user.role === 'admin',
        canManageLists: table.owners.includes(userId) || req.user.role === 'admin', 
        canPack: true
      }
    });
  } catch (error) {
    console.error('Error getting reserved items for event:', error);
    res.status(500).json({ error: 'Failed to get reserved items' });
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
    if (!table || (!table.owners.includes(userId) && !table.sharedWith.includes(userId))) {
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
    
    // Check access
    if (!table.owners.includes(req.user.id) && !table.sharedWith.includes(req.user.id)) {
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
    
    res.json({ gearLists, currentList });
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
    
    // Check access - only owners and admins can create lists
    if (!table.owners.includes(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only event owners and admins can create gear lists' });
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
    if (!table.owners.includes(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only event owners and admins can update gear lists' });
    }
    
    // Find the list
    const listIndex = table.gear?.gearLists?.findIndex(list => list.name === listName);
    if (listIndex === -1) {
      return res.status(404).json({ error: 'Gear list not found' });
    }
    
    // Check if new name already exists
    const existingList = table.gear.gearLists.find(list => list.name === newName.trim());
    if (existingList && existingList.name !== listName) {
      return res.status(409).json({ error: 'A list with this name already exists' });
    }
    
    // Update list name
    const oldName = table.gear.gearLists[listIndex].name;
    table.gear.gearLists[listIndex].name = newName.trim();
    
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
    if (!table.owners.includes(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only event owners and admins can delete gear lists' });
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
    if (!table.owners.includes(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only event owners and admins can add manual items' });
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
    if (!table.owners.includes(req.user.id) && !table.sharedWith.includes(req.user.id) && req.user.role !== 'admin') {
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
    if (!table.owners.includes(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only event owners and admins can delete manual items' });
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
    
    // Check access
    if (!table.owners.includes(req.user.id) && !table.sharedWith.includes(req.user.id)) {
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
    if (!table || (!table.owners.includes(req.user.id) && !table.sharedWith.includes(req.user.id))) {
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
    if (!table || (!table.owners.includes(req.user.id) && !table.sharedWith.includes(req.user.id))) {
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
    for (let i = 0; i < cartWithAvailability.items.length; i++) {
      const item = cartWithAvailability.items[i];
      item.availableQuantity = await calculateCartItemAvailability(item, cart, cartWithAvailability.items);
    }

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

    // Get or create cart
    let cart = await Cart.findOne({ userId, eventId });
    if (!cart) {
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
    }

    // Get inventory item
    const inventoryItem = await GearInventory.findById(inventoryId);
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
    for (let i = 0; i < cartWithAvailability.items.length; i++) {
      const item = cartWithAvailability.items[i];
      item.availableQuantity = await calculateCartItemAvailability(item, cart, cartWithAvailability.items);
    }

    res.json(cartWithAvailability);
  } catch (err) {
    console.error('Error adding item to cart:', err);
    res.status(500).json({ error: 'Failed to add item to cart' });
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
    for (let i = 0; i < cartWithAvailability.items.length; i++) {
      const item = cartWithAvailability.items[i];
      item.availableQuantity = await calculateCartItemAvailability(item, cart, cartWithAvailability.items);
    }

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
    for (let i = 0; i < cartWithAvailability.items.length; i++) {
      const item = cartWithAvailability.items[i];
      item.availableQuantity = await calculateCartItemAvailability(item, cart, cartWithAvailability.items);
    }

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
      for (let i = 0; i < cartWithAvailability.items.length; i++) {
        const item = cartWithAvailability.items[i];
        item.availableQuantity = await calculateCartItemAvailability(item, cart, cartWithAvailability.items);
      }
      
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
      for (let i = 0; i < cartWithAvailability.items.length; i++) {
        const item = cartWithAvailability.items[i];
        item.availableQuantity = await calculateCartItemAvailability(item, cart, cartWithAvailability.items);
      }
      
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
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
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
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
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
        from: process.env.SENDGRID_FROM_EMAIL,
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
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
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
        from: process.env.SENDGRID_FROM_EMAIL,
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
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
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
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
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
      from: process.env.SENDGRID_FROM_EMAIL,
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
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
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
// FLIGHTS - Get all flight data across all events
// ===========================================

app.get('/api/flights/all', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const userFullName = req.user.fullName;
    const isAdmin = req.user.role === 'admin';
    // NOTE: Status filter removed - now handled client-side to avoid timezone issues
    const dateFilter = req.query.dateFilter || 'all';
    const customStart = req.query.customStart;
    const customEnd = req.query.customEnd;
    
    // Find all tables the user has access to
    let query = {};
    if (!isAdmin) {
      // Non-admins only see events they have access to (owners, leads, shared)
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
      .select('title travel general owners leads');
    
    // Get today's date at midnight for comparisons
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
    
    // Check if user is a lead/planner for an event
    function isUserLeadForEvent(table) {
      return table.leads && table.leads.some(lead => lead.toString() === userId);
    }
    
    // Pre-fetch all Passenger records linked to this user's account
    // This gives us the passenger names (which may differ from the user's fullName)
    // used on flight bookings, so we can match table.travel entries properly
    let userLinkedPassengerNames = [];
    if (!isAdmin) {
      try {
        const linkedPassengers = await Passenger.find({ userId: userId }).select('name');
        userLinkedPassengerNames = linkedPassengers
          .map(p => p.name ? p.name.toLowerCase().trim() : null)
          .filter(Boolean);
      } catch (err) {
        console.warn('Failed to fetch linked passenger records for user:', userId, err.message);
      }
    }
    
    // Flatten flights from all tables
    let allFlights = [];
    
    for (const table of tables) {
      if (!table.travel || table.travel.length === 0) continue;
      
      const isOwner = table.owners && table.owners.some(owner => owner._id.toString() === userId);
      const isLead = isUserLeadForEvent(table);
      
      for (const flight of table.travel) {
        // Skip if no name exists
        if (!flight.name) continue;
        
        // Permission logic:
        // - Admins see all flights
        // - Owners see all flights for their events
        // - Leads/planners see all flights for their events
        // - Regular users see flights where the name matches their account name
        //   OR matches a Passenger record linked to their user account
        if (!isAdmin && !isOwner && !isLead) {
          const flightNameLower = flight.name.toLowerCase().trim();
          const fullNameMatch = flightNameLower === userFullName.toLowerCase().trim();
          const linkedPassengerMatch = userLinkedPassengerNames.includes(flightNameLower);
          if (!fullNameMatch && !linkedPassengerMatch) {
            continue;
          }
        }
        
        // Parse the flight date
        const flightDate = parseLocalDate(flight.date);
        
        // NOTE: Status filtering (upcoming/past) is now handled client-side
        // to avoid timezone mismatches between server and user.
        // We only apply date range filters server-side.
        
        // Apply date range filter
        if (filterStartDate && filterEndDate && flightDate) {
          if (flightDate < filterStartDate || flightDate > filterEndDate) continue;
        }
        
        allFlights.push({
          _id: flight._id ? flight._id.toString() : `${table._id}-${flight.date}-${flight.name}`,
          date: flight.date || '',
          depart: flight.depart || '',
          arrive: flight.arrive || '',
          name: flight.name || '',
          airline: flight.airline || '',
          fromTo: flight.fromTo || '',
          ref: flight.ref || '',
          event: {
            _id: table._id.toString(),
            title: table.title || 'Untitled Event',
            city: table.general?.city || '',
            state: table.general?.state || ''
          }
        });
      }
    }
    
    // Also fetch flights from the flight requests collection
    try {
      const flightRequests = await FlightRequest.find({ status: 'booked' });
      
      // Build sets of event IDs where user is an owner or lead (for permission checks)
      const leadEventIds = new Set(
        tables.filter(t => isUserLeadForEvent(t)).map(t => t._id.toString())
      );
      const ownerEventIds = new Set(
        tables.filter(t => t.owners && t.owners.some(owner => owner._id.toString() === userId)).map(t => t._id.toString())
      );
      
      // Build a map of event titles to event IDs for resolving null eventIds
      const eventTitleToId = {};
      tables.forEach(t => {
        if (t.title) eventTitleToId[t.title] = t._id.toString();
      });
      
      for (const request of flightRequests) {
        if (!request.passengers || request.passengers.length === 0) continue;
        
        // Resolve eventId if null but eventName matches a known event
        let resolvedEventId = request.eventId ? request.eventId.toString() : null;
        if (!resolvedEventId && request.eventName && eventTitleToId[request.eventName]) {
          resolvedEventId = eventTitleToId[request.eventName];
        }
        
        // Check if user is an owner or lead for this flight request's event
        const isOwnerForThisEvent = resolvedEventId && ownerEventIds.has(resolvedEventId);
        const isLeadForThisEvent = resolvedEventId && leadEventIds.has(resolvedEventId);
        
        // Build from/to strings (used for both outbound and return)
        let outboundFromTo = '';
        let returnFromTo = '';
        if (request.from && request.to) {
          const fromStr = request.from.city || request.from.code || '';
          const toStr = request.to.city || request.to.code || '';
          if (fromStr && toStr) {
            outboundFromTo = `${fromStr} → ${toStr}`;
            returnFromTo = `${toStr} → ${fromStr}`;
          }
        }
        
        // Get outbound booked details
        const outboundDepartTime = request.bookedDetails?.departTime || '';
        const outboundArriveTime = request.bookedDetails?.arriveTime || '';
        const outboundAirline = request.bookedDetails?.airline || '';
        const outboundConfCode = (request.bookedDetails?.confirmationCode || '').trim();
        const outboundRef = outboundConfCode || request.bookedDetails?.flightNumber || '';
        
        // Get return booked details — prefer confirmation code, fall back to outbound confirmation code (same booking)
        const returnDepartTime = request.returnBookedDetails?.departTime || '';
        const returnArriveTime = request.returnBookedDetails?.arriveTime || '';
        const returnAirline = request.returnBookedDetails?.airline || outboundAirline;
        const returnConfCode = (request.returnBookedDetails?.confirmationCode || '').trim();
        const returnRef = returnConfCode || outboundConfCode || request.returnBookedDetails?.flightNumber || '';
        
        // Check permissions for each passenger
        for (const passenger of request.passengers) {
          let passengerDisplayName = passenger.name || '';
          let passengerLinkedUserId = null;
          let hasLinkedAccount = false;
          
          // Try to look up the passenger's linked user account
          if (passenger.passengerId) {
            try {
              const passengerRecord = await Passenger.findById(passenger.passengerId).populate('userId', 'fullName');
              if (passengerRecord && passengerRecord.userId) {
                passengerLinkedUserId = passengerRecord.userId._id.toString();
                passengerDisplayName = passengerRecord.userId.fullName || passengerRecord.name || passenger.name || '';
                hasLinkedAccount = true;
              } else if (passengerRecord) {
                // Passenger record exists but no linked user account
                passengerDisplayName = passengerRecord.name || passenger.name || '';
              }
            } catch (lookupErr) {
              // If lookup fails, use the name from the flight request passenger entry
              console.warn('Passenger lookup failed for:', passenger.passengerId, lookupErr.message);
            }
          }
          
          // If still no name, skip this passenger
          if (!passengerDisplayName) continue;
          
          // Permission logic:
          // - Admins see ALL flights (including unlinked passengers)
          // - Owners see all flights for their events
          // - Leads see all flights for their events
          // - Regular users: use Passenger model's userId link (preferred),
          //   OR match against linked passenger names from Passenger records
          if (!isAdmin && !isOwnerForThisEvent && !isLeadForThisEvent) {
            if (hasLinkedAccount) {
              // Passenger has a linked user account — match by userId (definitive)
              if (passengerLinkedUserId !== userId) {
                continue;
              }
            } else {
              // No linked account — check if passenger name matches the user's fullName
              // or any of the user's linked Passenger record names
              const passengerNameLower = passengerDisplayName.toLowerCase().trim();
              const fullNameMatch = passengerNameLower === userFullName.toLowerCase().trim();
              const linkedPassengerMatch = userLinkedPassengerNames.includes(passengerNameLower);
              if (!fullNameMatch && !linkedPassengerMatch) {
                continue;
              }
            }
          }
          
          const passengerId = passengerLinkedUserId || (passenger.passengerId ? passenger.passengerId.toString() : passenger.name);
          
          // --- OUTBOUND FLIGHT ---
          if (request.departDate) {
            const outboundDate = parseLocalDate(request.departDate);
            
            // Apply date range filter
            let includeOutbound = true;
            if (filterStartDate && filterEndDate && outboundDate) {
              if (outboundDate < filterStartDate || outboundDate > filterEndDate) includeOutbound = false;
            }
            
            if (includeOutbound) {
              allFlights.push({
                _id: request._id.toString() + '-out-' + passengerId,
                date: request.departDate || '',
                depart: outboundDepartTime,
                arrive: outboundArriveTime,
                name: passengerDisplayName,
                airline: outboundAirline,
                fromTo: outboundFromTo,
                ref: outboundRef,
                flightType: request.returnDate ? 'outbound' : 'one-way',
                event: {
                  _id: resolvedEventId || '',
                  title: request.eventName || 'Flight Request',
                  city: '',
                  state: ''
                }
              });
            }
          }
          
          // --- RETURN FLIGHT ---
          // Add return flight if returnDate exists (round-trip or has a return date)
          if (request.returnDate) {
            const returnDate = parseLocalDate(request.returnDate);
            
            // Apply date range filter
            let includeReturn = true;
            if (filterStartDate && filterEndDate && returnDate) {
              if (returnDate < filterStartDate || returnDate > filterEndDate) includeReturn = false;
            }
            
            if (includeReturn) {
              allFlights.push({
                _id: request._id.toString() + '-ret-' + passengerId,
                date: request.returnDate || '',
                depart: returnDepartTime,
                arrive: returnArriveTime,
                name: passengerDisplayName,
                airline: returnAirline,
                fromTo: returnFromTo,  // Swapped from/to for return
                ref: returnRef,
                flightType: 'return',
                event: {
                  _id: resolvedEventId || '',
                  title: request.eventName || 'Flight Request',
                  city: '',
                  state: ''
                }
              });
            }
          }
        }
      }
    } catch (flightReqErr) {
      console.error('Error fetching flight requests:', flightReqErr);
      // Continue even if flight requests fail
    }
    
    // Sort by date (soonest first), then by event name
    allFlights.sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(0);
      const dateB = b.date ? new Date(b.date) : new Date(0);
      const dateCompare = dateA - dateB;
      if (dateCompare !== 0) return dateCompare;
      return (a.event.title || '').localeCompare(b.event.title || '');
    });
    
    res.json({
      flights: allFlights,
      totalCount: allFlights.length,
      isAdmin,
      isLead: tables.some(table => isUserLeadForEvent(table))
    });
  } catch (err) {
    console.error('Error fetching all flights:', err);
    res.status(500).json({ error: 'Server error' });
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
    // NOTE: Status filter removed - now handled client-side to avoid timezone issues
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
        
        // PERMISSION LOGIC:
        // - Non-admins ALWAYS see only their own call times
        // - Admins see all call times by default
        // - Admins can use "My Calls Only" filter to see just their own
        
        // For non-admins, only show their own call times
        if (!isAdmin && row.name.toLowerCase() !== userFullName.toLowerCase()) {
          continue;
        }
        
        // If admin has "My Calls Only" filter enabled, only show their calls
        if (myCallsOnly && row.name.toLowerCase() !== userFullName.toLowerCase()) {
          continue;
        }
        
        // Parse the crew call date
        const callDate = parseLocalDate(row.date);
        
        // NOTE: Status filtering (live/upcoming/past) is now handled client-side
        // to avoid timezone mismatches between server and user.
        // We only apply date range filters server-side.
        
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

// ===================== TIMESHEET ROUTES =====================

const Timesheet = require('./models/Timesheet');

// Get user's timesheet
app.get('/api/timesheet', authenticate, async (req, res) => {
  try {
    let timesheet = await Timesheet.findOne({ userId: req.user.id });
    if (!timesheet) {
      // Create empty timesheet for user if doesn't exist
      timesheet = new Timesheet({ userId: req.user.id, entries: [] });
      await timesheet.save();
    }
    res.json(timesheet);
  } catch (error) {
    console.error('Get timesheet error:', error);
    res.status(500).json({ error: 'Failed to get timesheet' });
  }
});

// Add a new timesheet entry (clock in, clock out, or travel)
app.post('/api/timesheet/entry', authenticate, async (req, res) => {
  try {
    const { type, date, time, notes, isManual, hours, utcTimestamp } = req.body;
    
    if (!type || !date) {
      return res.status(400).json({ error: 'Type and date are required' });
    }
    
    if (!['clock_in', 'clock_out', 'travel'].includes(type)) {
      return res.status(400).json({ error: 'Invalid entry type' });
    }
    
    let timesheet = await Timesheet.findOne({ userId: req.user.id });
    if (!timesheet) {
      timesheet = new Timesheet({ userId: req.user.id, entries: [] });
    }
    
    const newEntry = {
      type,
      date: new Date(date),
      time: time || null,
      notes: notes || '',
      isManual: isManual || false,
      hours: type === 'travel' ? (hours || 4) : null,
      pairId: null,
      // Store UTC timestamp for accurate elapsed time calculation
      // Handles timezone changes (e.g., clock in PT, travel to ET, clock out)
      utcTimestamp: utcTimestamp ? new Date(utcTimestamp) : null
    };
    
    timesheet.entries.push(newEntry);
    await timesheet.save();
    
    // Return the newly created entry
    const createdEntry = timesheet.entries[timesheet.entries.length - 1];
    res.json({ message: 'Entry added', entry: createdEntry });
  } catch (error) {
    console.error('Add timesheet entry error:', error);
    res.status(500).json({ error: 'Failed to add timesheet entry' });
  }
});

// Update a timesheet entry
app.put('/api/timesheet/entry/:entryId', authenticate, async (req, res) => {
  try {
    const { entryId } = req.params;
    const { type, date, time, notes, hours, pairId } = req.body;
    
    const timesheet = await Timesheet.findOne({ userId: req.user.id });
    if (!timesheet) {
      return res.status(404).json({ error: 'Timesheet not found' });
    }
    
    const entry = timesheet.entries.id(entryId);
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    // Update fields if provided
    if (type) entry.type = type;
    if (date) entry.date = new Date(date);
    if (time !== undefined) entry.time = time;
    if (notes !== undefined) entry.notes = notes;
    if (hours !== undefined) entry.hours = hours;
    if (pairId !== undefined) entry.pairId = pairId;
    
    await timesheet.save();
    res.json({ message: 'Entry updated', entry });
  } catch (error) {
    console.error('Update timesheet entry error:', error);
    res.status(500).json({ error: 'Failed to update timesheet entry' });
  }
});

// Delete a timesheet entry
app.delete('/api/timesheet/entry/:entryId', authenticate, async (req, res) => {
  try {
    const { entryId } = req.params;
    
    const timesheet = await Timesheet.findOne({ userId: req.user.id });
    if (!timesheet) {
      return res.status(404).json({ error: 'Timesheet not found' });
    }
    
    const entryIndex = timesheet.entries.findIndex(e => e._id.toString() === entryId);
    if (entryIndex === -1) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    timesheet.entries.splice(entryIndex, 1);
    await timesheet.save();
    
    res.json({ message: 'Entry deleted' });
  } catch (error) {
    console.error('Delete timesheet entry error:', error);
    res.status(500).json({ error: 'Failed to delete timesheet entry' });
  }
});

// Pair clock in/out entries
app.post('/api/timesheet/pair', authenticate, async (req, res) => {
  try {
    const { clockInId, clockOutId } = req.body;
    
    if (!clockInId || !clockOutId) {
      return res.status(400).json({ error: 'Both clockInId and clockOutId are required' });
    }
    
    const timesheet = await Timesheet.findOne({ userId: req.user.id });
    if (!timesheet) {
      return res.status(404).json({ error: 'Timesheet not found' });
    }
    
    const clockInEntry = timesheet.entries.id(clockInId);
    const clockOutEntry = timesheet.entries.id(clockOutId);
    
    if (!clockInEntry || !clockOutEntry) {
      return res.status(404).json({ error: 'One or both entries not found' });
    }
    
    if (clockInEntry.type !== 'clock_in' || clockOutEntry.type !== 'clock_out') {
      return res.status(400).json({ error: 'Invalid entry types for pairing' });
    }
    
    // Generate a unique pair ID
    const pairId = `pair_${Date.now()}`;
    clockInEntry.pairId = pairId;
    clockOutEntry.pairId = pairId;
    
    await timesheet.save();
    res.json({ message: 'Entries paired', pairId });
  } catch (error) {
    console.error('Pair timesheet entries error:', error);
    res.status(500).json({ error: 'Failed to pair entries' });
  }
});

// SERVER
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server started on port ${PORT}`));

// Catch-all for SPA routing (should be last!)
app.get('/folder-logs.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'folder-logs.html'));
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, '../frontend', 'dashboard.html'));
});

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

  // Send notification email to the user
  try {
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
    // Add a consistent View Event button for all roles
    const eventUrl = `${process.env.APP_URL}/dashboard.html?id=${table._id}`;
    html += `
      <div style="margin: 24px 0;">
        <a href="${eventUrl}" style="display:inline-block;padding:12px 28px;background:#CC0007;color:#fff;text-decoration:none;font-size:17px;font-weight:600;border-radius:8px;">View Event</a>
      </div>
    `;
    html += `<p>Log in to LumDash to view the event.</p>`;

    await sgMail.send({
      to: user.email,
      from: process.env.SENDGRID_FROM_EMAIL,
      subject,
      html
    });
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
  const table = await Table.findById(req.params.id);
  if (!table || !table.owners.includes(req.user.id)) {
    return res.status(403).json({ error: 'Not authorized or not found' });
  }
  const rowIndex = table.rows.findIndex(r => r._id && r._id.toString() === req.params.rowId);
  if (rowIndex === -1) {
    return res.status(404).json({ error: 'Row not found' });
  }
  // Update fields
  table.rows[rowIndex] = { ...table.rows[rowIndex]._doc, ...req.body, _id: table.rows[rowIndex]._id };
  await table.save();
  notifyDataChange('crewChanged', null, req.params.id);
  notifyDataChange('tableUpdated', null, req.params.id);
  res.json({ message: 'Row updated' });
});

app.delete('/api/tables/:id/rows-by-id/:rowId', authenticate, async (req, res) => {
  if (!req.params.id || req.params.id === "null" || !req.params.rowId) {
    return res.status(400).json({ error: "Invalid table ID or row ID" });
  }
  const table = await Table.findById(req.params.id);
  if (!table || !table.owners.includes(req.user.id)) {
    return res.status(403).json({ error: 'Not authorized or not found' });
  }
  const rowIndex = table.rows.findIndex(r => r._id && r._id.toString() === req.params.rowId);
  if (rowIndex === -1) {
    return res.status(404).json({ error: 'Row not found' });
  }
  table.rows.splice(rowIndex, 1);
  await table.save();
  notifyDataChange('crewChanged', null, req.params.id);
  notifyDataChange('tableUpdated', null, req.params.id);
  res.json({ message: 'Row deleted' });
});

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

// End of server.js

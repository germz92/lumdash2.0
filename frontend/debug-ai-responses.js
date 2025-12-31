// AI Response Debugging Tool
// Use this to test specific queries and see what data the AI receives

const mongoose = require('mongoose');
const Table = require('./models/Table');
require('dotenv').config();

class AIResponseDebugger {
  constructor() {
    this.testQueries = [
      "What's the schedule for today?",
      "Who is assigned to photography?",
      "What tasks need to be completed?",
      "Where is the event?",
      "When does the event start?",
      "What gear do we have?",
      "Who's on the crew?",
      "What's the client name?",
      "Any travel arrangements?",
      "Show me the shot list"
    ];
  }

  async connect() {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('✅ Connected to MongoDB');
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);
      process.exit(1);
    }
  }

  async debugQuery(tableId, query) {
    try {
      const table = await Table.findById(tableId);
      if (!table) {
        console.log('❌ Table not found');
        return;
      }

      console.log(`\n🔍 DEBUGGING QUERY: "${query}"`);
      console.log('='.repeat(50));

      // Simulate the same logic as the chat endpoint
      const messageKeywords = query.toLowerCase();
      
      const isScheduleQuery = messageKeywords.match(/schedule|time|when|start|end|session|keynote|presentation|meeting|event|program|agenda/);
      const isCrewQuery = messageKeywords.match(/crew|team|photographer|people|who|assignment|role|staff|person|name/);
      const isGearQuery = messageKeywords.match(/gear|camera|equipment|lens|light|audio|pack|reserved|inventory|serial/);
      const isTaskQuery = messageKeywords.match(/task|todo|deadline|complete|done|work|assign/);
      const isTravelQuery = messageKeywords.match(/travel|flight|hotel|accommodation|transport|airline|check/);
      const isCardQuery = messageKeywords.match(/card|memory|storage|sd|cf|media/);
      const isShotQuery = messageKeywords.match(/shot|photo|picture|image|list|checklist/);

      console.log('📊 KEYWORD ANALYSIS:');
      console.log(`  Schedule query: ${!!isScheduleQuery}`);
      console.log(`  Crew query: ${!!isCrewQuery}`);
      console.log(`  Gear query: ${!!isGearQuery}`);
      console.log(`  Task query: ${!!isTaskQuery}`);
      console.log(`  Travel query: ${!!isTravelQuery}`);
      console.log(`  Card query: ${!!isCardQuery}`);
      console.log(`  Shot query: ${!!isShotQuery}`);

      const relevantData = {
        eventTitle: table.title,
        currentUser: 'Test User',
        currentDate: new Date().toISOString()
      };

      // Always include general info
      relevantData.general = table.general || {};
      
      // Include data based on matching
      if (isScheduleQuery || messageKeywords.includes('today') || messageKeywords.includes('now') || messageKeywords.includes('next')) {
        relevantData.programSchedule = table.programSchedule || [];
      }
      
      if (isCrewQuery || messageKeywords.includes('today') || messageKeywords.includes('assigned')) {
        relevantData.rows = table.rows || [];
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

      // For general questions, include core data
      if (!isScheduleQuery && !isCrewQuery && !isGearQuery && !isTaskQuery && !isTravelQuery && !isCardQuery && !isShotQuery) {
        relevantData.programSchedule = (table.programSchedule || []).slice(0, 5);
        relevantData.rows = (table.rows || []).slice(0, 5);
        relevantData.tasks = (table.tasks || []).slice(0, 5);
      }

      console.log('\n📋 DATA INCLUDED:');
      Object.keys(relevantData).forEach(key => {
        const value = relevantData[key];
        if (Array.isArray(value)) {
          console.log(`  ${key}: ${value.length} items`);
          if (value.length > 0 && value.length <= 3) {
            console.log(`    Sample: ${JSON.stringify(value[0], null, 2).substring(0, 200)}...`);
          }
        } else if (typeof value === 'object' && value !== null) {
          console.log(`  ${key}: Object with keys: ${Object.keys(value).join(', ')}`);
        } else {
          console.log(`  ${key}: ${value}`);
        }
      });

      console.log('\n🎯 ANALYSIS:');
      
      // Check for empty data
      const emptyArrays = Object.keys(relevantData).filter(key => 
        Array.isArray(relevantData[key]) && relevantData[key].length === 0
      );
      
      if (emptyArrays.length > 0) {
        console.log(`⚠️  Empty data arrays: ${emptyArrays.join(', ')}`);
      }

      // Check for missing expected data
      if (isScheduleQuery && (!relevantData.programSchedule || relevantData.programSchedule.length === 0)) {
        console.log('⚠️  Schedule query but no programSchedule data');
      }
      
      if (isCrewQuery && (!relevantData.rows || relevantData.rows.length === 0)) {
        console.log('⚠️  Crew query but no rows data');
      }

      // Suggest improvements
      console.log('\n💡 SUGGESTIONS:');
      if (!relevantData.general || Object.keys(relevantData.general).length === 0) {
        console.log('  - Add basic event info (location, dates, client) to general section');
      }
      
      if (!relevantData.programSchedule || relevantData.programSchedule.length === 0) {
        console.log('  - Add event schedule items to programSchedule');
      }
      
      if (!relevantData.rows || relevantData.rows.length === 0) {
        console.log('  - Add crew assignments to rows');
      }

      return relevantData;

    } catch (error) {
      console.error('❌ Debug error:', error.message);
    }
  }

  async runAllTests(tableId) {
    console.log(`\n🚀 RUNNING AI DEBUG TESTS FOR TABLE: ${tableId}`);
    console.log('='.repeat(60));

    for (const query of this.testQueries) {
      await this.debugQuery(tableId, query);
      console.log('\n' + '-'.repeat(60));
    }
  }

  async close() {
    await mongoose.connection.close();
    console.log('✅ Database connection closed');
  }
}

// Usage example
async function runDebugger() {
  const aiDebugger = new AIResponseDebugger();
  await aiDebugger.connect();
  
  // Replace with your actual table ID
  const tableId = process.argv[2];
  
  if (!tableId) {
    console.log('Usage: node debug-ai-responses.js <tableId>');
    console.log('Example: node debug-ai-responses.js 507f1f77bcf86cd799439011');
    process.exit(1);
  }
  
  await aiDebugger.runAllTests(tableId);
  await aiDebugger.close();
}

// Uncomment to run:
// runDebugger().catch(console.error);

module.exports = { AIResponseDebugger };

// Simple script to check what event data looks like
const mongoose = require('mongoose');
const Table = require('./models/Table');
require('dotenv').config();

async function checkEventData() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');
        
        // Get the first table to examine data structure
        const tables = await Table.find({}).limit(5);
        
        if (tables.length === 0) {
            console.log('❌ No tables found');
            return;
        }
        
        console.log(`\n📋 Found ${tables.length} tables. Analyzing first one:`);
        
        const table = tables[0];
        console.log(`\n🎯 Event: "${table.title}"`);
        console.log(`📅 ID: ${table._id}`);
        
        // Check programSchedule structure
        console.log(`\n📅 PROGRAM SCHEDULE:`);
        if (table.programSchedule && table.programSchedule.length > 0) {
            console.log(`  Found ${table.programSchedule.length} schedule items`);
            console.log(`  First item structure:`, JSON.stringify(table.programSchedule[0], null, 2));
            
            // Look for keynote specifically
            const keynoteItems = table.programSchedule.filter(item => 
                item.name && item.name.toLowerCase().includes('keynote')
            );
            
            if (keynoteItems.length > 0) {
                console.log(`\n🎤 KEYNOTE FOUND:`);
                keynoteItems.forEach((item, index) => {
                    console.log(`  ${index + 1}. ${item.name}`);
                    console.log(`     Time: ${item.startTime} - ${item.endTime}`);
                    console.log(`     Date: ${item.date}`);
                    console.log(`     Location: ${item.location || 'Not specified'}`);
                });
            } else {
                console.log(`  ❌ No keynote items found`);
                console.log(`  Available sessions:`, table.programSchedule.map(item => item.name));
            }
        } else {
            console.log(`  ❌ No programSchedule data`);
        }
        
        // Check general info
        console.log(`\n📝 GENERAL INFO:`);
        if (table.general) {
            console.log(`  Location: ${table.general.location || 'Not set'}`);
            console.log(`  Start: ${table.general.start || 'Not set'}`);
            console.log(`  End: ${table.general.end || 'Not set'}`);
            console.log(`  Client: ${table.general.client || 'Not set'}`);
        } else {
            console.log(`  ❌ No general info`);
        }
        
        // Check other data sections
        console.log(`\n📊 OTHER DATA SECTIONS:`);
        console.log(`  Rows (crew): ${table.rows?.length || 0} items`);
        console.log(`  Tasks: ${table.tasks?.length || 0} items`);
        console.log(`  Travel: ${table.travel?.length || 0} items`);
        console.log(`  Shotlists: ${table.shotlists?.length || 0} items`);
        console.log(`  Documents: ${table.documents?.length || 0} items`);
        
        // Simulate the AI query logic
        console.log(`\n🤖 SIMULATING AI QUERY: "What time is keynote?"`);
        const messageKeywords = "what time is keynote?".toLowerCase();
        const isScheduleQuery = messageKeywords.match(/schedule|time|when|start|end|session|keynote|presentation|meeting|event|program|agenda/);
        
        console.log(`  Schedule query detected: ${!!isScheduleQuery}`);
        
        if (isScheduleQuery && table.programSchedule) {
            console.log(`  AI would receive this schedule data:`);
            console.log(JSON.stringify(table.programSchedule, null, 2));
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await mongoose.connection.close();
    }
}

checkEventData();

// Test script specifically for keynote query issues
const mongoose = require('mongoose');
const Table = require('./models/Table');
require('dotenv').config();

async function testKeynoteQuery() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');
        
        // Get your actual table
        const table = await Table.findOne({});
        if (!table) {
            console.log('❌ No table found');
            return;
        }
        
        console.log(`\n🎯 Testing keynote query for: "${table.title}"`);
        
        // Simulate the exact logic from the chat endpoint
        const message = "What time is keynote?";
        const messageKeywords = message.toLowerCase();
        
        console.log(`\n🔍 Query: "${message}"`);
        console.log(`🔑 Keywords: "${messageKeywords}"`);
        
        // Test keyword matching
        const isScheduleQuery = messageKeywords.match(/schedule|time|when|start|end|session|keynote|presentation|meeting|event|program|agenda/);
        console.log(`📅 Schedule query detected: ${!!isScheduleQuery}`);
        console.log(`🎤 Contains 'keynote': ${messageKeywords.includes('keynote')}`);
        
        // Check what data would be included
        const relevantData = {
            eventTitle: table.title,
            currentUser: 'Test User',
            currentDate: new Date().toISOString()
        };
        
        relevantData.general = table.general || {};
        
        if (isScheduleQuery || messageKeywords.includes('keynote')) {
            relevantData.programSchedule = table.programSchedule || [];
            console.log(`📋 Schedule data included: ${relevantData.programSchedule.length} items`);
            
            // Find keynote specifically
            const keynoteItems = relevantData.programSchedule.filter(item => 
                item.name && item.name.toLowerCase().includes('keynote')
            );
            
            console.log(`\n🎤 KEYNOTE SEARCH RESULTS:`);
            if (keynoteItems.length > 0) {
                keynoteItems.forEach((item, index) => {
                    console.log(`  ${index + 1}. "${item.name}"`);
                    console.log(`     ⏰ Time: ${item.startTime} - ${item.endTime}`);
                    console.log(`     📅 Date: ${item.date}`);
                    console.log(`     📍 Location: ${item.location}`);
                });
                
                console.log(`\n✅ EXPECTED AI RESPONSE:`);
                const firstKeynote = keynoteItems[0];
                console.log(`"The keynote is scheduled for ${firstKeynote.startTime} - ${firstKeynote.endTime} on ${firstKeynote.date} at ${firstKeynote.location}"`);
            } else {
                console.log(`  ❌ No keynote items found in programSchedule`);
                console.log(`  📝 Available session names:`, relevantData.programSchedule.map(item => item.name).slice(0, 5));
            }
        } else {
            console.log(`❌ Schedule data would NOT be included`);
        }
        
        // Check data size
        const dataString = JSON.stringify(relevantData);
        console.log(`\n📊 Total data size: ${dataString.length} characters`);
        
        if (dataString.length > 8000) {
            console.log(`⚠️  Data would be truncated (over 8000 chars)`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await mongoose.connection.close();
    }
}

testKeynoteQuery();

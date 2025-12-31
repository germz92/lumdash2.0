// Test script for personal queries and call time understanding
const mongoose = require('mongoose');
const Table = require('./models/Table');
require('dotenv').config();

async function testPersonalQueries() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');
        
        const table = await Table.findOne({});
        if (!table) {
            console.log('❌ No table found');
            return;
        }
        
        console.log(`\n🎯 Testing personal queries for: "${table.title}"`);
        console.log(`👥 Total crew entries (call times): ${table.rows?.length || 0}`);
        
        // Show some sample crew data to understand structure
        if (table.rows && table.rows.length > 0) {
            console.log(`\n📋 Sample call time entries:`);
            table.rows.slice(0, 3).forEach((row, index) => {
                console.log(`  ${index + 1}. ${row.name} - ${row.role}`);
                console.log(`     📅 Date: ${row.date}`);
                console.log(`     ⏰ Call time: ${row.startTime} - ${row.endTime}`);
                console.log(`     📝 Notes: ${row.notes || 'No notes'}`);
                console.log('');
            });
        }
        
        // Test personal query detection
        const personalQueries = [
            "What time do I need to be there?",
            "When do I work tomorrow?",
            "What's my call time?",
            "Am I working today?",
            "What's my role?",
            "Do I have any assignments?",
            "When should I arrive?",
            "What time do I start?",
            "My call time for tomorrow",
            "Where am I assigned?"
        ];
        
        const nonPersonalQueries = [
            "What time does John start?",
            "Who's working tomorrow?",
            "When is the keynote?",
            "What's the crew schedule?",
            "Where is everyone assigned?"
        ];
        
        console.log(`\n🔍 Testing personal query detection:`);
        
        personalQueries.forEach(query => {
            const messageKeywords = query.toLowerCase();
            const isPersonalQuery = messageKeywords.match(/\b(i|my|me|am|do i|when do i|what time do i|where do i|should i)\b/) || 
                                   messageKeywords.includes('my call') || 
                                   messageKeywords.includes('my time') ||
                                   messageKeywords.includes('my assignment') ||
                                   messageKeywords.includes('my role');
            
            console.log(`  "${query}" → ${isPersonalQuery ? '✅ Personal' : '❌ Not Personal'}`);
        });
        
        console.log(`\n🔍 Testing non-personal query detection:`);
        
        nonPersonalQueries.forEach(query => {
            const messageKeywords = query.toLowerCase();
            const isPersonalQuery = messageKeywords.match(/\b(i|my|me|am|do i|when do i|what time do i|where do i|should i)\b/) || 
                                   messageKeywords.includes('my call') || 
                                   messageKeywords.includes('my time') ||
                                   messageKeywords.includes('my assignment') ||
                                   messageKeywords.includes('my role');
            
            console.log(`  "${query}" → ${isPersonalQuery ? '❌ Incorrectly Personal' : '✅ Correctly Not Personal'}`);
        });
        
        // Test user matching in crew data
        const testUserName = "John"; // You can change this to test with actual names
        console.log(`\n👤 Testing user matching for "${testUserName}":`);
        
        if (table.rows) {
            const userCrew = table.rows.filter(member => 
                member.name && member.name.toLowerCase().includes(testUserName.toLowerCase())
            );
            
            console.log(`  Found ${userCrew.length} call time entries for ${testUserName}:`);
            userCrew.forEach((entry, index) => {
                console.log(`    ${index + 1}. ${entry.date}: ${entry.startTime}-${entry.endTime} (${entry.role})`);
            });
        }
        
        console.log(`\n🎉 Personal query system test complete!`);
        console.log(`💡 Expected AI behavior:`);
        console.log(`   - Personal queries ("What time do I need to be there?") will prioritize user's call times`);
        console.log(`   - AI will respond with "Your call time is..." instead of "The call time is..."`);
        console.log(`   - User's crew entries will be included first in the data`);
        console.log(`   - AI understands crew page as CALL TIMES, not just assignments`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await mongoose.connection.close();
    }
}

testPersonalQueries();

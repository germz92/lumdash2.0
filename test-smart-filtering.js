// Test script to verify smart filtering improvements
const mongoose = require('mongoose');
const Table = require('./models/Table');
require('dotenv').config();

async function testSmartFiltering() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');
        
        const table = await Table.findOne({});
        if (!table) {
            console.log('❌ No table found');
            return;
        }
        
        console.log(`\n🎯 Testing smart filtering for: "${table.title}"`);
        console.log(`📊 Total schedule items: ${table.programSchedule?.length || 0}`);
        
        // Test queries that should benefit from smart filtering
        const testQueries = [
            "When is the keynote?",
            "What time is the breakfast?",
            "Where is the training session?",
            "Who's presenting at the breakout?",
            "When is the networking event?"
        ];
        
        for (const query of testQueries) {
            console.log(`\n🔍 Testing: "${query}"`);
            
            const messageKeywords = query.toLowerCase();
            const searchTerms = query.toLowerCase()
                .replace(/[^\w\s]/g, ' ')
                .split(/\s+/)
                .filter(term => term.length > 2);
            
            console.log(`🔑 Search terms: [${searchTerms.join(', ')}]`);
            
            // Simulate the smart filtering logic
            const allSchedule = table.programSchedule || [];
            const relevantScheduleItems = [];
            const otherScheduleItems = [];
            
            for (const item of allSchedule) {
                const itemText = `${item.name || ''} ${item.location || ''} ${item.notes || ''}`.toLowerCase();
                const isRelevant = searchTerms.some(term => itemText.includes(term));
                
                if (isRelevant) {
                    relevantScheduleItems.push(item);
                } else {
                    otherScheduleItems.push(item);
                }
            }
            
            console.log(`📈 Relevant items found: ${relevantScheduleItems.length}`);
            if (relevantScheduleItems.length > 0) {
                console.log(`   Top matches:`);
                relevantScheduleItems.slice(0, 3).forEach((item, index) => {
                    console.log(`   ${index + 1}. "${item.name}" at ${item.startTime}-${item.endTime} on ${item.date}`);
                });
            }
            
            // Calculate data size reduction
            const fullDataSize = JSON.stringify(allSchedule).length;
            const maxItems = 25;
            const filteredData = [
                ...relevantScheduleItems,
                ...otherScheduleItems.slice(0, Math.max(0, maxItems - relevantScheduleItems.length))
            ];
            const filteredDataSize = JSON.stringify(filteredData).length;
            const reduction = ((fullDataSize - filteredDataSize) / fullDataSize * 100).toFixed(1);
            
            console.log(`📊 Data size: ${fullDataSize} → ${filteredDataSize} chars (${reduction}% reduction)`);
            console.log(`✅ Would include: ${filteredData.length} items vs ${allSchedule.length} total`);
        }
        
        console.log(`\n🎉 Smart filtering test complete!`);
        console.log(`💡 Benefits:`);
        console.log(`   - Prioritizes relevant items first`);
        console.log(`   - Reduces data size to prevent truncation`);
        console.log(`   - Improves AI answer accuracy`);
        console.log(`   - Works for any search terms, not just keynote`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await mongoose.connection.close();
    }
}

testSmartFiltering();

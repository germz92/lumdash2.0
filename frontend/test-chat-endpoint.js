// Test script to debug chat endpoint issues
const fetch = require('node-fetch');
require('dotenv').config();

async function testChatEndpoint() {
    console.log('🧪 TESTING CHAT ENDPOINT');
    console.log('='.repeat(40));
    
    // You'll need to replace these with actual values
    const API_BASE = 'http://localhost:3000'; // or 3001 if that's your backend port
    const tableId = 'YOUR_TABLE_ID'; // Replace with actual table ID
    const token = 'YOUR_AUTH_TOKEN'; // Replace with actual auth token
    
    console.log(`🌐 Testing against: ${API_BASE}`);
    console.log(`📋 Table ID: ${tableId}`);
    
    const testQueries = [
        'What day is it?', // Simple query that works
        'What is the event location?', // Data query that might fail
        'What is the schedule?', // Data query that might fail
        'Hello' // Simple query
    ];
    
    for (const query of testQueries) {
        console.log(`\n🔍 Testing: "${query}"`);
        
        try {
            const response = await fetch(`${API_BASE}/api/chat/${tableId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token
                },
                body: JSON.stringify({ 
                    message: query,
                    conversationHistory: [],
                    pageContext: {}
                })
            });
            
            console.log(`📊 Status: ${response.status}`);
            
            if (response.ok) {
                // Handle streaming response
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let fullResponse = '';
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if (data.error) {
                                    console.log(`❌ Error: ${data.error}`);
                                    break;
                                }
                                if (data.content) {
                                    fullResponse += data.content;
                                }
                                if (data.done) {
                                    console.log(`✅ Success: "${fullResponse.substring(0, 100)}..."`);
                                    break;
                                }
                            } catch (parseError) {
                                // Skip invalid JSON lines
                            }
                        }
                    }
                }
            } else {
                const errorText = await response.text();
                console.log(`❌ HTTP Error: ${errorText}`);
            }
            
        } catch (error) {
            console.log(`❌ Request failed: ${error.message}`);
        }
        
        // Wait between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

// Instructions for manual testing
console.log('📝 MANUAL TESTING INSTRUCTIONS:');
console.log('1. Open this file and replace:');
console.log('   - YOUR_TABLE_ID with an actual table ID');
console.log('   - YOUR_AUTH_TOKEN with a valid auth token');
console.log('   - Port (3000 or 3001) with your actual backend port');
console.log('2. Run: node test-chat-endpoint.js');
console.log('');
console.log('Or test manually in browser dev tools:');
console.log('');
console.log('fetch("/api/chat/YOUR_TABLE_ID", {');
console.log('  method: "POST",');
console.log('  headers: {"Content-Type": "application/json", "Authorization": localStorage.getItem("token")},');
console.log('  body: JSON.stringify({message: "What day is it?"})');
console.log('}).then(r => r.text()).then(console.log)');

// Uncomment to run automatic test (after setting up credentials)
// testChatEndpoint().catch(console.error);

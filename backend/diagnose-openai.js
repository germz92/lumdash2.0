const OpenAI = require('openai');
require('dotenv').config();

console.log('🔍 DIAGNOSING OPENAI CONFIGURATION');
console.log('='.repeat(40));

// Check environment variables
console.log('📋 Environment Check:');
console.log(`✓ OPENAI_API_KEY exists: ${!!process.env.OPENAI_API_KEY}`);
if (process.env.OPENAI_API_KEY) {
    console.log(`✓ API key starts with 'sk-': ${process.env.OPENAI_API_KEY.startsWith('sk-')}`);
    console.log(`✓ API key length: ${process.env.OPENAI_API_KEY.length} characters`);
    console.log(`✓ API key preview: ${process.env.OPENAI_API_KEY.substring(0, 10)}...${process.env.OPENAI_API_KEY.slice(-4)}`);
} else {
    console.log('❌ OPENAI_API_KEY not found in environment');
    console.log('\n🔧 TO FIX: Add your OpenAI API key to .env file:');
    console.log('OPENAI_API_KEY=sk-your-api-key-here');
    process.exit(1);
}

// Test OpenAI initialization
console.log('\n🚀 OpenAI Client Test:');
try {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    console.log('✅ OpenAI client created successfully');

    // Test API connection with a simple request
    console.log('\n🌐 Testing API Connection...');
    
    openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
            { role: "user", content: "Say 'API test successful' in exactly those words" }
        ],
        max_tokens: 10,
        temperature: 0
    }).then(response => {
        console.log('✅ API Connection Successful!');
        console.log(`✅ Response: "${response.choices[0].message.content}"`);
        console.log('\n🎉 Your OpenAI configuration is working correctly!');
        console.log('\nIf you\'re still getting "AI service temporarily unavailable":');
        console.log('1. Restart your backend server');
        console.log('2. Check for any rate limiting (try again in a few minutes)');
        console.log('3. Verify your OpenAI account has sufficient credits');
    }).catch(error => {
        console.log('\n❌ API Connection Failed!');
        console.log(`Error: ${error.message}`);
        
        if (error.status === 401) {
            console.log('\n🔧 FIX: Invalid API key');
            console.log('1. Get a new API key from https://platform.openai.com/api-keys');
            console.log('2. Update your .env file with the correct key');
        } else if (error.status === 429) {
            console.log('\n🔧 FIX: Rate limit or quota exceeded');
            console.log('1. Check your OpenAI usage at https://platform.openai.com/usage');
            console.log('2. Add billing if you\'ve exceeded free tier');
            console.log('3. Wait a few minutes and try again');
        } else if (error.status === 403) {
            console.log('\n🔧 FIX: Forbidden - possible country/billing issue');
            console.log('1. Check if OpenAI is available in your country');
            console.log('2. Verify billing information');
        } else {
            console.log('\n🔧 OTHER ISSUES:');
            console.log('1. Check your internet connection');
            console.log('2. Try again in a few minutes');
            console.log('3. Check OpenAI status at https://status.openai.com/');
        }
        
        process.exit(1);
    });

} catch (error) {
    console.log('❌ Failed to create OpenAI client');
    console.log(`Error: ${error.message}`);
    
    console.log('\n🔧 TO FIX:');
    console.log('1. Make sure openai package is installed: npm install openai');
    console.log('2. Check your API key format (should start with sk-)');
    console.log('3. Restart your application');
    
    process.exit(1);
}

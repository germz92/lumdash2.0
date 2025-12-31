const OpenAI = require('openai');
require('dotenv').config();

console.log('🧪 Testing Streaming Chat Functionality');
console.log('=====================================');

async function testStreamingChat() {
  try {
    // Check if OpenAI is configured
    if (!process.env.OPENAI_API_KEY) {
      console.log('❌ OPENAI_API_KEY not found in environment variables');
      return;
    }

    console.log('✅ OpenAI API key found');
    
    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    console.log('✅ OpenAI client initialized');
    console.log('🔄 Starting streaming test...\n');

    // Test streaming with a simple question
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are Luma, a helpful AI assistant for event photography management. Be concise but friendly."
        },
        {
          role: "user",
          content: "Hello! Can you tell me what you can help me with?"
        }
      ],
      max_tokens: 150,
      temperature: 0.3,
      stream: true
    });

    let fullResponse = '';
    let chunkCount = 0;

    console.log('📡 Streaming response:');
    console.log('----------------------');

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        process.stdout.write(content);
        fullResponse += content;
        chunkCount++;
      }
    }

    console.log('\n----------------------');
    console.log(`✅ Streaming completed successfully!`);
    console.log(`📊 Stats:`);
    console.log(`   - Chunks received: ${chunkCount}`);
    console.log(`   - Total characters: ${fullResponse.length}`);
    console.log(`   - Response length: ${fullResponse.trim().split(' ').length} words`);

  } catch (error) {
    console.error('❌ Streaming test failed:', error.message);
    
    if (error.status === 429) {
      console.log('💡 Tip: Add billing to your OpenAI account at platform.openai.com/billing');
    } else if (error.status === 401) {
      console.log('💡 Tip: Check your OpenAI API key configuration');
    }
  }
}

// Run the test
testStreamingChat(); 
const OpenAI = require('openai');
require('dotenv').config();

console.log('Testing OpenAI configuration...');
console.log('OPENAI_API_KEY exists:', !!process.env.OPENAI_API_KEY);
console.log('OPENAI_API_KEY starts with sk-:', process.env.OPENAI_API_KEY?.startsWith('sk-'));
console.log('OPENAI_API_KEY length:', process.env.OPENAI_API_KEY?.length);

// Test OpenAI initialization
try {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  console.log('✅ OpenAI client created successfully');
  
  // Test a simple API call
  openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "user", content: "Say hello in one word" }
    ],
    max_tokens: 10
  }).then(response => {
    console.log('✅ OpenAI API call successful');
    console.log('Response:', response.choices[0].message.content);
  }).catch(error => {
    console.error('❌ OpenAI API call failed:', error.message);
  });
  
} catch (error) {
  console.error('❌ OpenAI client creation failed:', error.message);
} 
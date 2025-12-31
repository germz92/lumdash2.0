// Alternative AI provider implementation for faster responses
// This example shows how to integrate Claude (Anthropic) for even faster responses

const Anthropic = require('@anthropic-ai/sdk');

// Initialize Claude client (you would need to install @anthropic-ai/sdk and get API key)
let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

// Example function to use Claude Haiku for ultra-fast responses
async function callClaudeHaiku(systemPrompt, userMessage) {
  if (!anthropic) {
    throw new Error('Claude API not configured');
  }

  const response = await anthropic.messages.create({
    model: "claude-3-haiku-20240307", // Fastest Claude model
    max_tokens: 300,
    temperature: 0.3,
    system: systemPrompt,
    messages: [
      { role: "user", content: userMessage }
    ]
  });

  return response.content[0].text;
}

// Alternative endpoint using Claude for comparison
// Add this to your server.js if you want to test Claude:
/*
app.post('/api/chat-claude/:tableId', authenticate, async (req, res) => {
  try {
    const { message } = req.body;
    const tableId = req.params.tableId;
    
    // ... same data preparation logic as main endpoint ...
    
    const response = await callClaudeHaiku(systemPrompt, message);
    
    res.json({ response, source: 'claude-haiku' });
    
  } catch (error) {
    console.error('Claude API error:', error);
    res.status(500).json({ error: 'Claude request failed' });
  }
});
*/

module.exports = { callClaudeHaiku };

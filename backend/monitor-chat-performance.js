// Chat Performance Monitoring Script
// Run this to test and monitor AI chat response times

const fs = require('fs');
const path = require('path');

class ChatPerformanceMonitor {
  constructor() {
    this.metrics = [];
    this.logFile = path.join(__dirname, 'logs', 'chat-performance.log');
  }

  async measureResponse(testQuestions, apiEndpoint, headers) {
    console.log('🚀 Starting chat performance test...\n');
    
    for (let i = 0; i < testQuestions.length; i++) {
      const question = testQuestions[i];
      console.log(`Testing question ${i + 1}/${testQuestions.length}: "${question}"`);
      
      const startTime = Date.now();
      
      try {
        const response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ message: question })
        });

        if (response.ok) {
          let firstChunkTime = null;
          let totalResponseTime = null;
          let fullResponse = '';

          // Handle streaming response
          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            if (!firstChunkTime) {
              firstChunkTime = Date.now() - startTime;
            }

            const chunk = decoder.decode(value);
            fullResponse += chunk;
          }

          totalResponseTime = Date.now() - startTime;

          const metric = {
            question,
            firstChunkTime,
            totalResponseTime,
            responseLength: fullResponse.length,
            timestamp: new Date().toISOString()
          };

          this.metrics.push(metric);
          
          console.log(`  ✅ First chunk: ${firstChunkTime}ms`);
          console.log(`  ✅ Total time: ${totalResponseTime}ms`);
          console.log(`  📝 Response length: ${fullResponse.length} chars\n`);

        } else {
          console.log(`  ❌ Failed with status: ${response.status}\n`);
        }

      } catch (error) {
        console.log(`  ❌ Error: ${error.message}\n`);
      }

      // Wait between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.generateReport();
  }

  generateReport() {
    if (this.metrics.length === 0) {
      console.log('❌ No successful responses to analyze');
      return;
    }

    const avgFirstChunk = this.metrics.reduce((sum, m) => sum + m.firstChunkTime, 0) / this.metrics.length;
    const avgTotalTime = this.metrics.reduce((sum, m) => sum + m.totalResponseTime, 0) / this.metrics.length;
    const minFirstChunk = Math.min(...this.metrics.map(m => m.firstChunkTime));
    const maxFirstChunk = Math.max(...this.metrics.map(m => m.firstChunkTime));
    const minTotalTime = Math.min(...this.metrics.map(m => m.totalResponseTime));
    const maxTotalTime = Math.max(...this.metrics.map(m => m.totalResponseTime));

    const report = `
📊 CHAT PERFORMANCE REPORT
=========================
Test Date: ${new Date().toLocaleString()}
Total Tests: ${this.metrics.length}

⚡ FIRST CHUNK TIMES (Time to start streaming):
  Average: ${Math.round(avgFirstChunk)}ms
  Fastest: ${minFirstChunk}ms
  Slowest: ${maxFirstChunk}ms

🏁 TOTAL RESPONSE TIMES:
  Average: ${Math.round(avgTotalTime)}ms
  Fastest: ${minTotalTime}ms
  Slowest: ${maxTotalTime}ms

🎯 PERFORMANCE TARGETS:
  First chunk < 1000ms: ${this.metrics.filter(m => m.firstChunkTime < 1000).length}/${this.metrics.length} ✓
  Total time < 3000ms: ${this.metrics.filter(m => m.totalResponseTime < 3000).length}/${this.metrics.length} ✓
  
📈 RECOMMENDATIONS:
${avgFirstChunk > 1000 ? '⚠️  Consider reducing context size or switching to faster model' : '✅ First chunk times are good'}
${avgTotalTime > 3000 ? '⚠️  Consider reducing max_tokens or optimizing prompts' : '✅ Total response times are good'}
`;

    console.log(report);

    // Save detailed metrics to log file
    const detailedLog = {
      timestamp: new Date().toISOString(),
      summary: {
        avgFirstChunk: Math.round(avgFirstChunk),
        avgTotalTime: Math.round(avgTotalTime),
        testCount: this.metrics.length
      },
      metrics: this.metrics
    };

    // Ensure logs directory exists
    const logsDir = path.dirname(this.logFile);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    fs.appendFileSync(this.logFile, JSON.stringify(detailedLog) + '\n');
    console.log(`📁 Detailed metrics saved to: ${this.logFile}`);
  }
}

// Test questions for performance testing
const TEST_QUESTIONS = [
  "What's the schedule for today?",
  "Who is assigned to photography?",
  "What gear do we have reserved?",
  "What tasks need to be done?",
  "When does the event start?",
  "Are there any travel arrangements?",
  "What's the weather like?",
  "Show me the shot list",
  "What cards are being used?",
  "Who's on the crew?"
];

// Usage example (uncomment to run):
/*
async function runPerformanceTest() {
  const monitor = new ChatPerformanceMonitor();
  
  // Replace with your actual API endpoint and auth
  const apiEndpoint = 'http://localhost:3001/api/chat/YOUR_TABLE_ID';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_TOKEN'
  };
  
  await monitor.measureResponse(TEST_QUESTIONS, apiEndpoint, headers);
}

// runPerformanceTest();
*/

module.exports = { ChatPerformanceMonitor, TEST_QUESTIONS };

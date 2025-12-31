#!/bin/bash

echo "🔄 Restarting LumDash Backend Server..."
echo

# Kill any existing node processes
echo "🛑 Stopping existing server..."
pkill -f "node server.js" 2>/dev/null || true
sleep 2

echo
echo "🚀 Starting server with enhanced error handling..."
echo
echo "📊 Watch for these logs:"
echo "  - Data size measurements"
echo "  - Error details if queries fail"
echo "  - Cache key generation"
echo

# Start the server
node server.js

#!/bin/bash

# Soul-Bot Production Startup Script

# Change to the project directory
cd "$(dirname "$0")"

# Create logs directory if it doesn't exist
mkdir -p web/server/logs

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Set LOG_LEVEL if not already set
export LOG_LEVEL=${LOG_LEVEL:-info}

echo "Starting Soul-Bot in production mode..."
echo "Log files will be stored in web/server/logs/"

# Start the server with proper logging
node web/server/server.js >> web/server/logs/server.log 2>> web/server/logs/error.log &

# Store the PID for later management
echo $! > .soul-bot.pid

echo "Soul-Bot started with PID: $(cat .soul-bot.pid)"
echo "Access the dashboard at http://localhost:${PORT:-3030}" 
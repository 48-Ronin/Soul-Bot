#!/bin/bash

# Soul-Bot Server Launcher

echo "Starting Soul-Bot Trading Dashboard Server..."

# Kill any existing server instances
pkill -f "node server.js" || true

# Navigate to the server directory
cd "$(dirname "$0")/web/server"

# Start the server
node server.js

echo "Server stopped." 
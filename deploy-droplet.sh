#!/bin/bash

# Soul-Bot Deployment Script for DigitalOcean

echo "=== Soul-Bot Deployment ==="
echo "This script will deploy Soul-Bot to a DigitalOcean droplet."

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null
then
    echo "PM2 is not installed. Installing PM2..."
    npm install -g pm2
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Create necessary directories
echo "Creating data directories..."
mkdir -p data/ml_models
mkdir -p logs
mkdir -p paper_trading_data

# Set permissions
echo "Setting permissions..."
chmod -R 755 .

# Start the application with PM2
echo "Starting Soul-Bot with PM2..."
pm2 start ecosystem.config.js --env production

# Save PM2 process list and startup script
echo "Saving PM2 process list and generating startup script..."
pm2 save
pm2 startup

echo "=== Deployment Complete ==="
echo "Soul-Bot is now running at http://localhost:3001"
echo "To make it accessible from the internet, configure Nginx as a reverse proxy"
echo "You can use the following Nginx configuration:"
echo ""
echo "server {"
echo "    listen 80;"
echo "    server_name your-domain.com;"
echo ""
echo "    location / {"
echo "        proxy_pass http://localhost:3001;"
echo "        proxy_http_version 1.1;"
echo "        proxy_set_header Upgrade \$http_upgrade;"
echo "        proxy_set_header Connection 'upgrade';"
echo "        proxy_set_header Host \$host;"
echo "        proxy_cache_bypass \$http_upgrade;"
echo "    }"
echo "}" 
#!/bin/bash

# Soul-Bot Deployment Script for Digital Ocean
# This script will deploy the Soul-Bot to a Digital Ocean Droplet

# Load environment variables
source .env

# Check if DIGITAL_OCEAN_IP is set
if [ -z "$DIGITAL_OCEAN_IP" ]; then
  echo "Error: DIGITAL_OCEAN_IP is not set in .env file"
  exit 1
fi

# Display deployment information
echo "Deploying Soul-Bot to Digital Ocean Droplet at $DIGITAL_OCEAN_IP"
echo "------------------------------------------------------------"

# Prepare deployment package
echo "Preparing deployment package..."
npm run build || echo "No build step defined, skipping..."

# Clear paper trading data to reset balances
echo "Clearing paper trading data to start fresh..."
rm -rf paper_trading_data

# Create deployment directory if it doesn't exist
echo "Creating deployment directory..."
ssh root@$DIGITAL_OCEAN_IP "mkdir -p /root/soul-bot"

# Copy files to the droplet
echo "Copying files to Digital Ocean Droplet..."
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude '.env' ./ root@$DIGITAL_OCEAN_IP:/root/soul-bot/

# Copy .env file separately
echo "Copying environment configuration..."
scp .env root@$DIGITAL_OCEAN_IP:/root/soul-bot/.env

# Install dependencies on the server
echo "Installing dependencies on the server..."
ssh root@$DIGITAL_OCEAN_IP "cd /root/soul-bot && npm install"

# Update DNS settings on the droplet to fix Jupiter API connection
echo "Updating DNS settings on the droplet to fix API connection issues..."
ssh root@$DIGITAL_OCEAN_IP "echo 'nameserver 8.8.8.8' > /etc/resolv.conf && echo 'nameserver 8.8.4.4' >> /etc/resolv.conf"

# Create systemd service file for auto-restart
echo "Creating systemd service file..."
cat > soul-bot.service << EOF
[Unit]
Description=Soul-Bot Trading Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/soul-bot
ExecStart=/usr/bin/node main.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=soul-bot
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
EOF

# Copy service file to server
scp soul-bot.service root@$DIGITAL_OCEAN_IP:/etc/systemd/system/

# Set up systemd service
echo "Setting up systemd service..."
ssh root@$DIGITAL_OCEAN_IP "systemctl daemon-reload && systemctl enable soul-bot && systemctl restart soul-bot"

# Create a separate systemd service for the dashboard server
echo "Creating dashboard service file..."
cat > soul-bot-dashboard.service << EOF
[Unit]
Description=Soul-Bot Trading Bot Dashboard
After=network.target soul-bot.service

[Service]
Type=simple
User=root
WorkingDirectory=/root/soul-bot
ExecStart=/usr/bin/node web/server.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=soul-bot-dashboard
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
EOF

# Copy dashboard service file to server
scp soul-bot-dashboard.service root@$DIGITAL_OCEAN_IP:/etc/systemd/system/

# Set up dashboard systemd service
echo "Setting up dashboard systemd service..."
ssh root@$DIGITAL_OCEAN_IP "systemctl daemon-reload && systemctl enable soul-bot-dashboard && systemctl restart soul-bot-dashboard"

# Check status of services
echo "Checking status of services..."
ssh root@$DIGITAL_OCEAN_IP "systemctl status soul-bot --no-pager && systemctl status soul-bot-dashboard --no-pager"

echo "------------------------------------------------------------"
echo "Soul-Bot has been deployed to Digital Ocean Droplet at $DIGITAL_OCEAN_IP"
echo "Dashboard available at: http://$DIGITAL_OCEAN_IP:3001"
echo "------------------------------------------------------------"

# Make script executable
chmod +x deploy.sh 
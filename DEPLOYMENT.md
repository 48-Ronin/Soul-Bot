# Soul-Bot Deployment Guide

This guide provides step-by-step instructions for deploying Soul-Bot on a DigitalOcean Droplet.

## Prerequisites

- A DigitalOcean account
- Basic knowledge of Linux commands
- A domain name (optional, but recommended for production use)

## Step 1: Create a Droplet

1. Log in to your DigitalOcean account
2. Click "Create" and select "Droplet"
3. Choose the following options:
   - **Image**: Ubuntu 20.04 LTS x64
   - **Plan**: Basic Shared CPU, 2GB RAM / 1 CPU (minimum recommended)
   - **Datacenter Region**: Choose the region closest to your users
   - **Authentication**: SSH keys (recommended) or Password
   - **Hostname**: soul-bot (or your preferred name)
4. Click "Create Droplet"

## Step 2: Connect to Your Droplet

Connect to your droplet using SSH:

```bash
ssh root@your-droplet-ip
```

## Step 3: Install Required Software

```bash
# Update system packages
apt update && apt upgrade -y

# Install Node.js and npm
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs

# Install Git
apt install -y git

# Verify installations
node -v
npm -v
git --version
```

## Step 4: Clone the Repository

```bash
# Create a directory for the application
mkdir -p /var/www
cd /var/www

# Clone the repository
git clone https://github.com/yourusername/Soul-Bot-Clone.git soul-bot
cd soul-bot

# Install dependencies
npm install
```

## Step 5: Configure Environment Variables

Create a `.env` file with the required configuration:

```bash
# Create .env file
nano .env
```

Add the following content:

```
# Environment settings
NODE_ENV=production

# Solana configuration
HELIUS_API_KEY=your-helius-api-key

# Trading bot settings
DEMO_MODE=true
SIMULATION_MODE=true
AUTO_START=true
MIN_PROFIT_THRESHOLD=1.5
AGGRESSIVE_TRADING=false
INITIAL_PAPER_BALANCE=1000

# Web Dashboard
WEB_PORT=3001
WEB_HOST=0.0.0.0

# Data directories
DATA_DIR=./data
LOGS_DIR=./logs
```

Save the file with Ctrl+X, then Y, then Enter.

## Step 6: Run the Deployment Script

```bash
# Make the deployment script executable
chmod +x deploy-droplet.sh

# Run the deployment script
./deploy-droplet.sh
```

## Step 7: Set Up Nginx as a Reverse Proxy (Optional but Recommended)

Install Nginx:

```bash
apt install -y nginx
```

Create a new Nginx configuration file:

```bash
nano /etc/nginx/sites-available/soul-bot
```

Add the following configuration:

```
server {
    listen 80;
    server_name your-domain.com;  # Replace with your domain or droplet's IP

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the configuration:

```bash
ln -s /etc/nginx/sites-available/soul-bot /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

## Step 8: Set Up SSL with Let's Encrypt (Optional)

If you're using a domain name, you can set up SSL for secure HTTPS access:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

Follow the prompts to complete the SSL setup.

## Troubleshooting

### If the application fails to start:

1. Check the logs:
   ```bash
   pm2 logs soul-bot
   ```

2. Verify the environment variables:
   ```bash
   cat .env
   ```

3. Check if the required ports are open:
   ```bash
   netstat -tuln | grep 3001
   ```

4. Restart the application:
   ```bash
   pm2 restart soul-bot
   ```

### If Nginx is not working:

1. Check Nginx logs:
   ```bash
   tail -f /var/log/nginx/error.log
   ```

2. Verify Nginx configuration:
   ```bash
   nginx -t
   ```

## Accessing the Dashboard

After successful deployment:

- If using Nginx with a domain: https://your-domain.com
- If using just the IP: http://your-droplet-ip:3001

## Updating the Application

To update the application with the latest changes:

```bash
cd /var/www/soul-bot
git pull
npm install
pm2 restart soul-bot
``` 
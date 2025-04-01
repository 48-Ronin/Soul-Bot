# Soul-Bot: Advanced Solana Trading Platform

Soul-Bot is a sophisticated trading platform for the Solana blockchain that combines machine learning, token discovery, and real-time market data to execute profitable trades.

## Features

- **Real-Time Trading Dashboard**: Monitor your trades, portfolio balance, and profit/loss metrics
- **Machine Learning Integration**: Trade predictions based on ML model with self-improving accuracy
- **Token Discovery**: Automatically discover new tradeable tokens with promising price movements
- **Demo & Live Modes**: Test strategies in demo mode before deploying with real funds
- **Wallet Integration**: Seamless connection with Phantom and Solflare wallets
- **Profit Lock System**: Automatically secure a percentage of your profits

## Installation

### Prerequisites

- Node.js (v16+)
- npm or yarn
- A Solana wallet (Phantom or Solflare recommended)
- API keys for Helius and/or Jupiter (for production use)

### Setup

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/soul-bot.git
   cd soul-bot
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Configure environment variables by creating a `.env` file based on `.env.example`:
   ```
   cp .env.example .env
   ```

4. Edit `.env` with your API keys and configuration:
   ```
   # Required for production
   HELIUS_API_KEY=your_helius_api_key
   
   # Optional for enhanced performance
   JUPITER_API_KEY=your_jupiter_api_key
   ```

## Running the Application

### Development Mode

Start the server:
```
cd web/server
node server.js
```

Access the dashboard at http://localhost:3030

### Production Deployment

For production deployment, we recommend using the provided startup script:

```
chmod +x start-soul-bot.sh
./start-soul-bot.sh
```

This script ensures proper environment loading and starts the server with appropriate logging.

### Using PM2 (Recommended for Production)

For improved reliability, use PM2 process manager:

```
npm install -g pm2
pm2 start web/server/server.js --name soul-bot
```

To enable automatic restart on system boot:
```
pm2 startup
pm2 save
```

## Usage Guide

1. **Dashboard**: The main interface displays your portfolio metrics and recent trades
2. **Trading Controls**:
   - Start/Stop: Begin or pause the trading bot
   - Scan: Manually trigger token discovery
   - ML Toggle: Enable/disable machine learning predictions
   - Token Discovery Toggle: Enable/disable new token discovery

3. **Wallet Integration**:
   - Connect your Phantom or Solflare wallet for live trading
   - In demo mode, no wallet connection is required

4. **Configuration Options**:
   - Profit Lock: Set percentage of profits to secure automatically
   - Trade Settings: Accessible via the trading panel

## API Documentation

Soul-Bot provides a WebSocket API for real-time updates and a REST API for configuration and data access. Key endpoints:

- `/api/trading/result`: Record trade results
- `/api/ml/toggle`: Enable/disable machine learning
- `/api/token-discovery/toggle`: Enable/disable token discovery
- `/api/profit-lock/configure`: Configure profit locking settings

## Security Considerations

- Never store private keys in this application
- Use wallet signing for all transactions
- Test thoroughly in demo mode before using real funds
- We recommend running in an isolated environment for production use

## Maintenance

Logs are stored in `web/server/logs/` directory. Regular log rotation is recommended for long-term deployment.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Jupiter for their excellent swap aggregation
- Helius for reliable Solana RPC services
- The Solana ecosystem and community 
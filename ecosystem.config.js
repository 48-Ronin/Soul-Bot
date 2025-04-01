module.exports = {
  apps: [
    {
      name: 'soul-bot',
      script: 'web/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        WEB_PORT: 3001,
        WEB_HOST: '0.0.0.0'
      },
      env_production: {
        NODE_ENV: 'production',
        WEB_PORT: 3001,
        WEB_HOST: '0.0.0.0'
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      time: true
    },
    {
      name: 'soul-bot-web',
      script: 'web/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        WEB_PORT: 3001
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      merge_logs: true,
      time: true
    }
  ]
}; 
/**
 * PM2 Ecosystem Config
 *
 * Deploy:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save
 *   pm2 startup   ← follow the printed command to auto-start on reboot
 *
 * Useful commands:
 *   pm2 logs makemythread       — live logs
 *   pm2 monit                   — dashboard
 *   pm2 reload makemythread     — zero-downtime reload
 *   pm2 stop makemythread       — stop
 */

module.exports = {
  apps: [
    {
      name: 'makemythread',
      script: './server.js',

      // Cluster mode: one worker per CPU core for parallel request handling.
      // SQLite WAL mode allows concurrent reads across workers.
      instances: 'max',
      exec_mode: 'cluster',

      // Restart policy
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,

      // Memory guard — restart if a worker leaks past 512 MB
      max_memory_restart: '512M',

      // Log paths
      out_file:   './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // Watch (leave off in production — use pm2 reload for deploys)
      watch: false,

      environments: {
        development: {
          NODE_ENV: 'development',
          PORT: 3000,
          instances: 1,
          exec_mode: 'fork',
          watch: ['server.js', 'routes', 'services', 'middleware'],
          ignore_watch: ['node_modules', 'public', 'logs', 'backups', 'database'],
        },
        production: {
          NODE_ENV: 'production',
          PORT: 3000,
        }
      }
    }
  ]
};

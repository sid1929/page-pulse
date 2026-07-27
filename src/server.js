'use strict';

const { server } = require('./app');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  logger.info('page-pulse listening', { port: PORT });
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});

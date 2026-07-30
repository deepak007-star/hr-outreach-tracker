'use strict';
const logger = require('../lib/logger');

module.exports = function requestLogger(req, res, next) {
  if (req.path === '/health' || req.originalUrl.endsWith('/health')) return next();

  const start = Date.now();
  res.on('finish', () => {
    const ms     = Date.now() - start;
    const status = res.statusCode;
    const level  = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    logger[level](`${req.method} ${req.originalUrl} ${status}`, {
      service: 'http',
      method:  req.method,
      path:    req.originalUrl,
      status,
      ms,
      userId: req.user?.userId || null,
      ip: req.ip,
    });
  });
  next();
};

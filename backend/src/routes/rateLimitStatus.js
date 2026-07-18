const express     = require('express');
const { getStatus } = require('../middleware/rateLimiter');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/status', requireAuth, (req, res) => {
  res.json(getStatus(req.user.userId));
});

module.exports = router;

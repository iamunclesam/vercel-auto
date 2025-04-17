const router = require('express').Router();
const usageController = require('../controllers/usageController');

router.get('/usage', usageController.syncUsage);

module.exports = router;


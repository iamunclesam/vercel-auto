const router = require('express').Router();
const deployController = require('../controllers/deployController');

router.post('/deploy', deployController.deployTheme);

module.exports = router;


const router = require('express').Router();
const domainController = require('../controllers/domainController');

router.post('/link', domainController.purchaseAndLinkDomain);

module.exports = router;


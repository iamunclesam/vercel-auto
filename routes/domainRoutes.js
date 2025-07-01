const express = require('express');
const router = express.Router();
const { 
  purchaseAndLinkDomain, 
  createCloudflareSubdomain, 
  testCloudflareCredentials,
  listCloudflareZones,
  checkDomainAvailability 
} = require('../controllers/domainController');

router.post('/purchase', purchaseAndLinkDomain);
router.post('/subdomain', createCloudflareSubdomain);
router.get('/test-cloudflare', testCloudflareCredentials);
router.get('/cloudflare-zones', listCloudflareZones);
router.post('/check-availability', checkDomainAvailability);

module.exports = router;


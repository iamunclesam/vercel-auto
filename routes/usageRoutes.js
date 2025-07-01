const express = require('express');
const router = express.Router();
const { 
  getProjectUsage, 
  getAllProjectsUsage, 
  getUsageByStoreId 
} = require('../controllers/usageController');

router.get('/project/:projectId', getProjectUsage);
router.get('/all', getAllProjectsUsage);
router.get('/store/:storeId', getUsageByStoreId);

module.exports = router;


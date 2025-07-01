const express = require('express');
const router = express.Router();
const { 
  setResourceAllocation, 
  getResourceUsage, 
  getResourcePlans, 
  checkResourceLimits 
} = require('../controllers/resourceController');

// Set resource allocation for a project
router.post('/allocation/:projectId', setResourceAllocation);

// Get resource usage for a specific project
router.get('/usage/:projectId', getResourceUsage);

// Get all available resource plans
router.get('/plans', getResourcePlans);

// Check resource limits and get alerts
router.post('/check-limits/:projectId', checkResourceLimits);

module.exports = router; 
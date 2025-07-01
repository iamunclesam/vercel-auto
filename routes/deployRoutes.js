const express = require('express');
const router = express.Router();
const { deployTheme, getAllProjects, getProjectsByStoreId } = require('../controllers/deployController');
const { bulkDeployUpdate } = require('../controllers/bulkDeployUpdate');

router.post('/deploy', deployTheme);
router.get('/projects', getAllProjects);
router.get('/projects/:storeId', getProjectsByStoreId);
router.post('/bulk-update', bulkDeployUpdate);

module.exports = router;
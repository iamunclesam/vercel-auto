const router = require('express').Router();
const deployController = require('../controllers/deployController');
const { addClient, removeClient } = require('../utils/progressTracker');
// Store connected clients
const clients = new Set();

// Deployment endpoint
router.post('/deploy', deployController.deployTheme);

router.get('/project/:storeId', deployController.getProjectsByStoreId);

router.get('/progress', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    // Send initial connection message
    res.write('event: connected\ndata: \n\n');

    // Add client to tracking
    addClient(res);

    // Remove client when connection closes
    req.on('close', () => {
        removeClient(res);
        res.end();
    });
});

module.exports = router;
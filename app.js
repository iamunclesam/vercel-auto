const express = require('express');
const app = express();

// Import routes
const deployRoutes = require('./routes/deployRoutes');
const domainRoutes = require('./routes/domainRoutes');
const usageRoutes = require('./routes/usageRoutes');

// Middleware to parse JSON
app.use(express.json());

// Use the imported routes
app.use('/deploy', deployRoutes);
app.use('/domain', domainRoutes);
app.use('/usage', usageRoutes);

// Basic route
app.get('/', (req, res) => {
    res.send('Hello, Vercel!');
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
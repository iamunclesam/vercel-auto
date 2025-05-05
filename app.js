const express = require('express');
const dotenv = require('dotenv').config();
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose'); // Add Mongoose
const http = require('http');
const deployRoutes = require('./routes/deployRoutes');
const domainRoutes = require('./routes/domainRoutes');
const usageRoutes = require('./routes/usageRoutes');
const connectDB = require('./config/db')

// Starting app
const app = express();

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Middlewares - ORDER MATTERS!
// 1. First add body parsers
app.use(express.json()); // for parsing application/json
app.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
app.use(bodyParser.json()); // body-parser (can be removed as express.json() is preferred now)

// 2. Then add CORS
app.use(cors({
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
}));

// 3. Then add routes
app.use('/api/deploy', deployRoutes);
app.use('/api/domain', domainRoutes);
app.use('/api/usage', usageRoutes);

// Other settings
app.set('trust proxy', false);

// Test route
app.get('/', (req, res) => {
    res.status(200).json('Welcome to Vercel Theme Deployer');
});

const PORT = process.env.PORT || 5050;

// Connect to the database before listening
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log('Listening for requests on', PORT);
  });
});

module.exports = app;
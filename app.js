const express = require('express');
const dotenv = require('dotenv').config();
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const http = require('http');
const deployRoutes = require('./routes/deployRoutes');
const domainRoutes = require('./routes/domainRoutes');
const usageRoutes = require('./routes/usageRoutes');
const resourceRoutes = require('./routes/resourceRoutes');

const app = express();

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(cors({
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
}));

app.use('/api/deploy', deployRoutes);
app.use('/api/domain', domainRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/resources', resourceRoutes);

app.set('trust proxy', false);

app.get('/', (req, res) => {
    res.status(200).json('Welcome to Vercel Theme Deployer');
});

const PORT = process.env.PORT || 5050;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log('Listening for requests on', PORT);
  });
});

module.exports = app;
const express = require('express');
const dotenv = require('dotenv').config();
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const deployRoutes = require('./routes/deployRoutes');
const domainRoutes = require('./routes/domainRoutes');
const usageRoutes = require('./routes/usageRoutes');


//starting app
const app = express();

//middlewares
app.use(cors({
  origin: "*", 
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true  
}));

app.use('/api/deploy', deployRoutes);
app.use('/api/domain', domainRoutes);
app.use('/api/usage', usageRoutes);

app.use(express.json());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', false);


app.get('/', (req, res) => {
  res.status(200).json('Welcome to Vercel Theme Deployer');
});

const PORT = process.env.PORT || 5050;

app.listen(PORT, () => {
  console.log('Listening for requests on', PORT);
});

module.exports = app;
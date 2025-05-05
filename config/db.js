const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.DBURI,
      {
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 30000,
        socketTimeoutMS: 30000,
      }
    );
    console.log("Connected Database");
  } catch (err) {
    console.log("Connection Failed:", err.message);
  }
};

mongoose.connection.on('connected', () => {
  console.log('Mongoose connected to db');
});

mongoose.connection.on('error', (err) => {
  console.log('Mongoose connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose connection is disconnected');
});

process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('Mongoose connection is disconnected due to app termination');
  process.exit(0);
});

module.exports = connectDB;
const mongoose = require('mongoose');

const themeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: String,
  githubRepoUrl: {
    type: String,
    required: true
  },
  version: {
    type: String,
    default: '1.0.0'
  },
  category: String,
  tags: [String],
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Theme', themeSchema);

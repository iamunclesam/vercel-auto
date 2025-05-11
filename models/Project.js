const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  theme: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Theme',
    required: true
  },
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  domain: { type: String },
  vercelProjectId: {
    type: String,
    required: true
  },
  vercelUrl: {
    type: String,
    required: true
  },
  deploymentId: { type: String },
  projectName: {
    type: String,
    required: true
  },
  usage: {
    bandwidth: Number,
    requests: Number,
    updatedAt: Date,
  },
  accessToken: {
    type: String,
    required: true
  },
  status: {
    type: String,
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Project', projectSchema);

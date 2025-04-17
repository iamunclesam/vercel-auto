const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  theme: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Theme', 
    required: true },
  userId: { type: String, required: true },
  domain: { type: String },
  vercelProjectId: { 
    type: String, 
    required: true },
  vercelUrl: { 
    type: String, 
    required: true },
  deploymentId: { type: String },
  usage: {
    bandwidth: Number,
    requests: Number,
    updatedAt: Date,
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Project', projectSchema);

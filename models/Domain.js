const mongoose = require('mongoose');

const domainSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true },
  project: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Project', 
    required: true },
  provider: { 
    type: String, 
    enum: ['vercel'],
    default: 'vercel', 
    required: true },
  purchaseStatus: { 
    type: String, 
    enum: ['pending', 'success', 'failed'], 
    default: 'pending' },
  connected: { 
    type: Boolean, 
    default: false },
  purchasedAt: Date
});

module.exports = mongoose.model('Domain', domainSchema);

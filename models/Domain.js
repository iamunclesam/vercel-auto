const mongoose = require('mongoose');

const domainSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true
  },
  vercelProjectId: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'error'],
    default: 'pending'
  },
  purchased: {
    type: Boolean,
    default: false
  },
  purchaseDate: Date,
  error: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Domain', domainSchema);

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
  subdomain: { type: String },
  subdomainCreated: { type: Boolean, default: false },
  subdomainError: { type: String },
  domainPurchased: { type: Boolean, default: false },
  domainPurchaseDate: { type: Date },
  domainPurchaseError: { type: String },
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
  resourceAllocation: {
    plan: {
      type: String,
      enum: ['free', 'pro', 'enterprise', 'custom'],
      default: 'free'
    },
    limits: {
      bandwidth: { type: Number, default: 100 },
      requests: { type: Number, default: 100000 },
      functionExecution: { type: Number, default: 100000 },
      storage: { type: Number, default: 1 },
      domains: { type: Number, default: 1 },
      teamMembers: { type: Number, default: 1 },
      concurrentBuilds: { type: Number, default: 1 },
      edgeFunctions: { type: Number, default: 0 },
      serverlessFunctions: { type: Number, default: 100000 }
    },
    usage: {
      bandwidth: { type: Number, default: 0 },
      requests: { type: Number, default: 0 },
      functionExecution: { type: Number, default: 0 },
      storage: { type: Number, default: 0 },
      domains: { type: Number, default: 0 },
      teamMembers: { type: Number, default: 0 },
      concurrentBuilds: { type: Number, default: 0 },
      edgeFunctions: { type: Number, default: 0 },
      serverlessFunctions: { type: Number, default: 0 },
      lastUpdated: { type: Date, default: Date.now }
    },
    alerts: {
      enabled: { type: Boolean, default: true },
      threshold: { type: Number, default: 80 },
      emailNotifications: { type: Boolean, default: false },
      webhookUrl: { type: String }
    }
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

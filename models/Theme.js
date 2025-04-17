const mongoose = require('mongoose');

const themeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  repoUrl: { type: String, required: true },
  description: String,
  type: { type: String, enum: ['ecommerce', 'portfolio', 'blog', 'custom'], required: true },
  defaultSubdomain: { type: String },
})
module.exports = mongoose.model('Theme', themeSchema);

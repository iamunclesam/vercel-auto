const dotenv = require('dotenv').config()

module.exports = {
  port: process.env.PORT || 5050,
  mongoUri: process.env.MONGO_URI,
  vercelToken: process.env.VERCEL_API_TOKEN,
  githubToken: process.env.GITHUB_TOKEN,
  accessTokenSecret: process.env.ACCESS_TOKEN_SECRET,
  cloudflare: {
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    zoneId: process.env.CLOUDFLARE_ZONE_ID,
    email: process.env.CLOUDFLARE_EMAIL
  },
  parentDomain: process.env.PARENT_DOMAIN || 'zenithstudio.ng'
};
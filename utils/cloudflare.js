const axios = require('axios');

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const CLOUDFLARE_EMAIL = process.env.CLOUDFLARE_EMAIL;
const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

console.log('[Cloudflare] Configuration:', {
  hasToken: !!CLOUDFLARE_API_TOKEN,
  tokenLength: CLOUDFLARE_API_TOKEN ? CLOUDFLARE_API_TOKEN.length : 0,
  hasZoneId: !!CLOUDFLARE_ZONE_ID,
  zoneId: CLOUDFLARE_ZONE_ID ? `${CLOUDFLARE_ZONE_ID.substring(0, 8)}...` : 'not set',
  hasEmail: !!CLOUDFLARE_EMAIL
});

if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID) {
  console.warn('[Cloudflare] API token or zone ID not set in environment variables.');
}

function getAuthHeaders() {
  if (CLOUDFLARE_API_TOKEN && CLOUDFLARE_API_TOKEN.length > 50) {
    return {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json'
    };
  } else if (CLOUDFLARE_API_TOKEN && CLOUDFLARE_EMAIL) {
    return {
      'X-Auth-Key': CLOUDFLARE_API_TOKEN,
      'X-Auth-Email': CLOUDFLARE_EMAIL,
      'Content-Type': 'application/json'
    };
  } else {
    throw new Error('Invalid Cloudflare credentials configuration');
  }
}

async function createSubdomainCNAME(subdomain, parentDomain, target = 'cname.vercel-dns.com') {
  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID) {
    throw new Error('Cloudflare API token or zone ID not set');
  }

  const name = `${subdomain}.${parentDomain}`;
  console.log(`[Cloudflare] Creating CNAME record for: ${name} -> ${target}`);

  try {
    const authHeaders = getAuthHeaders();
    
    const existing = await axios.get(
      `${CLOUDFLARE_API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/dns_records`,
      {
        headers: authHeaders,
        params: { type: 'CNAME', name }
      }
    );
    
    if (existing.data.result && existing.data.result.length > 0) {
      console.log(`[Cloudflare] CNAME already exists for: ${name}`);
      return { success: true, message: 'CNAME already exists', record: existing.data.result[0] };
    }

    console.log(`[Cloudflare] Creating new CNAME record...`);
    const response = await axios.post(
      `${CLOUDFLARE_API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/dns_records`,
      {
        type: 'CNAME',
        name,
        content: target,
        ttl: 3600,
        proxied: false
      },
      {
        headers: authHeaders
      }
    );
    
    console.log(`[Cloudflare] CNAME created successfully: ${name}`);
    return { success: true, record: response.data.result };
    
  } catch (error) {
    console.error('[Cloudflare] API Error Details:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });
    
    if (error.response?.status === 400) {
      throw new Error(`Cloudflare API Error (400): ${JSON.stringify(error.response.data)}`);
    }
    
    throw new Error(`Cloudflare API Error: ${error.message}`);
  }
}

module.exports = { createSubdomainCNAME }; 
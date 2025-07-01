const axios = require('axios');
const validator = require('validator');
const Project = require('../models/Project');
const { createSubdomainCNAME } = require('../utils/cloudflare');

const VERCEL_API_BASE = 'https://api.vercel.com';
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;
const parentDomain= process.env.PARENT_DOMAIN;

exports.purchaseAndLinkDomain = async (req, res) => {
  try {
    const { vercelProjectId, domain, projectId } = req.body;

    if (!vercelProjectId || !domain || !projectId) {
      return res.status(400).json({
        error: 'vercelProjectId, domain, and projectId are required'
      });
    }

    if (!validator.isFQDN(domain)) {
      return res.status(400).json({
        error: 'Invalid domain format',
        suggestion: 'Please provide a fully qualified domain name (e.g., example.com)'
      });
    }

    const domainStatus = await checkDomainAvailability(domain);
    console.log(`[Domain Purchase] Status for ${domain}:`, domainStatus);

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    let purchaseResult = null;
    let linkResult = null;

    if (domainStatus.available && domainStatus.purchasable) {
      console.log(`[Domain Purchase] Attempting to purchase ${domain}...`);
      try {
        purchaseResult = await purchaseDomain(domain);
        console.log(`[Domain Purchase] Purchase successful for ${domain}`);
      } catch (purchaseError) {
        console.error(`[Domain Purchase] Failed to purchase ${domain}:`, purchaseError.message);
        return res.status(400).json({
          error: 'Domain purchase failed',
          details: purchaseError.message,
          suggestion: 'The domain might be available but not purchasable through Vercel. Try purchasing it through a domain registrar first.'
        });
      }
    } else if (!domainStatus.available) {
      return res.status(400).json({
        error: 'Domain is not available',
        details: 'The domain is already registered or not available for purchase',
        domainStatus
      });
    }

    console.log(`[Domain Purchase] Linking ${domain} to project ${vercelProjectId}...`);
    try {
      linkResult = await linkDomainToVercel(vercelProjectId, domain);
      console.log(`[Domain Purchase] Link successful for ${domain}`);
    } catch (linkError) {
      console.error(`[Domain Purchase] Failed to link ${domain}:`, linkError.message);
      
      if (purchaseResult) {
        return res.status(500).json({
          error: 'Domain purchased but linking failed',
          details: linkError.message,
          purchaseResult,
          suggestion: 'The domain was purchased successfully but could not be linked to the project. Please try linking manually.'
        });
      }
      
      return res.status(400).json({
        error: 'Domain linking failed',
        details: linkError.message
      });
    }

    project.domain = domain;
    if (purchaseResult) {
      project.domainPurchased = true;
      project.domainPurchaseDate = new Date();
    }
    await project.save();

    return res.status(200).json({
      message: purchaseResult ? 'Domain purchased and linked successfully' : 'Domain linked successfully',
      domain,
      purchaseResult,
      linkResult,
      projectId
    });

  } catch (err) {
    console.error('Domain Purchase Error:', err?.response?.data || err.message);
    return res.status(500).json({
      error: 'Failed to process domain purchase/link request',
      details: err.message
    });
  }
};

exports.createCloudflareSubdomain = async (req, res) => {
  try {
    const { subdomain } = req.body;
    if (!subdomain) {
      return res.status(400).json({ error: 'subdomain is required' });
    }
    const result = await createSubdomainCNAME(subdomain, parentDomain);
    return res.status(200).json(result);
  } catch (err) {
    console.error('Cloudflare Subdomain Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

exports.testCloudflareCredentials = async (req, res) => {
  try {
    const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
    const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
    const CLOUDFLARE_EMAIL = process.env.CLOUDFLARE_EMAIL;
    
    if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID) {
      return res.status(400).json({ 
        error: 'Missing credentials',
        hasToken: !!CLOUDFLARE_API_TOKEN,
        hasZoneId: !!CLOUDFLARE_ZONE_ID
      });
    }

    let authHeaders;
    if (CLOUDFLARE_API_TOKEN.length > 50) {
      authHeaders = {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json'
      };
    } else if (CLOUDFLARE_EMAIL) {
      authHeaders = {
        'X-Auth-Key': CLOUDFLARE_API_TOKEN,
        'X-Auth-Email': CLOUDFLARE_EMAIL,
        'Content-Type': 'application/json'
      };
    } else {
      return res.status(400).json({
        error: 'Global API Key requires CLOUDFLARE_EMAIL environment variable'
      });
    }

    const response = await axios.get(
      `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}`,
      { headers: authHeaders }
    );

    return res.status(200).json({
      success: true,
      message: 'Cloudflare credentials are valid',
      zone: response.data.result
    });

  } catch (err) {
    console.error('Cloudflare Test Error:', err.response?.data || err.message);
    return res.status(500).json({ 
      error: 'Cloudflare credentials test failed',
      details: err.response?.data || err.message
    });
  }
};

exports.listCloudflareZones = async (req, res) => {
  try {
    const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
    const CLOUDFLARE_EMAIL = process.env.CLOUDFLARE_EMAIL;
    
    if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_EMAIL) {
      return res.status(400).json({ 
        error: 'Missing credentials',
        hasToken: !!CLOUDFLARE_API_TOKEN,
        hasEmail: !!CLOUDFLARE_EMAIL
      });
    }

    const authHeaders = {
      'X-Auth-Key': CLOUDFLARE_API_TOKEN,
      'X-Auth-Email': CLOUDFLARE_EMAIL,
      'Content-Type': 'application/json'
    };

    const response = await axios.get(
      'https://api.cloudflare.com/client/v4/zones',
      { headers: authHeaders }
    );

    return res.status(200).json({
      success: true,
      message: 'Cloudflare zones retrieved successfully',
      zones: response.data.result.map(zone => ({
        id: zone.id,
        name: zone.name,
        status: zone.status
      }))
    });

  } catch (err) {
    console.error('Cloudflare Zones Error:', err.response?.data || err.message);
    return res.status(500).json({ 
      error: 'Failed to retrieve Cloudflare zones',
      details: err.response?.data || err.message
    });
  }
};

exports.checkDomainAvailability = async (req, res) => {
  try {
    const { domain } = req.body;
    
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required in request body' });
    }

    if (!validator.isFQDN(domain)) {
      return res.status(400).json({
        error: 'Invalid domain format',
        suggestion: 'Please provide a fully qualified domain name (e.g., example.com)'
      });
    }

    const domainStatus = await checkDomainAvailability(domain);
    
    const suggestions = await generateDomainSuggestions(domain);
    
    return res.status(200).json({
      success: true,
      domain,
      status: domainStatus,
      suggestions: suggestions.slice(0, 5)
    });

  } catch (err) {
    console.error('Domain Availability Check Error:', err?.response?.data || err.message);
    return res.status(500).json({
      error: 'Failed to check domain availability',
      details: err?.response?.data || err.message
    });
  }
};

async function generateDomainSuggestions(originalDomain) {
  const domainParts = originalDomain.split('.');
  const name = domainParts[0];
  const extension = domainParts.slice(1).join('.');
  
  const variations = [
    `${name}app.${extension}`,
    `${name}online.${extension}`,
    `${name}web.${extension}`,
    `${name}site.${extension}`,
    `${name}pro.${extension}`,
    `${name}plus.${extension}`,
    `${name}now.${extension}`,
    `${name}live.${extension}`
  ];

  const availabilityChecks = variations.map(async (variation) => {
    try {
      const status = await checkDomainAvailability(variation);
      return {
        domain: variation,
        ...status
      };
    } catch (error) {
      console.warn(`Could not check ${variation}:`, error.message);
      return {
        domain: variation,
        error: error.message
      };
    }
  });

  const results = await Promise.all(availabilityChecks);
  
  const suggestions = results.filter(result => result.available);
  
  return suggestions;
}

async function checkDomainAvailability(domain) {
  const response = await axios.get(
    `${VERCEL_API_BASE}/v4/domains/status?name=${domain}`,
    {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }
    }
  );
  
  console.log(`[Vercel API] Domain ${domain} response:`, JSON.stringify(response.data, null, 2));
  
  return response.data;
}

async function linkDomainToVercel(projectId, domain) {
  const response = await axios.post(
    `${VERCEL_API_BASE}/v9/projects/${projectId}/domains`,
    { name: domain },
    {
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data;
}

async function purchaseDomain(domain) {
  try {
    const response = await axios.post(
      `${VERCEL_API_BASE}/v4/domains/buy`,
      {
        name: domain,
        expectedPrice: 0,
        currency: 'USD'
      },
      {
        headers: {
          Authorization: `Bearer ${VERCEL_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`[Domain Purchase] Vercel response for ${domain}:`, JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error(`[Domain Purchase] Vercel API error for ${domain}:`, error.response?.data || error.message);
    throw new Error(error.response?.data?.error?.message || error.message);
  }
}
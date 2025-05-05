const axios = require('axios');
const validator = require('validator');
const Project = require('../models/Project');

const VERCEL_API_BASE = 'https://api.vercel.com';
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;

exports.purchaseAndLinkDomain = async (req, res) => {
  try {
    const { vercelProjectId, domain, projectId } = req.body;

    // Input validation remains the same
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

    // Check domain status
    const domainStatus = await checkDomainAvailability(domain);

    if (domainStatus.available && domainStatus.purchasable) {
      return res.status(400).json({
        error: 'Domain is available for purchase but not owned',
        suggestion: 'Purchase the domain first or use a domain you already own',
        domainStatus
      });
    }

    // Verify project exists
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if domain is already linked (as string)
    if (project.domain === domain) {
      return res.status(409).json({
        error: 'Domain already linked to this project',
        domain: project.domain
      });
    }

    // Link domain to Vercel project
    const vercelResponse = await linkDomainToVercel(vercelProjectId, domain);

    // Update project in database with just the domain string
    project.domain = domain; // Store only the string
    await project.save();

    return res.status(200).json({
      message: 'Domain linked successfully',
      domain: domain, // Return just the string
      vercelResponse
    });

  } catch (err) {
    console.error('Domain Error:', err?.response?.data || err.message);

    // Handle specific Vercel errors
    const vercelError = err?.response?.data?.error;
    if (vercelError) {
      if (vercelError.code === 'domain_taken') {
        return res.status(409).json({
          error: 'Domain is already in use by another Vercel project',
          details: vercelError.message
        });
      }
      return res.status(400).json({
        error: 'Vercel API error',
        details: vercelError
      });
    }

    return res.status(500).json({
      error: 'Failed to process domain request',
      details: err.message
    });
  }
};
// Helper function to check domain availability
async function checkDomainAvailability(domain) {
  const response = await axios.get(
    `${VERCEL_API_BASE}/v4/domains/status?name=${domain}`,
    {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }
    }
  );
  return response.data;
}

// Helper function to link domain to Vercel
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
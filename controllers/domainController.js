const axios = require('axios');
const Project = require('../models/Project');
const validator = require('validator');
const VERCEL_API_BASE = 'https://api.vercel.com';
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;

exports.purchaseAndLinkDomain = async (req, res) => {
  const { projectId, domain } = req.body;

  if (!projectId || !domain) {
    return res.status(400).json({ error: 'projectId and domain are required' });
  }

  if (!validator.isFQDN(domain)) {
    return res.status(400).json({ error: 'Invalid domain format' });
  }

  try {
    const project = await Project.findById(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (project.domain && project.domain.name === domain) {
      return res.status(409).json({ error: 'Domain already linked to this project' });
    }

    const response = await axios.post(`${VERCEL_API_BASE}/v9/projects/${project.vercelProjectId}/domains`, {
      name: domain,
    }, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
    });

    const domainStatus = response.data;

    project.domain = {
      name: domain,
      status: domainStatus?.verification?.status || 'pending',
    };

    await project.save();

    res.status(200).json({
      message: 'Domain linked successfully',
      domain: project.domain,
    });

  } catch (err) {
    console.error('Domain Error:', err?.response?.data || err.message);

    const vercelErr = err?.response?.data;
    if (vercelErr && vercelErr.error && vercelErr.error.code === 'domain_taken') {
      return res.status(409).json({ error: 'Domain is already in use by another Vercel project' });
    }

    return res.status(500).json({ error: 'Domain linking failed' });
  }
};

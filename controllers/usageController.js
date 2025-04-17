const axios = require('axios');
const Project = require('../models/Project');

const VERCEL_API_BASE = 'https://api.vercel.com';
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;

exports.syncUsage = async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await Project.findById(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const lastUpdated = project.usage?.updatedAt || new Date(0);
    const diffMins = (Date.now() - new Date(lastUpdated).getTime()) / 1000 / 60;
    if (diffMins < 10) {
      return res.status(200).json({ message: 'Usage recently synced', usage: project.usage });
    }

    const usageRes = await axios.get(`${VERCEL_API_BASE}/v6/usage/web-analytics/${project.vercelProjectId}?period=30d`, {
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
      },
    });

    const usageData = usageRes.data;

    const newUsage = {
      bandwidth: usageData.totalDataOut, 
      requests: usageData.totalRequests,
      updatedAt: new Date()
    };

    if (!project.usageHistory) project.usageHistory = [];
    project.usageHistory.push(newUsage);

    project.usage = newUsage;
    await project.save();

    res.status(200).json({ message: 'Usage synced', usage: project.usage });

  } catch (err) {
    console.error('Usage Sync Error:', err?.response?.data || err.message);
    res.status(500).json({ error: 'Usage sync failed' });
  }
};

const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const Project = require('../models/Project');

const VERCEL_API_BASE = 'https://api.vercel.com';
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;

exports.deployTheme = async (req, res) => {
  const { userId, githubRepoUrl, projectName, themeName } = req.body;

  // 1. Validate request
  if (!userId || !githubRepoUrl || !projectName || !themeName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const existing = await Project.findOne({ userId, projectName });
    if (existing) {
      return res.status(409).json({ error: 'Project name already exists for this user' });
    }

    //  Clone GitHub Repo
    const localPath = path.join(__dirname, `../tmp/${Date.now()}-${projectName}`);
    await simpleGit().clone(githubRepoUrl, localPath);

    //Create Vercel Project
    const vercelProjectRes = await axios.post(`${VERCEL_API_BASE}/v9/projects`, {
      name: projectName,
    }, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }
    });

    const vercelProjectId = vercelProjectRes.data.id;

    const deployResponse = await axios.post(`${VERCEL_API_BASE}/v13/deployments`, {
      name: projectName,
      gitSource: {
        type: 'github',
        repo: githubRepoUrl.split('github.com/')[1],
      },
      project: vercelProjectId
    }, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }
    });

    const deploymentUrl = deployResponse.data.url;

    const savedProject = await Project.create({
      userId,
      themeName,
      githubRepoUrl,
      projectName,
      vercelProjectId,
      deploymentUrl,
      createdAt: new Date(),
    });

    await fs.remove(localPath);

    return res.status(201).json({ message: 'Deployed successfully', project: savedProject });

  } catch (err) {
    console.error('Deployment Error:', err?.response?.data || err.message);

    // Optional: Cleanup tmp dir on failure
    if (localPath && fs.existsSync(localPath)) {
      await fs.remove(localPath);
    }

    return res.status(500).json({ error: 'Deployment failed.' });
  }
};

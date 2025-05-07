// At the top of your file, add the router import
const { broadcastProgress } = require('../utils/progressTracker');

const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const { globby } = require('globby');
const Project = require('../models/Project');
const { purchaseAndLinkDomain } = require('./domainController');

const VERCEL_API_BASE = 'https://api.vercel.com';
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;
const jwt = require('jsonwebtoken');

// Helper function with detailed logging
const pollDeploymentStatus = async (deploymentId, startTime) => {
  const maxTries = 20;
  const interval = 5000; // 5 seconds
  let tries = 0;

  console.log(`⌛ Starting deployment monitoring for ID: ${deploymentId}`);

  while (tries < maxTries) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    console.log(`⏱️  Elapsed time: ${elapsed}s | Polling attempt ${tries + 1}/${maxTries}`);

    try {
      const statusRes = await axios.get(
        `${VERCEL_API_BASE}/v13/deployments/${deploymentId}`,
        { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
      );

      const status = statusRes.data;
      console.log(`🔄 Current status: ${status.readyState}`);

      if (status.readyState === 'READY') {
        const totalTime = Math.floor((Date.now() - startTime) / 1000);
        console.log(`✅ Deployment completed successfully in ${totalTime} seconds`);
        return status;
      }

      if (['ERROR', 'CANCELED'].includes(status.readyState)) {
        throw new Error(`Deployment failed with status: ${status.readyState}`);
      }

    } catch (err) {
      console.error(`⚠️ Polling error: ${err.message}`);
      throw err;
    }

    tries++;
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`Deployment did not complete within ${maxTries * interval / 1000} seconds`);
};



exports.deployTheme = async (req, res) => {
  const startTime = Date.now();
  console.log('🚀 Starting deployment process at', new Date(startTime).toISOString());

  broadcastProgress('init', 'Starting deployment process', 10);

  const {
    storeId,
    githubRepoUrl,
    domain,
    projectName,
    theme,
    branch = 'main',
    installCommand = 'npm install --legacy-peer-deps --force',
    buildCommand = 'npm run build',
    outputDirectory = '.next',
    envVars = {}
  } = req.body;

  // Validate required fields
  if (!storeId || !githubRepoUrl || !projectName || !theme || !domain) {
    console.error('❌ Missing required fields');
    broadcastProgress('error', 'Missing required fields', 100);
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate GitHub credentials
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_USERNAME) {
    console.error('❌ GitHub credentials missing');
    broadcastProgress('error', 'GitHub credentials not configured', 100);
    return res.status(400).json({ error: 'GitHub credentials not configured' });
  }

  const localPath = path.join(__dirname, `../tmp/${Date.now()}-${projectName}`);
  console.log(`📂 Using temporary directory: ${localPath}`);

  try {
    // ====================== 1. CLONE REPOSITORY ======================
    broadcastProgress('cloning', 'Cloning repository...', 20);
    console.log(`⏳ Cloning repository ${githubRepoUrl} (branch: ${branch})...`);

    // Inject PAT into GitHub URL
    const repoUrlWithToken = githubRepoUrl.replace(
      'https://github.com/',
      `https://${process.env.GITHUB_USERNAME}:${process.env.GITHUB_TOKEN}@github.com/`
    );

    await simpleGit().clone(repoUrlWithToken, localPath, ['-b', branch]);
    console.log('✅ Repository cloned successfully');

    // ====================== 2. GENERATE ACCESS TOKEN ======================
    const accessToken = jwt.sign(
      { storeId },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: '30d' }
    );

    // ====================== 3. SETUP ENVIRONMENT ======================
    broadcastProgress('env-setup', 'Setting up environment...', 30);
    console.log('⚙️ Setting up environment variables');

    const updatedEnvVars = {
      ...envVars,
      STORE_TOKEN: accessToken,
      NEXT_PUBLIC_BASE_URL: `https://${domain}`
    };

    // Write to multiple env files
    const envContent = Object.entries(updatedEnvVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    await Promise.all([
      fs.writeFile(path.join(localPath, '.env'), envContent),
      fs.writeFile(path.join(localPath, '.env.production'), envContent),
      fs.writeFile(path.join(localPath, '.env.local'), envContent)
    ]);

    // ====================== 4. PREPARE FILES ======================
    broadcastProgress('file-prep', 'Preparing files...', 40);
    console.log('📦 Preparing files for deployment...');

    const filePaths = await globby(['**/*'], {
      cwd: localPath,
      gitignore: true,
      dot: true,
      onlyFiles: true,
    });

    const files = await Promise.all(
      filePaths.map(async (file) => ({
        file,
        data: (await fs.readFile(path.join(localPath, file))).toString('base64'),
        encoding: 'base64'
      }))
    );

    // ====================== 5. CREATE VERCEL DEPLOYMENT ======================
    broadcastProgress('vercel-deploy', 'Creating Vercel deployment...', 50);
    console.log('🚀 Creating Vercel deployment...');

    const deployRes = await axios.post(
      `${VERCEL_API_BASE}/v13/deployments`,
      {
        name: projectName,
        files,
        projectSettings: {
          framework: 'nextjs',
          installCommand,
          buildCommand,
          outputDirectory,
        },
        target: 'production',
      },
      {
        headers: {
          Authorization: `Bearer ${VERCEL_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000
      }
    );

    const { id: deploymentId, url: deploymentUrl, projectId: vercelProjectId } = deployRes.data;
    console.log(`🎯 Deployment created. ID: ${deploymentId}, URL: ${deploymentUrl}`);
    broadcastProgress('vercel-created', 'Vercel deployment created', 60);

    // ====================== 6. CONFIGURE ENV VARS ======================
    broadcastProgress('env-setup', 'Configuring Vercel environment...', 65);
    console.log('⚙️ Configuring environment variables in Vercel...');

    const setVercelEnvVars = async (attempt = 1) => {
      try {
        await axios.post(
          `${VERCEL_API_BASE}/v10/projects/${vercelProjectId}/env`,
          Object.entries(updatedEnvVars).map(([key, value]) => ({
            key,
            value,
            target: ['production', 'preview', 'development'],
            type: 'encrypted',
          })),
          {
            headers: {
              Authorization: `Bearer ${VERCEL_TOKEN}`,
              'Content-Type': 'application/json',
            },
          }
        );
        console.log('✅ Environment variables configured successfully');
      } catch (envErr) {
        if (attempt <= 3) {
          console.log(`⚠️ Retrying environment setup (attempt ${attempt})...`);
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          return setVercelEnvVars(attempt + 1);
        }
        throw envErr;
      }
    };

    await setVercelEnvVars();

    // ====================== 7. WAIT FOR DEPLOYMENT ======================
    broadcastProgress('vercel-polling', 'Waiting for deployment to complete...', 75);
    const deploymentStatus = await pollDeploymentStatus(deploymentId, startTime);
    broadcastProgress('vercel-ready', 'Deployment completed', 80);

    // ====================== 8. SAVE PROJECT ======================
    broadcastProgress('db-save', 'Saving project to database...', 85);
    console.log('💾 Saving project to database...');

    const createdProject = await Project.create({
      storeId,
      theme,
      githubRepoUrl,
      projectName,
      vercelProjectId,
      vercelUrl: deploymentUrl,
      domain,
      status: deploymentStatus.readyState,
      accessToken,
    });

    // ====================== 9. LINK DOMAIN ======================
    broadcastProgress('domain-link', 'Linking domain...', 95);
    console.log(`🌐 Attempting to link domain: ${domain}`);

    try {
      await purchaseAndLinkDomain({
        vercelProjectId,
        domain,
        projectId: createdProject._id
      });

      await Project.findByIdAndUpdate(createdProject._id, {
        domain,
        domainStatus: 'active'
      });

      console.log(`🔗 Domain linked successfully: ${domain}`);
      broadcastProgress('domain-success', 'Domain linked successfully', 98);
    } catch (domainErr) {
      console.error('⚠️ Domain linking failed:', domainErr.message);
      await Project.findByIdAndUpdate(createdProject._id, {
        domainError: domainErr.message
      });
      broadcastProgress('domain-failed', 'Domain linking failed', 98);
    }

    // ====================== 10. CLEANUP ======================
    broadcastProgress('cleanup', 'Cleaning up...', 99);
    await fs.remove(localPath);

    // ====================== 11. RESPONSE ======================
    const totalTime = Math.floor((Date.now() - startTime) / 1000);
    console.log(`🏁 Deployment completed in ${totalTime} seconds`);

    return res.status(201).json({
      success: true,
      projectId: createdProject._id,
      domain,
      url: `https://${domain}`,
      vercelUrl: deploymentUrl,
      accessToken,
      deploymentTime: totalTime
    });

  } catch (err) {
    console.error('💥 Deployment failed:', err.message);
    
    // Cleanup on failure
    try {
      if (await fs.pathExists(localPath)) {
        await fs.remove(localPath);
      }
    } catch (cleanupErr) {
      console.error('Cleanup failed:', cleanupErr.message);
    }

    return res.status(500).json({
      error: 'Deployment failed',
      details: err.response?.data?.error?.message || err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};

// Get all projects
exports.getAllProjects = async (req, res) => {
  try {
    console.log('📋 Fetching all projects...');
    const projects = await Project.find({});
    console.log(`✅ Retrieved ${projects.length} projects`);
    return res.status(200).json(projects);
  } catch (err) {
    console.error('❌ Error fetching projects:', err.message);
    return res.status(500).json({ error: 'Failed to fetch projects' });
  }
};

// Get projects by storeId
exports.getProjectsByStoreId = async (req, res) => {
  const { storeId } = req.params;

  if (!storeId) {
    console.error('❌ Missing storeId parameter');
    return res.status(400).json({ error: 'Missing storeId parameter' });
  }

  try {
    console.log(`📋 Fetching projects for storeId: ${storeId}`);
    const projects = await Project.find({ storeId });
    console.log(`✅ Retrieved ${projects.length} projects for storeId: ${storeId}`);
    return res.status(200).json(projects);
  } catch (err) {
    console.error(`❌ Error fetching projects for storeId ${storeId}:`, err.message);
    return res.status(500).json({ error: 'Failed to fetch projects' });
  }
};
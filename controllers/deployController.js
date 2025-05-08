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

  const githubToken = process.env.GITHUB_TOKEN

  if (!storeId || !githubRepoUrl || !projectName || !theme || !domain || !githubToken) {
    console.error('❌ Missing required fields (storeId, githubRepoUrl, githubToken, etc.)');
    broadcastProgress('error', 'Missing required fields', 100);
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const localPath = path.join(__dirname, `../tmp/${Date.now()}-${projectName}`);
  console.log(`📂 Using temporary directory: ${localPath}`);

  try {
    // ✅ Inject token into URL safely
    const secureRepoUrl = githubRepoUrl.replace(
      /^https:\/\//,
      `https://${githubToken}@`
    );

    // 1. Clone repository
    broadcastProgress('cloning', 'Cloning repository...', 20);
    console.log(`⏳ Cloning repository from ${githubRepoUrl} using branch ${branch}...`);
    await simpleGit().clone(secureRepoUrl, localPath, ['-b', branch]);
    console.log('✅ Repository cloned successfully');

    // 2. Generate access token
    const accessToken = jwt.sign({ storeId }, process.env.ACCESS_TOKEN_SECRET);

    // 3. Write env vars
    const updatedEnvVars = { ...envVars, STORE_TOKEN: accessToken };
    broadcastProgress('env-setup', 'Setting up environment...', 30);
    console.log('⚙️ Writing environment variables to .env files...');
    const envContent = Object.entries(updatedEnvVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    await Promise.all([
      fs.writeFile(path.join(localPath, '.env'), envContent),
      fs.writeFile(path.join(localPath, '.env.production'), envContent),
      fs.writeFile(path.join(localPath, '.env.local'), envContent)
    ]);

    // 4. Prepare files
    broadcastProgress('file-prep', 'Preparing files...', 40);
    console.log('📦 Reading files from repository...');
    const filePaths = await globby(['**/*'], {
      cwd: localPath,
      gitignore: true,
      dot: true,
      onlyFiles: true
    });

    if (filePaths.length === 0) throw new Error('No files found to deploy.');

    const files = await Promise.all(
      filePaths.map(async (file) => ({
        file,
        data: (await fs.readFile(path.join(localPath, file))).toString('base64'),
        encoding: 'base64'
      }))
    );

    // 🔁 NEW: 5. Create Vercel project (before any deployment)
    broadcastProgress('vercel-project', 'Creating Vercel project...', 45);
    console.log('📁 Creating Vercel project...');

    const createProjectRes = await axios.post(
      `${VERCEL_API_BASE}/v9/projects`,
      {
        name: projectName,
        framework: null,
        buildCommand,
        installCommand,
        outputDirectory,
        rootDirectory: null,
      },
      {
        headers: {
          Authorization: `Bearer ${VERCEL_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const { id: vercelProjectId } = createProjectRes.data;
    console.log(`✅ Vercel project created with ID: ${vercelProjectId}`);

    // 🔁 NEW: 6. Set env vars BEFORE deployment
    broadcastProgress('env-vercel', 'Configuring environment in Vercel...', 50);
    console.log('⚙️ Sending environment variables to Vercel...');

    const vercelEnvPayload = Object.entries(updatedEnvVars).map(([key, value]) => ({
      key,
      value,
      target: ['production', 'preview', 'development'],
      type: 'encrypted',
    }));

    await axios.post(
      `${VERCEL_API_BASE}/v10/projects/${vercelProjectId}/env`,
      vercelEnvPayload,
      {
        headers: {
          Authorization: `Bearer ${VERCEL_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Vercel environment variables configured');

    // 🔁 NEW: 7. Now deploy the code
    broadcastProgress('vercel-deploy', 'Creating Vercel deployment...', 60);
    console.log('🚀 Sending files to Vercel...');

    const deployRes = await axios.post(
      `${VERCEL_API_BASE}/v13/deployments`,
      {
        name: projectName,
        // projectId: vercelProjectId, // this links it to the created project
        files,
        projectSettings: {
          framework: null,
          devCommand: installCommand ? 'npm run dev' : null,
          installCommand,
          buildCommand,
          outputDirectory,
          rootDirectory: null,
        },
        target: 'production',
      },
      {
        headers: {
          Authorization: `Bearer ${VERCEL_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const { id: deploymentId, url: deploymentUrl } = deployRes.data;
    broadcastProgress('vercel-created', 'Vercel deployment created', 70);

    // 🧹 REMOVED: The extra redeploy step you had before (you can now delete it)


    // 8. Poll deployment
    broadcastProgress('vercel-polling', 'Polling for deployment status...', 75);
    const deploymentStatus = await pollDeploymentStatus(deploymentId, startTime);

    // 9. Save project
    broadcastProgress('db-save', 'Saving project to database...', 85);
    const createdProject = await Project.create({
      storeId,
      theme,
      githubRepoUrl,
      projectName,
      vercelProjectId,
      vercelUrl: deploymentUrl,
      createdAt: new Date(),
      status: deploymentStatus.readyState,
      accessToken,
    });

    const projectId = createdProject._id;

    // 10. Cleanup
    broadcastProgress('cleanup', 'Removing temp files...', 90);
    await fs.remove(localPath);

    // 11. Link domain
    broadcastProgress('domain-link', 'Linking domain...', 95);
    try {
      const domainResult = await purchaseAndLinkDomain({
        body: { vercelProjectId, domain, projectId }
      }, {
        status: (code) => ({
          json: (data) => {
            if (code >= 400) throw new Error(data.error || 'Domain linking failed');
            return data;
          }
        })
      });

      await Project.findByIdAndUpdate(projectId, { domain });
      broadcastProgress('domain-success', 'Domain linked successfully', 98);
    } catch (domainErr) {
      console.warn('⚠️ Domain linking failed:', domainErr.message);
      await Project.findByIdAndUpdate(projectId, {
        domain,
        domainError: domainErr.message
      });
      broadcastProgress('domain-failed', 'Domain linking failed', 98);
    }

    // 12. Finish
    const totalTime = Math.floor((Date.now() - startTime) / 1000);
    console.log(`✅ Deployment completed in ${totalTime} seconds`);
    broadcastProgress('complete', 'Deployment completed successfully', 100);

    return res.status(201).json({
      message: 'Deployed and built successfully 🎉',
      domain,
      projectId,
      projectUrl: `https://${deploymentUrl}`,
      vercelProjectId,
      deploymentStatus: deploymentStatus.readyState,
      deploymentTime: `${totalTime} seconds`,
      accessToken,
    });

  } catch (err) {
    const errorTime = Math.floor((Date.now() - startTime) / 1000);
    console.error(`💥 Deployment failed after ${errorTime} seconds`);
    console.error('Error:', err.message || err);

    try {
      if (localPath && fs.existsSync(localPath)) {
        await fs.remove(localPath);
      }
    } catch (cleanupErr) {
      console.warn('⚠️ Cleanup error:', cleanupErr.message);
    }

    broadcastProgress('error', `Deployment failed: ${err.message}`, 100);
    return res.status(500).json({
      error: 'Deployment failed',
      details: err?.response?.data?.error?.message || err.message,
      elapsedTime: `${errorTime} seconds`,
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
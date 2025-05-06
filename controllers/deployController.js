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

  if (!storeId || !githubRepoUrl || !projectName || !theme || !domain) {
    console.error('❌ Missing required fields');
    broadcastProgress('error', 'Missing required fields', 100);
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const localPath = path.join(__dirname, `../tmp/${Date.now()}-${projectName}`);
  console.log(`📂 Using temporary directory: ${localPath}`);

  try {
    // 1. Clone repository
    broadcastProgress('cloning', 'Cloning repository...', 20);
    console.log(`⏳ Cloning repository ${githubRepoUrl} (branch: ${branch})...`);
    await simpleGit().clone(githubRepoUrl, localPath, ['-b', branch]);
    console.log('✅ Repository cloned successfully');

    // 2. Generate access token early
    const accessToken = jwt.sign(
      { storeId },
      process.env.ACCESS_TOKEN_SECRET
    );

    // 3. Create updated env vars with STORE_TOKEN
    const updatedEnvVars = {
      ...envVars,
      STORE_TOKEN: accessToken,
    };

    // 4. Write env vars to multiple locations to ensure availability
    broadcastProgress('env-setup', 'Setting up environment...', 30);
    console.log('⚙️  Setting up environment variables');

    // Write to .env file
    const envContent = Object.entries(updatedEnvVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    await fs.writeFile(path.join(localPath, '.env'), envContent, 'utf8');

    // Write to .env.production file (for Next.js)
    await fs.writeFile(path.join(localPath, '.env.production'), envContent, 'utf8');

    // Write to .env.local file (for local development)
    await fs.writeFile(path.join(localPath, '.env.local'), envContent, 'utf8');

    // 5. Prepare files for deployment
    broadcastProgress('file-prep', 'Preparing files...', 40);
    console.log('📦 Preparing files for deployment...');
    const filePaths = await globby(['**/*'], {
      cwd: localPath,
      gitignore: true,
      dot: true,
      onlyFiles: true,
    });
    console.log(`📄 Found ${filePaths.length} files to deploy`);

    const files = await Promise.all(
      filePaths.map(async (file) => ({
        file,
        data: (await fs.readFile(path.join(localPath, file))).toString('base64'),
        encoding: 'base64'
      }))
    );

    // 6. Create Vercel deployment
    broadcastProgress('vercel-deploy', 'Creating Vercel deployment...', 50);
    console.log('🚀 Creating Vercel deployment...');
    const deployRes = await axios.post(
      `${VERCEL_API_BASE}/v13/deployments`,
      {
        name: projectName,
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

    const { id: deploymentId, url: deploymentUrl, projectId: vercelProjectId } = deployRes.data;
    console.log(`🎯 Deployment created. ID: ${deploymentId}, URL: ${deploymentUrl}`);
    broadcastProgress('vercel-created', 'Vercel deployment created', 60);

    // 7. Configure environment variables in Vercel (with retry logic)
    broadcastProgress('env-setup', 'Configuring Vercel environment...', 65);
    console.log('⚙️  Configuring environment variables in Vercel...');

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

    try {
      await setVercelEnvVars();
    } catch (envErr) {
      console.error('⚠️ Failed to configure environment variables after retries:', envErr.message);
    }

    // 8. Redeploy to ensure env vars are picked up
    broadcastProgress('vercel-redeploy', 'Redeploying to apply changes...', 70);
    console.log('🔄 Redeploying to ensure environment variables are applied...');
    try {
      await axios.post(
        `${VERCEL_API_BASE}/v13/deployments`,
        {
          name: projectName,
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
      console.log('✅ Redeployment triggered successfully');
    } catch (redeployErr) {
      console.error('⚠️ Redeployment failed:', redeployErr.message);
    }

    // 9. Wait for deployment to complete
    broadcastProgress('vercel-polling', 'Waiting for deployment to complete...', 75);
    const deploymentStatus = await pollDeploymentStatus(deploymentId, startTime);
    broadcastProgress('vercel-ready', 'Deployment completed', 80);

    // 10. Save project to database
    broadcastProgress('db-save', 'Saving project to database...', 85);
    console.log('💾 Saving project to database...');
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
    console.log(`📀 Project saved with ID: ${projectId}`);

    // 11. Clean up local files
    broadcastProgress('cleanup', 'Cleaning up temporary files...', 90);
    console.log('🧹 Cleaning up temporary files...');
    await fs.remove(localPath);

    // 12. Link domain
    broadcastProgress('domain-link', 'Linking domain...', 95);
    console.log(`🌐 Attempting to link domain: ${domain}`);
    try {
      const domainResult = await purchaseAndLinkDomain({
        body: {
          vercelProjectId,
          domain,
          projectId
        }
      }, {
        status: (code) => ({
          json: (data) => {
            if (code >= 400) throw new Error(data.error || 'Domain linking failed');
            return data;
          }
        })
      });

      await Project.findByIdAndUpdate(projectId, {
        domain: domain
      });

      console.log(`🔗 Domain linked successfully: ${domain}`);
      broadcastProgress('domain-success', 'Domain linked successfully', 98);
    } catch (domainErr) {
      console.error('⚠️ Domain linking failed:', domainErr.message);
      await Project.findByIdAndUpdate(projectId, {
        domain: domain,
        domainError: domainErr.message
      });
      broadcastProgress('domain-failed', 'Domain linking failed', 98);
    }

    // 13. Calculate total time
    const totalTime = Math.floor((Date.now() - startTime) / 1000);
    console.log(`🏁 Deployment process completed in ${totalTime} seconds`);
    broadcastProgress('complete', 'Deployment completed successfully', 100);

    // 14. Respond to client
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
    console.error('Error details:', err?.response?.data || err.message);
    broadcastProgress('error', `Deployment failed: ${err.message}`, 100);

    try {
      if (localPath && fs.existsSync(localPath)) {
        await fs.remove(localPath);
      }
    } catch (cleanupErr) {
      console.warn('Cleanup failed:', cleanupErr.message);
    }

    return res.status(500).json({
      error: 'Deployment failed',
      details: err?.response?.data?.error?.message || err.message,
      elapsedTime: `${errorTime} seconds`
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
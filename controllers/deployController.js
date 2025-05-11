// At the top of your file, add the router import
const { broadcastProgress } = require('../utils/progressTracker');

const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs-extra');
const os = require('os'); // Added for cross-platform temp dirs
const axios = require('axios');
const { globby } = require('globby');
const Project = require('../models/Project');
const { purchaseAndLinkDomain } = require('./domainController');

const VERCEL_API_BASE = 'https://api.vercel.com';
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
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

  const githubToken = process.env.GITHUB_TOKEN;
  const vercelToken = process.env.VERCEL_API_TOKEN;

  // Validate Vercel token
  if (!vercelToken) {
    console.error('❌ Missing VERCEL_TOKEN');
    broadcastProgress('error', 'Missing VERCEL_TOKEN', 100);
    return res.status(500).json({ error: 'Server configuration error: Missing VERCEL_TOKEN' });
  }

  if (!storeId || !githubRepoUrl || !projectName || !theme || !domain || !githubToken) {
    console.error('❌ Missing required fields (storeId, githubRepoUrl, githubToken, etc.)');
    broadcastProgress('error', 'Missing required fields', 100);
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Sanitize project name for Vercel (alphanumeric and hyphens only)
  const sanitizedProjectName = projectName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const localPath = path.join(__dirname, `../tmp/${Date.now()}-${sanitizedProjectName}`);
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

    // Check if package.json exists
    const packageJsonPath = path.join(localPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      throw new Error('package.json not found in repository. Cannot deploy a non-Node.js project.');
    }

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
    console.log(`Found ${filePaths.length} files to deploy`);

    const files = await Promise.all(
      filePaths.map(async (file) => ({
        file,
        data: (await fs.readFile(path.join(localPath, file))).toString('base64'),
        encoding: 'base64'
      }))
    );

    // 5. Create Vercel project with a scoped unique name
    const scopedProjectName = `${sanitizedProjectName}-${storeId.slice(0, 8)}`;
    broadcastProgress('vercel-project', 'Creating Vercel project...', 45);
    console.log(`📁 Creating Vercel project with name: ${scopedProjectName}...`);

    // Test Vercel API connection first
    try {
      const testResponse = await axios.get(`${VERCEL_API_BASE}/v2/user`, {
        headers: {
          Authorization: `Bearer ${vercelToken}`,
          'Content-Type': 'application/json',
        },
      });
      console.log('✅ Vercel API connection successful');
    } catch (testError) {
      console.error('❌ Vercel API connection test failed:', testError.message);
      if (testError.response) {
        console.error('Response data:', testError.response.data);
        console.error('Response status:', testError.response.status);
      }
      throw new Error(`Vercel API connection failed: ${testError.message}`);
    }

    // Check if project exists first to avoid duplicates
    let vercelProjectId;
    try {
      const checkProjectRes = await axios.get(
        `${VERCEL_API_BASE}/v11/projects/${scopedProjectName}`,
        {
          headers: {
            Authorization: `Bearer ${vercelToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      vercelProjectId = checkProjectRes.data.id;
      console.log(`✅ Vercel project already exists with ID: ${vercelProjectId}`);
    } catch (projectError) {
      if (projectError.response && projectError.response.status === 404) {
        console.log('Project does not exist yet, creating new project...');
        try {
          // Project doesn't exist, create a new one
          const createProjectRes = await axios.post(
            `${VERCEL_API_BASE}/v11/projects`,
            {
              name: scopedProjectName,
              framework: 'nextjs',
              buildCommand,
              installCommand,
              outputDirectory,
              rootDirectory: null,
            },
            {
              headers: {
                Authorization: `Bearer ${vercelToken}`,
                'Content-Type': 'application/json',
              },
            }
          );
          vercelProjectId = createProjectRes.data.id;
          console.log(`✅ Vercel project created with ID: ${vercelProjectId}`);
        } catch (createError) {
          console.error('❌ Project creation failed:', createError.message);
          if (createError.response) {
            console.error('Response data:', createError.response.data);
            console.error('Response status:', createError.response.status);
          }
          throw new Error(`Project creation failed: ${createError.message}`);
        }
      } else {
        console.error('❌ Error checking project existence:', projectError.message);
        if (projectError.response) {
          console.error('Response data:', projectError.response.data);
          console.error('Response status:', projectError.response.status);
        }
        throw new Error(`Error checking project existence: ${projectError.message}`);
      }
    }

    // 6. Set env vars BEFORE deployment
    broadcastProgress('env-vercel', 'Configuring environment in Vercel...', 50);
    console.log('⚙️ Sending environment variables to Vercel...');

    const vercelEnvPayload = Object.entries(updatedEnvVars).map(([key, value]) => ({
      key,
      value,
      target: ['production', 'preview', 'development'],
      type: 'encrypted',
    }));

    try {
      await axios.post(
        `${VERCEL_API_BASE}/v10/projects/${vercelProjectId}/env`,
        vercelEnvPayload,
        {
          headers: {
            Authorization: `Bearer ${vercelToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log('✅ Vercel environment variables configured');
    } catch (envError) {
      console.warn('⚠️ Error setting environment variables:', envError.message);
      if (envError.response) {
        console.warn('Response data:', envError.response.data);
        console.warn('Response status:', envError.response.status);
      }
      // Continue even if env vars fail - not critical
    }

    // 7. Now deploy the code with proper project linking
    broadcastProgress('vercel-deploy', 'Creating Vercel deployment...', 60);
    console.log('🚀 Sending files to Vercel...');

    let deployRes;
    try {
      // Try deployment with full set of parameters first
      console.log(`Attempting deployment for project ID: ${vercelProjectId}`);
      deployRes = await axios.post(
        `${VERCEL_API_BASE}/v13/deployments`,
        {
          name: scopedProjectName,
          // projectId: vercelProjectId,
          files,
          target: 'production',
          framework: 'nextjs',
        },
        {
          headers: {
            Authorization: `Bearer ${vercelToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (deployError) {
      console.error('❌ Initial deployment attempt failed:', deployError.message);
      if (deployError.response) {
        console.error('Response data:', deployError.response.data);
        console.error('Response status:', deployError.response.status);
      }

      // Try simplified deployment as fallback
      console.log('Attempting simplified deployment as fallback...');
      try {
        deployRes = await axios.post(
          `${VERCEL_API_BASE}/v13/deployments`,
          {
            name: scopedProjectName,
            // projectId: vercelProjectId,
            files,
            target: 'production',
          },
          {
            headers: {
              Authorization: `Bearer ${vercelToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
      } catch (fallbackError) {
        console.error('❌ Fallback deployment also failed:', fallbackError.message);
        if (fallbackError.response) {
          console.error('Response data:', fallbackError.response.data);
          console.error('Response status:', fallbackError.response.status);
        }
        throw new Error(`Deployment failed: ${fallbackError.message}`);
      }
    }

    const { id: deploymentId, url: deploymentUrl } = deployRes.data;
    console.log(`✅ Deployment created with ID: ${deploymentId} and URL: ${deploymentUrl}`);
    broadcastProgress('vercel-created', 'Vercel deployment created', 70);

    // 8. Poll deployment
    broadcastProgress('vercel-polling', 'Polling for deployment status...', 75);
    const deploymentStatus = await pollDeploymentStatus(deploymentId, startTime);

    // 9. Save project
    broadcastProgress('db-save', 'Saving project to database...', 85);
    const createdProject = await Project.create({
      storeId,
      theme,
      githubRepoUrl,
      projectName: scopedProjectName,
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



// Helper function to create Git credentials in Vercel
// async function createGitCredentialIfNeeded(repoOwner, repoName) {
//   try {
//     // Check if credential already exists
//     const { data: credentials } = await axios.get(
//       `${VERCEL_API_BASE}/v1/integrations/git-credentials`,
//       {
//         headers: {
//           Authorization: `Bearer ${VERCEL_TOKEN}`,
//         },
//       }
//     );

//     const existingCred = credentials.find(c => c.name.includes(repoOwner));
//     if (existingCred) return existingCred.id;

//     // Create new credential if needed
//     const { data: newCred } = await axios.post(
//       `${VERCEL_API_BASE}/v1/integrations/git-credentials`,
//       {
//         type: 'github',
//         name: `${repoOwner}-${repoName}-${Date.now()}`,
//         username: 'x-access-token',
//         password: GITHUB_TOKEN
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${VERCEL_TOKEN}`,
//           'Content-Type': 'application/json',
//         },
//       }
//     );

//     return newCred.id;
//   } catch (error) {
//     console.warn('⚠️ Could not create Git credential:', error.message);
//     return null;
//   }
// }

// exports.updateProjectsByTheme = async (req, res) => {
//   const { themeId } = req.body;

//   try {
//     const projects = await Project.find({ theme: themeId });
//     if (!projects.length) {
//       return res.status(404).json({ message: 'No projects found' });
//     }

//     const results = await Promise.all(
//       projects.map(async (project) => {
//         if (!project.vercelProjectId) {
//           return {
//             projectId: project._id,
//             status: 'skipped',
//             reason: 'Missing Vercel project ID'
//           };
//         }

//         const result = await triggerVercelDeployment(project);
//         if (result.success) {
//           await Project.findByIdAndUpdate(project._id, {
//             $set: { lastDeployed: new Date() },
//             $push: {
//               deployments: {
//                 deploymentId: result.deploymentId,
//                 url: result.url,
//                 date: new Date(),
//                 source: 'github',
//                 branch: project.branch || 'main',
//                 derivedName: result.derivedProjectName
//               }
//             }
//           });
//         }

//         return {
//           projectId: project._id,
//           domain: project.domain,
//           status: result.success ? 'success' : 'failed',
//           ...result
//         };
//       })
//     );

//     return res.json({
//       message: 'Deployments processed',
//       results
//     });
//   } catch (error) {
//     console.error('Deployment error:', error);
//     return res.status(500).json({
//       error: 'Deployment failed',
//       details: error.message
//     });
//   }
// };



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
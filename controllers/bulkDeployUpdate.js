// At the top of your file, add the router import
const { broadcastProgress } = require('../utils/progressTracker');

const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs-extra');
const os = require('os'); // Added for cross-platform temp dirs
const axios = require('axios');
// const { globby } = require('globby'); // Removed due to ESM issue
const Project = require('../models/Project');
const { purchaseAndLinkDomain } = require('./domainController');

const VERCEL_API_BASE = 'https://api.vercel.com';
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const jwt = require('jsonwebtoken');


function sanitizeProjectName(input) {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '-')  // Replace invalid chars with hyphen
        .replace(/\.{2,}/g, '.')        // Replace multiple dots with single
        .replace(/-{2,}/g, '-')          // Replace multiple hyphens with single
        .replace(/_+/g, '_')             // Replace multiple underscores with single
        .replace(/^[^a-z0-9]+/, '')      // Remove leading non-alphanumerics
        .replace(/[^a-z0-9]+$/, '')      // Remove trailing non-alphanumerics
        .substring(0, 100);              // Trim to 100 chars
}

/**
 * Get existing Vercel project by name or create a new one if it doesn't exist
 * @param {string} projectName - Sanitized project name
 * @param {Object} project - MongoDB project document
 * @returns {Promise<{projectId: string, vercelProjectName: string, success: boolean, error?: string}>}
 */
async function getOrCreateVercelProject(projectName, project) {
    try {
        // First check if we already have a Vercel project ID stored in our database
        if (project.vercelProjectId) {
            console.log(`📂 Using stored Vercel project ID: ${project.vercelProjectId}`);
            
            try {
                // Verify the project still exists in Vercel
                const projectResponse = await axios.get(
                    `${VERCEL_API_BASE}/v9/projects/${project.vercelProjectId}`,
                    {
                        headers: {
                            Authorization: `Bearer ${VERCEL_TOKEN}`
                        }
                    }
                );
                
                // Return the existing project ID and name
                return {
                    success: true,
                    projectId: project.vercelProjectId,
                    vercelProjectName: projectResponse.data.name
                };
            } catch (error) {
                // If project doesn't exist anymore, continue with normal flow
                console.log(`⚠️ Stored Vercel project ID not found: ${error.message}`);
            }
        }
        
        // Try to find the project by name or domain
        const projectListResponse = await axios.get(
            `${VERCEL_API_BASE}/v9/projects`,
            {
                headers: {
                    Authorization: `Bearer ${VERCEL_TOKEN}`
                }
            }
        );

        // First try to find by domain if available
        let existingProject = null;
        if (project.domain) {
            existingProject = projectListResponse.data.projects.find(
                p => p.targets?.production?.alias?.includes(project.domain) ||
                     p.alias?.includes(project.domain)
            );
            
            if (existingProject) {
                console.log(`🔍 Found Vercel project by domain: ${project.domain}`);
            }
        }
        
        // If not found by domain, try by name
        if (!existingProject) {
            existingProject = projectListResponse.data.projects.find(
                p => p.name === projectName
            );
            
            if (existingProject) {
                console.log(`🔍 Found Vercel project by name: ${projectName}`);
            }
        }

        if (existingProject) {
            return {
                success: true,
                projectId: existingProject.id,
                vercelProjectName: existingProject.name
            };
        }

        // If project doesn't exist, create a new one
        console.log(`🆕 Creating new Vercel project: ${projectName}`);
        const createResponse = await axios.post(
            `${VERCEL_API_BASE}/v9/projects`,
            {
                name: projectName,
                framework: project.framework || 'nextjs' // Default framework
            },
            {
                headers: {
                    Authorization: `Bearer ${VERCEL_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return {
            success: true,
            projectId: createResponse.data.id,
            vercelProjectName: createResponse.data.name
        };
    } catch (error) {
        console.error('Error getting/creating Vercel project:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Trigger a redeployment of an existing Vercel project
 */
async function triggerVercelDeployment(project, options = {}) {
    let localPath = null;
    const { githubRepoUrl, githubToken } = options;

    try {
        const sanitizedProjectName = sanitizeProjectName(
            project.name || project.domain || `project-${project._id.toString().slice(-6)}`
        );

        // Step 1: Get or create the Vercel project to get project ID
        const vercelProjectResult = await getOrCreateVercelProject(sanitizedProjectName, project);
        if (!vercelProjectResult.success) {
            throw new Error(`Failed to get/create Vercel project: ${vercelProjectResult.error}`);
        }

        const projectId = vercelProjectResult.projectId;
        const vercelProjectName = vercelProjectResult.vercelProjectName;
        console.log(`📁 Working with Vercel project ID: ${projectId}, name: ${vercelProjectName}`);

        localPath = path.join(__dirname, `../tmp/${Date.now()}-${sanitizedProjectName}`);

        // ⬇️ Clone the GitHub repo into the localPath
        await simpleGit().clone(githubRepoUrl, localPath);

        // Dynamic import for globby to handle ESM module
        const { globby } = await import('globby');
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

        // Check if we have a previous deployment to redeploy
        let previousDeploymentId = null;
        if (project.deployments && project.deployments.length > 0) {
            // Get the latest deployment ID
            previousDeploymentId = project.deployments[project.deployments.length - 1].deploymentId;
            console.log(`🔄 Found previous deployment ID: ${previousDeploymentId}`);
        }

        // Setup the deployment payload according to v13 API docs
        const deploymentPayload = {
            // IMPORTANT: Use the vercelProjectName, not our sanitized name to ensure match
            name: vercelProjectName,
            target: 'production',
            files: files,
            project: projectId, // According to docs, use 'project' rather than 'projectId'
       
                framework: project.framework || 'nextjs',
                buildCommand: project.buildCommand || 'npm run build',
                devCommand: project.devCommand || 'npm run dev',
                installCommand: project.installCommand || 'npm install --legacy-peer-deps --force',
                outputDirectory: '.next',
        };
        
        // If we have a previous deployment, use the deploymentId param to redeploy it
        if (previousDeploymentId) {
            deploymentPayload.deploymentId = previousDeploymentId;
        }

        console.log('🚀 Starting deployment');

        // Use v13 endpoint as per documentation
        const response = await axios.post(
            `${VERCEL_API_BASE}/v13/deployments`,
            deploymentPayload,
            {
                headers: {
                    Authorization: `Bearer ${VERCEL_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000 // Increased timeout for larger projects
            }
        );

        return {
            success: true,
            deploymentId: response.data.id,
            url: response.data.url,
            projectId: projectId,
            githubRepoUrl
        };

    } catch (error) {
        console.error('Deployment error:', error.message);
        return {
            success: false,
            error: error.message,
            details: error.response?.data || null,
            githubRepoUrl
        };
    } finally {
        if (localPath && await fs.pathExists(localPath)) {
            console.log('🧹 Cleaning up temporary files');
            await fs.remove(localPath).catch(e => console.warn('Cleanup warning:', e));
        }
    }
}

exports.bulkDeployUpdate = async (req, res) => {
    try {
        const { themeId } = req.body;

        if (!themeId) {
            return res.status(400).json({ error: 'Theme ID is required' });
        }

        const projects = await Project.find({ theme: themeId });
        if (!projects.length) {
            return res.status(404).json({ message: 'No projects found for this theme' });
        }

        const results = await Promise.all(
            projects.map(async (project) => {
                if (!project.vercelProjectId) {
                    return {
                        projectId: project._id,
                        status: 'skipped',
                        reason: 'Missing Vercel project ID'
                    };
                }

                try {
                    const result = await triggerVercelDeployment(project);
                    
                    if (result.success) {
                        await Project.findByIdAndUpdate(project._id, {
                            $set: { lastDeployed: new Date() },
                            $push: {
                                deployments: {
                                    deploymentId: result.deploymentId,
                                    url: result.url,
                                    date: new Date(),
                                    source: 'github',
                                    branch: project.branch || 'main',
                                    derivedName: result.derivedProjectName
                                }
                            }
                        });
                    }

                    return {
                        projectId: project._id,
                        domain: project.domain,
                        status: result.success ? 'success' : 'failed',
                        ...result
                    };
                } catch (error) {
                    console.error(`Deployment failed for project ${project._id}:`, error.message);
                    return {
                        projectId: project._id,
                        domain: project.domain,
                        status: 'failed',
                        error: error.message
                    };
                }
            })
        );

        const successful = results.filter(r => r.status === 'success');
        const failed = results.filter(r => r.status === 'failed');
        const skipped = results.filter(r => r.status === 'skipped');

        return res.json({
            message: 'Bulk deployment completed',
            summary: {
                total: results.length,
                successful: successful.length,
                failed: failed.length,
                skipped: skipped.length
            },
            results
        });

    } catch (error) {
        console.error('Bulk deployment error:', error);
        return res.status(500).json({
            error: 'Bulk deployment failed',
            details: error.message
        });
    }
};
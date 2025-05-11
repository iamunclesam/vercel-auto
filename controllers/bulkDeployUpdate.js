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

async function triggerVercelDeployment(project, options = {}) {
    let localPath = null;
    const { githubRepoUrl, githubToken } = options;

    try {
        const sanitizedProjectName = sanitizeProjectName(
            project.name || project.domain || `project-${project._id.toString().slice(-6)}`
        );

        localPath = path.join(__dirname, `../tmp/${Date.now()}-${sanitizedProjectName}`);

        // ⬇️ Clone the GitHub repo into the localPath
        await simpleGit().clone(githubRepoUrl, localPath);

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

        const deploymentPayload = {
            name: sanitizedProjectName,
            // projectId: project.vercelProjectId,
            target: 'production',
            files: files,
            buildCommand: project.buildCommand || 'npm run build',
            installCommand: project.installCommand || 'npm install',
            framework: project.framework || 'nextjs'
        };

        console.log('🚀 Starting deployment');

        const response = await axios.post(
            `${VERCEL_API_BASE}/v13/deployments`,
            deploymentPayload,
            {
                headers: {
                    Authorization: `Bearer ${VERCEL_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        return {
            success: true,
            deploymentId: response.data.id,
            url: response.data.url,
            githubRepoUrl
        };

    } catch (error) {
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

exports.updateProjectsByTheme = async (req, res) => {
    try {
        const projects = await Project.find({ theme: req.body.themeId });

        if (!projects.length) {
            return res.status(404).json({ error: 'No projects found for this theme' });
        }

        const githubRepoUrl = 'https://github.com/iamunclesam/multi-purpose-ecommerce';
        const githubToken = process.env.GITHUB_TOKEN; // don't expose this in response

        const results = await Promise.all(
            projects.map(async project => {
                const result = await triggerVercelDeployment(project, {
                    githubRepoUrl,
                    githubToken
                });

                if (result.success) {
                    await Project.findByIdAndUpdate(project._id, {
                        $set: { lastDeployed: new Date() },
                        $push: {
                            deployments: {
                                deploymentId: result.deploymentId,
                                url: result.url,
                                date: new Date(),
                                source: 'github',
                                branch: project.branch || 'main'
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
            })
        );

        return res.json({
            message: 'Deployments processed',
            results
        });

    } catch (error) {
        console.error('Controller error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
};

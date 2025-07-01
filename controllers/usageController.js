const axios = require('axios');
const Project = require('../models/Project');

const VERCEL_API_BASE = 'https://api.vercel.com';
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;

exports.getProjectUsage = async (req, res) => {
  try {
    const { projectId } = req.params;

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.vercelProjectId) {
      return res.status(400).json({ error: 'Project does not have a Vercel project ID' });
    }

    const usageData = await fetchVercelUsage(project.vercelProjectId);
    
    project.usage = {
      bandwidth: usageData.bandwidth || 0,
      requests: usageData.requests || 0,
      updatedAt: new Date()
    };
    await project.save();

    return res.status(200).json({
      success: true,
      projectId,
      usage: project.usage,
      vercelProjectId: project.vercelProjectId
    });

  } catch (err) {
    console.error('Usage Fetch Error:', err?.response?.data || err.message);
    return res.status(500).json({
      error: 'Failed to fetch usage data',
      details: err?.response?.data || err.message
    });
  }
};

exports.getAllProjectsUsage = async (req, res) => {
  try {
    const projects = await Project.find({ vercelProjectId: { $exists: true, $ne: null } });
    
    if (!projects.length) {
      return res.status(404).json({ error: 'No projects with Vercel IDs found' });
    }

    const usagePromises = projects.map(async (project) => {
      try {
        const usageData = await fetchVercelUsage(project.vercelProjectId);
        
        project.usage = {
          bandwidth: usageData.bandwidth || 0,
          requests: usageData.requests || 0,
          updatedAt: new Date()
        };
        await project.save();

        return {
          projectId: project._id,
          projectName: project.projectName,
          vercelProjectId: project.vercelProjectId,
          usage: project.usage,
          success: true
        };
      } catch (error) {
        console.error(`Failed to fetch usage for project ${project._id}:`, error.message);
        return {
          projectId: project._id,
          projectName: project.projectName,
          vercelProjectId: project.vercelProjectId,
          error: error.message,
          success: false
        };
      }
    });

    const results = await Promise.all(usagePromises);
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    return res.status(200).json({
      success: true,
      message: `Processed ${results.length} projects`,
      results: {
        successful: successful.length,
        failed: failed.length,
        details: results
      }
    });

  } catch (err) {
    console.error('Bulk Usage Fetch Error:', err?.response?.data || err.message);
    return res.status(500).json({
      error: 'Failed to fetch usage data for all projects',
      details: err?.response?.data || err.message
    });
  }
};

exports.getUsageByStoreId = async (req, res) => {
  try {
    const { storeId } = req.params;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const projects = await Project.find({ 
      storeId,
      vercelProjectId: { $exists: true, $ne: null }
    });

    if (!projects.length) {
      return res.status(404).json({ error: 'No projects found for this store' });
    }

    const usagePromises = projects.map(async (project) => {
      try {
        const usageData = await fetchVercelUsage(project.vercelProjectId);
        
        project.usage = {
          bandwidth: usageData.bandwidth || 0,
          requests: usageData.requests || 0,
          updatedAt: new Date()
        };
        await project.save();

        return {
          projectId: project._id,
          projectName: project.projectName,
          vercelProjectId: project.vercelProjectId,
          usage: project.usage,
          success: true
        };
      } catch (error) {
        console.error(`Failed to fetch usage for project ${project._id}:`, error.message);
        return {
          projectId: project._id,
          projectName: project.projectName,
          vercelProjectId: project.vercelProjectId,
          error: error.message,
          success: false
        };
      }
    });

    const results = await Promise.all(usagePromises);
    
    const totalUsage = results
      .filter(r => r.success)
      .reduce((acc, project) => {
        acc.bandwidth += project.usage.bandwidth || 0;
        acc.requests += project.usage.requests || 0;
        return acc;
      }, { bandwidth: 0, requests: 0 });

    return res.status(200).json({
      success: true,
      storeId,
      totalUsage,
      projects: results,
      summary: {
        totalProjects: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      }
    });

  } catch (err) {
    console.error('Store Usage Fetch Error:', err?.response?.data || err.message);
    return res.status(500).json({
      error: 'Failed to fetch usage data for store',
      details: err?.response?.data || err.message
    });
  }
};

async function fetchVercelUsage(projectId) {
  try {
    const response = await axios.get(
      `${VERCEL_API_BASE}/v1/projects/${projectId}/usage`,
      {
        headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }
      }
    );

    const usage = response.data;
    
    return {
      bandwidth: usage.bandwidth?.total || 0,
      requests: usage.requests?.total || 0,
      functionExecution: usage.functionExecution?.total || 0,
      edgeFunctionExecution: usage.edgeFunctionExecution?.total || 0,
      invocations: usage.invocations?.total || 0,
      period: usage.period || 'current'
    };
  } catch (error) {
    console.error(`Failed to fetch Vercel usage for project ${projectId}:`, error.response?.data || error.message);
    throw new Error(`Vercel API error: ${error.response?.data?.error?.message || error.message}`);
  }
}

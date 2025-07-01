const axios = require('axios');
const Project = require('../models/Project');

const VERCEL_API_BASE = 'https://api.vercel.com';
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;

// Predefined resource plans
const RESOURCE_PLANS = {
  free: {
    bandwidth: 1, // GB
    requests: 100000,
    functionExecution: 100000,
    storage: 1, // GB
    domains: 1,
    teamMembers: 1,
    concurrentBuilds: 1,
    edgeFunctions: 0,
    serverlessFunctions: 100000
  },
  pro: {
    bandwidth: 5, // GB
    requests: 1000000,
    functionExecution: 1000000,
    storage: 5, // GB
    domains: 10,
    teamMembers: 5,
    concurrentBuilds: 3,
    edgeFunctions: 1000000,
    serverlessFunctions: 1000000
  },
  enterprise: {
    bandwidth: 20, // GB
    requests: 10000000,
    functionExecution: 10000000,
    storage: 10, // GB
    domains: 100,
    teamMembers: 50,
    concurrentBuilds: 10,
    edgeFunctions: 10000000,
    serverlessFunctions: 10000000
  }
};

// Set resource allocation for a project
exports.setResourceAllocation = async (req, res) => {
  try {
    const { projectId, plan, customLimits, alerts } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Update resource allocation
    if (plan && RESOURCE_PLANS[plan]) {
      project.resourceAllocation.plan = plan;
      project.resourceAllocation.limits = { ...RESOURCE_PLANS[plan] };
    }

    // Apply custom limits if provided
    if (customLimits) {
      project.resourceAllocation.limits = {
        ...project.resourceAllocation.limits,
        ...customLimits
      };
    }

    // Update alerts configuration
    if (alerts) {
      project.resourceAllocation.alerts = {
        ...project.resourceAllocation.alerts,
        ...alerts
      };
    }

    await project.save();

    return res.status(200).json({
      success: true,
      message: 'Resource allocation updated successfully',
      project: {
        id: project._id,
        name: project.projectName,
        resourceAllocation: project.resourceAllocation
      }
    });

  } catch (err) {
    console.error('Resource Allocation Error:', err.message);
    return res.status(500).json({
      error: 'Failed to set resource allocation',
      details: err.message
    });
  }
};

// Get resource usage for a project
exports.getResourceUsage = async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Fetch current usage from Vercel
    const usageData = await fetchVercelUsage(project.vercelProjectId);

    // Update project with latest usage
    project.resourceAllocation.usage = {
      ...project.resourceAllocation.usage,
      ...usageData,
      lastUpdated: new Date()
    };

    await project.save();

    // Calculate usage percentages
    const usagePercentages = calculateUsagePercentages(
      project.resourceAllocation.usage,
      project.resourceAllocation.limits
    );

    return res.status(200).json({
      success: true,
      project: {
        id: project._id,
        name: project.projectName,
        plan: project.resourceAllocation.plan,
        limits: project.resourceAllocation.limits,
        usage: project.resourceAllocation.usage,
        percentages: usagePercentages,
        alerts: project.resourceAllocation.alerts
      }
    });

  } catch (err) {
    console.error('Resource Usage Error:', err.message);
    return res.status(500).json({
      error: 'Failed to get resource usage',
      details: err.message
    });
  }
};

// Get all resource plans
exports.getResourcePlans = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      plans: RESOURCE_PLANS
    });
  } catch (err) {
    console.error('Resource Plans Error:', err.message);
    return res.status(500).json({
      error: 'Failed to get resource plans',
      details: err.message
    });
  }
};

// Check resource limits and send alerts
exports.checkResourceLimits = async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const usagePercentages = calculateUsagePercentages(
      project.resourceAllocation.usage,
      project.resourceAllocation.limits
    );

    const alerts = [];
    const threshold = project.resourceAllocation.alerts.threshold;

    // Check each resource type
    Object.keys(usagePercentages).forEach(resource => {
      const percentage = usagePercentages[resource];
      if (percentage >= threshold) {
        alerts.push({
          resource,
          percentage,
          limit: project.resourceAllocation.limits[resource],
          current: project.resourceAllocation.usage[resource],
          severity: percentage >= 100 ? 'critical' : 'warning'
        });
      }
    });

    return res.status(200).json({
      success: true,
      projectId,
      alerts,
      usagePercentages
    });

  } catch (err) {
    console.error('Resource Limits Check Error:', err.message);
    return res.status(500).json({
      error: 'Failed to check resource limits',
      details: err.message
    });
  }
};

// Helper function to fetch usage from Vercel
async function fetchVercelUsage(vercelProjectId) {
  try {
    const response = await axios.get(
      `${VERCEL_API_BASE}/v1/projects/${vercelProjectId}/usage`,
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
      storage: usage.storage?.total || 0
    };
  } catch (error) {
    console.error(`Failed to fetch Vercel usage for project ${vercelProjectId}:`, error.message);
    return {
      bandwidth: 0,
      requests: 0,
      functionExecution: 0,
      edgeFunctionExecution: 0,
      invocations: 0,
      storage: 0
    };
  }
}

// Helper function to calculate usage percentages
function calculateUsagePercentages(usage, limits) {
  const percentages = {};
  
  Object.keys(limits).forEach(resource => {
    const current = usage[resource] || 0;
    const limit = limits[resource];
    percentages[resource] = limit > 0 ? Math.round((current / limit) * 100) : 0;
  });

  return percentages;
} 
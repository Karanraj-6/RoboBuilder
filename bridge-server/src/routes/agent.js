/**
 * Agent routes — create agents, send prompts, manage plans
 */
const express = require('express');
const router = express.Router();
const agentPool = require('../agent/agentPool');

function resolveAgent(id) {
    const agent = agentPool.get(id);
    if (agent) return agent;
    return null;
}

// List all agents
router.get('/agents', (req, res) => {
    res.json({ agents: agentPool.getAll() });
});

// Create new agent
router.post('/agents', (req, res) => {
    const { name } = req.body;
    const agent = agentPool.create(name);
    res.json({
        id: agent.id,
        name: agent.name,
        status: agent.status
    });
});

// Get agent details
router.get('/agents/:id', (req, res) => {
    const agent = resolveAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    res.json({
        id: agent.id,
        name: agent.name,
        type: 'agent',
        ...agent.getStatus()
    });
});

// Delete agent
router.delete('/agents/:id', (req, res) => {
    const removed = agentPool.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Agent not found' });
    res.json({ success: true });
});

// Send prompt to agent
router.post('/agents/:id/prompt', async (req, res) => {
    const agent = resolveAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const { prompt, modelId, apiKeys } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
    if (!modelId) return res.status(400).json({ error: 'Missing modelId' });

    try {
        const result = await agent.start(prompt, modelId, apiKeys);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get agent's build plan
router.get('/agents/:id/plan', (req, res) => {
    const agent = resolveAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json({ plan: agent.currentPlan, status: agent.status });
});

// Approve agent's build plan
router.post('/agents/:id/plan/approve', async (req, res) => {
    const agent = resolveAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    try {
        const result = await agent.approvePlan();
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Get agent activity log
router.get('/agents/:id/activity', (req, res) => {
    const agent = resolveAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const limit = parseInt(req.query.limit) || 50;
    res.json({ activity: agent.getActivity(limit) });
});

// Pause agent
router.post('/agents/:id/pause', (req, res) => {
    const agent = resolveAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (typeof agent.pause !== 'function') {
        return res.json({ status: agent.status || 'idle', noop: true });
    }
    agent.pause();
    res.json({ status: agent.status });
});

// Resume agent
router.post('/agents/:id/resume', (req, res) => {
    const agent = resolveAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (typeof agent.resume !== 'function') {
        return res.json({ status: agent.status || 'idle', noop: true });
    }
    agent.resume();
    res.json({ status: agent.status });
});

// Stop agent
router.post('/agents/:id/stop', (req, res) => {
    const agent = resolveAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (typeof agent.stop !== 'function') {
        return res.json({ status: agent.status || 'idle', noop: true });
    }
    agent.stop();
    res.json({ status: agent.status });
});

module.exports = router;

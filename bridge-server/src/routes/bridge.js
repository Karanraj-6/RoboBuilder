/**
 * Bridge routes — Plugin communication: command polling, results, project state, heartbeat
 */
const express = require('express');
const router = express.Router();
const commandQueue = require('../queue/commandQueue');
const agentPool = require('../agent/agentPool');

// Project state storage
let projectState = {};

// Plugin polls for pending commands
router.get('/commands', (req, res) => {
    req.updatePluginHeartbeat();
    const commands = commandQueue.dequeue(10);
    if (commands.length > 0) {
        console.log(`[Bridge Server] Plugin fetched ${commands.length} commands.`);
    }
    res.json({ commands });
});

// Plugin reports command result
router.post('/commands/:id/result', (req, res) => {
    req.updatePluginHeartbeat();
    const { success, result, error } = req.body;
    console.log(`[Bridge Server] Command ${req.params.id} finished. Success: ${success}. Result: ${result}`);
    const cmd = commandQueue.reportResult(req.params.id, success, result, error);
    if (!cmd) return res.status(404).json({ error: 'Command not found' });
    res.json({ status: cmd.status });
});

// Plugin uploads current project state
router.post('/project-state', (req, res) => {
    req.updatePluginHeartbeat();
    projectState = req.body;
    // Update the central state manager so runtime can read fresh state
    const stateManager = require('../agent/stateManager');
    stateManager.updateProjectState(projectState);
    // Update all agents with new state
    agentPool.updateProjectState(projectState);
    res.json({ received: true });
});

// Web app fetches project state
router.get('/project-state', (req, res) => {
    res.json(projectState);
});

// Plugin heartbeat
router.post('/heartbeat', (req, res) => {
    req.updatePluginHeartbeat();
    res.json({ ok: true, timestamp: Date.now() });
});

// Get plugin connection status
router.get('/plugin-status', (req, res) => {
    const status = req.getPluginStatus();
    res.json({
        connected: status.connected && !status.stale,
        lastSeen: status.lastSeen
    });
});

module.exports = router;

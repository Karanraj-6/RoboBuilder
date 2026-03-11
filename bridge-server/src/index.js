require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const agentRoutes = require('./routes/agent');
const bridgeRoutes = require('./routes/bridge');
const assetRoutes = require('./routes/assets');
const modelRoutes = require('./routes/models');

const app = express();

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure data directories exist
const dirs = [config.sessionDir, config.uploadDir];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Plugin heartbeat tracking
let pluginLastSeen = null;
let pluginConnected = false;

app.use((req, res, next) => {
    req.getPluginStatus = () => ({
        connected: pluginConnected,
        lastSeen: pluginLastSeen,
        stale: pluginLastSeen && (Date.now() - pluginLastSeen > 10000)
    });
    req.updatePluginHeartbeat = () => {
        pluginLastSeen = Date.now();
        pluginConnected = true;
    };
    next();
});

// Routes
app.use('/api', agentRoutes);
app.use('/api', bridgeRoutes);
app.use('/api', assetRoutes);
app.use('/api', modelRoutes);

// Health / status endpoint
app.get('/api/status', (req, res) => {
    const plugin = req.getPluginStatus();
    res.json({
        status: 'running',
        version: '1.0.0',
        plugin: {
            connected: plugin.connected && !plugin.stale,
            lastSeen: plugin.lastSeen
        },
        uptime: process.uptime()
    });
});

// Start server
app.listen(config.port, () => {
    console.log(`\n🚀 Roblox AI Builder Bridge Server`);
    console.log(`   Running on http://localhost:${config.port}`);
    console.log(`   Status: http://localhost:${config.port}/api/status\n`);
});

module.exports = app;

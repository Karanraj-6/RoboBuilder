/**
 * Model routes — list available LLM models
 */
const express = require('express');
const router = express.Router();
const agentPool = require('../agent/agentPool');

router.get('/models', (req, res) => {
    res.json({ models: agentPool.getModels() });
});

module.exports = router;

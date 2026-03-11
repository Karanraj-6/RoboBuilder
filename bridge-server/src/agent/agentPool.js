/**
 * Agent Pool — manages Single Agent instances
 */
const { v4: uuid } = require('uuid');
const AgentRuntime = require('./runtime');
const LLMProvider = require('./providers');
const config = require('../config');

class AgentPool {
    constructor() {
        this.agents = new Map();
        this.llmProvider = new LLMProvider(config);
    }

    create(name) {
        const id = uuid();
        const agent = new AgentRuntime(id, this.llmProvider, config);
        agent.name = name || `Agent ${this.agents.size + 1}`;
        this.agents.set(id, agent);
        return agent;
    }

    get(agentId) {
        return this.agents.get(agentId);
    }

    getAny(agentId) {
        return this.agents.get(agentId);
    }

    getAll() {
        return Array.from(this.agents.values()).map(a => ({
            id: a.id,
            name: a.name,
            type: 'agent',
            ...a.getStatus()
        }));
    }

    remove(agentId) {
        const agent = this.agents.get(agentId);
        if (agent) {
            agent.stop();
            this.agents.delete(agentId);
            return true;
        }
        return false;
    }

    pauseAll() {
        this.agents.forEach(a => a.pause());
    }

    stopAll() {
        this.agents.forEach(a => a.stop());
    }

    updateProjectState(state) {
        this.agents.forEach(a => a.updateProjectState(state));
    }

    getModels() {
        return this.llmProvider.getAllModels();
    }
}

module.exports = new AgentPool();

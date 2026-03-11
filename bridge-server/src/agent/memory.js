/**
 * Agent Memory — persists conversation history, decisions, and project snapshots
 */
const fs = require('fs');
const path = require('path');

class AgentMemory {
    constructor(agentId, sessionDir) {
        this.agentId = agentId;
        this.sessionDir = sessionDir;
        this.conversation = [];
        this.decisions = [];
        this.projectSnapshots = [];
        this.currentPlan = null;
        this.completedSteps = [];
        this.metadata = {
            createdAt: Date.now(),
            lastUpdated: Date.now(),
            totalTokensUsed: 0
        };
    }

    addMessage(role, content) {
        this.conversation.push({
            role,
            content,
            timestamp: Date.now()
        });
        this.metadata.lastUpdated = Date.now();
    }

    addDecision(step, decision, reasoning) {
        this.decisions.push({
            step,
            decision,
            reasoning,
            timestamp: Date.now()
        });
    }

    setPlan(plan) {
        this.currentPlan = plan;
    }

    completeStep(stepIndex, result) {
        this.completedSteps.push({
            stepIndex,
            result,
            timestamp: Date.now()
        });
    }

    addProjectSnapshot(state) {
        this.projectSnapshots.push({
            state,
            timestamp: Date.now()
        });
        // Keep only last 5 snapshots to save memory
        if (this.projectSnapshots.length > 5) {
            this.projectSnapshots = this.projectSnapshots.slice(-5);
        }
    }

    trackTokens(inputTokens, outputTokens) {
        this.metadata.totalTokensUsed += inputTokens + outputTokens;
    }

    getContextMessages(maxMessages = 20) {
        // Return recent conversation for LLM context
        return this.conversation.slice(-maxMessages);
    }

    getProgressSummary() {
        const total = this.currentPlan?.steps?.length || 0;
        const completed = this.completedSteps.length;
        return {
            total,
            completed,
            percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
            currentStep: completed < total ? completed : null
        };
    }

    // Persist to disk
    async save() {
        const dir = path.join(this.sessionDir, this.agentId);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const data = {
            agentId: this.agentId,
            conversation: this.conversation,
            decisions: this.decisions,
            currentPlan: this.currentPlan,
            completedSteps: this.completedSteps,
            metadata: this.metadata
        };

        fs.writeFileSync(
            path.join(dir, 'memory.json'),
            JSON.stringify(data, null, 2)
        );
    }

    // Load from disk
    static load(agentId, sessionDir) {
        const filePath = path.join(sessionDir, agentId, 'memory.json');
        if (!fs.existsSync(filePath)) return null;

        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const memory = new AgentMemory(agentId, sessionDir);
        Object.assign(memory, data);
        return memory;
    }
}

module.exports = AgentMemory;

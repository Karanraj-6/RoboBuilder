const { v4: uuid } = require('uuid');

class CommandQueue {
    constructor() {
        this.commands = new Map();
        this.pending = [];
    }

    enqueue(agentId, type, payload) {
        const cmd = {
            id: uuid(),
            agentId,
            type,
            payload,
            status: 'pending',
            result: null,
            createdAt: Date.now(),
            completedAt: null
        };
        this.commands.set(cmd.id, cmd);
        this.pending.push(cmd.id);
        return cmd;
    }

    enqueueBatch(agentId, commands) {
        return commands.map(c => this.enqueue(agentId, c.type, c.payload));
    }

    dequeue(limit = 5) {
        const batch = [];
        while (batch.length < limit && this.pending.length > 0) {
            const id = this.pending.shift();
            const cmd = this.commands.get(id);
            if (cmd && cmd.status === 'pending') {
                cmd.status = 'sent';
                batch.push(cmd);
            }
        }
        return batch;
    }

    reportResult(commandId, success, result, error) {
        const cmd = this.commands.get(commandId);
        if (!cmd) return null;
        cmd.status = success ? 'completed' : 'failed';
        cmd.result = result;
        cmd.error = error;
        cmd.completedAt = Date.now();
        return cmd;
    }

    getByAgent(agentId) {
        return Array.from(this.commands.values()).filter(c => c.agentId === agentId);
    }

    getPending(agentId) {
        return Array.from(this.commands.values()).filter(
            c => c.agentId === agentId && (c.status === 'pending' || c.status === 'sent')
        );
    }

    getCompleted(agentId) {
        return Array.from(this.commands.values()).filter(
            c => c.agentId === agentId && (c.status === 'completed' || c.status === 'failed')
        );
    }

    clear() {
        this.commands.clear();
        this.pending = [];
    }
}

// Singleton
const commandQueue = new CommandQueue();
module.exports = commandQueue;

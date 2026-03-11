/**
 * Lock Manager — workspace area locking for multi-agent conflict prevention
 * 
 * Only locks SPECIFIC sub-paths (e.g., "Workspace.PlaneModel", "Workspace.Buildings")
 * Top-level services (Workspace, ServerScriptService, etc.) are NEVER locked
 * because they are shared resources.
 */

const TOP_LEVEL_SERVICES = new Set([
    'Workspace', 'ServerScriptService', 'ReplicatedStorage',
    'StarterGui', 'StarterPlayer', 'Lighting',
    'SoundService', 'Teams', 'ServerStorage'
]);

class LockManager {
    constructor() {
        this.locks = new Map(); // area -> agentId
    }

    /**
     * Try to acquire a lock on a workspace area for an agent.
     * Top-level services are never locked (shared resources).
     * @returns {boolean} true if lock acquired (or area is too broad to lock), false if conflict
     */
    acquire(area, agentId) {
        // Never lock top-level services — they are shared
        if (!area || TOP_LEVEL_SERVICES.has(area)) {
            return true;
        }

        const existing = this.locks.get(area);
        if (existing && existing !== agentId) {
            return false; // Another agent holds this lock
        }
        this.locks.set(area, agentId);
        return true;
    }

    isLocked(area, requestingAgentId) {
        if (!area || TOP_LEVEL_SERVICES.has(area)) return false;
        const holder = this.locks.get(area);
        return holder && holder !== requestingAgentId;
    }

    getHolder(area) {
        return this.locks.get(area) || null;
    }

    releaseAll(agentId) {
        for (const [area, holder] of this.locks.entries()) {
            if (holder === agentId) {
                this.locks.delete(area);
            }
        }
    }

    release(area, agentId) {
        if (!area || TOP_LEVEL_SERVICES.has(area)) return true;
        const holder = this.locks.get(area);
        if (holder === agentId) {
            this.locks.delete(area);
            return true;
        }
        return false;
    }

    getAllLocks() {
        const result = {};
        for (const [area, agentId] of this.locks.entries()) {
            result[area] = agentId;
        }
        return result;
    }

    checkCommandConflict(command, agentId) {
        const area = this._getCommandArea(command);
        if (!area || TOP_LEVEL_SERVICES.has(area)) return { conflict: false };

        if (this.isLocked(area, agentId)) {
            return {
                conflict: true,
                area,
                holder: this.getHolder(area)
            };
        }
        return { conflict: false };
    }

    _getCommandArea(command) {
        if (!command.payload) return null;
        const path = command.payload.parent || command.payload.path || '';
        const parts = path.split('.');
        // Lock at 2 levels deep: e.g., "Workspace.Map" or "ServerScriptService.Weapons"
        // But NOT just "Workspace" alone
        if (parts.length < 2) return null; // Too broad to lock
        return parts.slice(0, 2).join('.');
    }
}

module.exports = new LockManager();

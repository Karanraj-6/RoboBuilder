/**
 * Central State Manager (V2)
 * Maintains the master project tree and enforces version control on instance generation/edits.
 * Prevents race conditions by rejecting patches against outdated versions.
 */

class StateManager {
    constructor() {
        this.projectState = {};
        this.versions = new Map(); // path -> version number
        this.symbolMap = {}; // path -> parsed symbols (functions, vars)
    }

    /**
     * Updates the full project state coming from Roblox Studio
     * Automatically increments versions for changed scripts/instances
     */
    updateProjectState(newState) {
        this._traverseAndVersion(newState, '');
        this.projectState = newState;
    }

    /**
     * Recursively traverses the state tree to update version numbers
     */
    _traverseAndVersion(node, currentPath) {
        if (!node || typeof node !== 'object') return;

        for (const [key, value] of Object.entries(node)) {
            if (key.startsWith('_')) continue; // Skip metadata keys

            const path = currentPath ? `${currentPath}.${key}` : key;
            const existingNode = this._getNodeAtPath(this.projectState, path);

            // If it's a script and source changed, bump version
            if (value && typeof value === 'object' && value._source !== undefined) {
                if (!existingNode || existingNode._source !== value._source) {
                    const currentVersion = this.versions.get(path) || 0;
                    this.versions.set(path, currentVersion + 1);
                }
            } else if (!existingNode) {
                // New instance
                this.versions.set(path, 1);
            }

            this._traverseAndVersion(value, path);
        }
    }

    _getNodeAtPath(state, path) {
        if (!path) return state;
        const parts = path.split('.');
        let current = state;
        for (const part of parts) {
            if (!current || typeof current !== 'object') return null;
            current = current[part];
        }
        return current;
    }

    /**
     * Gets the current version of an instance script
     */
    getVersion(path) {
        if (!path) return 0;
        return this.versions.get(path) || 0;
    }

    /**
     * Validates if a proposed edit is based on the latest version.
     * Returns { valid: boolean, currentVersion: number, message: string }
     */
    validatePatch(path, targetVersion) {
        const currentVersion = this.getVersion(path);

        // If targetVersion is not provided, we assume v0 (initial creation)
        const target = targetVersion || 0;

        if (target !== currentVersion) {
            console.warn(`[StateManager] Version mismatch on ${path}. Worker targeted v${target}, file is v${currentVersion}.`);
            return { valid: false, currentVersion, message: `Version mismatch (target v${target}, current v${currentVersion})` };
        }

        return { valid: true, currentVersion };
    }

    /**
     * Get isolated state subset (e.g., just Workspace) for specific workers
     */
    getSubState(basePath) {
        return this._getNodeAtPath(this.projectState, basePath) || {};
    }

    /**
     * Stores parsed symbols (functions, vars) for the code analyzer
     */
    updateSymbols(path, symbols) {
        this.symbolMap[path] = symbols;
    }

    getSymbolMap() {
        return this.symbolMap;
    }
}

// Singleton for the bridge server
module.exports = new StateManager();

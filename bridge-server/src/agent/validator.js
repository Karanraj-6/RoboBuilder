/**
 * Command Validator — validates commands before execution, enforces sandbox rules
 */

const VALID_COMMAND_TYPES = [
    'create_instance', 'set_properties', 'delete_instance',
    'insert_script', 'patch_script', 'update_script',
    'create_ui', 'move_instance', 'clone_instance',
    'generate_asset', 'import_user_asset', 'export_state',
    'snapshot', 'rollback', 'batch', 'insert_free_model', 'fetch_explorer_state', 'search_catalog'
];

const VALID_PARENTS = [
    'Workspace', 'ServerScriptService', 'ReplicatedStorage',
    'StarterGui', 'StarterPlayer', 'StarterPlayer.StarterPlayerScripts',
    'StarterPlayer.StarterCharacterScripts', 'Lighting',
    'SoundService', 'Teams', 'ServerStorage'
];

class Validator {
    _isPlaceholderScript(source) {
        if (typeof source !== 'string') return true;
        const trimmed = source.trim();
        if (trimmed.length === 0) return true;
        return /^print\s*\(\s*["']hello world!?["']\s*\)\s*;?\s*$/i.test(trimmed);
    }

    validate(command) {
        const errors = [];

        // Check command type
        if (!VALID_COMMAND_TYPES.includes(command.type)) {
            errors.push(`Invalid command type: ${command.type}`);
        }

        // Check payload exists
        if (!command.payload && !['export_state', 'snapshot'].includes(command.type)) {
            errors.push('Missing payload');
        }

        // Type-specific validation + auto-repair
        if (command.payload) {
            switch (command.type) {
                case 'create_instance':
                    if (!command.payload.className) errors.push('create_instance requires className');
                    if (!command.payload.parent) {
                        // Auto-repair: default parent to Workspace
                        command.payload.parent = 'Workspace';
                    }
                    break;

                case 'insert_free_model':
                    if (!command.payload.searchQuery && !command.payload.assetId) errors.push('insert_free_model requires a searchQuery or assetId');
                    if (!command.payload.parent) {
                        command.payload.parent = 'Workspace';
                    }
                    break;
                
                case 'search_catalog':
                    if (!command.payload.searchQuery) errors.push('search_catalog requires a searchQuery');
                    break;

                case 'fetch_explorer_state':
                    // This is a pseudo-command handled entirely by the backend, no payload strictly required
                    break;


                case 'insert_script':
                    if (!command.payload.source && command.payload.source !== '') errors.push('insert_script requires source');
                    if (this._isPlaceholderScript(command.payload.source)) {
                        errors.push('insert_script source is placeholder/empty. Provide real gameplay logic.');
                    }
                    if (!command.payload.parent) {
                        // Auto-repair: default based on script type
                        const cls = command.payload.className || 'Script';
                        if (cls === 'LocalScript') {
                            command.payload.parent = 'StarterPlayer.StarterPlayerScripts';
                        } else if (cls === 'ModuleScript') {
                            command.payload.parent = 'ReplicatedStorage';
                        } else {
                            command.payload.parent = 'ServerScriptService';
                        }
                    }
                    break;

                case 'create_ui':
                    if (!command.payload.parent) {
                        command.payload.parent = 'StarterGui';
                    }
                    break;

                case 'patch_script':
                    if (!command.payload.path) errors.push('patch_script requires path');
                    if (!command.payload.patches || !Array.isArray(command.payload.patches)) {
                        errors.push('patch_script requires patches array');
                    } else {
                        for (const patch of command.payload.patches) {
                            if (patch && typeof patch.content === 'string' && this._isPlaceholderScript(patch.content)) {
                                errors.push('patch_script contains placeholder/empty content. Provide real gameplay logic.');
                                break;
                            }
                        }
                    }
                    break;

                case 'delete_instance':
                    if (!command.payload.path) errors.push('delete_instance requires path');
                    // Prevent deleting top-level services
                    if (VALID_PARENTS.includes(command.payload.path)) {
                        errors.push(`Cannot delete top-level service: ${command.payload.path}`);
                    }
                    break;

                case 'set_properties':
                    if (!command.payload.path) errors.push('set_properties requires path');
                    if (!command.payload.properties) errors.push('set_properties requires properties');
                    break;

                case 'update_script':
                    if (!command.payload.path) errors.push('update_script requires path');
                    if (command.payload.source === undefined) errors.push('update_script requires source');
                    if (this._isPlaceholderScript(command.payload.source)) {
                        errors.push('update_script source is placeholder/empty. Provide real gameplay logic.');
                    }
                    break;

                case 'move_instance':
                    if (!command.payload.path) errors.push('move_instance requires path');
                    if (!command.payload.newParent) errors.push('move_instance requires newParent');
                    break;

                case 'clone_instance':
                    if (!command.payload.path) errors.push('clone_instance requires path');
                    break;
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    validateBatch(commands) {
        const results = commands.map((cmd, i) => ({
            index: i,
            ...this.validate(cmd)
        }));

        return {
            valid: results.every(r => r.valid),
            results
        };
    }
}

module.exports = new Validator();

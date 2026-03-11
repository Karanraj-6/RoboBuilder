/**
 * Code Understanding Agent / Code Analyzer
 * Continuously parses script sources from the StateManager to build a Symbol Map.
 * Provides a high-level overview of the codebase to AI workers.
 */

class CodeAnalyzer {
    constructor(stateManager) {
        this.state = stateManager;
        this.physicalInstances = {}; // Track non-script objects like Parts, Models, UIs
    }

    /**
     * Trigger a full project analysis
     */
    analyzeProject() {
        // Reset the old maps
        Object.keys(this.state.symbolMap).forEach(k => delete this.state.symbolMap[k]);
        this.physicalInstances = {};

        const tree = this.state.projectState;
        this._traverseAndAnalyze(tree, '');

        // The symbol map and physical instances are updated directly in _traverseAndAnalyze
        // No need for a separate loop here.
    }

    _traverseAndAnalyze(node, currentPath) {
        if (!node || typeof node !== 'object') return;

        for (const [key, value] of Object.entries(node)) {
            if (key.startsWith('_')) continue;

            const path = currentPath ? `${currentPath}.${key}` : key;

            // If it's a script, parse it
            if (value && typeof value === 'object' && value._source !== undefined) {
                const symbols = this._extractSymbols(value._source);
                this.state.updateSymbols(path, symbols);
            }
            // If it's a physical instance (Part, Model, UI) and NOT a service (services usually don't have dots in their top-level path)
            else if (value && typeof value === 'object' && value._class && path.includes('.')) {
                // Record basic properties for the evaluator to see
                this.physicalInstances[path] = {
                    className: value._class,
                    properties: value._properties || {}
                };
            }

            this._traverseAndAnalyze(value, path);
        }
    }

    /**
     * Very basic regex-based symbol extractor for Lua.
     * In a production environment, you'd use a real Lua parser (like luaparse).
     */
    _extractSymbols(source) {
        const result = {
            functions: [],
            variables: [],
            events: []
        };

        if (!source || typeof source !== 'string') return result;

        const lines = source.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Extract functions: function foo(a,b) or local function bar()
            const funcMatch = line.match(/^(?:local\s+)?function\s+([a-zA-Z0-9_\.:]+)\s*\((.*?)\)/);
            if (funcMatch) {
                result.functions.push({
                    name: funcMatch[1],
                    args: funcMatch[2],
                    line: i + 1
                });
            }

            // Extract events: Instance.Event:Connect(function()
            const eventMatch = line.match(/([a-zA-Z0-9_]+)\.(?:[a-zA-Z0-9_]+)\:Connect/);
            if (eventMatch) {
                result.events.push({
                    listener: eventMatch[0],
                    line: i + 1
                });
            }

            // Extract Top-level Variables (rough heuristic)
            if (line.startsWith('local ') && line.includes('=') && !line.includes('function')) {
                const varName = line.split('=')[0].replace('local ', '').trim();
                result.variables.push({
                    name: varName,
                    line: i + 1
                });
            }
        }

        return result;
    }

    /**
     * Generate a text summary of the codebase for AI context
     */
    generateContextSummary(maxPhysicalInstances = 150) {
        const symbols = this.state.getSymbolMap();
        let summary = 'CODEBASE SYMBOL MAP:\n';

        for (const [path, data] of Object.entries(symbols)) {
            if (data.functions.length === 0 && data.variables.length === 0) continue;

            summary += `\n[ ${path} ]\n`;
            if (data.functions.length > 0) {
                summary += '  Functions:\n';
                data.functions.slice(0, 10).forEach(f => {
                    summary += `    - ${f.name}(${f.args}) (Line ${f.line})\n`;
                });
                if (data.functions.length > 10) summary += '    - ... (more functions truncated)\n';
            }
            if (data.events.length > 0) {
                summary += '  Events:\n';
                data.events.slice(0, 5).forEach(e => {
                    summary += `    - ${e.listener}\n`;
                });
                if (data.events.length > 5) summary += '    - ... (more events truncated)\n';
            }
        }

        const physicalKeys = Object.keys(this.physicalInstances);
        if (physicalKeys.length > 0) {
            summary += '\n--- PHYSICAL INSTANCES IN WORLD (TRUNCATED HIERARCHY) ---\n';
            
            // PRIORITY: List all Folders and Models first as they define the structure
            const structural = physicalKeys.filter(p => this.physicalInstances[p].className === 'Model' || this.physicalInstances[p].className === 'Folder');
            const parts = physicalKeys.filter(p => !structural.includes(p));

            // Only show a limited number of instances to avoid context overflow
            const list = structural.concat(parts).slice(0, maxPhysicalInstances);

            for (const path of list) {
                const item = this.physicalInstances[path];
                const version = this.state.getVersion(path);
                const versionStr = version ? ` [v${version}]` : '';
                
                // Show ONLY vital properties for scale/positioning
                const props = item.properties;
                const pos = props.Position ? ` Pos:[${props.Position.map(n => Math.round(n)).join(',')}]` : '';
                const size = props.Size ? ` Size:[${props.Size.map(n => Math.round(n)).join(',')}]` : '';

                summary += `- ${path} (${item.className})${versionStr}${pos}${size}\n`;
            }
            
            if (physicalKeys.length > maxPhysicalInstances) {
                summary += `\n... (Total ${physicalKeys.length} items. Showing first ${maxPhysicalInstances}. Use fetch_explorer_state to refresh if needed.)\n`;
            }
        }

        return summary;
    }
}

module.exports = CodeAnalyzer;

/**
 * WorkerAgent — Autonomous sub-agent that handles a specific domain of work
 * Created by MasterAgent based on domain decomposition
 * 
 * Each worker has its own:
 * - Domain assignment (e.g., "Roads & Infrastructure", "Buildings", "Vehicles")
 * - Step list (subset of the master plan relevant to this domain)
 * - Execution state
 * - LLM access for retries and fallback-to-primitives
 */

const { v4: uuid } = require('uuid');
const commandQueue = require('../queue/commandQueue');
const stateManager = require('./stateManager');
const lockManager = require('./lockManager');
const assetCatalog = require('./assetCatalog');
const placementEngine = require('./placementEngine');
const validator = require('./validator');
const LLMProvider = require('./providers');

const WORKER_FALLBACK_PROMPT = `You are a Roblox Studio builder assistant. A 3D model search FAILED — the Toolbox returned 0 results for the query.

Your job: BUILD the object using PRIMITIVE Roblox Parts instead. Create a simplified version using multiple BaseParts (Part, WedgePart, etc.) with appropriate sizes, colors, and materials.

FAILED SEARCH: "{{SEARCH_QUERY}}"
INTENDED NAME: "{{OBJECT_NAME}}"
INTENDED POSITION: {{POSITION}}

Create a believable low-poly version. For example:
- "police car" → 3 Parts: body (blue, 12x5x6), roof (white, 6x2x4), wheels (black cylinders)
- "oak tree" → 2 Parts: trunk (brown cylinder, 2x8x2), canopy (green sphere-ish, 10x8x10)
- "street light" → 2 Parts: pole (gray, 1x12x1), lamp (yellow, 3x1x3 with PointLight)

Respond with ONLY a JSON array of create_instance commands:
[
  {
    "type": "create_instance",
    "payload": {
      "className": "Part",
      "parent": "Workspace",
      "name": "PartName",
      "properties": {
        "Size": [X, Y, Z],
        "Position": [X, Y, Z],
        "Anchored": true,
        "Material": "SmoothPlastic",
        "Color": [R, G, B],
        "Shape": "Block"
      }
    }
  }
]

Group them inside a Model if multiple parts. Output ONLY JSON.`;

class WorkerAgent {
    constructor(masterId, domain, modelId, apiKeys) {
        this.id = uuid();
        this.masterId = masterId;
        this.domain = domain; // { name: "Roads", description: "...", stepIds: [1,2,3] }
        this.modelId = modelId;
        this.apiKeys = apiKeys;
        this.llm = new LLMProvider();

        this.steps = [];
        this.status = 'idle'; // idle, executing, complete, error
        this._running = false;
        this._currentStepIndex = 0;
        this.activityLog = [];
        this.completedSteps = 0;
        this.failedSteps = 0;
        this._spatialMap = [];
    }

    log(type, message, data = null) {
        const entry = {
            id: uuid(),
            type,
            message: `[${this.domain.name}] ${message}`,
            timestamp: Date.now(),
            workerRole: this.domain.name,
            data
        };
        this.activityLog.push(entry);
        console.log(`[Worker:${this.domain.name}] ${message}`);
    }

    /**
     * Assign steps to this worker
     */
    assignSteps(steps) {
        this.steps = steps.map(s => ({ ...s }));
        this.log('info', `Assigned ${steps.length} steps`);
    }

    /**
     * Execute all assigned steps
     */
    async execute(onStepComplete) {
        this.status = 'executing';
        this._running = true;
        this._currentStepIndex = 0;

        this.log('info', `Starting execution of ${this.steps.length} steps`);

        // Acquire domain lock
        const lockAcquired = lockManager.acquireLock(this.id, this.domain.name);
        if (!lockAcquired) {
            this.log('warning', `Could not acquire lock for domain "${this.domain.name}", executing anyway`);
        }

        for (let i = 0; i < this.steps.length && this._running; i++) {
            const step = this.steps[i];
            this._currentStepIndex = i;
            const stepNum = step.id || (i + 1);

            this.log('info', `Step ${stepNum}/${this.steps.length}: ${step.name || step.action} — ${step.searchQuery || step.className || ''}`);

            let success = false;

            try {
                switch (step.action) {
                    case 'create_part':
                        success = await this._executeCreatePart(step, stepNum);
                        break;
                    case 'insert_model':
                        success = await this._executeInsertModel(step, stepNum);
                        break;
                    case 'insert_script':
                        success = await this._executeInsertScript(step, stepNum);
                        break;
                    case 'create_instance':
                        success = await this._executeCreateInstance(step, stepNum);
                        break;
                    case 'set_lighting':
                        success = await this._executeSetLighting(step, stepNum);
                        break;
                    case 'create_effect':
                        success = await this._executeCreateEffect(step, stepNum);
                        break;
                    case 'create_ui':
                        success = await this._executeCreateUI(step, stepNum);
                        break;
                    case 'clone_instance':
                        success = await this._executeCloneInstance(step, stepNum);
                        break;
                    case 'delete_instance':
                        success = await this._executeDeleteInstance(step, stepNum);
                        break;
                    case 'set_properties':
                        success = await this._executeSetProperties(step, stepNum);
                        break;
                    default:
                        this.log('warning', `Unknown action "${step.action}", skipping`);
                        success = true;
                }
            } catch (err) {
                this.log('error', `Step ${stepNum} error: ${err.message}`);
            }

            if (success) {
                this.completedSteps++;
                this.log('result', `Step ${stepNum} completed ✓`);
            } else {
                this.failedSteps++;
                this.log('error', `Step ${stepNum} failed`);
            }

            if (onStepComplete) {
                onStepComplete(this.id, stepNum, success);
            }
        }

        // Release lock
        lockManager.releaseLock(this.id);

        this.status = 'complete';
        this._running = false;
        this.log('complete', `Finished: ${this.completedSteps} succeeded, ${this.failedSteps} failed out of ${this.steps.length}`);

        return {
            completed: this.completedSteps,
            failed: this.failedSteps,
            total: this.steps.length
        };
    }

    stop() {
        this._running = false;
        this.status = 'stopped';
    }

    // ================================================================
    // Step execution methods (similar to AgentRuntime but with fallback)
    // ================================================================

    async _executeCreatePart(step, stepNum) {
        const cmd = {
            type: 'create_instance',
            payload: {
                className: step.className || 'Part',
                parent: step.parent || 'Workspace',
                name: step.name || `Part_${stepNum}`,
                properties: step.properties || {}
            }
        };

        // Use placement engine for collision-aware positioning
        if (cmd.payload.properties.Position && cmd.payload.properties.Size) {
            const pos = cmd.payload.properties.Position;
            const size = cmd.payload.properties.Size;
            const worldInfo = placementEngine.getWorldInfo(stateManager.projectState);
            const placement = placementEngine.computePlacement(size, pos, worldInfo.occupied, worldInfo.groundY, worldInfo.bounds);
            cmd.payload.properties.Position = placement.position;
        }

        const validation = validator.validate(cmd);
        if (!validation.valid) {
            this.log('error', `Validation failed: ${validation.errors.join(', ')}`);
            return false;
        }

        this.log('info', `Creating part: "${cmd.payload.name}"`, cmd);
        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);

        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') {
            this.log('error', `Create part failed: ${result.error}`);
            return false;
        }

        await this._refreshState();
        return true;
    }

    async _executeInsertModel(step, stepNum) {
        // Resolve asset ID from searchQuery
        let assetId = step.assetId;
        if (!assetId && step.searchQuery) {
            try {
                const asset = await assetCatalog.getBestAsset(step.searchQuery);
                if (asset && asset.id) {
                    assetId = asset.id;
                    this.log('info', `Resolved "${step.searchQuery}" → Asset ${assetId}`);
                }
            } catch (e) {
                this.log('warning', `Asset search failed for "${step.searchQuery}": ${e.message}`);
            }
        }

        // FALLBACK: If no model found, build with primitives
        if (!assetId) {
            this.log('warning', `No model found for "${step.searchQuery}". Falling back to primitive build.`);
            return await this._fallbackToPrimitives(step, stepNum);
        }

        const cmd = {
            type: 'insert_free_model',
            payload: {
                assetId,
                parent: step.parent || 'Workspace',
                name: step.name || `Model_${stepNum}`,
                position: step.position || [0, 0.5, 0]
            }
        };

        // Use placement engine for collision-aware positioning
        const worldInfo = placementEngine.getWorldInfo(stateManager.projectState);
        const placement = placementEngine.computePlacement(
            [10, 10, 10], // default size estimate until we get real bounds
            cmd.payload.position,
            worldInfo.occupied,
            worldInfo.groundY,
            worldInfo.bounds
        );
        cmd.payload.position = placement.position;

        this.log('info', `Inserting model: "${cmd.payload.name}" (Asset ${assetId})`, cmd);
        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);

        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') {
            this.log('warning', `Model insert failed: ${result.error}. Trying primitive fallback.`);
            return await this._fallbackToPrimitives(step, stepNum);
        }

        // Parse bounds from result to update spatial map
        if (result.result) {
            const boundsMatch = result.result.match(/\|BOUNDS:(\{.*?\})/);
            if (boundsMatch) {
                try {
                    const bounds = JSON.parse(boundsMatch[1]);
                    this._spatialMap.push({
                        name: step.name,
                        position: bounds.position,
                        size: bounds.size
                    });
                } catch (e) { /* ignore parse errors */ }
            }
        }

        await this._refreshState();
        return true;
    }

    /**
     * Fallback: Ask LLM to build the object using primitive Parts
     */
    async _fallbackToPrimitives(step, stepNum) {
        this.log('info', `Building "${step.name || step.searchQuery}" from primitives...`);

        try {
            const prompt = WORKER_FALLBACK_PROMPT
                .replace('{{SEARCH_QUERY}}', step.searchQuery || step.name || 'unknown')
                .replace('{{OBJECT_NAME}}', step.name || `Primitive_${stepNum}`)
                .replace('{{POSITION}}', JSON.stringify(step.position || [0, 0.5, 0]));

            const messages = [
                { role: 'system', content: prompt },
                { role: 'user', content: 'Build this object using primitive Parts. Output ONLY JSON.' }
            ];

            const response = await this.llm.chat(this.modelId, messages, { apiKeys: this.apiKeys });
            const jsonStr = this._extractJsonFromResponse(response.content);
            const commands = JSON.parse(jsonStr);

            if (!Array.isArray(commands) || commands.length === 0) {
                this.log('error', 'Primitive fallback returned no commands');
                return false;
            }

            // Wrap in a Model container
            const modelCmd = {
                type: 'create_instance',
                payload: {
                    className: 'Model',
                    parent: 'Workspace',
                    name: step.name || `Primitive_${stepNum}`,
                    properties: {}
                }
            };
            const modelEnqueued = commandQueue.enqueue(this.id, modelCmd.type, modelCmd.payload);
            await this._waitForCommands([modelEnqueued.id]);

            // Execute each part command
            for (const cmd of commands) {
                if (cmd.type === 'create_instance' && cmd.payload) {
                    cmd.payload.parent = `Workspace.${step.name || `Primitive_${stepNum}`}`;
                    const validation = validator.validate(cmd);
                    if (!validation.valid) continue;

                    const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
                    await this._waitForCommands([enqueued.id]);
                }
            }

            await this._refreshState();
            this.log('info', `Built primitive "${step.name || step.searchQuery}" with ${commands.length} parts`);
            return true;

        } catch (e) {
            this.log('error', `Primitive fallback failed: ${e.message}`);
            return false;
        }
    }

    async _executeInsertScript(step, stepNum) {
        const cmd = {
            type: 'insert_script',
            payload: {
                name: step.name || `Script_${stepNum}`,
                parent: step.parent || 'ServerScriptService',
                source: step.source || '',
                className: step.className || 'Script'
            }
        };
        const validation = validator.validate(cmd);
        if (!validation.valid) {
            this.log('error', `Validation failed: ${validation.errors.join(', ')}`);
            return false;
        }
        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);
        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') {
            this.log('error', `Script insert failed: ${result.error}`);
            return false;
        }
        await this._refreshState();
        return true;
    }

    async _executeCreateInstance(step, stepNum) {
        const cmd = {
            type: 'create_instance',
            payload: {
                className: step.className || 'Part',
                parent: step.parent || 'Workspace',
                name: step.name || `${step.className}_${stepNum}`,
                properties: step.properties || {}
            }
        };
        const validation = validator.validate(cmd);
        if (!validation.valid) return false;
        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);
        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') return false;
        await this._refreshState();
        return true;
    }

    async _executeSetLighting(step) {
        const cmd = {
            type: 'set_properties',
            payload: { path: 'Lighting', properties: step.properties || {} }
        };
        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);
        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') return false;
        await this._refreshState();
        return true;
    }

    async _executeCreateEffect(step, stepNum) {
        const cmd = {
            type: 'create_instance',
            payload: {
                className: step.className || 'Atmosphere',
                parent: 'Lighting',
                name: step.name || `${step.className}_${stepNum}`,
                properties: step.properties || {}
            }
        };
        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);
        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') return false;
        await this._refreshState();
        return true;
    }

    async _executeCreateUI(step) {
        const cmd = {
            type: 'create_ui',
            payload: { parent: step.parent || 'StarterGui', elements: step.elements || [] }
        };
        if (!cmd.payload.elements.length) return false;
        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);
        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') return false;
        await this._refreshState();
        return true;
    }

    async _executeCloneInstance(step) {
        const cmd = {
            type: 'clone_instance',
            payload: { path: step.path, name: step.name, parent: step.parent }
        };
        if (!cmd.payload.path) return false;
        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);
        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') return false;
        await this._refreshState();
        return true;
    }

    async _executeDeleteInstance(step) {
        const cmd = {
            type: 'delete_instance',
            payload: { path: step.path }
        };
        if (!cmd.payload.path) return false;
        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);
        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') return false;
        await this._refreshState();
        return true;
    }

    async _executeSetProperties(step) {
        if (!step.path || !step.properties) return false;
        const cmd = {
            type: 'set_properties',
            payload: { path: step.path, properties: step.properties }
        };
        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);
        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') return false;
        await this._refreshState();
        return true;
    }

    // ================================================================
    // Helper methods
    // ================================================================

    async _refreshState() {
        try {
            const refreshCmd = commandQueue.enqueue(this.id, 'export_state', {});
            await this._waitForCommands([refreshCmd.id], 10000);
        } catch (e) {
            this.log('warning', 'State refresh failed: ' + e.message);
        }
    }

    async _waitForCommands(commandIds, timeout = 60000) {
        const start = Date.now();
        while (this._running && Date.now() - start < timeout) {
            const allDone = commandIds.every(id => {
                const cmd = commandQueue.commands.get(id);
                return cmd && (cmd.status === 'completed' || cmd.status === 'failed');
            });
            if (allDone) return;
            await new Promise(r => setTimeout(r, 500));
        }
        commandIds.forEach(id => {
            const cmd = commandQueue.commands.get(id);
            if (cmd && (cmd.status === 'sent' || cmd.status === 'pending')) {
                cmd.status = 'failed';
                cmd.error = 'Timeout waiting for plugin response';
            }
        });
    }

    _extractJsonFromResponse(content) {
        if (!content) throw new Error('Empty response from LLM');
        const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenceMatch && fenceMatch[1]) return fenceMatch[1].trim();

        const firstBracket = content.indexOf('[');
        const firstBrace = content.indexOf('{');
        let jsonStart = -1, openChar = '', closeChar = '';

        if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
            jsonStart = firstBracket; openChar = '['; closeChar = ']';
        } else if (firstBrace !== -1) {
            jsonStart = firstBrace; openChar = '{'; closeChar = '}';
        }
        if (jsonStart === -1) throw new Error('Could not extract JSON');

        let depth = 0, inString = false, escape = false;
        for (let i = jsonStart; i < content.length; i++) {
            const ch = content[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === openChar) depth++;
            if (ch === closeChar) depth--;
            if (depth === 0) return content.substring(jsonStart, i + 1);
        }
        throw new Error('Could not extract JSON');
    }

    getStatus() {
        return {
            id: this.id,
            masterId: this.masterId,
            domain: this.domain.name,
            status: this.status,
            steps: this.steps.length,
            completed: this.completedSteps,
            failed: this.failedSteps,
            progress: this.steps.length > 0 ? Math.round((this._currentStepIndex / this.steps.length) * 100) : 0
        };
    }
}

module.exports = WorkerAgent;

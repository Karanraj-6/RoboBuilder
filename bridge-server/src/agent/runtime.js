/**
 * Unified Single Agent Runtime — Deterministic Asset Pipeline
 * 
 * Flow:
 *   1. User prompt → LLM creates SHORT summary → user approves
 *   2. After approval → LLM creates DETAILED plan (each step = 1 asset with position/size)
 *   3. Runtime executes each step DIRECTLY (no LLM per step):
 *      - create_part → send create_instance command → verify
 *      - insert_model → send insert_free_model → refresh state → find real name → position it → verify
 *   4. Only calls LLM again if a step fails and needs adaptation
 */
const { v4: uuid } = require('uuid');
const AgentMemory = require('./memory');
const { PLAN_SUMMARY_PROMPT, DETAILED_PLAN_PROMPT, STEP_RETRY_PROMPT, DENSIFY_PROMPT } = require('../prompts/system');
const stateManager = require('./stateManager');
const commandQueue = require('../queue/commandQueue');
const validator = require('./validator');
const CodeAnalyzer = require('./codeAnalyzer');
const assetCatalog = require('./assetCatalog');
const placementEngine = require('./placementEngine');

class AgentRuntime {
    constructor(agentId, llmProvider, config) {
        this.id = agentId;
        this.llm = llmProvider;
        this.config = config;
        this.memory = new AgentMemory(agentId, config.sessionDir);
        this.modelId = null;
        this.apiKeys = {};
        this.status = 'idle';
        this.activityLog = [];
        this.currentPlan = null;
        this.error = null;
        this._running = false;
        this._currentStepIndex = 0;
    }

    log(type, message, data = null) {
        const entry = {
            id: uuid(),
            agentId: this.id,
            type,
            message,
            data,
            timestamp: Date.now()
        };
        this.activityLog.push(entry);
        return entry;
    }

    // ================================================================
    // PHASE 1: Generate short summary for user approval
    // ================================================================
    async start(prompt, modelId, apiKeys = {}) {
        this.modelId = modelId;
        this.apiKeys = apiKeys;
        this.status = 'planning';
        this._running = true;
        this.error = null;
        this.memory.addMessage('user', prompt);
        this.log('info', `Starting build: "${prompt}"`);

        try {
            this.log('plan', 'Analyzing project and generating plan summary...');

            const analyzer = new CodeAnalyzer(stateManager);
            analyzer.analyzeProject();
            const symbolsContext = analyzer.generateContextSummary(200);

            const messages = [
                { role: 'system', content: PLAN_SUMMARY_PROMPT },
                { role: 'user', content: `USER REQUEST: ${prompt}\n\nCURRENT EXPLORER STATE:\n${symbolsContext}` }
            ];

            const response = await this.llm.chat(this.modelId, messages, { apiKeys: this.apiKeys });
            this.memory.trackTokens(response.usage.inputTokens, response.usage.outputTokens);

            const jsonStr = this._extractJsonFromResponse(response.content);
            const summary = JSON.parse(jsonStr);

            // Store the summary — detailed plan comes after approval
            this.currentPlan = {
                title: summary.title || 'Untitled',
                summary: summary.summary || '',
                items: summary.items || [],
                steps: [] // will be filled after approval
            };
            this.memory.setPlan(this.currentPlan);

            this.log('plan', `Plan: "${summary.title}"\n${summary.summary}\n\nAssets to build:\n${(summary.items || []).map((item, i) => `  ${i + 1}. ${item}`).join('\n')}`);
            this.status = 'awaiting_approval';

            return { status: 'awaiting_approval', plan: this.currentPlan };
        } catch (e) {
            this.status = 'error';
            this.error = e.message;
            this.log('error', `Planning failed: ${e.message}`);
            return { status: 'error', error: e.message };
        }
    }

    // ================================================================
    // PHASE 2: User approved → generate detailed plan → start execution
    // ================================================================
    async approvePlan() {
        if (this.status !== 'awaiting_approval') {
            throw new Error(`Cannot approve plan in status: ${this.status}`);
        }

        this.log('info', 'Plan approved — generating detailed build steps...');
        this.status = 'executing';

        // Generate the detailed plan in background, then execute
        this._buildDetailedPlanAndExecute().catch(e => {
            this.status = 'error';
            this.error = e.message;
            this.log('error', `Execution failed: ${e.message}`);
        });

        return { status: 'executing' };
    }

    async _buildDetailedPlanAndExecute() {
        try {
            // Get fresh explorer state
            const analyzer = new CodeAnalyzer(stateManager);
            analyzer.analyzeProject();
            const symbolsContext = analyzer.generateContextSummary(200);

            // Generate spatial context from PlacementEngine
            const spatialContext = this._generateSpatialContext();

            const summaryText = `Title: ${this.currentPlan.title}\nSummary: ${this.currentPlan.summary}\nItems:\n${this.currentPlan.items.map((item, i) => `${i + 1}. ${item}`).join('\n')}`;

            const detailedPrompt = DETAILED_PLAN_PROMPT
                .replace('{{APPROVED_SUMMARY}}', summaryText)
                .replace('{{SPATIAL_CONTEXT}}', spatialContext);

            const messages = [
                { role: 'system', content: detailedPrompt },
                { role: 'user', content: `Create the detailed build plan for the approved project.\n\nCURRENT EXPLORER STATE:\n${symbolsContext}` }
            ];

            const response = await this.llm.chat(this.modelId, messages, { apiKeys: this.apiKeys });
            this.memory.trackTokens(response.usage.inputTokens, response.usage.outputTokens);

            const jsonStr = this._extractJsonFromResponse(response.content);
            const detailedPlan = JSON.parse(jsonStr);

            if (!detailedPlan.steps || detailedPlan.steps.length === 0) {
                throw new Error('LLM returned a plan with 0 steps');
            }

            this.currentPlan.steps = detailedPlan.steps;
            this.currentPlan.summary = detailedPlan.summary || this.currentPlan.summary;
            this.memory.setPlan(this.currentPlan);

            this.log('plan', `Detailed plan ready: ${detailedPlan.steps.length} build steps.`);

            // Pre-resolve all insert_model steps — convert searchQuery to assetId
            await this._preResolveAssets();

            // Initialize spatial map for tracking placed objects
            this._spatialMap = [];

            // Now execute deterministically
            await this._executeLoop();

            // After initial build: analyze coverage and fill empty areas
            if (this._running && this.status !== 'error') {
                await this._densifyPass();
            }
        } catch (e) {
            this.status = 'error';
            this.error = e.message;
            this.log('error', `Detailed planning failed: ${e.message}`);
        }
    }

    // ----------------------------------------------------------------
    // Generate spatial context from PlacementEngine for the LLM
    // ----------------------------------------------------------------
    _generateSpatialContext() {
        const projectState = stateManager.projectState;
        if (!projectState || !projectState.Workspace) {
            return 'Workspace is empty. Default baseplate: 512x512 at origin. Build area: -240 to +240 on X/Z. Ground_Y = 0.5.';
        }

        const guidance = placementEngine.generateGuidance('city layout', projectState);
        return guidance.text;
    }

    // ----------------------------------------------------------------
    // Pre-resolve all insert_model steps: searchQuery → assetId
    // ----------------------------------------------------------------
    async _preResolveAssets() {
        const steps = this.currentPlan?.steps;
        if (!steps) return;

        let resolved = 0;
        let failed = 0;

        for (const step of steps) {
            if (step.action !== 'insert_model') continue;
            if (step.assetId) continue; // Already has an asset ID
            if (!step.searchQuery) continue;

            try {
                this.log('info', `Pre-resolving asset: "${step.searchQuery}"...`);
                const asset = await assetCatalog.getBestAsset(step.searchQuery);
                if (asset && asset.id) {
                    step.assetId = asset.id;
                    this.log('info', `Resolved "${step.searchQuery}" → assetId ${asset.id} (${asset.name})`);
                    resolved++;
                } else {
                    this.log('warning', `Could not resolve "${step.searchQuery}" from catalog. Will try at execution time.`);
                    failed++;
                }
            } catch (e) {
                this.log('warning', `Pre-resolve error for "${step.searchQuery}": ${e.message}`);
                failed++;
            }
        }

        if (resolved > 0 || failed > 0) {
            this.log('info', `Asset pre-resolution: ${resolved} resolved, ${failed} unresolved.`);
        }
    }

    // ----------------------------------------------------------------
    // Track a placed object in the spatial map
    // ----------------------------------------------------------------
    _trackPlacement(name, position, size) {
        if (!this._spatialMap) this._spatialMap = [];
        this._spatialMap.push({
            name,
            position: position || [0, 0, 0],
            size: size || [8, 8, 8],
            timestamp: Date.now()
        });
    }

    // ================================================================
    // PHASE 3: Deterministic execution — no LLM per step
    // ================================================================
    async _executeLoop() {
        const plan = this.currentPlan;
        if (!plan || !plan.steps) return;

        this._currentStepIndex = 0;

        while (this._running && this._currentStepIndex < plan.steps.length) {
            const step = plan.steps[this._currentStepIndex];
            const stepNum = step.id || (this._currentStepIndex + 1);

            const stepLabel = step.name || step.action;
            const stepDetail = step.action === 'insert_model' ? (step.searchQuery || `assetId:${step.assetId}`) : (step.className || step.action);
            this.log('info', `Step ${stepNum}/${plan.steps.length}: ${stepLabel} — ${stepDetail}`);

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
                    default:
                        this.log('warning', `Step ${stepNum}: Unknown action "${step.action}", skipping.`);
                        success = true;
                }
            } catch (err) {
                this.log('error', `Step ${stepNum} error: ${err.message}`);
            }

            // If direct execution failed, try LLM-assisted retry
            if (!success && this._running) {
                this.log('warning', `Step ${stepNum} failed directly. Trying LLM-assisted retry...`);
                success = await this._llmRetryStep(step, stepNum);
            }

            if (success) {
                this.log('result', `Step ${stepNum} completed ✓`);
            } else {
                this.log('error', `Step ${stepNum} failed after retries. Moving on.`);
            }

            this._currentStepIndex++;
            await this.memory.save();
        }

        this.status = 'complete';
        this.log('complete', `Build finished! ${plan.steps.length} steps processed.`);
    }

    // ----------------------------------------------------------------
    // Execute a create_part step with collision-aware placement
    // ----------------------------------------------------------------
    async _executeCreatePart(step, stepNum) {
        const props = step.properties ? { ...step.properties } : {};
        const partName = step.name || `Part_${stepNum}`;

        // Ensure anchored by default
        if (props.Anchored === undefined) {
            props.Anchored = true;
        }

        // --- Collision-aware position adjustment for non-ground/non-road large parts ---
        const size = props.Size || [4, 1, 2];
        const pos = props.Position || [0, 0.5, 0];
        const isLargeFlat = (size[0] >= 100 || size[2] >= 100) && size[1] <= 2;
        const nameL = partName.toLowerCase();
        const isGround = nameL.includes('ground') || nameL.includes('baseplate') || nameL.includes('terrain');
        const isRoad = nameL.includes('road') || nameL.includes('street') || nameL.includes('sidewalk') || nameL.includes('path');

        // Only do collision check for non-ground non-road parts (buildings, walls, etc.)
        if (!isGround && !isRoad && !isLargeFlat) {
            const worldInfo = placementEngine.getWorldInfo(stateManager.projectState);
            const placement = placementEngine.computePlacement(
                size, pos, worldInfo.occupied, worldInfo.groundY, worldInfo.bounds
            );
            if (placement.adjusted) {
                this.log('info', `Adjusted position for "${partName}": ${placement.reason}`);
            }
            props.Position = placement.position;
        } else if (!isGround) {
            // For roads/sidewalks — just fix Y to sit on ground correctly
            const worldInfo = placementEngine.getWorldInfo(stateManager.projectState);
            const correctY = worldInfo.groundY + (size[1] / 2);
            props.Position = [pos[0], correctY, pos[2]];
        }

        const cmd = {
            type: 'create_instance',
            payload: {
                className: step.className || 'Part',
                parent: step.parent || 'Workspace',
                name: partName,
                properties: props
            }
        };

        const validation = validator.validate(cmd);
        if (!validation.valid) {
            this.log('error', `Step ${stepNum}: Validation failed: ${validation.errors.join(', ')}`);
            return false;
        }

        this.log('info', `Creating ${cmd.payload.className}: "${partName}" at [${props.Position ? props.Position.join(', ') : 'default'}]`, cmd);

        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);

        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') {
            this.log('error', `Create failed: ${result.error}`);
            return false;
        }

        // Refresh state
        await this._refreshState();

        // Track in spatial map with actual position
        if (props.Position) {
            this._trackPlacement(partName, props.Position, size);
        }

        return true;
    }

    // ----------------------------------------------------------------
    // Execute an insert_model step: SMART PLACEMENT LOOP
    // 1. Insert model into workspace (no position yet)
    // 2. Parse actual bounds from plugin response
    // 3. Compute collision-free position using PlacementEngine math
    // 4. Move model to computed position
    // 5. Track placement
    // ----------------------------------------------------------------
    async _executeInsertModel(step, stepNum) {
        const modelName = step.name || `Model_${stepNum}`;

        // --- PHASE 1: Insert the model (without positioning) ---
        const insertCmd = {
            type: 'insert_free_model',
            payload: {
                parent: step.parent || 'Workspace',
                name: modelName
            }
        };

        if (step.assetId) {
            insertCmd.payload.assetId = step.assetId;
        } else if (step.searchQuery) {
            insertCmd.payload.searchQuery = step.searchQuery;
        } else {
            this.log('error', `Step ${stepNum}: insert_model has no searchQuery or assetId`);
            return false;
        }

        const validation = validator.validate(insertCmd);
        if (!validation.valid) {
            this.log('error', `Step ${stepNum}: Validation failed: ${validation.errors.join(', ')}`);
            return false;
        }

        this.log('info', `Inserting model: ${step.searchQuery || `assetId:${step.assetId}`} (will compute position after)`, insertCmd);

        const enqueued = commandQueue.enqueue(this.id, insertCmd.type, insertCmd.payload);
        await this._waitForCommands([enqueued.id]);

        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') {
            this.log('error', `Insert failed: ${result.error}`);
            return false;
        }

        // --- PHASE 2: Extract actual bounds from plugin response ---
        let modelBounds = null;
        const resultStr = result.result || '';
        const boundsMatch = resultStr.match(/\|BOUNDS:(\{.*\})/);
        if (boundsMatch) {
            try {
                modelBounds = JSON.parse(boundsMatch[1]);
            } catch (e) {
                this.log('warning', `Could not parse bounds from plugin: ${e.message}`);
            }
        }

        // If we couldn't get bounds from the insert response, try get_bounds command
        if (!modelBounds) {
            await this._refreshState();
            const boundsCmd = commandQueue.enqueue(this.id, 'get_bounds', {
                path: `Workspace.${modelName}`
            });
            await this._waitForCommands([boundsCmd.id], 10000);
            const boundsResult = commandQueue.commands.get(boundsCmd.id);
            if (boundsResult.status === 'completed' && boundsResult.result) {
                try {
                    modelBounds = JSON.parse(boundsResult.result);
                } catch (e) {
                    this.log('warning', `Could not parse get_bounds result: ${e.message}`);
                }
            }
        }

        const actualSize = modelBounds?.size || [8, 8, 8];
        const actualPos = modelBounds?.position || [0, 0, 0];
        this.log('info', `Model "${modelName}" actual size: [${actualSize.join(', ')}], current pos: [${actualPos.map(n => n.toFixed(1)).join(', ')}]`);

        // --- PHASE 3: Compute correct position using math ---
        const worldInfo = placementEngine.getWorldInfo(stateManager.projectState);
        const intendedPos = step.position || actualPos;

        const placement = placementEngine.computePlacement(
            actualSize,
            intendedPos,
            worldInfo.occupied,
            worldInfo.groundY,
            worldInfo.bounds
        );

        this.log('info', `Computed position: [${placement.position.join(', ')}] (adjusted: ${placement.adjusted}, reason: ${placement.reason})`);

        // --- PHASE 4: Move model to computed position ---
        const moveCmd = commandQueue.enqueue(this.id, 'move_instance', {
            path: `Workspace.${modelName}`,
            position: placement.position
        });
        await this._waitForCommands([moveCmd.id], 15000);

        const moveResult = commandQueue.commands.get(moveCmd.id);
        if (moveResult.status === 'failed') {
            this.log('warning', `Move failed: ${moveResult.error} — model stays at insert position`);
        } else {
            this.log('info', `Moved "${modelName}" → [${placement.position.join(', ')}]`);
        }

        // --- PHASE 5: Refresh state and track ---
        await this._refreshState();
        this._trackPlacement(modelName, placement.position, actualSize);

        return true;
    }

    // ----------------------------------------------------------------
    // Execute an insert_script step
    // ----------------------------------------------------------------
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
            this.log('error', `Step ${stepNum}: Validation failed: ${validation.errors.join(', ')}`);
            return false;
        }

        this.log('info', `Creating script: "${cmd.payload.name}" in ${cmd.payload.parent}`, cmd);

        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);

        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') {
            this.log('error', `Script creation failed: ${result.error}`);
            return false;
        }

        await this._refreshState();
        return true;
    }

    // ----------------------------------------------------------------
    // Execute a generic create_instance step (lights, effects, sounds, etc.)
    // ----------------------------------------------------------------
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
        if (!validation.valid) {
            this.log('error', `Step ${stepNum}: Validation failed: ${validation.errors.join(', ')}`);
            return false;
        }

        this.log('info', `Creating ${cmd.payload.className}: "${cmd.payload.name}" in ${cmd.payload.parent}`, cmd);

        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);

        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') {
            this.log('error', `Create failed: ${result.error}`);
            return false;
        }

        await this._refreshState();
        return true;
    }

    // ----------------------------------------------------------------
    // Execute a set_lighting step (configure Lighting service properties)
    // ----------------------------------------------------------------
    async _executeSetLighting(step, stepNum) {
        const cmd = {
            type: 'set_properties',
            payload: {
                path: 'Lighting',
                properties: step.properties || {}
            }
        };

        this.log('info', `Setting Lighting properties: ${Object.keys(step.properties || {}).join(', ')}`);

        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);

        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') {
            this.log('error', `Set lighting failed: ${result.error}`);
            return false;
        }

        await this._refreshState();
        return true;
    }

    // ----------------------------------------------------------------
    // Execute a create_effect step (Atmosphere, Bloom, Sky, etc. under Lighting)
    // ----------------------------------------------------------------
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

        this.log('info', `Creating effect: ${cmd.payload.className} "${cmd.payload.name}" in Lighting`, cmd);

        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);

        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') {
            this.log('error', `Create effect failed: ${result.error}`);
            return false;
        }

        await this._refreshState();
        return true;
    }

    // ----------------------------------------------------------------
    // Execute a create_ui step (full ScreenGui hierarchy)
    // ----------------------------------------------------------------
    async _executeCreateUI(step, stepNum) {
        const cmd = {
            type: 'create_ui',
            payload: {
                parent: step.parent || 'StarterGui',
                elements: step.elements || []
            }
        };

        if (!cmd.payload.elements.length) {
            this.log('error', `Step ${stepNum}: create_ui has no elements`);
            return false;
        }

        this.log('info', `Creating UI in ${cmd.payload.parent}: ${cmd.payload.elements.map(e => e.name || e.className).join(', ')}`);

        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);

        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') {
            this.log('error', `Create UI failed: ${result.error}`);
            return false;
        }

        await this._refreshState();
        return true;
    }

    // ----------------------------------------------------------------
    // Execute a clone_instance step
    // ----------------------------------------------------------------
    async _executeCloneInstance(step, stepNum) {
        const cmd = {
            type: 'clone_instance',
            payload: {
                path: step.path,
                name: step.name || `Clone_${stepNum}`,
                parent: step.parent || undefined
            }
        };

        if (!cmd.payload.path) {
            this.log('error', `Step ${stepNum}: clone_instance has no source path`);
            return false;
        }

        this.log('info', `Cloning "${cmd.payload.path}" as "${cmd.payload.name}"`);

        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);

        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') {
            this.log('error', `Clone failed: ${result.error}`);
            return false;
        }

        await this._refreshState();
        return true;
    }

    // ----------------------------------------------------------------
    // Execute a delete_instance step
    // ----------------------------------------------------------------
    async _executeDeleteInstance(step, stepNum) {
        const cmd = {
            type: 'delete_instance',
            payload: {
                path: step.path
            }
        };

        if (!cmd.payload.path) {
            this.log('error', `Step ${stepNum}: delete_instance has no path`);
            return false;
        }

        this.log('info', `Deleting "${cmd.payload.path}"`);

        const enqueued = commandQueue.enqueue(this.id, cmd.type, cmd.payload);
        await this._waitForCommands([enqueued.id]);

        const result = commandQueue.commands.get(enqueued.id);
        if (result.status === 'failed') {
            this.log('error', `Delete failed: ${result.error}`);
            return false;
        }

        await this._refreshState();
        return true;
    }

    // ----------------------------------------------------------------
    // DENSIFY PASS: Analyze coverage gaps and add objects to fill them
    // Runs AFTER the initial build is complete
    // ----------------------------------------------------------------
    async _densifyPass() {
        if (!this._running) return;

        this.log('info', '=== Starting densify pass — analyzing world coverage ===');
        await this._refreshState();

        const coverage = placementEngine.analyzeCoverage(stateManager.projectState);

        this.log('info', coverage.coverageReport);

        // Decide if densify is needed
        const needsDensify =
            coverage.emptyZones.length >= 2 ||
            coverage.sparseZones.length >= 3 ||
            coverage.objectCounts.trees < 8 ||
            coverage.objectCounts.vehicles < 4 ||
            coverage.objectCounts.lights < 5 ||
            coverage.objectCounts.props < 6;

        if (!needsDensify) {
            this.log('info', 'World coverage is sufficient — skipping densify pass.');
            return;
        }

        this.log('info', `Densify needed: ${coverage.emptyZones.length} empty zones, ${coverage.sparseZones.length} sparse zones.`);

        // Build existing objects list
        const worldInfo = placementEngine.getWorldInfo(stateManager.projectState);
        const existingList = worldInfo.occupied
            .filter(obj => {
                const s = obj.size || [0, 0, 0];
                return !(s[1] <= 2 && (s[0] >= 80 || s[2] >= 80));
            })
            .map(o => `- ${o.name || o.path} @ [${o.position.map(n => Math.round(n)).join(', ')}] size [${o.size.map(n => Math.round(n)).join(', ')}]`)
            .join('\n') || 'No objects yet.';

        // Call LLM for densify plan
        const densifyPrompt = DENSIFY_PROMPT
            .replace('{{COVERAGE_REPORT}}', coverage.coverageReport)
            .replace('{{EXISTING_OBJECTS}}', existingList);

        const messages = [
            { role: 'system', content: densifyPrompt },
            { role: 'user', content: 'Analyze the coverage and generate fill steps. Output ONLY JSON.' }
        ];

        try {
            const response = await this.llm.chat(this.modelId, messages, { apiKeys: this.apiKeys });
            this.memory.trackTokens(response.usage.inputTokens, response.usage.outputTokens);

            const jsonStr = this._extractJsonFromResponse(response.content);
            const densifyPlan = JSON.parse(jsonStr);

            const steps = densifyPlan.steps || [];
            if (steps.length === 0) {
                this.log('info', 'Densify LLM returned 0 steps — world is complete.');
                return;
            }

            this.log('info', `Densify plan: ${steps.length} additional objects to place.`);

            // Pre-resolve assets for densify steps
            for (const step of steps) {
                if (step.action !== 'insert_model' || step.assetId || !step.searchQuery) continue;
                try {
                    const asset = await assetCatalog.getBestAsset(step.searchQuery);
                    if (asset && asset.id) {
                        step.assetId = asset.id;
                        this.log('info', `Densify resolved "${step.searchQuery}" → ${asset.id}`);
                    }
                } catch (e) {
                    this.log('warning', `Densify resolve failed for "${step.searchQuery}": ${e.message}`);
                }
            }

            // Execute densify steps
            for (let i = 0; i < steps.length && this._running; i++) {
                const step = steps[i];
                const stepNum = `D${i + 1}`;
                this.log('info', `Densify ${stepNum}/${steps.length}: ${step.name || step.searchQuery}`);

                try {
                    if (step.action === 'insert_model') {
                        await this._executeInsertModel(step, stepNum);
                    }
                } catch (err) {
                    this.log('warning', `Densify ${stepNum} failed: ${err.message}`);
                }
            }

            this.log('info', `=== Densify pass complete: ${steps.length} objects added ===`);
        } catch (e) {
            this.log('warning', `Densify pass failed: ${e.message}. Build is still complete.`);
        }
    }

    // ----------------------------------------------------------------
    // LLM-assisted retry when direct execution fails
    // ----------------------------------------------------------------
    async _llmRetryStep(step, stepNum) {
        const maxRetries = 2;

        for (let attempt = 0; attempt < maxRetries && this._running; attempt++) {
            try {
                const analyzer = new CodeAnalyzer(stateManager);
                analyzer.analyzeProject();
                const symbolsContext = analyzer.generateContextSummary(200);

                const stepDesc = JSON.stringify(step, null, 2);
                const spatialMapStr = (this._spatialMap || []).map(o =>
                    `- ${o.name} @ [${o.position.join(', ')}]`
                ).join('\n') || 'No objects placed yet.';
                const retryPrompt = STEP_RETRY_PROMPT
                    .replace('{{STEP_DESCRIPTION}}', stepDesc)
                    .replace('{{ERROR_MESSAGE}}', this.activityLog.slice(-3).map(e => e.message).join('; '))
                    .replace('{{SYMBOL_MAP}}', symbolsContext)
                    .replace('{{SPATIAL_MAP}}', spatialMapStr);

                const messages = [
                    { role: 'system', content: retryPrompt },
                    { role: 'user', content: 'Fix this step. Output ONLY a JSON array of commands.' }
                ];

                const response = await this.llm.chat(this.modelId, messages, { apiKeys: this.apiKeys });
                this.memory.trackTokens(response.usage.inputTokens, response.usage.outputTokens);

                const jsonStr = this._extractJsonFromResponse(response.content);
                const parsed = JSON.parse(jsonStr);

                let commands = Array.isArray(parsed) ? parsed : (parsed.type ? [parsed] : []);
                if (commands.length === 0) continue;

                // Execute only safe commands (no set_properties mixed with inserts)
                const realCmds = commands.filter(c => c.type !== 'fetch_explorer_state' && c.type !== 'search_catalog');
                if (realCmds.length === 0) continue;

                const validation = validator.validateBatch(realCmds);
                if (!validation.valid) continue;

                this.log('info', `LLM retry attempt ${attempt + 1}: executing ${realCmds.length} commands...`);

                const enqueuedCmds = commandQueue.enqueueBatch(this.id, realCmds);
                await this._waitForCommands(enqueuedCmds.map(c => c.id));

                const results = enqueuedCmds.map(c => commandQueue.commands.get(c.id));
                const failures = results.filter(r => r.status === 'failed');

                await this._refreshState();

                if (failures.length === 0) {
                    this.log('info', `LLM retry succeeded on attempt ${attempt + 1}.`);
                    return true;
                }

                this.log('warning', `LLM retry attempt ${attempt + 1} had failures: ${failures.map(f => f.error).join('; ')}`);
            } catch (e) {
                this.log('error', `LLM retry attempt ${attempt + 1} error: ${e.message}`);
            }
        }

        return false;
    }

    // ================================================================
    // Helper methods
    // ================================================================

    async _refreshState() {
        try {
            const refreshCmd = commandQueue.enqueue(this.id, 'export_state', {});
            await this._waitForCommands([refreshCmd.id], 10000);
            const result = commandQueue.commands.get(refreshCmd.id);
            if (result && result.status === 'failed') {
                this.log('warning', `State export failed: ${result.error}. Placement data may be stale.`);
            }
        } catch (e) {
            this.log('warning', 'State refresh failed: ' + e.message);
        }
    }

    _getWorkspaceChildNames() {
        const workspace = stateManager.projectState?.Workspace;
        if (!workspace || typeof workspace !== 'object') return [];
        return Object.keys(workspace).filter(k => !k.startsWith('_'));
    }

    _verifyInstanceExists(name) {
        const workspace = stateManager.projectState?.Workspace;
        if (!workspace || typeof workspace !== 'object') return false;
        // Check exact match
        if (workspace[name]) return true;
        // Check case-insensitive
        const lower = name.toLowerCase();
        return Object.keys(workspace).some(k => k.toLowerCase() === lower);
    }

    _extractJsonFromResponse(content) {
        if (!content) throw new Error('Empty response from LLM');

        // 1. Try code-fenced JSON first
        const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenceMatch && fenceMatch[1]) {
            return fenceMatch[1].trim();
        }

        // 2. Find the outermost JSON structure (array or object)
        const firstBracket = content.indexOf('[');
        const firstBrace = content.indexOf('{');

        let jsonStart = -1;
        let openChar = '';
        let closeChar = '';

        if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
            jsonStart = firstBracket;
            openChar = '[';
            closeChar = ']';
        } else if (firstBrace !== -1) {
            jsonStart = firstBrace;
            openChar = '{';
            closeChar = '}';
        }

        if (jsonStart === -1) {
            throw new Error('Could not extract JSON from response');
        }

        // Walk forward to find the matching close bracket/brace
        let depth = 0;
        let inString = false;
        let escape = false;
        for (let i = jsonStart; i < content.length; i++) {
            const ch = content[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === openChar) depth++;
            if (ch === closeChar) depth--;
            if (depth === 0) {
                return content.substring(jsonStart, i + 1);
            }
        }

        // Fallback
        const lastClose = content.lastIndexOf(closeChar);
        if (lastClose > jsonStart) {
            return content.substring(jsonStart, lastClose + 1);
        }

        throw new Error('Could not extract JSON from response');
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

    pause() {
        this._running = false;
        this.status = 'paused';
    }

    resume() {
        if (this.status === 'paused' && this.currentPlan) {
            this._running = true;
            this.status = 'executing';
            this._resumeLoop();
        }
    }

    async _resumeLoop() {
        const plan = this.currentPlan;
        if (!plan || !plan.steps) return;

        // Continue from where we left off (don't reset _currentStepIndex)
        while (this._running && this._currentStepIndex < plan.steps.length) {
            const step = plan.steps[this._currentStepIndex];
            const stepNum = step.id || (this._currentStepIndex + 1);

            const stepLabel = step.name || step.action;
            const stepDetail = step.action === 'insert_model' ? (step.searchQuery || `assetId:${step.assetId}`) : (step.className || step.action);
            this.log('info', `Step ${stepNum}/${plan.steps.length}: ${stepLabel} — ${stepDetail}`);

            let success = false;

            try {
                switch (step.action) {
                    case 'create_part': success = await this._executeCreatePart(step, stepNum); break;
                    case 'insert_model': success = await this._executeInsertModel(step, stepNum); break;
                    case 'insert_script': success = await this._executeInsertScript(step, stepNum); break;
                    case 'create_instance': success = await this._executeCreateInstance(step, stepNum); break;
                    case 'set_lighting': success = await this._executeSetLighting(step, stepNum); break;
                    case 'create_effect': success = await this._executeCreateEffect(step, stepNum); break;
                    case 'create_ui': success = await this._executeCreateUI(step, stepNum); break;
                    case 'clone_instance': success = await this._executeCloneInstance(step, stepNum); break;
                    case 'delete_instance': success = await this._executeDeleteInstance(step, stepNum); break;
                    default: this.log('warning', `Step ${stepNum}: Unknown action "${step.action}", skipping.`); success = true;
                }
            } catch (err) {
                this.log('error', `Step ${stepNum} error: ${err.message}`);
            }

            if (!success && this._running) {
                this.log('warning', `Step ${stepNum} failed directly. Trying LLM-assisted retry...`);
                success = await this._llmRetryStep(step, stepNum);
            }

            if (success) {
                this.log('result', `Step ${stepNum} completed ✓`);
            } else {
                this.log('error', `Step ${stepNum} failed after retries. Moving on.`);
            }

            this._currentStepIndex++;
            await this.memory.save();
        }

        if (this._currentStepIndex >= plan.steps.length) {
            this.status = 'complete';
            this.log('complete', `Build finished! ${plan.steps.length} steps processed.`);
        }
    }

    stop() {
        this._running = false;
        this.status = 'idle';
    }

    updateProjectState(state) {
        this.memory.addProjectSnapshot(state);
    }

    getStatus() {
        const totalSteps = this.currentPlan?.steps?.length || 0;
        const completedSteps = totalSteps > 0 ? Math.min(this._currentStepIndex, totalSteps) : 0;
        return {
            id: this.id,
            status: this.status,
            model: this.modelId,
            plan: this.currentPlan ? {
                title: this.currentPlan.title,
                summary: this.currentPlan.summary,
                totalSteps
            } : null,
            progress: totalSteps > 0 ? {
                total: totalSteps,
                completed: completedSteps,
                percentage: Math.round((completedSteps / totalSteps) * 100)
            } : null,
            error: this.error,
            tokensUsed: this.memory.metadata.totalTokensUsed
        };
    }

    getActivity(limit = 50) {
        return this.activityLog.slice(-limit);
    }
}

module.exports = AgentRuntime;

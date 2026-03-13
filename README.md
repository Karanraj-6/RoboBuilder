# 🚀 RoboBuilder — AI-Powered Roblox Game Builder

Build complete Roblox games from a single text prompt. An AI agent plans, positions, and places every asset inside Roblox Studio — from terrain and roads to buildings, vehicles, lighting, UI, and game scripts.

---

## Table of Contents

- [High-Level Architecture](#high-level-architecture)
- [How It Works — End-to-End Flow](#how-it-works--end-to-end-flow)
- [3-Phase Deterministic Pipeline](#3-phase-deterministic-pipeline)
- [Visual Canvas Layout Preview](#visual-canvas-layout-preview)
- [Component Deep Dive](#component-deep-dive)
  - [Web App (Next.js)](#1-web-app-nextjs--localhost3000)
  - [Bridge Server (Express)](#2-bridge-server-express--localhost3456)
  - [Roblox Plugin (Lua)](#3-roblox-studio-plugin-lua)
- [Agent Runtime Architecture](#agent-runtime-architecture)
- [Command System](#command-system)
- [LLM Provider System](#llm-provider-system)
- [Smart Placement Engine](#smart-placement-engine)
- [Densify Pass](#densify-pass)
- [State Management & Verification](#state-management--verification)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Supported AI Models](#supported-ai-models)
- [Features](#features)
- [Troubleshooting](#troubleshooting)

---

## High-Level Architecture

```
┌─────────────────────┐      HTTP/REST       ┌─────────────────────┐    HTTP Polling     ┌─────────────────────┐
│                     │  ──────────────────►  │                     │  ◄───────────────►  │                     │
│    Web App          │                       │   Bridge Server     │                     │  Roblox Studio      │
│    (Next.js)        │  ◄──────────────────  │   (Express.js)      │  ──────────────►    │  Plugin (Lua)       │
│    localhost:3000   │      JSON Responses   │   localhost:3456    │    Command Queue    │                     │
│                     │                       │                     │                     │                     │
│  ┌───────────────┐  │                       │  ┌───────────────┐  │                     │  ┌───────────────┐  │
│  │ Builder Page  │  │                       │  │ Agent Runtime │  │                     │  │ Command       │  │
│  │ (4 panels)    │  │                       │  │ (3-Phase AI)  │  │                     │  │ Executor      │  │
│  ├───────────────┤  │                       │  ├───────────────┤  │                     │  ├───────────────┤  │
│  │ Settings Page │  │                       │  │ LLM Providers │  │                     │  │ State         │  │
│  │ (API Keys)    │  │                       │  │ (8 providers) │  │                     │  │ Serializer    │  │
│  ├───────────────┤  │                       │  ├───────────────┤  │                     │  ├───────────────┤  │
│  │ Landing Page  │  │                       │  │ Command Queue │  │                     │  │ Fuzzy Path    │  │
│  └───────────────┘  │                       │  └───────────────┘  │                     │  │ Resolver      │  │
└─────────────────────┘                       └─────────────────────┘                     └───────────────────┘
```

**Data Flow Summary:**

1. **User → Web App**: Types a prompt like "Build a GTA-style city"
2. **Web App → Bridge Server**: `POST /api/agents/:id/prompt` with prompt + model selection
3. **Bridge Server (Agent Runtime)**: Calls LLM to create a plan summary
4. **Bridge Server → Web App**: Returns plan for user approval
5. **User approves → Bridge Server**: Calls LLM for detailed build plan + pre-resolves all asset IDs
6. **Bridge Server → Web App**: Returns detailed steps with positions; status = `awaiting_layout`
7. **Visual Canvas Preview**: User sees a top-down 2D map with every asset positioned; can drag to reposition
8. **Optional: Reposition Agent**: User clicks "Use Reposition Agent" — LLM optimizes all positions for spatial layout
9. **User confirms layout → Bridge Server**: Updated positions sent back; auto-creates ground if assets are outside existing baseplates
10. **Bridge Server → Plugin**: Commands placed in queue, plugin polls `GET /api/commands` every 1s
11. **Plugin → Roblox Studio**: Executes each command using 5-phase smart insertion pipeline
12. **Plugin → Bridge Server**: Reports results + exports compact project state back
13. **Bridge Server**: Verifies each step, runs densify pass to fill empty areas, proceeds to next

---

## How It Works — End-to-End Flow

```
                                            ┌──────────────────────────────────────────┐
                                            │              USER INTERACTION             │
                                            └─────────────────┬────────────────────────┘
                                                              │
                                                  Types: "Build a GTA city"
                                                              │
                                                              ▼
                                            ┌──────────────────────────────────────────┐
                                            │          PHASE 1: PLAN SUMMARY           │
                                            │                                          │
                                            │  LLM receives: System prompt + Explorer  │
                                            │  state + User request                    │
                                            │                                          │
                                            │  LLM returns: { title, summary, items }  │
                                            └─────────────────┬────────────────────────┘
                                                              │
                                                  User sees plan preview in UI
                                                  Clicks "Approve & Execute"
                                                              │
                                                              ▼
                                            ┌──────────────────────────────────────────┐
                                            │        PHASE 2: DETAILED PLANNING        │
                                            │                                          │
                                            │  LLM generates ordered steps with exact  │
                                            │  positions, sizes, materials, asset IDs   │
                                            │                                          │
                                            │  Pre-resolves: searchQuery → assetId     │
                                            │  via Roblox Toolbox API for all models    │
                                            └─────────────────┬────────────────────────┘
                                                              │
                                                              ▼
                                            ┌──────────────────────────────────────────┐
                                            │     VISUAL CANVAS LAYOUT PREVIEW         │
                                            │                                          │
                                            │  Top-down 2D map appears in web app      │
                                            │  Every asset shown as draggable box       │
                                            │  Color-coded by action type               │
                                            │  User drags assets to reposition them     │
                                            │  Positions map 1:1 to Roblox studs        │
                                            │                                          │
                                            │  Optional: "Use Reposition Agent" button  │
                                            │  → LLM re-optimizes all positions         │
                                            │  → Canvas updates, user can further edit  │
                                            │                                          │
                                            │  User clicks "Confirm Layout & Execute"   │
                                            └─────────────────┬────────────────────────┘
                                                              │
                                                              ▼
                                            ┌──────────────────────────────────────────┐
                                            │   AUTO-GROUND COVERAGE CHECK             │
                                            │   If assets outside existing baseplates   │
                                            │   → auto-create ground to cover area      │
                                            └─────────────────┬────────────────────────┘
                                                              │
                                                              ▼
                                            ┌──────────────────────────────────────────┐
                                            │     PHASE 3: DETERMINISTIC EXECUTION     │
                                            │                                          │
                                            │  For each step (NO LLM calls):           │
                                            │                                          │
                                            │  insert_model uses 5-phase pipeline:     │
                                            │  ┌─ Insert → GetBounds → Compute ─────┐ │
                                            │  │  → Move (auto-ground correct)       │ │
                                            │  │  → Track in spatial map             │ │
                                            │  └───────────────────────────────────┘ │
                                            │                                          │
                                            │  If step fails → LLM retry (max 2x)     │
                                            └─────────────────┬────────────────────────┘
                                                              │
                                                              ▼
                                            ┌──────────────────────────────────────────┐
                                            │          DENSIFY PASS (POST-BUILD)       │
                                            │                                          │
                                            │  Analyzes 4×4 coverage grid:             │
                                            │  - Counts objects per zone per type       │
                                            │  - Identifies empty/sparse areas          │
                                            │  - LLM generates fill steps               │
                                            │  - Executes additional placements          │
                                            └──────────────────────────────────────────┘
```

---

## 3-Phase Deterministic Pipeline

The core innovation is a **3-phase pipeline** where the LLM is only called **twice** (once for summary, once for detailed plan), with a **visual canvas layout preview** between planning and execution. The runtime then executes deterministically:

### Phase 1 — Plan Summary (LLM Call #1)

| Input | Output |
|-------|--------|
| User prompt + Explorer state | `{ title, summary, items[] }` |

- Short, human-readable summary for approval
- No coordinates or technical details
- Displayed in the web app's plan preview panel

### Phase 2 — Detailed Plan (LLM Call #2)

| Input | Output |
|-------|--------|
| Approved summary + Explorer state + full Roblox knowledge | `{ title, summary, steps[] }` |

Each step has:
```json
{
  "id": 1,
  "action": "create_part | insert_model | create_instance | set_lighting | create_effect | create_ui | insert_script | clone_instance | delete_instance | set_properties",
  "name": "InstanceName",
  "className": "Part",
  "parent": "Workspace",
  "position": [X, Y, Z],
  "size": [W, H, D],
  "properties": { "Material": "Grass", "Color": [76, 153, 0], "Anchored": true },
  "searchQuery": "skyscraper",
  "assetId": 5803846832
}
```

### Phase 3 — Deterministic Execution (No LLM)

Before execution, the user sees a **Visual Canvas Layout Preview** — a full-screen top-down 2D map showing every asset at its planned position. Assets can be dragged to new positions. When the user confirms the layout, the runtime converts each plan step directly into plugin commands:

```
Plan Step                    →    Plugin Command
─────────────────────────────────────────────────────
create_part                  →    create_instance
insert_model                 →    insert_free_model → get_bounds → compute_placement → move_instance
create_instance              →    create_instance
set_lighting                 →    set_properties (path: "Lighting")
create_effect                →    create_instance (parent: "Lighting")
create_ui                    →    create_ui
insert_script                →    insert_script
clone_instance               →    clone_instance
delete_instance              →    delete_instance
set_properties               →    set_properties
```

The **insert_model** action uses a **5-phase smart insertion pipeline**:
1. **Insert**: Download model from Roblox Toolbox via `insert_free_model`.
  During insert, plugin strips embedded terrain/ground parts and scales oversized assets to safe dimensions.
2. **GetBounds**: Plugin reads `Model:GetBoundingBox()` to get post-cleanup dimensions
3. **ComputePlacement**: PlacementEngine finds collision-free position using AABB detection + spiral search
4. **Move**: `move_instance` with auto-ground correction (corrects pivot≠center offset)
5. **Track**: Record placement in spatial map for collision avoidance

**LLM is only re-invoked if a step fails** (max 2 retries per step), with the current Symbol Map provided for context.

---

## Component Deep Dive

### 1. Web App (Next.js) — localhost:3000

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS Modules

**Pages:**

| Page | Route | Description |
|------|-------|-------------|
| Landing | `/` | Hero page with feature overview |
| Builder | `/builder` | Main 4-panel workspace |
| Settings | `/settings` | API key management (stored in localStorage) |

**Builder Page — 4 Resizable Panels:**

```
┌─────────┬──────────────┬──────────┬──────────┐
│         │              │          │          │
│ PROMPT  │  ACTIVITY    │  AGENTS  │ PROJECT  │
│ PANEL   │  FEED        │  LIST    │ TREE     │
│         │              │          │          │
│ - Model │  - Plan      │  - Agent │ - Full   │
│   select│    preview   │    cards │   Explorer│
│ - Text  │  - Step-by-  │  - Status│   hierarchy│
│   input │    step logs │    dots  │ - Classes │
│ - Screen│  - Progress  │  - New   │ - Props  │
│   shot  │    bar       │    agent │          │
│ - Asset │  - Approve/  │    btn   │          │
│   ID    │    Modify    │          │          │
│ - Send  │              │          │          │
│ - Pause │              │          │          │
│   Resume│              │          │          │
│   Stop  │              │          │          │
└─────────┴──────────────┴──────────┴──────────┘
```

**Polling:** Every 2 seconds, fetches plugin status, agent list, activity feed, and project tree.

**API Client** (`src/lib/api.ts`):
| Function | Endpoint | Method |
|----------|----------|--------|
| `testConnection()` | `/api/status` | GET |
| `getModels()` | `/api/models` | GET |
| `createAgent(name)` | `/api/agents` | POST |
| `sendPrompt(id, prompt, model, keys)` | `/api/agents/:id/prompt` | POST |
| `getPlan(id)` | `/api/agents/:id/plan` | GET |
| `approvePlan(id)` | `/api/agents/:id/plan/approve` | POST |
| `getActivity(id, limit)` | `/api/agents/:id/activity` | GET |
| `pauseAgent(id)` | `/api/agents/:id/pause` | POST |
| `resumeAgent(id)` | `/api/agents/:id/resume` | POST |
| `stopAgent(id)` | `/api/agents/:id/stop` | POST |
| `getProjectState()` | `/api/project-state` | GET |
| `uploadAsset(file)` | `/api/upload-asset` | POST |

---

### 2. Bridge Server (Express) — localhost:3456

**Tech Stack:** Express.js, CORS, multer for file uploads, 50MB body limit

**Module Map:**

```
bridge-server/src/
├── index.js              ← Express app setup, middleware, route mounting
├── config.js             ← Port, provider configs, API keys, paths
│
├── routes/
│   ├── agent.js          ← CRUD for agents, prompt, approve, pause/resume/stop
│   ├── bridge.js         ← Plugin communication: command polling, results, state
│   ├── assets.js         ← File upload/download (multer, 50MB limit)
│   └── models.js         ← List all available LLM models
│
├── agent/
│   ├── runtime.js        ← ★ CORE: 3-phase deterministic pipeline (28 methods)
│   ├── agentPool.js      ← Agent factory + registry (Map<id, AgentRuntime>)
│   ├── providers.js      ← Multi-LLM adapter (8 providers, unified interface)
│   ├── stateManager.js   ← Central project state + version tracking
│   ├── codeAnalyzer.js   ← Parses project state → Symbol Map for AI context
│   ├── placementEngine.js← Spatial guidance (ground Y, baseplate bounds, slots)
│   ├── assetCatalog.js   ← Roblox Catalog v2 API search via roproxy
│   ├── validator.js      ← Command validation + auto-repair (18 command types)
│   ├── lockManager.js    ← Workspace area locking for multi-agent safety
│   └── memory.js         ← Conversation history, plan, snapshots, token tracking
│
├── queue/
│   └── commandQueue.js   ← FIFO queue: enqueue → dequeue → reportResult
│
└── prompts/
    └── system.js         ← All LLM system prompts + Roblox knowledge base
```

**Agent Runtime — Core Methods:**

```
                      AgentRuntime
    ┌───────────────────────────────────────────┐
    │                                           │
    │  Lifecycle:                                │
    │    constructor(id, llm, config)            │
    │    start(prompt, modelId, apiKeys)         │
    │    approvePlan()                           │
    │    confirmLayout()     ← canvas → execute  │
    │    updatePositions()   ← canvas drag edits  │
    │    repositionLayout()  ← LLM layout agent   │
    │    pause()                                 │
    │    resume() → _resumeLoop()               │
    │    stop()                                  │
    │                                           │
    │  Phase 2:                                  │
    │    _buildDetailedPlan()                    │
    │    _preResolveAssets() ← Toolbox API       │
    │    _executeAfterLayout()                   │
    │    _ensureGroundCoverage() ← auto-baseplate│
    │                                           │
    │  Phase 3 — Execution:                      │
    │    _executeLoop()                          │
    │    _executeCreatePart(step)                │
    │    _executeInsertModel(step) ← 5-phase     │
    │    _executeInsertScript(step)              │
    │    _executeCreateInstance(step)            │
    │    _executeSetLighting(step)               │
    │    _executeCreateEffect(step)              │
    │    _executeCreateUI(step)                  │
    │    _executeCloneInstance(step)             │
    │    _executeDeleteInstance(step)            │
    │                                           │
    │  Post-Build:                               │
    │    _densifyPass() ← coverage analysis       │
    │                                           │
    │  Recovery:                                 │
    │    _llmRetryStep(step) — max 2 retries    │
    │                                           │
    │  Helpers:                                  │
    │    _refreshState()                         │
    │    _getWorkspaceChildNames()               │
    │    _verifyInstanceExists(name)             │
    │    _extractJsonFromResponse(content)       │
    │    _waitForCommands(ids, timeout)          │
    │    _trackPlacement(name, position, size)   │
    │                                           │
    │  State:                                    │
    │    log(type, message, data)                │
    │    updateProjectState(state)               │
    │    getStatus() → {progress, plan, ...}     │
    │    getActivity(limit)                      │
    └───────────────────────────────────────────┘
```

---

### 3. Roblox Studio Plugin (Lua)

**File:** `roblox-plugin/AIBuilder.lua`

**How it connects:**

```
Plugin starts → User clicks "Connect" button
       │
       ▼
  ┌──────────────────────────────────────────────────────┐
  │  THREE CONCURRENT LOOPS:                              │
  │                                                      │
  │  1. Command Polling Loop (every 1s)                  │
  │     GET /api/commands → execute → POST /result       │
  │     After EVERY command: force state export           │
  │                                                      │
  │  2. Heartbeat Loop (every 3s)                        │
  │     POST /api/heartbeat                              │
  │                                                      │
  │  3. State Export Loop (every 10s)                     │
  │     Serializes FULL project hierarchy → POST          │
  │     /api/project-state                               │
  └──────────────────────────────────────────────────────┘
```

**Plugin Command Handlers (14 types):**

| Command | What it does |
|---------|-------------|
| `create_instance` | `Instance.new(className)` — any Roblox class |
| `insert_free_model` | Search Roblox catalog → `game:GetObjects()` or `InsertService:LoadAsset()` |
| `set_properties` | Resolve path → set properties (auto-handles Model:MoveTo, Color3, Vector3, Enum, UDim2) |
| `delete_instance` | Resolve path → `Instance:Destroy()` |
| `insert_script` | Create Script/LocalScript/ModuleScript with source code |
| `update_script` | Replace entire script source |
| `patch_script` | Line-level diffs (replace, insert, delete) — preserves unchanged lines |
| `create_ui` | Recursive UI tree creation (ScreenGui → Frames → Labels → Layouts) |
| `move_instance` | Reposition an instance with auto-ground correction (PivotTo + bbox center offset fix) |
| `reparent_instance` | Move an instance to a new parent (reparenting) |
| `clone_instance` | `Instance:Clone()` with optional rename and reparent |
| `snapshot` | Save project state for rollback |
| `export_state` | Serialize + send compact hierarchy to bridge server (with retry on failure) |
| `batch` | Execute multiple commands in sequence |

**Smart Property Setter:**
The plugin's `setProperties()` function handles all Roblox types automatically:
- `[x, y, z]` → `Vector3.new(x, y, z)`
- `[r, g, b]` on Color keys → `Color3.fromRGB(r, g, b)`
- `[sx, ox, sy, oy]` → `UDim2.new(sx, ox, sy, oy)`
- String enum values → auto-resolved via brute-force Enum search
- Model positioning → `Model:MoveTo()` / `Model:PivotTo()`
- Model anchoring → propagated to all descendant BaseParts

**State Serializer (Compact):**
Recursively serializes the project tree (depth limit: 10) with **compact mode** — Models skip geometry children (BaseParts, child Models, Accessories) when bounding box data is available, reducing payload by ~90%. Includes:
- Services: Workspace, ServerScriptService, ReplicatedStorage, StarterGui, StarterPlayer, Lighting, ServerStorage
- Each instance: `_class`, `_name`, `_properties` (Position, Size, PivotPosition, BoundingSize, Anchored, Material, Color, etc.)
- Scripts: `_source` field with full Lua source code
- Duplicate name handling: `Name__2`, `Name__3` suffix convention
- Export failure detection: retries on nil return from `HttpService:PostAsync`

**Path Resolution:**
Uses fuzzy matching: exact match → `Name__ordinal` convention → case-insensitive match → `FindFirstChild` fallback

---

## Agent Runtime Architecture

### State Machine

```
                  start()
    idle ────────────────────► planning
                                   │
                          LLM returns summary
                                   │
                                   ▼
                          awaiting_approval
                                   │
                          approvePlan()
                                   │
                                   ▼
                           (generating plan)
                                   │
                          LLM returns detailed steps
                          Pre-resolves all asset IDs
                                   │
                                   ▼
                          awaiting_layout  ◄── updatePositions()
                            /      │   ▲          (from canvas)
                           /       │   │
                          /        │  repositionLayout()
                         /         │   (LLM re-optimizes,
                        /          │    stays in awaiting_layout)
                       /   confirmLayout()
                         ▼        │
                             executing ◄────── resume()
                            /    │    \           ▲
                   step ok /     │     \ step     │
                          /      │      \ fails   │
                         ▼       │       ▼        │
                     (next     pause()  _llmRetryStep()
                      step)      │      (max 2x)
                         \       ▼       /
                          \   paused ───┘
                           \    │
                            ▼   │ stop()
                          complete ◄──── all steps done
                                         + densifyPass()
                                │
                                ▼
                             error (on any unrecoverable failure)
```

### Insert Model \u2014 5-Phase Smart Insertion Pipeline

The most complex operation is `insert_model`. It uses a 5-phase pipeline:

```
1. Snapshot: beforeNames = [\"Baseplate\", \"Ground\", \"Road\"]

2. Send insert_free_model command to plugin (resolved assetId from Toolbox API)

3. Plugin downloads model \u2192 parents to Workspace

4. Send export_state \u2192 wait for compact state (model skips geometry children)

5. Snapshot: afterNames = [\"Baseplate\", \"Ground\", \"Road\", \"Victorian House\"]

6. Diff: newName = \"Victorian House\" \u2190 the model's real name

7. PlacementEngine.computePlacement():
   \u2022 AABB collision detection against ALL placed objects (8-stud padding)
   \u2022 If collision at intended spot \u2192 spiral search (10 rings \u00d7 45\u00b0 = 80 positions)
   \u2022 If all spiral spots fail \u2192 grid fallback
   \u2022 Returns final collision-free [X, Y, Z] position

8. Send move_instance to \"Workspace.Victorian House\" with computed position
   \u2022 Plugin does PivotTo(position)
   \u2022 Auto-ground correction: reads bbox center, computes pivot\u2260center offset
   \u2022 Re-PivotTos to correct Y so bottom sits exactly on ground

9. Track placement in spatial map for future collision avoidance

10. Verify \"Victorian House\" exists in Explorer state
```

---

## Visual Canvas Layout Preview

After Phase 2 generates the detailed plan (with positions for every asset), the system pauses at `awaiting_layout` status and the frontend shows a **full-screen canvas layout preview**:

```
\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510
\u2502  Layout Preview \u2014 Build Plan Title           [Side Panel] \u2502
\u2502  Drag assets to reposition. Scroll to zoom.   \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510 \u2502
\u2502  \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510  \u2502Selected\u2502 \u2502
\u2502  \u2502    X:-256              0            +256 \u2502  \u2502 \ud83c\udfe2 Tower\u2502 \u2502
\u2502  \u2502   \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510                              \u2502  \u2502 X:60    \u2502 \u2502
\u2502  \u2502   \u2502\ud83c\udfe2 Tower \u2502     \ud83c\udf33          \ud83c\udf33       \u2502  \u2502 Z:120   \u2502 \u2502
\u2502  \u2502   \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518                              \u2502  \u2502 Size:   \u2502 \u2502
\u2502  \u2502              \ud83d\ude97  \u250c\u2500\u2500\u2500\u2500\u2510    \ud83d\ude97           \u2502  \u2502 30\u00d780\u00d730\u2502 \u2502
\u2502  \u2502                 \u2502Road\u2502                  \u2502  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518 \u2502
\u2502  \u2502      \ud83c\udf33        \u2514\u2500\u2500\u2500\u2500\u2518       \ud83d\udca1        \u2502  \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510 \u2502
\u2502  \u2502                                         \u2502  \u2502All Stp.\u2502 \u2502
\u2502  \u2502     \ud83d\ude97       \ud83c\udfe2          \ud83d\ude97              \u2502  \u2502\u25cf Tower \u2502 \u2502
\u2502  \u2502                                         \u2502  \u2502\u25cf Tree  \u2502 \u2502
\u2502  \u2502   \ud83c\udf33   \ud83d\udca1          \ud83c\udf33        \ud83c\udf33       \u2502  \u2502\u25cf Car   \u2502 \u2502
\u2502  \u2502                                         \u2502  \u2502\u25cf Road  \u2502 \u2502
\u2502  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518  \u2502\u25cf Light \u2502 \u2502
\u2502  Legend: \u25a0 create_part \u25a0 insert_model ...    \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518 \u2502
\u2502                                                          \u2502
│  [Reposition Agent]  [Confirm & Execute]  [Skip]    │
\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518
```

### How Canvas \u2192 Studio Position Mapping Works

Canvas pixel coordinates are mathematically converted to real Roblox studs:

```javascript
// World bounds: -256 to +256 studs (512 total)
studX = ((pixelX / canvasWidth) * 512) - 256;
studZ = ((pixelY / canvasHeight) * 512) - 256;
studY = unchanged;    // preserved from LLM plan (ground level)
```

When the user drags a box on the canvas, the new pixel position is converted to studs and stored in the step. When \"Confirm Layout & Execute\" is clicked:
1. Updated positions are sent to the bridge via `POST /api/agents/:id/plan/update-positions`
2. `POST /api/agents/:id/plan/confirm-layout` triggers Phase 3 execution
3. The runtime uses the user-edited positions for every `set_properties` and `move_instance` call
4. Studio places assets pixel-perfect to what the user saw on canvas

### Canvas Features
- **Color-coded assets**: Each action type has a distinct color (blue = parts, yellow = models, purple = instances, etc.)
- **Category icons**: Trees (\ud83c\udf33), cars (\ud83d\ude97), buildings (\ud83c\udfe2), lights (\ud83d\udca1) based on asset name
- **Side panel**: Shows selected asset details (position, size, assetId) + full step list
- **Zoom**: Mouse wheel to zoom in/out (0.3x to 5x)
- **Grid**: 64-stud grid lines with origin crosshair
- **Skip option**: User can skip the preview and execute with LLM-generated positions directly
```

---

## Command System

### Command Lifecycle

```
Runtime                    CommandQueue                 Plugin
   │                            │                         │
   │  enqueue(type, payload)    │                         │
   │ ─────────────────────────► │                         │
   │         returns {id}       │                         │
   │                            │     GET /api/commands   │
   │                            │ ◄─────────────────────  │
   │                            │     [cmd1, cmd2, ...]   │
   │                            │ ─────────────────────►  │
   │                            │                         │
   │                            │                   cmd.status = 'sent'
   │                            │                         │
   │                            │                    EXECUTE IN
   │                            │                    ROBLOX STUDIO
   │                            │                         │
   │                            │   POST /commands/:id/   │
   │                            │   result                │
   │                            │ ◄─────────────────────  │
   │                            │   {success, result}     │
   │                            │                         │
   │  _waitForCommands([id])    │                         │
   │  (polls every 500ms)       │                         │
   │  status = completed ✓      │                         │
   │ ◄───────────────────────── │                         │
```

### Command Queue States

```
pending → sent → completed
                → failed
```

- **pending**: Queued, waiting for plugin to poll
- **sent**: Plugin fetched it, executing
- **completed**: Plugin reported success
- **failed**: Plugin reported error, or timeout (60s default)

---

## LLM Provider System

### Supported Providers (8)

| Provider | Models | Auth |
|----------|--------|------|
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku | `ANTHROPIC_API_KEY` |
| **OpenAI** | GPT-5.4 Pro, GPT-5.4, GPT-5.3 Instant | `OPENAI_API_KEY` |
| **Google** | Gemini 3.1 Pro, Gemini 3 Flash, Flash-Lite | `GOOGLE_API_KEY` |
| **Mistral** | Mistral Large, Pixtral Large, Ministral 8B | `MISTRAL_API_KEY` |
| **Groq** | Llama 3.3 70B, Llama 3 70B/8B, Gemma 2 9B | `GROQ_API_KEY` |
| **AWS Bedrock** | Claude 3.5 Sonnet, Llama 3.3 70B, Nova Pro | `AWS_BEDROCK_API_KEY` |
| **HuggingFace** | Llama 3.1 8B, any custom model | `HF_TOKEN` |
| **Ollama** | Local model, Tunnel (custom URL) | Not required |

### Dual API Key System

API keys can be provided in two ways:
1. **Server-side** (`bridge-server/.env`): Admin keys, used by default
2. **Client-side** (Settings page → localStorage): User keys, sent with each request and override server keys

```
User's key (from request) → used if present
         ↓ fallback
Server .env key → used if present
         ↓ fallback
Error: "API key not configured"
```

### Unified Provider Interface

All 8 providers are normalized to return:
```js
{
  content: "string",         // LLM text response
  usage: {
    inputTokens: number,     // Prompt tokens
    outputTokens: number     // Completion tokens
  }
}
```

---

## Smart Placement Engine

The `PlacementEngine` (`placementEngine.js`) provides math-based collision-free placement for all assets:

### AABB Collision Detection
Every placed object is tracked in a spatial map with position and size. When placing a new object:
1. Check intersection with ALL existing objects using axis-aligned bounding box (AABB) detection
2. Apply **8-stud padding** around each object for realistic spacing
3. If collision detected at intended position, trigger spiral search

### Spiral Search Algorithm
```
         Ring 3
      Ring 2
    Ring 1
      ●  ← intended position (collision!)
    Ring 1: 8 positions at 45° intervals, 8 studs out
    Ring 2: 8 positions at 45° intervals, 16 studs out
    Ring 3: 8 positions at 45° intervals, 24 studs out
    ...up to Ring 10 (80 studs out)

    Total: 10 rings × 8 directions = 80 candidate positions
    First collision-free spot wins.
```

### Grid Fallback
If all 80 spiral positions are occupied, falls back to a grid search across the full build area.

### Coverage Analysis (`analyzeCoverage()`)
Divides the world into a **4×4 grid** of zones and counts objects by type:
- **Categories**: buildings, vehicles, trees, lights, props
- **Per zone**: object count, type breakdown
- **Output**: identifies empty zones, sparse zones, and generates a `coverageReport` string for the LLM

---

## Densify Pass

After the initial build completes, the runtime automatically runs a **densify pass** to fill empty areas:

```
Initial Build Complete
        │
        ▼
  analyzeCoverage() → 4×4 grid analysis
        │
  Check thresholds:
    ├─ 2+ empty zones?
    ├─ < 8 trees?
    ├─ < 4 vehicles?
    ├─ < 5 lights?
    └─ < 6 props?
        │
  If any threshold unmet:
        │
        ▼
  LLM call with DENSIFY_PROMPT
  + empty zone coordinates
  + current object counts
        │
        ▼
  Generate fill steps
  (target specific empty zones)
        │
        ▼
  Pre-resolve fill assets
  Execute fill steps
```

### Minimum Density Targets
| Type | Minimum Count |
|------|--------------|
| Trees | 8 |
| Vehicles | 4 |
| Lights | 5 |
| Props | 6 |

---

## State Management & Verification

### State Flow

```
Plugin exports state          Bridge route                StateManager
─────────────────────────────────────────────────────────────────────
POST /api/project-state  ──►  bridge.js receives   ──►  stateManager.updateProjectState()
                              projectState = body         Traverses tree, bumps versions
                              agentPool.updateProjectState()
                                                          Runtime reads via:
                                                          • _getWorkspaceChildNames()
                                                          • _verifyInstanceExists()
                                                          • CodeAnalyzer (Symbol Map)
```

### Symbol Map Generation

The `CodeAnalyzer` parses the full project state into a compact text summary for the LLM:

```
CODEBASE SYMBOL MAP:

[ ServerScriptService.GameScript ]
  Functions:
    - onPlayerAdded(player) (Line 3)
    - setupLeaderboard(player) (Line 15)
  Events:
    - Players.PlayerAdded:Connect

--- PHYSICAL INSTANCES IN WORLD ---
- Workspace.Ground (Part) Pos:[0,0,0] Size:[512,1,512]
- Workspace.MainRoad (Part) Pos:[0,0,0] Size:[12,0,300]
- Workspace.Skyscraper (Model) Pos:[60,0,0] Size:[30,80,30]
```

### Version Tracking

Every instance/script gets a version number. When a script source changes, the version bumps. This enables future conflict detection for multi-agent editing.

---

## API Reference

### Agent Endpoints

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|-------------|----------|
| `GET` | `/api/agents` | List all agents | — | `{ agents: [...] }` |
| `POST` | `/api/agents` | Create agent | `{ name }` | `{ id, name, status }` |
| `GET` | `/api/agents/:id` | Get agent details | — | `{ id, status, plan, progress, ... }` |
| `DELETE` | `/api/agents/:id` | Delete agent | — | `{ success: true }` |
| `POST` | `/api/agents/:id/prompt` | Start build | `{ prompt, modelId, apiKeys? }` | `{ status, plan }` |
| `GET` | `/api/agents/:id/plan` | Get current plan | — | `{ plan, status }` |
| `POST` | `/api/agents/:id/plan/approve` | Approve plan | — | `{ status: "executing" }` |
| `POST` | `/api/agents/:id/plan/update-positions` | Update step positions from canvas | `{ positions: [{id, position}] }` | `{ success: true }` |
| `POST` | `/api/agents/:id/plan/confirm-layout` | Confirm canvas layout, start execution | — | `{ status: "executing" }` |
| `POST` | `/api/agents/:id/plan/reposition` | LLM reposition agent optimizes layout | — | `{ success, repositioned, steps }` |
| `GET` | `/api/agents/:id/activity` | Get activity log | `?limit=50` | `{ activity: [...] }` |
| `POST` | `/api/agents/:id/pause` | Pause execution | — | `{ status: "paused" }` |
| `POST` | `/api/agents/:id/resume` | Resume execution | — | `{ status: "executing" }` |
| `POST` | `/api/agents/:id/stop` | Stop agent | — | `{ status: "idle" }` |

### Bridge Endpoints (Plugin ↔ Server)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/commands` | Plugin polls for pending commands (dequeues up to 10) |
| `POST` | `/api/commands/:id/result` | Plugin reports command execution result |
| `POST` | `/api/project-state` | Plugin uploads serialized project state |
| `GET` | `/api/project-state` | Web app fetches current project state |
| `POST` | `/api/heartbeat` | Plugin heartbeat (updates lastSeen) |
| `GET` | `/api/plugin-status` | Check if plugin is connected (stale after 10s) |

### Other Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | Server health check |
| `GET` | `/api/models` | List all available LLM models across providers |
| `POST` | `/api/upload-asset` | Upload a file (fbx, obj, gltf, png, mp3, rbxm etc.) |
| `GET` | `/api/assets` | List uploaded assets |

---

## Project Structure

```
roblox-ai-builder/
│
├── README.md                        ← This file
├── package.json                     ← Workspace root (npm workspaces)
├── start.bat                        ← Windows startup script
│
├── bridge-server/                   ← Express.js backend (port 3456)
│   ├── package.json
│   ├── src/
│   │   ├── index.js                 ← App init, middleware, route mounting
│   │   ├── config.js                ← All configuration (providers, paths, costs)
│   │   │
│   │   ├── agent/
│   │   │   ├── runtime.js           ← ★ CORE: 3-phase agent pipeline + canvas layout + densify
│   │   │   ├── agentPool.js         ← Agent creation + registry
│   │   │   ├── providers.js         ← 8 LLM providers, unified chat() interface
│   │   │   ├── stateManager.js      ← Central project state + version tracking
│   │   │   ├── codeAnalyzer.js      ← Project → Symbol Map for LLM context
│   │   │   ├── placementEngine.js   ← Smart placement (AABB collision, spiral search, coverage analysis)
│   │   │   ├── assetCatalog.js      ← Roblox Toolbox API search (category 10 = Models)
│   │   │   ├── validator.js         ← Command validation + auto-repair
│   │   │   ├── lockManager.js       ← Multi-agent workspace locking
│   │   │   └── memory.js            ← Conversation, plan, snapshots persistence
│   │   │
│   │   ├── prompts/
│   │   │   └── system.js            ← LLM prompts + Roblox knowledge base
│   │   │                              (materials, classes, colors, patterns, scale)
│   │   │
│   │   ├── queue/
│   │   │   └── commandQueue.js      ← FIFO command queue (pending→sent→completed)
│   │   │
│   │   └── routes/
│   │       ├── agent.js             ← Agent CRUD + control endpoints
│   │       ├── bridge.js            ← Plugin communication endpoints
│   │       ├── assets.js            ← File upload (multer, 50MB limit)
│   │       └── models.js            ← List available LLM models
│   │
│   └── data/
│       ├── assetDatabase.json       ← Local asset metadata cache
│       ├── sessions/                ← Agent memory persistence (per-session JSON)
│       ├── uploads/                 ← User-uploaded files
│       └── vector_db/              ← Vector search index
│
├── web-app/                         ← Next.js 16 frontend (port 3000)
│   ├── package.json
│   ├── next.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── app/
│       │   ├── layout.tsx           ← Root layout with sidebar + theme
│       │   ├── page.tsx             ← Landing page
│       │   ├── builder/
│       │   │   ├── page.tsx         ← ★ Main builder (4-panel workspace)
│       │   │   └── builder.module.css
│       │   └── settings/
│       │       ├── page.tsx         ← API key management page
│       │       └── settings.module.css
│       ├── components/
│       │   ├── Sidebar.tsx          ← Navigation sidebar
│       │   ├── ThemeProvider.tsx     ← Dark/light theme toggle
│       │   └── MainContentAdjuster.tsx
│       ├── contexts/
│       │   └── SidebarContext.tsx    ← Sidebar state management
│       └── lib/
│           └── api.ts               ← API client (all fetch calls)
│
└── roblox-plugin/                   ← Roblox Studio plugin
    └── AIBuilder.lua                ← Command executor + compact state serializer
                                       (13 command handlers, fuzzy path resolver,
                                        smart property setter, auto-ground correction,
                                        recursive UI builder)
```

---

## Quick Start

### Prerequisites

- **Node.js** 18+ — [nodejs.org](https://nodejs.org)
- **Roblox Studio** — [roblox.com/create](https://roblox.com/create)
- At least one LLM API key (Anthropic, OpenAI, Google, etc.)

### 1. Install Dependencies

```bash
# From root directory
cd bridge-server && npm install
cd ../web-app && npm install
```

### 2. Configure API Keys

**Option A: Server-side (`.env` file)**

Create `bridge-server/.env`:
```env
# Add any/all of these:
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AIza...
MISTRAL_API_KEY=...
GROQ_API_KEY=gsk_...
HF_TOKEN=hf_...
AWS_BEDROCK_API_KEY=...
AWS_REGION=us-east-1
```

**Option B: Client-side (Settings page)**

Navigate to http://localhost:3000/settings and enter keys in the UI. Keys are stored in `localStorage` and sent with each request.

### 3. Install the Roblox Plugin

Copy `roblox-plugin/AIBuilder.lua` to your Roblox Studio Plugins folder:
- **Windows**: `%LocalAppData%\Roblox\Plugins\`
- **Mac**: `~/Documents/Roblox/Plugins/`

### 4. Enable HTTP Requests in Studio

1. Open Roblox Studio
2. Game Settings → Security → **Allow HTTP Requests** → ON

### 5. Start Everything

```bash
# Option A: Windows startup script
start.bat

# Option B: Manual (two terminals)
cd bridge-server && npm start      # Terminal 1
cd web-app && npm run dev          # Terminal 2

# Option C: Concurrent (from root)
npm run dev
```

### 6. Connect & Build

1. Open http://localhost:3000 in your browser
2. In Roblox Studio, click **"Connect"** in the AI Builder toolbar
3. Go to the **Builder** page
4. Select an AI model from the dropdown
5. Type a prompt: *"Build a medieval castle with a moat, drawbridge, and guard towers"*
6. Review the plan → Click **"Approve & Execute"**
7. Watch assets appear in Roblox Studio in real-time!

---

## Configuration

### Environment Variables

| Variable | Provider | Description |
|----------|----------|-------------|
| `BRIDGE_PORT` | — | Server port (default: 3456) |
| `ANTHROPIC_API_KEY` | Anthropic | Claude models |
| `OPENAI_API_KEY` | OpenAI | GPT models |
| `GOOGLE_API_KEY` | Google | Gemini models |
| `MISTRAL_API_KEY` | Mistral | Mistral/Pixtral models |
| `GROQ_API_KEY` | Groq | Fast inference (Llama, Gemma) |
| `HF_TOKEN` | HuggingFace | Open-source models |
| `AWS_BEDROCK_API_KEY` | AWS | Bedrock models |
| `AWS_REGION` | AWS | Bedrock region (default: us-east-1) |

### Plugin Configuration (in AIBuilder.lua)

| Constant | Default | Description |
|----------|---------|-------------|
| `BRIDGE_URL` | `http://localhost:3456/api` | Bridge server address |
| `POLL_INTERVAL` | `1` (second) | How often to fetch commands |
| `HEARTBEAT_INTERVAL` | `3` (seconds) | Connection keepalive |
| `STATE_EXPORT_INTERVAL` | `10` (seconds) | Full state sync frequency |

---

## Supported AI Models

### Tier 1 — Best Quality

| Model | Provider | Cost/1k tokens |
|-------|----------|---------------|
| Claude Opus 4.6 | Anthropic | $0.075 |
| GPT-5.4 Pro | OpenAI | $0.060 |
| Gemini 3.1 Pro | Google | $0.035 |

### Tier 2 — Balanced

| Model | Provider | Cost/1k tokens |
|-------|----------|---------------|
| Claude Sonnet 4.6 | Anthropic | $0.015 |
| GPT-5.4 Thinking | OpenAI | $0.030 |
| Mistral Large | Mistral | $0.002 |
| Pixtral Large | Mistral | $0.002 |

### Tier 3 — Fast & Cheap

| Model | Provider | Cost/1k tokens |
|-------|----------|---------------|
| Claude Haiku | Anthropic | $0.001 |
| GPT-5.3 Instant | OpenAI | $0.002 |
| Gemini 3 Flash | Google | $0.005 |
| Groq Llama 3.3 70B | Groq | $0.0006 |

### Tier 4 — Free / Self-Hosted

| Model | Provider | Cost |
|-------|----------|------|
| Llama 3.1 8B | HuggingFace | Free |
| Custom HF Model | HuggingFace | Free (Inference API) |
| Ollama Local | Ollama | Free (local GPU) |
| Ollama Tunnel | Ollama | Free (remote endpoint) |

---

## Features

| Feature | Description |
|---------|-------------|
| **3-Phase AI Pipeline** | Plan summary → user approval → canvas preview → deterministic execution |
| **Visual Canvas Layout** | Full-screen top-down 2D map with draggable assets; positions map 1:1 to Roblox studs; shows ALL positionable steps (parts + models) |
| **Smart Placement Engine** | AABB collision detection (8-stud padding), 80-position spiral search, grid fallback |
| **5-Phase Model Insertion** | Insert → GetBounds → ComputePlacement → Move (auto-ground correct) → Track |
| **Densify Pass** | Post-build 4×4 grid coverage analysis; auto-fills empty zones to meet density targets |
| **Compact State Serialization** | Models skip geometry children (~90% payload reduction); export retry on failure |
| **Reposition Agent** | LLM-powered layout optimizer on canvas — re-zones, re-spaces, and re-aligns all assets for best spatial layout |
| **Repair Mode (Fix Existing Game)** | Prompts like "fix/repair/improve existing game" trigger targeted repair planning instead of rebuilding from scratch |
| **Auto-Ground Coverage** | Detects if assets are placed outside existing baseplates and auto-creates ground to cover the build area |
| **Toolbox Terrain Cleanup** | Removes embedded terrain/grass/baseplate parts that come inside some free models to prevent floating islands |
| **Oversize Model Normalization** | Automatically scales down extremely large inserted models to keep worlds coherent |
| **Multi-Prompt Awareness** | Second prompts in the same thread auto-create new baseplates/ground when building in a new area (e.g. racing track next to a city) |
| **Asset Pre-Resolution** | All searchQuery → assetId resolved upfront via Roblox Toolbox API before execution |
| **10 Action Types** | create_part, insert_model, create_instance, set_lighting, create_effect, create_ui, insert_script, clone_instance, delete_instance, set_properties |
| **8 LLM Providers** | Anthropic, OpenAI, Google, Mistral, Groq, AWS Bedrock, HuggingFace, Ollama |
| **20+ AI Models** | From Claude Opus 4.6 to free local Ollama models |
| **Auto-Ground Correction** | move_instance auto-corrects pivot≠center offset so models sit exactly on ground |
| **Roblox Knowledge Base** | 50+ instance classes, 40+ materials, lighting/atmosphere, game patterns |
| **Auto-Verification** | Verifies each placed instance exists in Explorer after placement |
| **LLM Retry** | If a step fails, LLM is called with error + Symbol Map (max 2 retries) |
| **Live Progress** | Real-time progress bar and step-by-step activity feed |
| **Plan Preview** | Review AI's plan before execution, approve or modify |
| **Pause/Resume/Stop** | Full execution control with resume from current step |
| **Multi-Agent** | Run multiple agents in parallel on different tasks |
| **Workspace Locking** | Prevents parallel agents from conflicting on same objects |
| **Full State Sync** | Plugin exports compact hierarchy every 10s + after each command |
| **Smart Properties** | Auto-converts arrays to Vector3, Color3, UDim2, CFrame, Enum |
| **Fuzzy Path Resolution** | Case-insensitive, whitespace-normalized instance name matching |
| **Script Patching** | Line-level diffs (insert/replace/delete) instead of full replacement |
| **Asset Upload** | Drag-and-drop 3D models and textures (fbx, obj, gltf, png, mp3, rbxm) |
| **Dark/Light Theme** | Toggle-based CSS theme with smooth transitions |
| **Dual API Keys** | Server-side (.env) or client-side (Settings page) |
| **Version Tracking** | Script version numbers for conflict detection |
| **Snapshot Rollback** | Save/restore project state checkpoints |
| **Token Tracking** | Per-agent token usage monitoring |
| **Resizable Panels** | Drag to resize all 4 builder panels |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Bridge Disconnected" in web app | Bridge server not running | Run `cd bridge-server && npm start` |
| "Studio Disconnected" | Plugin not connected or heartbeat stale | Click "Connect" in Studio's AI Builder toolbar |
| "API key not configured" | No key for selected provider | Add key to `.env` or Settings page |
| "Allow HTTP Requests" error in Studio | Studio security blocks HTTP | Game Settings → Security → Allow HTTP Requests → ON |
| Floating green islands under inserted models | Free Toolbox model includes embedded terrain/baseplate | Update to latest plugin; insertion now auto-strips terrain-like child parts |
| Existing world gets rebuilt when prompt says "fix" | Planning treated request as new build | Use latest bridge server; fix/repair prompts now run in repair mode and target only broken/misplaced content |
| Model insertion finds no new instance | Plugin couldn't download model | Check Roblox catalog availability, try different searchQuery |
| Step fails repeatedly | LLM generated invalid command | Check activity feed for error details; retry with different model |
| Plugin doesn't appear in Studio | File not in Plugins folder | Verify `AIBuilder.lua` is in `%LocalAppData%\Roblox\Plugins\` |
| Plan has 0 steps | LLM returned invalid JSON | Try a different model (Claude Opus or GPT-5.4 Pro recommended) |
| Progress bar doesn't move | State not syncing | Ensure plugin is connected and commands are completing |

---

## License

Private project. All rights reserved.


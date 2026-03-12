# ðŸš€ RoboBuilder â€” AI-Powered Roblox Game Builder

Build complete Roblox games from a single text prompt. An AI agent plans, positions, and places every asset inside Roblox Studio â€” from terrain and roads to buildings, vehicles, lighting, UI, and game scripts.

---

## Table of Contents

- [High-Level Architecture](#high-level-architecture)
- [How It Works â€” End-to-End Flow](#how-it-works--end-to-end-flow)
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
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”      HTTP/REST       â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    HTTP Polling     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                     â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–º  â”‚                     â”‚  â—„â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–º  â”‚                     â”‚
â”‚    Web App          â”‚                       â”‚   Bridge Server     â”‚                     â”‚  Roblox Studio      â”‚
â”‚    (Next.js)        â”‚  â—„â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  â”‚   (Express.js)      â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–º    â”‚  Plugin (Lua)       â”‚
â”‚    localhost:3000   â”‚      JSON Responses   â”‚   localhost:3456    â”‚    Command Queue    â”‚                     â”‚
â”‚                     â”‚                       â”‚                     â”‚                     â”‚                     â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚                       â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚                     â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚ Builder Page  â”‚  â”‚                       â”‚  â”‚ Agent Runtime â”‚  â”‚                     â”‚  â”‚ Command       â”‚  â”‚
â”‚  â”‚ (4 panels)    â”‚  â”‚                       â”‚  â”‚ (3-Phase AI)  â”‚  â”‚                     â”‚  â”‚ Executor      â”‚  â”‚
â”‚  â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤  â”‚                       â”‚  â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤  â”‚                     â”‚  â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤  â”‚
â”‚  â”‚ Settings Page â”‚  â”‚                       â”‚  â”‚ LLM Providers â”‚  â”‚                     â”‚  â”‚ State         â”‚  â”‚
â”‚  â”‚ (API Keys)    â”‚  â”‚                       â”‚  â”‚ (8 providers) â”‚  â”‚                     â”‚  â”‚ Serializer    â”‚  â”‚
â”‚  â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤  â”‚                       â”‚  â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤  â”‚                     â”‚  â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤  â”‚
â”‚  â”‚ Landing Page  â”‚  â”‚                       â”‚  â”‚ Command Queue â”‚  â”‚                     â”‚  â”‚ Fuzzy Path    â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚                       â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚                     â”‚  â”‚ Resolver      â”‚  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                       â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                     â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Data Flow Summary:**

1. **User â†’ Web App**: Types a prompt like "Build a GTA-style city"
2. **Web App â†’ Bridge Server**: `POST /api/agents/:id/prompt` with prompt + model selection
3. **Bridge Server (Agent Runtime)**: Calls LLM to create a plan summary
4. **Bridge Server â†’ Web App**: Returns plan for user approval
5. **User approves â†’ Bridge Server**: Calls LLM for detailed build plan + pre-resolves all asset IDs
6. **Bridge Server â†’ Web App**: Returns detailed steps with positions; status = `awaiting_layout`
7. **Visual Canvas Preview**: User sees a top-down 2D map with every asset positioned; can drag to reposition
8. **Optional: Reposition Agent**: User clicks "Use Reposition Agent" â€” LLM optimizes all positions for spatial layout
9. **User confirms layout â†’ Bridge Server**: Updated positions sent back; auto-creates ground if assets are outside existing baseplates
10. **Bridge Server â†’ Plugin**: Commands placed in queue, plugin polls `GET /api/commands` every 1s
11. **Plugin â†’ Roblox Studio**: Executes each command using 5-phase smart insertion pipeline
12. **Plugin â†’ Bridge Server**: Reports results + exports compact project state back
13. **Bridge Server**: Verifies each step, runs densify pass to fill empty areas, proceeds to next

---

## How It Works â€” End-to-End Flow

```
                                            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                                            â”‚              USER INTERACTION             â”‚
                                            â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                                              â”‚
                                                  Types: "Build a GTA city"
                                                              â”‚
                                                              â–¼
                                            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                                            â”‚          PHASE 1: PLAN SUMMARY           â”‚
                                            â”‚                                          â”‚
                                            â”‚  LLM receives: System prompt + Explorer  â”‚
                                            â”‚  state + User request                    â”‚
                                            â”‚                                          â”‚
                                            â”‚  LLM returns: { title, summary, items }  â”‚
                                            â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                                              â”‚
                                                  User sees plan preview in UI
                                                  Clicks "Approve & Execute"
                                                              â”‚
                                                              â–¼
                                            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                                            â”‚        PHASE 2: DETAILED PLANNING        â”‚
                                            â”‚                                          â”‚
                                            â”‚  LLM generates ordered steps with exact  â”‚
                                            â”‚  positions, sizes, materials, asset IDs   â”‚
                                            â”‚                                          â”‚
                                            â”‚  Pre-resolves: searchQuery â†’ assetId     â”‚
                                            â”‚  via Roblox Toolbox API for all models    â”‚
                                            â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                                              â”‚
                                                              â–¼
                                            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                                            â”‚     VISUAL CANVAS LAYOUT PREVIEW         â”‚
                                            â”‚                                          â”‚
                                            â”‚  Top-down 2D map appears in web app      â”‚
                                            â”‚  Every asset shown as draggable box       â”‚
                                            â”‚  Color-coded by action type               â”‚
                                            â”‚  User drags assets to reposition them     â”‚
                                            â”‚  Positions map 1:1 to Roblox studs        â”‚
                                            â”‚                                          â”‚
                                            â”‚  Optional: "Use Reposition Agent" button  â”‚
                                            â”‚  â†’ LLM re-optimizes all positions         â”‚
                                            â”‚  â†’ Canvas updates, user can further edit  â”‚
                                            â”‚                                          â”‚
                                            â”‚  User clicks "Confirm Layout & Execute"   â”‚
                                            â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                                              â”‚
                                                              â–¼
                                            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                                            â”‚   AUTO-GROUND COVERAGE CHECK             â”‚
                                            â”‚   If assets outside existing baseplates   â”‚
                                            â”‚   â†’ auto-create ground to cover area      â”‚
                                            â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                                              â”‚
                                                              â–¼
                                            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                                            â”‚     PHASE 3: DETERMINISTIC EXECUTION     â”‚
                                            â”‚                                          â”‚
                                            â”‚  For each step (NO LLM calls):           â”‚
                                            â”‚                                          â”‚
                                            â”‚  insert_model uses 5-phase pipeline:     â”‚
                                            â”‚  â”Œâ”€ Insert â†’ GetBounds â†’ Compute â”€â”€â”€â”€â”€â” â”‚
                                            â”‚  â”‚  â†’ Move (auto-ground correct)       â”‚ â”‚
                                            â”‚  â”‚  â†’ Track in spatial map             â”‚ â”‚
                                            â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚
                                            â”‚                                          â”‚
                                            â”‚  If step fails â†’ LLM retry (max 2x)     â”‚
                                            â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                                              â”‚
                                                              â–¼
                                            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                                            â”‚          DENSIFY PASS (POST-BUILD)       â”‚
                                            â”‚                                          â”‚
                                            â”‚  Analyzes 4Ã—4 coverage grid:             â”‚
                                            â”‚  - Counts objects per zone per type       â”‚
                                            â”‚  - Identifies empty/sparse areas          â”‚
                                            â”‚  - LLM generates fill steps               â”‚
                                            â”‚  - Executes additional placements          â”‚
                                            â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 3-Phase Deterministic Pipeline

The core innovation is a **3-phase pipeline** where the LLM is only called **twice** (once for summary, once for detailed plan), with a **visual canvas layout preview** between planning and execution. The runtime then executes deterministically:

### Phase 1 â€” Plan Summary (LLM Call #1)

| Input | Output |
|-------|--------|
| User prompt + Explorer state | `{ title, summary, items[] }` |

- Short, human-readable summary for approval
- No coordinates or technical details
- Displayed in the web app's plan preview panel

### Phase 2 â€” Detailed Plan (LLM Call #2)

| Input | Output |
|-------|--------|
| Approved summary + Explorer state + full Roblox knowledge | `{ title, summary, steps[] }` |

Each step has:
```json
{
  "id": 1,
  "action": "create_part | insert_model | create_instance | set_lighting | create_effect | create_ui | insert_script | clone_instance | delete_instance",
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

### Phase 3 â€” Deterministic Execution (No LLM)

Before execution, the user sees a **Visual Canvas Layout Preview** â€” a full-screen top-down 2D map showing every asset at its planned position. Assets can be dragged to new positions. When the user confirms the layout, the runtime converts each plan step directly into plugin commands:

```
Plan Step                    â†’    Plugin Command
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create_part                  â†’    create_instance
insert_model                 â†’    insert_free_model â†’ get_bounds â†’ compute_placement â†’ move_instance
create_instance              â†’    create_instance
set_lighting                 â†’    set_properties (path: "Lighting")
create_effect                â†’    create_instance (parent: "Lighting")
create_ui                    â†’    create_ui
insert_script                â†’    insert_script
clone_instance               â†’    clone_instance
delete_instance              â†’    delete_instance
```

The **insert_model** action uses a **5-phase smart insertion pipeline**:
1. **Insert**: Download model from Roblox Toolbox via `insert_free_model`
2. **GetBounds**: Plugin reads `Model:GetBoundingBox()` to get real dimensions
3. **ComputePlacement**: PlacementEngine finds collision-free position using AABB detection + spiral search
4. **Move**: `move_instance` with auto-ground correction (corrects pivotâ‰ center offset)
5. **Track**: Record placement in spatial map for collision avoidance

**LLM is only re-invoked if a step fails** (max 2 retries per step), with the current Symbol Map provided for context.

---

## Component Deep Dive

### 1. Web App (Next.js) â€” localhost:3000

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS Modules

**Pages:**

| Page | Route | Description |
|------|-------|-------------|
| Landing | `/` | Hero page with feature overview |
| Builder | `/builder` | Main 4-panel workspace |
| Settings | `/settings` | API key management (stored in localStorage) |

**Builder Page â€” 4 Resizable Panels:**

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚         â”‚              â”‚          â”‚          â”‚
â”‚ PROMPT  â”‚  ACTIVITY    â”‚  AGENTS  â”‚ PROJECT  â”‚
â”‚ PANEL   â”‚  FEED        â”‚  LIST    â”‚ TREE     â”‚
â”‚         â”‚              â”‚          â”‚          â”‚
â”‚ - Model â”‚  - Plan      â”‚  - Agent â”‚ - Full   â”‚
â”‚   selectâ”‚    preview   â”‚    cards â”‚   Explorerâ”‚
â”‚ - Text  â”‚  - Step-by-  â”‚  - Statusâ”‚   hierarchyâ”‚
â”‚   input â”‚    step logs â”‚    dots  â”‚ - Classes â”‚
â”‚ - Screenâ”‚  - Progress  â”‚  - New   â”‚ - Props  â”‚
â”‚   shot  â”‚    bar       â”‚    agent â”‚          â”‚
â”‚ - Asset â”‚  - Approve/  â”‚    btn   â”‚          â”‚
â”‚   ID    â”‚    Modify    â”‚          â”‚          â”‚
â”‚ - Send  â”‚              â”‚          â”‚          â”‚
â”‚ - Pause â”‚              â”‚          â”‚          â”‚
â”‚   Resumeâ”‚              â”‚          â”‚          â”‚
â”‚   Stop  â”‚              â”‚          â”‚          â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
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

### 2. Bridge Server (Express) â€” localhost:3456

**Tech Stack:** Express.js, CORS, multer for file uploads, 50MB body limit

**Module Map:**

```
bridge-server/src/
â”œâ”€â”€ index.js              â† Express app setup, middleware, route mounting
â”œâ”€â”€ config.js             â† Port, provider configs, API keys, paths
â”‚
â”œâ”€â”€ routes/
â”‚   â”œâ”€â”€ agent.js          â† CRUD for agents, prompt, approve, pause/resume/stop
â”‚   â”œâ”€â”€ bridge.js         â† Plugin communication: command polling, results, state
â”‚   â”œâ”€â”€ assets.js         â† File upload/download (multer, 50MB limit)
â”‚   â””â”€â”€ models.js         â† List all available LLM models
â”‚
â”œâ”€â”€ agent/
â”‚   â”œâ”€â”€ runtime.js        â† â˜… CORE: 3-phase deterministic pipeline (28 methods)
â”‚   â”œâ”€â”€ agentPool.js      â† Agent factory + registry (Map<id, AgentRuntime>)
â”‚   â”œâ”€â”€ providers.js      â† Multi-LLM adapter (8 providers, unified interface)
â”‚   â”œâ”€â”€ stateManager.js   â† Central project state + version tracking
â”‚   â”œâ”€â”€ codeAnalyzer.js   â† Parses project state â†’ Symbol Map for AI context
â”‚   â”œâ”€â”€ placementEngine.jsâ† Spatial guidance (ground Y, baseplate bounds, slots)
â”‚   â”œâ”€â”€ assetCatalog.js   â† Roblox Catalog v2 API search via roproxy
â”‚   â”œâ”€â”€ validator.js      â† Command validation + auto-repair (18 command types)
â”‚   â”œâ”€â”€ lockManager.js    â† Workspace area locking for multi-agent safety
â”‚   â””â”€â”€ memory.js         â† Conversation history, plan, snapshots, token tracking
â”‚
â”œâ”€â”€ queue/
â”‚   â””â”€â”€ commandQueue.js   â† FIFO queue: enqueue â†’ dequeue â†’ reportResult
â”‚
â””â”€â”€ prompts/
    â””â”€â”€ system.js         â† All LLM system prompts + Roblox knowledge base
```

**Agent Runtime â€” Core Methods:**

```
                      AgentRuntime
    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
    â”‚                                           â”‚
    â”‚  Lifecycle:                                â”‚
    â”‚    constructor(id, llm, config)            â”‚
    â”‚    start(prompt, modelId, apiKeys)         â”‚
    â”‚    approvePlan()                           â”‚
    â”‚    confirmLayout()     â† canvas â†’ execute  â”‚
    â”‚    updatePositions()   â† canvas drag edits  â”‚
    â”‚    repositionLayout()  â† LLM layout agent   â”‚
    â”‚    pause()                                 â”‚
    â”‚    resume() â†’ _resumeLoop()               â”‚
    â”‚    stop()                                  â”‚
    â”‚                                           â”‚
    â”‚  Phase 2:                                  â”‚
    â”‚    _buildDetailedPlan()                    â”‚
    â”‚    _preResolveAssets() â† Toolbox API       â”‚
    â”‚    _executeAfterLayout()                   â”‚
    â”‚    _ensureGroundCoverage() â† auto-baseplateâ”‚
    â”‚                                           â”‚
    â”‚  Phase 3 â€” Execution:                      â”‚
    â”‚    _executeLoop()                          â”‚
    â”‚    _executeCreatePart(step)                â”‚
    â”‚    _executeInsertModel(step) â† 5-phase     â”‚
    â”‚    _executeInsertScript(step)              â”‚
    â”‚    _executeCreateInstance(step)            â”‚
    â”‚    _executeSetLighting(step)               â”‚
    â”‚    _executeCreateEffect(step)              â”‚
    â”‚    _executeCreateUI(step)                  â”‚
    â”‚    _executeCloneInstance(step)             â”‚
    â”‚    _executeDeleteInstance(step)            â”‚
    â”‚                                           â”‚
    â”‚  Post-Build:                               â”‚
    â”‚    _densifyPass() â† coverage analysis       â”‚
    â”‚                                           â”‚
    â”‚  Recovery:                                 â”‚
    â”‚    _llmRetryStep(step) â€” max 2 retries    â”‚
    â”‚                                           â”‚
    â”‚  Helpers:                                  â”‚
    â”‚    _refreshState()                         â”‚
    â”‚    _getWorkspaceChildNames()               â”‚
    â”‚    _verifyInstanceExists(name)             â”‚
    â”‚    _extractJsonFromResponse(content)       â”‚
    â”‚    _waitForCommands(ids, timeout)          â”‚
    â”‚    _trackPlacement(name, position, size)   â”‚
    â”‚                                           â”‚
    â”‚  State:                                    â”‚
    â”‚    log(type, message, data)                â”‚
    â”‚    updateProjectState(state)               â”‚
    â”‚    getStatus() â†’ {progress, plan, ...}     â”‚
    â”‚    getActivity(limit)                      â”‚
    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

### 3. Roblox Studio Plugin (Lua)

**File:** `roblox-plugin/AIBuilder.lua`

**How it connects:**

```
Plugin starts â†’ User clicks "Connect" button
       â”‚
       â–¼
  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
  â”‚  THREE CONCURRENT LOOPS:                              â”‚
  â”‚                                                      â”‚
  â”‚  1. Command Polling Loop (every 1s)                  â”‚
  â”‚     GET /api/commands â†’ execute â†’ POST /result       â”‚
  â”‚     After EVERY command: force state export           â”‚
  â”‚                                                      â”‚
  â”‚  2. Heartbeat Loop (every 3s)                        â”‚
  â”‚     POST /api/heartbeat                              â”‚
  â”‚                                                      â”‚
  â”‚  3. State Export Loop (every 10s)                     â”‚
  â”‚     Serializes FULL project hierarchy â†’ POST          â”‚
  â”‚     /api/project-state                               â”‚
  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Plugin Command Handlers (14 types):**

| Command | What it does |
|---------|-------------|
| `create_instance` | `Instance.new(className)` â€” any Roblox class |
| `insert_free_model` | Search Roblox catalog â†’ `game:GetObjects()` or `InsertService:LoadAsset()` |
| `set_properties` | Resolve path â†’ set properties (auto-handles Model:MoveTo, Color3, Vector3, Enum, UDim2) |
| `delete_instance` | Resolve path â†’ `Instance:Destroy()` |
| `insert_script` | Create Script/LocalScript/ModuleScript with source code |
| `update_script` | Replace entire script source |
| `patch_script` | Line-level diffs (replace, insert, delete) â€” preserves unchanged lines |
| `create_ui` | Recursive UI tree creation (ScreenGui â†’ Frames â†’ Labels â†’ Layouts) |
| `move_instance` | Reposition an instance with auto-ground correction (PivotTo + bbox center offset fix) |
| `reparent_instance` | Move an instance to a new parent (reparenting) |
| `clone_instance` | `Instance:Clone()` with optional rename and reparent |
| `snapshot` | Save project state for rollback |
| `export_state` | Serialize + send compact hierarchy to bridge server (with retry on failure) |
| `batch` | Execute multiple commands in sequence |

**Smart Property Setter:**
The plugin's `setProperties()` function handles all Roblox types automatically:
- `[x, y, z]` â†’ `Vector3.new(x, y, z)`
- `[r, g, b]` on Color keys â†’ `Color3.fromRGB(r, g, b)`
- `[sx, ox, sy, oy]` â†’ `UDim2.new(sx, ox, sy, oy)`
- String enum values â†’ auto-resolved via brute-force Enum search
- Model positioning â†’ `Model:MoveTo()` / `Model:PivotTo()`
- Model anchoring â†’ propagated to all descendant BaseParts

**State Serializer (Compact):**
Recursively serializes the project tree (depth limit: 10) with **compact mode** â€” Models skip geometry children (BaseParts, child Models, Accessories) when bounding box data is available, reducing payload by ~90%. Includes:
- Services: Workspace, ServerScriptService, ReplicatedStorage, StarterGui, StarterPlayer, Lighting, ServerStorage
- Each instance: `_class`, `_name`, `_properties` (Position, Size, PivotPosition, BoundingSize, Anchored, Material, Color, etc.)
- Scripts: `_source` field with full Lua source code
- Duplicate name handling: `Name__2`, `Name__3` suffix convention
- Export failure detection: retries on nil return from `HttpService:PostAsync`

**Path Resolution:**
Uses fuzzy matching: exact match â†’ `Name__ordinal` convention â†’ case-insensitive match â†’ `FindFirstChild` fallback

---

## Agent Runtime Architecture

### State Machine

```
                  start()
    idle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–º planning
                                   â”‚
                          LLM returns summary
                                   â”‚
                                   â–¼
                          awaiting_approval
                                   â”‚
                          approvePlan()
                                   â”‚
                                   â–¼
                           (generating plan)
                                   â”‚
                          LLM returns detailed steps
                          Pre-resolves all asset IDs
                                   â”‚
                                   â–¼
                          awaiting_layout  â—„â”€â”€ updatePositions()
                            /      â”‚   â–²          (from canvas)
                           /       â”‚   â”‚
                          /        â”‚  repositionLayout()
                         /         â”‚   (LLM re-optimizes,
                        /          â”‚    stays in awaiting_layout)
                       /   confirmLayout()
                         â–¼        â”‚
                             executing â—„â”€â”€â”€â”€â”€â”€ resume()
                            /    â”‚    \           â–²
                   step ok /     â”‚     \ step     â”‚
                          /      â”‚      \ fails   â”‚
                         â–¼       â”‚       â–¼        â”‚
                     (next     pause()  _llmRetryStep()
                      step)      â”‚      (max 2x)
                         \       â–¼       /
                          \   paused â”€â”€â”€â”˜
                           \    â”‚
                            â–¼   â”‚ stop()
                          complete â—„â”€â”€â”€â”€ all steps done
                                         + densifyPass()
                                â”‚
                                â–¼
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
│  [🤖 Reposition]  [Confirm & Execute]  [Skip]      │
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
   â”‚                            â”‚                         â”‚
   â”‚  enqueue(type, payload)    â”‚                         â”‚
   â”‚ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–º â”‚                         â”‚
   â”‚         returns {id}       â”‚                         â”‚
   â”‚                            â”‚     GET /api/commands   â”‚
   â”‚                            â”‚ â—„â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  â”‚
   â”‚                            â”‚     [cmd1, cmd2, ...]   â”‚
   â”‚                            â”‚ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–º  â”‚
   â”‚                            â”‚                         â”‚
   â”‚                            â”‚                   cmd.status = 'sent'
   â”‚                            â”‚                         â”‚
   â”‚                            â”‚                    EXECUTE IN
   â”‚                            â”‚                    ROBLOX STUDIO
   â”‚                            â”‚                         â”‚
   â”‚                            â”‚   POST /commands/:id/   â”‚
   â”‚                            â”‚   result                â”‚
   â”‚                            â”‚ â—„â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  â”‚
   â”‚                            â”‚   {success, result}     â”‚
   â”‚                            â”‚                         â”‚
   â”‚  _waitForCommands([id])    â”‚                         â”‚
   â”‚  (polls every 500ms)       â”‚                         â”‚
   â”‚  status = completed âœ“      â”‚                         â”‚
   â”‚ â—„â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ â”‚                         â”‚
```

### Command Queue States

```
pending â†’ sent â†’ completed
                â†’ failed
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
2. **Client-side** (Settings page â†’ localStorage): User keys, sent with each request and override server keys

```
User's key (from request) â†’ used if present
         â†“ fallback
Server .env key â†’ used if present
         â†“ fallback
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
      â—  â† intended position (collision!)
    Ring 1: 8 positions at 45Â° intervals, 8 studs out
    Ring 2: 8 positions at 45Â° intervals, 16 studs out
    Ring 3: 8 positions at 45Â° intervals, 24 studs out
    ...up to Ring 10 (80 studs out)

    Total: 10 rings Ã— 8 directions = 80 candidate positions
    First collision-free spot wins.
```

### Grid Fallback
If all 80 spiral positions are occupied, falls back to a grid search across the full build area.

### Coverage Analysis (`analyzeCoverage()`)
Divides the world into a **4Ã—4 grid** of zones and counts objects by type:
- **Categories**: buildings, vehicles, trees, lights, props
- **Per zone**: object count, type breakdown
- **Output**: identifies empty zones, sparse zones, and generates a `coverageReport` string for the LLM

---

## Densify Pass

After the initial build completes, the runtime automatically runs a **densify pass** to fill empty areas:

```
Initial Build Complete
        â”‚
        â–¼
  analyzeCoverage() â†’ 4Ã—4 grid analysis
        â”‚
  Check thresholds:
    â”œâ”€ 2+ empty zones?
    â”œâ”€ < 8 trees?
    â”œâ”€ < 4 vehicles?
    â”œâ”€ < 5 lights?
    â””â”€ < 6 props?
        â”‚
  If any threshold unmet:
        â”‚
        â–¼
  LLM call with DENSIFY_PROMPT
  + empty zone coordinates
  + current object counts
        â”‚
        â–¼
  Generate fill steps
  (target specific empty zones)
        â”‚
        â–¼
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
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
POST /api/project-state  â”€â”€â–º  bridge.js receives   â”€â”€â–º  stateManager.updateProjectState()
                              projectState = body         Traverses tree, bumps versions
                              agentPool.updateProjectState()
                                                          Runtime reads via:
                                                          â€¢ _getWorkspaceChildNames()
                                                          â€¢ _verifyInstanceExists()
                                                          â€¢ CodeAnalyzer (Symbol Map)
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
| `GET` | `/api/agents` | List all agents | â€” | `{ agents: [...] }` |
| `POST` | `/api/agents` | Create agent | `{ name }` | `{ id, name, status }` |
| `GET` | `/api/agents/:id` | Get agent details | â€” | `{ id, status, plan, progress, ... }` |
| `DELETE` | `/api/agents/:id` | Delete agent | â€” | `{ success: true }` |
| `POST` | `/api/agents/:id/prompt` | Start build | `{ prompt, modelId, apiKeys? }` | `{ status, plan }` |
| `GET` | `/api/agents/:id/plan` | Get current plan | â€” | `{ plan, status }` |
| `POST` | `/api/agents/:id/plan/approve` | Approve plan | â€” | `{ status: "executing" }` |
| `POST` | `/api/agents/:id/plan/update-positions` | Update step positions from canvas | `{ positions: [{id, position}] }` | `{ success: true }` |
| `POST` | `/api/agents/:id/plan/confirm-layout` | Confirm canvas layout, start execution | â€” | `{ status: "executing" }` |
| `POST` | `/api/agents/:id/plan/reposition` | LLM reposition agent optimizes layout | â€” | `{ success, repositioned, steps }` |
| `GET` | `/api/agents/:id/activity` | Get activity log | `?limit=50` | `{ activity: [...] }` |
| `POST` | `/api/agents/:id/pause` | Pause execution | â€” | `{ status: "paused" }` |
| `POST` | `/api/agents/:id/resume` | Resume execution | â€” | `{ status: "executing" }` |
| `POST` | `/api/agents/:id/stop` | Stop agent | â€” | `{ status: "idle" }` |

### Bridge Endpoints (Plugin â†” Server)

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
â”‚
â”œâ”€â”€ README.md                        â† This file
â”œâ”€â”€ package.json                     â† Workspace root (npm workspaces)
â”œâ”€â”€ start.bat                        â† Windows startup script
â”‚
â”œâ”€â”€ bridge-server/                   â† Express.js backend (port 3456)
â”‚   â”œâ”€â”€ package.json
â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â”œâ”€â”€ index.js                 â† App init, middleware, route mounting
â”‚   â”‚   â”œâ”€â”€ config.js                â† All configuration (providers, paths, costs)
â”‚   â”‚   â”‚
â”‚   â”‚   â”œâ”€â”€ agent/
â”‚   â”‚   â”‚   â”œâ”€â”€ runtime.js           â† â˜… CORE: 3-phase agent pipeline + canvas layout + densify
â”‚   â”‚   â”‚   â”œâ”€â”€ agentPool.js         â† Agent creation + registry
â”‚   â”‚   â”‚   â”œâ”€â”€ providers.js         â† 8 LLM providers, unified chat() interface
â”‚   â”‚   â”‚   â”œâ”€â”€ stateManager.js      â† Central project state + version tracking
â”‚   â”‚   â”‚   â”œâ”€â”€ codeAnalyzer.js      â† Project â†’ Symbol Map for LLM context
â”‚   â”‚   â”‚   â”œâ”€â”€ placementEngine.js   â† Smart placement (AABB collision, spiral search, coverage analysis)
â”‚   â”‚   â”‚   â”œâ”€â”€ assetCatalog.js      â† Roblox Toolbox API search (category 10 = Models)
â”‚   â”‚   â”‚   â”œâ”€â”€ validator.js         â† Command validation + auto-repair
â”‚   â”‚   â”‚   â”œâ”€â”€ lockManager.js       â† Multi-agent workspace locking
â”‚   â”‚   â”‚   â””â”€â”€ memory.js            â† Conversation, plan, snapshots persistence
â”‚   â”‚   â”‚
â”‚   â”‚   â”œâ”€â”€ prompts/
â”‚   â”‚   â”‚   â””â”€â”€ system.js            â† LLM prompts + Roblox knowledge base
â”‚   â”‚   â”‚                              (materials, classes, colors, patterns, scale)
â”‚   â”‚   â”‚
â”‚   â”‚   â”œâ”€â”€ queue/
â”‚   â”‚   â”‚   â””â”€â”€ commandQueue.js      â† FIFO command queue (pendingâ†’sentâ†’completed)
â”‚   â”‚   â”‚
â”‚   â”‚   â””â”€â”€ routes/
â”‚   â”‚       â”œâ”€â”€ agent.js             â† Agent CRUD + control endpoints
â”‚   â”‚       â”œâ”€â”€ bridge.js            â† Plugin communication endpoints
â”‚   â”‚       â”œâ”€â”€ assets.js            â† File upload (multer, 50MB limit)
â”‚   â”‚       â””â”€â”€ models.js            â† List available LLM models
â”‚   â”‚
â”‚   â””â”€â”€ data/
â”‚       â”œâ”€â”€ assetDatabase.json       â† Local asset metadata cache
â”‚       â”œâ”€â”€ sessions/                â† Agent memory persistence (per-session JSON)
â”‚       â”œâ”€â”€ uploads/                 â† User-uploaded files
â”‚       â””â”€â”€ vector_db/              â† Vector search index
â”‚
â”œâ”€â”€ web-app/                         â† Next.js 16 frontend (port 3000)
â”‚   â”œâ”€â”€ package.json
â”‚   â”œâ”€â”€ next.config.ts
â”‚   â”œâ”€â”€ tsconfig.json
â”‚   â””â”€â”€ src/
â”‚       â”œâ”€â”€ app/
â”‚       â”‚   â”œâ”€â”€ layout.tsx           â† Root layout with sidebar + theme
â”‚       â”‚   â”œâ”€â”€ page.tsx             â† Landing page
â”‚       â”‚   â”œâ”€â”€ builder/
â”‚       â”‚   â”‚   â”œâ”€â”€ page.tsx         â† â˜… Main builder (4-panel workspace)
â”‚       â”‚   â”‚   â””â”€â”€ builder.module.css
â”‚       â”‚   â””â”€â”€ settings/
â”‚       â”‚       â”œâ”€â”€ page.tsx         â† API key management page
â”‚       â”‚       â””â”€â”€ settings.module.css
â”‚       â”œâ”€â”€ components/
â”‚       â”‚   â”œâ”€â”€ Sidebar.tsx          â† Navigation sidebar
â”‚       â”‚   â”œâ”€â”€ ThemeProvider.tsx     â† Dark/light theme toggle
â”‚       â”‚   â””â”€â”€ MainContentAdjuster.tsx
â”‚       â”œâ”€â”€ contexts/
â”‚       â”‚   â””â”€â”€ SidebarContext.tsx    â† Sidebar state management
â”‚       â””â”€â”€ lib/
â”‚           â””â”€â”€ api.ts               â† API client (all fetch calls)
â”‚
â””â”€â”€ roblox-plugin/                   â† Roblox Studio plugin
    â””â”€â”€ AIBuilder.lua                â† Command executor + compact state serializer
                                       (13 command handlers, fuzzy path resolver,
                                        smart property setter, auto-ground correction,
                                        recursive UI builder)
```

---

## Quick Start

### Prerequisites

- **Node.js** 18+ â€” [nodejs.org](https://nodejs.org)
- **Roblox Studio** â€” [roblox.com/create](https://roblox.com/create)
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
2. Game Settings â†’ Security â†’ **Allow HTTP Requests** â†’ ON

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
6. Review the plan â†’ Click **"Approve & Execute"**
7. Watch assets appear in Roblox Studio in real-time!

---

## Configuration

### Environment Variables

| Variable | Provider | Description |
|----------|----------|-------------|
| `BRIDGE_PORT` | â€” | Server port (default: 3456) |
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

### Tier 1 â€” Best Quality

| Model | Provider | Cost/1k tokens |
|-------|----------|---------------|
| Claude Opus 4.6 | Anthropic | $0.075 |
| GPT-5.4 Pro | OpenAI | $0.060 |
| Gemini 3.1 Pro | Google | $0.035 |

### Tier 2 â€” Balanced

| Model | Provider | Cost/1k tokens |
|-------|----------|---------------|
| Claude Sonnet 4.6 | Anthropic | $0.015 |
| GPT-5.4 Thinking | OpenAI | $0.030 |
| Mistral Large | Mistral | $0.002 |
| Pixtral Large | Mistral | $0.002 |

### Tier 3 â€” Fast & Cheap

| Model | Provider | Cost/1k tokens |
|-------|----------|---------------|
| Claude Haiku | Anthropic | $0.001 |
| GPT-5.3 Instant | OpenAI | $0.002 |
| Gemini 3 Flash | Google | $0.005 |
| Groq Llama 3.3 70B | Groq | $0.0006 |

### Tier 4 â€” Free / Self-Hosted

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
| **3-Phase AI Pipeline** | Plan summary â†’ user approval â†’ canvas preview â†’ deterministic execution |
| **Visual Canvas Layout** | Full-screen top-down 2D map with draggable assets; positions map 1:1 to Roblox studs; shows ALL positionable steps (parts + models) |
| **Smart Placement Engine** | AABB collision detection (8-stud padding), 80-position spiral search, grid fallback |
| **5-Phase Model Insertion** | Insert â†’ GetBounds â†’ ComputePlacement â†’ Move (auto-ground correct) â†’ Track |
| **Densify Pass** | Post-build 4Ã—4 grid coverage analysis; auto-fills empty zones to meet density targets |
| **Compact State Serialization** | Models skip geometry children (~90% payload reduction); export retry on failure |
| **Reposition Agent** | LLM-powered layout optimizer on canvas â€” re-zones, re-spaces, and re-aligns all assets for best spatial layout |
| **Auto-Ground Coverage** | Detects if assets are placed outside existing baseplates and auto-creates ground to cover the build area |
| **Multi-Prompt Awareness** | Second prompts in the same thread auto-create new baseplates/ground when building in a new area (e.g. racing track next to a city) |
| **Asset Pre-Resolution** | All searchQuery â†’ assetId resolved upfront via Roblox Toolbox API before execution |
| **9 Action Types** | create_part, insert_model, create_instance, set_lighting, create_effect, create_ui, insert_script, clone_instance, delete_instance |
| **8 LLM Providers** | Anthropic, OpenAI, Google, Mistral, Groq, AWS Bedrock, HuggingFace, Ollama |
| **20+ AI Models** | From Claude Opus 4.6 to free local Ollama models |
| **Auto-Ground Correction** | move_instance auto-corrects pivotâ‰ center offset so models sit exactly on ground |
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
| "Allow HTTP Requests" error in Studio | Studio security blocks HTTP | Game Settings â†’ Security â†’ Allow HTTP Requests â†’ ON |
| Model insertion finds no new instance | Plugin couldn't download model | Check Roblox catalog availability, try different searchQuery |
| Step fails repeatedly | LLM generated invalid command | Check activity feed for error details; retry with different model |
| Plugin doesn't appear in Studio | File not in Plugins folder | Verify `AIBuilder.lua` is in `%LocalAppData%\Roblox\Plugins\` |
| Plan has 0 steps | LLM returned invalid JSON | Try a different model (Claude Opus or GPT-5.4 Pro recommended) |
| Progress bar doesn't move | State not syncing | Ensure plugin is connected and commands are completing |

---

## License

Private project. All rights reserved.

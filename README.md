# 🤖 RoboBuilder — AI Agent for Roblox Studio

RoboBuilder lets you build complex Roblox games from a single text prompt. It uses a **Master-Worker AI agent architecture** to plan, decompose, and execute multi-step builds inside Roblox Studio in real time.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Web App (Next.js · port 3000)                                  │
│  ┌───────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │  Prompt Panel │  │  Activity Feed  │  │  Agents Panel    │  │
│  │  Model select │  │  Plan Preview   │  │  Worker Inspector│  │
│  │  Modify/Approve│  │  Progress bar  │  │  Project Tree    │  │
│  └───────────────┘  └─────────────────┘  └──────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP REST API
                             ▼
┌────────────────────────────────────────────────────────────────┐
│  Bridge Server (Express · port 3456)                           │
│                                                                │
│  AgentRuntime (Master Agent)                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Phase 1: Summary Generation (awaiting_approval)         │   │
│  │ Phase 2: Detailed Planning (40-55 steps)                │   │
│  │ Phase 3: Domain Decomposition → Worker Agents           │   │
│  │ Phase 4: Parallel Execution (WorkerAgents)              │   │
│  │ Phase 5: Post-Placement Correction                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                │
│  WorkerAgent × N (one per domain: Roads, Buildings, etc.)      │
│  ┌───────────────────────────────────────────────────────┐     │
│  │ Executes steps: create_part, insert_model,            │     │
│  │ insert_script, create_ui, set_lighting, etc.          │     │
│  │ Fallback: builds from primitives if Toolbox fails     │     │
│  └───────────────────────────────────────────────────────┘     │
│                                                                │
│  CommandQueue ← → Roblox Plugin (poll every 1s)               │
│  PlacementEngine    StateManager    AssetCatalog               │
└───────────────────────────────────────────────────────────────-┘
                             │ HTTP poll (port 3456)
                             ▼
┌────────────────────────────────────────────────────────────────┐
│  Roblox Studio Plugin (AIBuilder.lua)                          │
│  Polls /api/commands → executes → reports result               │
│  Syncs Explorer state (project tree) back to server            │
└────────────────────────────────────────────────────────────────┘
```

---

## Build Flow

1. **User types a prompt** in the Web App and selects an LLM model
2. **Summary Generation** — Master Agent generates a high-level plan (5-10 bullet points) and waits for user approval (`awaiting_approval`)
3. **User clicks Approve** (or **Modify** to edit and re-submit the prompt)
4. **Detailed Planning** — Master Agent generates 40-55 granular build steps as a JSON plan with `action`, `name`, `position`, `searchQuery`, etc.
5. **Canvas Preview** — Steps are shown in an interactive 3D layout preview (Three.js). User can drag objects and reposition before confirming.
6. **User confirms layout** → execution begins
7. **Domain Decomposition** — Master splits steps into domains (Roads, Buildings, Vehicles, Lighting, etc.)
8. **Parallel Execution** — Each domain runs on a dedicated `WorkerAgent`
   - `create_part` → creates a BasePart
   - `insert_model` → searches Roblox Toolbox for a 3D model, falls back to primitives
   - `insert_script` → creates a Script/LocalScript/ModuleScript with source
   - `create_ui` → builds ScreenGui elements
   - `set_lighting`, `create_effect`, `set_properties`, etc.
9. **PlacementEngine** — Collision-aware positioning: finds free slots, prevents overlap, ground-corrects Y
10. **Post-Placement Correction** — After all workers finish, LLM analyzes actual bounds and repositions overlapping objects
11. **Done** — Studio shows the completed build

---

## LLM Providers & Token Limits

| Provider | Models | Max Output Tokens |
|---|---|---|
| **Anthropic** | Claude 3.5 Sonnet, Haiku | 8,192 |
| **OpenAI** | GPT-4o, GPT-4o-mini | 16,384 |
| **Google** | Gemini 2.5 Flash, Flash-Lite, 2.0 Flash | 65,536 |
| **Groq** | Llama 3.3 70B, 3.1 8B | 32,768 |
| **Mistral** | Mistral Large, Codestral | 32,768 |
| **HuggingFace** | DeepSeek, Qwen, custom | 8,192 |
| **Ollama** | Any local model | 32,768 |
| **AWS Bedrock** | Claude, Titan | 8,192 |

---

## Project Structure

```
ROBLOX/
├── bridge-server/          # Node.js Express backend
│   ├── src/
│   │   ├── agent/
│   │   │   ├── runtime.js          # Master AgentRuntime
│   │   │   ├── workerAgent.js      # WorkerAgent (parallel executors)
│   │   │   ├── providers.js        # LLM provider adapters
│   │   │   ├── placementEngine.js  # Collision-free 3D placement
│   │   │   ├── assetCatalog.js     # Roblox Toolbox search
│   │   │   ├── stateManager.js     # Project state sync
│   │   │   ├── agentPool.js        # Agent lifecycle manager
│   │   │   ├── lockManager.js      # Domain concurrency locks
│   │   │   └── validator.js        # Command schema validation
│   │   ├── prompts/
│   │   │   ├── system.js           # SUMMARY_PROMPT, DETAILED_PLAN_PROMPT
│   │   │   └── workers.js          # DOMAIN_DECOMPOSITION_PROMPT, POST_PLACEMENT_CORRECTION_PROMPT
│   │   ├── queue/
│   │   │   └── commandQueue.js     # Command queue (Plugin polls this)
│   │   └── routes/
│   │       ├── agent.js            # /api/agents REST endpoints
│   │       └── ...                 # project-state, plugin, models, etc.
│   └── package.json
│
├── web-app/                # Next.js frontend
│   └── src/
│       ├── app/
│       │   ├── page.tsx            # Landing page
│       │   ├── builder/page.tsx    # Main builder UI
│       │   └── settings/page.tsx   # API key configuration
│       ├── components/
│       │   └── CanvasPreview.tsx   # Three.js 3D layout preview
│       └── lib/api.ts              # Bridge server API client
│
└── roblox-plugin/
    └── AIBuilder.lua       # Roblox Studio plugin
```

---

## Quick Start

### Prerequisites
- Node.js 18+
- Roblox Studio with Plugin API enabled

### 1. Install & Start
```bash
# Install all dependencies
npm install

# Start everything (bridge server + web app)
npm run dev
```

- Web UI: http://localhost:3000
- Bridge API: http://localhost:3456/api

### 2. Configure API Keys
Go to **Settings** in the web app and enter API keys for your chosen LLM provider.

### 3. Install the Plugin
Open Roblox Studio → Plugins → Open Script and run:
```
c:\Users\karan\Desktop\ROBLOX\roblox-plugin\AIBuilder.lua
```
Or copy it directly into a Script in ServerScriptService and publish it as a plugin.

### 4. Build
1. In the Web App, select your LLM model
2. Type a build prompt: *"Create an open-world city with roads, skyscrapers, vehicles, trees, and a police station"*
3. Click **Send to Agent →**
4. Review the summary plan → click **Approve & Execute**
5. (Optionally) arrange assets in the 3D canvas preview → **Confirm Layout**
6. Watch Roblox Studio build in real time

---

## Frontend Features

| Feature | Description |
|---|---|
| **Prompt Panel** | Model selector, prompt textarea, screenshot upload for visual context |
| **Activity Feed** | Real-time log of all agent actions with colored type indicators |
| **Plan Preview** | Approve or Modify the generated plan before execution |
| **Modify** | Opens an editable textarea to rewrite the prompt and re-submit |
| **Worker Inspector** | Click any worker domain badge (e.g. "Roads") to see its live log |
| **Canvas Preview** | Drag-and-drop 3D layout of all planned objects before building |
| **Project Tree** | Live Explorer tree synced from Studio |
| **Pause / Resume / Stop** | Runtime controls for the active agent |

---

## Debugging

- **`bridge-server/failed_llm_output_debug.txt`** — Raw LLM output saved when detailed planning fails. Shows model name, token counts, and full response for diagnosis.
- Bridge server logs all agent activity to the terminal with `[AgentName]` prefixes.
- Studio plugin logs commands received/executed in the Output window.

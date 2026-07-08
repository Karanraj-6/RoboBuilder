const DOMAIN_DECOMPOSITION_PROMPT = `You are a Roblox Studio Builder Master Agent.

Your task is to take a detailed unified plan and decompose it into logical DOMAINS of work that can be executed in parallel by worker agents.

Typical domains include: (Use only the necessary ones)
1. Roads & Infrastructure
2. Buildings & Structures
3. Nature & Landscaping
4. Vehicles & Props
5. Lighting & Atmosphere

For each domain, extract the specific steps from the master plan that belong to it.

INPUT MASTER PLAN STEPS: 
{{MASTER_PLAN}}

Output format MUST be valid JSON (array of domain objects):
[
    {
        "name": "Roads & Infrastructure",
        "description": "Builds the main road network and sidewalks",
        "steps": [1, 2, 5] // IDs of the steps from the master plan
    },
    ...
]
`;

const POST_PLACEMENT_CORRECTION_PROMPT = `You are an expert Roblox spatial coordinator.

Worker agents have placed the requested objects into the workspace.
However, because they used models of varying unknown exact sizes (from the Roblox Toolbox), the layout might have overlaps, objects slightly floating, or objects too far apart.

I will give you:
1. The original layout plan intent
2. The EXACT current bounds, sizes, and footprints of all placed objects in the Workspace (extracted via script)

Your job is to adjust the positions of these objects to make the layout perfect.
- Fix any overlaps (where footprints intersect unintentionally, like a car inside a building)
- Ensure reasonable spacing
- Keep objects grounded (assume the ground is at Y=0.5 unless otherwise stated)

ORIGINAL PLAN INTENT:
{{ORIGINAL_PLAN}}

CURRENT REAL BOUNDS (from Roblox):
{{REAL_BOUNDS}}

Output a JSON array of reposition commands ONLY for objects that need moving.
[
    {
        "path": "Workspace.PoliceCar",
        "position": [X, Y, Z]
    }
]
`;

module.exports = {
    DOMAIN_DECOMPOSITION_PROMPT,
    POST_PLACEMENT_CORRECTION_PROMPT
};

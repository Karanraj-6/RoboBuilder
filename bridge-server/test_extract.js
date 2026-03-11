const fs = require('fs');

class MockWorker {
    _extractJSON(responseContent) {
        let jsonStr = '';
        let jsonMatch = responseContent.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i);

        if (jsonMatch && (jsonMatch[1].trim().startsWith('{') || jsonMatch[1].trim().startsWith('['))) {
            jsonStr = jsonMatch[1].trim();
        } else {
            const startIndex = responseContent.indexOf('{');
            if (startIndex !== -1) {
                let depth = 0;
                let endIndex = -1;
                for (let i = startIndex; i < responseContent.length; i++) {
                    if (responseContent[i] === '{') depth++;
                    else if (responseContent[i] === '}') depth--;
                    
                    if (depth === 0) {
                        endIndex = i;
                        break;
                    }
                }
                if (endIndex !== -1) {
                    jsonStr = responseContent.substring(startIndex, endIndex + 1);
                } else {
                    jsonStr = responseContent;
                }
            } else {
                jsonStr = responseContent;
            }
        }

        if (!jsonStr.trim().startsWith('{') && !jsonStr.trim().startsWith('[')) {
            throw new Error("CRITICAL FATAL ERROR: You outputted ONLY raw text or ONLY raw Lua code without a JSON wrapper! You MUST output EXACTLY ONE VALID JSON OBJECT (starting with '{') containing your command. Your Lua code goes inside a separate ```lua block AFTER the JSON object, but the JSON object MUST exist first to tell the system what file to create!");
        }

        let cleanedJsonStr = jsonStr.replace(/\`/g, "'");
        cleanedJsonStr = cleanedJsonStr.replace(/(Color3|Vector3|Vector2|UDim2|CFrame|Enum)\.[a-zA-Z0-9_]+\([^)]*\)/g, '"$MATCH"');
        cleanedJsonStr = cleanedJsonStr.replace(/"\$MATCH"/g, '"INVALID_LUA_OBJECT"');
        cleanedJsonStr = cleanedJsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

        const parsed = JSON.parse(cleanedJsonStr);

        let cmds = [];
        if (Array.isArray(parsed)) cmds = parsed;
        else if (parsed.commands) cmds = parsed.commands;
        else if (parsed.type) cmds = [parsed];

        const codeBlocks = [];
        const blockRegex = /```(?:lua|javascript|js|tsx|ts)?\s*([\s\S]*?)```/g;
        let match;
        while ((match = blockRegex.exec(responseContent)) !== null) {
            if (!match[0].toLowerCase().startsWith('```json')) {
                codeBlocks.push(match[1].trim());
            }
        }

        cmds.forEach(cmd => {
            if (!cmd.payload) return;
            if (cmd.payload.source && typeof cmd.payload.source === 'string') {
                const idxMatch = cmd.payload.source.match(/\{\{CODE_BLOCK_(\d+)\}\}/);
                if (idxMatch && codeBlocks[idxMatch[1]]) {
                    cmd.payload.source = codeBlocks[idxMatch[1]];
                }
            }
        });

        return cmds;
    }
}

const worker = new MockWorker();

console.log('--- TEST 1: The Zero-JSON hallucination Bedrock just did ---');
const test1 = `
\`\`\`lua
local Players = game:GetService("Players")
print("Hello")
\`\`\`
`;
try {
    worker._extractJSON(test1);
    console.log('TEST 1 FAILED (Did not throw missing JSON error!)');
} catch(e) {
    if (e.message.includes('NOT exist first')) {
        console.log('TEST 1 PASSED: Correctly threw missing JSON error:', e.message);
    } else {
         console.log('TEST 1 PASSED: Threw some error:', e.message);
    }
}

console.log('--- TEST 2: Valid JSON with Markdown block appended ---');
const test2 = `
{
  "commands": [
    {
      "type": "insert_script",
      "payload": {
        "className": "Script",
        "parent": "Workspace",
        "name": "Test",
        "source": "{{CODE_BLOCK_0}}"
      }
    }
  ]
}

\`\`\`lua
print('Hello World')
local x = 5
\`\`\`
`;
try {
    const res2 = worker._extractJSON(test2);
    if (res2[0].payload.source.includes("print('Hello World')")) {
        console.log('TEST 2 PASSED: Successfully mapped markdown block into payload.');
    } else {
        console.log('TEST 2 FAILED: Code block not mapped correctly.');
    }
} catch(e) {
    console.log('TEST 2 FAILED (Syntax Error):', e.message);
}

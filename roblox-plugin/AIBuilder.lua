--[[
  RoboBuilder — AI Builder Plugin for Roblox Studio
  
  Install: Save this file to your Roblox Studio Plugins folder.
  Requires: Game Settings → Security → Allow HTTP Requests = ON
  
  Connects to the local bridge server at http://localhost:3456
  and executes AI-generated commands to build your game.
]]

local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local Selection = game:GetService("Selection")

----------------------------------------------------------------------
-- CONFIG
----------------------------------------------------------------------
local BRIDGE_URL = "http://localhost:3456/api"
local POLL_INTERVAL = 1        -- seconds between command polls
local HEARTBEAT_INTERVAL = 3   -- seconds between heartbeats
local STATE_EXPORT_INTERVAL = 10 -- seconds between full state exports

----------------------------------------------------------------------
-- PLUGIN UI
----------------------------------------------------------------------
local toolbar = plugin:CreateToolbar("AI Builder")
local connectBtn = toolbar:CreateButton("Connect", "Connect to AI Bridge", "rbxassetid://0")
local disconnectBtn = toolbar:CreateButton("Disconnect", "Disconnect from AI Bridge", "rbxassetid://0")
local exportBtn = toolbar:CreateButton("Export State", "Export project state to AI", "rbxassetid://0")

local isConnected = false
local pollCoroutine = nil
local heartbeatCoroutine = nil
local stateExportCoroutine = nil
local snapshots = {}

----------------------------------------------------------------------
-- UTILITY FUNCTIONS
----------------------------------------------------------------------

local getService

local function normalizeName(str)
  if type(str) ~= "string" then return "" end
  return string.lower((str:gsub("[%s_%-]+", "")))
end

local function findChildFuzzy(parent, targetName)
  if not parent or type(targetName) ~= "string" then return nil end

  local exact = parent:FindFirstChild(targetName)
  if exact then return exact end

  local baseName, ordinal = string.match(targetName, "^(.-)__([0-9]+)$")
  if baseName and ordinal then
    local wantIndex = tonumber(ordinal)
    if wantIndex and wantIndex >= 1 then
      local matches = {}
      local baseNorm = normalizeName(baseName)
      for _, child in ipairs(parent:GetChildren()) do
        if normalizeName(child.Name) == baseNorm then
          table.insert(matches, child)
        end
      end
      if #matches >= wantIndex then
        return matches[wantIndex]
      end
    end
  end

  local targetNorm = normalizeName(targetName)
  if targetNorm == "" then return nil end

  for _, child in ipairs(parent:GetChildren()) do
    local childNorm = normalizeName(child.Name)
    if childNorm == targetNorm then
      return child
    end
  end

  return nil
end

local function httpGet(path)
  local ok, result = pcall(function()
    return HttpService:GetAsync(BRIDGE_URL .. path)
  end)
  if ok then
    return HttpService:JSONDecode(result)
  end
  return nil
end

local function httpPost(path, data)
  local ok, result = pcall(function()
    local json = HttpService:JSONEncode(data)
    return HttpService:PostAsync(BRIDGE_URL .. path, json, Enum.HttpContentType.ApplicationJson)
  end)
  if ok then
    return HttpService:JSONDecode(result)
  end
  return nil
end

-- Custom path splitter that respects dots but allows escaped segments (e.g. bracket notation)
local function splitPath(path)
  if not path then return {} end
  
  local segments = {}
  local current = ""
  local inBrackets = false
  
  for i = 1, #path do
    local char = string.sub(path, i, i)
    if char == "[" then
      inBrackets = true
    elseif char == "]" then
      inBrackets = false
    elseif char == "." and not inBrackets then
      table.insert(segments, current)
      current = ""
    else
      current = current .. char
    end
  end
  table.insert(segments, current)
  
  -- Clean up segments (remove quotes from bracket notation)
  for i, seg in ipairs(segments) do
    segments[i] = string.gsub(seg, "^[\"']", "")
    segments[i] = string.gsub(segments[i], "[\"']$", "")
  end
  
  return segments
end

-- Get the service by name
getService = function(name)
  local serviceMap = {
    Workspace = workspace,
    ServerScriptService = game:GetService("ServerScriptService"),
    ReplicatedStorage = game:GetService("ReplicatedStorage"),
    StarterGui = game:GetService("StarterGui"),
    StarterPlayer = game:GetService("StarterPlayer"),
    Lighting = game:GetService("Lighting"),
    SoundService = game:GetService("SoundService"),
    Teams = game:GetService("Teams"),
    ServerStorage = game:GetService("ServerStorage"),
  }
  return serviceMap[name]
end

-- Resolve a path to an Instance, handling complex names
local function resolvePath(path)
  if not path or path == "" then return nil end
  
  local segments = splitPath(path)
  if #segments == 0 then return nil end

  local current = nil
  local startIdx = 1

  if segments[1] == "game" then
    current = game
    startIdx = 2
  elseif segments[1] == "Workspace" or segments[1] == "workspace" then
    current = workspace
    startIdx = 2
  else
    -- Try resolving first segment as a service
    current = getService(segments[1])
    if current then
      startIdx = 2
    else
      -- Try finding child of game
      current = game:FindFirstChild(segments[1])
      if current then
        startIdx = 2
      else
        -- Default to workspace if no root found
        current = workspace
      end
    end
  end

  -- Walk remaining segments with fuzzy/exact matching
  for i = startIdx, #segments do
    if segments[i] == "" then continue end
    local child = findChildFuzzy(current, segments[i])
    if not child then
      -- Final attempt: literal FindFirstChild
      child = current:FindFirstChild(segments[i])
    end
    if not child then return nil end
    current = child
  end

  return current
end

-- Resolve parent path — handles both service names and complex paths
local function resolveParent(parentPath)
  if not parentPath or parentPath == "" then return workspace end
  return resolvePath(parentPath)
end

-- Set properties on an instance
local function setProperties(instance, properties)
  local warnings = {}
  if type(properties) ~= "table" then return warnings end
  for key, value in pairs(properties) do
    local assigned = false

    -- Helpful overrides for common LLM mistakes
    if type(value) == "table" then
        if (key:lower() == "size" or key:lower() == "position") and instance:IsA("GuiObject") and #value == 2 then
            value = {value[1], 0, value[2], 0} -- cast [scaleX, scaleY] to UDim2
        end
    end

    -- Special Case: Model specific methods where property doesn't exist
    if instance:IsA("Model") then
      if key:lower() == "position" and type(value) == "table" and #value == 3 then
        local ok = pcall(function() instance:MoveTo(Vector3.new(value[1], value[2], value[3])) end)
        if ok then assigned = true end
      elseif key:lower() == "cframe" and type(value) == "table" then
        local ok = pcall(function()
            if #value == 3 then
                instance:PivotTo(CFrame.new(value[1], value[2], value[3]))
            elseif #value == 12 then
                instance:PivotTo(CFrame.new(unpack(value)))
            end
        end)
        if ok then assigned = true end
      elseif key:lower() == "size" then
        warn("[AI Builder] Cannot set 'Size' directly on a Model. Ignored.")
        assigned = true
      elseif key:lower() == "anchored" then
        for _, desc in ipairs(instance:GetDescendants()) do
          if desc:IsA("BasePart") then pcall(function() desc.Anchored = value end) end
        end
        if instance.PrimaryPart then pcall(function() instance.PrimaryPart.Anchored = value end) end
        assigned = true
      end
    end

    -- 1. Try raw assignment
    if not assigned then
        local ok = pcall(function() instance[key] = value end)
        if ok then assigned = true end
    end
    
    -- 2. If it's a table, try different Roblox types
    if not assigned and type(value) == "table" then
      local numElements = #value
      if numElements == 2 then
        if pcall(function() instance[key] = Vector2.new(value[1], value[2]) end) then assigned = true
        elseif pcall(function() instance[key] = UDim.new(value[1], value[2]) end) then assigned = true end
      elseif numElements == 3 then
        -- Detect Color3 properties: keys containing "color" OR known Color3 property names
        local keyLower = key:lower()
        local isColor = string.match(keyLower, "color")
          or keyLower == "ambient" or keyLower == "outdoorambient"
          or keyLower == "fogcolor" or keyLower == "shadowcolor"
          or keyLower == "tintcolor" or keyLower == "decay"
        if isColor then
          if value[1] > 1 or value[2] > 1 or value[3] > 1 then
            if pcall(function() instance[key] = Color3.fromRGB(value[1], value[2], value[3]) end) then assigned = true end
          end
          if not assigned then
            if pcall(function() instance[key] = Color3.new(value[1], value[2], value[3]) end) then assigned = true end
          end
        end
        if not assigned then
          if pcall(function() instance[key] = Vector3.new(value[1], value[2], value[3]) end) then assigned = true
          elseif pcall(function() instance[key] = CFrame.new(value[1], value[2], value[3]) end) then assigned = true end
        end
      elseif numElements == 4 then
        if pcall(function() instance[key] = UDim2.new(value[1], value[2], value[3], value[4]) end) then assigned = true
        elseif pcall(function() instance[key] = Rect.new(value[1], value[2], value[3], value[4]) end) then assigned = true end
      elseif numElements == 12 then
        if pcall(function() instance[key] = CFrame.new(unpack(value)) end) then assigned = true end
      end
    end

    -- 3. If it's a string, try resolving it 
    if not assigned and type(value) == "string" then
      -- 3a. Object reference
      local refInstance = resolvePath(value)
      if refInstance then
        if pcall(function() instance[key] = refInstance end) then assigned = true end
      end

      -- 3b. Enum matching
      if not assigned then
          pcall(function()
            if Enum[key] and Enum[key][value] then
              instance[key] = Enum[key][value]
              assigned = true
            end
          end)
      end
      
      -- Brute force Enum search
      if not assigned then
          local commonEnums = {"Font", "Material", "SurfaceType", "HorizontalAlignment", "VerticalAlignment", "FillDirection", "SortOrder", "ZIndexBehavior", "InOut", "EasingStyle", "EasingDirection", "ScaleType", "SizeConstraint", "TextXAlignment", "TextYAlignment", "AutomaticSize", "BorderMode", "FrameStyle", "ResamplerMode", "ScrollingDirection"}
          for _, enumName in ipairs(commonEnums) do
            local found = false
            pcall(function()
              if Enum[enumName] and Enum[enumName][value] then
                instance[key] = Enum[enumName][value]
                found = true
              end
            end)
            if found then
               assigned = true
               break
            end
          end
      end

      -- 3c. Formatted string of numbers (e.g. "255, 0, 0")
      if not assigned then
          local numbers = {}
          for match in string.gmatch(value, "[%-%.%d]+") do
              table.insert(numbers, tonumber(match))
          end
          local numElements = #numbers
          if numElements > 0 then
             if numElements == 2 then
               if pcall(function() instance[key] = Vector2.new(numbers[1], numbers[2]) end) then assigned = true
               elseif pcall(function() instance[key] = UDim.new(numbers[1], numbers[2]) end) then assigned = true end
             elseif numElements == 3 then
               if string.match(key:lower(), "color") then
                 if numbers[1] > 1 or numbers[2] > 1 or numbers[3] > 1 then
                   if pcall(function() instance[key] = Color3.fromRGB(numbers[1], numbers[2], numbers[3]) end) then assigned = true end
                 else
                   if pcall(function() instance[key] = Color3.new(numbers[1], numbers[2], numbers[3]) end) then assigned = true end
                 end
               end
               if not assigned then
                 if pcall(function() instance[key] = Vector3.new(numbers[1], numbers[2], numbers[3]) end) then assigned = true
                 elseif pcall(function() instance[key] = CFrame.new(numbers[1], numbers[2], numbers[3]) end) then assigned = true end
               end
             elseif numElements == 4 then
               if pcall(function() instance[key] = UDim2.new(numbers[1], numbers[2], numbers[3], numbers[4]) end) then assigned = true
               elseif pcall(function() instance[key] = Rect.new(numbers[1], numbers[2], numbers[3], numbers[4]) end) then assigned = true end
             elseif numElements == 12 then
               if pcall(function() instance[key] = CFrame.new(unpack(numbers)) end) then assigned = true end
             end
          end
      end
    end
    
    -- Exclude Parent from warnings since we set Parent after properties often
    if not assigned and key ~= "Parent" then
        local msg = "Failed to set property '" .. tostring(key) .. "' on " .. tostring(instance.Name) .. ". Value type: " .. type(value)
        warn("[AI Builder] " .. msg)
        table.insert(warnings, msg)
    end
  end
  return warnings
end

----------------------------------------------------------------------
-- COMMAND HANDLERS
----------------------------------------------------------------------

local commandHandlers = {}

-- Create any Instance
commandHandlers.create_instance = function(payload)
  local parent = resolveParent(payload.parent)
  if not parent then
    return false, "Parent not found: " .. tostring(payload.parent)
  end

  local instance = Instance.new(payload.className)
  if payload.name then
    instance.Name = payload.name
  end
  local warnings = setProperties(instance, payload.properties)
  instance.Parent = parent

  local msg = "Created " .. payload.className .. ": " .. instance.Name
  if #warnings > 0 then
    msg = msg .. " | WARNINGS: " .. table.concat(warnings, "; ")
  end
  return true, msg
end

-- Insert Free Model from Toolbox
commandHandlers.insert_free_model = function(payload)
  local parent = resolveParent(payload.parent)
  if not parent then
    return false, "Parent not found: " .. tostring(payload.parent)
  end

  local InsertService = game:GetService("InsertService")
  local assetId = payload.assetId
  
  if not assetId and payload.searchQuery then
    local HttpService = game:GetService("HttpService")
    local encodedQuery = HttpService:UrlEncode(payload.searchQuery)

    -- Use the Toolbox Service API (marketplace/10 = Models) via roproxy proxy
    -- This returns REAL insertable 3D models, not avatar accessories
    local searchUrl = "https://apis.roproxy.com/toolbox-service/v1/marketplace/10?keyword=" .. encodedQuery .. "&num=5&sort=1"
    local searchOk, response = pcall(function()
       return HttpService:GetAsync(searchUrl)
    end)
    if searchOk and response then
       local decodeOk, data = pcall(function()
          return HttpService:JSONDecode(response)
       end)
       if decodeOk and data and type(data) == "table" and data.data and type(data.data) == "table" and #data.data > 0 then
          assetId = data.data[1].id
       end
    end
  end

  if not assetId then
    return false, "No free models found for query: '" .. tostring(payload.searchQuery) .. "'. The Roblox catalog search returned 0 results. Please try a different single-word synonym (e.g. 'vehicle', 'car', 'weapon') OR build the object yourself using primitive BaseParts (Instance.new('Part'))."
  end

  -- Try game:GetObjects first as it bypasses ownership limits for plugins in Studio
  local loadOk, modelObjects = pcall(function()
    return game:GetObjects("rbxassetid://" .. assetId)
  end)

  if not loadOk or not modelObjects or #modelObjects == 0 then
    -- Fallback to InsertService
    loadOk, modelObjects = pcall(function()
       local m = InsertService:LoadAsset(assetId)
       return m:GetChildren()
    end)
  end

  if not loadOk or not modelObjects then
    return false, "Roblox security blocked insertion. The user must manually insert Asset ID: " .. tostring(assetId)
  end

  -- Name the first object with payload.name if specified
  local mainItem = modelObjects[1]
  local insertedName = mainItem and mainItem.Name or "Unknown"

  for _, item in ipairs(modelObjects) do
    item.Parent = parent
  end

  if mainItem and payload.name and payload.name ~= "" then
    pcall(function() mainItem.Name = payload.name end)
    insertedName = mainItem.Name
  end

  -- Position the model immediately if position is provided
  if mainItem and payload.position and type(payload.position) == "table" and #payload.position == 3 then
    local pos = payload.position
    local posOk = false
    -- For Models, use MoveTo or PivotTo
    if mainItem:IsA("Model") then
      posOk = pcall(function()
        mainItem:PivotTo(CFrame.new(pos[1], pos[2], pos[3]))
      end)
      if not posOk then
        posOk = pcall(function()
          mainItem:MoveTo(Vector3.new(pos[1], pos[2], pos[3]))
        end)
      end
    end
    -- For BaseParts, set Position directly
    if not posOk and mainItem:IsA("BasePart") then
      pcall(function()
        mainItem.Position = Vector3.new(pos[1], pos[2], pos[3])
      end)
    end
    -- Anchor all parts so they don't fall
    pcall(function()
      if mainItem:IsA("BasePart") then mainItem.Anchored = true end
      for _, desc in ipairs(mainItem:GetDescendants()) do
        if desc:IsA("BasePart") then desc.Anchored = true end
      end
    end)
  end

  -- Gather bounds info to return to the runtime
  local boundsInfo = ""
  pcall(function()
    if mainItem then
      if mainItem:IsA("Model") then
        local cf, sz = mainItem:GetBoundingBox()
        boundsInfo = string.format('|BOUNDS:{"position":[%.1f,%.1f,%.1f],"size":[%.1f,%.1f,%.1f]}',
          cf.Position.X, cf.Position.Y, cf.Position.Z, sz.X, sz.Y, sz.Z)
      elseif mainItem:IsA("BasePart") then
        boundsInfo = string.format('|BOUNDS:{"position":[%.1f,%.1f,%.1f],"size":[%.1f,%.1f,%.1f]}',
          mainItem.Position.X, mainItem.Position.Y, mainItem.Position.Z,
          mainItem.Size.X, mainItem.Size.Y, mainItem.Size.Z)
      end
    end
  end)

  return true, "Inserted '" .. insertedName .. "' (Asset ID: " .. tostring(assetId) .. ") at " .. tostring(parent) .. ". Instance name: " .. insertedName .. boundsInfo
end

-- Get bounds of an existing instance (Model or BasePart)
commandHandlers.get_bounds = function(payload)
  local instance = resolvePath(payload.path)
  if not instance then
    return false, "Instance not found: " .. tostring(payload.path)
  end

  if instance:IsA("Model") then
    local cf, sz = instance:GetBoundingBox()
    return true, string.format('{"name":"%s","position":[%.1f,%.1f,%.1f],"size":[%.1f,%.1f,%.1f]}',
      instance.Name, cf.Position.X, cf.Position.Y, cf.Position.Z, sz.X, sz.Y, sz.Z)
  elseif instance:IsA("BasePart") then
    return true, string.format('{"name":"%s","position":[%.1f,%.1f,%.1f],"size":[%.1f,%.1f,%.1f]}',
      instance.Name, instance.Position.X, instance.Position.Y, instance.Position.Z,
      instance.Size.X, instance.Size.Y, instance.Size.Z)
  else
    return false, "Instance is not a Model or BasePart: " .. instance.ClassName
  end
end

-- Move an instance to a new position (handles Models and BaseParts)
commandHandlers.move_instance = function(payload)
  local instance = resolvePath(payload.path)
  if not instance then
    return false, "Instance not found: " .. tostring(payload.path)
  end

  local pos = payload.position
  if not pos or type(pos) ~= "table" or #pos ~= 3 then
    return false, "Invalid position: must be [X, Y, Z] array"
  end

  local moved = false

  if instance:IsA("Model") then
    moved = pcall(function()
      instance:PivotTo(CFrame.new(pos[1], pos[2], pos[3]))
    end)
    if not moved then
      moved = pcall(function()
        instance:MoveTo(Vector3.new(pos[1], pos[2], pos[3]))
      end)
    end
    -- Auto-ground correction: pivot may not be at bounding box center
    -- After PivotTo, the bbox center can be offset from the pivot.
    -- We correct so that the bbox center lands exactly at the target Y.
    if moved then
      pcall(function()
        local cf, sz = instance:GetBoundingBox()
        local bboxY = cf.Position.Y
        local offset = bboxY - pos[2]
        if math.abs(offset) > 0.5 then
          instance:PivotTo(CFrame.new(pos[1], pos[2] - offset, pos[3]))
        end
      end)
    end
  elseif instance:IsA("BasePart") then
    moved = pcall(function()
      instance.Position = Vector3.new(pos[1], pos[2], pos[3])
    end)
  else
    return false, "Cannot move instance of class: " .. instance.ClassName
  end

  if not moved then
    return false, "Failed to move " .. tostring(payload.path)
  end

  -- Anchor all parts to prevent falling
  pcall(function()
    if instance:IsA("BasePart") then instance.Anchored = true end
    for _, desc in ipairs(instance:GetDescendants()) do
      if desc:IsA("BasePart") then desc.Anchored = true end
    end
  end)

  -- Return new bounds
  local boundsStr = ""
  pcall(function()
    if instance:IsA("Model") then
      local cf, sz = instance:GetBoundingBox()
      boundsStr = string.format('{"position":[%.1f,%.1f,%.1f],"size":[%.1f,%.1f,%.1f]}',
        cf.Position.X, cf.Position.Y, cf.Position.Z, sz.X, sz.Y, sz.Z)
    elseif instance:IsA("BasePart") then
      boundsStr = string.format('{"position":[%.1f,%.1f,%.1f],"size":[%.1f,%.1f,%.1f]}',
        instance.Position.X, instance.Position.Y, instance.Position.Z,
        instance.Size.X, instance.Size.Y, instance.Size.Z)
    end
  end)

  return true, "Moved " .. tostring(payload.path) .. " to [" .. pos[1] .. "," .. pos[2] .. "," .. pos[3] .. "] " .. boundsStr
end

-- Set properties on existing instance
commandHandlers.set_properties = function(payload)
  local instance = resolvePath(payload.path)
  if not instance then
    return false, "Instance not found: " .. tostring(payload.path)
  end
  local warnings = setProperties(instance, payload.properties)
  local msg = "Updated properties on " .. payload.path
  if #warnings > 0 then
    msg = msg .. " | WARNINGS: " .. table.concat(warnings, "; ")
  end
  return true, msg
end

-- Delete instance
commandHandlers.delete_instance = function(payload)
  local instance = resolvePath(payload.path)
  if not instance then
    return false, "Instance not found: " .. tostring(payload.path)
  end
  instance:Destroy()
  return true, "Deleted " .. payload.path
end

-- Insert script
commandHandlers.insert_script = function(payload)
  local parent = resolveParent(payload.parent)
  if not parent then
    return false, "Parent not found: " .. tostring(payload.parent)
  end

  local className = payload.className or "Script"
  local script = Instance.new(className)
  script.Name = payload.name or className
  script.Source = payload.source or ""
  local warnings = setProperties(script, payload.properties)
  script.Parent = parent

  local msg = "Created " .. className .. ": " .. script.Name
  if #warnings > 0 then
    msg = msg .. " | WARNINGS: " .. table.concat(warnings, "; ")
  end
  return true, msg
end

-- Update script source
commandHandlers.update_script = function(payload)
  local instance = resolvePath(payload.path)
  if not instance then
    return false, "Script not found: " .. tostring(payload.path)
  end
  if not instance:IsA("LuaSourceContainer") then
    return false, "Instance is not a script: " .. instance.ClassName
  end
  instance.Source = payload.source
  return true, "Updated script: " .. payload.path
end

-- Patch script (line-level diffs)
commandHandlers.patch_script = function(payload)
  local instance = resolvePath(payload.path)
  if not instance then
    return false, "Script not found: " .. tostring(payload.path)
  end
  if not instance:IsA("LuaSourceContainer") then
    return false, "Instance is not a script: " .. instance.ClassName
  end

  local lines = string.split(instance.Source, "\n")

  -- Apply patches in reverse order to preserve line numbers
  local patches = payload.patches or {}
  table.sort(patches, function(a, b)
    return (a.startLine or a.afterLine or 0) > (b.startLine or b.afterLine or 0)
  end)

  for _, patch in ipairs(patches) do
    if patch.action == "replace" then
      local newLines = string.split(patch.content, "\n")
      for i = patch.endLine, patch.startLine, -1 do
        table.remove(lines, i)
      end
      for i, line in ipairs(newLines) do
        table.insert(lines, patch.startLine + i - 1, line)
      end

    elseif patch.action == "insert" then
      local newLines = string.split(patch.content, "\n")
      for i, line in ipairs(newLines) do
        table.insert(lines, patch.afterLine + i, line)
      end

    elseif patch.action == "delete" then
      for i = patch.endLine, patch.startLine, -1 do
        table.remove(lines, i)
      end
    end
  end

  instance.Source = table.concat(lines, "\n")
  return true, "Patched script: " .. payload.path
end

-- Create UI hierarchy
commandHandlers.create_ui = function(payload)
  local parent = resolveParent(payload.parent)
  if not parent then
    return false, "Parent not found: " .. tostring(payload.parent)
  end

  local function createUITree(elementData, parentInstance)
    if not elementData.className or type(elementData.className) ~= "string" then
       warn("create_ui Error: Missing or invalid className for element. Skipping.")
       return nil
    end

    local element = Instance.new(elementData.className)
    element.Name = elementData.name or elementData.className
    
    setProperties(element, elementData.properties)
    
    element.Parent = parentInstance

    if elementData.children then
      for _, child in ipairs(elementData.children) do
        createUITree(child, element)
      end
    end

    return element
  end

  for _, element in ipairs(payload.elements or {}) do
    createUITree(element, parent)
  end

  return true, "Created UI in " .. payload.parent
end

-- Reparent instance (move to a different parent container)
commandHandlers.reparent_instance = function(payload)
  local instance = resolvePath(payload.path)
  if not instance then
    return false, "Instance not found: " .. tostring(payload.path)
  end
  local newParent = resolveParent(payload.newParent)
  if not newParent then
    return false, "New parent not found: " .. tostring(payload.newParent)
  end
  instance.Parent = newParent
  return true, "Reparented " .. tostring(payload.path) .. " to " .. tostring(payload.newParent)
end

-- Clone instance
commandHandlers.clone_instance = function(payload)
  local instance = resolvePath(payload.path)
  if not instance then
    return false, "Instance not found: " .. tostring(payload.path)
  end
  local clone = instance:Clone()
  if payload.name then clone.Name = payload.name end
  local parent = payload.parent and resolveParent(payload.parent) or instance.Parent
  clone.Parent = parent
  return true, "Cloned " .. payload.path
end

-- Snapshot (save state for rollback)
commandHandlers.snapshot = function(payload)
  local state = buildProjectState()
  table.insert(snapshots, {
    state = state,
    timestamp = os.time(),
    label = payload and payload.label or "auto"
  })
  -- Keep only last 10
  while #snapshots > 10 do
    table.remove(snapshots, 1)
  end
  return true, "Snapshot saved (#" .. #snapshots .. ")"
end

-- Export state
commandHandlers.export_state = function()
  local state = buildProjectState()
  local result = httpPost("/project-state", state)
  if result then
    return true, "State exported to bridge"
  end
  -- Retry once if first attempt failed (possibly transient)
  wait(0.5)
  result = httpPost("/project-state", state)
  if result then
    return true, "State exported to bridge (retry)"
  end
  return false, "State export failed — HTTP post returned nil"
end

-- Batch execute
commandHandlers.batch = function(payload)
  local results = {}
  for _, cmd in ipairs(payload.commands or {}) do
    local handler = commandHandlers[cmd.type]
    if handler then
      local ok, msg = handler(cmd.payload)
      table.insert(results, {type = cmd.type, success = ok, message = msg})
    end
  end
  return true, "Batch: " .. #results .. " commands executed"
end

----------------------------------------------------------------------
-- PROJECT STATE SERIALIZER
----------------------------------------------------------------------

local function serializeInstance(instance, depth)
  if depth > 10 then return nil end -- Prevent infinite recursion

  local data = {
    _class = instance.ClassName,
    _name = instance.Name,
  }

  -- Serialize common properties
  local hasBoundingBox = false
  pcall(function()
    if instance:IsA("BasePart") then
      data._properties = {
        Position = {instance.Position.X, instance.Position.Y, instance.Position.Z},
        Size = {instance.Size.X, instance.Size.Y, instance.Size.Z},
        Anchored = instance.Anchored,
        CanCollide = instance.CanCollide,
        Transparency = instance.Transparency,
        Color = {instance.Color.R, instance.Color.G, instance.Color.B},
        Material = instance.Material.Name,
      }
    elseif instance:IsA("Model") then
      local cf, size = instance:GetBoundingBox()
      data._properties = {
        PivotPosition = {cf.Position.X, cf.Position.Y, cf.Position.Z},
        BoundingSize = {size.X, size.Y, size.Z}
      }
      hasBoundingBox = true
    end
  end)

  -- Include script source
  pcall(function()
    if instance:IsA("LuaSourceContainer") then
      data._source = instance.Source
    end
  end)

  -- Serialize children
  -- For Models with bounding box data (inserted 3D models), skip geometry children
  -- to keep state JSON compact. Only keep scripts inside them.
  local children = instance:GetChildren()
  local seenNames = {}
  for _, child in ipairs(children) do
    -- Skip geometry children of models that already have bounding box
    -- This prevents 40+ Toolbox models from bloating the state to 500KB+
    if hasBoundingBox and (child:IsA("BasePart") or child:IsA("Model") or child:IsA("Accoutrement") or child:IsA("Accessory")) then
      -- Skip — we already have the model's PivotPosition + BoundingSize
    else
      local childData = serializeInstance(child, depth + 1)
      if childData then
        local baseName = child.Name
        local count = seenNames[baseName] or 0
        seenNames[baseName] = count + 1

        local key = baseName
        if count > 0 then
          key = baseName .. "__" .. tostring(count + 1)
        end

        data[key] = childData
      end
    end
  end

  return data
end

function buildProjectState()
  local state = {}
  local services = {
    {name = "Workspace", instance = workspace},
    {name = "ServerScriptService", instance = game:GetService("ServerScriptService")},
    {name = "ReplicatedStorage", instance = game:GetService("ReplicatedStorage")},
    {name = "StarterGui", instance = game:GetService("StarterGui")},
    {name = "StarterPlayer", instance = game:GetService("StarterPlayer")},
    {name = "Lighting", instance = game:GetService("Lighting")},
    {name = "ServerStorage", instance = game:GetService("ServerStorage")},
  }

  for _, svc in ipairs(services) do
    pcall(function()
      state[svc.name] = serializeInstance(svc.instance, 0)
    end)
  end

  return state
end

----------------------------------------------------------------------
-- POLLING LOOPS
----------------------------------------------------------------------

local function startPolling()
  -- Command polling loop
  pollCoroutine = coroutine.wrap(function()
    while isConnected do
      local ok, data = pcall(function()
        return httpGet("/commands")
      end)
      
      if ok and data and data.commands then
        local resultsToSend = {}
        
        for _, cmd in ipairs(data.commands) do
          local handler = commandHandlers[cmd.type]
          local success, message = false, "Unknown command: " .. tostring(cmd.type)

          if handler then
            ChangeHistoryService:SetWaypoint("AI Builder: " .. cmd.type)
            
            -- Wrap in pcall to prevent silent crashes of the polling loop
            local function runHandler()
              return handler(cmd.payload)
            end
            
            local execSuccess, res1, res2 = pcall(runHandler)
            if execSuccess then
              success = res1
              message = res2
            else
              success = false
              message = "Lua Execution Error: " .. tostring(res1)
              warn("[AI Builder] Command crashed: " .. tostring(res1))
            end
            
            ChangeHistoryService:SetWaypoint("AI Builder: " .. cmd.type .. " done")
          end

          table.insert(resultsToSend, {
            id = cmd.id,
            payload = {
              success = success,
              result = message,
              error = not success and message or nil
            }
          })
        end

        -- 1. FORCE STATE EXPORT FIRST: To ensure backend CodeAnalyzer has the newly created instances 
        -- before unlocking the LLM's 'await _waitForCommands' promise.
        if #data.commands > 0 then
           local state = buildProjectState()
           local exportOk = httpPost("/project-state", state)
           if not exportOk then
             -- Retry once
             wait(0.3)
             httpPost("/project-state", state)
           end
        end

        -- 2. Send Results (unlocks WorkerRuntime loop)
        for _, res in ipairs(resultsToSend) do
           httpPost("/commands/" .. res.id .. "/result", res.payload)
        end
      end
      wait(POLL_INTERVAL)
    end
  end)

  -- Heartbeat loop
  heartbeatCoroutine = coroutine.wrap(function()
    while isConnected do
      httpPost("/heartbeat", {timestamp = os.time()})
      wait(HEARTBEAT_INTERVAL)
    end
  end)

  -- State export loop
  stateExportCoroutine = coroutine.wrap(function()
    while isConnected do
      local state = buildProjectState()
      httpPost("/project-state", state)
      wait(STATE_EXPORT_INTERVAL)
    end
  end)

  -- Run all loops
  spawn(function()
    pollCoroutine()
  end)
  spawn(function()
    heartbeatCoroutine()
  end)
  spawn(function()
    -- Initial state export
    wait(2)
    stateExportCoroutine()
  end)

  print("[AI Builder] Connected to bridge at " .. BRIDGE_URL)
end

local function stopPolling()
  isConnected = false
  print("[AI Builder] Disconnected from bridge")
end

----------------------------------------------------------------------
-- BUTTON HANDLERS
----------------------------------------------------------------------

connectBtn.Click:Connect(function()
  if not isConnected then
    -- Test connection
    local status = httpGet("/status")
    if status then
      isConnected = true
      startPolling()
    else
      warn("[AI Builder] Cannot connect to bridge at " .. BRIDGE_URL)
      warn("[AI Builder] Make sure the bridge server is running: cd bridge-server && npm start")
    end
  end
end)

disconnectBtn.Click:Connect(function()
  if isConnected then
    stopPolling()
  end
end)

exportBtn.Click:Connect(function()
  local state = buildProjectState()
  local result = httpPost("/project-state", state)
  if result then
    print("[AI Builder] Project state exported successfully")
  else
    warn("[AI Builder] Failed to export state — bridge not connected")
  end
end)

print("[AI Builder] Plugin loaded. Click 'Connect' to start.")

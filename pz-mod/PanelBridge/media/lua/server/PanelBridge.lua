---@diagnostic disable: undefined-global, deprecated
--[[
    PanelBridge - Server-side mod for Zomboid Control Panel
    Version: 1.7.0
    
    This mod enables external control panel communication with the PZ server.
    Communication happens via JSON files in the server save folder.
    
    v1.7.0 Changes:
    - Added getAllSandboxOptions handler: enumerates ALL sandbox options (vanilla + mod-registered)
      with metadata (type, min/max, default, enum values), grouped by mod/table name

    v1.6.0 Changes:
    - Added vehicleSetFuel and vehicleSetBattery handlers for remote vehicle management
    - Added safehouse player list to getSafehouses response
    - Added getTimeSpeed / setTimeSpeed handlers for time multiplier control
    - Added triggerHelicopterEvent handler
    - Fixed processedIds cleanup: sliding window (drop oldest half) instead of full clear
    - Removed dead sendServerMessage handler (superseded by sendToServerChat)
    - Removed addLamppost/removeLamppost from backend whitelist (no Lua implementation)

    v1.5.0 Changes:
    - Fixed teleportPlayer for B42: use setTeleport() instead of broken sendObjectChange("teleport")
    - Added fallback chain: setTeleport → setX/Y/Z + sendPlayerExtraInfo → sendObjectChange
    - Added airdrop system handler

    v1.4.3 Changes:
    - CRITICAL: Fixed JSON object parser infinite loop on malformed input (while true → bounded)
    - Added pcall protection to getWeather handler for cross-version safety
    - Added pcall protection to getServerInfo GameTime access
    - Added per-field pcall to setGameTime to prevent partial failure cascades
    - Added pcall to teleportPlayer for proper error reporting
    - Added safe individual access to getSandboxOptions for B42 compatibility
    - Clamped giveItem count to 1-100 per call to prevent server freeze
    - Fixed indentation in shutOffUtilities Step 8
    
    v1.4.2 Changes:
    - Fixed race condition in command processing (infinite command loops)
    - Improved type declaration safety for all Climate handlers (numeric parsing)
    - Fixed ambiguous inputs in generic climate float handler
    - Cleanup of unused reference code
    
    v1.4.1 Changes:
    - Increased status update frequency from 5s to 3s for faster panel detection
    
    v1.4.0 Changes:
    - Added comprehensive debug logging system with toggleable debug mode
    - Added API version detection (B41 vs B42)
    - Added method availability checking before calling API methods
    - Added detailed error context in all handlers
    - Added getDebugLog handler to retrieve recent log entries
    - Added setDebugMode handler to enable/disable verbose logging
    - Added checkAPI handler to test API method availability
    - Added getAvailableHandlers to list all supported commands
    - Improved error messages with stack traces when available
    - Added performance timing to command execution
    - Added command statistics tracking
    
    v1.3.1 Changes:
    - Fixed B42 compatibility for getPlayerTraits (traits now accessed via SurvivorDesc)
    - Improved trait extraction to handle both B41 and B42 API differences
    
    v1.3.0 Changes:
    - Added comprehensive player export/import system
    - exportPlayerData: Full character data including inventory, perks, traits, recipes
    - importPlayerData: Restore perks, stats, and recipes (inventory/traits require manual restore)
    - Added chat system handlers via ChatServer API
    - sendToServerChat: Server messages to all players (with alert option)
    - sendToAdminChat: Messages visible only to admins
    - sendToGeneralChat: General chat with custom author name
    - getChatInfo: Query available chat types and server status
    
    v1.2.0 Changes:
    - Added sound/noise control for zombie attraction
    - playWorldSound: Create sound at coordinates
    - playSoundNearPlayer: Create sound at player location
    - triggerGunshot: High-radius gunshot sound
    - triggerAlarmSound: Medium-radius alarm sound
    - createNoise: Customizable noise creation
    
    v1.1.0 Changes:
    - Added comprehensive climate controls (wind, temp, fog, clouds, precipitation)
    - Added rain/lightning control
    - Added ClimateFloat admin control system
    - Added time/date control
    - Added sandbox options querying
    - Added enhanced player info
    - Fixed snow to auto-enable rain
]]

-- Forward declaration (referenced in log() before definition below)
local json

local PanelBridge = {
    VERSION = "1.7.0",
    PROTOCOL_VERSION = "queue-v1",
    CHECK_INTERVAL = 250, -- milliseconds (fast command polling)
    lastCheck = 0,
    lastStatusUpdate = 0,
    STATUS_INTERVAL = 3000, -- status update every 3 seconds (faster for detection)
    processedIds = {},
    processedIdCount = 0,
    basePath = nil,
    initialized = false,
    
    -- Debug/Logging system
    DEBUG_MODE = true, -- Verbose logging enabled
    debugLog = {},      -- Recent debug entries (ring buffer)
    MAX_DEBUG_ENTRIES = 200,
    MAX_PENDING_RESULTS = 500,
    MAX_COMMANDS_PER_TICK = 200,
    QUEUE_SEQUENCE_WIDTH = 10,
    
    -- API detection
    detectedVersion = nil,
    apiCapabilities = {},
    
    -- Statistics
    stats = {
        commandsProcessed = 0,
        commandsSucceeded = 0,
        commandsFailed = 0,
        errors = {},
        lastError = nil,
        startTime = nil
    },
    
    -- Pending results buffer (avoids read-modify-write race on results.json)
    pendingResults = {},

    -- Queue state persisted to disk for crash-safe resume
    queueState = {
        lastCommandSeq = 0,
        nextResultSeq = 1,
    },
}

-- ============================================
-- DEBUG/LOGGING SYSTEM
-- ============================================

-- Log levels
local LOG_LEVEL = {
    DEBUG = 1,
    INFO = 2,
    WARN = 3,
    ERROR = 4
}

-- Lua 5.1/5.2 compatibility
local unpack = unpack or table.unpack

-- Internal logging function
function PanelBridge.log(level, message, context)
    local timestamp = nil
    if getTimestampMs then
        timestamp = getTimestampMs()
    elseif os and os.time then
        timestamp = os.time() * 1000
    else
        timestamp = 0
    end
    local levelName = "INFO"
    for name, val in pairs(LOG_LEVEL) do
        if val == level then levelName = name break end
    end
    
    local entry = {
        timestamp = timestamp,
        level = levelName,
        message = tostring(message),
        context = context
    }
    
    -- Add to ring buffer
    table.insert(PanelBridge.debugLog, entry)
    if #PanelBridge.debugLog > PanelBridge.MAX_DEBUG_ENTRIES then
        table.remove(PanelBridge.debugLog, 1)
    end
    
    -- Print to console
    local prefix = "[PanelBridge][" .. levelName .. "] "
    if level >= LOG_LEVEL.WARN or PanelBridge.DEBUG_MODE then
        print(prefix .. message)
        if context and PanelBridge.DEBUG_MODE and json and json.encode then
            print(prefix .. "  Context: " .. json.encode(context))
        end
    end
    
    -- Track errors
    if level == LOG_LEVEL.ERROR then
        PanelBridge.stats.lastError = entry
        table.insert(PanelBridge.stats.errors, entry)
        -- Keep only last 20 errors
        while #PanelBridge.stats.errors > 20 do
            table.remove(PanelBridge.stats.errors, 1)
        end
    end
end

function PanelBridge.debug(message, context)
    PanelBridge.log(LOG_LEVEL.DEBUG, message, context)
end

function PanelBridge.info(message, context)
    PanelBridge.log(LOG_LEVEL.INFO, message, context)
end

function PanelBridge.warn(message, context)
    PanelBridge.log(LOG_LEVEL.WARN, message, context)
end

function PanelBridge.error(message, context)
    PanelBridge.log(LOG_LEVEL.ERROR, message, context)
end

-- ============================================
-- API DETECTION & SAFE CALLING
-- ============================================

-- Check if a method exists on an object
function PanelBridge.hasMethod(obj, methodName)
    if not obj then return false end
    return type(obj[methodName]) == "function"
end

-- Safely call a method that might not exist
-- Returns: success, result/error
function PanelBridge.safeCall(obj, methodName, ...)
    if not obj then
        return false, "Object is nil"
    end
    
    if not PanelBridge.hasMethod(obj, methodName) then
        return false, "Method '" .. methodName .. "' not available"
    end
    
    local args = {...}
    local success, result = pcall(function()
        return obj[methodName](obj, unpack(args))
    end)
    
    if success then
        return true, result
    else
        PanelBridge.debug("safeCall failed", { method = methodName, error = result })
        return false, result
    end
end

-- Safely get a value from a method, with default fallback
function PanelBridge.safeGet(obj, methodName, default)
    local success, result = PanelBridge.safeCall(obj, methodName)
    if success then
        return result
    end
    return default
end

-- Detect PZ version and available APIs
function PanelBridge.detectVersion()
    local version = {
        build = "unknown",
        isB42 = false,
        isB41 = false,
        features = {}
    }
    
    -- Check for B42-specific APIs
    local climate = getClimateManager and getClimateManager()
    if climate then
        -- B42 has some different climate methods
        if PanelBridge.hasMethod(climate, "transmitTriggerBlizzard") then
            version.features.blizzard = true
        end
        if PanelBridge.hasMethod(climate, "transmitTriggerTropical") then
            version.features.tropical = true
        end
    end
    
    -- Check player API differences (getOnlinePlayers may return nil at startup)
    local onlinePlayers = getOnlinePlayers and getOnlinePlayers()
    local testPlayer = onlinePlayers and onlinePlayers:size() > 0 and onlinePlayers:get(0) or nil
    if testPlayer then
        -- B42 traits are accessed via SurvivorDesc
        local desc = testPlayer:getDescriptor()
        if desc and PanelBridge.hasMethod(desc, "getTraitList") then
            version.isB42 = true
        end
        if PanelBridge.hasMethod(testPlayer, "getTraits") then
            version.isB41 = true
        end
    end
    
    -- Try to get build version
    pcall(function()
        if getCore and getCore() and getCore().getVersion then
            version.build = getCore():getVersion()
        end
    end)
    
    -- Fallback: parse build string if player-based detection couldn't run
    if not version.isB42 and not version.isB41 and version.build ~= "unknown" then
        local major = version.build:match("^(%d+)%.")
        if major then
            local majorNum = tonumber(major)
            if majorNum and majorNum >= 42 then
                version.isB42 = true
            elseif majorNum and majorNum == 41 then
                version.isB41 = true
            end
        end
    end
    
    PanelBridge.detectedVersion = version
    PanelBridge.info("Detected PZ version", version)
    
    return version
end

-- ============================================
-- JSON LIBRARY (embedded for reliability)
-- ============================================
json = {}

local function kind_of(obj)
    if type(obj) ~= 'table' then return type(obj) end
    local i = 1
    for _ in pairs(obj) do
        if obj[i] ~= nil then i = i + 1 else return 'table' end
    end
    if i == 1 then return 'table' else return 'array' end
end

local function escape_str(s)
    local in_char = {'\\', '"', '\b', '\f', '\n', '\r', '\t'}
    local out_char = {'\\', '"', 'b', 'f', 'n', 'r', 't'}
    for i, c in ipairs(in_char) do
        s = s:gsub(c, '\\' .. out_char[i])
    end
    return s
end

function json.encode(obj)
    local t = type(obj)
    if t == 'nil' then
        return 'null'
    elseif t == 'boolean' then
        return obj and 'true' or 'false'
    elseif t == 'number' then
        -- Handle NaN and Infinity which are not valid JSON
        if obj ~= obj then return 'null' end -- NaN check
        if obj == math.huge or obj == -math.huge then return 'null' end
        return tostring(obj)
    elseif t == 'string' then
        return '"' .. escape_str(obj) .. '"'
    elseif t == 'table' then
        local k = kind_of(obj)
        if k == 'array' then
            local parts = {}
            for i, v in ipairs(obj) do
                parts[i] = json.encode(v)
            end
            return '[' .. table.concat(parts, ',') .. ']'
        else
            local parts = {}
            for key, val in pairs(obj) do
                parts[#parts + 1] = json.encode(tostring(key)) .. ':' .. json.encode(val)
            end
            return '{' .. table.concat(parts, ',') .. '}'
        end
    end
    return 'null'
end

function json.decode(str)
    if not str or str == "" then return nil end
    
    local pos = 1
    local function skip_whitespace()
        while pos <= #str and str:sub(pos, pos):match('%s') do
            pos = pos + 1
        end
    end
    
    local function parse_value()
        skip_whitespace()
        local c = str:sub(pos, pos)
        
        if c == '"' then
            -- String
            pos = pos + 1
            local start = pos
            local result = ""
            while pos <= #str do
                c = str:sub(pos, pos)
                if c == '\\' then
                    result = result .. str:sub(start, pos - 1)
                    pos = pos + 1
                    local escape = str:sub(pos, pos)
                    if escape == 'n' then result = result .. '\n'
                    elseif escape == 'r' then result = result .. '\r'
                    elseif escape == 't' then result = result .. '\t'
                    elseif escape == 'b' then result = result .. '\b'
                    elseif escape == 'f' then result = result .. '\f'
                    elseif escape == '"' then result = result .. '"'
                    elseif escape == '\\' then result = result .. '\\'
                    elseif escape == '/' then result = result .. '/'
                    else result = result .. escape end
                    pos = pos + 1
                    start = pos
                elseif c == '"' then
                    result = result .. str:sub(start, pos - 1)
                    pos = pos + 1
                    return result
                else
                    pos = pos + 1
                end
            end
            return result
        elseif c == '{' then
            -- Object
            pos = pos + 1
            local obj = {}
            skip_whitespace()
            if str:sub(pos, pos) == '}' then
                pos = pos + 1
                return obj
            end
            while pos <= #str do
                skip_whitespace()
                if pos > #str then break end
                local key = parse_value()
                skip_whitespace()
                if str:sub(pos, pos) == ':' then pos = pos + 1 end
                local value = parse_value()
                obj[key] = value
                skip_whitespace()
                c = str:sub(pos, pos)
                if c == '}' then
                    pos = pos + 1
                    return obj
                elseif c == ',' then
                    pos = pos + 1
                end
            end
            return obj
        elseif c == '[' then
            -- Array
            pos = pos + 1
            local arr = {}
            skip_whitespace()
            if str:sub(pos, pos) == ']' then
                pos = pos + 1
                return arr
            end
            while pos <= #str do
                arr[#arr + 1] = parse_value()
                skip_whitespace()
                if pos > #str then break end
                c = str:sub(pos, pos)
                if c == ']' then
                    pos = pos + 1
                    return arr
                elseif c == ',' then
                    pos = pos + 1
                end
            end
            return arr
        elseif str:sub(pos, pos + 3) == 'true' then
            pos = pos + 4
            return true
        elseif str:sub(pos, pos + 4) == 'false' then
            pos = pos + 5
            return false
        elseif str:sub(pos, pos + 3) == 'null' then
            pos = pos + 4
            return nil
        else
            -- Number
            local start = pos
            while pos <= #str and str:sub(pos, pos):match('[%d%.%-eE%+]') do
                pos = pos + 1
            end
            return tonumber(str:sub(start, pos - 1))
        end
    end
    
    local success, result = pcall(parse_value)
    if success then
        return result
    else
        print("[PanelBridge] JSON parse error: " .. tostring(result))
        return nil
    end
end

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Helper to get player by username (works in B42)
-- The global getPlayerByUsername may not exist in all versions
local function getPlayerByUsername(username)
    if not username then return nil end
    
    local onlinePlayers = getOnlinePlayers()
    if not onlinePlayers then return nil end
    
    for i = 0, onlinePlayers:size() - 1 do
        local player = onlinePlayers:get(i)
        if player and player:getUsername() == username then
            return player
        end
    end
    
    return nil
end

-- ============================================
-- FILE OPERATIONS
-- ============================================

function PanelBridge.getBasePath()
    if PanelBridge.basePath then
        return PanelBridge.basePath
    end
    
    -- For dedicated servers, we write to the Lua folder itself
    -- Files will be created in: {ServerInstall}/Lua/panelbridge/{serverName}/
    -- This is within the allowed write path for getFileWriter
    local serverName = getServerName()
    local safeServerName = nil
    if serverName and serverName ~= "" then
        safeServerName = tostring(serverName)
        safeServerName = safeServerName:gsub("[/\\:%*%?\"<>|]", "_")
        safeServerName = safeServerName:gsub("%s+", "_")
        if safeServerName == "" then safeServerName = nil end
    end
    
    if safeServerName then
        -- Simple path within allowed Lua folder
        PanelBridge.basePath = "panelbridge/" .. safeServerName .. "/"
    else
        -- Fallback
        PanelBridge.basePath = "panelbridge/"
    end
    
    print("[PanelBridge] Using path: " .. PanelBridge.basePath)
    return PanelBridge.basePath
end

function PanelBridge.ensureDirectory()
    local path = PanelBridge.getBasePath()
    -- Create directory by writing init file
    local initPath = path .. ".init"
    local writer = getFileWriter(initPath, true, false)
    if writer then
        local stamp = "unknown"
        if os and os.date then
            local ok, val = pcall(function() return os.date() end)
            if ok and val then stamp = tostring(val) end
        elseif getTimestampMs then
            stamp = tostring(getTimestampMs())
        end
        writer:write("PanelBridge initialized at " .. stamp)
        writer:close()
        return true
    end
    return false
end

function PanelBridge.readFile(filename)
    local path = PanelBridge.getBasePath() .. filename
    local reader = getFileReader(path, false)
    if not reader then
        return nil
    end
    
    local lines = {}
    local line = reader:readLine()
    while line do
        lines[#lines + 1] = line
        line = reader:readLine()
    end
    reader:close()
    
    local content = table.concat(lines, "\n")
    return content:gsub("^%s*(.-)%s*$", "%1") -- trim
end

function PanelBridge.writeFile(filename, content)
    local path = PanelBridge.getBasePath() .. filename
    local writer = getFileWriter(path, true, false)
    if not writer then
        print("[PanelBridge] Error: Could not write to " .. path)
        return false
    end
    writer:write(content)
    writer:close()
    return true
end

function PanelBridge.readJSON(filename)
    local content = PanelBridge.readFile(filename)
    if not content or content == "" then
        return nil
    end
    return json.decode(content)
end

function PanelBridge.writeJSON(filename, data)
    local content = json.encode(data)
    return PanelBridge.writeFile(filename, content)
end

function PanelBridge.clearFile(filename)
    return PanelBridge.writeFile(filename, "")
end

function PanelBridge.formatSeq(seq)
    local n = tonumber(seq) or 0
    if n < 0 then n = 0 end
    return string.format("%0" .. tostring(PanelBridge.QUEUE_SEQUENCE_WIDTH) .. "d", math.floor(n))
end

function PanelBridge.readQueueState()
    local state = PanelBridge.readJSON("queue-state-lua.json")
    if type(state) == "table" then
        local lastCommandSeq = tonumber(state.lastCommandSeq)
        local nextResultSeq = tonumber(state.nextResultSeq)
        if lastCommandSeq and lastCommandSeq >= 0 then
            PanelBridge.queueState.lastCommandSeq = math.floor(lastCommandSeq)
        end
        if nextResultSeq and nextResultSeq >= 1 then
            PanelBridge.queueState.nextResultSeq = math.floor(nextResultSeq)
        end
    end
end

function PanelBridge.writeQueueState()
    return PanelBridge.writeJSON("queue-state-lua.json", {
        protocolVersion = PanelBridge.PROTOCOL_VERSION,
        lastCommandSeq = PanelBridge.queueState.lastCommandSeq,
        nextResultSeq = PanelBridge.queueState.nextResultSeq,
        updatedAt = getTimestampMs()
    })
end

function PanelBridge.writeInboxCursor(lastSeq)
    return PanelBridge.writeJSON("inbox/cursor.json", {
        protocolVersion = PanelBridge.PROTOCOL_VERSION,
        lastProcessedSeq = tonumber(lastSeq) or 0,
        updatedAt = getTimestampMs()
    })
end

-- ============================================
-- RESULT HANDLING
-- ============================================

function PanelBridge.sendResult(id, success, data, errorMsg)
    if #PanelBridge.pendingResults >= PanelBridge.MAX_PENDING_RESULTS then
        table.remove(PanelBridge.pendingResults, 1)
        PanelBridge.warn("Pending result buffer full, dropping oldest result", {
            max = PanelBridge.MAX_PENDING_RESULTS
        })
    end

    -- Buffer results in memory; they're flushed to disk once per tick in flushResults()
    -- This avoids the read-modify-write race where the Node side reads results.json
    -- between our read and our write, or two sendResult calls in the same tick
    -- overwrite each other.
    table.insert(PanelBridge.pendingResults, {
        protocolVersion = PanelBridge.PROTOCOL_VERSION,
        seq = PanelBridge.queueState.nextResultSeq,
        id = id,
        success = success,
        data = data,
        error = errorMsg,
        timestamp = getTimestampMs()
    })
    PanelBridge.queueState.nextResultSeq = PanelBridge.queueState.nextResultSeq + 1
    PanelBridge.writeQueueState()
end

function PanelBridge.flushResults()
    if #PanelBridge.pendingResults == 0 then return end

    local writtenCount = 0
    for idx, r in ipairs(PanelBridge.pendingResults) do
        local seq = tonumber(r.seq) or 0
        local outFile = "outbox/res-" .. PanelBridge.formatSeq(seq) .. ".json"
        local ok = PanelBridge.writeJSON(outFile, {
            protocolVersion = PanelBridge.PROTOCOL_VERSION,
            seq = seq,
            result = {
                id = r.id,
                success = r.success,
                data = r.data,
                error = r.error,
                timestamp = r.timestamp,
            }
        })
        if not ok then
            PanelBridge.warn("Queue result write failed; will retry", { file = outFile, seq = seq })
            break
        end
        writtenCount = idx
    end

    if writtenCount <= 0 then
        return
    end
    
    -- Read existing results from disk (Node may not have consumed them yet)
    local results = PanelBridge.readJSON("results.json") or { results = {} }
    if not results.results then results.results = {} end
    
    -- Append all buffered results at once
    for i = 1, writtenCount do
        local r = PanelBridge.pendingResults[i]
        table.insert(results.results, r)
    end
    
    -- Keep only last 50 results
    while #results.results > 50 do
        table.remove(results.results, 1)
    end
    
    -- Write BEFORE clearing the buffer so results aren't lost if write fails
    local ok = PanelBridge.writeJSON("results.json", results)
    if not ok then
        PanelBridge.warn("Legacy results.json write failed (queue files still written)")
    end

    local remaining = {}
    for i = writtenCount + 1, #PanelBridge.pendingResults do
        table.insert(remaining, PanelBridge.pendingResults[i])
    end
    PanelBridge.pendingResults = remaining
end

-- ============================================
-- COMMAND HANDLERS
-- ============================================

local handlers = {}

local function processSingleCommand(cmd)
    if type(cmd) ~= "table" then
        PanelBridge.stats.commandsFailed = PanelBridge.stats.commandsFailed + 1
        PanelBridge.warn("Skipping malformed command entry", { entryType = type(cmd) })
        return false
    end

    if cmd.id == nil and cmd.commandId ~= nil then
        cmd.id = cmd.commandId
    end
    if cmd.args == nil and type(cmd.payload) == "table" then
        cmd.args = cmd.payload
    end

    if not cmd.id then
        PanelBridge.stats.commandsFailed = PanelBridge.stats.commandsFailed + 1
        PanelBridge.warn("Skipping command without id", { action = tostring(cmd.action) })
        return false
    end

    if PanelBridge.processedIds[cmd.id] then
        return false
    end

    PanelBridge.processedIds[cmd.id] = true
    PanelBridge.processedIdCount = PanelBridge.processedIdCount + 1
    PanelBridge.stats.commandsProcessed = PanelBridge.stats.commandsProcessed + 1

    -- Frequent polling commands log at DEBUG to avoid spam
    local quietCommands = { getServerInfo=true, ping=true, getWeather=true, getGameTime=true, getWorldStats=true, getUtilitiesStatus=true, getClimateFloats=true, getAllPlayerDetails=true }
    if quietCommands[cmd.action] then
        PanelBridge.debug("Processing command: " .. tostring(cmd.action), { id = cmd.id })
    else
        PanelBridge.info("Processing command: " .. tostring(cmd.action), { id = cmd.id })
    end

    local handler = handlers[cmd.action]
    if handler then
        local handlerArgs = {}
        if type(cmd.args) == "table" then
            handlerArgs = cmd.args
        elseif cmd.args ~= nil then
            PanelBridge.warn("Command args must be a table; defaulting to empty args", {
                id = cmd.id,
                action = tostring(cmd.action),
                argsType = type(cmd.args)
            })
        end

        local startTime = getTimestampMs()
        local pcallOk, success, data, errorMsg = pcall(handler, handlerArgs)
        local duration = getTimestampMs() - startTime

        if not pcallOk then
            PanelBridge.stats.commandsFailed = PanelBridge.stats.commandsFailed + 1
            local crashMsg = "Handler crashed: " .. tostring(success)
            PanelBridge.error("Command crashed: " .. tostring(cmd.action), {
                error = crashMsg,
                duration = duration .. "ms"
            })
            PanelBridge.sendResult(cmd.id, false, nil, crashMsg)
        elseif success then
            PanelBridge.stats.commandsSucceeded = PanelBridge.stats.commandsSucceeded + 1
            PanelBridge.debug("Command succeeded: " .. tostring(cmd.action), {
                duration = duration .. "ms"
            })
            PanelBridge.sendResult(cmd.id, success, data, errorMsg)
        else
            PanelBridge.stats.commandsFailed = PanelBridge.stats.commandsFailed + 1
            PanelBridge.warn("Command failed: " .. tostring(cmd.action), {
                error = errorMsg,
                duration = duration .. "ms"
            })
            PanelBridge.sendResult(cmd.id, success, data, errorMsg)
        end
    else
        PanelBridge.stats.commandsFailed = PanelBridge.stats.commandsFailed + 1
        local errorMsg = "Unknown command: " .. tostring(cmd.action)
        PanelBridge.warn(errorMsg)
        PanelBridge.sendResult(cmd.id, false, nil, errorMsg)
    end

    return true
end

local function processQueuedCommands(budget)
    local processed = 0
    if budget <= 0 then return processed end

    local nextSeq = (PanelBridge.queueState.lastCommandSeq or 0) + 1
    local advanced = false

    while processed < budget do
        local fileName = "inbox/cmd-" .. PanelBridge.formatSeq(nextSeq) .. ".json"
        local raw = PanelBridge.readFile(fileName)
        if raw == nil then
            break
        end
        local shouldAdvance = false

        if raw == "" then
            shouldAdvance = true
        else
            local queued = json.decode(raw)
            if not queued then
                PanelBridge.warn("Skipping malformed queued command file", { file = fileName, seq = nextSeq })
                PanelBridge.clearFile(fileName)
                shouldAdvance = true
            else
                PanelBridge.queueState.lastCommandSeq = nextSeq
                PanelBridge.writeInboxCursor(nextSeq)
                advanced = true

                local cmd = queued.command or queued
                if processSingleCommand(cmd) then
                    processed = processed + 1
                end

                -- Keep files compact after consumption.
                PanelBridge.clearFile(fileName)
                shouldAdvance = true
            end
        end

        if shouldAdvance then
            PanelBridge.queueState.lastCommandSeq = nextSeq
            PanelBridge.writeInboxCursor(nextSeq)
            advanced = true
            nextSeq = nextSeq + 1
        end
    end

    if advanced then
        PanelBridge.writeQueueState()
    end

    return processed
end

local function normalizeMessage(value, maxLen)
    if value == nil then return nil end
    local message = tostring(value)
    if message == "" then return nil end
    if maxLen and #message > maxLen then
        message = message:sub(1, maxLen)
    end
    return message
end

-- ============================================
-- DEBUG & UTILITY HANDLERS
-- ============================================

-- Get debug log entries
handlers.getDebugLog = function(args)
    local limit = tonumber(args.limit) or 50
    limit = math.floor(limit)
    if limit < 1 then limit = 1 end
    if limit > 200 then limit = 200 end

    local minLevel = tostring(args.minLevel or "DEBUG")
    minLevel = string.upper(minLevel)
    
    local entries = {}
    local levelMap = { DEBUG = 1, INFO = 2, WARN = 3, ERROR = 4 }
    local minLevelNum = levelMap[minLevel] or 1
    
    local startIdx = math.max(1, #PanelBridge.debugLog - limit + 1)
    for i = startIdx, #PanelBridge.debugLog do
        local entry = PanelBridge.debugLog[i]
        if entry and levelMap[entry.level] >= minLevelNum then
            table.insert(entries, entry)
        end
    end
    
    return true, {
        entries = entries,
        totalEntries = #PanelBridge.debugLog,
        debugMode = PanelBridge.DEBUG_MODE
    }
end

-- Toggle debug mode
handlers.setDebugMode = function(args)
    PanelBridge.DEBUG_MODE = args.enabled == true
    PanelBridge.info("Debug mode " .. (PanelBridge.DEBUG_MODE and "enabled" or "disabled"))
    return true, { debugMode = PanelBridge.DEBUG_MODE }
end

-- Get statistics
handlers.getStats = function(args)
    local uptime = 0
    if PanelBridge.stats.startTime then
        uptime = (getTimestampMs() - PanelBridge.stats.startTime) / 1000
    end
    
    return true, {
        version = PanelBridge.VERSION,
        uptime = uptime,
        commandsProcessed = PanelBridge.stats.commandsProcessed,
        commandsSucceeded = PanelBridge.stats.commandsSucceeded,
        commandsFailed = PanelBridge.stats.commandsFailed,
        lastError = PanelBridge.stats.lastError,
        recentErrors = PanelBridge.stats.errors,
        debugMode = PanelBridge.DEBUG_MODE,
        detectedVersion = PanelBridge.detectedVersion
    }
end

-- Check API availability
handlers.checkAPI = function(args)
    local objName = args.object or "ClimateManager"
    local methodName = args.method
    
    local obj = nil
    local result = { object = objName, available = false }
    
    -- Get the object
    if objName == "ClimateManager" then
        obj = getClimateManager and getClimateManager()
    elseif objName == "GameTime" then
        obj = getGameTime and getGameTime()
    elseif objName == "World" then
        obj = getWorld and getWorld()
    elseif objName == "ChatServer" then
        local ok, chatServer = pcall(function() return ChatServer.getInstance() end)
        if ok then obj = chatServer end
    elseif objName == "SandboxOptions" then
        obj = getSandboxOptions and getSandboxOptions()
    end
    
    if obj then
        result.available = true
        result.type = type(obj)
        
        -- If method specified, check if it exists
        if methodName then
            result.method = methodName
            result.methodAvailable = PanelBridge.hasMethod(obj, methodName)
        else
            -- List available methods (limited)
            result.methods = {}
            local ok = pcall(function()
                local count = 0
                for k, v in pairs(obj) do
                    if type(v) == "function" and count < 50 then
                        table.insert(result.methods, k)
                        count = count + 1
                    end
                end
                table.sort(result.methods)
            end)
            if not ok then
                result.methods = nil
                result.methodsError = "Method enumeration not supported for this object type"
            end
        end
    end
    
    return true, result
end

-- Get list of all available handlers
handlers.getAvailableHandlers = function(args)
    local handlerList = {}
    for name, _ in pairs(handlers) do
        table.insert(handlerList, name)
    end
    table.sort(handlerList)
    return true, { 
        handlers = handlerList,
        count = #handlerList,
        version = PanelBridge.VERSION
    }
end

-- Clear error log
handlers.clearErrors = function(args)
    local count = #PanelBridge.stats.errors
    PanelBridge.stats.errors = {}
    PanelBridge.stats.lastError = nil
    PanelBridge.info("Error log cleared", { count = count })
    return true, { message = "Cleared " .. count .. " errors" }
end

-- Ping/heartbeat
handlers.ping = function(args)
    local onlinePlayers = getOnlinePlayers()
    return true, {
        message = "pong",
        version = PanelBridge.VERSION,
        serverTime = getTimestampMs(),
        playerCount = onlinePlayers and onlinePlayers:size() or 0
    }
end

-- Get server info
handlers.getServerInfo = function(args)
    local players = {}
    local onlinePlayers = getOnlinePlayers()
    
    if onlinePlayers then
        for i = 0, onlinePlayers:size() - 1 do
            local player = onlinePlayers:get(i)
            if player then
                -- Wrap each player in pcall so one bad player doesn't break the whole list
                local ok, playerData = pcall(function()
                    local health = 100
                    local bodyDamage = player:getBodyDamage()
                    if bodyDamage then
                        health = bodyDamage:getOverallBodyHealth() or 100
                    end
                    return {
                        name = player:getUsername() or "Unknown",
                        x = math.floor(player:getX() or 0),
                        y = math.floor(player:getY() or 0),
                        z = math.floor(player:getZ() or 0),
                        health = health
                    }
                end)
                if ok and playerData then
                    table.insert(players, playerData)
                end
            end
        end
    end
    
    local gameTime = getGameTime()
    local gameTimeData = nil
    if gameTime then
        pcall(function()
            -- Use getHour()/getMinutes() on B42, fall back to getTimeOfDay() on B41
            local hour, minute
            if gameTime.getHour then
                hour = gameTime:getHour()
                minute = gameTime.getMinutes and gameTime:getMinutes() or 0
            else
                local tod = gameTime:getTimeOfDay()
                hour = math.floor(tod)
                minute = math.floor((tod - hour) * 60)
            end
            gameTimeData = {
                day = gameTime:getDay(),
                month = gameTime:getMonth() + 1, -- Lua 1-indexed
                year = gameTime:getYear(),
                hour = hour,
                minute = minute
            }
        end)
    end
    
    return true, {
        players = players,
        playerCount = #players,
        gameTime = gameTimeData
    }
end

-- Get weather info
handlers.getWeather = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    -- Get weather data with safe access for cross-version compatibility
    local success, data = pcall(function()
        local cloudIntensity = climate:getCloudIntensity()
        local precipIntensity = climate:getPrecipitationIntensity()
        
        return {
            temperature = climate:getTemperature(),
            humidity = climate:getHumidity(),
            windSpeed = climate:getWindspeedKph(),
            windAngle = climate:getWindAngleDegrees(),
            fogIntensity = climate:getFogIntensity(),
            cloudIntensity = cloudIntensity,
            precipitationIntensity = precipIntensity,
            isRaining = climate:isRaining(),
            isSnowing = climate:isSnowing(),
            isThunderStorming = climate.getIsThunderStorming and climate:getIsThunderStorming() or false,
            dayLight = climate:getDayLightStrength(),
            nightStrength = climate:getNightStrength(),
            desaturation = climate:getDesaturation(),
            viewDistance = climate.getViewDistance and climate:getViewDistance() or 1.0,
            ambient = climate.getAmbient and climate:getAmbient() or 1.0
        }
    end)
    
    if not success then
        return false, nil, "Failed to get weather data: " .. tostring(data)
    end
    
    return true, data
end

-- Trigger blizzard (duration is in hours, minimum ~2 hours in game)
handlers.triggerBlizzard = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    -- Duration is passed directly - the game adds its own minimum
    local duration = args.duration or 2.0
    
    local success, err = pcall(function()
        if climate.triggerCustomWeatherStage and WeatherPeriod and WeatherPeriod.STAGE_BLIZZARD then
            print("PanelBridge: Triggering Blizzard via triggerCustomWeatherStage")
            climate:triggerCustomWeatherStage(WeatherPeriod.STAGE_BLIZZARD, duration)
        elseif climate.transmitTriggerBlizzard then
            print("PanelBridge: Triggering Blizzard via transmitTriggerBlizzard (fallback)")
            climate:transmitTriggerBlizzard(duration)
        else
            error("No weather trigger method available")
        end
    end)
    
    if not success then
        return false, nil, "Failed to trigger blizzard: " .. tostring(err)
    end
    
    return true, { message = "Blizzard triggered", duration = duration }
end

-- Trigger tropical storm
handlers.triggerTropicalStorm = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    local duration = args.duration or 2.0
    
    local success, err = pcall(function()
        if climate.triggerCustomWeatherStage and WeatherPeriod and WeatherPeriod.STAGE_TROPICAL_STORM then
             print("PanelBridge: Triggering Tropical Storm via triggerCustomWeatherStage")
            climate:triggerCustomWeatherStage(WeatherPeriod.STAGE_TROPICAL_STORM, duration)
        elseif climate.transmitTriggerTropical then
            print("PanelBridge: Triggering Tropical Storm via transmitTriggerTropical (fallback)")
            climate:transmitTriggerTropical(duration)
        else
            error("No weather trigger method available")
        end
    end)
    
    if not success then
        return false, nil, "Failed to trigger tropical storm: " .. tostring(err)
    end
    
    return true, { message = "Tropical storm triggered", duration = duration }
end

-- Trigger regular storm
handlers.triggerStorm = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    local duration = args.duration or 2.0
    
    local success, err = pcall(function()
        if climate.triggerCustomWeatherStage and WeatherPeriod and WeatherPeriod.STAGE_STORM then
            print("PanelBridge: Triggering Storm via triggerCustomWeatherStage")
            climate:triggerCustomWeatherStage(WeatherPeriod.STAGE_STORM, duration)
        elseif climate.transmitTriggerStorm then
            print("PanelBridge: Triggering Storm via transmitTriggerStorm (fallback)")
            climate:transmitTriggerStorm(duration)
        else
            error("No weather trigger method available")
        end
    end)
    
    if not success then
        return false, nil, "Failed to trigger storm: " .. tostring(err)
    end
    
    return true, { message = "Storm triggered", duration = duration }
end

-- Stop weather
handlers.stopWeather = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    local success, err = pcall(function()
        if climate.stopWeatherAndThunder then
            print("PanelBridge: Stopping weather via stopWeatherAndThunder")
            climate:stopWeatherAndThunder()
        elseif climate.transmitServerStopWeather then
             print("PanelBridge: Stopping weather via transmitServerStopWeather (fallback)")
            climate:transmitServerStopWeather()
        elseif climate.transmitStopWeather then
             print("PanelBridge: Stopping weather via transmitStopWeather (fallback)")
            climate:transmitStopWeather()
        else
            error("No stop weather method available")
        end
    end)
    
    if not success then
        return false, nil, "Failed to stop weather: " .. tostring(err)
    end
    
    return true, { message = "Weather stopped" }
end

-- Generate custom weather period
handlers.generateWeather = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    local strength = args.strength or 0.5
    local frontType = args.frontType or 0 -- 0 = stationary, 1 = cold, 2 = warm
    
    -- Map frontend frontType values to B42 Java constants:
    -- FRONT_COLD = -1, FRONT_STATIONARY = 0, FRONT_WARM = 1
    local javaFrontMap = { [0] = 0, [1] = -1, [2] = 1 }
    local javaFrontType = javaFrontMap[frontType] or 0
    
    local success, err = pcall(function()
        if climate.transmitGenerateWeather then
            print("PanelBridge: Generating weather via transmitGenerateWeather")
            climate:transmitGenerateWeather(strength, javaFrontType)
        elseif climate.triggerCustomWeather then
            print("PanelBridge: Generating weather via triggerCustomWeather (fallback)")
            -- triggerCustomWeather only supports warm/cold boolean, no stationary
            climate:triggerCustomWeather(strength, frontType ~= 1)
        else
            error("No generate weather method available")
        end
    end)
    
    if not success then
        return false, nil, "Failed to generate weather: " .. tostring(err)
    end
    
    return true, { message = "Weather period generated", strength = strength, frontType = frontType }
end

-- Set precipitation to snow (also starts rain if enabling snow)
handlers.setSnow = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    local enabled = args.enabled ~= false
    local success, err
    
    -- If enabling snow and not currently raining, start rain first
    if enabled and climate.isRaining and not climate:isRaining() then
        local intensity = args.intensity or 0.5
        if climate.transmitServerStartRain then
            pcall(function() climate:transmitServerStartRain(intensity) end)
        end
    end
    
    success, err = pcall(function()
        -- Try Admin Override (Robust method)
        local snowBool = climate:getClimateBool(0) -- BOOL_IS_SNOW = 0
        if snowBool then
            snowBool:setEnableAdmin(true)
            snowBool:setAdminValue(enabled)
            -- Also trigger normal method just in case
            if climate.setPrecipitationIsSnow then
                climate:setPrecipitationIsSnow(enabled)
            end
        elseif climate.setPrecipitationIsSnow then
            climate:setPrecipitationIsSnow(enabled)
        else
            error("No method to set snow")
        end
    end)
    
    if not success then
        return false, nil, "Failed to set snow: " .. tostring(err)
    end
    
    return true, { message = "Snow " .. (enabled and "enabled (with precipitation)" or "disabled") }
end

-- Start rain
handlers.startRain = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    local intensity = args.intensity or 0.5
    
    local success, err
    if climate.transmitServerStartRain then
        success, err = pcall(function() climate:transmitServerStartRain(intensity) end)
    else
        return false, nil, "transmitServerStartRain method not available in this version"
    end
    
    if not success then
        return false, nil, "Failed to start rain: " .. tostring(err)
    end
    
    return true, { message = "Rain started", intensity = intensity }
end

-- Stop rain
handlers.stopRain = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    local success, err
    if climate.transmitServerStopRain then
        success, err = pcall(function() climate:transmitServerStopRain() end)
    else
        return false, nil, "transmitServerStopRain method not available in this version"
    end
    
    if not success then
        return false, nil, "Failed to stop rain: " .. tostring(err)
    end
    
    return true, { message = "Rain stopped" }
end

-- Trigger lightning
handlers.triggerLightning = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    local x = args.x or 0
    local y = args.y or 0
    local strike = args.strike ~= false  -- default to true
    local light = args.light ~= false     -- default to true
    local rumble = args.rumble ~= false   -- default to true
    
    local success, err
    if climate.transmitServerTriggerLightning then
        success, err = pcall(function() climate:transmitServerTriggerLightning(x, y, strike, light, rumble) end)
    else
        return false, nil, "transmitServerTriggerLightning method not available in this version"
    end
    
    if not success then
        return false, nil, "Failed to trigger lightning: " .. tostring(err)
    end
    
    return true, { message = "Lightning triggered", x = x, y = y }
end

-- Set daylight strength (for darkness control)
handlers.setDayLight = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    local value = tonumber(args.value) or 1.0
    
    local success, err = pcall(function()
        local cf = climate:getClimateFloat(11) -- FLOAT_DAYLIGHT_STRENGTH = 11
        if cf then
            cf:setEnableAdmin(true)
            cf:setAdminValue(value)
        elseif climate.setDayLightStrength then
            climate:setDayLightStrength(value)
        else
            error("No method to set daylight")
        end
    end)
    
    if not success then
        return false, nil, "Failed to set daylight: " .. tostring(err)
    end
    
    return true, { message = "Daylight set to " .. value }
end

-- Set night strength
handlers.setNightStrength = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    local value = tonumber(args.value) or 0.0
    
    local success, err = pcall(function()
        local cf = climate:getClimateFloat(2) -- FLOAT_NIGHT_STRENGTH = 2
        if cf then
            cf:setEnableAdmin(true)
            cf:setAdminValue(value)
        elseif climate.setNightStrength then
            climate:setNightStrength(value)
        else
            error("No method to set night strength")
        end
    end)
    
    if not success then
        return false, nil, "Failed to set night strength: " .. tostring(err)
    end
    
    return true, { message = "Night strength set to " .. value }
end

-- Set desaturation (color saturation control)
handlers.setDesaturation = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    local value = tonumber(args.value) or 0.0
    
    local success, err = pcall(function()
        local cf = climate:getClimateFloat(0) -- FLOAT_DESATURATION = 0
        if cf then
            cf:setEnableAdmin(true)
            cf:setAdminValue(value)
        elseif climate.setDesaturation then
            climate:setDesaturation(value)
        else
            error("No method to set desaturation")
        end
    end)
    
    if not success then
        return false, nil, "Failed to set desaturation: " .. tostring(err)
    end
    
    return true, { message = "Desaturation set to " .. value }
end

-- Set view distance (fog approximation)
handlers.setViewDistance = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    local value = tonumber(args.value) or 1.0
    
    local success, err = pcall(function()
        local cf = climate:getClimateFloat(10) -- FLOAT_VIEW_DISTANCE = 10
        if cf then
            cf:setEnableAdmin(true)
            cf:setAdminValue(value)
        elseif climate.setViewDistance then
            climate:setViewDistance(value)
        else
            error("No method to set view distance")
        end
    end)
    
    if not success then
        return false, nil, "Failed to set view distance: " .. tostring(err)
    end
    
    return true, { message = "View distance set to " .. value }
end

-- Set ambient light
handlers.setAmbient = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    local value = tonumber(args.value) or 1.0
    
    local success, err = pcall(function()
        local cf = climate:getClimateFloat(9) -- FLOAT_AMBIENT = 9
        if cf then
            cf:setEnableAdmin(true)
            cf:setAdminValue(value)
        elseif climate.setAmbient then
            climate:setAmbient(value)
        else
            error("No method to set ambient")
        end
    end)
    
    if not success then
        return false, nil, "Failed to set ambient: " .. tostring(err)
    end
    
    return true, { message = "Ambient set to " .. value }
end

-- Set temperature (Celsius)
-- Ranges and Effects (Project Zomboid Mechanics):
-- <-10 C: Extreme Cold. Winter clothes required. Poor quality vehicles may fail to start.
-- < 0 C : Freezing. Snow replaces Rain. Farming crops loose health faster.
-- 0 - 20 C: Cold to Cool. Light to Medium insulation required depending on wind/wetness.
-- 22 C  : Neutral. Base "Room Temperature". Neutral impact on body heat.
-- > 30 C: Hot. Rate of fatigue and thirst increases. Thick clothes cause overheating.
-- > 40 C: Extreme Heat. Rapid dehydration. Hyperthermia risk even when naked.
handlers.setTemperature = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    local value = tonumber(args.value) or 22.0 -- Default to 22C (Neutral)
    
    -- API Safety Clamp: -50C to +50C
    -- Note: Project Zomboid does not simulate water bodies freezing solid (rivers/lakes).
    if value < -50 then value = -50 end
    if value > 50 then value = 50 end

    local success, err = pcall(function()
        local cf = climate:getClimateFloat(4) -- FLOAT_TEMPERATURE = 4
        if cf then
            cf:setEnableAdmin(true)
            cf:setAdminValue(value)
        else
            error("No method to set temperature")
        end
    end)
    
    if not success then
        return false, nil, "Failed to set temperature: " .. tostring(err)
    end
    
    return true, { message = "Temperature set to " .. value .. "C" }
end

-- Set wind intensity
handlers.setWind = function(args)
    local climate = getClimateManager()
    if not climate then return false, nil, "ClimateManager not available" end
    
    local value = tonumber(args.value) or 0.5 -- 0 to 1
    
    local success, err = pcall(function()
        local cf = climate:getClimateFloat(6) -- FLOAT_WIND_INTENSITY = 6
        if cf then
            cf:setEnableAdmin(true)
            cf:setAdminValue(value)
        else
             error("No method to set wind")
        end
    end)
    
    if not success then return false, nil, "Failed to set wind: " .. tostring(err) end
    return true, { message = "Wind set to " .. value }
end

-- Set fog intensity
handlers.setFog = function(args)
    local climate = getClimateManager()
    if not climate then return false, nil, "ClimateManager not available" end
    
    local value = tonumber(args.value) or 0.0 -- 0 (Clear) to 1 (Silent Hill)
    
    local success, err = pcall(function()
        local cf = climate:getClimateFloat(5) -- FLOAT_FOG_INTENSITY = 5
        if cf then
            cf:setEnableAdmin(true)
            cf:setAdminValue(value)
        else
             error("No method to set fog")
        end
    end)
    
    if not success then return false, nil, "Failed to set fog: " .. tostring(err) end
    return true, { message = "Fog set to " .. value }
end

-- Set cloud intensity
handlers.setClouds = function(args)
    local climate = getClimateManager()
    if not climate then return false, nil, "ClimateManager not available" end
    
    local value = tonumber(args.value) or 0.0 -- 0 to 1
    
    local success, err = pcall(function()
        local cf = climate:getClimateFloat(8) -- FLOAT_CLOUD_INTENSITY = 8
        if cf then
            cf:setEnableAdmin(true)
            cf:setAdminValue(value)
        else
             error("No method to set clouds")
        end
    end)
    
    if not success then return false, nil, "Failed to set clouds: " .. tostring(err) end
    return true, { message = "Clouds set to " .. value }
end

-- Climate override control - set individual climate float values
-- This uses the ClimateFloat system for admin control
handlers.setClimateFloat = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    local floatId = tonumber(args.floatId)
    local value = tonumber(args.value)
    local enable = args.enable ~= false
    
    if floatId == nil or value == nil then
        return false, nil, "floatId and value are required numbers"
    end
    
    local climateFloat = climate:getClimateFloat(floatId)
    if not climateFloat then
        return false, nil, "Invalid float ID: " .. floatId
    end
    
    local success, err = pcall(function()
        climateFloat:setEnableAdmin(enable)
        if enable then
            climateFloat:setAdminValue(value)
        end
    end)
    
    if not success then
        return false, nil, "Failed to set climate float: " .. tostring(err)
    end
    
    return true, { 
        message = "Climate float set", 
        floatId = floatId, 
        value = value, 
        enabled = enable,
        name = climateFloat:getName()
    }
end

-- Reset all climate overrides
handlers.resetClimateOverrides = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    -- B42: use resetAdmin() which resets all float + bool admin overrides in one call
    if climate.resetAdmin then
        pcall(function() climate:resetAdmin() end)
        return true, { message = "Climate overrides reset via resetAdmin()", floatsReset = 13, boolsReset = 1 }
    end
    
    -- Fallback: disable admin override on all known float IDs (0-12)
    local resetCount = 0
    for floatId = 0, 12 do
        local cf = climate:getClimateFloat(floatId)
        if cf and cf.setEnableAdmin then
            cf:setEnableAdmin(false)
            resetCount = resetCount + 1
        end
    end
    
    -- Also reset ClimateBool overrides (e.g. BOOL_IS_SNOW = 0 set by setSnow)
    local boolsReset = 0
    pcall(function()
        local snowBool = climate:getClimateBool(0) -- BOOL_IS_SNOW
        if snowBool and snowBool.setEnableAdmin then
            snowBool:setEnableAdmin(false)
            boolsReset = boolsReset + 1
        end
    end)
    
    return true, { message = "Climate overrides reset", floatsReset = resetCount, boolsReset = boolsReset }
end

-- Get climate float IDs and their current values
handlers.getClimateFloats = function(args)
    local climate = getClimateManager()
    if not climate then
        return false, nil, "ClimateManager not available"
    end
    
    -- Known ClimateFloat IDs from the API
    local floatIds = {
        { id = 0, name = "FLOAT_DESATURATION" },
        { id = 1, name = "FLOAT_GLOBAL_LIGHT_INTENSITY" },
        { id = 2, name = "FLOAT_NIGHT_STRENGTH" },
        { id = 3, name = "FLOAT_PRECIPITATION_INTENSITY" },
        { id = 4, name = "FLOAT_TEMPERATURE" },
        { id = 5, name = "FLOAT_FOG_INTENSITY" },
        { id = 6, name = "FLOAT_WIND_INTENSITY" },
        { id = 7, name = "FLOAT_WIND_ANGLE_INTENSITY" },
        { id = 8, name = "FLOAT_CLOUD_INTENSITY" },
        { id = 9, name = "FLOAT_AMBIENT" },
        { id = 10, name = "FLOAT_VIEW_DISTANCE" },
        { id = 11, name = "FLOAT_DAYLIGHT_STRENGTH" },
        { id = 12, name = "FLOAT_HUMIDITY" }
    }
    
    local floats = {}
    for _, info in ipairs(floatIds) do
        local cf = climate:getClimateFloat(info.id)
        if cf then
            table.insert(floats, {
                id = info.id,
                name = info.name,
                actualName = cf:getName(),
                value = cf:getFinalValue(),
                min = cf:getMin(),
                max = cf:getMax(),
                isAdminEnabled = cf.isEnableAdmin and cf:isEnableAdmin() or false
            })
        end
    end
    
    return true, { floats = floats }
end

-- ============================================
-- SOUND & NOISE HANDLERS
-- ============================================

-- Play a sound at specific world coordinates
-- This creates an audible sound that zombies can hear and respond to
handlers.playWorldSound = function(args)
    local x = tonumber(args.x)
    local y = tonumber(args.y)
    local z = tonumber(args.z) or 0
    local radius = tonumber(args.radius) or 50
    local volume = tonumber(args.volume) or 100
    
    if not x or not y then
        return false, nil, "x and y coordinates are required"
    end
    
    -- AddWorldSound creates a noise that zombies can hear
    -- Parameters: player (can be nil), x, y, z, radius, volume
    addSound(nil, x, y, z, radius, volume)
    
    return true, { 
        message = "World sound created", 
        x = x, 
        y = y, 
        z = z, 
        radius = radius, 
        volume = volume 
    }
end

-- Play a sound near a specific player (zombies will hear it)
handlers.playSoundNearPlayer = function(args)
    local username = args.username
    local radius = tonumber(args.radius) or 50
    local volume = tonumber(args.volume) or 100
    
    if not username then
        return false, nil, "username is required"
    end
    
    local player = getPlayerByUsername(username)
    if not player then
        return false, nil, "Player not found: " .. username
    end
    
    local x = player:getX()
    local y = player:getY()
    local z = player:getZ()
    
    -- Create sound at player's location
    addSound(player, x, y, z, radius, volume)
    
    return true, { 
        message = "Sound created near player", 
        username = username,
        x = x, 
        y = y, 
        z = z, 
        radius = radius, 
        volume = volume 
    }
end

-- Simulate a gunshot sound (very loud, attracts zombies from far away)
handlers.triggerGunshot = function(args)
    local x = tonumber(args.x)
    local y = tonumber(args.y)
    local z = tonumber(args.z) or 0
    local username = args.username
    
    -- If username provided, use player's location
    if username then
        local player = getPlayerByUsername(username)
        if player then
            x = player:getX()
            y = player:getY()
            z = player:getZ()
        else
            return false, nil, "Player not found: " .. username
        end
    end
    
    if not x or not y then
        return false, nil, "Either coordinates (x, y) or username is required"
    end
    
    -- Gunshots have large radius and high volume to attract zombies from far away
    local gunshotRadius = 150
    local gunshotVolume = 200
    
    addSound(nil, x, y, z, gunshotRadius, gunshotVolume)
    
    return true, { 
        message = "Gunshot sound triggered", 
        x = x, 
        y = y, 
        z = z, 
        radius = gunshotRadius 
    }
end

-- Trigger an alarm sound (medium range, sustained attraction)
handlers.triggerAlarmSound = function(args)
    local x = tonumber(args.x)
    local y = tonumber(args.y)
    local z = tonumber(args.z) or 0
    local username = args.username
    
    -- If username provided, use player's location
    if username then
        local player = getPlayerByUsername(username)
        if player then
            x = player:getX()
            y = player:getY()
            z = player:getZ()
        else
            return false, nil, "Player not found: " .. username
        end
    end
    
    if not x or not y then
        return false, nil, "Either coordinates (x, y) or username is required"
    end
    
    -- Alarm has moderate radius
    local alarmRadius = 80
    local alarmVolume = 100
    
    addSound(nil, x, y, z, alarmRadius, alarmVolume)
    
    return true, { 
        message = "Alarm sound triggered", 
        x = x, 
        y = y, 
        z = z, 
        radius = alarmRadius 
    }
end

-- Create a loud noise to attract zombies to a location
handlers.createNoise = function(args)
    local x = tonumber(args.x)
    local y = tonumber(args.y)
    local z = tonumber(args.z) or 0
    local radius = tonumber(args.radius) or 100
    local volume = tonumber(args.volume) or 100
    local username = args.username
    
    -- If username provided, use player's location
    if username then
        local player = getPlayerByUsername(username)
        if player then
            x = player:getX()
            y = player:getY()
            z = player:getZ()
        else
            return false, nil, "Player not found: " .. username
        end
    end
    
    if not x or not y then
        return false, nil, "Either coordinates (x, y) or username is required"
    end
    
    -- Clamp values
    radius = math.min(math.max(radius, 10), 500)
    volume = math.min(math.max(volume, 1), 500)
    
    addSound(nil, x, y, z, radius, volume)
    
    return true, { 
        message = "Noise created", 
        x = x, 
        y = y, 
        z = z, 
        radius = radius,
        volume = volume 
    }
end

-- ============================================
-- TIME & WORLD HANDLERS
-- ============================================

-- Helper to safely get a value from a method that might not exist (with default fallback)
local function safeGetValue(obj, methodName, default)
    if obj and obj[methodName] then
        local success, result = pcall(function() return obj[methodName](obj) end)
        if success and result ~= nil then
            return result
        end
    end
    return default
end

-- Get game time info
handlers.getGameTime = function(args)
    local gameTime = getGameTime()
    if not gameTime then
        return false, nil, "GameTime not available"
    end
    
    -- Use safeGetValue for methods that may not exist in all PZ versions
    return true, {
        year = safeGetValue(gameTime, "getYear", 1993),
        month = (safeGetValue(gameTime, "getMonth", 0) or 0) + 1, -- Lua 1-indexed
        day = safeGetValue(gameTime, "getDay", 1),
        hour = safeGetValue(gameTime, "getTimeOfDay", 12),
        minute = safeGetValue(gameTime, "getMinutes", 0),
        dayOfWeek = safeGetValue(gameTime, "getDayOfWeek", nil),
        worldAgeHours = safeGetValue(gameTime, "getWorldAgeHours", 0),
        timeSinceApo = safeGetValue(gameTime, "getTimeSinceApo", 0),
        moonPhase = safeGetValue(gameTime, "getMoon", nil),
        nightsSurvived = safeGetValue(gameTime, "getNightsSurvived", 0)
    }
end

-- Set game time
handlers.setGameTime = function(args)
    local gameTime = getGameTime()
    if not gameTime then
        return false, nil, "GameTime not available"
    end
    
    local updated = {}
    
    if args.hour ~= nil then
        local hour = tonumber(args.hour) or 12
        -- Set updated before pcall — B42 transmitSetTimeOfDay applies the change
        -- but may throw a RuntimeException afterwards
        updated.hour = hour
        pcall(function()
            if gameTime.transmitSetTimeOfDay then
                gameTime:transmitSetTimeOfDay(hour)
            else
                gameTime:setTimeOfDay(hour)
            end
        end)
    end
    
    if args.day ~= nil then
        local day = tonumber(args.day)
        if day then
            updated.day = day
            pcall(function() gameTime:setDay(day) end)
        end
    end
    
    if args.month ~= nil then
        local month = tonumber(args.month)
        if month then
            month = math.max(1, math.min(12, month))
            updated.month = month
            pcall(function() gameTime:setMonth(month - 1) end)
        end
    end
    
    if args.year ~= nil then
        local year = tonumber(args.year)
        if year then
            updated.year = year
            pcall(function() gameTime:setYear(year) end)
        end
    end
    
    return true, { message = "Game time updated", updated = updated }
end

-- Get world statistics
handlers.getWorldStats = function(args)
    local world = getWorld()
    if not world then
        return false, nil, "World not available"
    end
    
    local cell = world:getCell()
    local zombieCount = 0
    if cell and cell.getZombieList then
        pcall(function()
            local list = cell:getZombieList()
            if list then
                zombieCount = list:size()
            end
        end)
    end
    
    return true, {
        serverName = getServerName(),
        map = world:getMap() or "Unknown",
        zombiesInCell = zombieCount
    }
end

-- Get current time speed multiplier
handlers.getTimeSpeed = function(args)
    local gt = getGameTime()
    if not gt then
        return false, nil, "GameTime not available"
    end

    local multiplier = 1
    pcall(function()
        if gt.getMultiplier then
            multiplier = gt:getMultiplier()
        end
    end)

    return true, { multiplier = multiplier }
end

-- Set time speed multiplier (1 = normal, higher = faster)
handlers.setTimeSpeed = function(args)
    local gt = getGameTime()
    if not gt then
        return false, nil, "GameTime not available"
    end

    local multiplier = tonumber(args.multiplier)
    if not multiplier then
        return false, nil, "multiplier required (number)"
    end
    -- Clamp to safe range: 1x to 100x
    multiplier = math.min(math.max(math.floor(multiplier), 1), 100)

    local ok, err = pcall(function()
        gt:setMultiplier(multiplier)
    end)
    if not ok then
        return false, nil, "Failed to set time speed: " .. tostring(err)
    end

    PanelBridge.info("Time speed set", { multiplier = multiplier })
    return true, { message = "Time speed set to " .. multiplier .. "x", multiplier = multiplier }
end

-- Trigger helicopter event near a player
handlers.triggerHelicopterEvent = function(args)
    local username = args.username
    if not username then
        return false, nil, "Username required"
    end

    local player = getPlayerByUsername(username)
    if not player then
        return false, nil, "Player not found: " .. username
    end

    local method = "unknown"
    local ok, err = pcall(function()
        -- B42: use the helicopter events system
        local HelicopterClass = resolveJavaClass("Helicopter", "zombie.characters.Helicopter")
        if HelicopterClass and HelicopterClass.getInstance then
            local heli = HelicopterClass.getInstance()
            if heli and heli.activateForPlayer then
                heli:activateForPlayer(player)
                method = "Helicopter.activateForPlayer"
                return
            end
        end

        -- Try via RandomizedWorldBase / MetaEvents
        if RZSUtil and RZSUtil.triggerRandomEvent then
            RZSUtil.triggerRandomEvent("Helicopter", player)
            method = "RZSUtil.triggerRandomEvent"
            return
        end

        -- Try direct addHelicopter if available
        if addHelicopter then
            addHelicopter(player)
            method = "addHelicopter"
            return
        end

        -- ServerCheatInterface fallback
        if ServerCheatInterface and ServerCheatInterface.triggerHelicopter then
            ServerCheatInterface.triggerHelicopter(player)
            method = "ServerCheatInterface"
            return
        end

        error("No helicopter API available in this build")
    end)

    if not ok then
        return false, nil, "Failed to trigger helicopter: " .. tostring(err)
    end

    PanelBridge.info("Helicopter triggered", { username = username, method = method })
    return true, {
        message = "Helicopter event triggered for " .. username,
        username = username,
        method = method
    }
end

-- Get detailed player info
handlers.getPlayerDetails = function(args)
    local username = args.username
    if not username then
        return false, nil, "Username required"
    end
    
    local player = getPlayerByUsername(username)
    if not player then
        return false, nil, "Player not found: " .. username
    end
    
    local ok, playerData = pcall(function()
        local stats = player:getStats()
        local bodyDamage = player:getBodyDamage()
        
        local pd = {
            username = player:getUsername(),
            displayName = player:getDisplayName(),
            x = player:getX(),
            y = player:getY(),
            z = player:getZ(),
            accessLevel = player:getAccessLevel(),
            isAlive = player:isAlive(),
            isAsleep = player:isAsleep(),
            isSneaking = player:isSneaking(),
            isRunning = player:isRunning(),
            stats = {},
            health = {}
        }
        
        -- Get stats if available
        if stats then
            pd.stats = {
                hunger = stats:getHunger(),
                thirst = stats:getThirst(),
                fatigue = stats:getFatigue(),
                stress = stats:getStress(),
                boredom = stats:getBoredom(),
                unhappiness = stats:getUnhappyness(),
                pain = stats:getPain(),
                endurance = stats:getEndurance()
            }
        end
        
        -- Get health if available
        if bodyDamage then
            pd.health = {
                overallBodyHealth = bodyDamage:getOverallBodyHealth(),
                isInfected = bodyDamage:IsInfected(),
                isBleeding = bodyDamage:getIsBleeding(),
                health = bodyDamage:getHealth(),
                temperature = bodyDamage:getTemperature(),
                wetness = bodyDamage:getWetness()
            }
        end
        
        return pd
    end)
    
    if not ok then
        return false, nil, "Error reading player details: " .. tostring(playerData)
    end
    
    return true, playerData
end

-- Get all players with details
handlers.getAllPlayerDetails = function(args)
    local onlinePlayers = getOnlinePlayers()
    local players = {}
    
    if not onlinePlayers then
        return true, { players = {} }
    end
    
    for i = 0, onlinePlayers:size() - 1 do
        local player = onlinePlayers:get(i)
        if player then
            local ok, playerData = pcall(function()
                local stats = player:getStats()
                local bodyDamage = player:getBodyDamage()
                
                local pd = {
                    username = player:getUsername(),
                    displayName = player:getDisplayName(),
                    x = player:getX(),
                    y = player:getY(),
                    z = player:getZ(),
                    accessLevel = player:getAccessLevel(),
                    isAlive = player:isAlive()
                }
                
                if stats then
                    pd.hunger = stats:getHunger()
                    pd.thirst = stats:getThirst()
                    pd.fatigue = stats:getFatigue()
                end
                
                if bodyDamage then
                    pd.health = bodyDamage:getOverallBodyHealth()
                    pd.isInfected = bodyDamage:IsInfected()
                end
                
                return pd
            end)
            
            if ok and playerData then
                table.insert(players, playerData)
            else
                -- Include minimal info so the player isn't silently dropped
                local nameOk, name = pcall(function() return player:getUsername() end)
                table.insert(players, {
                    username = nameOk and name or "unknown",
                    error = tostring(playerData)
                })
            end
        end
    end
    
    return true, { players = players }
end

-- ============================================
-- COMPREHENSIVE PLAYER EXPORT (for backup/restore)
-- ============================================

-- Helper to serialize inventory items
local function serializeInventory(container)
    if not container then return {} end
    
    local items = {}
    local itemList = container:getItems()
    if not itemList then return {} end
    
    for i = 0, itemList:size() - 1 do
        local item = itemList:get(i)
        if item then
            -- Use pcall to safely get item properties (B42 API may differ)
            local ok, itemData = pcall(function()
                local data = {
                    fullType = item:getFullType(),
                    type = item:getType(),
                    name = item:getName(),
                    count = item.getCount and item:getCount() or 1,
                    isFavorite = item.isFavorite and item:isFavorite() or false,
                    isEquipped = item.isEquipped and item:isEquipped() or false
                }
                
                -- Safely get condition
                if item.getCondition then
                    data.condition = item:getCondition()
                end
                
                -- Safely get uses
                if item.getCurrentUses then
                    data.uses = item:getCurrentUses()
                end
                
                -- Handle containers (bags, etc.) - check method exists
                if item.IsInventoryContainer and item:IsInventoryContainer() then
                    local subContainer = item:getItemContainer()
                    if subContainer then
                        data.contents = serializeInventory(subContainer)
                    end
                end
                
                -- Handle drainable items (flashlights, etc.)
                if item.getDelta then
                    data.delta = item:getDelta()
                end
                
                return data
            end)
            
            if ok and itemData then
                table.insert(items, itemData)
            end
        end
    end
    
    return items
end

-- Helper to get all perk levels
local function getPlayerPerks(player)
    local perks = {}
    
    -- Get XP object
    local xp = player:getXp()
    if not xp then return perks end
    
    -- Known perks from PerkFactory
    local perkNames = {
        "Fitness", "Strength",
        "Sprinting", "Lightfoot", "Nimble", "Sneak",
        "Axe", "Blunt", "SmallBlunt", "LongBlade", "ShortBlade", "Spear", "Maintenance",
        "Woodwork", "Cooking", "Farming", "Doctor", "Electricity", "MetalWelding",
        "Mechanics", "Tailoring", "Aiming", "Reloading",
        "Fishing", "Trapping", "PlantScavenging"
    }
    
    for _, perkName in ipairs(perkNames) do
        local perk = Perks[perkName]
        if perk then
            local level = player:getPerkLevel(perk)
            local perkXp = xp:getXP(perk)
            perks[perkName] = {
                level = level,
                xp = perkXp
            }
        end
    end
    
    return perks
end

-- Helper to get player traits
local function getPlayerTraits(player)
    local traits = {}
    
    -- B42: Traits are accessed through SurvivorDesc
    -- B41: Traits were accessed directly via player:getTraits()
    local traitList = nil
    
    -- Try B42 method first (via SurvivorDesc)
    local desc = player:getDescriptor()
    if desc then
        -- B42 uses getTraitList() or getTraits() on SurvivorDesc
        if desc.getTraitList then
            traitList = desc:getTraitList()
        elseif desc.getTraits then
            traitList = desc:getTraits()
        end
    end
    
    -- Fallback to B41 method if available
    if not traitList and player.getTraits then
        traitList = player:getTraits()
    end
    
    if traitList then
        -- Handle both ArrayList and other iterable types
        if traitList.size then
            for i = 0, traitList:size() - 1 do
                local trait = traitList:get(i)
                -- In B42, traits might be objects; get the type/name
                if type(trait) == "string" then
                    table.insert(traits, trait)
                elseif trait and trait.getType then
                    table.insert(traits, trait:getType())
                elseif trait and trait.toString then
                    table.insert(traits, trait:toString())
                else
                    table.insert(traits, tostring(trait))
                end
            end
        end
    end
    
    return traits
end

-- Helper to get known recipes
local function getKnownRecipes(player)
    local recipes = {}
    local recipeList = player:getKnownRecipes()
    
    if recipeList then
        for i = 0, recipeList:size() - 1 do
            table.insert(recipes, recipeList:get(i))
        end
    end
    
    return recipes
end

-- Helper to get worn items
local function getWornItems(player)
    local worn = {}
    local wornItems = player:getWornItems()
    
    if wornItems then
        for i = 0, wornItems:size() - 1 do
            local item = wornItems:get(i)
            if item and item:getItem() then
                table.insert(worn, {
                    location = item:getLocation(),
                    fullType = item:getItem():getFullType(),
                    condition = item:getItem():getCondition()
                })
            end
        end
    end
    
    return worn
end

-- Comprehensive player export for backup/restore
handlers.exportPlayerData = function(args)
    local username = args.username
    if not username then
        return false, nil, "Username required"
    end
    
    local player = getPlayerByUsername(username)
    if not player then
        return false, nil, "Player not found: " .. username
    end
    
    local exportData = {
        version = "1.2",
        exportTime = getTimestampMs(),
        serverName = getServerName(),
        
        -- Basic info
        username = player:getUsername(),
        displayName = player:getDisplayName(),
        
        -- Skills/Perks with XP (this is what we need for restore)
        perks = getPlayerPerks(player),
        
        -- Traits (reference - requires manual restore)
        traits = getPlayerTraits(player),
        
        -- Known recipes
        recipes = getKnownRecipes(player),
        
        -- Worn items (reference - what the player is wearing)
        wornItems = getWornItems(player),
        
        -- Kill stats (for reference, can't easily restore)
        kills = {
            zombies = player:getZombieKills()
        },
        
        -- Main inventory
        inventory = serializeInventory(player:getInventory())
    }
    
    return true, exportData
end

-- Import/restore player data (skills and inventory)
handlers.importPlayerData = function(args)
    local username = args.username
    local data = args.data
    local options = args.options or {}
    
    if not username then
        return false, nil, "Username required"
    end
    if not data then
        return false, nil, "Import data required"
    end
    
    local player = getPlayerByUsername(username)
    if not player then
        return false, nil, "Player not found: " .. username
    end
    
    local restored = {
        perks = 0,
        items = 0
    }
    
    -- Restore perks/skills
    if data.perks and options.restorePerks ~= false then
        local xp = player:getXp()
        for perkName, perkData in pairs(data.perks) do
            local perk = Perks[perkName]
            if perk and perkData.level then
                -- Use pcall for safety
                pcall(function()
                    -- Reset perk to 0 first
                    player:level0(perk)
                    -- Level up to target
                    for lvl = 1, perkData.level do
                        player:LevelPerk(perk)
                    end
                    -- Set XP if available
                    if xp and perkData.xp then
                        xp:setXP(perk, perkData.xp)
                    end
                    restored.perks = restored.perks + 1
                end)
            end
        end
    end
    
    -- Restore inventory items
    if data.inventory and options.restoreInventory ~= false then
        local inventory = player:getInventory()
        if inventory then
            -- Helper function to add items recursively
            local function addItems(container, itemList)
                for _, itemData in ipairs(itemList) do
                    local ok, result = pcall(function()
                        local count = math.min(itemData.count or 1, 100) -- Clamp to prevent server freeze
                        for c = 1, count do
                            local newItem = container:AddItem(itemData.fullType)
                            if newItem then
                                -- Set condition if available
                                if itemData.condition and newItem.setCondition then
                                    newItem:setCondition(itemData.condition)
                                end
                                -- Set uses if available (for drainable items)
                                if itemData.uses and newItem.setCurrentUses then
                                    newItem:setCurrentUses(itemData.uses)
                                end
                                -- Set delta if available
                                if itemData.delta and newItem.setDelta then
                                    newItem:setDelta(itemData.delta)
                                end
                                -- Handle container contents (bags)
                                if itemData.contents and newItem.getItemContainer then
                                    local subContainer = newItem:getItemContainer()
                                    if subContainer then
                                        addItems(subContainer, itemData.contents)
                                    end
                                end
                                restored.items = restored.items + 1
                            end
                        end
                    end)
                    -- Silently skip items that fail to add
                end
            end
            
            addItems(inventory, data.inventory)
        end
    end
    
    return true, {
        message = "Player data imported",
        restored = restored
    }
end

-- Teleport a player
handlers.teleportPlayer = function(args)
    local username = args.username
    local x = tonumber(args.x)
    local y = tonumber(args.y)
    local z = tonumber(args.z) or 0
    
    if not username or not x or not y then
        return false, nil, "Username, x, y required"
    end
    
    local player = getPlayerByUsername(username)
    if not player then
        return false, nil, "Player not found: " .. username
    end
    
    local success, err = pcall(function()
        -- B42: setPosition(float, float, float) is a direct IsoPlayer method
        if player.setPosition then
            player:setPosition(x, y, z)
        else
            -- Fallback: set coordinates individually
            player:setX(x)
            player:setY(y)
            player:setZ(z)
        end
        -- Update last-known position for network consistency
        if player.setLx then
            player:setLx(x)
            player:setLy(y)
            player:setLz(z)
        end
        -- Enable network teleport flag so other clients see the move
        if player.setNetworkTeleportEnabled then
            player:setNetworkTeleportEnabled(true)
        end
    end)
    
    if not success then
        return false, nil, "Failed to teleport player: " .. tostring(err)
    end
    
    return true, { 
        message = "Player teleported",
        newPosition = { x = x, y = y, z = z }
    }
end

-- Get sandbox options (read-only)
handlers.getSandboxOptions = function(args)
    local sandbox = getSandboxOptions()
    if not sandbox then
        return false, nil, "SandboxOptions not available"
    end
    
    -- Get commonly used sandbox settings with safe access
    local options = {}
    local function safeOpt(name, getter)
        local ok, val = pcall(getter)
        if ok then options[name] = val end
    end
    
    safeOpt("zombieCount", function() return sandbox:getZombieCount() end)
    safeOpt("zombieSpeed", function() return sandbox:getZombieSpeed() end)
    safeOpt("dayLength", function() return sandbox:getDayLength() end)
    safeOpt("startMonth", function() return sandbox:getStartMonth() end)
    safeOpt("startDay", function() return sandbox:getStartDay() end)
    safeOpt("waterShutoff", function() return sandbox:getWaterShutoff() end)
    safeOpt("elecShutoff", function() return sandbox:getElecShutoff() end)
    safeOpt("zombieLore", function() return sandbox:getZombieLore() end)
    safeOpt("charactersPerPlayer", function() return sandbox:getCharactersPerPlayer() end)
    safeOpt("sleepAllowed", function() return sandbox:getSleepAllowed() end)
    safeOpt("sleepNeeded", function() return sandbox:getSleepNeeded() end)
    
    return true, { options = options }
end

-- Get ALL sandbox options including mod-added ones, grouped by source
handlers.getAllSandboxOptions = function(args)
    local sandbox = getSandboxOptions()
    if not sandbox then
        return false, nil, "SandboxOptions not available"
    end

    local allOptions = {}
    local totalCount = 0

    -- Helper to extract value from a sandbox option object
    local function getOptionValue(opt)
        local raw = nil
        -- Try getValue first (most common)
        if opt.getValue then
            local ok, val = pcall(function() return opt:getValue() end)
            if ok then raw = val end
        end
        -- Try getIntValue for integer enums
        if raw == nil and opt.getIntValue then
            local ok, val = pcall(function() return opt:getIntValue() end)
            if ok then raw = val end
        end
        -- Try direct value field
        if raw == nil and opt.value ~= nil then raw = opt.value end
        -- Ensure the value is JSON-serializable (not userdata/Java object)
        if raw == nil then return nil end
        local t = type(raw)
        if t == "string" or t == "number" or t == "boolean" then return raw end
        -- Userdata or table — coerce to string for safety
        local ok2, str = pcall(tostring, raw)
        return ok2 and str or nil
    end

    -- Helper to safely coerce a value to string, returning nil if the value is nil
    local function safeStr(fn)
        local ok, val = pcall(fn)
        if ok and val ~= nil then return tostring(val) end
        return nil
    end

    -- Helper to extract option metadata
    local function getOptionInfo(opt)
        local info = {}
        -- Get the option name (e.g., "MyMod.SettingName")
        info.name = safeStr(function() return opt:getName() end)
        -- Get the short name (just "SettingName")
        info.shortName = safeStr(function() return opt:getShortName() end)
        -- Get the table/page name (mod or category grouping)
        info.tableName = safeStr(function() return opt:getTableName() end)
        -- Get the tooltip/translation key
        info.tooltip = safeStr(function() return opt:getTooltip() end)
        -- Get the translated name if available
        info.translatedName = safeStr(function() return opt:getTranslatedName() end)
        -- Get value
        info.value = getOptionValue(opt)
        -- Get type info
        pcall(function()
            if not opt.getClass then return end
            local classObj = opt:getClass()
            if not classObj then return end
            local className = tostring(classObj)
            if className:find("Boolean") then
                info.type = "boolean"
            elseif className:find("Double") or className:find("Integer") or className:find("Numeric") then
                info.type = "number"
            elseif className:find("Enum") then
                info.type = "enum"
                -- Try to get enum values
                pcall(function()
                    if opt.getNumValues and opt.getValueName then
                        local numVals = opt:getNumValues()
                        if numVals and numVals > 0 then
                            info.enumValues = {}
                            local cap = math.min(numVals, 50)
                            for i = 0, cap - 1 do
                                pcall(function()
                                    table.insert(info.enumValues, tostring(opt:getValueName(i)))
                                end)
                            end
                        end
                    end
                end)
                -- Get selected index for enums
                pcall(function()
                    if opt.getIntValue then
                        info.selectedIndex = opt:getIntValue()
                    end
                end)
            elseif className:find("String") then
                info.type = "string"
            else
                info.type = className
            end
        end)
        -- Get min/max for numeric types
        pcall(function()
            if opt.getMin then
                local v = opt:getMin()
                if type(v) == "number" then info.min = v end
            end
        end)
        pcall(function()
            if opt.getMax then
                local v = opt:getMax()
                if type(v) == "number" then info.max = v end
            end
        end)
        -- Get default value
        pcall(function()
            if opt.getDefaultValue then
                local v = opt:getDefaultValue()
                local t = type(v)
                if t == "string" or t == "number" or t == "boolean" then
                    info.default = v
                else
                    local ok2, str = pcall(tostring, v)
                    if ok2 then info.default = str end
                end
            end
        end)
        return info
    end

    -- Method 1: Try getNumOptions + getOptionByIndex (Java ArrayList-style)
    local enumerated = false
    pcall(function()
        local numOptions = sandbox:getNumOptions()
        if numOptions and numOptions > 0 then
            for i = 0, numOptions - 1 do
                pcall(function()
                    local opt = sandbox:getOptionByIndex(i)
                    if opt then
                        local info = getOptionInfo(opt)
                        if info.name then
                            -- Group by table name (mod name or vanilla category)
                            local group = (info.tableName and info.tableName ~= "") and info.tableName or "Vanilla"
                            if not allOptions[group] then
                                allOptions[group] = {}
                            end
                            table.insert(allOptions[group], info)
                            totalCount = totalCount + 1
                        end
                    end
                end)
            end
            enumerated = true
        end
    end)

    -- Method 2: Try iterating the options ArrayList directly
    if not enumerated then
        pcall(function()
            local optionsList = sandbox:getOptions()
            if optionsList then
                local size = optionsList:size()
                for i = 0, size - 1 do
                    pcall(function()
                        local opt = optionsList:get(i)
                        if opt then
                            local info = getOptionInfo(opt)
                            if info.name then
                                local group = (info.tableName and info.tableName ~= "") and info.tableName or "Vanilla"
                                if not allOptions[group] then
                                    allOptions[group] = {}
                                end
                                table.insert(allOptions[group], info)
                                totalCount = totalCount + 1
                            end
                        end
                    end)
                end
                enumerated = true
            end
        end)
    end

    -- Method 3: Try pairs enumeration on the sandbox object itself
    if not enumerated then
        pcall(function()
            for k, v in pairs(sandbox) do
                if type(v) ~= "function" then
                    pcall(function()
                        -- Check if it's a sandbox option object with getName
                        if v and type(v) == "userdata" and v.getName then
                            local info = getOptionInfo(v)
                            if info.name then
                                local group = (info.tableName and info.tableName ~= "") and info.tableName or "Vanilla"
                                if not allOptions[group] then
                                    allOptions[group] = {}
                                end
                                table.insert(allOptions[group], info)
                                totalCount = totalCount + 1
                            end
                        else
                            -- Simple key-value — coerce value for JSON safety
                            local group = "Vanilla"
                            if tostring(k):find("%.") then
                                group = tostring(k):match("^([^%.]+)")
                            end
                            if not allOptions[group] then
                                allOptions[group] = {}
                            end
                            local safeVal = v
                            local vt = type(v)
                            if vt ~= "string" and vt ~= "number" and vt ~= "boolean" and v ~= nil then
                                local ok3, str3 = pcall(tostring, v)
                                safeVal = ok3 and str3 or nil
                            end
                            table.insert(allOptions[group], {
                                name = tostring(k),
                                value = safeVal,
                                type = type(v)
                            })
                            totalCount = totalCount + 1
                        end
                    end)
                end
            end
            if totalCount > 0 then enumerated = true end
        end)
    end

    -- Sort options within each group by name
    for group, opts in pairs(allOptions) do
        table.sort(opts, function(a, b)
            return (a.name or "") < (b.name or "")
        end)
    end

    -- Build group list with counts
    local groups = {}
    for group, opts in pairs(allOptions) do
        table.insert(groups, { name = group, count = #opts })
    end
    table.sort(groups, function(a, b) return a.name < b.name end)

    PanelBridge.info("Sandbox options enumerated", {
        totalOptions = totalCount,
        groups = #groups,
        enumerated = enumerated
    })

    return true, {
        options = allOptions,
        groups = groups,
        totalCount = totalCount,
        enumerated = enumerated
    }
end

-- Set a single sandbox option value
handlers.setSandboxOption = function(args)
    local optName = args and args.name
    local newValue = args and args.value
    if not optName or optName == "" then
        return false, nil, "Missing option name"
    end
    if newValue == nil then
        return false, nil, "Missing value"
    end

    local sandbox = getSandboxOptions()
    if not sandbox then
        return false, nil, "SandboxOptions not available"
    end

    -- Find the option by name
    local targetOpt = nil
    pcall(function()
        local numOptions = sandbox:getNumOptions()
        if numOptions and numOptions > 0 then
            for i = 0, numOptions - 1 do
                local opt = sandbox:getOptionByIndex(i)
                if opt and opt.getName then
                    local name = opt:getName()
                    if name == optName then
                        targetOpt = opt
                        return
                    end
                end
            end
        end
    end)

    -- Fallback: try getOptions():get()
    if not targetOpt then
        pcall(function()
            local optionsList = sandbox:getOptions()
            if optionsList then
                local size = optionsList:size()
                for i = 0, size - 1 do
                    local opt = optionsList:get(i)
                    if opt and opt.getName then
                        local name = opt:getName()
                        if name == optName then
                            targetOpt = opt
                            return
                        end
                    end
                end
            end
        end)
    end

    if not targetOpt then
        return false, nil, "Option not found: " .. tostring(optName)
    end

    -- Determine the option type and apply the value
    local optType = nil
    pcall(function()
        if not targetOpt.getClass then return end
        local className = tostring(targetOpt:getClass())
        if className:find("Boolean") then optType = "boolean"
        elseif className:find("Double") or className:find("Numeric") then optType = "double"
        elseif className:find("Integer") then optType = "integer"
        elseif className:find("Enum") then optType = "enum"
        elseif className:find("String") then optType = "string"
        end
    end)

    local ok, err
    if optType == "boolean" then
        local boolVal = (newValue == true or newValue == "true" or newValue == 1)
        ok, err = pcall(function() targetOpt:setValue(boolVal) end)
    elseif optType == "enum" then
        local intVal = tonumber(newValue)
        if not intVal then return false, nil, "Invalid enum value" end
        intVal = math.floor(intVal)
        -- Bounds-check against getNumValues if available
        pcall(function()
            if targetOpt.getNumValues then
                local numVals = targetOpt:getNumValues()
                if numVals and intVal >= numVals then intVal = numVals - 1 end
                if intVal < 0 then intVal = 0 end
            end
        end)
        ok, err = pcall(function() targetOpt:setValue(intVal) end)
    elseif optType == "integer" then
        local intVal = tonumber(newValue)
        if not intVal then return false, nil, "Invalid integer value" end
        intVal = math.floor(intVal)
        -- Clamp to min/max if the option exposes them
        pcall(function()
            if targetOpt.getMin then
                local mn = targetOpt:getMin()
                if type(mn) == "number" and intVal < mn then intVal = mn end
            end
            if targetOpt.getMax then
                local mx = targetOpt:getMax()
                if type(mx) == "number" and intVal > mx then intVal = mx end
            end
        end)
        ok, err = pcall(function() targetOpt:setValue(intVal) end)
    elseif optType == "double" then
        local numVal = tonumber(newValue)
        if not numVal then return false, nil, "Invalid numeric value" end
        -- Clamp to min/max
        pcall(function()
            if targetOpt.getMin then
                local mn = targetOpt:getMin()
                if type(mn) == "number" and numVal < mn then numVal = mn end
            end
            if targetOpt.getMax then
                local mx = targetOpt:getMax()
                if type(mx) == "number" and numVal > mx then numVal = mx end
            end
        end)
        ok, err = pcall(function() targetOpt:setValue(numVal) end)
    elseif optType == "string" then
        ok, err = pcall(function() targetOpt:setValue(tostring(newValue)) end)
    else
        -- Unknown type — try generic setValue with the raw value
        ok, err = pcall(function() targetOpt:setValue(newValue) end)
    end

    if not ok then
        return false, nil, "Failed to set value: " .. tostring(err)
    end

    -- Read back the value to confirm
    local confirmed = nil
    pcall(function()
        if targetOpt.getValue then
            confirmed = targetOpt:getValue()
            local t = type(confirmed)
            if t ~= "string" and t ~= "number" and t ~= "boolean" then
                local ok2, str = pcall(tostring, confirmed)
                confirmed = ok2 and str or nil
            end
        end
    end)

    PanelBridge.info("Sandbox option set", { name = optName, value = tostring(newValue), confirmed = tostring(confirmed) })

    return true, {
        name = optName,
        value = confirmed,
        type = optType
    }
end

-- ============================================
-- CHAT SYSTEM HANDLERS
-- ============================================

-- Helper: resolve a Java class from either a Lua global or the full package path
local function resolveJavaClass(globalName, fullPath)
    -- Try direct global access (through metatable — Kahlua exposes Java classes this way)
    local ok1, g = pcall(function() return _G[globalName] end)
    if ok1 and g then return g end
    -- Walk the full Java package path (e.g. zombie.network.chat.ChatServer)
    -- pcall each step to avoid Java null indexing errors
    local parts = {}
    for part in fullPath:gmatch("[^%.]+") do parts[#parts + 1] = part end
    local cur
    local ok
    ok, cur = pcall(function() return _G[parts[1]] end)
    if not ok or not cur then return nil end
    for i = 2, #parts do
        local parent = cur
        ok, cur = pcall(function() return parent[parts[i]] end)
        if not ok or not cur then return nil end
    end
    return cur
end

-- Helper: get chat system components
-- ChatServer (zombie.network.chat.ChatServer) = SERVER-SIDE, works on both B41 and B42 dedicated servers
-- ChatManager (zombie.chat.ChatManager) = CLIENT-SIDE, only works on client (not on dedicated server)
local function getChatSystem()
    local result = {}
    -- ChatServer: server-side component — available on dedicated servers in both B41 and B42
    local ChatServerClass = resolveJavaClass("ChatServer", "zombie.network.chat.ChatServer")
    if ChatServerClass then
        local ok, inst = pcall(function() return ChatServerClass.getInstance() end)
        if ok and inst then
            result.server = inst
        end
    end
    -- ChatManager: client-side component — may NOT work on dedicated server
    local ChatManagerClass = resolveJavaClass("ChatManager", "zombie.chat.ChatManager")
    if ChatManagerClass then
        local ok, inst = pcall(function() return ChatManagerClass.getInstance() end)
        if ok and inst then
            result.manager = inst
        end
    end
    if result.server or result.manager then return result end
    return nil
end

-- Helper: resolve ChatType enum value safely
local function getChatType(typeName)
    local ChatTypeClass = resolveJavaClass("ChatType", "zombie.chat.ChatType")
    if not ChatTypeClass then return nil end
    local ok, val = pcall(function() return ChatTypeClass[typeName] end)
    if ok and val then return val end
    return nil
end

-- Send message to server chat (appears to all players)
handlers.sendToServerChat = function(args)
    local message = normalizeMessage(args.message, 1000)
    local isAlert = args.alert or args.isAlert or false

    if not message then
        return false, nil, "Message required"
    end

    local chat = getChatSystem()
    local debugInfo = {}

    -- ChatServer: server-side, works on both B41 and B42 dedicated servers
    if chat and chat.server then
        local ok, err = pcall(function()
            if isAlert then
                chat.server:sendServerAlertMessageToServerChat(message)
            else
                chat.server:sendMessageToServerChat(message)
            end
        end)
        if ok then
            return true, { message = "Message sent to server chat", isAlert = isAlert, method = "ChatServer" }
        end
        debugInfo[#debugInfo + 1] = "ChatServer.send failed: " .. tostring(err)
    else
        debugInfo[#debugInfo + 1] = "ChatServer: " .. (chat and "getInstance returned nil" or "class not found")
    end

    -- ChatManager fallback (client-side, unlikely to work on dedicated server)
    if chat and chat.manager then
        local ok, err = pcall(function()
            chat.manager:showServerChatMessage(message)
        end)
        if ok then
            return true, { message = "Message sent to server chat", isAlert = isAlert, method = "ChatManager" }
        end
        debugInfo[#debugInfo + 1] = "ChatManager.show failed: " .. tostring(err)
    end

    -- Fallback: Say to each player (shows as overhead text only, not in chat window)
    local ok3, sent3 = pcall(function()
        local players = getOnlinePlayers()
        if players and players:size() > 0 then
            for i = 0, players:size() - 1 do
                local p = players:get(i)
                if p then p:Say(message) end
            end
            return true
        end
        return false
    end)
    if ok3 and sent3 then
        return true, { message = "Message sent via player:Say (overhead text only)", isAlert = isAlert, method = "player:Say" }
    end
    debugInfo[#debugInfo + 1] = ok3 and "player:Say fallback: no players online" or ("player:Say fallback failed: " .. tostring(sent3))

    return false, nil, "Chat system not available: " .. table.concat(debugInfo, "; ")
end

-- Send message to admin chat (only admins see it)
handlers.sendToAdminChat = function(args)
    local message = normalizeMessage(args.message, 1000)

    if not message then
        return false, nil, "Message required"
    end

    local chat = getChatSystem()

    -- ChatServer: server-side, works on both B41 and B42 dedicated servers
    if chat and chat.server then
        local ok, err = pcall(function()
            chat.server:sendMessageToAdminChat(message)
        end)
        if ok then
            return true, { message = "Message sent to admin chat", method = "ChatServer" }
        end
    end

    -- ChatManager fallback (client-side, unlikely to work on dedicated server)
    if chat and chat.manager then
        local adminType = getChatType("admin")
        if adminType then
            local ok, err = pcall(function()
                chat.manager:sendMessageToChat(adminType, message)
            end)
            if ok then
                return true, { message = "Message sent to admin chat", method = "ChatManager" }
            end
        end
    end

    -- Fallback: Say to each player with [ADMIN] prefix (overhead text only)
    local ok3, sent3 = pcall(function()
        local players = getOnlinePlayers()
        if players and players:size() > 0 then
            for i = 0, players:size() - 1 do
                local p = players:get(i)
                if p and p.accessLevel and p:getAccessLevel() ~= "" then
                    p:Say("[ADMIN] " .. message)
                end
            end
            return true
        end
        return false
    end)
    if ok3 and sent3 then
        return true, { message = "Message sent via player:Say (admin, overhead text only)", method = "player:Say" }
    end

    return false, nil, "Admin chat not available"
end

-- Send message to general chat (with custom author name)
handlers.sendToGeneralChat = function(args)
    local message = normalizeMessage(args.message, 1000)
    local author = normalizeMessage(args.author, 80) or "[Panel]"

    if not message then
        return false, nil, "Message required"
    end

    local chat = getChatSystem()

    -- ChatServer: server-side, works on both B41 and B42 dedicated servers
    if chat and chat.server then
        local ok, err = pcall(function()
            chat.server:sendMessageFromDiscordToGeneralChat(author, message)
        end)
        if ok then
            return true, { message = "Message sent to general chat", author = author, method = "ChatServer" }
        end
    end

    -- ChatManager fallback (client-side, unlikely to work on dedicated server)
    if chat and chat.manager then
        local generalType = getChatType("general")
        if generalType then
            local ok, err = pcall(function()
                chat.manager:sendMessageToChat(author, generalType, message)
            end)
            if ok then
                return true, { message = "Message sent to general chat", author = author, method = "ChatManager" }
            end
        end

        local ok2, err2 = pcall(function()
            chat.manager:addMessage(author, message)
        end)
        if ok2 then
            return true, { message = "Message sent to general chat", author = author, method = "ChatManager.addMessage" }
        end
    end

    -- Fallback: Say to each player with author prefix (overhead text only)
    local ok3, sent3 = pcall(function()
        local players = getOnlinePlayers()
        if players and players:size() > 0 then
            for i = 0, players:size() - 1 do
                local p = players:get(i)
                if p then p:Say("[" .. author .. "] " .. message) end
            end
            return true
        end
        return false
    end)
    if ok3 and sent3 then
        return true, { message = "Message sent via player:Say (overhead text only)", author = author, method = "player:Say" }
    end

    return false, nil, "General chat not available"
end

-- Get available chat types info
handlers.getChatInfo = function(args)
    local chat = getChatSystem()
    local info = {
        availableChats = {
            "serverChat - Messages from server to all players",
            "adminChat - Messages visible only to admins",
            "generalChat - General chat with custom author name"
        },
        note = "Use sendToServerChat, sendToAdminChat, or sendToGeneralChat handlers",
        chatServerAvailable = chat ~= nil and chat.server ~= nil,
        chatManagerAvailable = chat ~= nil and chat.manager ~= nil
    }

    return true, info
end

-- Force save the world
handlers.saveWorld = function(args)
    -- Try to trigger server save
    local world = getWorld()
    if world and world.saveWorld then
        local success, err = pcall(function()
            world:saveWorld()
        end)
        if success then
            return true, { message = "World save triggered" }
        else
            return false, nil, "World save failed: " .. tostring(err)
        end
    end
    
    return false, nil, "Cannot trigger world save from Lua"
end

-- ============================================
-- INFRASTRUCTURE (POWER/WATER) HANDLERS
-- ============================================

-- Get current power and water status
handlers.getUtilitiesStatus = function(args)
    local world = getWorld()
    if not world then
        return false, nil, "World not available"
    end
    
    local hydroPowerOn = false
    local success, err = pcall(function()
        hydroPowerOn = world:isHydroPowerOn()
    end)
    
    if not success then
        return false, nil, "Failed to get utilities status: " .. tostring(err)
    end
    
    -- Also get sandbox shutdown times
    local sandbox = getSandboxOptions()
    local elecShut = "unknown"
    local waterShut = "unknown"
    local elecModifier = 0
    local waterModifier = 0
    
    -- Check actual shutdown state from GameTime modData
    local currentHour = 0
    local elecShutStart = nil
    local waterShutStart = nil
    local powerActuallyOn = hydroPowerOn
    local waterActuallyOn = hydroPowerOn
    
    pcall(function()
        if sandbox then
            -- Use getOptionByName for B42 compatibility
            local elecOpt = sandbox:getOptionByName("ElecShut")
            local waterOpt = sandbox:getOptionByName("WaterShut")
            if elecOpt and elecOpt.getValue then
                elecShut = tostring(elecOpt:getValue())
            end
            if waterOpt and waterOpt.getValue then
                waterShut = tostring(waterOpt:getValue())
            end
            -- These are direct methods that exist
            elecModifier = sandbox:getElecShutModifier()
            waterModifier = sandbox:getWaterShutModifier()
        end
        
        -- Check the actual shutdown timers
        local gameTime = GameTime.getInstance()
        if gameTime then
            currentHour = gameTime:getWorldAgeHours()
            local modData = gameTime:getModData()
            if modData then
                elecShutStart = modData.ElecShutStart
                waterShutStart = modData.WaterShutStart
                
                -- Power is on if: hydroPowerOn is true AND (no shutdown time set OR shutdown time is in the future OR set to -1 for permanent)
                if elecShutStart then
                    if elecShutStart == -1 then
                        powerActuallyOn = hydroPowerOn -- -1 means never shut off
                    elseif elecShutStart > 0 and currentHour >= elecShutStart then
                        powerActuallyOn = false -- Past the shutdown time
                    end
                end
                
                if waterShutStart then
                    if waterShutStart == -1 then
                        waterActuallyOn = hydroPowerOn
                    elseif waterShutStart > 0 and currentHour >= waterShutStart then
                        waterActuallyOn = false
                    end
                end
            end
        end
    end)
    
    return true, {
        hydroPowerOn = hydroPowerOn,
        powerOn = powerActuallyOn,
        waterOn = waterActuallyOn,
        currentWorldHour = currentHour,
        elecShutStart = elecShutStart,
        waterShutStart = waterShutStart,
        elecShut = elecShut,
        waterShut = waterShut,
        elecShutModifier = elecModifier,
        waterShutModifier = waterModifier
    }
end

-- Helper function to activate light switches in loaded chunks around all players
local function activateLightSwitchesInLoadedChunks()
    local cell = getCell()
    if not cell then
        return 0, "No cell available"
    end
    
    local activatedCount = 0
    
    -- Get all online players to find loaded areas
    local players = getOnlinePlayers()
    if not players or players:size() == 0 then
        return 0, "No players online"
    end
    
    -- Process light switches around each player
    for p = 0, players:size() - 1 do
        local player = players:get(p)
        if player then
            local px, py = math.floor(player:getX()), math.floor(player:getY())
            
            -- Scan loaded area around each player (reduced radius for performance)
            -- 30-square radius * 4 floors = ~14k squares/player vs ~82k before
            for x = px - 30, px + 30 do
                for y = py - 30, py + 30 do
                    for z = 0, 3 do  -- Ground to 3rd floor (covers most buildings)
                        local sq = cell:getGridSquare(x, y, z)
                        if sq then
                            local objects = sq:getObjects()
                            if objects then
                                for i = 0, objects:size() - 1 do
                                    local obj = objects:get(i)
                                    -- Check if this is a light switch using instanceof
                                    if obj and instanceof(obj, "IsoLightSwitch") then
                                        -- Activate the light switch using toggle method
                                        -- IsoLightSwitch has toggle() and setActive() methods
                                        local success, toggleErr = pcall(function()
                                            if obj.toggle then
                                                -- Only toggle if currently off
                                                if not obj:isActivated() then
                                                    obj:toggle()
                                                    activatedCount = activatedCount + 1
                                                end
                                            elseif obj.setActive then
                                                obj:setActive(true)
                                                activatedCount = activatedCount + 1
                                            end
                                        end)
                                        -- Ignore individual toggle errors, continue with other switches
                                    end
                                end
                            end
                        end
                    end
                end
            end
        end
    end
    
    return activatedCount, "success"
end

-- Deactivate light switches near online players (used when shutting off power)
local function deactivateLightSwitchesInLoadedChunks()
    local cell = getCell()
    if not cell then
        return 0, "No cell available"
    end

    local deactivatedCount = 0

    local players = getOnlinePlayers()
    if not players or players:size() == 0 then
        return 0, "No players online"
    end

    for p = 0, players:size() - 1 do
        local player = players:get(p)
        if player then
            local px, py = math.floor(player:getX()), math.floor(player:getY())

            for x = px - 30, px + 30 do
                for y = py - 30, py + 30 do
                    for z = 0, 3 do
                        local sq = cell:getGridSquare(x, y, z)
                        if sq then
                            -- Use switchLight(false) on the square itself to cut lighting
                            if sq.switchLight then
                                pcall(function() sq:switchLight(false) end)
                            end

                            local objects = sq:getObjects()
                            if objects then
                                for i = 0, objects:size() - 1 do
                                    local obj = objects:get(i)
                                    if obj and instanceof(obj, "IsoLightSwitch") then
                                        local success, err = pcall(function()
                                            if obj:isActivated() then
                                                if obj.toggle then
                                                    obj:toggle()
                                                elseif obj.setActive then
                                                    obj:setActive(false)
                                                end
                                                deactivatedCount = deactivatedCount + 1
                                            end
                                        end)
                                    end
                                end
                            end
                        end
                    end
                end
            end
        end
    end

    return deactivatedCount, "success"
end

-- Restore power and water (turn hydro power on and reset shutdown timers)
handlers.restoreUtilities = function(args)
    local world = getWorld()
    if not world then
        return false, nil, "World not available"
    end
    
    local restorePower = args.power ~= false -- default true
    local restoreWater = args.water ~= false -- default true
    
    local debugInfo = {}
    
    local success, err = pcall(function()
        -- Get current day using getNightsSurvived() (same as RicksMLC_PowerGrid uses)
        local gameTime = GameTime.getInstance()
        local nightsSurvived = 0
        if gameTime then
            nightsSurvived = gameTime:getNightsSurvived()
        end
        table.insert(debugInfo, "nightsSurvived=" .. tostring(nightsSurvived))
        
        -- Calculate restore days - set to far future (same pattern as RicksMLC_PowerGrid)
        -- The game checks: power is ON when NightsSurvived < ElecShutModifier
        local restoreDays = nightsSurvived + 99999
        table.insert(debugInfo, "restoreDays=" .. tostring(restoreDays))
        
        if restorePower then
            -- APPROACH: Try multiple methods to restore power
            
            -- Step 1: Set the global hydro power flag ON
            world:setHydroPowerOn(true)
            table.insert(debugInfo, "setHydroPowerOn(true) called")
            
            -- Step 2: Set sandbox options via Java API
            local sandboxOptions = getSandboxOptions()
            if sandboxOptions then
                local elecOption = sandboxOptions:getOptionByName("ElecShutModifier")
                if elecOption and elecOption.setValue then
                    elecOption:setValue(restoreDays)
                    table.insert(debugInfo, "elecOption:setValue(" .. tostring(restoreDays) .. ")")
                end
            end
            
            -- Step 3: Set Lua SandboxVars table
            SandboxVars.ElecShutModifier = restoreDays
            table.insert(debugInfo, "Set SandboxVars.ElecShutModifier = " .. tostring(restoreDays))
            
            -- Step 4: Try to use GameServer.sendWorldState if available
            local gs = GameServer
            if gs then
                -- Try various GameServer methods
                if gs.sendWorldState then
                    pcall(function() gs.sendWorldState() end)
                    table.insert(debugInfo, "GameServer.sendWorldState called")
                end
                
                -- Try syncSandboxOptions
                if gs.syncSandboxOptions then
                    pcall(function() gs.syncSandboxOptions() end)
                    table.insert(debugInfo, "GameServer.syncSandboxOptions called")
                end
                
                -- Try sendSandboxOptionsToClient for each player
                if gs.sendSandboxOptionsToClient then
                    local players = getOnlinePlayers()
                    if players then
                        for i = 0, players:size() - 1 do
                            local player = players:get(i)
                            if player then
                                pcall(function()
                                    gs.sendSandboxOptionsToClient(player:getOnlineID())
                                end)
                            end
                        end
                        table.insert(debugInfo, "sendSandboxOptionsToClient called for all players")
                    end
                end
            end
            
            -- Step 5: Try ServerOptions if available (for syncing to clients)
            if ServerOptions and ServerOptions.instance then
                local serverOpts = ServerOptions.instance
                if serverOpts.sync then
                    pcall(function() serverOpts:sync() end)
                    table.insert(debugInfo, "ServerOptions sync called")
                end
            end
            
            -- Step 6: Activate light switches in loaded chunks
            local switchesActivated, statusMsg = activateLightSwitchesInLoadedChunks()
            table.insert(debugInfo, "Light switches activated: " .. tostring(switchesActivated))
            
            -- Step 7: Trigger the power on event
            if triggerEvent then
                pcall(function() triggerEvent("OnHydroPowerOn") end)
                table.insert(debugInfo, "Triggered OnHydroPowerOn event")
            end
            
            -- Step 8: Verify Java API value
            local sandboxOptions2 = getSandboxOptions()
            if sandboxOptions2 then
                local elecOption2 = sandboxOptions2:getOptionByName("ElecShutModifier")
                if elecOption2 and elecOption2.getValue then
                    local javaValue = elecOption2:getValue()
                    table.insert(debugInfo, "Java ElecShutModifier getValue: " .. tostring(javaValue))
                end
            end
            
            -- Step 9: Try transmitWeather to sync world state
            if world.transmitWeather then
                pcall(function() world:transmitWeather() end)
                table.insert(debugInfo, "transmitWeather called")
            end
            
            -- Step 10: Try to use the server's built-in sandbox sync
            -- In B42, need to find the right method
            pcall(function()
                -- Try to force a world state update
                if world.setHydroPowerOn then
                    -- Turn it OFF then ON again to trigger any listeners
                    world:setHydroPowerOn(false)
                    world:setHydroPowerOn(true)
                    table.insert(debugInfo, "Toggled hydro power to trigger update")
                end
            end)
            
            -- Step 11: Use IsoWorld's triggerNPCEvent if available
            pcall(function()
                if world.triggerNPCEvent then
                    world:triggerNPCEvent("HydroPowerChanged")
                    table.insert(debugInfo, "triggerNPCEvent called")
                end
            end)
            
            -- Step 12: Try all GameServer static methods we can find
            pcall(function()
                if GameServer then
                    local methods = {}
                    for k, v in pairs(GameServer) do
                        if type(v) == "function" and (k:lower():find("sync") or k:lower():find("sandbox") or k:lower():find("send")) then
                            table.insert(methods, k)
                        end
                    end
                    if #methods > 0 then
                        table.insert(debugInfo, "GameServer sync methods found: " .. table.concat(methods, ", "))
                    end
                end
            end)
            
            -- Step 13: Send command to all clients to refresh their power state
            local players = getOnlinePlayers()
            if players then
                for i = 0, players:size() - 1 do
                    local player = players:get(i)
                    if player then
                        if sendServerCommand then
                            sendServerCommand(player, "PanelBridge", "refreshPowerState", {powerOn = true, elecShutModifier = restoreDays})
                            -- Also send a visible message so players know to reconnect if power doesn't work
                            sendServerCommand(player, "chat", "addMessage", {
                                message = "[Server] Power has been restored. If lights don't work, reconnect to the server.",
                                type = "server"
                            })
                        end
                    end
                end
                table.insert(debugInfo, "Sent refreshPowerState to " .. tostring(players:size()) .. " players")
            end
            
            -- Step 14: Skip save() - it requires a ByteBuffer argument that can't be provided from Lua
            -- Instead, rely on applySettings which syncs the options without file I/O
            pcall(function()
                if getSandboxOptions() and getSandboxOptions().applySettings then
                    getSandboxOptions():applySettings()
                    table.insert(debugInfo, "SandboxOptions applySettings() called")
                end
            end)
            
            -- Step 15: Try sending reloadoptions command (this is what the admin panel uses)
            pcall(function()
                if executeCommand then
                    executeCommand("/reloadoptions")
                    table.insert(debugInfo, "executeCommand /reloadoptions called")
                end
            end)
            
            -- Step 16: Try ServerAPI if available
            pcall(function()
                if ServerAPI and ServerAPI.ReloadOptions then
                    ServerAPI.ReloadOptions()
                    table.insert(debugInfo, "ServerAPI.ReloadOptions called")
                end
            end)
        end
        
        if restoreWater then
            -- Same pattern for water - set WaterShutModifier to far future
            SandboxVars.WaterShutModifier = restoreDays
            table.insert(debugInfo, "Set SandboxVars.WaterShutModifier = " .. tostring(restoreDays))
            
            -- Set Java-side option (mirrors power restore pattern)
            local sandboxOptions = getSandboxOptions()
            if sandboxOptions then
                local waterOption = sandboxOptions:getOptionByName("WaterShutModifier")
                if waterOption and waterOption.setValue then
                    waterOption:setValue(restoreDays)
                    table.insert(debugInfo, "waterOption:setValue(" .. tostring(restoreDays) .. ")")
                end
            end
            
            -- Apply settings to sync water state
            pcall(function()
                if getSandboxOptions() and getSandboxOptions().applySettings then
                    getSandboxOptions():applySettings()
                    table.insert(debugInfo, "Water: SandboxOptions applySettings() called")
                end
            end)
        end
        
        -- Final verification
        local isPowerOn = world:isHydroPowerOn()
        table.insert(debugInfo, "After restore: isHydroPowerOn = " .. tostring(isPowerOn))
        table.insert(debugInfo, "nightsSurvived < ElecShutModifier = " .. tostring(nightsSurvived < restoreDays))
    end)
    
    if not success then
        return false, nil, "Failed to restore utilities: " .. tostring(err)
    end
    
    -- Log debug info
    print("[PanelBridge] restoreUtilities debug: " .. table.concat(debugInfo, " | "))
    
    return true, { 
        message = "Utilities restored",
        power = restorePower,
        water = restoreWater,
        hydroPowerOn = true,
        debug = debugInfo
    }
end

-- Shut off power and water
handlers.shutOffUtilities = function(args)
    local world = getWorld()
    if not world then
        return false, nil, "World not available"
    end
    
    local shutPower = args.power ~= false -- default true
    local shutWater = args.water ~= false -- default true
    
    local debugInfo = {}
    
    local success, err = pcall(function()
        -- Get current NightsSurvived (same pattern as RicksMLC_PowerGrid)
        local gameTime = GameTime.getInstance()
        local nightsSurvived = 0
        if gameTime then
            nightsSurvived = gameTime:getNightsSurvived()
        end
        table.insert(debugInfo, "nightsSurvived=" .. tostring(nightsSurvived))
        
        if shutPower then
            -- Step 1: Turn off hydro power (same as BWOEvents.SetHydroPower)
            world:setHydroPowerOn(false)
            table.insert(debugInfo, "setHydroPowerOn(false) called")
            
            -- Step 2: Set ElecShutModifier to a PAST value (0 = instant shutoff)
            -- The game checks: power is ON when NightsSurvived < ElecShutModifier
            -- By setting ElecShutModifier to 0, and NightsSurvived >= 0, power stays OFF
            SandboxVars.ElecShutModifier = 0
            table.insert(debugInfo, "Set SandboxVars.ElecShutModifier = 0")
            
            -- Step 3: Set sandbox options via Java API (like restoreUtilities)
            local sandboxOptions = getSandboxOptions()
            if sandboxOptions then
                local elecOption = sandboxOptions:getOptionByName("ElecShutModifier")
                if elecOption and elecOption.setValue then
                    elecOption:setValue(0)
                    table.insert(debugInfo, "elecOption:setValue(0)")
                end
            end
            
            -- Step 4: Try to use GameServer.sendWorldState if available
            local gs = GameServer
            if gs then
                if gs.sendWorldState then
                    pcall(function() gs.sendWorldState() end)
                    table.insert(debugInfo, "GameServer.sendWorldState called")
                end
                
                if gs.syncSandboxOptions then
                    pcall(function() gs.syncSandboxOptions() end)
                    table.insert(debugInfo, "GameServer.syncSandboxOptions called")
                end
                
                if gs.sendSandboxOptionsToClient then
                    local players = getOnlinePlayers()
                    if players then
                        for i = 0, players:size() - 1 do
                            local player = players:get(i)
                            if player then
                                pcall(function() gs.sendSandboxOptionsToClient(player:getOnlineID()) end)
                            end
                        end
                        table.insert(debugInfo, "sendSandboxOptionsToClient called for all players")
                    end
                end
            end
            
            -- Step 5: Deactivate light switches in loaded chunks near players
            local switchesDeactivated, switchStatusMsg = deactivateLightSwitchesInLoadedChunks()
            table.insert(debugInfo, "Light switches deactivated: " .. tostring(switchesDeactivated))
            
            -- Step 6: Transmit weather to sync world state
            if world.transmitWeather then
                pcall(function() world:transmitWeather() end)
                table.insert(debugInfo, "transmitWeather called")
            end
            
            -- Step 7: Apply settings
            pcall(function()
                if getSandboxOptions() and getSandboxOptions().applySettings then
                    getSandboxOptions():applySettings()
                    table.insert(debugInfo, "SandboxOptions applySettings() called")
                end
            end)
            
            -- Step 8: Notify players
            local players = getOnlinePlayers()
            if players then
                for i = 0, players:size() - 1 do
                    local player = players:get(i)
                    if player then
                        if sendServerCommand then
                            sendServerCommand(player, "PanelBridge", "refreshPowerState", {powerOn = false, elecShutModifier = 0})
                            -- Also send a visible message
                            sendServerCommand(player, "chat", "addMessage", {
                                message = "[Server] Power has been shut off.",
                                type = "server"
                            })
                        end
                    end
                end
            end
        end
        
        if shutWater then
            -- Same pattern for water
            SandboxVars.WaterShutModifier = 0
            table.insert(debugInfo, "Set SandboxVars.WaterShutModifier = 0")
            
            -- Sync Java options for water too
            local sandboxOptions = getSandboxOptions()
            if sandboxOptions then
                local waterOption = sandboxOptions:getOptionByName("WaterShutModifier")
                if waterOption and waterOption.setValue then
                    waterOption:setValue(0)
                    table.insert(debugInfo, "waterOption:setValue(0)")
                end
            end
            
            -- Apply settings to sync water state (matches restoreUtilities pattern)
            pcall(function()
                if getSandboxOptions() and getSandboxOptions().applySettings then
                    getSandboxOptions():applySettings()
                    table.insert(debugInfo, "Water: SandboxOptions applySettings() called")
                end
            end)
        end
        
        -- Final verification
        local isPowerOn = world:isHydroPowerOn()
        table.insert(debugInfo, "After shutoff: isHydroPowerOn = " .. tostring(isPowerOn))
    end)
    
    if not success then
        return false, nil, "Failed to shut off utilities: " .. tostring(err)
    end
    
    -- Log debug info
    print("[PanelBridge] shutOffUtilities debug: " .. table.concat(debugInfo, " | "))
    
    return true, { 
        message = "Utilities shut off",
        power = shutPower,
        water = shutWater,
        hydroPowerOn = false,
        debug = debugInfo
    }
end

-- ============================================
-- PLAYER MANAGEMENT HANDLERS
-- ============================================

-- Heal a player fully
handlers.healPlayer = function(args)
    local username = args.username
    if not username then
        return false, nil, "Username required"
    end
    
    local player = getPlayerByUsername(username)
    if not player then
        return false, nil, "Player not found: " .. username
    end
    
    local healed = {}
    
    -- Heal body damage
    local bodyDamage = player:getBodyDamage()
    if bodyDamage then
        pcall(function()
            -- Clear Knox virus (zombie) infection at body level
            if bodyDamage.setInfected then
                bodyDamage:setInfected(false)
            end
            if bodyDamage.setInfectedWound then
                bodyDamage:setInfectedWound(false)
            end
            -- Restore individual body parts
            for i = 0, bodyDamage:getNumOfBodyParts() - 1 do
                local part = bodyDamage:getBodyPart(i)
                if part then
                    part:SetBitten(false)
                    part:SetBleeding(false)
                    part:SetScratched(false, false)
                    part:SetDeepWounded(false)
                    part:SetInfected(false)
                    part:SetHealth(100)
                end
            end
            bodyDamage:RestoreToFullHealth()
            healed.bodyDamage = true
        end)
    end
    
    -- Restore stats
    local stats = player:getStats()
    if stats then
        pcall(function()
            stats:setHunger(0)
            stats:setThirst(0)
            stats:setFatigue(0)
            stats:setStress(0)
            stats:setBoredom(0)
            stats:setUnhappyness(0)
            stats:setPain(0)
            stats:setEndurance(1)
            healed.stats = true
        end)
    end
    
    -- Clear moodles/effects if possible
    pcall(function()
        local moodles = player:getMoodles()
        if moodles then
            moodles:reset()
            healed.moodles = true
        end
    end)
    
    PanelBridge.info("Healed player", { username = username, healed = healed })
    return true, { message = "Player healed", username = username, healed = healed }
end

-- Kill a player
handlers.killPlayer = function(args)
    local username = args.username
    if not username then
        return false, nil, "Username required"
    end
    
    local player = getPlayerByUsername(username)
    if not player then
        return false, nil, "Player not found: " .. username
    end
    
    local success, err = pcall(function()
        player:setHealth(0)
    end)
    
    if not success then
        return false, nil, "Failed to kill player: " .. tostring(err)
    end
    
    PanelBridge.info("Killed player", { username = username })
    return true, { message = "Player killed", username = username }
end

-- Set player's godmode
handlers.setGodMode = function(args)
    local username = args.username
    local enabled = args.enabled == true
    
    if not username then
        return false, nil, "Username required"
    end
    
    local player = getPlayerByUsername(username)
    if not player then
        return false, nil, "Player not found: " .. username
    end
    
    local success, err = pcall(function()
        player:setGodMod(enabled)
    end)
    
    if not success then
        return false, nil, "Failed to set godmode: " .. tostring(err)
    end
    
    PanelBridge.info("Set godmode", { username = username, enabled = enabled })
    return true, { message = "Godmode " .. (enabled and "enabled" or "disabled"), username = username }
end

-- Set player's invisibility
handlers.setInvisible = function(args)
    local username = args.username
    local enabled = args.enabled == true
    
    if not username then
        return false, nil, "Username required"
    end
    
    local player = getPlayerByUsername(username)
    if not player then
        return false, nil, "Player not found: " .. username
    end
    
    local success, err = pcall(function()
        player:setInvisible(enabled)
    end)
    
    if not success then
        return false, nil, "Failed to set invisible: " .. tostring(err)
    end
    
    PanelBridge.info("Set invisible", { username = username, enabled = enabled })
    return true, { message = "Invisibility " .. (enabled and "enabled" or "disabled"), username = username }
end

-- Give item to player
handlers.giveItem = function(args)
    local username = args.username
    local itemType = args.itemType
    local count = math.min(math.max(tonumber(args.count) or 1, 1), 100) -- Clamp 1-100 per call
    
    if not username then
        return false, nil, "Username required"
    end
    if not itemType then
        return false, nil, "Item type required (e.g., 'Base.Axe')"
    end
    
    local player = getPlayerByUsername(username)
    if not player then
        return false, nil, "Player not found: " .. username
    end
    
    local inventory = player:getInventory()
    if not inventory then
        return false, nil, "Could not access player inventory"
    end
    
    local added = 0
    for i = 1, count do
        local ok, item = pcall(function()
            return inventory:AddItem(itemType)
        end)
        if ok and item then
            added = added + 1
        end
    end
    
    if added == 0 then
        return false, nil, "Failed to add item. Check item type: " .. itemType
    end
    
    PanelBridge.info("Gave items", { username = username, itemType = itemType, count = added })
    return true, { 
        message = "Gave " .. added .. "x " .. itemType,
        username = username,
        itemType = itemType,
        count = added
    }
end

-- ============================================
-- AIRDROP HANDLER
-- ============================================

-- Airdrop preset item lists
local AIRDROP_PRESETS = {
    military = {
        "Base.AssaultRifle2", "Base.Pistol3", "Base.556Bullets", "Base.9mmClip",
        "Base.Bullets9mmBox", "Base.556Box", "Base.HolsterSimple",
        "Base.Helmet_Army", "Base.Vest_BulletArmy", "Base.MilitaryBoots",
        "Base.WalkieTalkie5", "Base.KnifeHunting"
    },
    medical = {
        "Base.Bandage", "Base.Bandage", "Base.Bandage", "Base.AlcoholBandage",
        "Base.AlcoholBandage", "Base.SutureNeedle", "Base.Antibiotics",
        "Base.Disinfectant", "Base.Pills", "Base.PillsVitamins",
        "Base.FirstAidKit", "Base.Tweezers"
    },
    food = {
        "Base.CannedBeans", "Base.CannedBeans", "Base.CannedChili",
        "Base.CannedCorn", "Base.CannedTomato2", "Base.TunaTin",
        "Base.WaterBottleFull", "Base.WaterBottleFull", "Base.Pop3",
        "Base.CannedSardines", "Base.CannedPeaches", "Base.MRE"
    },
    building = {
        "Base.Plank", "Base.Plank", "Base.Plank", "Base.Plank",
        "Base.Nails", "Base.Nails", "Base.NailsBox",
        "Base.Hammer", "Base.Saw", "Base.Screwdriver",
        "Base.SheetRope", "Base.Axe"
    },
    weapons = {
        "Base.Shotgun", "Base.ShotgunShellsBox", "Base.ShotgunShellsBox",
        "Base.HuntingRifle", "Base.308Box", "Base.Pistol",
        "Base.Bullets9mmBox", "Base.BaseballBat", "Base.Crowbar",
        "Base.Katana", "Base.Machete", "Base.HolsterSimple"
    },
    tools = {
        "Base.Axe", "Base.Hammer", "Base.Saw", "Base.Screwdriver",
        "Base.Wrench", "Base.WeldingRods", "Base.BlowTorch",
        "Base.Crowbar", "Base.HandTorch", "Base.Battery",
        "Base.Rope", "Base.DuctTape"
    }
}

handlers.airdrop = function(args)
    local x = math.floor(tonumber(args.x) or 0)
    local y = math.floor(tonumber(args.y) or 0)
    local z = 0 -- always ground level
    local preset = args.preset -- "military", "medical", etc.
    local customItems = args.items -- custom item list (array of {itemType, count})
    local announce = args.announce ~= false -- default true
    local attractZombies = args.attractZombies ~= false -- default true
    local soundRadius = math.min(math.max(tonumber(args.soundRadius) or 150, 10), 500)

    -- Validate coordinates are within reasonable PZ world bounds
    if x < -1000 or x > 100000 or y < -1000 or y > 100000 then
        return false, nil, "Coordinates out of range (valid: -1000 to 100000)"
    end
    if x == 0 and y == 0 then
        return false, nil, "Valid x and y coordinates are required"
    end

    -- Validate preset name if provided (whitelist only)
    if preset and not AIRDROP_PRESETS[preset] then
        if customItems == nil then
            return false, nil, "Unknown preset '" .. tostring(preset) .. "'. Valid: military, medical, food, building, weapons, tools"
        end
        preset = nil -- ignore invalid preset if custom items provided
    end

    -- Determine item list
    local itemsToSpawn = {}
    if customItems and type(customItems) == "table" then
        -- Custom item list: [{itemType: "Base.Axe", count: 2}, ...]
        for _, entry in ipairs(customItems) do
            if entry.itemType and type(entry.itemType) == "string" then
                -- Validate item type format: must be "Module.ItemName" pattern
                if not entry.itemType:match("^%a[%w_]*%.%a[%w_]*$") then
                    return false, nil, "Invalid item type format: " .. tostring(entry.itemType) .. " (expected Module.ItemName)"
                end
                local count = math.min(math.max(tonumber(entry.count) or 1, 1), 20)
                for i = 1, count do
                    table.insert(itemsToSpawn, entry.itemType)
                end
            end
        end
    elseif preset and AIRDROP_PRESETS[preset] then
        itemsToSpawn = AIRDROP_PRESETS[preset]
    else
        return false, nil, "Either 'preset' (military/medical/food/building/weapons/tools) or 'items' array is required"
    end

    if #itemsToSpawn == 0 then
        return false, nil, "No items to drop"
    end

    -- Clamp total items
    if #itemsToSpawn > 50 then
        local clamped = {}
        for i = 1, 50 do
            clamped[i] = itemsToSpawn[i]
        end
        itemsToSpawn = clamped
    end

    -- Get the grid square at the target location
    local world = getWorld()
    if not world then
        return false, nil, "World not available"
    end

    local cell = world:getCell()
    if not cell then
        return false, nil, "Cell not available"
    end

    local sq = cell:getGridSquare(x, y, z)
    if not sq then
        return false, nil, "Grid square not loaded at " .. x .. "," .. y .. " — a player must be nearby"
    end

    -- Spawn items on the ground
    local added = 0
    local attempted = #itemsToSpawn
    local failedTypes = {}
    for _, itemType in ipairs(itemsToSpawn) do
        local ok, result = pcall(function()
            if sq.AddWorldInventoryItem then
                -- B42+ method: place directly on the ground
                return sq:AddWorldInventoryItem(itemType, 0.5, 0.5, 0)
            else
                -- Fallback: use InventoryItemFactory + manual placement
                local item = InventoryItemFactory.CreateItem(itemType)
                if item then
                    sq:AddWorldInventoryItem(item, 0.5, 0.5, 0)
                    return item
                end
                return nil
            end
        end)
        if ok and result then
            added = added + 1
        else
            failedTypes[itemType] = true
        end
    end

    if added == 0 then
        return false, nil, "Failed to spawn any items (" .. attempted .. " attempted). The area may not be loaded or item types may be invalid."
    end

    -- Attract zombies with a loud sound
    if attractZombies then
        pcall(function()
            addSound(nil, x, y, z, soundRadius, 200)
        end)
    end

    -- Announce to all players
    if announce then
        pcall(function()
            local presetName = preset and (preset:sub(1,1):upper() .. preset:sub(2)) or "Custom"
            local msg = "[AIRDROP] " .. presetName .. " supply drop at coordinates " .. x .. ", " .. y .. "!"
            if sendServerMessage then
                sendServerMessage(msg)
            end
        end)
    end

    PanelBridge.info("Airdrop deployed", { x = x, y = y, preset = preset, itemCount = added, attempted = attempted })
    local failedCount = attempted - added
    -- Collect unique failed type names for diagnostics
    local failedList = {}
    for typeName, _ in pairs(failedTypes) do
        table.insert(failedList, typeName)
    end
    return true, {
        message = "Airdrop deployed: " .. added .. "/" .. attempted .. " items at " .. x .. ", " .. y,
        x = x,
        y = y,
        itemCount = added,
        attempted = attempted,
        failed = failedCount,
        failedTypes = #failedList > 0 and failedList or nil,
        preset = preset or "custom"
    }
end

-- ============================================
-- ZOMBIE MANAGEMENT HANDLERS
-- ============================================

-- Get zombie count in loaded cells
handlers.getZombieCount = function(args)
    local world = getWorld()
    if not world then
        return false, nil, "World not available"
    end
    
    local cell = world:getCell()
    if not cell then
        return false, nil, "Cell not available"
    end
    
    local zombieCount = 0
    local ok, list = pcall(function()
        return cell:getZombieList()
    end)
    
    if ok and list then
        zombieCount = list:size()
    end
    
    return true, { 
        zombieCount = zombieCount,
        note = "Count is for currently loaded cells only"
    }
end

-- Clear zombies around a player
handlers.clearZombiesNearPlayer = function(args)
    local username = args.username
    local radius = tonumber(args.radius) or 50
    
    if not username then
        return false, nil, "Username required"
    end
    
    local player = getPlayerByUsername(username)
    if not player then
        return false, nil, "Player not found: " .. username
    end
    
    local px, py, pz = player:getX(), player:getY(), player:getZ()
    local world = getWorld()
    local cell = world and world:getCell()
    
    if not cell then
        return false, nil, "Could not access world cell"
    end
    
    local removed = 0
    local ok, err = pcall(function()
        local zombies = cell:getZombieList()
        if zombies then
            -- Iterate backwards to safely remove
            for i = zombies:size() - 1, 0, -1 do
                local zombie = zombies:get(i)
                if zombie then
                    pcall(function()
                        local zx, zy, zz = zombie:getX(), zombie:getY(), zombie:getZ()
                        if zx and zy and zz then
                            local dist = math.sqrt((zx - px)^2 + (zy - py)^2 + (zz - pz)^2)
                            if dist <= radius then
                                zombie:removeFromSquare()
                                zombie:removeFromWorld()
                                removed = removed + 1
                            end
                        end
                    end)
                end
            end
        end
    end)
    
    if not ok then
        PanelBridge.warn("Error clearing zombies", { error = tostring(err) })
    end
    
    PanelBridge.info("Cleared zombies", { username = username, radius = radius, removed = removed })
    return true, { 
        message = "Removed " .. removed .. " zombies",
        radius = radius,
        removed = removed
    }
end

-- Clear ALL zombies in loaded cells
handlers.clearAllZombies = function(args)
    local world = getWorld()
    if not world then
        return false, nil, "World not available"
    end

    -- Try ForceKillAllZombies first (reliable in both B41 and B42)
    local removed = 0
    local usedForceKill = false
    if world.ForceKillAllZombies then
        local ok, err = pcall(function()
            world:ForceKillAllZombies()
            usedForceKill = true
        end)
        if not ok then
            PanelBridge.warn("ForceKillAllZombies failed, falling back to manual removal", { error = tostring(err) })
        end
    end

    -- Fallback: manual removal from cell zombie list
    if not usedForceKill then
        local cell = world:getCell()
        if not cell then
            return false, nil, "Could not access world cell"
        end
        local ok, err = pcall(function()
            local zombies = cell:getZombieList()
            if zombies then
                for i = zombies:size() - 1, 0, -1 do
                    local zombie = zombies:get(i)
                    if zombie then
                        pcall(function()
                            zombie:removeFromSquare()
                            zombie:removeFromWorld()
                            removed = removed + 1
                        end)
                    end
                end
            end
        end)
        if not ok then
            PanelBridge.warn("Error clearing zombies manually", { error = tostring(err) })
        end
    end

    PanelBridge.warn("Cleared zombies", { usedForceKill = usedForceKill, manualRemoved = removed })
    return true, {
        message = usedForceKill and "Force-killed all zombies" or ("Removed " .. removed .. " zombies from loaded cells"),
        removed = removed,
        usedForceKill = usedForceKill
    }
end

-- Helper: resolve ZombiePopulationManager (not exposed as global in B42)
local function getZombiePopManager()
    local ZPM = resolveJavaClass("ZombiePopulationManager", "zombie.popman.ZombiePopulationManager")
    if ZPM and ZPM.instance then
        return ZPM.instance
    end
    return nil
end

-- Spawn horde near a player (40-80 tiles away)
handlers.spawnHordeNearPlayer = function(args)
    local username = args.username
    local count = math.floor(tonumber(args.count) or 50)
    count = math.min(math.max(count, 1), 500)

    if not username then
        return false, nil, "Username required"
    end

    local player = getPlayerByUsername(username)
    if not player then
        return false, nil, "Player not found: " .. username
    end

    local px, py = player:getX(), player:getY()

    -- Random angle, spawn 50-70 tiles from player in a 30x30 area
    local angle = ZombRand(360) * math.pi / 180
    local dist = 50 + ZombRand(21) -- 50-70
    local cx = math.floor(px + math.cos(angle) * dist)
    local cy = math.floor(py + math.sin(angle) * dist)
    local half = 15
    local method = "unknown"

    local ok, err = pcall(function()
        -- B42 preferred: ZombiePopulationManager.createHordeInAreaTo
        -- Creates real zombies that walk toward the player
        local zpop = getZombiePopManager()
        if zpop and zpop.createHordeInAreaTo then
            zpop:createHordeInAreaTo(cx - half, cy - half, half * 2, half * 2, math.floor(px), math.floor(py), count)
            method = "createHordeInAreaTo"
        elseif zpop and zpop.createHordeFromTo then
            zpop:createHordeFromTo(cx, cy, math.floor(px), math.floor(py), count)
            method = "createHordeFromTo"
        else
            -- Fallback: IsoWorld.CreateSwarm (B41)
            local world = getWorld()
            if world and world.CreateSwarm then
                world:CreateSwarm(count, cx - half, cy - half, cx + half, cy + half)
                method = "CreateSwarm"
            else
                error("No zombie spawning API available")
            end
        end
    end)

    if not ok then
        return false, nil, "Failed to spawn horde: " .. tostring(err)
    end

    PanelBridge.warn("Spawned horde near player", { username = username, count = count, cx = cx, cy = cy, method = method })
    return true, {
        message = "Spawned " .. count .. " zombies near " .. username,
        count = count,
        center = { x = cx, y = cy },
        distance = dist,
        method = method
    }
end

-- Spawn horde behind a player (based on facing direction)
handlers.spawnHordeBehindPlayer = function(args)
    local username = args.username
    local count = math.floor(tonumber(args.count) or 50)
    count = math.min(math.max(count, 1), 500)

    if not username then
        return false, nil, "Username required"
    end

    local player = getPlayerByUsername(username)
    if not player then
        return false, nil, "Player not found: " .. username
    end

    local px, py = player:getX(), player:getY()

    -- Get player facing direction and compute "behind" offset
    local dir = player:getDir()
    local dirName = dir and tostring(dir) or "N"
    -- Direction offsets: the vector the player is FACING
    local dirMap = {
        N  = { dx =  0, dy = -1 },
        NE = { dx =  1, dy = -1 },
        E  = { dx =  1, dy =  0 },
        SE = { dx =  1, dy =  1 },
        S  = { dx =  0, dy =  1 },
        SW = { dx = -1, dy =  1 },
        W  = { dx = -1, dy =  0 },
        NW = { dx = -1, dy = -1 },
    }
    -- "Behind" is the opposite of the facing direction
    local facing = dirMap[dirName] or { dx = 0, dy = -1 }
    local behindX = -facing.dx
    local behindY = -facing.dy

    -- Spawn 50-70 tiles behind, in a 30x30 area
    local dist = 50 + ZombRand(21) -- 50-70
    local cx = math.floor(px + behindX * dist)
    local cy = math.floor(py + behindY * dist)
    local half = 15
    local method = "unknown"

    local ok, err = pcall(function()
        -- B42 preferred: ZombiePopulationManager.createHordeInAreaTo
        local zpop = getZombiePopManager()
        if zpop and zpop.createHordeInAreaTo then
            zpop:createHordeInAreaTo(cx - half, cy - half, half * 2, half * 2, math.floor(px), math.floor(py), count)
            method = "createHordeInAreaTo"
        elseif zpop and zpop.createHordeFromTo then
            zpop:createHordeFromTo(cx, cy, math.floor(px), math.floor(py), count)
            method = "createHordeFromTo"
        else
            local world = getWorld()
            if world and world.CreateSwarm then
                world:CreateSwarm(count, cx - half, cy - half, cx + half, cy + half)
                method = "CreateSwarm"
            else
                error("No zombie spawning API available")
            end
        end
    end)

    if not ok then
        return false, nil, "Failed to spawn horde behind: " .. tostring(err)
    end

    PanelBridge.warn("Spawned horde behind player", { username = username, count = count, direction = dirName, cx = cx, cy = cy, method = method })
    return true, {
        message = "Spawned " .. count .. " zombies behind " .. username,
        count = count,
        center = { x = cx, y = cy },
        playerDirection = dirName,
        distance = dist,
        method = method
    }
end

-- ============================================
-- SAFEHOUSE MANAGEMENT HANDLERS
-- ============================================

local function findSafehouseByRef(ref)
    if not ref then return nil, "safehouseRef required" end
    if not SafeHouse or not SafeHouse.getSafehouseList then
        return nil, "SafeHouse API not available"
    end

    local list = SafeHouse.getSafehouseList()
    if not list then return nil, "No safehouses found" end

    local refStr = tostring(ref)
    for i = 0, list:size() - 1 do
        local sh = list:get(i)
        if sh then
            local sid = sh.getId and sh:getId() or nil
            local title = sh.getTitle and sh:getTitle() or nil
            if tostring(sid) == refStr or tostring(title) == refStr then
                return sh
            end
        end
    end

    return nil, "Safehouse not found: " .. refStr
end

handlers.getSafehouses = function(args)
    if not SafeHouse or not SafeHouse.getSafehouseList then
        return false, nil, "SafeHouse API not available"
    end

    local list = SafeHouse.getSafehouseList()
    local out = {}
    if list then
        for i = 0, list:size() - 1 do
            local sh = list:get(i)
            if sh then
                -- Collect allowed players
                local players = {}
                pcall(function()
                    local pList = sh.getPlayers and sh:getPlayers() or nil
                    if pList then
                        for j = 0, pList:size() - 1 do
                            table.insert(players, tostring(pList:get(j)))
                        end
                    end
                end)

                table.insert(out, {
                    id = sh.getId and sh:getId() or nil,
                    title = sh.getTitle and sh:getTitle() or nil,
                    owner = sh.getOwner and sh:getOwner() or nil,
                    x = sh.getX and sh:getX() or nil,
                    y = sh.getY and sh:getY() or nil,
                    w = sh.getW and sh:getW() or nil,
                    h = sh.getH and sh:getH() or nil,
                    players = players,
                    playerConnected = sh.getPlayerConnected and sh:getPlayerConnected() or 0,
                    lastVisited = sh.getLastVisited and sh:getLastVisited() or nil
                })
            end
        end
    end

    return true, { safehouses = out, count = #out }
end

handlers.safehouseAddPlayer = function(args)
    local sh, err = findSafehouseByRef(args.safehouseRef)
    if not sh then return false, nil, err end

    local username = normalizeMessage(args.username, 64)
    if not username then return false, nil, "Username required" end

    local ok, addErr = pcall(function()
        sh:addPlayer(username)
    end)
    if not ok then
        return false, nil, "Failed to add player to safehouse: " .. tostring(addErr)
    end

    return true, { message = "Player added to safehouse", safehouseRef = args.safehouseRef, username = username }
end

handlers.safehouseRemovePlayer = function(args)
    local sh, err = findSafehouseByRef(args.safehouseRef)
    if not sh then return false, nil, err end

    local username = normalizeMessage(args.username, 64)
    if not username then return false, nil, "Username required" end

    local ok, removeErr = pcall(function()
        sh:removePlayer(username)
    end)
    if not ok then
        return false, nil, "Failed to remove player from safehouse: " .. tostring(removeErr)
    end

    return true, { message = "Player removed from safehouse", safehouseRef = args.safehouseRef, username = username }
end

handlers.safehouseSetOwner = function(args)
    local sh, err = findSafehouseByRef(args.safehouseRef)
    if not sh then return false, nil, err end

    local owner = normalizeMessage(args.owner, 64)
    if not owner then return false, nil, "Owner username required" end

    local ok, setErr = pcall(function()
        sh:setOwner(owner)
    end)
    if not ok then
        return false, nil, "Failed to set safehouse owner: " .. tostring(setErr)
    end

    return true, { message = "Safehouse owner updated", safehouseRef = args.safehouseRef, owner = owner }
end

handlers.safehouseSetRespawn = function(args)
    local sh, err = findSafehouseByRef(args.safehouseRef)
    if not sh then return false, nil, err end

    local username = normalizeMessage(args.username, 64)
    if not username then return false, nil, "Username required" end
    local enabled = args.enabled == true

    local ok, setErr = pcall(function()
        sh:setRespawnInSafehouse(enabled, username)
    end)
    if not ok then
        return false, nil, "Failed to set safehouse respawn: " .. tostring(setErr)
    end

    return true, {
        message = "Safehouse respawn updated",
        safehouseRef = args.safehouseRef,
        username = username,
        enabled = enabled
    }
end

-- ============================================
-- FACTION MANAGEMENT HANDLERS
-- ============================================

handlers.getFactions = function(args)
    if not Faction or not Faction.getFactions then
        return false, nil, "Faction API not available"
    end

    local factions = Faction.getFactions()
    local out = {}
    if factions then
        for i = 0, factions:size() - 1 do
            local f = factions:get(i)
            if f then
                local players = {}
                local fPlayers = f.getPlayers and f:getPlayers() or nil
                if fPlayers then
                    for j = 0, fPlayers:size() - 1 do
                        table.insert(players, tostring(fPlayers:get(j)))
                    end
                end
                table.insert(out, {
                    name = f.getName and f:getName() or nil,
                    owner = f.getOwner and f:getOwner() or nil,
                    tag = f.getTag and f:getTag() or nil,
                    players = players,
                    playerCount = #players
                })
            end
        end
    end

    return true, { factions = out, count = #out }
end

handlers.createFaction = function(args)
    if not Faction or not Faction.createFaction then
        return false, nil, "Faction API not available"
    end

    local name = normalizeMessage(args.name, 64)
    local owner = normalizeMessage(args.owner, 64)
    if not name then return false, nil, "Faction name required" end
    if not owner then return false, nil, "Faction owner required" end

    -- Pre-check: faction name already taken
    if Faction.factionExist and Faction.factionExist(name) then
        return false, nil, "A faction named '" .. name .. "' already exists"
    end

    -- Pre-check: owner already in a faction
    if Faction.isAlreadyInFaction then
        local alreadyIn = false
        local okChk, _ = pcall(function() alreadyIn = Faction.isAlreadyInFaction(owner) end)
        if okChk and alreadyIn then
            local existingName = ""
            pcall(function()
                local f = Faction.getPlayerFaction(owner)
                if f then existingName = " (" .. tostring(f:getName()) .. ")" end
            end)
            return false, nil, "Owner '" .. owner .. "' is already in a faction" .. existingName
        end
    end

    local ok, factionOrErr = pcall(function()
        return Faction.createFaction(name, owner)
    end)
    if not ok then
        return false, nil, "Failed to create faction: " .. tostring(factionOrErr)
    end

    if not factionOrErr then
        return false, nil, "Faction creation failed (name may be taken or owner ineligible)"
    end

    -- Sync to clients
    pcall(function()
        if factionOrErr.syncFaction then factionOrErr:syncFaction() end
    end)

    return true, { message = "Faction '" .. name .. "' created with owner '" .. owner .. "'", name = name, owner = owner }
end

handlers.factionAddPlayer = function(args)
    if not Faction or not Faction.getFaction then
        return false, nil, "Faction API not available"
    end

    local factionName = normalizeMessage(args.factionName, 64)
    local username = normalizeMessage(args.username, 64)
    if not factionName then return false, nil, "factionName required" end
    if not username then return false, nil, "username required" end

    local faction = Faction.getFaction(factionName)
    if not faction then return false, nil, "Faction not found: " .. factionName end

    local ok, err = pcall(function()
        faction:addPlayer(username)
        if faction.syncFaction then faction:syncFaction() end
    end)
    if not ok then
        return false, nil, "Failed to add player to faction: " .. tostring(err)
    end

    return true, { message = "Player added to faction", factionName = factionName, username = username }
end

handlers.factionRemovePlayer = function(args)
    if not Faction or not Faction.getFaction then
        return false, nil, "Faction API not available"
    end

    local factionName = normalizeMessage(args.factionName, 64)
    local username = normalizeMessage(args.username, 64)
    if not factionName then return false, nil, "factionName required" end
    if not username then return false, nil, "username required" end

    local faction = Faction.getFaction(factionName)
    if not faction then return false, nil, "Faction not found: " .. factionName end

    local ok, err = pcall(function()
        faction:removePlayer(username)
        if faction.syncFaction then faction:syncFaction() end
    end)
    if not ok then
        return false, nil, "Failed to remove player from faction: " .. tostring(err)
    end

    return true, { message = "Player removed from faction", factionName = factionName, username = username }
end

handlers.factionSetTag = function(args)
    if not Faction or not Faction.getFaction then
        return false, nil, "Faction API not available"
    end

    local factionName = normalizeMessage(args.factionName, 64)
    local tag = normalizeMessage(args.tag, 8)
    if not factionName then return false, nil, "factionName required" end
    if not tag then return false, nil, "tag required" end

    local faction = Faction.getFaction(factionName)
    if not faction then return false, nil, "Faction not found: " .. factionName end

    local ok, err = pcall(function()
        faction:setTag(tag)
        if faction.syncFaction then faction:syncFaction() end
    end)
    if not ok then
        return false, nil, "Failed to set faction tag: " .. tostring(err)
    end

    return true, { message = "Faction tag updated", factionName = factionName, tag = tag }
end

handlers.removeFaction = function(args)
    if not Faction or not Faction.getFaction then
        return false, nil, "Faction API not available"
    end

    local factionName = normalizeMessage(args.factionName, 64)
    if not factionName then return false, nil, "factionName required" end

    local faction = Faction.getFaction(factionName)
    if not faction then return false, nil, "Faction not found: " .. factionName end

    local ok, err = pcall(function()
        faction:removeFaction()
    end)
    if not ok then
        return false, nil, "Failed to remove faction: " .. tostring(err)
    end

    return true, { message = "Faction removed", factionName = factionName }
end

-- ============================================
-- VEHICLE TRIAGE & RECOVERY HANDLERS
-- ============================================

local function getVehiclesList()
    local world = getWorld()
    local cell = world and world.getCell and world:getCell() or nil
    if not cell then return nil end
    if cell.getVehicles then
        return cell:getVehicles()
    end
    return nil
end

local function findVehicleById(vehicleId)
    local vehicles = getVehiclesList()
    if not vehicles then return nil end

    local targetId = tonumber(vehicleId)
    if not targetId then return nil end

    for i = 0, vehicles:size() - 1 do
        local v = vehicles:get(i)
        if v and v.getId and tonumber(v:getId()) == targetId then
            return v
        end
    end
    return nil
end

handlers.getVehiclesDetailed = function(args)
    local vehicles = getVehiclesList()
    if not vehicles then
        return false, nil, "Vehicle list not available"
    end

    local out = {}
    for i = 0, vehicles:size() - 1 do
        local v = vehicles:get(i)
        if v then
            table.insert(out, {
                id = v.getId and v:getId() or nil,
                x = v.getX and v:getX() or nil,
                y = v.getY and v:getY() or nil,
                z = v.getZ and v:getZ() or nil,
                scriptName = v.getScriptName and v:getScriptName() or nil,
                type = v.getVehicleType and v:getVehicleType() or nil,
                speedKmh = v.getCurrentSpeedKmHour and v:getCurrentSpeedKmHour() or 0,
                batteryCharge = v.getBatteryCharge and v:getBatteryCharge() or nil,
                fuelPct = v.getRemainingFuelPercentage and v:getRemainingFuelPercentage() or nil,
                alarmed = v.isAlarmed and v:isAlarmed() or false,
                sirening = v.getLightbarSirenMode and v:getLightbarSirenMode() > 0 or false,
                trunkLocked = v.isTrunkLocked and v:isTrunkLocked() or false
            })
        end
    end

    return true, { vehicles = out, count = #out }
end

handlers.vehicleRepair = function(args)
    local vehicle = findVehicleById(args.vehicleId)
    if not vehicle then return false, nil, "Vehicle not found" end

    local ok, err = pcall(function()
        if vehicle.repair then vehicle:repair() end
        if vehicle.updatePartStats then vehicle:updatePartStats() end
    end)
    if not ok then return false, nil, "Vehicle repair failed: " .. tostring(err) end

    return true, { message = "Vehicle repaired", vehicleId = tonumber(args.vehicleId) }
end

handlers.vehicleSetAlarm = function(args)
    local vehicle = findVehicleById(args.vehicleId)
    if not vehicle then return false, nil, "Vehicle not found" end
    local enabled = args.enabled == true

    local ok, err = pcall(function()
        if vehicle.setAlarmed then vehicle:setAlarmed(enabled) end
        if enabled and vehicle.triggerAlarm then vehicle:triggerAlarm() end
    end)
    if not ok then return false, nil, "Failed to update vehicle alarm: " .. tostring(err) end

    return true, { message = "Vehicle alarm updated", vehicleId = tonumber(args.vehicleId), enabled = enabled }
end

handlers.vehicleSetSiren = function(args)
    local vehicle = findVehicleById(args.vehicleId)
    if not vehicle then return false, nil, "Vehicle not found" end

    local mode = tonumber(args.mode)
    if not mode then mode = (args.enabled == false and 0 or 1) end

    local ok, err = pcall(function()
        if vehicle.setLightbarSirenMode then
            vehicle:setLightbarSirenMode(mode)
        else
            error("setLightbarSirenMode not available")
        end
    end)
    if not ok then return false, nil, "Failed to set vehicle siren mode: " .. tostring(err) end

    return true, { message = "Vehicle siren mode updated", vehicleId = tonumber(args.vehicleId), mode = mode }
end

handlers.vehicleSetTrunkLocked = function(args)
    local vehicle = findVehicleById(args.vehicleId)
    if not vehicle then return false, nil, "Vehicle not found" end
    local locked = args.locked == true

    local ok, err = pcall(function()
        if vehicle.setTrunkLocked then
            vehicle:setTrunkLocked(locked)
        else
            error("setTrunkLocked not available")
        end
    end)
    if not ok then return false, nil, "Failed to set trunk lock state: " .. tostring(err) end

    return true, { message = "Vehicle trunk lock updated", vehicleId = tonumber(args.vehicleId), locked = locked }
end

handlers.vehicleSetFuel = function(args)
    local vehicle = findVehicleById(args.vehicleId)
    if not vehicle then return false, nil, "Vehicle not found" end

    local pct = tonumber(args.percent)
    if not pct then return false, nil, "percent required (0-100)" end
    pct = math.min(math.max(pct, 0), 100)

    local ok, err = pcall(function()
        -- B42: setRemainingFuelPercentage expects 0-100
        if vehicle.setRemainingFuelPercentage then
            vehicle:setRemainingFuelPercentage(pct)
        -- Fallback: some builds use tank capacity fraction (0-1)
        elseif vehicle.setCurrentFuel and vehicle.getMaxFuel then
            vehicle:setCurrentFuel(vehicle:getMaxFuel() * pct / 100)
        else
            error("No fuel setter available")
        end
    end)
    if not ok then return false, nil, "Failed to set fuel: " .. tostring(err) end

    return true, { message = "Vehicle fuel set to " .. pct .. "%", vehicleId = tonumber(args.vehicleId), percent = pct }
end

handlers.vehicleSetBattery = function(args)
    local vehicle = findVehicleById(args.vehicleId)
    if not vehicle then return false, nil, "Vehicle not found" end

    local charge = tonumber(args.charge)
    if not charge then return false, nil, "charge required (0-100)" end
    charge = math.min(math.max(charge, 0), 100)

    local ok, err = pcall(function()
        if vehicle.setBatteryCharge then
            vehicle:setBatteryCharge(charge)
        else
            error("setBatteryCharge not available")
        end
    end)
    if not ok then return false, nil, "Failed to set battery: " .. tostring(err) end

    return true, { message = "Vehicle battery set to " .. charge, vehicleId = tonumber(args.vehicleId), charge = charge }
end

-- ============================================
-- AI DIRECTOR EVENT HANDLERS
-- ============================================

handlers.triggerSwarmEvent = function(args)
    local count = math.floor(tonumber(args.count) or 25)
    local x1 = math.floor(tonumber(args.x1) or 0)
    local y1 = math.floor(tonumber(args.y1) or 0)
    local x2 = math.floor(tonumber(args.x2) or x1)
    local y2 = math.floor(tonumber(args.y2) or y1)

    count = math.min(math.max(count, 1), 500)
    if x2 < x1 then x1, x2 = x2, x1 end
    if y2 < y1 then y1, y2 = y2, y1 end

    local midX = math.floor((x1 + x2) / 2)
    local midY = math.floor((y1 + y2) / 2)
    local method = "unknown"

    local ok, err = pcall(function()
        local zpop = getZombiePopManager()
        if zpop and zpop.createHordeInAreaTo then
            zpop:createHordeInAreaTo(x1, y1, x2 - x1, y2 - y1, midX, midY, count)
            method = "createHordeInAreaTo"
        elseif zpop and zpop.createHordeFromTo then
            zpop:createHordeFromTo(x1, y1, midX, midY, count)
            method = "createHordeFromTo"
        else
            local world = getWorld()
            if world and world.CreateSwarm then
                world:CreateSwarm(count, x1, y1, x2, y2)
                method = "CreateSwarm"
            else
                error("No zombie spawning API available")
            end
        end
    end)
    if not ok then return false, nil, "Failed to trigger swarm: " .. tostring(err) end

    PanelBridge.warn("Swarm event triggered", { count = count, area = { x1 = x1, y1 = y1, x2 = x2, y2 = y2 }, method = method })
    return true, { message = "Swarm event triggered", count = count, area = { x1 = x1, y1 = y1, x2 = x2, y2 = y2 }, method = method }
end

handlers.runEventSequence = function(args)
    local steps = args.steps
    if type(steps) ~= "table" then
        return false, nil, "steps array required"
    end

    local maxSteps = math.min(math.max(tonumber(args.maxSteps) or 20, 1), 50)
    local results = {}
    local executed = 0

    for i, step in ipairs(steps) do
        if executed >= maxSteps then break end
        if type(step) == "table" then
            local kind = tostring(step.kind or "")
            local ok, handlerSuccess, handlerData, handlerError = pcall(function()
                if kind == "chat" then
                    local msg = normalizeMessage(step.message, 1000)
                    if not msg then error("chat.message required") end
                    if step.channel == "admin" then
                        return handlers.sendToAdminChat({ message = msg })
                    elseif step.channel == "general" then
                        return handlers.sendToGeneralChat({ message = msg, author = step.author })
                    end
                    return handlers.sendToServerChat({ message = msg, isAlert = step.alert == true })
                elseif kind == "swarm" then
                    return handlers.triggerSwarmEvent(step)
                elseif kind == "weather" then
                    local weatherType = tostring(step.weatherType or "storm")
                    if weatherType == "blizzard" then
                        return handlers.triggerBlizzard({ duration = step.duration })
                    elseif weatherType == "tropical" then
                        return handlers.triggerTropicalStorm({ duration = step.duration })
                    elseif weatherType == "stop" then
                        return handlers.stopWeather({})
                    end
                    return handlers.triggerStorm({ duration = step.duration })
                elseif kind == "utilities" then
                    if step.mode == "off" then
                        return handlers.shutOffUtilities({ power = step.power, water = step.water })
                    end
                    return handlers.restoreUtilities({ power = step.power, water = step.water })
                elseif kind == "noise" then
                    return handlers.createNoise(step)
                else
                    error("Unsupported sequence step kind: " .. kind)
                end
            end)

            executed = executed + 1
            if not ok then
                table.insert(results, { index = i, kind = kind, success = false, error = tostring(handlerSuccess) })
            elseif handlerSuccess then
                table.insert(results, { index = i, kind = kind, success = true, data = handlerData })
            else
                table.insert(results, { index = i, kind = kind, success = false, error = tostring(handlerError) })
            end
        end
    end

    return true, {
        message = "Event sequence executed",
        executed = executed,
        maxSteps = maxSteps,
        results = results
    }
end

-- ============================================
-- INFRASTRUCTURE MAP HANDLERS
-- ============================================

handlers.getInfrastructureSnapshot = function(args)
    local world = getWorld()
    local cell = getCell and getCell() or (world and world.getCell and world:getCell() or nil)
    if not world then return false, nil, "World not available" end

    local snapshot = {
        hydroPowerOn = world.isHydroPowerOn and world:isHydroPowerOn() or nil,
        globalTemperature = world.getGlobalTemperature and world:getGlobalTemperature() or nil,
        weather = world.getWeather and world:getWeather() or nil,
        sample = nil
    }

    local sx = tonumber(args.x)
    local sy = tonumber(args.y)
    local sz = tonumber(args.z) or 0
    if cell and sx and sy then
        local sample = { x = sx, y = sy, z = sz }
        pcall(function()
            if cell.getDangerScore then sample.dangerScore = cell:getDangerScore(math.floor(sx), math.floor(sy)) end
            if cell.getHeatSourceTemperature then sample.heatSourceTemperature = cell:getHeatSourceTemperature(math.floor(sx), math.floor(sy), math.floor(sz)) end
            if cell.getHeatSourceHighestTemperature then
                sample.heatSourceHighestTemperature = cell:getHeatSourceHighestTemperature(
                    snapshot.globalTemperature or 0,
                    math.floor(sx), math.floor(sy), math.floor(sz)
                )
            end
            if cell.getLightSourceAt then sample.hasLamppost = cell:getLightSourceAt(math.floor(sx), math.floor(sy), math.floor(sz)) ~= nil end
        end)
        snapshot.sample = sample
    end

    return true, snapshot
end

-- ============================================
-- MODERATION AUTOMATION HANDLERS
-- ============================================

handlers.moderationKickUser = function(args)
    local username = normalizeMessage(args.username, 64)
    local reason = normalizeMessage(args.reason, 120) or "Kicked by admin panel"
    local description = normalizeMessage(args.description, 240) or reason

    if not username then return false, nil, "Username required" end

    local ok, err = pcall(function()
        if BanSystem and BanSystem.KickUser then
            BanSystem.KickUser(username, reason, description)
        else
            error("BanSystem.KickUser not available")
        end
    end)
    if not ok then return false, nil, "Kick failed: " .. tostring(err) end

    return true, { message = "User kicked", username = username, reason = reason }
end

handlers.moderationBanUser = function(args)
    local username = normalizeMessage(args.username, 64)
    local reason = normalizeMessage(args.reason, 120) or "Banned by admin panel"
    local ban = args.ban ~= false

    if not username then return false, nil, "Username required" end

    local ok, resultOrErr = pcall(function()
        if BanSystem and BanSystem.BanUser then
            return BanSystem.BanUser(username, nil, reason, ban)
        end
        error("BanSystem.BanUser not available")
    end)
    if not ok then return false, nil, "Ban user failed: " .. tostring(resultOrErr) end

    return true, {
        message = ban and "User banned" or "User unbanned",
        username = username,
        details = resultOrErr
    }
end

handlers.moderationBanIP = function(args)
    local ip = normalizeMessage(args.ip, 64)
    local reason = normalizeMessage(args.reason, 120) or "IP ban from admin panel"
    local ban = args.ban ~= false

    if not ip then return false, nil, "IP required" end

    local ok, resultOrErr = pcall(function()
        if BanSystem and BanSystem.BanIP then
            return BanSystem.BanIP(ip, nil, reason, ban)
        end
        error("BanSystem.BanIP not available")
    end)
    if not ok then return false, nil, "Ban IP failed: " .. tostring(resultOrErr) end

    return true, {
        message = ban and "IP banned" or "IP unbanned",
        ip = ip,
        details = resultOrErr
    }
end

handlers.moderationBanSteamID = function(args)
    local steamId = normalizeMessage(args.steamId, 32)
    local reason = normalizeMessage(args.reason, 120) or "SteamID ban from admin panel"
    local ban = args.ban ~= false

    if not steamId then return false, nil, "steamId required" end

    local ok, resultOrErr = pcall(function()
        if BanSystem and BanSystem.BanUserBySteamID then
            return BanSystem.BanUserBySteamID(steamId, nil, reason, ban)
        end
        error("BanSystem.BanUserBySteamID not available")
    end)
    if not ok then return false, nil, "Ban SteamID failed: " .. tostring(resultOrErr) end

    return true, {
        message = ban and "SteamID banned" or "SteamID unbanned",
        steamId = steamId,
        details = resultOrErr
    }
end

-- ============================================
-- MAIN PROCESSING
-- ============================================

function PanelBridge.processCommands()
    local processedCount = 0
    processedCount = processedCount + processQueuedCommands(PanelBridge.MAX_COMMANDS_PER_TICK)

    local commands = PanelBridge.readJSON("commands.json")
    if not commands or not commands.commands then
        if processedCount > 0 then
            PanelBridge.debug("Processed " .. processedCount .. " commands")
        end
        return
    end

    local deferredCommands = nil
    
    -- Clear commands file immediately after reading to minimise the race window
    -- where Node writes a new command between our read and our (old) post-loop clear.
    -- processedIds dedup ensures commands are never processed twice even if the Lua
    -- mod re-reads a file that Node repopulated in the gap.
    PanelBridge.clearFile("commands.json")
    
    for idx, cmd in ipairs(commands.commands) do
        if processedCount >= PanelBridge.MAX_COMMANDS_PER_TICK then
            deferredCommands = {}
            for j = idx, #commands.commands do
                table.insert(deferredCommands, commands.commands[j])
            end
            PanelBridge.warn("Command batch limit reached; deferring remaining commands", {
                processed = processedCount,
                maxPerTick = PanelBridge.MAX_COMMANDS_PER_TICK,
                totalInFile = #commands.commands,
                deferredCount = #deferredCommands
            })
            break
        end

        if processSingleCommand(cmd) then
            processedCount = processedCount + 1
        end
    end
    
    if processedCount > 0 then
        PanelBridge.debug("Processed " .. processedCount .. " commands")
    end

    if deferredCommands and #deferredCommands > 0 then
        -- Merge deferred commands with any new commands that arrived while we were processing.
        local existing = PanelBridge.readJSON("commands.json") or { commands = {} }
        local merged = { commands = {} }

        for _, cmd in ipairs(deferredCommands) do
            table.insert(merged.commands, cmd)
        end

        if existing.commands then
            for _, cmd in ipairs(existing.commands) do
                table.insert(merged.commands, cmd)
            end
        end

        local requeueOk = PanelBridge.writeJSON("commands.json", merged)
        if not requeueOk then
            PanelBridge.error("Failed to requeue deferred commands", { count = #deferredCommands })
        end
    end
    
    -- Cleanup old processed IDs (sliding window: drop oldest half)
    -- Using counter instead of O(n) pairs() iteration
    if PanelBridge.processedIdCount > 500 then
        -- Rebuild with only the newest ~250 IDs to avoid re-processing risk
        local oldCount = PanelBridge.processedIdCount
        local keep = {}
        local keepCount = 0
        local skip = math.floor(oldCount / 2)
        local seen = 0
        for id, _ in pairs(PanelBridge.processedIds) do
            seen = seen + 1
            if seen > skip then
                keep[id] = true
                keepCount = keepCount + 1
            end
        end
        PanelBridge.processedIds = keep
        PanelBridge.processedIdCount = keepCount
        PanelBridge.debug("Trimmed processed IDs", { previous = oldCount, kept = keepCount })
    end
end

function PanelBridge.updateStatus()
    local ok, err = pcall(function()
        local onlinePlayers = getOnlinePlayers()
        local playerNames = {}
        if onlinePlayers then
            for i = 0, onlinePlayers:size() - 1 do
                local player = onlinePlayers:get(i)
                if player then
                    table.insert(playerNames, player:getUsername())
                end
            end
        end
        
        local status = {
            alive = true,
            version = PanelBridge.VERSION,
            protocolVersion = PanelBridge.PROTOCOL_VERSION,
            timestamp = getTimestampMs(),
            serverName = getServerName(),
            playerCount = onlinePlayers and onlinePlayers:size() or 0,
            players = playerNames,
            path = PanelBridge.getBasePath(),
            debugMode = PanelBridge.DEBUG_MODE,
            stats = {
                processed = PanelBridge.stats.commandsProcessed,
                succeeded = PanelBridge.stats.commandsSucceeded,
                failed = PanelBridge.stats.commandsFailed
            },
            queue = {
                lastCommandSeq = PanelBridge.queueState.lastCommandSeq,
                nextResultSeq = PanelBridge.queueState.nextResultSeq
            }
        }
        
        PanelBridge.writeJSON("status.json", status)
    end)
    
    if not ok then
        PanelBridge.error("Failed to update status", { error = tostring(err) })
    end
end

function PanelBridge.onTick()
    if not PanelBridge.initialized then return end
    
    local now = getTimestampMs()
    
    -- Check for commands
    if now - PanelBridge.lastCheck >= PanelBridge.CHECK_INTERVAL then
        PanelBridge.lastCheck = now
        local success, err = pcall(PanelBridge.processCommands)
        if not success then
            PanelBridge.error("Tick error in processCommands", { error = tostring(err) })
        end
        -- Flush any buffered results to disk (single write per tick)
        local flushOk, flushErr = pcall(PanelBridge.flushResults)
        if not flushOk then
            PanelBridge.error("Tick error in flushResults", { error = tostring(flushErr) })
        end
    end
    
    -- Update status periodically
    if now - PanelBridge.lastStatusUpdate >= PanelBridge.STATUS_INTERVAL then
        PanelBridge.lastStatusUpdate = now
        pcall(PanelBridge.updateStatus)
    end
end

function PanelBridge.onServerStarted()
    print("[PanelBridge] ========================================")
    print("[PanelBridge] Initializing v" .. PanelBridge.VERSION)
    
    if not isServer() then
        print("[PanelBridge] Not running on server, disabling")
        return
    end
    
    -- Initialize stats
    PanelBridge.stats.startTime = getTimestampMs()
    PanelBridge.stats.commandsProcessed = 0
    PanelBridge.stats.commandsSucceeded = 0
    PanelBridge.stats.commandsFailed = 0
    PanelBridge.stats.errors = {}
    
    if not PanelBridge.ensureDirectory() then
        PanelBridge.error("Could not create directory")
        print("[PanelBridge] ERROR: Could not create directory")
        return
    end

    -- Ensure queue folders exist.
    PanelBridge.writeFile("inbox/.init", "PanelBridge inbox")
    PanelBridge.writeFile("outbox/.init", "PanelBridge outbox")

    -- Restore queue state from previous run.
    PanelBridge.readQueueState()
    PanelBridge.writeQueueState()
    PanelBridge.writeInboxCursor(PanelBridge.queueState.lastCommandSeq)
    
    -- Detect version and available APIs
    PanelBridge.detectVersion()
    
    -- Write initial status
    PanelBridge.updateStatus()
    
    -- Clear old commands and results
    PanelBridge.clearFile("commands.json")
    
    -- Write a startup log entry
    PanelBridge.writeJSON("startup.json", {
        version = PanelBridge.VERSION,
        startTime = PanelBridge.stats.startTime,
        path = PanelBridge.getBasePath(),
        detectedVersion = PanelBridge.detectedVersion,
        serverName = getServerName()
    })
    
    -- Reset time speed to 1x so fast-forward doesn't persist across reboots
    pcall(function()
        local gt = getGameTime()
        if gt and gt.getMultiplier and gt:getMultiplier() ~= 1 then
            local prev = gt:getMultiplier()
            gt:setMultiplier(1)
            print("[PanelBridge] Reset time speed from " .. tostring(prev) .. "x to 1x")
        end
    end)

    PanelBridge.initialized = true
    PanelBridge.info("PanelBridge ready", { path = PanelBridge.getBasePath() })
    print("[PanelBridge] Ready at: " .. PanelBridge.getBasePath())
    print("[PanelBridge] Debug mode: " .. (PanelBridge.DEBUG_MODE and "ON" or "OFF"))
    print("[PanelBridge] ========================================")
end

-- Register events
Events.OnServerStarted.Add(PanelBridge.onServerStarted)
-- Use OnTickEvenPaused so the bridge works even when no players are connected
Events.OnTickEvenPaused.Add(PanelBridge.onTick)

return PanelBridge

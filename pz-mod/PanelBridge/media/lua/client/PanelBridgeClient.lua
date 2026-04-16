-- Client-side handler for PanelBridge updates
-- Forces local synchronization of power/water state when server commands it
-- Must be deployed as a mod (not base game file) so clients auto-download it

local PBC_VERSION = "1.3.0"

local function onServerCommand(module, command, args)
    if module ~= "PanelBridge" then return end

    if command == "doTeleport" then
        -- Server is telling this client to teleport to coordinates
        -- This is the reliable path: PZ's own admin tools always teleport client-side in MP
        local x = tonumber(args.x)
        local y = tonumber(args.y)
        local z = tonumber(args.z) or 0
        
        if not x or not y then
            print("[PanelBridgeClient] doTeleport: invalid coords")
            return
        end
        
        print("[PanelBridgeClient] doTeleport received: " .. x .. "," .. y .. "," .. z)
        
        local player = getPlayer()
        if not player then
            print("[PanelBridgeClient] doTeleport: no local player")
            return
        end
        
        local oldX = player:getX()
        local oldY = player:getY()
        local oldZ = player:getZ()
        
        -- Use the same method PZ's own DebugContextMenu uses in multiplayer:
        -- SendCommandToServer("/teleportto x,y,z") — this goes through the Java
        -- server command handler which does full network-synced teleport
        local ok, err = pcall(function()
            if isClient() then
                SendCommandToServer("/teleportto " .. tostring(x) .. "," .. tostring(y) .. "," .. tostring(z))
                print("[PanelBridgeClient] Sent /teleportto via SendCommandToServer")
            else
                player:teleportTo(x, y, z)
                print("[PanelBridgeClient] Called teleportTo directly (singleplayer)")
            end
        end)
        
        if not ok then
            print("[PanelBridgeClient] doTeleport ERROR: " .. tostring(err))
            -- Fallback: try direct teleportTo
            pcall(function()
                player:teleportTo(x, y, z)
                print("[PanelBridgeClient] Fallback teleportTo called")
            end)
        end
        
        print("[PanelBridgeClient] doTeleport from " .. oldX .. "," .. oldY .. "," .. oldZ 
            .. " to " .. x .. "," .. y .. "," .. z)
        return
    end

    if command == "refreshPowerState" then
        print("[PanelBridgeClient] refreshPowerState received from server")
        
        local powerOn = args.powerOn
        local elecModifier = args.elecShutModifier
        local waterModifier = args.waterShutModifier
        local elecShut = args.elecShut
        local waterShut = args.waterShut
        
        -- Step 1: Force local sandbox Lua variables
        if SandboxVars then
            if elecShut ~= nil then
                SandboxVars.ElecShut = elecShut
                print("[PanelBridgeClient] Set ElecShut = " .. tostring(elecShut))
            end
            if elecModifier ~= nil then
                SandboxVars.ElecShutModifier = elecModifier
                print("[PanelBridgeClient] Set ElecShutModifier = " .. tostring(elecModifier))
            end
            if waterShut ~= nil then
                SandboxVars.WaterShut = waterShut
                print("[PanelBridgeClient] Set WaterShut = " .. tostring(waterShut))
            end
            if waterModifier ~= nil then
                SandboxVars.WaterShutModifier = waterModifier
                print("[PanelBridgeClient] Set WaterShutModifier = " .. tostring(waterModifier))
            end
        end
        
        -- Step 2: Sync Lua -> Java on client side (updateFromLua + applySettings)
        pcall(function()
            local so = getSandboxOptions()
            if so then
                if so.updateFromLua then
                    so:updateFromLua()
                    print("[PanelBridgeClient] Called updateFromLua()")
                end
                if so.applySettings then
                    so:applySettings()
                    print("[PanelBridgeClient] Called applySettings()")
                end
            end
        end)
        
        -- Step 3: Force world hydro power state
        local world = getWorld()
        if world and world.setHydroPowerOn then
            if powerOn ~= nil then
                world:setHydroPowerOn(powerOn)
                print("[PanelBridgeClient] setHydroPowerOn(" .. tostring(powerOn) .. ")")
            end
        end
        
        -- Step 4: Verify the change took effect
        pcall(function()
            local verify = SandboxVars and SandboxVars.ElecShutModifier or "nil"
            print("[PanelBridgeClient] Verify ElecShutModifier = " .. tostring(verify))
        end)
        
        print("[PanelBridgeClient] refreshPowerState complete")
    end
end

Events.OnServerCommand.Add(onServerCommand)
print("[PanelBridgeClient] v" .. PBC_VERSION .. " loaded - listening for PanelBridge commands")

-- Client-side handler for PanelBridge updates
-- Forces local synchronization of power/water state when server commands it

local function onServerCommand(module, command, args)
    if module ~= "PanelBridge" then return end

    if command == "refreshPowerState" then
        local powerOn = args.powerOn
        local elecModifier = args.elecShutModifier
        
        -- Force local sandbox update
        if SandboxVars then
            if elecModifier then
                SandboxVars.ElecShutModifier = elecModifier
                print("[PanelBridgeClient] Synced ElecShutModifier to " .. tostring(elecModifier))
            end
        end
        
        -- Force world update
        local world = getWorld()
        if world and world.setHydroPowerOn then
            if powerOn ~= nil then
                world:setHydroPowerOn(powerOn)
                print("[PanelBridgeClient] Force setHydroPowerOn to " .. tostring(powerOn))
            end
        end
        
        -- Trigger event to notify game systems
        if triggerEvent then
            if powerOn then
                triggerEvent("OnHydroPowerOn")
            else
                triggerEvent("OnHydroPowerOff")
            end
        end
    end
end

Events.OnServerCommand.Add(onServerCommand)
print("[PanelBridgeClient] Loaded PanelBridge client listeners")

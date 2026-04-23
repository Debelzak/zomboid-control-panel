// Access the PanelBridge.lua content embedded at bundle time via esbuild `define`.
// In packaged pkg builds this returns the exact Lua source that shipped with the
// running binary, which is the only way to guarantee the on-disk mod matches the
// panel version after a binary-only auto-update.
//
// In dev mode (non-bundled ESM) PANEL_BRIDGE_LUA_B64 is undefined, so this returns
// null and callers must fall back to on-disk pz-mod lookup.

let cached;

export function getEmbeddedPanelBridgeLua() {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line no-undef
    const b64 = typeof PANEL_BRIDGE_LUA_B64 !== 'undefined' ? PANEL_BRIDGE_LUA_B64 : '';
    cached = (b64 && b64.length > 0) ? Buffer.from(b64, 'base64').toString('utf8') : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function getEmbeddedPanelBridgeVersion() {
  const content = getEmbeddedPanelBridgeLua();
  if (!content) return null;
  const m = content.match(/VERSION\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

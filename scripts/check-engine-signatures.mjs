#!/usr/bin/env node
// Sixth gate check, alongside LINT/RUNNER/CLIENT/CLIENTLINT/TSC: validates every engine method call
// PanelBridge.lua makes (both through the PanelBridge.invoke/hasMethod/safeCall/safeGet/tryGet
// helper family and bare `recv:method(...)` calls) against scripts/engine-signatures.manifest.json,
// a real jar-derived record of what methods actually exist on each Java class (see
// scripts/gen-engine-signatures.mjs, which builds that manifest, and scripts/lib/
// engine-signature-core.mjs, the resolution engine both scripts share).
//
// No JDK is needed here -- the manifest is committed, and this script only reads it. Regenerating
// the manifest (a local JDK + the game jar) is a separate, manual step; see gen-engine-signatures.mjs.
//
// PASS/FAIL contract (operator-confirmed 2026-08-30, see gen-engine-signatures.mjs's header for the
// full reasoning): a call site whose receiver resolves to a known class AND whose method is absent
// from that class's full inheritance chain in the manifest is a DEFINITE bug -- FAILS the gate. Any
// other outcome (receiver unresolved, method name dynamic, class not in the manifest, method
// present) PASSES -- presence is evidence the call is plausible, never proof it is callable through
// PZ's Kahlua Lua<->Java binding, so this script only ever fails on the ABSENT side of that
// asymmetry, never claims success beyond it.
//
// Coverage is reported every run, unconditionally: call sites found, receivers resolved, and why
// the rest were not -- a checker that quietly resolves 3 sites and passes looks identical to one
// that resolves 300 and passes, which is exactly the failure mode this tool exists to not repeat.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveAllCallSites, SEED_GLOBALS, STATIC_CLASS_SEEDS } from './lib/engine-signature-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

// --lua/--manifest exist for break-verification (point the checker at a synthetic fixture instead
// of the real file) -- normal use (local, CI) always takes the defaults.
const LUA_PATH = argValue('--lua') || path.join(ROOT, 'pz-mod/PanelBridge/media/lua/server/PanelBridge.lua');
const MANIFEST_PATH = argValue('--manifest') || path.join(__dirname, 'engine-signatures.manifest.json');

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error(`Missing ${path.relative(ROOT, MANIFEST_PATH)} -- run scripts/gen-engine-signatures.mjs (needs a local JDK) and commit its output.`);
  process.exit(1);
}
if (!fs.existsSync(LUA_PATH)) {
  console.error(`Missing ${path.relative(ROOT, LUA_PATH)}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const rawSrc = fs.readFileSync(LUA_PATH, 'utf8');

// Resolve using exactly the seeds the manifest was generated with -- not whatever
// SEED_GLOBALS/STATIC_CLASS_SEEDS happen to contain in this checkout's copy of the shared module.
// A seed added to the module since this manifest was generated has no javap data behind it yet;
// treating it as live here would silently resolve call sites against classes the manifest never
// actually covers.
for (const key of Object.keys(SEED_GLOBALS)) delete SEED_GLOBALS[key];
Object.assign(SEED_GLOBALS, manifest.seedGlobals || {});
for (const key of Object.keys(STATIC_CLASS_SEEDS)) delete STATIC_CLASS_SEEDS[key];
Object.assign(STATIC_CLASS_SEEDS, manifest.staticClassSeeds || {});

function classProvider(className, methodName) {
  const info = manifest.classes[className];
  if (!info) return null; // class not in the manifest -- unknown, not absent (see header comment)
  const sigs = info.methods[methodName];
  if (!sigs || sigs.length === 0) return { exists: false };
  return { exists: true, returnClass: sigs[0].returnClass, elementClass: sigs[0].elementClass };
}

const { callSites } = resolveAllCallSites(rawSrc, classProvider);

const resolved = callSites.filter((s) => s.resolved);
const unresolved = callSites.filter((s) => !s.resolved);
const absent = resolved.filter((s) => s.methodInfo && s.methodInfo.exists === false);
const staleClassLookups = resolved.filter((s) => s.methodInfo === null); // receiver type known, but not in manifest

const skipReasonCounts = new Map();
for (const s of unresolved) {
  skipReasonCounts.set(s.skipReason, (skipReasonCounts.get(s.skipReason) || 0) + 1);
}

console.log('=== engine signature check (scripts/check-engine-signatures.mjs) ===');
console.log(`manifest:              ${path.relative(ROOT, MANIFEST_PATH)} (generated ${manifest.generatedAt}, ${manifest.jarBasename})`);
console.log(`source:                ${path.relative(ROOT, LUA_PATH)}`);

const currentSha = crypto.createHash('sha256').update(rawSrc).digest('hex');
if (manifest.sourceFileSha256 && manifest.sourceFileSha256 !== currentSha) {
  console.log('');
  console.log('WARNING: PanelBridge.lua has changed since the manifest was generated.');
  console.log('  This does NOT fail the gate (regenerating needs a local JDK + the game jar, not');
  console.log('  available in CI) -- it means any NEW call site this edit introduced is checked only');
  console.log('  if it happens to reuse a class already in the manifest. Run');
  console.log('  `node scripts/gen-engine-signatures.mjs` locally and commit the refreshed manifest.');
}

console.log('');
console.log(`call sites found:      ${callSites.length}`);
console.log(`receivers resolved:    ${resolved.length}`);
console.log(`  of which in manifest:      ${resolved.length - staleClassLookups.length}`);
console.log(`  of which stale (class not in manifest, not checked): ${staleClassLookups.length}`);
console.log(`skipped (unresolved):  ${unresolved.length}`);
for (const [reason, count] of [...skipReasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${reason}`);
}
console.log(`ABSENT methods found:  ${absent.length}`);

if (absent.length > 0) {
  console.log('');
  console.log('DEFINITELY ABSENT (javap confirms no such method anywhere in the class chain):');
  for (const f of absent) {
    console.log(`  PanelBridge.lua:${f.line}  ${f.receiverExpr} (${f.receiverType}) has no ${f.methodName}()`);
  }
  console.log('');
  console.log(`FAIL: ${absent.length} definitively absent engine method call(s). See scripts/engine-signatures.manifest.json for the source of truth, and scripts/gen-engine-signatures.mjs's header for what "definitely absent" does and does not prove.`);
  process.exit(1);
}

console.log('');
console.log('PASS: no definitively absent engine method calls among the resolved call sites.');
process.exit(0);

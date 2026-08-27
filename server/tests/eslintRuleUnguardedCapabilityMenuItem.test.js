import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-unguarded-capability-menu-item.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("no-unguarded-capability-menu-item", () => {
  it("flags a capability-gated Radix item onClick with no matching early-return guard, and nothing else", () => {
    ruleTester.run("no-unguarded-capability-menu-item", rule, {
      valid: [
        // Native button, guard present and correct.
        "<Button disabled={!canModerate} onClick={() => { if (!canModerate) return; doThing() }} />",
        // Native button, guard present but tests something unrelated to capabilities (ordinary loading logic) -- not a mismatch.
        "<Button disabled={!canModerate} onClick={() => { if (loading) return; doThing() }} />",
        // Native button, disabled references no capability at all -- out of scope either way.
        "<Button disabled={loading} onClick={() => { if (somethingElse) return; doThing() }} />",
        // Guarded: first statement is `if (!canX) return`, same binding as disabled.
        "<DropdownMenuItem disabled={!canModerate} onClick={() => { if (!canModerate) return; doThing() }} />",
        // Guard can appear after other logic is skipped -- still first statement, negation via !.
        "<DropdownMenuItem disabled={loading || !canBridgeGmTools} onClick={() => { if (!canBridgeGmTools) return; handleGodMode(true) }} />",
        // Consequent as a block containing a return is still a guard.
        "<ContextMenuItem disabled={!canGmTools} onClick={() => { if (!canGmTools) { return } doThing() }} />",
        // A regular function expression, not just an arrow.
        "<SelectItem disabled={!canModerate} onClick={function () { if (!canModerate) return; doThing() }} />",
        // A native button with NO guard at all is never flagged -- disabled genuinely blocks the click for real.
        "<button disabled={!canModerate} onClick={() => doThing()} />",
        "<Button disabled={!canModerate} onClick={() => doThing()} />",
        // A Radix item with no disabled at all isn't this rule's concern.
        "<DropdownMenuItem onClick={() => doThing()} />",
        // disabled references no can*-named identifier -- not a capability check by this rule's heuristic.
        "<DropdownMenuItem disabled={loading} onClick={() => doThing()} />",
        // No onClick at all -- nothing to guard.
        "<DropdownMenuItem disabled={!canModerate} />",
        // onClick is a bare identifier reference -- can't verify locally, accepted gap, not flagged.
        "<DropdownMenuItem disabled={!canModerate} onClick={handleClick} />",
      ],
      invalid: [
        {
          code: "<DropdownMenuItem disabled={!canModerate} onClick={() => doThing()} />",
          errors: [{ messageId: "unguarded" }],
        },
        {
          // Expression-bodied arrow -- structurally has no room for a guard statement.
          code: "<DropdownMenuItem disabled={loading || !canGmTools} onClick={() => doThing()} />",
          errors: [{ messageId: "unguarded" }],
        },
        {
          // Block body, but the guard isn't the FIRST statement.
          code: "<ContextMenuItem disabled={!canModerate} onClick={() => { doOtherThing(); if (!canModerate) return; doThing() }} />",
          errors: [{ messageId: "unguarded" }],
        },
        {
          // First statement is an if, but it tests an unrelated condition.
          code: "<MenubarItem disabled={!canModerate} onClick={() => { if (loading) return; doThing() }} />",
          errors: [{ messageId: "unguarded" }],
        },
        {
          // If-test references the right binding but the consequent doesn't return.
          code: "<CommandItem disabled={!canModerate} onClick={() => { if (!canModerate) { doNothing() } doThing() }} />",
          errors: [{ messageId: "unguarded" }],
        },
        {
          // No guard at all, function expression form.
          code: "<SelectItem disabled={!canGmTools} onClick={function () { doThing() }} />",
          errors: [{ messageId: "unguarded" }],
        },
        {
          // Native button: guard present, but tests a DIFFERENT capability
          // than its own disabled prop -- Angela's Debug.tsx break-verify
          // shape, invisible to any click-through test since disabled
          // genuinely blocks a real click here.
          code: "<Button disabled={!canModerate} onClick={() => { if (!canGmTools) return; doThing() }} />",
          errors: [{ messageId: "mismatchedGuard" }],
        },
        {
          code: "<button disabled={!canModerate} onClick={() => { if (!canGmTools) return; doThing() }} />",
          errors: [{ messageId: "mismatchedGuard" }],
        },
      ],
    });
  });
});

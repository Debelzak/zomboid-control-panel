/**
 * Radix builds a non-native item primitive's click handler as
 * `composeEventHandlers(props.onClick, handleSelect)` -- the caller's
 * `onClick` runs UNCONDITIONALLY, first. The internal `disabled` check only
 * guards Radix's own select/close side effect, never the raw `onClick` prop.
 * So `disabled={!canX}` on a `DropdownMenuItem` (or `ContextMenuItem`,
 * `MenubarItem`, `SelectItem`, `CommandItem` -- all render a `<div>`, not a
 * `<button>`) is CSS (`pointer-events:none`) and unfocusability, not a
 * code-level gate. A style override, a programmatic click, or a refactor
 * that keeps the `disabled` expression but drops the attribute silently
 * restores access.
 *
 * A plain `<button disabled>` (native, or shadcn's `Button`, which forwards
 * `disabled` to a real native `<button>`) does not have this problem --
 * disabled native form controls dispatch no click, Enter, or Space
 * activation at all. That is WHY this rule deliberately does not flag
 * `<Button>`/`<button>`: demanding a redundant guard there would be noise
 * that gets the rule disabled. THE GUARD IS NEEDED EXACTLY WHERE THE
 * ELEMENT IS NOT A REAL BUTTON.
 *
 * Real case (2026-08-27, Players.tsx dossier "..." menu): six
 * `DropdownMenuItem`s gated on `disabled={... || !canModerate}` /
 * `!canGmTools` / `!canBridgeGmTools` with no guard inside `onClick` at all
 * -- Angela found the general shape reading Dashboard.tsx and
 * @radix-ui/react-menu's own source (not inferred), Pam had it live on
 * Players.tsx. Fixed by adding `if (!canX) return` as the first line of
 * each `onClick` body -- the same two-layer pattern (attribute = affordance,
 * function guard = the actual gate) already used for a keyboard-shortcut
 * bypass on Console.tsx. This rule makes a future omission of that guard
 * unwritable rather than relying on someone re-reading Radix's source again.
 *
 * === THE HEURISTIC, AND WHY IT STAYS MECHANICAL ===
 *
 * "A capability binding" is defined PURELY BY NAME: an `Identifier` whose
 * name matches `/^can[A-Z]/` (canModerate, canGmTools, canBridgeCommand,
 * canBridgeGmTools, canRestartNow, canControlServer, ...). This is not a
 * guess -- every capability boolean in this codebase (28 call sites across
 * 16 pages, checked 2026-08-27 before writing this rule) is a `const can*`
 * bound from `useAuth().can(...)`, and nothing else in the tree is named
 * that way. The rule never resolves what a `can*` identifier actually IS
 * (no scope/type analysis, no cross-file lookup) -- it only compares two
 * expressions ON THE SAME JSX ELEMENT by the names appearing in them, which
 * is exactly the "mechanical, not cross-file inference" shape this floor
 * has been willing to ship rules for tonight.
 *
 * A violation requires ALL of:
 *   1. The JSX element's tag name is one of RADIX_ITEM_COMPONENTS.
 *   2. It has a `disabled={...}` expression container that references at
 *      least one `can*`-named identifier anywhere in its expression tree
 *      (through `!`, `&&`, `||`, ternaries, and call arguments).
 *   3. It has an `onClick={...}` expression container whose value is an
 *      inline arrow/function expression (see gap below for anything else).
 *   4. That function's body is NOT a block whose FIRST statement is an
 *      `if (...)` testing at least one of the SAME `can*` names found in
 *      (2), with a consequent that returns (a bare `return`, or a block
 *      containing one).
 *
 * === KNOWN GAPS, ACCEPTED RATHER THAN CHASED (same policy as this
 * directory's other rules) ===
 *
 *   - `onClick={someNamedHandler}` (a bare identifier reference, rather
 *     than an inline function) is NOT analyzed -- the guard might live
 *     inside that function, defined elsewhere, and confirming that would
 *     require resolving the binding across scope, which is exactly the
 *     cross-file inference this rule is built to avoid. No real site in
 *     this codebase uses that shape for a gated menu item as of landing
 *     (every one is an inline arrow) -- if one appears, it silently passes.
 *   - Direct `can('capability.name')` calls inlined into `disabled`
 *     (instead of a precomputed `const canX = can(...)`) are invisible to
 *     this rule -- the `/^can[A-Z]/` name check does not match a bare
 *     lowercase `can` call. Every gated site in this codebase precomputes
 *     the boolean as of landing; if that convention is ever broken, this
 *     rule will not catch it.
 *   - A guard whose `if` test references a DIFFERENT `can*` name than the
 *     one(s) in `disabled` (rather than none at all) is accepted as
 *     "guarded" as long as the two name-sets overlap at all -- the rule
 *     does not require the sets to match exactly. A `disabled={!canA ||
 *     !canB}` guarded only by `if (!canA) return` passes here even though
 *     `canB` alone could still let the click through. No real site combines
 *     two capability names in one `disabled` as of landing.
 *   - Only `DropdownMenuItem`, `ContextMenuItem`, `MenubarItem`,
 *     `SelectItem`, `CommandItem` are checked -- any other Radix
 *     non-native item primitive (a checkbox/radio item variant, a custom
 *     wrapper around one) is invisible unless added to
 *     RADIX_ITEM_COMPONENTS below.
 */

const RADIX_ITEM_COMPONENTS = new Set([
  "DropdownMenuItem",
  "ContextMenuItem",
  "MenubarItem",
  "SelectItem",
  "CommandItem",
]);

const CAPABILITY_NAME = /^can[A-Z]/;

function findAttribute(attributes, name) {
  return attributes.find(
    (attr) => attr.type === "JSXAttribute" && attr.name.type === "JSXIdentifier" && attr.name.name === name,
  );
}

// Walks a JS expression's own subtree (never crossing into a nested
// function's body) collecting every Identifier name matching CAPABILITY_NAME.
function collectCapabilityNames(node, out) {
  if (!node || typeof node.type !== "string") return;
  switch (node.type) {
    case "Identifier":
      if (CAPABILITY_NAME.test(node.name)) out.add(node.name);
      return;
    case "UnaryExpression":
      collectCapabilityNames(node.argument, out);
      return;
    case "LogicalExpression":
    case "BinaryExpression":
      collectCapabilityNames(node.left, out);
      collectCapabilityNames(node.right, out);
      return;
    case "ConditionalExpression":
      collectCapabilityNames(node.test, out);
      collectCapabilityNames(node.consequent, out);
      collectCapabilityNames(node.alternate, out);
      return;
    case "CallExpression":
      for (const arg of node.arguments) collectCapabilityNames(arg, out);
      return;
    case "ParenthesizedExpression":
      collectCapabilityNames(node.expression, out);
      return;
    default:
      return;
  }
}

function consequentReturns(node) {
  if (!node) return false;
  if (node.type === "ReturnStatement") return true;
  if (node.type === "BlockStatement") {
    return node.body.some((stmt) => stmt.type === "ReturnStatement");
  }
  return false;
}

// True when `fn`'s body opens with `if (<references one of capabilityNames>)
// return...` -- the two-layer guard this rule requires.
function isGuardedAtEntry(fn, capabilityNames) {
  if (fn.body.type !== "BlockStatement") return false;
  const first = fn.body.body[0];
  if (!first || first.type !== "IfStatement") return false;

  const testNames = new Set();
  collectCapabilityNames(first.test, testNames);
  const overlaps = [...testNames].some((name) => capabilityNames.has(name));
  if (!overlaps) return false;

  return consequentReturns(first.consequent);
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Flag a capability-gated Radix menu-item primitive (DropdownMenuItem/ContextMenuItem/MenubarItem/SelectItem/CommandItem) whose onClick does not start with an early return on that same capability -- Radix runs onClick regardless of disabled for these non-native items",
    },
    schema: [],
    messages: {
      unguarded:
        "This {{tag}} is disabled on {{bindings}}, but Radix runs a menu item's onClick unconditionally -- the disabled attribute is CSS/unfocusability here, not a code-level gate (it renders a <div>, not a native <button>). Add `if (!{{firstBinding}}) return` as the first line of the onClick body, matching the two-layer guard pattern already used elsewhere (see this rule's file header).",
    },
  },

  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || !RADIX_ITEM_COMPONENTS.has(node.name.name)) return;

        const disabledAttr = findAttribute(node.attributes, "disabled");
        if (!disabledAttr || !disabledAttr.value || disabledAttr.value.type !== "JSXExpressionContainer") return;

        const capabilityNames = new Set();
        collectCapabilityNames(disabledAttr.value.expression, capabilityNames);
        if (capabilityNames.size === 0) return;

        const onClickAttr = findAttribute(node.attributes, "onClick");
        if (!onClickAttr || !onClickAttr.value || onClickAttr.value.type !== "JSXExpressionContainer") return;

        const onClickExpr = onClickAttr.value.expression;
        if (onClickExpr.type !== "ArrowFunctionExpression" && onClickExpr.type !== "FunctionExpression") return;

        if (isGuardedAtEntry(onClickExpr, capabilityNames)) return;

        const bindings = [...capabilityNames];
        context.report({
          node: onClickAttr,
          messageId: "unguarded",
          data: {
            tag: node.name.name,
            bindings: bindings.map((name) => `!${name}`).join(" / "),
            firstBinding: bindings[0],
          },
        });
      },
    };
  },
};

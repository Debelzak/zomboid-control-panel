/**
 * The 2026-08-26 errorMessage.ts coverage audit found `getUserErrorMessage()`
 * (client/src/lib/errorMessage.ts) imported by only 6 of 22 pages -- the
 * other ~100+ call sites show a caught error's raw `.message` directly in a
 * toast or an inline error state, discarding any translated text and any
 * recovery link a registered error code would otherwise provide. Converting
 * the existing sites doesn't stop the 101st one someone writes next week;
 * this rule is the structural half.
 *
 * Flags the `x instanceof Error ? x.message : fallback` shape (the idiom
 * every real site used) ONLY when it is feeding a value a user will actually
 * see: the direct argument to `toast(...)`, or the direct argument to a
 * `set...(...)` state-setter call (the `setDetectError(...)`/`setBridgeError(
 * ...)` pattern). This is deliberately narrower than "every occurrence of
 * this shape anywhere" -- the audit's own findings ("bucket C") show some
 * uses are legitimate (errorMessage.ts's own getRecoveryUrl() builds this
 * exact string to pattern-match against, not to display; client-errors.ts
 * builds it for a diagnostic payload sent to the server, where the raw text
 * is exactly what you want). Scoping to the toast()/setState() call sites
 * catches every real display site found in the audit while leaving those two
 * legitimate uses alone with no file-level exemption needed -- neither is the
 * direct argument of a toast() or set*() call.
 *
 * Known limitation, accepted rather than chased: a two-step
 * `const msg = x instanceof Error ? x.message : y; toast({ description: msg
 * })` is NOT caught (this rule doesn't trace variable flow across
 * statements). Every real site the audit found used the direct-argument
 * shape; this covers the shape that actually appears, not a theoretical
 * superset.
 *
 * THE FIX IS THE SAME CALL EVERYWHERE, INCLUDING "BUCKET C" SITES: replace
 * the ternary with `getUserErrorMessage(error, fallback)`. That function
 * already falls through to the identical raw message when no error code
 * matches (see its own body), so a self-contained-validation-text site with
 * no code and no sensible recovery link (the audit's "bucket C") shows
 * byte-identical text either way -- there is no real site the audit found
 * where the plain ternary is actually better. A genuinely exceptional site
 * that needs the old raw behavior on purpose should call errorMessage.ts's
 * `rawErrorMessageIntentional(error, fallback)` instead of eslint-disabling
 * this rule -- same behavior, but the exemption is a named, greppable
 * function call in the diff, not a comment that hides the decision. Neither
 * call is a ConditionalExpression, so this rule's selector doesn't match
 * either one -- no separate file-level exemption is needed for them.
 */

function isSameErrorMessageTernary(node) {
  if (node.type !== "ConditionalExpression") return false;
  const { test, consequent } = node;
  if (test.type !== "BinaryExpression" || test.operator !== "instanceof") {
    return false;
  }
  if (test.left.type !== "Identifier" || test.right.type !== "Identifier") {
    return false;
  }
  if (test.right.name !== "Error") return false;

  const member =
    consequent.type === "ChainExpression" ? consequent.expression : consequent;
  if (!member || member.type !== "MemberExpression") return false;
  if (member.property.type !== "Identifier" || member.property.name !== "message") {
    return false;
  }
  if (member.object.type !== "Identifier") return false;

  return member.object.name === test.left.name;
}

// True when `node` (the ternary) is the value a user-visible sink will
// receive: the sole/only argument of a `setXxx(...)` call, or a property
// value inside the object literal that is `toast(...)`'s argument. Walks a
// short, bounded ancestor chain rather than the whole function body -- this
// shape is always one or two levels deep in every real site found.
function isFeedingUserVisibleSink(node) {
  let current = node;
  for (let depth = 0; depth < 4 && current.parent; depth += 1) {
    const parent = current.parent;

    if (parent.type === "CallExpression" && parent.callee.type === "Identifier") {
      if (/^set[A-Z]/.test(parent.callee.name) && parent.arguments.includes(current)) {
        return true;
      }
      if (parent.callee.name === "toast" && parent.arguments.includes(current)) {
        return true;
      }
    }

    // Keep walking through the Property -> ObjectExpression -> CallExpression
    // chain that `toast({ description: <ternary> })` produces, but stop at
    // any other boundary (a different call, a function body, a statement) --
    // this is intentionally shallow, not a general data-flow search.
    if (
      parent.type === "Property" ||
      parent.type === "ObjectExpression" ||
      parent.type === "ChainExpression"
    ) {
      current = parent;
      continue;
    }

    return false;
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow showing a caught error's raw .message directly in a toast or error state; use getUserErrorMessage() so a registered error code's translation and recovery link aren't silently discarded",
    },
    schema: [],
    messages: {
      rawMessage:
        "This shows the raw, untranslated error text directly, discarding any translated message or recovery link getUserErrorMessage() (lib/errorMessage.ts) would provide for a coded error -- and it behaves identically to that call when no code exists, so there's no downside to switching. If this is a genuinely exceptional site where the raw behavior is intentional, call rawErrorMessageIntentional(error, fallback) (also in lib/errorMessage.ts) instead of this ternary to make that exemption explicit.",
    },
  },

  create(context) {
    return {
      ConditionalExpression(node) {
        if (!isSameErrorMessageTernary(node)) return;
        if (!isFeedingUserVisibleSink(node)) return;
        context.report({ node, messageId: "rawMessage" });
      },
    };
  },
};

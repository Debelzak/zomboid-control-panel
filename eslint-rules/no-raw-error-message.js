/**
 * The 2026-08-26 errorMessage.ts coverage audit found `getUserErrorMessage()`
 * (client/src/lib/errorMessage.ts) imported by only 6 of 22 pages -- the
 * other ~100+ call sites show a caught error's raw `.message` directly in a
 * toast or an inline error state, discarding any translated text and any
 * recovery link a registered error code would otherwise provide. Converting
 * the existing sites doesn't stop the 101st one someone writes next week;
 * this rule is the structural half.
 *
 * THREE SYNTAXES FOUND SO FAR, NOT ONE -- each found from a real site, each
 * time after the previous count had already been treated as complete:
 *   1. `x instanceof Error ? x.message : fallback` (isSameErrorMessageTernary)
 *   2. `x?.message || fallback` / `x.message || fallback` (isRawMessageLogicalOr,
 *      found by Kevin converting Mods.tsx -- the ternary-only count from the
 *      original audit was correct for shape 1 and silent about this one)
 *   3. a bare `x.message` / `x?.message` with NO fallback at all
 *      (isBareErrorMessageAccess, found sweeping ChunkCleaner.tsx for a third
 *      shape after god asked whether one existed -- worse than shapes 1/2
 *      since an empty/undefined .message shows nothing at all, not even a
 *      generic fallback)
 * A rule matching only a subset would have DECLARED A FILE CLEAN while the
 * others kept getting written -- worse than no rule, since a green lint gate
 * is a positive claim the pattern is gone. Treat the true population of
 * "a caught error's raw message reaches the user outside getUserErrorMessage()"
 * as LARGER than these three shapes catch, not as fully enumerated by them --
 * this is what's been found so far, not a closed set. If a fourth turns up,
 * add it here rather than assuming three is now complete either.
 *
 * All three are flagged ONLY when feeding a value a user will actually see:
 * the direct argument to `toast(...)`, or the direct argument to a
 * `set...(...)` state-setter call (including the `setX(prev => ({ ...prev,
 * error: <node> }))` functional-update shape real sites used). This is
 * deliberately narrower than "any of these shapes anywhere" -- the audit's
 * own findings ("bucket C") show some uses are legitimate (errorMessage.ts's
 * own getRecoveryUrl() builds the ternary shape to pattern-match against,
 * not to display; client-errors.ts builds it for a diagnostic payload sent
 * to the server, where the raw text is exactly what you want; `result.message`
 * / `data.message` read a normal API response field, not a caught error, and
 * are common enough that shapes 2 and 3 restrict their identifier to common
 * error-variable names below rather than matching any `.message`). Scoping
 * to the two real sinks catches every genuine display site while leaving the
 * legitimate uses alone with no file-level exemption needed -- none of them
 * is a toast()/set*() argument.
 *
 * Known limitation, accepted rather than chased: a two-step
 * `const msg = x instanceof Error ? x.message : y; toast({ description: msg
 * })` is NOT caught (this rule doesn't trace variable flow across
 * statements). Every real site found used the direct-argument shape; this
 * covers the shapes that actually appear, not a theoretical superset.
 *
 * THE FIX IS THE SAME CALL EVERYWHERE, INCLUDING "BUCKET C" SITES: replace
 * any of the three shapes with `getUserErrorMessage(error, fallback)`. That
 * function already falls through to the identical raw message when no error
 * code matches (see its own body), so a self-contained-validation-text site
 * with no code and no sensible recovery link (the audit's "bucket C") shows
 * byte-identical text either way -- there is no real site found where any
 * raw shape is actually better. A genuinely exceptional site that needs the
 * old raw behavior on purpose should call errorMessage.ts's
 * `rawErrorMessageIntentional(error, fallback)` instead of eslint-disabling
 * this rule -- same behavior, but the exemption is a named, greppable
 * function call in the diff, not a comment that hides the decision. That
 * call doesn't match any of the three shapes below, so this rule's selectors
 * don't match it -- no separate file-level exemption is needed for it.
 */

// Real error-catch variable names seen across this codebase for shape 2
// (`x.message || fallback`), which has no structural signal as strong as
// shape 1's `instanceof Error` check -- `result.message`, `data.message`,
// `res.message`, `backupProgress.message` etc. are common, legitimate reads
// of a normal API response/progress payload field, not a caught error, and
// must not be flagged. This is a heuristic, not a closed set: a caught
// error bound to a name outside this list is a known blind spot, same
// category as the two-step-assignment limitation above.
const ERROR_LIKE_IDENTIFIER_RE =
  /^(?:err|error|e|ex|exception|apiErr|caughtError|thrownError)$/i;

function unwrapChain(node) {
  return node && node.type === "ChainExpression" ? node.expression : node;
}

function isMessageMemberOf(node, objectName) {
  const member = unwrapChain(node);
  if (!member || member.type !== "MemberExpression") return false;
  if (member.property.type !== "Identifier" || member.property.name !== "message") {
    return false;
  }
  if (member.object.type !== "Identifier") return false;
  return objectName === undefined || member.object.name === objectName;
}

// Shape 1: `x instanceof Error ? x.message : fallback`.
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

  return isMessageMemberOf(consequent, test.left.name);
}

// Shape 2: `x?.message || fallback` / `x.message || fallback`, x restricted
// to a common error-variable name (see ERROR_LIKE_IDENTIFIER_RE above).
function isRawMessageLogicalOr(node) {
  if (node.type !== "LogicalExpression" || node.operator !== "||") return false;
  const member = unwrapChain(node.left);
  if (!member || member.type !== "MemberExpression") return false;
  if (member.property.type !== "Identifier" || member.property.name !== "message") {
    return false;
  }
  if (member.object.type !== "Identifier") return false;
  return ERROR_LIKE_IDENTIFIER_RE.test(member.object.name);
}

// Shape 3: a bare `x.message` / `x?.message` with no fallback at all --
// worse than shapes 1/2 (an empty or undefined .message shows nothing,
// not even a generic string), same identifier restriction as shape 2.
// Visited directly as MemberExpression: espree/typescript-eslint parse
// `x?.message` as ChainExpression > MemberExpression, so the traversal
// reaches this exact node either way, optional or not.
function isBareErrorMessageAccess(node) {
  if (node.type !== "MemberExpression") return false;
  if (node.property.type !== "Identifier" || node.property.name !== "message") {
    return false;
  }
  if (node.object.type !== "Identifier") return false;
  return ERROR_LIKE_IDENTIFIER_RE.test(node.object.name);
}

// True when `node` (the ternary or the logical-OR expression) is the value
// a user-visible sink will receive: the sole/only argument of a `setXxx(
// ...)` call (directly, or through an implicit-return `prev => ({ ...prev,
// error: <node> })` functional updater -- the shape setCollectionStatus/
// setDepSearchData sites actually used), or a property value inside the
// object literal that is `toast(...)`'s argument. Walks a bounded ancestor
// chain rather than the whole function body -- every real site found is
// within this depth, this is intentionally shallow, not a general
// data-flow search.
function isFeedingUserVisibleSink(node) {
  let current = node;
  for (let depth = 0; depth < 8 && current.parent; depth += 1) {
    const parent = current.parent;

    if (parent.type === "CallExpression" && parent.callee.type === "Identifier") {
      if (/^set[A-Z]/.test(parent.callee.name) && parent.arguments.includes(current)) {
        return true;
      }
      if (parent.callee.name === "toast" && parent.arguments.includes(current)) {
        return true;
      }
    }

    // Keep walking through the Property -> ObjectExpression chain that both
    // `toast({ description: <node> })` and a nested functional-update object
    // (`{ ...prev, error: <node> }`, possibly nested again under a computed
    // key) produce.
    if (
      parent.type === "Property" ||
      parent.type === "ObjectExpression" ||
      parent.type === "ChainExpression"
    ) {
      current = parent;
      continue;
    }

    // `setX(prev => ({ ...prev, error: <node> }))` -- an implicit-return
    // arrow function body sits between the object literal and the set*()
    // call it's the sole argument of.
    if (parent.type === "ArrowFunctionExpression" && parent.body === current) {
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
        "Disallow showing a caught error's raw .message directly (via a ternary or a `|| fallback`) in a toast or error state; use getUserErrorMessage() so a registered error code's translation and recovery link aren't silently discarded",
    },
    schema: [],
    messages: {
      rawMessage:
        "This shows the raw, untranslated error text directly, discarding any translated message or recovery link getUserErrorMessage() (lib/errorMessage.ts) would provide for a coded error -- and it behaves identically to that call when no code exists, so there's no downside to switching. If this is a genuinely exceptional site where the raw behavior is intentional, call rawErrorMessageIntentional(error, fallback) (also in lib/errorMessage.ts) instead of this expression to make that exemption explicit.",
    },
  },

  create(context) {
    return {
      ConditionalExpression(node) {
        if (!isSameErrorMessageTernary(node)) return;
        if (!isFeedingUserVisibleSink(node)) return;
        context.report({ node, messageId: "rawMessage" });
      },
      LogicalExpression(node) {
        if (!isRawMessageLogicalOr(node)) return;
        if (!isFeedingUserVisibleSink(node)) return;
        context.report({ node, messageId: "rawMessage" });
      },
      MemberExpression(node) {
        if (!isBareErrorMessageAccess(node)) return;
        if (!isFeedingUserVisibleSink(node)) return;
        context.report({ node, messageId: "rawMessage" });
      },
    };
  },
};

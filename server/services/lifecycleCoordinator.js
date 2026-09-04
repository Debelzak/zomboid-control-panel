export const LIFECYCLE_IN_PROGRESS_CODE = "SERVER_LIFECYCLE_IN_PROGRESS";

let activeLock = null;
let nextLockId = 0;

export function acquireLifecycleLock(operation = "lifecycle") {
  if (activeLock) return null;

  const token = {
    id: ++nextLockId,
    operation: String(operation || "lifecycle"),
  };
  activeLock = token;
  let released = false;

  return {
    operation: token.operation,
    release() {
      if (released) return;
      released = true;
      if (activeLock === token) activeLock = null;
    },
  };
}

export function lifecycleInProgressResponse() {
  return {
    error: "Another server lifecycle operation is already in progress",
    code: LIFECYCLE_IN_PROGRESS_CODE,
  };
}

export function isLifecycleLocked() {
  return activeLock !== null;
}

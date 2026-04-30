/**
 * Workshop Collection Sync
 * ------------------------
 * Mirrors the panel's tracked-mod list into a user-owned Steam Workshop
 * collection so admins don't have to maintain two lists by hand.
 *
 * How it works
 * ------------
 * Reading collection contents is public (Steam Web API).
 * Adding / removing items requires the user's logged-in Steam *session*
 * (cookies `sessionid` + `steamLoginSecure`). Steam has no public OAuth
 * for this; the website uses the same cookie pair we ask the user to paste.
 *
 * Security note
 * -------------
 * `steamLoginSecure` is effectively a Steam login token. Treat it like a
 * password: never log it, mask it in API responses (see config.js
 * SENSITIVE_KEYS). Storage is plaintext in db.json — same trust level as
 * the RCON password.
 */

import { createLogger } from '../utils/logger.js';
import { getSetting } from '../database/init.js';

const log = createLogger('WorkshopCollectionSync');

const STEAM_COMMUNITY = 'https://steamcommunity.com';
const STEAM_API = 'https://api.steampowered.com';
const USER_AGENT = 'ZomboidControlPanel/1.0 (+collection-sync)';
const FETCH_TIMEOUT_MS = 15000;

function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function isValidWorkshopId(id) {
  return typeof id === 'string' && /^\d{1,15}$/.test(id);
}

/**
 * Fetch a public Workshop collection's child items.
 * No credentials required — uses the public ISteamRemoteStorage endpoint.
 * Returns { ok, items: string[], title, error }.
 */
export async function getCollectionContents(collectionId) {
  if (!isValidWorkshopId(collectionId)) {
    return { ok: false, items: [], error: 'Invalid collection ID' };
  }
  try {
    const body = new URLSearchParams();
    body.set('collectioncount', '1');
    body.set('publishedfileids[0]', collectionId);
    const res = await fetchWithTimeout(`${STEAM_API}/ISteamRemoteStorage/GetCollectionDetails/v1/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: body.toString(),
    });
    if (!res.ok) {
      return { ok: false, items: [], error: `Steam API HTTP ${res.status}` };
    }
    const json = await res.json();
    const detail = json?.response?.collectiondetails?.[0];
    if (!detail) {
      return { ok: false, items: [], error: 'Empty Steam response' };
    }
    if (Number(detail.result) !== 1) {
      return { ok: false, items: [], error: `Steam result code ${detail.result}` };
    }
    const items = Array.isArray(detail.children)
      ? detail.children.map((c) => String(c.publishedfileid))
      : [];
    return { ok: true, items, title: detail.title || null };
  } catch (err) {
    return { ok: false, items: [], error: err.message || 'Network error' };
  }
}

/**
 * Build the cookie header from settings. Returns null if either piece is missing.
 */
async function buildAuthCookies() {
  const sessionId = await getSetting('steamSessionId');
  const loginSecure = await getSetting('steamLoginSecure');
  if (typeof sessionId !== 'string' || sessionId.trim().length < 8) return null;
  if (typeof loginSecure !== 'string' || loginSecure.trim().length < 16) return null;
  const sid = sessionId.trim();
  const tok = loginSecure.trim();
  // Defence in depth: reject values containing CR/LF or other control
  // characters that would split the Cookie header. These can never appear
  // in a real Steam cookie, so any presence indicates corruption or abuse.
  if (/[\r\n\0;]/.test(sid) || /[\r\n\0;]/.test(tok)) {
    log.warn('Refusing to build cookie header: control character in stored value');
    return null;
  }
  return {
    sessionId: sid,
    cookie: `sessionid=${sid}; steamLoginSecure=${tok}`,
  };
}

/**
 * POST to a /sharedfiles/<action> endpoint. Steam returns either JSON
 * `{ success: 1 }` or HTML — both are handled.
 */
async function postSharedfilesAction(action, collectionId, childId) {
  const auth = await buildAuthCookies();
  if (!auth) {
    return { ok: false, error: 'Steam session cookies not configured' };
  }
  if (!isValidWorkshopId(collectionId) || !isValidWorkshopId(childId)) {
    return { ok: false, error: 'Invalid Workshop ID' };
  }
  const body = new URLSearchParams();
  body.set('id', collectionId);
  body.set('childid', childId);
  body.set('sessionid', auth.sessionId);

  try {
    const res = await fetchWithTimeout(`${STEAM_COMMUNITY}/sharedfiles/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        'Cookie': auth.cookie,
        'Referer': `${STEAM_COMMUNITY}/sharedfiles/filedetails/?id=${collectionId}`,
        'Origin': STEAM_COMMUNITY,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
      redirect: 'manual',
    });

    // Steam responds 302 to the login page when cookies are bad.
    if (res.status === 302 || res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Steam session expired — paste fresh cookies' };
    }
    if (!res.ok) {
      return { ok: false, error: `Steam HTTP ${res.status}` };
    }
    const text = await res.text();
    // The endpoint usually returns `{"success":1}` for AJAX-style requests.
    try {
      const json = JSON.parse(text);
      if (json && (json.success === 1 || json.success === true)) {
        return { ok: true };
      }
      return { ok: false, error: json?.error || 'Steam returned non-success' };
    } catch {
      // Sometimes it returns HTML (full page) on success too. If we see the
      // child id reflected back, treat as success; otherwise fail loudly.
      if (text.includes(childId)) {
        return { ok: true };
      }
      return { ok: false, error: 'Steam returned unexpected response' };
    }
  } catch (err) {
    return { ok: false, error: err.message || 'Network error' };
  }
}

export function addItemToCollection(collectionId, childId) {
  return postSharedfilesAction('addchild', collectionId, childId);
}

export function removeItemFromCollection(collectionId, childId) {
  return postSharedfilesAction('removechild', collectionId, childId);
}

/**
 * Compute the diff between the tracked-mod list and the collection.
 * Does NOT mutate anything.
 */
export async function computeDiff(trackedWorkshopIds) {
  const collectionId = await getSetting('workshopCollectionId');
  if (!isValidWorkshopId(collectionId)) {
    return { ok: false, error: 'Collection ID not configured', toAdd: [], toRemove: [], inCollection: [] };
  }
  const collection = await getCollectionContents(collectionId);
  if (!collection.ok) {
    return { ok: false, error: collection.error, toAdd: [], toRemove: [], inCollection: [] };
  }
  const trackedSet = new Set(trackedWorkshopIds.map(String));
  const collectionSet = new Set(collection.items);
  const toAdd = [...trackedSet].filter((id) => !collectionSet.has(id));
  const toRemove = [...collectionSet].filter((id) => !trackedSet.has(id));
  return {
    ok: true,
    title: collection.title,
    inCollection: [...collectionSet],
    toAdd,
    toRemove,
  };
}

/**
 * Auto-sync hook — called after track / untrack operations. Best-effort:
 * never throws, always logs. Skips entirely if auto-sync is disabled or
 * credentials aren't set.
 */
export async function syncSingleChange(action, workshopId) {
  try {
    if (!isValidWorkshopId(String(workshopId))) return { skipped: true, reason: 'invalid id' };
    const enabled = await getSetting('workshopCollectionAutoSync');
    if (!enabled) return { skipped: true, reason: 'auto-sync disabled' };
    const collectionId = await getSetting('workshopCollectionId');
    if (!isValidWorkshopId(collectionId)) return { skipped: true, reason: 'no collection id' };
    const auth = await buildAuthCookies();
    if (!auth) return { skipped: true, reason: 'no credentials' };

    const fn = action === 'add' ? addItemToCollection : removeItemFromCollection;
    const result = await fn(collectionId, String(workshopId));
    if (result.ok) {
      log.info(`Auto-sync ${action} ${workshopId} \u2192 collection ${collectionId} OK`);
    } else {
      log.warn(`Auto-sync ${action} ${workshopId} \u2192 collection ${collectionId} failed: ${result.error}`);
    }
    return result;
  } catch (err) {
    log.error(`Auto-sync ${action} ${workshopId} crashed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

import cron from "node-cron";

// 2026-08-29, timezone-picker card: whether Intl (and therefore node-cron,
// which resolves its own timezone option through the same Intl machinery --
// see node_modules/node-cron/dist/_shared.js's getPartsFormatter) will
// actually accept `tz` as a real IANA zone name. Construction throwing a
// RangeError is the canonical way to ask this -- it is the exact check that
// determines whether cron.schedule(expr, cb, { timezone: tz }) will work at
// schedule time, so there is no meaningful gap between "this function says
// valid" and "node-cron accepts it." Deliberately NOT built on
// Intl.supportedValuesOf('timeZone') (Node 18+): that list is narrower than
// what the constructor accepts (it omits some valid legacy/alias names
// Intl still resolves correctly), so using it here would reject values a
// real install could have been using safely for years.
export function isValidIanaTimezone(tz) {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function hasUnsupportedCronFieldCount(expression) {
  return (
    typeof expression !== "string" ||
    expression.trim().split(/\s+/).length !== 5
  );
}

export function isSupportedFiveFieldCron(expression) {
  return (
    !hasUnsupportedCronFieldCount(expression) && cron.validate(expression)
  );
}

function expandMinuteField(field) {
  const values = new Set();

  for (const part of field.split(",")) {
    const match = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part);
    if (!match) return null;

    const start = match[1] === "*" ? 0 : Number(match[1]);
    const end = match[2] === undefined
      ? (match[1] === "*" ? 59 : start)
      : Number(match[2]);
    const step = match[3] === undefined ? 1 : Number(match[3]);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      !Number.isInteger(step) ||
      start < 0 ||
      end > 59 ||
      start > end ||
      step < 1
    ) {
      return null;
    }

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  return values.size > 0 ? values : null;
}

export function isCronTooFrequent(expression) {
  if (hasUnsupportedCronFieldCount(expression)) return true;
  const [minute, hour] = expression.trim().split(/\s+/);

  const values = expandMinuteField(minute);
  if (!values) return true;
  const sorted = [...values].sort((left, right) => left - right);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] - sorted[index - 1] < 5) return true;
  }
  if (hour === "*" && sorted.length >= 2) {
    const wrap = 60 - sorted[sorted.length - 1] + sorted[0];
    if (wrap < 5) return true;
  }

  return false;
}
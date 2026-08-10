import { randomUUID } from "crypto";
import { getSetting, setSetting } from "../database/init.js";

const SETTINGS_KEY = "backupRecords";
const MAX_RECORDS = 500;

async function readRecords() {
  const records = await getSetting(SETTINGS_KEY);
  return Array.isArray(records) ? records : [];
}

async function saveRecords(records) {
  await setSetting(SETTINGS_KEY, records.slice(0, MAX_RECORDS));
}

export async function addBackupRecord({ backup, server, snapshot }) {
  const records = await readRecords();
  const record = {
    id: randomUUID(),
    fileName: backup.name,
    createdAt: backup.created,
    size: backup.size,
    serverId: server?.id ?? null,
    serverName: server?.serverName || "server",
    snapshot: snapshot || null,
  };
  records.unshift(record);
  await saveRecords(records);
  return record;
}

export async function listBackupRecords({ serverId, limit } = {}) {
  let records = await readRecords();
  if (serverId != null) {
    records = records.filter((record) => String(record.serverId) === String(serverId));
  }
  records = [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return Number.isInteger(limit) && limit > 0 ? records.slice(0, limit) : records;
}

export async function removeBackupRecord(fileName) {
  const records = await readRecords();
  await saveRecords(records.filter((record) => record.fileName !== fileName));
}

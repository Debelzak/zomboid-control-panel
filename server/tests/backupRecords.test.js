import { beforeEach, describe, expect, it, vi } from "vitest";

const getSetting = vi.fn();
const setSetting = vi.fn();

vi.mock("../database/init.js", () => ({ getSetting, setSetting }));

const { addBackupRecord, listBackupRecords, removeBackupRecord } =
  await import("../services/backupRecords.js");

beforeEach(() => {
  getSetting.mockReset();
  setSetting.mockReset();
});

describe("backup records", () => {
  it("stores server identity and a safe snapshot with each archive", async () => {
    getSetting.mockResolvedValue([]);
    const record = await addBackupRecord({
      backup: { name: "DoomerZ_2026.zip", created: "2026-08-10T00:00:00.000Z", size: 42 },
      server: { id: "server-1", serverName: "DoomerZ" },
      snapshot: { schemaVersion: 1, serverIni: { PVP: "false" } },
    });

    expect(record).toMatchObject({ fileName: "DoomerZ_2026.zip", serverId: "server-1", serverName: "DoomerZ" });
    expect(setSetting).toHaveBeenCalledWith("backupRecords", [expect.objectContaining({ id: record.id })]);
  });

  it("filters history by server and removes records with their archive", async () => {
    getSetting.mockResolvedValue([
      { fileName: "a.zip", serverId: "one", createdAt: "2026-08-10T00:00:00.000Z" },
      { fileName: "b.zip", serverId: "two", createdAt: "2026-08-09T00:00:00.000Z" },
    ]);

    await expect(listBackupRecords({ serverId: "one" })).resolves.toEqual([
      expect.objectContaining({ fileName: "a.zip" }),
    ]);
    await removeBackupRecord("a.zip");
    expect(setSetting).toHaveBeenLastCalledWith("backupRecords", [
      expect.objectContaining({ fileName: "b.zip" }),
    ]);
  });
});

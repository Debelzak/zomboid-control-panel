import { beforeEach, describe, expect, it, vi } from "vitest";

// Lockout rules 1-3 (rule 4 is the migration itself, covered by
// rolesMigration.test.js). Rule 1 is a CAPABILITY check, not a role-name
// check -- these tests exercise it against roles.manage/users.manage
// directly, including via a second role that also grants the capability,
// to prove it isn't hardcoded to the name "admin".

const rolesById = new Map();
let users = [];

function seedRole(id, name, capabilities) {
  rolesById.set(id, { id, name, capabilities, isSeeded: false });
}

vi.mock("../database/init.js", () => ({
  getRoles: async () => Array.from(rolesById.values()),
  getRoleById: async (id) => rolesById.get(String(id)) || null,
  getRoleByName: async (name) =>
    Array.from(rolesById.values()).find((r) => r.name === name) || null,
  insertRole: async (role) => {
    rolesById.set(role.id, role);
    return role;
  },
  replaceRoleById: async (id, role) => {
    rolesById.set(String(id), role);
    return role;
  },
  removeRoleById: async (id) => rolesById.delete(String(id)),
  getUsersForRole: async (role) =>
    users.filter((u) => u.roleId === role.id || (role.isSeeded && u.role === role.name)),
  getUsersForRoleAccounting: async () => users,
  // Mirrors database/init.js's real reassignRoleMembers -- must set .role
  // unconditionally (no isSeeded check), see reassignRoleMembers.test.js
  // for why: requirePermission() resolves capabilities via
  // getRoleByName(req.user.role), so a stale .role after reassigning to a
  // custom role kept authorizing the user against their old one forever.
  reassignRoleMembers: async (fromRole, toRole) => {
    let count = 0;
    for (const u of users) {
      if (u.roleId === fromRole.id || (fromRole.isSeeded && u.role === fromRole.name)) {
        u.roleId = toRole.id;
        u.role = toRole.name;
        count++;
      }
    }
    return count;
  },
}));

const { createRole, updateRole, deleteRole } = await import("../services/permissions.js");

beforeEach(() => {
  rolesById.clear();
  users = [];
});

describe("createRole", () => {
  it("rejects a missing name", async () => {
    await expect(createRole({ capabilities: [] })).rejects.toThrow(/name/i);
  });

  it("rejects an unknown capability key", async () => {
    await expect(
      createRole({ name: "Custom", capabilities: ["not.a.real.capability"] }),
    ).rejects.toMatchObject({ code: "INVALID_CAPABILITY" });
  });

  it("rejects a duplicate name", async () => {
    seedRole("role-a", "Custom", ["players.view"]);
    await expect(
      createRole({ name: "Custom", capabilities: ["players.view"] }),
    ).rejects.toMatchObject({ code: "ROLE_NAME_TAKEN" });
  });

  it("creates a role with deduplicated capabilities", async () => {
    const role = await createRole({
      name: "Event Runner",
      capabilities: ["players.gm_tools", "players.gm_tools", "players.view"],
    });
    expect(role.capabilities.slice().sort()).toEqual(["players.gm_tools", "players.view"]);
    expect(role.isSeeded).toBe(false);
  });
});

describe("updateRole -- lockout rule 1 (hard block, capability check not role-name check)", () => {
  it("refuses removing roles.manage from the ONLY role that grants it", async () => {
    seedRole("role-admin", "admin", ["roles.manage", "users.manage", "server.control"]);
    users = [{ id: "u1", role: "admin", roleId: "role-admin" }];

    await expect(
      updateRole("role-admin", { capabilities: ["users.manage", "server.control"] }),
    ).rejects.toMatchObject({ code: "ROLE_LOCKOUT_LAST_MANAGER" });
  });

  it("refuses removing users.manage from the only role that grants it, even when roles.manage is untouched", async () => {
    seedRole("role-admin", "admin", ["roles.manage", "users.manage"]);
    users = [{ id: "u1", role: "admin", roleId: "role-admin" }];

    await expect(
      updateRole("role-admin", { capabilities: ["roles.manage"] }),
    ).rejects.toMatchObject({ code: "ROLE_LOCKOUT_LAST_MANAGER" });
  });

  it("allows the change once ANOTHER role also grants the capability -- not hardcoded to the name 'admin'", async () => {
    seedRole("role-admin", "admin", ["roles.manage", "users.manage"]);
    seedRole("role-super", "superuser", ["roles.manage", "users.manage"]);
    users = [
      { id: "u1", role: "admin", roleId: "role-admin" },
      { id: "u2", role: "superuser", roleId: "role-super" },
    ];

    const updated = await updateRole("role-admin", { capabilities: ["users.manage"] });
    expect(updated.capabilities).toEqual(["users.manage"]);
  });
});

describe("updateRole -- lockout rule 2 (soft block: acting user losing their own recovery capability)", () => {
  it("refuses without confirmSelfCapabilityLoss when the acting user is a member of the role being stripped, even though another role still grants it", async () => {
    seedRole("role-admin", "admin", ["roles.manage", "users.manage"]);
    seedRole("role-super", "superuser", ["roles.manage", "users.manage"]);
    users = [
      { id: "u1", role: "admin", roleId: "role-admin" },
      { id: "u2", role: "superuser", roleId: "role-super" },
    ];

    await expect(
      updateRole(
        "role-admin",
        { capabilities: ["users.manage"] },
        { actingUser: { userId: "u1", role: "admin" } },
      ),
    ).rejects.toMatchObject({ code: "ROLE_SELF_CAPABILITY_LOSS_CONFIRM" });
  });

  it("succeeds with confirmSelfCapabilityLoss: true", async () => {
    seedRole("role-admin", "admin", ["roles.manage", "users.manage"]);
    seedRole("role-super", "superuser", ["roles.manage", "users.manage"]);
    users = [
      { id: "u1", role: "admin", roleId: "role-admin" },
      { id: "u2", role: "superuser", roleId: "role-super" },
    ];

    const updated = await updateRole(
      "role-admin",
      { capabilities: ["users.manage"] },
      { actingUser: { userId: "u1", role: "admin" }, confirmSelfCapabilityLoss: true },
    );
    expect(updated.capabilities).toEqual(["users.manage"]);
  });

  it("does NOT require confirmation when the acting user belongs to a DIFFERENT role than the one being edited", async () => {
    seedRole("role-admin", "admin", ["roles.manage", "users.manage"]);
    seedRole("role-super", "superuser", ["roles.manage", "users.manage"]);
    users = [
      { id: "u1", role: "admin", roleId: "role-admin" },
      { id: "u2", role: "superuser", roleId: "role-super" },
    ];

    // Acting as the superuser, editing the admin role -- not self-affecting.
    const updated = await updateRole(
      "role-admin",
      { capabilities: ["users.manage"] },
      { actingUser: { userId: "u2", role: "superuser" } },
    );
    expect(updated.capabilities).toEqual(["users.manage"]);
  });
});

describe("deleteRole -- lockout rule 3 (must not orphan members)", () => {
  it("refuses to delete a role with members and no reassignTo", async () => {
    seedRole("role-custom", "Custom", ["players.view"]);
    users = [{ id: "u1", role: "Custom", roleId: "role-custom" }];

    await expect(deleteRole("role-custom")).rejects.toMatchObject({ code: "ROLE_HAS_MEMBERS" });
  });

  it("deletes and reassigns members when reassignTo is given", async () => {
    seedRole("role-custom", "Custom", ["players.view"]);
    seedRole("role-tech", "technician", ["server.control"]);
    users = [{ id: "u1", role: "Custom", roleId: "role-custom" }];

    const result = await deleteRole("role-custom", { reassignTo: "role-tech" });

    expect(result).toEqual({ deleted: true, reassigned: 1, reassignedTo: "role-tech" });
    expect(users[0].roleId).toBe("role-tech");
    expect(users[0].role).toBe("technician");
    expect(rolesById.has("role-custom")).toBe(false);
  });

  it("updates user.role to the target's name when reassignTo is ANOTHER CUSTOM role -- the branch the isSeeded-only bug lived in", async () => {
    seedRole("role-old", "Old Custom", ["players.view"]);
    seedRole("role-new", "New Custom", ["players.view", "players.gm_tools"]);
    users = [{ id: "u1", role: "Old Custom", roleId: "role-old" }];

    await deleteRole("role-old", { reassignTo: "role-new" });

    expect(users[0]).toEqual(
      expect.objectContaining({ roleId: "role-new", role: "New Custom" }),
    );
  });

  it("deletes with no members and no reassignTo needed", async () => {
    seedRole("role-empty", "Empty", ["players.view"]);
    const result = await deleteRole("role-empty");
    expect(result.deleted).toBe(true);
    expect(rolesById.has("role-empty")).toBe(false);
  });

  it("still enforces rule 1 on delete: refuses deleting the only role granting roles.manage, even with reassignTo pointing at a role that doesn't grant it", async () => {
    seedRole("role-admin", "admin", ["roles.manage", "users.manage"]);
    seedRole("role-tech", "technician", ["server.control"]);
    users = [{ id: "u1", role: "admin", roleId: "role-admin" }];

    await expect(deleteRole("role-admin", { reassignTo: "role-tech" })).rejects.toMatchObject({
      code: "ROLE_LOCKOUT_LAST_MANAGER",
    });
  });

  it("404s for a role that does not exist", async () => {
    await expect(deleteRole("role-nonexistent")).rejects.toMatchObject({
      code: "ROLE_NOT_FOUND",
    });
  });
});

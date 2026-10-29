/**
 * Role -> permissions. Enforced by requirePerm() on every admin route; the
 * dashboard only hides what the API would refuse anyway.
 */
const ROLES = {
  super_admin: {
    name: "Super Admin",
    permissions: ["*"],
  },
  admin: {
    name: "Admin",
    permissions: [
      "devices.view", "devices.edit", "devices.retire",
      "cmd.basic", "cmd.restart_app", "cmd.lost", "cmd.kiosk",
      "logs.pull", "technician.otp",
      "stores.view", "stores.edit", "groups.edit",
      "policies.view", "policies.edit",
      "enrollment.manage",
      "apps.view", "apps.manage", "rollouts.manage",
      "alerts.view", "alerts.manage",
      "commands.view", "audit.view", "fleet.bulk",
    ],
  },
  support: {
    name: "Support Agent",
    permissions: [
      "devices.view", "cmd.basic", "cmd.restart_app", "logs.pull", "technician.otp",
      "stores.view", "policies.view", "apps.view", "alerts.view", "commands.view",
    ],
  },
  store_user: {
    name: "Store User",
    permissions: ["devices.view", "cmd.restart_app", "alerts.view", "support.request"],
  },
};

// Which permission each device command needs.
const COMMAND_PERMS = {
  refresh_status: "cmd.basic",
  restart_app: "cmd.restart_app",
  reboot: "cmd.basic",
  lock: "cmd.basic",
  apply_policy: "cmd.basic",
  kiosk_exit_temp: "technician.otp",
  kiosk_relock: "cmd.basic",
  lost_mode_on: "cmd.lost",
  lost_mode_off: "cmd.lost",
  locate: "cmd.lost",
  pull_logs: "logs.pull",
  bugreport: "logs.pull",
  install_app: "apps.manage",
  uninstall_app: "apps.manage",
  wipe: "cmd.wipe",
  // Development only: drops Device Owner so a test tablet returns to normal.
  release_device_owner: "cmd.wipe",
};

// Need a fresh password/2FA check within the re-auth window.
const DESTRUCTIVE_COMMANDS = new Set(["wipe", "release_device_owner"]);

function can(role, perm) {
  const r = ROLES[role];
  if (!r) return false;
  return r.permissions.includes("*") || r.permissions.includes(perm);
}

function permissionsFor(role) {
  const r = ROLES[role];
  if (!r) return [];
  if (r.permissions.includes("*")) {
    const all = new Set(Object.values(ROLES).flatMap((x) => x.permissions).filter((p) => p !== "*"));
    ["cmd.wipe", "admins.manage", "settings.manage", "dev.release"].forEach((p) => all.add(p));
    return [...all].sort();
  }
  return [...r.permissions];
}

module.exports = { ROLES, COMMAND_PERMS, DESTRUCTIVE_COMMANDS, can, permissionsFor };

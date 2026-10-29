// Remote actions offered in the UI, with the permission the API enforces.
export const COMMANDS = [
  { type: "refresh_status", label: "Refresh status", perm: "cmd.basic" },
  { type: "restart_app", label: "Restart POS app", perm: "cmd.restart_app" },
  { type: "reboot", label: "Reboot", perm: "cmd.basic", confirm: "Reboot now? It waits for the maintenance window unless you force it.", force: true },
  { type: "lock", label: "Lock screen", perm: "cmd.basic" },
  { type: "apply_policy", label: "Re-apply policy", perm: "cmd.basic" },
  { type: "kiosk_exit_temp", label: "Exit kiosk (technician)", perm: "technician.otp", params: { minutes: 15 } },
  { type: "kiosk_relock", label: "Re-lock kiosk", perm: "cmd.basic" },
  { type: "pull_logs", label: "Pull logs", perm: "logs.pull" },
  { type: "bugreport", label: "Request bug report", perm: "logs.pull" },
  { type: "lost_mode_on", label: "Lost mode on", perm: "cmd.lost", prompt: "Message to show on the tablet" },
  { type: "lost_mode_off", label: "Lost mode off", perm: "cmd.lost" },
  { type: "locate", label: "Locate (if policy allows)", perm: "cmd.lost" },
  { type: "wipe", label: "Factory reset (wipe)", perm: "cmd.wipe", danger: true, confirm: "Wipe this tablet? All data is erased and it must be enrolled again." },
  { type: "release_device_owner", label: "Release (dev: remove MDM)", perm: "cmd.wipe", danger: true, confirm: "Remove KKMDM from this tablet and return it to a normal Android device?" },
];

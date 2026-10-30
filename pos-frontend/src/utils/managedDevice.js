/**
 * A tablet managed by KKMDM (kkmdm/ in this repository): KK Agent is its
 * Device Owner and keeps the POS locked in front, as a kiosk.
 *
 * The agent tells the app which store and terminal the tablet is, through
 * the app's ManagedDevice plugin (android/.../ManagedDevicePlugin.java).
 * A browser, the Windows app, a tablet that is not managed, and an Android
 * app from before the plugin existed all read as "not managed".
 *
 * config keys: kkmdm_device_id, kkmdm_device_name, store_id, restaurant_id,
 * store_name, terminal_name, device_group, pos_updates.
 */

import { Capacitor, registerPlugin } from "@capacitor/core";
import { useEffect, useState } from "react";

const ManagedDevice = registerPlugin("ManagedDevice");

const NOT_MANAGED = { managed: false, config: {} };

export const getManagedDevice = async () => {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("ManagedDevice")) return NOT_MANAGED;
  try {
    const r = await ManagedDevice.getConfig();
    return { managed: Boolean(r?.managed), config: r?.config || {} };
  } catch {
    return NOT_MANAGED;
  }
};

/** The agent's PIN-protected technician screen (Wi-Fi, settings, printers' USB permission). */
export const openTechnicianMode = () => ManagedDevice.openTechnician();

/** The agent's tablet settings: Wi-Fi, mobile data, Bluetooth, brightness, auto-rotate. */
export const openTabletSettings = () => ManagedDevice.openTabletSettings();

/** { managed, config }, kept current when KKMDM changes it (the tablet moved store, was renamed). */
export const useManagedDevice = () => {
  const [state, setState] = useState(NOT_MANAGED);
  useEffect(() => {
    let alive = true;
    let handle;
    getManagedDevice().then((s) => {
      if (!alive) return;
      setState(s);
      if (!s.managed) return;
      ManagedDevice.addListener("configChanged", (r) => setState({ managed: Boolean(r?.managed), config: r?.config || {} }))
        .then((h) => {
          if (alive) handle = h;
          else h.remove();
        })
        .catch(() => {});
    });
    return () => {
      alive = false;
      handle?.remove();
    };
  }, []);
  return state;
};

/**
 * Battery level for the POS header on kiosk tablets. Android has no Device
 * Owner switch for the status bar's battery percentage, so the POS shows it
 * itself. null where the browser has no Battery API.
 */
export const useBattery = (enabled = true) => {
  const [battery, setBattery] = useState(null);
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.getBattery) return undefined;
    let alive = true;
    let b;
    const read = () => alive && b && setBattery({ level: Math.round(b.level * 100), charging: b.charging });
    navigator.getBattery().then((x) => {
      b = x;
      read();
      b.addEventListener("levelchange", read);
      b.addEventListener("chargingchange", read);
    }).catch(() => {});
    return () => {
      alive = false;
      if (b) {
        b.removeEventListener("levelchange", read);
        b.removeEventListener("chargingchange", read);
      }
    };
  }, [enabled]);
  return battery;
};

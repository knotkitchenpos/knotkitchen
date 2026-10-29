import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "../../utils/notify";
import { getStoreProperties, updatePosSettings } from "../../https";
import { uploadMedia } from "../../https/storefrontApi";
import SecurityPinModal from "../common/SecurityPinModal";
import { checkActionAuthorization } from "../../utils/security";
import {
  bluetoothAvailable,
  bluetoothLinked,
  chooseBluetoothPrinter,
  chooseUsbPrinter,
  isLanIp,
  lanPrinting,
  listNativePrinters,
  loadPrinterConfig,
  nativePrinting,
  probeLanPrinter,
  savePrinterConfig,
  supports,
} from "../../utils/printerDevice";
import {
  desktopPrinting,
  printKot,
  printOrderReceipt,
  receiptContextFrom,
  renderReceiptCanvas,
  SAMPLE_ORDER,
} from "../../utils/printReceipt";
import { looksLikeCatPrinter } from "../../utils/catprinter";
import { openTechnicianMode, useManagedDevice } from "../../utils/managedDevice";

/**
 * Settings > Device Configuration.
 *
 * Two kinds of setting live here and are saved together by one button:
 *   - this device: a receipt printer, an optional kitchen printer for KOTs,
 *     their paper sizes, Auto Receipt / KOT Print (localStorage)
 *   - the restaurant: Auto E-Bill and what is printed on the receipt (server)
 */

const Card = ({ title, subtitle, children, right }) => (
  <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">{title}</h4>
        {subtitle ? <p className="text-[12px] text-[#64748B] mt-0.5">{subtitle}</p> : null}
      </div>
      {right}
    </div>
    <div className="mt-4">{children}</div>
  </div>
);

const Switch = ({ checked, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${checked ? "bg-[#FD5302]" : "bg-[#CBD5E1]"}`}
  >
    <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
    <span className="sr-only">{checked ? "On" : "Off"}</span>
  </button>
);

const ToggleRow = ({ title, note, checked, onChange, children }) => (
  <div className="py-3 border-t border-[#E2E8F0] first:border-t-0 first:pt-0">
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-[13.5px] font-bold text-[#0F172A]">{title}</p>
        {note ? <p className="text-[11.5px] text-[#94A3B8] mt-0.5">{note}</p> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
    {children}
  </div>
);

/** App only: pick one of several printers the phone found. */
const PrinterChoices = ({ choices, kind, onPick }) =>
  choices?.kind === kind ? (
    <div className="rounded-xl border border-[#E2E8F0] divide-y divide-[#E2E8F0] max-w-[420px]">
      {choices.list.map((p) => (
        <button
          key={p.bluetooth?.address || `${p.usb?.vendorId}:${p.usb?.productId}`}
          type="button"
          onClick={() => onPick(kind, p)}
          className="w-full min-h-[48px] px-3 text-left text-[13.5px] font-bold text-[#0F172A] hover:bg-[#F8FAFC]"
        >
          {p.name}
          {p.bluetooth ? <span className="block text-[11px] font-medium text-[#94A3B8]">{p.bluetooth.address}</span> : null}
        </button>
      ))}
    </div>
  ) : null;

const CONNECTIONS = [
  { key: "usb", label: "USB" },
  { key: "bluetooth", label: "Bluetooth" },
  { key: "lan", label: "LAN / Network" },
];

const PAPERS = [
  { key: "80", label: "80 mm", sub: "3 inch" },
  { key: "58", label: "58 mm", sub: "2 inch" },
];

const btnPrimary =
  "h-[40px] px-4 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502] disabled:opacity-50";
const btnGhost =
  "h-[40px] px-4 rounded-xl border border-[#E2E8F0] text-[#334155] text-[13px] font-bold hover:bg-[#F8FAFC] disabled:opacity-50";

/**
 * Only on a tablet KKMDM manages (utils/managedDevice.js): which terminal this
 * is, and the way out of the kiosk for a technician -- Wi-Fi, Android
 * settings, a printer's USB permission. The agent asks for the technician PIN
 * from KKMDM, so staff cannot leave the POS with it.
 */
const ManagedTabletCard = () => {
  const { managed, config } = useManagedDevice();
  if (!managed) return null;
  const rows = [
    ["Terminal", config.terminal_name],
    ["Store", [config.store_name, config.store_id].filter(Boolean).join(" · ")],
    ["Group", config.device_group],
    ["App updates", config.pos_updates === "kkmdm" ? "Rolled out by KKMDM" : "Automatic, installed by KK Agent"],
  ].filter(([, v]) => v);
  const open = () =>
    openTechnicianMode().catch(() => enqueueSnackbar("KK Agent is not installed on this tablet.", { variant: "error" }));
  return (
    <Card
      title="Managed tablet"
      subtitle="Locked to the POS by KKMDM."
      right={
        <button type="button" className={btnGhost} onClick={open}>
          Technician mode
        </button>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-[#64748B]">{k}</dt>
            <dd className="font-semibold text-[#0F172A] break-words">{v}</dd>
          </React.Fragment>
        ))}
      </dl>
    </Card>
  );
};

/**
 * One printer this device prints to: the receipt printer or the kitchen
 * printer. `device` is that slot's record; `patchDevice` saves a change to it
 * at once. `onUnsavedLan(true)` while a typed LAN address has not answered yet.
 */
const PrinterSlot = ({ title, subtitle, emptyLabel = "Not set up", device, patchDevice, onTest, onClear, onUnsavedLan, systemPrinters, btOn }) => {
  const [tab, setTab] = useState(device.type === "bluetooth" || device.type === "lan" ? device.type : "usb");
  const [connecting, setConnecting] = useState(false);
  // App only: printers to pick from when more than one is found.
  const [choices, setChoices] = useState(null);
  const paper = device.paper || "80";
  // Only a LAN slot starts with an address: a stale `lan` key never pulls a USB slot back.
  const [ip, setIp] = useState(device.type === "lan" ? device.lan?.host || "" : "");
  const [lanCheck, setLanCheck] = useState(null); // { host, state: "checking" | "ok" | "fail", message }

  // A LAN printer connects by itself: a typed address is checked, and kept
  // once a printer answers there; opening this screen checks the saved one again.
  useEffect(() => {
    const host = ip.trim();
    if (!isLanIp(host) || !lanPrinting()) {
      const typedAll = /^\d+\.\d+\.\d+\.\d+$/.test(host) && lanPrinting();
      setLanCheck(typedAll ? { host, state: "fail", message: "Enter the printer's IP address on this network, like 192.168.1.50." } : null);
      return undefined;
    }
    let live = true;
    setLanCheck({ host, state: "checking" });
    const t = setTimeout(async () => {
      try {
        await probeLanPrinter(host);
        if (!live) return;
        setLanCheck({ host, state: "ok" });
        if (device.type !== "lan" || device.lan?.host !== host) {
          patchDevice({ type: "lan", name: `LAN printer ${host}`, lan: { host }, usb: undefined, bluetooth: undefined, pin: "", protocol: "escpos", paper: "80" });
          enqueueSnackbar(`LAN printer ${host} connected.`, { variant: "success", important: true });
        }
      } catch (err) {
        if (live) setLanCheck({ host, state: "fail", message: err?.message || `No printer answered at ${host}.` });
      }
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new address starts a check
  }, [ip]);

  // Save waits while a typed address has not answered: it is not kept until then.
  const unsavedLan = tab === "lan" && ip.trim() !== "" && !(device.type === "lan" && device.lan?.host === ip.trim());
  useEffect(() => {
    onUnsavedLan?.(unsavedLan);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the parent passes a new callback every render
  }, [unsavedLan]);
  const lanHost = device.type === "lan" ? device.lan?.host : "";
  const lanState = lanHost && lanCheck?.host === lanHost ? lanCheck.state : null;

  const pickPrinter = (kind, picked) => {
    setChoices(null);
    // A mini printer only prints its own language on 57 mm paper; the name
    // usually gives it away, and the choice below is there when it does not.
    const cat = looksLikeCatPrinter(picked.name);
    // The PIN belongs to one printer: a different one starts without it.
    const samePrinter = Boolean(picked.bluetooth?.address) && picked.bluetooth.address === device.bluetooth?.address;
    patchDevice({
      type: kind,
      usb: undefined,
      bluetooth: undefined,
      ...picked,
      pin: samePrinter ? device.pin : "",
      // A receipt printer that cuts its own paper unless the name says it is
      // a 57 mm mini printer; there is no choice to make in the screen.
      ...(cat ? { protocol: "cat", paper: "58" } : { protocol: "escpos" }),
    });
    enqueueSnackbar(`${picked.name} connected. Choose the paper size, then Test Print.`, { variant: "success", important: true });
  };

  const connect = async (kind) => {
    setConnecting(true);
    setChoices(null);
    try {
      if (nativePrinting) {
        const found = await listNativePrinters(kind);
        if (!found.length) {
          throw new Error(
            kind === "usb"
              ? "No USB printer found. Plug it in with a USB OTG cable, allow access if the phone asks, and try again."
              : "No paired printer found. Pair the printer in the phone's Settings › Bluetooth first, then try again.",
          );
        }
        if (found.length === 1) pickPrinter(kind, found[0]);
        else setChoices({ kind, list: found });
        return;
      }
      const picked = kind === "usb" ? await chooseUsbPrinter() : await chooseBluetoothPrinter();
      pickPrinter(kind, picked);
    } catch (err) {
      // Closing the browser's chooser is not an error worth shouting about.
      if (err?.name !== "NotFoundError") enqueueSnackbar(err?.message || "Could not connect.", { variant: "error" });
    } finally {
      setConnecting(false);
    }
  };

  const isThis = (kind) => device.type === kind;
  // A Bluetooth printer cannot print with Bluetooth off, nor in a browser that forgot it (after a reload).
  const btState = device.type !== "bluetooth" ? null : btOn === false ? "off" : bluetoothLinked(device) ? null : "unlinked";

  return (
    <Card
      title={title}
      subtitle={subtitle}
      right={
        device.type ? (
          <span
            className={`text-[11.5px] font-bold px-2.5 py-1 rounded-full max-w-[50%] truncate ${
              lanState === "fail" || btState ? "bg-[#FEE2E2] text-[#B91C1C]" : "bg-[#DCFCE7] text-[#15803D]"
            }`}
            title={device.name}
          >
            {lanState === "ok"
              ? `Connected · ${lanHost}`
              : lanState === "fail"
                ? `Not reachable · ${lanHost}`
                : btState === "off"
                  ? `Bluetooth off · ${device.name}`
                  : btState === "unlinked"
                    ? "Not connected · tap Reconnect"
                    : device.name}
          </span>
        ) : (
          <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#64748B]">{emptyLabel}</span>
        )
      }
    >
      <div className="flex flex-wrap gap-2" role="tablist">
        {CONNECTIONS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={tab === c.key}
            onClick={() => setTab(c.key)}
            className={`h-[38px] px-4 rounded-xl text-[13px] font-bold border ${
              tab === c.key
                ? "bg-[#FD5302] text-white border-[#FD5302]"
                : "bg-white text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1]"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {tab === "usb" && (
        <div className="mt-4 space-y-3 text-[13px]">
          {supports.usb() ? (
            <button type="button" className={btnPrimary} disabled={connecting} onClick={() => connect("usb")}>
              {connecting ? "Connecting…" : isThis("usb") ? "Choose a different USB printer" : "Find USB printer"}
            </button>
          ) : (
            <p className="text-[12.5px] text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-3">
              This browser cannot reach USB printers directly. Open the POS in Chrome or Edge.
            </p>
          )}
          <PrinterChoices choices={choices} kind="usb" onPick={pickPrinter} />
          {!nativePrinting && desktopPrinting() && (
          <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-3">
            <p className="font-bold text-[#0F172A]">Printer installed on this computer</p>
            <p className="text-[12px] text-[#64748B] mt-0.5">
              Prints go straight to the printer you choose here, with no dialog. Install the printer&apos;s
              Windows driver first; it then appears in this list.
            </p>
            <select
              className="mt-2 h-[40px] w-full rounded-xl border border-[#E2E8F0] bg-white px-3 text-[13px] font-bold text-[#334155]"
              value={isThis("system") ? device.systemPrinter || "" : "__none"}
              onChange={(e) => {
                const name = e.target.value;
                if (name === "__none") return;
                patchDevice({ type: "system", name: name ? `Windows: ${name}` : "Default Windows printer", systemPrinter: name });
              }}
            >
              <option value="__none" disabled>
                Choose a printer…
              </option>
              <option value="">Default Windows printer</option>
              {systemPrinters.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </div>
          )}
        </div>
      )}

      {tab === "lan" && (
        <div className="mt-4 text-[13px]">
          {lanPrinting() ? (
            <div className="max-w-[360px]">
              <label className="block">
                <span className="text-[13px] font-bold text-[#0F172A]">Printer IP address</span>
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={15}
                  value={ip}
                  onChange={(e) => setIp(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="e.g. 192.168.1.50"
                  className="mt-1.5 h-[40px] w-full rounded-xl border border-[#E2E8F0] px-3 text-[14px] font-bold"
                />
              </label>
              <p
                role="status"
                className={`mt-1.5 text-[12px] font-bold ${
                  lanCheck?.state === "ok" ? "text-[#15803D]" : lanCheck?.state === "fail" ? "text-[#DC2626]" : "text-[#64748B]"
                }`}
              >
                {lanCheck?.state === "checking" ? "Connecting…" : lanCheck?.state === "ok" ? "Connected" : lanCheck?.message || ""}
              </p>
            </div>
          ) : (
            <p className="text-[12.5px] text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-3">
              {desktopPrinting()
                ? "Update the KnotKitchen POS app to use a LAN printer: it updates itself; restart it when it offers."
                : "A browser cannot reach a network printer. Use the KnotKitchen POS app on Android or Windows."}
            </p>
          )}
        </div>
      )}

      {tab === "bluetooth" && (
        <div className="mt-4 space-y-3 text-[13px]">
          {nativePrinting && (
            <p className="text-[#64748B]">
              Pair the printer once in the phone&apos;s <strong>Settings › Bluetooth</strong> (the PIN is usually 0000
              or 1234). Then press <strong>Search &amp; connect</strong> and pick it.
            </p>
          )}
          {!supports.bluetooth() ? (
            <p className="text-[12.5px] text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-3">
              This browser cannot use Bluetooth printers. Open the POS in Chrome or Edge.
            </p>
          ) : (
            <>
              <p className={`text-[12px] font-bold ${btOn === false ? "text-[#DC2626]" : "text-[#15803D]"}`}>
                {btOn === false ? "Bluetooth is off on this device." : "Bluetooth is available."}
              </p>
              <button type="button" className={btnPrimary} disabled={connecting} onClick={() => connect("bluetooth")}>
                {connecting ? "Connecting…" : isThis("bluetooth") ? "Reconnect / change printer" : "Search & connect"}
              </button>
              {/* No pairing-PIN field: the app reconnects a paired printer on its own
                  (ThermalPrinterPlugin, openSpp). A PIN saved before is still passed on. */}
              <PrinterChoices choices={choices} kind="bluetooth" onPick={pickPrinter} />
            </>
          )}
        </div>
      )}

      {/* A LAN printer always uses 80 mm paper: there is nothing to choose. */}
      {tab !== "lan" && device.type !== "lan" && (
      <div className="mt-5 pt-4 border-t border-[#E2E8F0]">
        <p className="text-[13px] font-bold text-[#0F172A]">Paper size</p>
          <div className="mt-2 grid grid-cols-2 gap-2 max-w-[360px]">
            {PAPERS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={paper === p.key}
                disabled={device.protocol === "cat" && p.key !== "58"}
                onClick={() => patchDevice({ paper: p.key })}
                className={`h-[56px] rounded-xl border text-left px-3 disabled:opacity-40 ${
                  paper === p.key ? "border-[#FD5302] bg-[#FFF6F0] ring-1 ring-[#FD5302]" : "border-[#E2E8F0] bg-white"
                }`}
              >
                <span className="block text-[14px] font-extrabold text-[#0F172A]">{p.label}</span>
                <span className="block text-[11.5px] text-[#64748B]">{p.sub}</span>
              </button>
            ))}
          </div>
      </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={btnGhost} onClick={onTest} disabled={!device.type}>
          Test print
        </button>
        {onClear && device.type ? (
          <button type="button" className={btnGhost} onClick={onClear}>
            Use the receipt printer instead
          </button>
        ) : null}
      </div>
    </Card>
  );
};

const DeviceConfiguration = () => {
  const qc = useQueryClient();
  const user = useSelector((s) => s.user);
  const { data: propsRes } = useQuery({ queryKey: ["store-properties"], queryFn: getStoreProperties });
  const props = propsRes?.data?.data;

  /* ---- this device ---- */
  const [device, setDevice] = useState(loadPrinterConfig);
  const [btOn, setBtOn] = useState(null);
  // Kept the moment it changes, not on Save: this is the printer plugged into
  // THIS device, and Orders > Print read the saved copy -- so a printer that
  // was connected but not yet saved opened the print dialog instead.
  const patchDevice = (patch) => setDevice((d) => savePrinterConfig({ ...d, ...patch }));
  const patchKitchen = (patch) => setDevice((d) => savePrinterConfig({ ...d, kitchen: { ...d.kitchen, ...patch } }));
  // A LAN address typed in a slot that has not answered yet: Save waits for it.
  const [lanWaiting, setLanWaiting] = useState({});

  // Checked again while the screen is open: Bluetooth turned off or on from
  // the quick settings left the first answer on screen.
  useEffect(() => {
    const check = () => bluetoothAvailable().then(setBtOn);
    check();
    const t = setInterval(check, 5000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", check);
    };
  }, []);

  // Windows app only: the printers the computer's driver knows about.
  const [systemPrinters, setSystemPrinters] = useState([]);
  useEffect(() => {
    if (!desktopPrinting()) return;
    window.knotDesktop
      .listPrinters()
      .then((list) => setSystemPrinters(Array.isArray(list) ? list : []))
      .catch(() => setSystemPrinters([]));
  }, []);

  /* ---- the restaurant ---- */
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (props && !form) setForm({ ...props.posSettings });
  }, [props, form]);
  const patch = (p) => setForm((f) => ({ ...f, ...p }));

  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const onQrFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadMedia(file, { folder: "general", altText: "Website QR code for receipts" });
      patch({ qrCodeImage: res.data?.data?.url || "", showQrCode: true });
    } catch (err) {
      enqueueSnackbar(err?.response?.data?.message || "Upload failed.", { variant: "error" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /* ---- preview ---- */
  const [preview, setPreview] = useState("");
  const context = useMemo(() => (props && form ? receiptContextFrom(props, form) : null), [props, form]);

  useEffect(() => {
    if (!context) return undefined;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const canvas = await renderReceiptCanvas({ order: SAMPLE_ORDER, ...context, paper: device.paper });
        if (live) setPreview(canvas.toDataURL("image/png"));
      } catch {
        /* preview is a nicety */
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [context, device.paper]);

  const testPrint = async () => {
    try {
      const { via } = await printOrderReceipt(SAMPLE_ORDER, { config: device, context });
      if (via !== "dialog") enqueueSnackbar("Test receipt sent to the printer.", { variant: "success" });
    } catch (err) {
      enqueueSnackbar(err?.message || "Test print failed.", { variant: "error" });
    }
  };

  // printKot picks the kitchen slot out of the device's config by itself.
  const testKot = async () => {
    try {
      const { via } = await printKot(SAMPLE_ORDER, { config: device, context });
      if (via !== "dialog") enqueueSnackbar("Test KOT sent to the kitchen printer.", { variant: "success" });
    } catch (err) {
      enqueueSnackbar(err?.message || "Test print failed.", { variant: "error" });
    }
  };

  /* ---- save ---- */
  const [pinOpen, setPinOpen] = useState(false);
  const saveMutation = useMutation({
    mutationFn: () =>
      updatePosSettings({
        autoEBill: form.autoEBill,
        customMessage: form.customMessage,
        showWebsiteLink: form.showWebsiteLink,
        websiteLink: form.websiteLink,
        showQrCode: form.showQrCode,
        qrCodeImage: form.qrCodeImage,
        showLogo: form.showLogo,
      }),
    onSuccess: (res) => {
      setDevice(savePrinterConfig(device));
      if (res?.data?.data) setForm({ ...res.data.data });
      qc.invalidateQueries({ queryKey: ["store-properties"] });
      enqueueSnackbar("Device configuration saved.", { variant: "success" });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not save.", { variant: "error" }),
  });
  const save = () => {
    if (device.autoPrint && !device.type) {
      enqueueSnackbar("Connect a printer before turning on Auto Receipt Print.", { variant: "warning" });
      return;
    }
    if (device.kotPrint && !device.type && !device.kitchen?.type) {
      enqueueSnackbar("Connect a printer before turning on Auto KOT Print.", { variant: "warning" });
      return;
    }
    if (checkActionAuthorization(user, { isOwnerOnly: false }).status === "REQUIRE_PIN") setPinOpen(true);
    else saveMutation.mutate();
  };

  if (!form) {
    return <div className="bg-white border border-[#E2E8F0] rounded-2xl p-8 text-center text-[13px] text-[#94A3B8]">Loading…</div>;
  }

  const logo = props?.restaurantLogo;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
      <div className="space-y-4 min-w-0">
        <ManagedTabletCard />

        {/* ---------- Printers ---------- */}
        {/* key: choosing a printer resets the card's tab and LAN address from what was kept; the slot prefix keeps the two keys apart. */}
        <PrinterSlot
          key={`receipt-${device.type || "none"}`}
          title="Receipt Printer"
          subtitle="Bills and reports."
          device={device}
          patchDevice={patchDevice}
          onUnsavedLan={(v) => setLanWaiting((w) => ({ ...w, receipt: v }))}
          onTest={testPrint}
          systemPrinters={systemPrinters}
          btOn={btOn}
        />
        <PrinterSlot
          key={`kitchen-${device.kitchen?.type || "none"}`}
          title="Kitchen Printer (KOT)"
          emptyLabel="Uses receipt printer"
          device={device.kitchen || {}}
          patchDevice={patchKitchen}
          onUnsavedLan={(v) => setLanWaiting((w) => ({ ...w, kitchen: v }))}
          onTest={testKot}
          onClear={() => patchDevice({ kitchen: undefined })}
          systemPrinters={systemPrinters}
          btOn={btOn}
        />

        {/* ---------- Automation ---------- */}
        <Card title="Automation">
          <ToggleRow
            title="Auto Receipt Print"
            checked={Boolean(device.autoPrint)}
            onChange={(v) => patchDevice({ autoPrint: v })}
          />
          <ToggleRow
            title="Auto KOT Print"
            checked={Boolean(device.kotPrint)}
            onChange={(v) => patchDevice({ kotPrint: v })}
          />
          <ToggleRow
            title="Auto E-Bill"
            checked={Boolean(form.autoEBill)}
            onChange={(v) => patch({ autoEBill: v })}
          />
        </Card>

        {/* ---------- Receipt customisation ---------- */}
        <Card title="Receipt Customization">
          <div className="pb-3">
            <label htmlFor="receipt-advert" className="text-[13.5px] font-bold text-[#0F172A]">Advertisement</label>
            <textarea
              id="receipt-advert"
              value={form.customMessage || ""}
              onChange={(e) => patch({ customMessage: e.target.value.slice(0, 300) })}
              rows={2}
              placeholder="e.g. Get 10% off your next visit. Show this receipt."
              className="w-full mt-2 px-3 py-2 rounded-xl border border-[#E2E8F0] text-[13px]"
            />
          </div>

          <ToggleRow
            title="Website Link"
            checked={Boolean(form.showWebsiteLink)}
            onChange={(v) => patch({ showWebsiteLink: v })}
          >
            {(form.showWebsiteLink || form.showQrCode) && (
              <input
                aria-label="Website link"
                value={form.websiteLink || ""}
                onChange={(e) => patch({ websiteLink: e.target.value })}
                placeholder={props?.websiteUrl || "www.yourrestaurant.com"}
                className="w-full h-[38px] px-3 mt-2 rounded-xl border border-[#E2E8F0] text-[13px]"
              />
            )}
          </ToggleRow>

          <ToggleRow
            title="Website QR Code"
            checked={Boolean(form.showQrCode)}
            onChange={(v) => {
              if (v && !form.qrCodeImage) fileRef.current?.click();
              else patch({ showQrCode: v });
            }}
          >
            <div className="mt-2 flex items-center gap-3">
              {form.qrCodeImage ? (
                <img src={form.qrCodeImage} alt="Website QR code" className="w-16 h-16 object-contain border border-[#E2E8F0] rounded-lg bg-white" />
              ) : null}
              <button type="button" className={btnGhost} disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? "Uploading…" : form.qrCodeImage ? "Replace QR image" : "Upload QR image"}
              </button>
              {form.qrCodeImage ? (
                <button
                  type="button"
                  className="text-[12.5px] font-bold text-[#DC2626] hover:underline"
                  onClick={() => patch({ qrCodeImage: "", showQrCode: false })}
                >
                  Remove
                </button>
              ) : null}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => onQrFile(e.target.files?.[0])} />
            </div>
          </ToggleRow>

          <ToggleRow
            title="Logo"
            note={logo ? "Print the restaurant logo at the very top of the receipt." : "No logo is set for this restaurant yet, so none is printed."}
            checked={form.showLogo !== false}
            onChange={(v) => patch({ showLogo: v })}
          />
        </Card>

        <div className="flex items-center justify-end gap-3">
          {lanWaiting.receipt || lanWaiting.kitchen ? (
            <p className="text-[12px] text-[#64748B]">Save turns on once the LAN printer answers.</p>
          ) : null}
          <button
            type="button"
            className={`${btnPrimary} px-6`}
            onClick={save}
            disabled={saveMutation.isPending || lanWaiting.receipt || lanWaiting.kitchen}
          >
            {saveMutation.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* ---------- Preview ---------- */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 xl:sticky xl:top-4">
        <p className="text-[13px] font-extrabold text-[#0F172A]">Receipt preview · {device.paper} mm</p>
        <p className="text-[11.5px] text-[#94A3B8]">Exactly what the printer receives.</p>
        <div className="mt-3 bg-[#F1F5F9] rounded-xl p-3 flex justify-center overflow-auto max-h-[70vh]">
          {preview ? (
            <img
              src={preview}
              alt="Receipt preview"
              className="bg-white shadow-sm"
              style={{ width: device.paper === "58" ? 192 : 288, imageRendering: "auto" }}
            />
          ) : (
            <span className="text-[12px] text-[#94A3B8] py-10">Preparing preview…</span>
          )}
        </div>
      </div>

      <SecurityPinModal
        isOpen={pinOpen}
        onClose={() => setPinOpen(false)}
        onSuccess={() => {
          setPinOpen(false);
          saveMutation.mutate();
        }}
        title="Saving requires authorization"
        actionLabel="Save"
      />
    </div>
  );
};

export default DeviceConfiguration;

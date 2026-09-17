import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { getStoreProperties, updatePosSettings } from "../../https";
import { uploadMedia } from "../../https/storefrontApi";
import SecurityPinModal from "../common/SecurityPinModal";
import { checkActionAuthorization } from "../../utils/security";
import {
  bluetoothAvailable,
  chooseBluetoothPrinter,
  chooseUsbPrinter,
  listNativePrinters,
  loadPrinterConfig,
  nativePrinting,
  savePrinterConfig,
  supports,
} from "../../utils/printerDevice";
import {
  desktopPrinting,
  printOrderReceipt,
  receiptContextFrom,
  renderReceiptCanvas,
  SAMPLE_ORDER,
} from "../../utils/printReceipt";
import { looksLikeCatPrinter } from "../../utils/catprinter";

/**
 * Settings > Device Configuration.
 *
 * Two kinds of setting live here and are saved together by one button:
 *   - this device: printer, paper size, Auto Receipt Print (localStorage)
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
  { key: "lan", label: "LAN / Network", disabled: true },
];

const PAPERS = [
  { key: "80", label: "80 mm", sub: "3 inch" },
  { key: "58", label: "58 mm", sub: "2 inch" },
];

const PROTOCOLS = [
  { key: "escpos", label: "Receipt printer", sub: "ESC/POS · billing / KOT printers" },
  { key: "cat", label: "Mini printer", sub: "iPrint · Fun Print · Tiny Print · 57 mm" },
];

const btnPrimary =
  "h-[40px] px-4 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502] disabled:opacity-50";
const btnGhost =
  "h-[40px] px-4 rounded-xl border border-[#E2E8F0] text-[#334155] text-[13px] font-bold hover:bg-[#F8FAFC] disabled:opacity-50";

const DeviceConfiguration = () => {
  const qc = useQueryClient();
  const user = useSelector((s) => s.user);
  const { data: propsRes } = useQuery({ queryKey: ["store-properties"], queryFn: getStoreProperties });
  const props = propsRes?.data?.data;

  /* ---- this device ---- */
  const [device, setDevice] = useState(loadPrinterConfig);
  const [tab, setTab] = useState(device.type === "bluetooth" ? "bluetooth" : "usb");
  const [connecting, setConnecting] = useState(false);
  // App only: printers to pick from when more than one is found.
  const [choices, setChoices] = useState(null);
  const [btOn, setBtOn] = useState(null);
  // Kept the moment it changes, not on Save: this is the printer plugged into
  // THIS device, and Orders > Print read the saved copy -- so a printer that
  // was connected but not yet saved opened the print dialog instead.
  const patchDevice = (patch) => setDevice((d) => savePrinterConfig({ ...d, ...patch }));

  useEffect(() => {
    bluetoothAvailable().then(setBtOn);
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

  const pickPrinter = (kind, picked) => {
    setChoices(null);
    // A mini printer only prints its own language on 57 mm paper; the name
    // usually gives it away, and the choice below is there when it does not.
    const cat = looksLikeCatPrinter(picked.name);
    patchDevice({ type: kind, usb: undefined, bluetooth: undefined, ...picked, ...(cat ? { protocol: "cat", paper: "58" } : {}) });
    enqueueSnackbar(`${picked.name} connected. Choose the paper size, then Test Print.`, { variant: "success" });
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
    if (checkActionAuthorization(user, { isOwnerOnly: false }).status === "REQUIRE_PIN") setPinOpen(true);
    else saveMutation.mutate();
  };

  if (!form) {
    return <div className="bg-white border border-[#E2E8F0] rounded-2xl p-8 text-center text-[13px] text-[#94A3B8]">Loading…</div>;
  }

  const isThis = (kind) => device.type === kind;
  const logo = props?.restaurantLogo;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
      <div className="space-y-4 min-w-0">
        {/* ---------- Thermal printer ---------- */}
        <Card
          title="Thermal Printer"
          subtitle="Set up the receipt printer connected to this device."
          right={
            device.type ? (
              <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-full bg-[#DCFCE7] text-[#15803D] max-w-[50%] truncate" title={device.name}>
                {device.name}
              </span>
            ) : (
              <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#64748B]">Not set up</span>
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
                disabled={c.disabled}
                onClick={() => setTab(c.key)}
                className={`h-[38px] px-4 rounded-xl text-[13px] font-bold border ${
                  tab === c.key
                    ? "bg-[#FD5302] text-white border-[#FD5302]"
                    : "bg-white text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1]"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {c.label}
                {c.disabled ? <span className="ml-1.5 text-[10.5px] font-semibold">(coming soon)</span> : null}
              </button>
            ))}
          </div>

          {tab === "usb" && (
            <div className="mt-4 space-y-3 text-[13px]">
              <p className="text-[#64748B]">
                Connect the printer to this device with its USB cable, then press <strong>Find USB printer</strong> and pick it from the list.
              </p>
              {supports.usb() ? (
                <button type="button" className={btnPrimary} disabled={connecting} onClick={() => connect("usb")}>
                  {connecting ? "Connecting…" : isThis("usb") ? "Choose a different USB printer" : "Find USB printer"}
                </button>
              ) : (
                <p className="text-[12.5px] text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-3">
                  This browser cannot reach USB printers directly. Open the POS in Chrome or Edge, or use the computer&apos;s printer driver below.
                </p>
              )}
              <PrinterChoices choices={choices} kind="usb" onPick={pickPrinter} />
              {!nativePrinting && desktopPrinting() && (
              <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-3">
                <p className="font-bold text-[#0F172A]">Printer installed on this computer</p>
                <p className="text-[12px] text-[#64748B] mt-0.5">
                  Receipts print straight to the printer you choose here, with no dialog. Install the printer&apos;s
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
              {!nativePrinting && !desktopPrinting() && (
              <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-3">
                <p className="font-bold text-[#0F172A]">Printer installed on a Windows computer?</p>
                <p className="text-[12px] text-[#64748B] mt-0.5">
                  Windows keeps USB printers for its own driver. Install the KnotKitchen POS Windows app to print through
                  that driver silently. In a browser, make the receipt printer the default printer; receipts then open the
                  print dialog (Chrome with <code>--kiosk-printing</code> skips it).
                </p>
                <button
                  type="button"
                  className={`${btnGhost} mt-2`}
                  onClick={() => patchDevice({ type: "system", name: "Computer's printer driver" })}
                >
                  {isThis("system") ? "Using the computer's printer driver" : "Use the computer's printer driver"}
                </button>
              </div>
              )}
            </div>
          )}

          {tab === "bluetooth" && (
            <div className="mt-4 space-y-3 text-[13px]">
              {nativePrinting ? (
                <p className="text-[#64748B]">
                  Pair the printer once in the phone&apos;s <strong>Settings › Bluetooth</strong> (the PIN is usually 0000
                  or 1234). Then press <strong>Search &amp; connect</strong> and pick it.
                </p>
              ) : (
                <p className="text-[#64748B]">
                  Turn on the printer and put it in pairing mode. Make sure Bluetooth is on for this device, then press{" "}
                  <strong>Search &amp; connect</strong> and pick the printer.
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
                  <PrinterChoices choices={choices} kind="bluetooth" onPick={pickPrinter} />
                </>
              )}
            </div>
          )}

          {(isThis("usb") || isThis("bluetooth")) && (
            <div className="mt-5 pt-4 border-t border-[#E2E8F0]">
              <p className="text-[13px] font-bold text-[#0F172A]">Printer type</p>
              <p className="text-[11.5px] text-[#94A3B8] mt-0.5">
                A mini sticker printer speaks its own language. If the printer says it is connected but nothing comes
                out, choose Mini printer.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 max-w-[360px]">
                {PROTOCOLS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={(device.protocol || "escpos") === p.key}
                    onClick={() => patchDevice({ protocol: p.key, ...(p.key === "cat" ? { paper: "58" } : {}) })}
                    className={`h-[56px] rounded-xl border text-left px-3 ${
                      (device.protocol || "escpos") === p.key ? "border-[#FD5302] bg-[#FFF6F0] ring-1 ring-[#FD5302]" : "border-[#E2E8F0] bg-white"
                    }`}
                  >
                    <span className="block text-[14px] font-extrabold text-[#0F172A]">{p.label}</span>
                    <span className="block text-[11.5px] text-[#64748B]">{p.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 pt-4 border-t border-[#E2E8F0]">
            <p className="text-[13px] font-bold text-[#0F172A]">Paper size</p>
            <div className="mt-2 grid grid-cols-2 gap-2 max-w-[360px]">
              {PAPERS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={device.paper === p.key}
                  disabled={device.protocol === "cat" && p.key !== "58"}
                  onClick={() => patchDevice({ paper: p.key })}
                  className={`h-[56px] rounded-xl border text-left px-3 disabled:opacity-40 ${
                    device.paper === p.key ? "border-[#FD5302] bg-[#FFF6F0] ring-1 ring-[#FD5302]" : "border-[#E2E8F0] bg-white"
                  }`}
                >
                  <span className="block text-[14px] font-extrabold text-[#0F172A]">{p.label}</span>
                  <span className="block text-[11.5px] text-[#64748B]">{p.sub}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={btnGhost} onClick={testPrint} disabled={!device.type}>
              Test print
            </button>
          </div>
        </Card>

        {/* ---------- Automation ---------- */}
        <Card title="Automation">
          <ToggleRow
            title="Auto Receipt Print"
            note="Print a receipt on this device's printer the moment any new order arrives: POS, website or table QR. No need to accept it first."
            checked={Boolean(device.autoPrint)}
            onChange={(v) => patchDevice({ autoPrint: v })}
          />
          <ToggleRow
            title="Auto E-Bill"
            note="When an order is Completed, send the e-bill to the customer's phone number, if they gave one. POS, website and table QR orders."
            checked={Boolean(form.autoEBill)}
            onChange={(v) => patch({ autoEBill: v })}
          />
        </Card>

        {/* ---------- Receipt customisation ---------- */}
        <Card title="Receipt Customization" subtitle="What is printed on every receipt from this restaurant.">
          <div className="pb-3">
            <label htmlFor="receipt-advert" className="text-[13.5px] font-bold text-[#0F172A]">Advertisement</label>
            <p className="text-[11.5px] text-[#94A3B8]">Printed at the bottom of the receipt.</p>
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
            note="Print the restaurant's website address on the receipt."
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
            note="Print your website QR code at the bottom, with the website link under it."
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

        <div className="flex justify-end">
          <button type="button" className={`${btnPrimary} px-6`} onClick={save} disabled={saveMutation.isPending}>
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

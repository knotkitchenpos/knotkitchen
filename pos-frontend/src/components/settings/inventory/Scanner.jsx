import React, { useEffect, useRef, useState } from "react";
import { btnGhost, inputClass } from "./ui";

/**
 * Barcode scanning (owner, 2026-11-03), two ways:
 *   a scanner (USB or Bluetooth) types the code and Enter into the box, like
 *   a keyboard; the box keeps focus so scan after scan lands in it;
 *   the camera (phones, tablets) reads it, with the phone's own barcode reader
 *   where the WebView has one, else ZXing, loaded only when the camera opens.
 */

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];

/** A short beep and a buzz: the scan was read. */
export const scanned = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 1400;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.09);
    o.onended = () => ctx.close();
  } catch {
    /* no sound here */
  }
  try { navigator.vibrate?.(40); } catch { /* no vibration here */ }
};

/** The camera, reading codes until closed. The same code twice within 1.5 s is one scan. */
const CameraScanner = ({ onCode, onClose, paused }) => {
  const video = useRef(null);
  const [error, setError] = useState("");
  const last = useRef({ code: "", at: 0 });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    let stop = () => {};
    let alive = true;
    const hit = (code) => {
      if (!code || pausedRef.current) return;
      const now = Date.now();
      if (code === last.current.code && now - last.current.at < 1500) return;
      last.current = { code, at: now };
      scanned();
      onCode(code);
    };
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera");
        if ("BarcodeDetector" in window) {
          const supported = await window.BarcodeDetector.getSupportedFormats?.().catch(() => []) || [];
          const formats = FORMATS.filter((f) => supported.includes(f));
          if (formats.length) {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
            if (!alive) return stream.getTracks().forEach((t) => t.stop());
            video.current.srcObject = stream;
            await video.current.play();
            const detector = new window.BarcodeDetector({ formats });
            let timer = null;
            const tick = async () => {
              try {
                const found = await detector.detect(video.current);
                if (found[0]?.rawValue) hit(found[0].rawValue);
              } catch { /* a frame it could not read */ }
              if (alive) timer = setTimeout(tick, 180);
            };
            tick();
            stop = () => { clearTimeout(timer); stream.getTracks().forEach((t) => t.stop()); };
            return;
          }
        }
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (!alive) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } }, audio: false },
          video.current,
          (result) => { if (result) hit(result.getText()); },
        );
        stop = () => controls.stop();
        if (!alive) stop();
      } catch (e) {
        setError(e?.name === "NotAllowedError"
          ? "Camera access was refused. Allow the camera for KnotKitchen in the phone's settings, or use a barcode scanner."
          : "No camera here. Use a barcode scanner, or type the number under the barcode.");
      }
    })();
    return () => { alive = false; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-xl overflow-hidden bg-black relative">
      {error ? (
        <p className="p-4 text-[12.5px] text-white">{error}</p>
      ) : (
        <>
          <video ref={video} className="w-full max-h-[260px] object-cover" muted playsInline />
          {/* Where to hold the barcode. */}
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-[70px] -translate-y-1/2 rounded-lg border-2 border-[#FD5302]/90" />
          {paused && <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[12.5px] font-bold text-white">Finish this product first</div>}
        </>
      )}
      <button type="button" onClick={onClose} className="absolute right-2 top-2 h-8 rounded-lg bg-black/60 px-3 text-[12px] font-bold text-white">Close camera</button>
    </div>
  );
};

/**
 * A box a scanner types into, and a camera button. `onCode` gets each
 * barcode; `keepOpen` leaves the camera on for scan after scan.
 */
export const BarcodeField = ({ onCode, placeholder = "Scan or type a barcode", keepOpen = true, paused = false, autoFocus = true }) => {
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  const box = useRef(null);
  const send = (code) => {
    const c = String(code || "").trim();
    if (!c) return;
    onCode(c);
    if (!keepOpen) setCamera(false);
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          ref={box}
          autoFocus={autoFocus}
          className={`${inputClass} font-medium flex-1 min-w-0 tracking-wide`}
          placeholder={placeholder}
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (paused) return;
            scanned();
            send(value);
            setValue("");
          }}
          aria-label="Barcode"
        />
        <button type="button" className={`${btnGhost} h-[40px] shrink-0 whitespace-nowrap`} onClick={() => setCamera((v) => !v)}>
          {camera ? "Camera on" : "📷 Camera"}
        </button>
      </div>
      {camera && <CameraScanner paused={paused} onCode={send} onClose={() => { setCamera(false); box.current?.focus(); }} />}
    </div>
  );
};

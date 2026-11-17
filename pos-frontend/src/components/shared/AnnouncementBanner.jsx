import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAnnouncements } from "../../https";
import { acquireSocket, releaseSocket } from "../../socket";

/**
 * KnotKitchen's announcements (posted in CSD, owner 2026-11-17): a banner on
 * the till, at once on every open POS (socket "announcement:changed"). Each
 * device can dismiss one; a new announcement shows again.
 */
const KEY = "kk_announcements_dismissed";
const readDismissed = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
  } catch {
    return new Set();
  }
};

const STYLE = {
  info: "bg-[#EFF6FF] text-[#1E3A8A]",
  warning: "bg-[#FEF3C7] text-[#92400E]",
  critical: "bg-[#FEE2E2] text-[#991B1B]",
};

const AnnouncementBanner = () => {
  const restaurantId = useSelector((s) => s.user?.restaurantId);
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState(readDismissed);
  const { data } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => getAnnouncements().then((r) => r.data?.data || []),
    enabled: Boolean(restaurantId),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!restaurantId) return undefined;
    const socket = acquireSocket(restaurantId);
    const onChanged = () => qc.invalidateQueries({ queryKey: ["announcements"] });
    socket.on("announcement:changed", onChanged);
    return () => {
      socket.off("announcement:changed", onChanged);
      releaseSocket();
    };
  }, [restaurantId, qc]);

  const shown = (data || []).filter((a) => !dismissed.has(a.id));
  if (!shown.length) return null;

  const dismiss = (id) => {
    const next = new Set(dismissed).add(id);
    try {
      // Only ids still live are worth keeping.
      localStorage.setItem(KEY, JSON.stringify([...next].filter((x) => (data || []).some((a) => a.id === x))));
    } catch {
      /* private mode: it just shows again next time */
    }
    setDismissed(next);
  };

  return shown.map((a) => (
    <div key={a.id} role="status" className={`flex items-start justify-between gap-3 px-4 py-2 text-[12.5px] ${STYLE[a.level] || STYLE.info}`}>
      <span>
        <strong className="font-extrabold">{a.title}</strong>
        {a.body ? <span className="font-semibold"> · {a.body}</span> : null}
        {a.linkUrl ? (
          <a href={a.linkUrl} target="_blank" rel="noopener noreferrer" className="ml-2 font-extrabold underline">
            {a.linkLabel || "Read more"}
          </a>
        ) : null}
      </span>
      <button type="button" onClick={() => dismiss(a.id)} className="shrink-0 font-extrabold underline" aria-label={`Dismiss ${a.title}`}>
        Dismiss
      </button>
    </div>
  ));
};

export default AnnouncementBanner;

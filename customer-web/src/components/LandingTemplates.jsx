import React, { useEffect, useState } from "react";
import TableBookingModal from "./TableBookingModal";
import { getBookingSlots } from "../lib/api";
import ClassicPeddler from "./landing/ClassicPeddler";
import Citrus from "./landing/Citrus";
import NightMarket from "./landing/NightMarket";
import Garden from "./landing/Garden";
import Sunset from "./landing/Sunset";

/**
 * The five landing pages, ported from the Templates folder.
 *
 * Every photo, the restaurant's name and its address, phone and email come
 * from the restaurant (edited in the CSD under Website → Landing Page); only
 * the marketing copy has a per-design default (./landing/content.js). None of
 * them prints the whole menu: each shows the two or three featured dishes and
 * hands the customer on to the menu page.
 *
 * Keys must match LANDING_TEMPLATES in the backend model. Older keys are
 * translated in services/landingPayload.js so a store keeps the nearest design.
 */

const THEMES = {
  peddler: ClassicPeddler,
  citrus: Citrus,
  night: NightMarket,
  garden: Garden,
  sunset: Sunset,
};

export const TEMPLATE_KEYS = Object.keys(THEMES);

export default function LandingTemplate({ landing, store, menuPath, slug }) {
  const [booking, setBooking] = useState(null); // slots payload once known
  const [open, setOpen] = useState(false);

  // Asked up front so the button only appears on stores that take bookings.
  useEffect(() => {
    if (!slug) return undefined;
    let live = true;
    getBookingSlots(slug)
      .then(({ data }) => live && setBooking(data.data))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [slug]);

  // An unknown key means the database holds a template this build does not
  // ship yet -- a rollback, or a key added backend-first. Show the default
  // rather than a blank page.
  const Page = THEMES[landing?.template] || ClassicPeddler;
  return (
    <>
      <Page
        landing={landing}
        store={store}
        menuPath={menuPath}
        onBookTable={booking?.enabled ? () => setOpen(true) : null}
      />
      {open ? <TableBookingModal slug={slug} initial={booking} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

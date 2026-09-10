import React from "react";
import FineDining from "./landing/FineDining";
import FarmToTable from "./landing/FarmToTable";
import Omakase from "./landing/Omakase";
import CoastalBrunch from "./landing/CoastalBrunch";
import UrbanIzakaya from "./landing/UrbanIzakaya";

/**
 * The five landing pages.
 *
 * Five separate websites, not one website with five hero crops. Each file
 * under ./landing owns its own masthead, typeface, section order, footer and
 * treatment of the food, and they are meant to share as little as possible --
 * what they do share is in ./landing/kit.jsx and ./landing/data.js, and none
 * of it carries a look.
 *
 * They are five KINDS OF RESTAURANT rather than five colour schemes, because
 * that is what an owner is actually choosing between. Only one of the five is
 * light, only one leads with ordering rather than atmosphere, and only one
 * sets its food as a printed course list.
 *
 * None of them prints the whole menu. A landing page that lists every dish is
 * the ordering page with no basket, only slower -- so each shows the two or
 * three the operator picked in Manage Website and hands the customer on.
 *
 * Keys must match LANDING_TEMPLATES in the backend model. The five keys the
 * first attempt used are translated to these in services/landingPayload.js so
 * a store that chose one keeps the nearest design instead of being reset.
 */

const THEMES = {
  "fine-dining": FineDining,
  "farm-to-table": FarmToTable,
  "omakase": Omakase,
  "coastal-brunch": CoastalBrunch,
  "urban-izakaya": UrbanIzakaya,
};

export const TEMPLATE_KEYS = Object.keys(THEMES);

export default function LandingTemplate({ landing, store, menuPath }) {
  // An unknown key means the database holds a template this build does not
  // ship yet -- a rollback, or a key added backend-first. Show the default
  // rather than a blank page.
  const Page = THEMES[landing?.template] || FineDining;
  return <Page landing={landing} store={store} menuPath={menuPath} />;
}

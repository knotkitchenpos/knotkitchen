import React from "react";
import Heritage from "./landing/Heritage";
import BrandStory from "./landing/BrandStory";
import Artisan from "./landing/Artisan";
import FullScreen from "./landing/FullScreen";
import CardStack from "./landing/CardStack";

/**
 * The five landing pages.
 *
 * Five separate websites, not one website with five heroes. Each file under
 * ./landing owns its own masthead, section order, menu presentation, gallery
 * and footer, and they are meant to share as little as possible -- what they
 * do share is in ./landing/kit.jsx and carries no visual opinion.
 *
 * That is a deliberate amount of duplication. An earlier version styled one
 * shared page with a token object, and the result was five heroes on top of an
 * identical body: the same masthead, the same three-card row, the same product
 * grid, in the same order. Two restaurants that picked different templates got
 * the same website in different colours.
 *
 * The keys are stable and match LANDING_TEMPLATES in the backend model. They
 * are historical -- "hero-classic" is Heritage, "minimal-center" is Artisan --
 * and renaming them would mean migrating every store that has already chosen
 * one, which buys nothing a customer can see.
 */

const THEMES = {
  "hero-classic": Heritage,
  "split-showcase": BrandStory,
  "minimal-center": Artisan,
  "photo-fullbleed": FullScreen,
  "card-stack": CardStack,
};

export const TEMPLATE_KEYS = Object.keys(THEMES);

export default function LandingTemplate({ landing, store, menuPath }) {
  // An unknown key means the database holds a template this build does not
  // ship yet -- a rollback, or a key added backend-first. Show the default
  // rather than a blank page.
  const Page = THEMES[landing?.template] || Heritage;
  return <Page landing={landing} store={store} menuPath={menuPath} />;
}

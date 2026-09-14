import { featuredDishes, addressLines } from "./data";

/**
 * Everything a landing design prints, resolved once.
 *
 * Each value comes from what the restaurant set in the CSD (Website → Landing
 * Page), falling back to that design's own wording from the Templates folder.
 * The restaurant's name, address, phone, email and photos are always the
 * restaurant's own; only the marketing copy has a default.
 */

const u = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=80`;

export const DEFAULTS = {
  peddler: {
    kicker: "Freshly made, every day",
    headline: "Big flavour.",
    headlineAccent: "Handheld.",
    lead: "Freshly prepared food, generous portions and cold drinks made for the hungry, the curious, and the “just one more bite” crowd.",
    heroBadge: "100% fresh",
    heroNote: "made fresh for you",
    storyTitle: "Not just a meal.",
    storyAccent: "A little daily ritual.",
    storyText: "Generous fillings, fresh ingredients and sauces worth talking about. From a vegetarian favourite to a fully loaded classic, there is a reason to come back hungry.",
    features: ["Made to order", "Veg & non-veg", "Delivered fresh"],
    menuTitle: "Favourites,",
    menuAccent: "right this way.",
    ctaTitle: "Hungry already?",
    ctaLead: "Our online menu is live and ready when you are.",
    visitTitle: "Come by, or call ahead.",
    hoursText: "Freshly prepared,\ndelivered to you.",
    footerTagline: "Good food & good moods.",
    ctaText: "Browse the full menu",
    images: [u("photo-1525351484163-7529414344d8"), u("photo-1559847844-5315695dadae"), u("photo-1546793665-c74683f339c1"), u("photo-1540189549336-e6e99c3679fe")],
  },
  citrus: {
    kicker: "Freshly made, every day",
    headline: "Big flavour.",
    headlineAccent: "Handheld.",
    lead: "Freshly made food and bright comfort plates built for quick hunger, long conversations, and easy everyday cravings.",
    heroBadge: "100% fresh",
    storyTitle: "Not just a meal.",
    storyAccent: "A daily ritual.",
    storyText: "From loaded vegetarian favourites to rich classics, every plate is built with generous fillings, good bread and sauces that keep the taste going all the way through.",
    storyPanelLabel: "Fresh ingredients",
    storyPanelText: "Made with colour, crunch and comfort.",
    features: ["Made to order", "Veg & non-veg", "Always fresh"],
    menuTitle: "Best picks,",
    menuAccent: "straight from the kitchen.",
    ctaTitle: "Hungry already?",
    visitTitle: "Come by for lunch or a late craving.",
    hoursText: "Freshly prepared\nfor the hungry hour.",
    footerTagline: "Good food & good moods.",
    ctaText: "Browse menu",
    images: [u("photo-1525351484163-7529414344d8"), u("photo-1559847844-5315695dadae"), u("photo-1546793665-c74683f339c1"), u("photo-1540189549336-e6e99c3679fe")],
  },
  night: {
    kicker: "After dark",
    headline: "Late-night bites",
    headlineAccent: "with attitude.",
    lead: "Stacked plates, bright salads and comfort food made for the hungry hour when the city starts moving again.",
    heroBadge: "Fresh out",
    storyTitle: "Bold flavour,",
    storyAccent: "every round.",
    storyText: "Crisp greens, generous portions and warm, freshly made food that keeps every bite rich, warm and satisfying.",
    features: ["Chef made", "Loaded fillings", "Street-style fresh"],
    menuTitle: "House favourites,",
    menuAccent: "made to share.",
    ctaTitle: "Skip the wait.",
    visitTitle: "Good food, easy pickup.",
    hoursText: "Freshly made\nfor quick, tasty dinners.",
    footerTagline: "Big flavours. Bigger cravings.",
    ctaText: "Order now",
    images: [u("photo-1504674900247-0877df9cc836"), u("photo-1529042410759-befb1204b468"), u("photo-1547592180-85f173990554"), u("photo-1512621776951-a57141f2eefd")],
  },
  garden: {
    kicker: "Fresh from the garden",
    headline: "Clean bites.",
    headlineAccent: "Big joy.",
    lead: "Bright ingredients, lively flavours and hand-made favourites built for a relaxed lunch or an easy evening meal.",
    heroBadge: "Fresh pick",
    storyTitle: "Made for the hungry,",
    storyAccent: "and the health-conscious.",
    storyText: "We keep it honest: fresh herbs, crunchy vegetables, hearty grains and food that tastes like it was made in a good kitchen, not a rush.",
    features: ["Garden greens", "Whole ingredients", "Made daily"],
    menuTitle: "Fresh picks,",
    menuAccent: "made to order.",
    ctaTitle: "Fresh meals, easy ordering.",
    visitTitle: "Let’s make lunchtime lovely.",
    hoursText: "Prepared fresh\nwith real ingredients.",
    footerTagline: "Street-food spirit. Garden-fresh finish.",
    ctaText: "Order today",
    images: [u("photo-1490645935967-10de6ba17061"), u("photo-1559054663-e8d23213f55f"), u("photo-1529193591184-b1d58069ecdd"), u("photo-1543332164-6e82f355badc")],
  },
  sunset: {
    kicker: "Sunset comfort food",
    headline: "Feed the mood.",
    headlineAccent: "Own the craving.",
    lead: "Warm plates, fresh salads and generous portions made for quick lunches, spontaneous dinners and everything in between.",
    heroBadge: "Fresh today",
    heroChips: ["Hot & fresh", "Quick pickup"],
    storyTitle: "Comforting by nature,",
    storyAccent: "bright by design.",
    storyText: "Food you can trust, flavours you crave, and a quick, satisfying experience that feels personal from the first bite onward.",
    features: ["Made fresh", "Best sellers", "Delivered fast"],
    menuTitle: "Our crowd favourites,",
    menuAccent: "done right.",
    ctaTitle: "Ready for your next bite?",
    visitTitle: "Come by for a quick fix.",
    hoursText: "Freshly packed for\nyour lunch break.",
    footerTagline: "Good food & good moods.",
    ctaText: "See menu",
    images: [u("photo-1551782450-a2132b4ba21d"), u("photo-1528735602780-2552fd46c7af"), u("photo-1568901346375-23c9450c58cd"), u("photo-1546793665-c74683f339c1")],
  },
};

const pick = (value, fallback) => {
  const v = String(value ?? "").trim();
  return v || fallback;
};

const money = (symbol, n) => `${symbol}${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Resolve one design's text, photos, dishes and contact details. */
export function landingContent(key, landing = {}, store = null) {
  const d = DEFAULTS[key] || DEFAULTS.peddler;
  const copy = landing.copy || {};
  const symbol = store?.ordering?.currencySymbol || "₹";
  const contact = { ...(landing.contact || {}), ...(store?.contact || {}) };
  const name = pick(landing.name, store?.store?.name || "Our Restaurant");

  const dishes = featuredDishes(landing, store?.categories || [], 3).map((p, i) => ({
    id: String(p.id),
    name: p.name,
    text: p.description || "",
    image: p.image || d.images[i + 1] || d.images[1],
    tag: p.isVegetarian ? "Veg" : p.category || "Favourite",
    price: `${Array.isArray(p.variants) && p.variants.length > 1 ? "From " : ""}${money(symbol, p.price)}`,
  }));

  const featureTitles = [0, 1, 2].map((i) => pick(landing.features?.[i]?.title, d.features[i]));

  return {
    name,
    words: name.split(/\s+/),
    logo: landing.logo || "",
    kicker: pick(copy.kicker, d.kicker),
    headline: pick(copy.headline, d.headline),
    headlineAccent: pick(copy.headlineAccent, d.headlineAccent),
    lead: pick(copy.lead, d.lead),
    heroImage: landing.backgroundImage || dishes[0]?.image || d.images[0],
    heroAlt: landing.backgroundAlt || name,
    heroBadge: pick(copy.heroBadge, d.heroBadge),
    heroNote: pick(copy.heroNote, d.heroNote || ""),
    heroChips: d.heroChips || [],
    storyTitle: pick(copy.storyTitle, d.storyTitle),
    storyAccent: pick(copy.storyAccent, d.storyAccent),
    storyText: pick(landing.about?.text, d.storyText),
    storyPanelLabel: d.storyPanelLabel || "",
    storyPanelText: d.storyPanelText || "",
    features: featureTitles,
    menuTitle: pick(copy.menuTitle, d.menuTitle),
    menuAccent: pick(copy.menuAccent, d.menuAccent),
    ctaTitle: pick(copy.ctaTitle, d.ctaTitle),
    ctaLead: pick(copy.ctaLead, d.ctaLead || ""),
    ctaText: pick(copy.ctaText, d.ctaText),
    visitTitle: pick(copy.visitTitle, d.visitTitle),
    hoursLines: pick(copy.hoursText, d.hoursText).split(/\n/),
    footerTagline: pick(copy.footerTagline, d.footerTagline),
    dishes,
    address: addressLines(contact) || [],
    phone: String(contact.phone || "").trim(),
    email: String(contact.email || "").trim(),
  };
}

/** "tel:" href for a typed phone number. */
export const telHref = (phone) => `tel:${String(phone).replace(/[^\d+]/g, "")}`;

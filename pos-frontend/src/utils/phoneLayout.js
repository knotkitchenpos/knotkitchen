/**
 * Phone Screen Layout (Settings > Device Configuration): how many products a
 * row holds on a phone. Kept on this device, like its printer: two phones of
 * one store can differ. Tablets and computers keep their wider grid.
 */
export const PHONE_COLUMNS = [2, 3, 4];
const KEY = "kk.pos.phoneColumns";
export const LAYOUT_EVENT = "kk:phone-layout";

export const loadPhoneColumns = () => {
  try {
    const n = Number(localStorage.getItem(KEY));
    return PHONE_COLUMNS.includes(n) ? n : 2;
  } catch {
    return 2;
  }
};

export const savePhoneColumns = (n) => {
  const cols = PHONE_COLUMNS.includes(Number(n)) ? Number(n) : 2;
  try {
    localStorage.setItem(KEY, String(cols));
  } catch {
    /* private mode: this screen still uses it until reload */
  }
  try {
    window.dispatchEvent(new CustomEvent(LAYOUT_EVENT, { detail: { columns: cols } }));
  } catch {
    /* no window (tests) */
  }
  return cols;
};

/**
 * Classes for the product grid and its cards. Below `sm` (a phone) the
 * chosen count; from `sm` up, at least as many as before and never fewer than
 * the phone shows. Denser rows get a square photo, tighter spacing and
 * smaller type so a name and price still fit without clipping.
 * Literal class strings: Tailwind only builds classes it can find written out.
 */
export const GRID_LAYOUT = {
  2: {
    grid: "grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7",
    image: "aspect-[4/3]",
    body: "px-2.5 py-2",
    name: "text-[12.5px] min-h-[32px]",
    price: "text-[14px] mt-1",
    mark: "",
  },
  3: {
    grid: "grid-cols-3 gap-2 sm:gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7",
    image: "aspect-square sm:aspect-[4/3]",
    body: "px-2 py-1.5 sm:px-2.5 sm:py-2",
    name: "text-[11.5px] min-h-[28px] sm:text-[12.5px] sm:min-h-[32px]",
    price: "text-[12.5px] mt-0.5 sm:text-[14px] sm:mt-1",
    mark: "scale-90 origin-top-left sm:scale-100",
  },
  4: {
    grid: "grid-cols-4 gap-1.5 sm:gap-2.5 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7",
    image: "aspect-square sm:aspect-[4/3]",
    body: "px-1.5 py-1.5 sm:px-2.5 sm:py-2",
    name: "text-[10.5px] min-h-[26px] sm:text-[12.5px] sm:min-h-[32px]",
    price: "text-[11.5px] mt-0.5 sm:text-[14px] sm:mt-1",
    mark: "scale-75 origin-top-left sm:scale-100",
  },
};

export const gridLayout = (n) => GRID_LAYOUT[n] || GRID_LAYOUT[2];

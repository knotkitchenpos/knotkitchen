import React, { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import StorePage from "../../pages/StorePage";
import Message from "../../components/Message";
import SaveButton from "../components/SaveButton";
import LocationStrip from "../components/LocationStrip";
import StoreReviews from "../components/StoreReviews";
import ReplaceCartDialog from "../components/ReplaceCartDialog";
import { getEatsStore, startEatsCheckout, verifyEatsCheckout } from "../api";
import { useEatsLocation, useEatsPrefs } from "../../lib/eatsLocation";
import { deliveryBlockReason } from "../../lib/eatsFormat";
import { clearCartFor, guardCart } from "../../lib/eatsCart";
import { addRecentOrder } from "../../lib/eatsOrders";
import { bestCoupon, couponApplies, couponDiscount, couponNote } from "../../lib/eatsOffers";

/**
 * /store/:storeId on Knot Eats. The store website's own page (StorePage in
 * `eats` mode) with the menu, cart and checkout it always had; this adds what
 * Knot Eats brings from GET /api/eats/stores/:id: the listing check, the
 * Knot Eats fee, delivery to this customer, offers and reviews.
 *
 * Keyed by storeId so moving between stores starts clean (cart, payloads).
 */
export default function EatsStorePage() {
  const { storeId = "" } = useParams();
  if (!/^\d{6}$/.test(storeId)) return <NotListed />;
  return <EatsStore key={storeId} storeId={storeId} />;
}

function NotListed() {
  return (
    <Message icon="🍽️" iconSize="text-5xl" title="This restaurant isn't on Knot Eats right now">
      <Link to="/" className="font-semibold text-slate-800 underline underline-offset-2">
        Find restaurants near you
      </Link>
    </Message>
  );
}

function EatsStore({ storeId }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { location } = useEatsLocation();
  const { mode, veg } = useEatsPrefs();
  const [info, setInfo] = useState(null);
  const [missing, setMissing] = useState(false);
  const [replace, setReplace] = useState(null); // { from, resolve } while asking

  // In parallel with StorePage's own menu fetches; a new point re-quotes delivery.
  const lat = location?.lat;
  const lng = location?.lng;
  useEffect(() => {
    let live = true;
    getEatsStore(storeId, { lat, lng })
      .then((res) => live && setInfo(res.data.data))
      .catch((err) => {
        // Anything but "not listed" keeps the page: checkout quotes again.
        if (live && err.response?.status === 404) setMissing(true);
      });
    return () => {
      live = false;
    };
  }, [storeId, lat, lng]);

  const name = info?.store?.name || "";
  useEffect(() => {
    // A store's own policy page names itself (pages/LegalPage.jsx).
    if (!pathname.includes("/legal/")) document.title = `${name || "Restaurant"} | Knot Eats`;
  }, [name, pathname]);

  const confirmReplace = useCallback((from) => new Promise((resolve) => setReplace({ from, resolve })), []);
  const wrapCart = useCallback((cart) => guardCart(cart, { storeId, name }, confirmReplace), [storeId, name, confirmReplace]);

  // A diner back from paying still gets their order confirmed (and its status
  // link) even if the store was delisted while they were on the payment page.
  if (missing && !params.get("checkout")) return <NotListed />;

  const delivery = info?.delivery || null;
  const reason = info?.store && !info.store.delivery ? "This restaurant does not deliver." : deliveryBlockReason(delivery, location);

  const eats = {
    basePath: `/store/${storeId}`,
    startCheckout: startEatsCheckout,
    verifyCheckout: verifyEatsCheckout,
    onConfirmed: (order) => {
      addRecentOrder({ token: order.orderToken, orderNumber: order.orderNumber, storeName: name, storeId, placedAt: order.placedAt });
      clearCartFor(storeId);
      navigate(`/order/${order.orderToken}?placed=1`, { replace: true });
    },
    wrapCart,
    shellProps: {
      // The back link and the seller line live here, not in StoreShell, so
      // store websites never download them (§10.8 main-chunk budget).
      back: (
        <Link
          to="/"
          aria-label="Back to Knot Eats"
          className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </Link>
      ),
      headerActions: <SaveButton storeId={storeId} name={name || "this restaurant"} />,
      // Knot Eats' fee, not the website's; 0 until known (checkout quotes it again).
      orderingOverride: { platformFee: info?.platformFee ?? 0, deliveryFee: delivery?.fee ?? 0 },
      offers: (info?.offers || []).map((o) => ({ title: `${o.title} · ${o.subtitle}`, code: o.code })),
      cartProps: {
        renderOffers: info?.offers?.length ? (p) => <CartOffers offers={info.offers} {...p} /> : null,
        // An area chip is a centroid: fine to browse by, not a door to deliver to.
        deliveryPoint: location?.source !== "area" ? location : null,
        deliveryBlockedReason: reason,
        defaultOrderType: mode === "delivery" && delivery?.deliverable ? "delivery" : "pickup",
        platformFeeNote: "KnotKitchen's fee for using Knot Eats, incl. GST.",
        agreement: (
          <>
            By placing this order you agree to the{" "}
            <a href="/legal/terms" target="_blank" rel="noreferrer" className="underline">
              Knot Eats Terms
            </a>{" "}
            and the{" "}
            <a href={`/store/${storeId}/legal/terms`} target="_blank" rel="noreferrer" className="underline">
              restaurant&apos;s policies
            </a>
            .
          </>
        ),
      },
      belowInfo: (
        <>
          <LocationStrip location={location} delivery={delivery} reason={reason} />
          <StoreReviews storeId={storeId} rating={info?.store?.rating ?? null} ratingCount={info?.store?.ratingCount || 0} reviews={info?.reviews || []} />
        </>
      ),
      openDishId: params.get("dish") || "",
      openCart: params.get("cart") === "1",
      initialVegOnly: veg,
      // On a marketplace the customer is told who actually sells the food.
      seller: (legal) =>
        legal?.legalName ? (
          <p className="mt-2">
            Sold by {legal.legalName}
            {legal.address ? `, ${legal.address}` : ""}
            {legal.gstin ? ` · GSTIN ${legal.gstin}` : ""}
          </p>
        ) : null,
    },
  };

  return (
    <>
      <StorePage slug={storeId} eats={eats} />
      {replace ? (
        <ReplaceCartDialog
          fromName={replace.from.name}
          toName={name}
          onAnswer={(ok) => {
            replace.resolve(ok);
            setReplace(null);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The cart's offer row (CartDrawer `renderOffers`; it lives here so store
 * websites never download it). The best offer is applied until the customer
 * picks or removes one; a pick that stops applying (order type, subtotal)
 * drops out with the reason and comes back if the cart qualifies again.
 * Reports { code, discount } to the cart, which prices and sends it.
 */
function CartOffers({ offers, subtotal, orderType, symbol, pickedCode, onPick, onApplied }) {
  const args = { subtotal, orderType };
  const chosen = pickedCode === null ? bestCoupon(offers, args) : offers.find((o) => o.code === pickedCode) || null;
  const applied = chosen && couponApplies(chosen, args) ? chosen : null;
  const discount = applied ? couponDiscount(applied, subtotal) : 0;
  const note = couponNote(chosen, args);
  const code = applied?.code || "";

  useEffect(() => {
    onApplied(code ? { code, discount } : null);
  }, [code, discount, onApplied]);
  useEffect(() => () => onApplied(null), [onApplied]);

  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-3 text-sm">
      {applied ? (
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 font-medium text-[color:var(--ke-good,#15803D)]">
            Offer applied: −{symbol}
            {discount.toFixed(2)} <span className="font-normal text-slate-500">({code})</span>
          </span>
          <button type="button" onClick={() => onPick("")} className="min-h-[44px] shrink-0 px-1 font-semibold text-slate-700 underline">
            Remove
          </button>
        </div>
      ) : (
        <ul className="space-y-1">
          {offers.map((o) => (
            <li key={o.code} className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="font-semibold">{o.code}</span>{" "}
                <span className="text-slate-500">
                  {o.title} {o.subtitle}
                </span>
              </span>
              <button type="button" onClick={() => onPick(o.code)} className="min-h-[44px] shrink-0 px-1 font-semibold text-brand underline">
                Apply
              </button>
            </li>
          ))}
        </ul>
      )}
      {note ? <p className="mt-1 text-xs text-[color:var(--ke-ok,#B45309)]">{note}</p> : null}
    </div>
  );
}

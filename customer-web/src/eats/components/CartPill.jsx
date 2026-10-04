import React from "react";
import { Link } from "react-router-dom";
import { FOCUS } from "../shared";

/**
 * The basket waiting at one restaurant (eatsCart.getActiveCart), fixed to the
 * bottom of the list pages. The page adds bottom padding of the pill's height
 * so the last card is never under it.
 */
export default function CartPill({ cart }) {
  if (!cart) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[env(safe-area-inset-bottom)]">
      <Link
        to={`/store/${cart.storeId}?cart=1`}
        className={`pointer-events-auto mx-auto mb-3 flex max-w-xl items-center justify-between gap-3 rounded-xl bg-brand px-5 py-3 text-white shadow-xl ${FOCUS}`}
      >
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-bold">
            {cart.count} item{cart.count === 1 ? "" : "s"} in your cart
          </span>
          {cart.name ? <span className="block truncate text-[12px] opacity-90">from {cart.name}</span> : null}
        </span>
        <span className="shrink-0 text-[15px] font-bold">View cart ›</span>
      </Link>
    </div>
  );
}

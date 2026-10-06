import React from "react";

/** What the restaurant does after a store is created, shown on both creation screens. */
const NextSteps = ({ storeId }) => (
  <ol className="mx-auto mt-5 max-w-md list-inside list-decimal space-y-1.5 rounded-xl border border-navy-200 bg-white p-4 text-left text-sm text-navy-700">
    <li>
      The owner signs in at the POS with Store ID <span className="font-mono font-semibold">{storeId}</span> and
      creates a password using the owner phone.
    </li>
    <li>
      Recharges at least ₹3,000 in one payment, so the POS Plan (₹499 + GST where applicable, 30 days)
      starts and the rest stays in the wallet. Later top-ups are ₹1,000 or more.
    </li>
    <li>
      Adds add-ons (QR Table Ordering for tables and dine-in, Website yearly) and buys tablets or
      printers from Billing if wanted.
    </li>
  </ol>
);

export default NextSteps;

/* eslint-disable react/no-unescaped-entities -- legal prose keeps its apostrophes and quotation marks */
import React from "react";
import { Grievance, plural } from "./shared";

export default function Return({ L }) {
  return (
    <>
      <h2 id="return">Return Policy</h2>
      <h3>5.1 Prepared Food and Beverages</h3>
      <p>
        Given the perishable nature of prepared food and beverages, and consistent with standard practice recognised under
        the Consumer Protection (E-Commerce) Rules, 2020 for perishable and time-sensitive goods, items once delivered
        generally <strong>cannot be physically returned</strong> for hygiene, food-safety, and public health reasons.
        Concerns about a delivered food item are addressed as a refund request under the Refund &amp; Cancellation Policy,
        not as a physical return.
      </p>
      <h3>5.2 Non-Perishable / Retail Items (Where Sold)</h3>
      <p>
        Where the Restaurant also sells non-perishable retail items through this website (for example, packaged sauces,
        merchandise, gift hampers, or beverages in sealed packaging), the following return terms apply, unless a different
        period is displayed against the specific item:
      </p>
      <ul>
        <li>Return requests must be raised within {plural(L.returnWindowDays, "day")} of delivery.</li>
        <li>The item must be unused, unopened, and returned in its original packaging with all tags/seals intact.</li>
        <li>Perishable ingredients, customised items, and items marked "non-returnable" on the product listing are excluded.</li>
        <li>Return approval is at the Restaurant's sole discretion; KnotKitchen plays no role in inspecting, accepting, rejecting, or processing any returned item.</li>
        <li>
          Where a return is approved, the Customer is responsible for return shipping unless the return is due to a defect
          or an error by the Restaurant, in which case the Restaurant will bear reasonable return shipping cost.
        </li>
      </ul>
      <h3>5.3 Exchanges</h3>
      <p>
        Where offered by the Restaurant for eligible retail items, an exchange for a different size/variant follows the
        same eligibility conditions as a return under clause 5.2, and is subject to stock availability.
      </p>
      <h3>5.4 Processing of Approved Returns</h3>
      <p>
        Once a returned item is received and inspected by the Restaurant, any resulting refund follows the timeline and
        method set out in the Refund &amp; Cancellation Policy.
      </p>
      <Grievance L={L} />
    </>
  );
}

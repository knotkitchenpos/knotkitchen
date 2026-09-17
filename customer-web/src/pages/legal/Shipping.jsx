/* eslint-disable react/no-unescaped-entities -- legal prose keeps its apostrophes and quotation marks */
import React from "react";
import { Grievance } from "./shared";

export default function Shipping({ L }) {
  return (
    <>
      <h2 id="shipping">Shipping &amp; Delivery Policy</h2>
      <h3>6.1 Delivery Model Overview</h3>
      <p>Delivery of Orders placed on this website is fulfilled in one of two distinct models, clearly indicated to the Customer at checkout:</p>
      <div className="tbl">
        <table>
          <tbody>
            <tr>
              <th>Model</th>
              <th>Who delivers</th>
              <th>Who is responsible for what happens in transit</th>
            </tr>
            <tr>
              <td>Default: Restaurant's own delivery</td>
              <td>Restaurant's own riders/staff, or a third-party delivery/logistics service engaged directly by the Restaurant</td>
              <td>The Restaurant, in full, including conduct of its delivery personnel, handling, and timeliness</td>
            </tr>
            <tr>
              <td>Opt-in: KnotKitchen delivery service</td>
              <td>KnotKitchen, directly or through its own logistics partners, under a separate delivery service agreement with the Restaurant</td>
              <td>
                KnotKitchen, but strictly limited to safe and timely transport of the Order as packaged and handed over by
                the Restaurant, not the food's quality, packaging adequacy, or contents at handover
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>6.2 Restaurant's Own Delivery Staff (Default Model)</h3>
      <p>
        Where the Restaurant uses its own delivery staff, the Restaurant is solely responsible for: recruiting, training,
        and supervising its delivery personnel; ensuring delivery timelines are met; maintaining food temperature and
        hygiene during transit (e.g. insulated bags for hot food, leak-proof packaging); and the professional conduct of its
        delivery staff towards Customers. KnotKitchen bears no liability for any aspect of delivery carried out under this
        model.
      </p>
      <h3>6.3 Packaging Responsibility</h3>
      <p>
        The Restaurant is responsible for packaging all Orders in a manner appropriate to the item (leak-proof,
        spill-proof, temperature-appropriate, and tamper-evident where practicable) and in compliance with applicable food
        packaging and labelling regulations under the Food Safety and Standards Act, 2006. Where KnotKitchen's delivery
        service is used (clause 6.5), KnotKitchen's transport obligation begins only once the Order is handed over in
        Restaurant-sealed packaging, and KnotKitchen is not responsible for inadequate packaging by the Restaurant.
      </p>
      <h3>6.4 Delivery Timelines, Zones, and Charges</h3>
      <p>
        Estimated delivery times, serviceable delivery radius/zones, and delivery charges are set by the Restaurant (or,
        for Orders under the opt-in KnotKitchen delivery service, as agreed between the Restaurant and KnotKitchen and
        displayed accordingly) and shown to the Customer before checkout is completed. Estimated times are indicative only
        and are not a guaranteed delivery commitment; actual delivery time may vary due to traffic, weather, kitchen load,
        or delivery-partner availability.
      </p>
      <h3>6.5 KnotKitchen Delivery Service (Opt-In)</h3>
      <p>
        Where the Restaurant has separately and expressly requested it, KnotKitchen may provide delivery fulfilment for
        Orders, governed by a distinct delivery service agreement between the Restaurant and KnotKitchen. In that capacity:
      </p>
      <ol className="legal">
        <li>
          KnotKitchen's obligation is limited to picking up the Order from the Restaurant once it is packaged and ready, and
          transporting it to the delivery address provided by the Customer within a commercially reasonable time;
        </li>
        <li>
          KnotKitchen is not responsible for the food's quality, correctness, or condition at the point of pickup, nor for
          any packaging inadequacy by the Restaurant that later causes spillage, leakage, or temperature loss;
        </li>
        <li>
          KnotKitchen's delivery personnel will follow reasonable conduct standards (professional behaviour,
          contactless/verified handover where requested, basic care in transport), and any complaint about
          delivery-partner conduct specifically (as opposed to food quality) under this model may be raised with
          KnotKitchen's support contact in addition to the Restaurant; and
        </li>
        <li>
          Liability for genuine loss or damage caused directly by KnotKitchen's delivery service (for example, an item
          dropped or a significant unexplained delay solely attributable to the delivery rider) is limited to the delivery
          charge paid for that specific Order, save where a higher liability is separately agreed in writing.
        </li>
      </ol>
      <h3>6.6 Failed Delivery Attempts</h3>
      <p>
        Where delivery fails because the Customer provided an incorrect or incomplete address, was unreachable by phone, or
        was unavailable/refused to accept the Order at the time of attempted delivery, no refund is due under the Refund
        &amp; Cancellation Policy, and any re-delivery attempt and associated charge is at the Restaurant's (or, under the
        opt-in model, the Restaurant's and KnotKitchen's joint) discretion.
      </p>
      <h3>6.7 Order Tracking</h3>
      <p>
        Where technically enabled, Customers may track Order status (preparing, out for delivery, delivered) through the
        website. Real-time rider location tracking, where offered, is provided as a convenience feature and its continuous
        availability is not guaranteed.
      </p>
      <h3>6.8 Shipping of Non-Food/Retail Items</h3>
      <p>
        Where the Restaurant also ships non-perishable retail items, the same allocation of responsibility applies: the
        Restaurant is responsible for correct packaging and dispatch readiness; transit responsibility rests with whichever
        party, the Restaurant's own courier arrangement or KnotKitchen's delivery service, is actually handling that
        specific shipment, on the same terms as clauses 6.2 to 6.5.
      </p>
      <Grievance L={L} />
    </>
  );
}

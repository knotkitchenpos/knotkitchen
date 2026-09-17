/* eslint-disable react/no-unescaped-entities -- legal prose keeps its apostrophes and quotation marks */
import React from "react";
import { Grievance, plural } from "./shared";

export default function Refund({ L }) {
  return (
    <>
      <h2 id="refund">Refund &amp; Cancellation Policy</h2>
      <div className="callout">
        All refund and cancellation decisions, and their execution, are made solely by the Restaurant through its own
        Payment Gateway account. KnotKitchen has no authority over refund or cancellation outcomes, does not hold Customer
        funds, and bears no liability for delay or refusal of a refund.
      </div>
      <h3>4.1 Order Cancellation by the Customer</h3>
      <p>
        A Customer may request cancellation of an Order only before the Restaurant has begun preparation, by contacting the
        Restaurant directly at {L.phone ? <a href={`tel:${String(L.phone).replace(/[^\d+]/g, "")}`}>{L.phone}</a> : "the number shown on this website"} or
        through the website's cancellation option, where available. Once preparation has commenced, cancellation, and any
        associated refund, is entirely at the Restaurant's discretion, given that ingredients and labour have already been
        committed.
      </p>
      <h3>4.2 Order Cancellation by the Restaurant</h3>
      <p>
        The Restaurant may cancel an Order at any stage due to item unavailability, kitchen capacity constraints,
        delivery-area limitations, a pricing/listing error, or suspected fraud. Where an Order is cancelled by the
        Restaurant after payment has been captured, the full amount paid for that Order will be refunded in accordance with
        clause 4.5.
      </p>
      <h3>4.3 Grounds for a Post-Delivery Refund</h3>
      <p>Refunds after delivery are considered by the Restaurant, at its discretion, for genuine and promptly reported issues including:</p>
      <ul>
        <li>the Order was not delivered at all despite payment being captured;</li>
        <li>a materially wrong item was delivered in place of what was ordered;</li>
        <li>an item was missing from the Order as delivered;</li>
        <li>a genuine, verifiable food quality or safety issue (e.g. spoiled item, foreign object, evident undercooking) reported promptly; or</li>
        <li>a duplicate or erroneous charge for the same Order.</li>
      </ul>
      <h3>4.4 How to Raise a Refund Request</h3>
      <p>
        Refund requests must be raised within {plural(L.refundWindowHours, "hour")} of delivery (or of the scheduled
        delivery time, if the Order never arrived), by contacting{" "}
        {L.email ? <a href={`mailto:${L.email}`}>{L.email}</a> : null}
        {L.email && L.phone ? " or " : ""}
        {L.phone ? <a href={`tel:${String(L.phone).replace(/[^\d+]/g, "")}`}>{L.phone}</a> : null}
        {!L.email && !L.phone ? "the Restaurant" : ""} with the Order ID, a description of the issue, and, where
        applicable, a photograph of the item/packaging as received. The Restaurant will acknowledge the request within{" "}
        {plural(L.refundAckHours, "hour")} and communicate its decision within {plural(L.refundDecisionDays, "business day")}.
      </p>
      <h3>4.5 Refund Method and Timeline</h3>
      <p>
        Approved refunds are processed by the Restaurant through the same Payment Gateway and payment method originally
        used for the transaction, within {plural(L.refundProcessingDays, "business day")} of approval, subject to the
        Payment Gateway's own settlement and reversal timelines, over which neither the Restaurant nor KnotKitchen has
        control. Where a Customer paid by cash on delivery, any approved refund will be processed by a method mutually
        agreed with the Restaurant (e.g. bank transfer or UPI). KnotKitchen does not itself hold, disburse, or guarantee the
        timing of any refund; where the Restaurant requests technical assistance operating its Payment Gateway dashboard to
        action a refund, KnotKitchen's role is limited to that technical facilitation.
      </p>
      <h3>4.6 Partial Refunds</h3>
      <p>
        Where only part of an Order is affected (e.g. one missing item out of several), the Restaurant may, at its
        discretion, issue a partial refund proportionate to the affected item(s) rather than the full Order value.
      </p>
      <h3>4.7 Non-Refundable Situations</h3>
      <p>
        No refund is ordinarily due where: the Customer provided an incorrect or incomplete delivery address; the Customer
        was unavailable, unreachable, or refused to accept delivery at the address provided; the request reflects a change
        of mind after food preparation had already begun; the complaint is raised after the window specified in clause 4.4;
        or the item was consumed in whole or substantial part before the complaint was raised (except in the case of a
        food-safety complaint, where partial consumption before discovering the issue does not itself bar a refund).
      </p>
      <h3>4.8 Escalation</h3>
      <p>
        If a Customer is dissatisfied with the Restaurant's refund decision, the Customer may escalate to the Grievance
        Officer named below, and thereafter, where applicable, to the consumer dispute redressal forum having jurisdiction
        under the Consumer Protection Act, 2019.
      </p>
      <Grievance L={L} />
    </>
  );
}

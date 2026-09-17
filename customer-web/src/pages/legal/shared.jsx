/* eslint-disable react/no-unescaped-entities -- legal prose keeps its apostrophes and quotation marks */
import React from "react";

export const plural = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** The grievance-officer block every policy ends with. */
export function Grievance({ L }) {
  const g = L.grievance || {};
  return (
    <>
      <h2 id="grievance">Grievance Redressal</h2>
      <p>
        In accordance with the Consumer Protection Act, 2019, the Consumer Protection (E-Commerce) Rules, 2020, and the
        Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, the following Grievance
        Officer has been appointed to address Customer complaints relating to orders, food quality, billing, refunds,
        returns, delivery, and data privacy:
      </p>
      <div className="contact-box">
        <b>Grievance Officer (Restaurant: order, food, refund and privacy complaints)</b>
        Name: {g.name || "—"}
        <br />
        Restaurant: {L.restaurantName}
        <br />
        Address: {L.address || "—"}
        <br />
        Email: {g.email ? <a href={`mailto:${g.email}`}>{g.email}</a> : "—"} &nbsp;|&nbsp; Phone:{" "}
        {g.phone ? <a href={`tel:${String(g.phone).replace(/[^\d+]/g, "")}`}>{g.phone}</a> : "—"}
        <br />
        Hours: {g.hours}
        <br />
        Response commitment: acknowledgement within 48 hours; resolution, wherever reasonably possible, within 30 days,
        consistent with timelines expected under applicable consumer protection law.
      </div>
      <p>
        Complaints solely about website functionality, technical errors, page downtime, or a data security incident
        attributable specifically to the hosting infrastructure, rather than to the Restaurant's own conduct, may
        separately and additionally be addressed to KnotKitchen
        {L.knotkitchenSupportEmail ? (
          <>
            {" "}
            at <a href={`mailto:${L.knotkitchenSupportEmail}`}>{L.knotkitchenSupportEmail}</a>
          </>
        ) : null}
        . Complaints about the conduct of a KnotKitchen delivery rider under the opt-in delivery model may also be raised
        with KnotKitchen directly.
      </p>
      <p>
        Where a Customer remains dissatisfied after escalation, they may approach the National Consumer Helpline (1915 /
        UMANG app), the E-Daakhil online consumer complaint portal, or the appropriate District/State Consumer Disputes
        Redressal Commission having jurisdiction, without prejudice to any other remedy available in law.
      </p>
    </>
  );
}

/** Definitions shared by the terms. */
export function Definitions({ L }) {
  return (
    <>
      <h2 id="definitions">1. Roles &amp; Definitions (Read This First)</h2>
      <p>
        This clause governs the interpretation of every other clause on this website, on any order confirmation, invoice,
        or communication issued through this website. Wherever a defined term below appears elsewhere, it carries the
        meaning given here.
      </p>
      <h3>1.1 Parties</h3>
      <div className="tbl">
        <table>
          <tbody>
            <tr>
              <th>Term</th>
              <th>Meaning</th>
            </tr>
            <tr>
              <td>
                <strong>"Platform Provider" / "KnotKitchen"</strong>
              </td>
              <td>
                KnotKitchen, which designs, develops, hosts, secures, and technically maintains this website and its
                underlying software infrastructure on behalf of the Restaurant, under a separate onboarding/service
                agreement with the Restaurant. KnotKitchen is an "intermediary" within the meaning of Section 2(1)(w) of
                the Information Technology Act, 2000 and does not itself sell food, own inventory, set menu prices, accept
                or reject orders, or fulfil orders.
              </td>
            </tr>
            <tr>
              <td>
                <strong>"Restaurant" / "Seller" / "Merchant of Record"</strong>
              </td>
              <td>
                {L.legalName || L.restaurantName}
                {L.legalName && L.legalName !== L.restaurantName ? ` (trading as ${L.restaurantName})` : ""}, a business
                operating from {L.address || "the address shown on this website"}, holding FSSAI Licence/Registration No.{" "}
                {L.fssaiNumber || "as displayed at the premises"} and GSTIN {L.gstin || "not applicable (not GST registered)"}.
                The Restaurant is the Food Business Operator ("FBO") under the Food Safety and Standards Act, 2006, the
                seller of record for every transaction on this website, and the party legally and commercially responsible
                for the goods and services sold.
              </td>
            </tr>
            <tr>
              <td>
                <strong>"Customer" / "User" / "You"</strong>
              </td>
              <td>Any individual who browses, registers on, or places an order through this website.</td>
            </tr>
            <tr>
              <td>
                <strong>"Payment Gateway"</strong>
              </td>
              <td>
                The RBI-authorised third-party payment aggregator/payment system operator selected and onboarded
                independently by the Restaurant (for example, Cashfree, PhonePe, Razorpay, or any other gateway of the
                Restaurant's own choosing) through which all Customer payments are processed. KnotKitchen only integrates
                the Restaurant's chosen gateway into the website's checkout flow; it does not operate, hold, or have custody
                of any funds.
              </td>
            </tr>
            <tr>
              <td>
                <strong>"Delivery Partner"</strong>
              </td>
              <td>
                Either (a) the Restaurant's own delivery staff/riders/aggregator arrangement, which is the default model, or
                (b) where the Restaurant has separately and expressly opted in, KnotKitchen's own delivery fulfilment
                service under the Shipping &amp; Delivery Policy.
              </td>
            </tr>
            <tr>
              <td>
                <strong>"Order"</strong>
              </td>
              <td>
                A request for food, beverages, or (where applicable) retail items placed by a Customer through this website
                and accepted by the Restaurant.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>1.2 How to Read "We," "Our," and "Us" on This Website</h3>
      <p>
        Because this website is jointly authored by the Restaurant's own content and KnotKitchen's platform
        infrastructure, the pronouns "we," "our," and "us" shift meaning by context, as follows:
      </p>
      <ol className="legal">
        <li>
          In relation to <strong>food quality, ingredients, allergens, menu pricing, order acceptance/rejection, refunds,
          cancellations, returns, FSSAI compliance, GST/billing, and delivery carried out by the Restaurant's own staff</strong>,
          "we/our/us" means the <strong>Restaurant</strong> exclusively.
        </li>
        <li>
          In relation to <strong>website availability, uptime, page functionality, checkout integration, data hosting, and
          technical security of the site</strong>, "we/our/us" means <strong>KnotKitchen</strong> exclusively.
        </li>
        <li>
          In relation to <strong>payment processing itself (as opposed to the checkout page's appearance)</strong>,
          "we/our/us" refers to the <strong>Payment Gateway</strong>, a party independent of both the Restaurant and
          KnotKitchen.
        </li>
        <li>
          Where delivery is fulfilled under the opt-in KnotKitchen delivery service, "we/our/us" in that narrow context
          refers to <strong>KnotKitchen acting purely as a logistics provider</strong>, and not as the seller of the food
          being transported.
        </li>
      </ol>
      <p>
        This allocation is disclosed prominently so that no Customer is misled as to which party bears responsibility for
        which aspect of their order, a requirement consistent with fair disclosure norms under the Consumer Protection Act,
        2019 and the Consumer Protection (E-Commerce) Rules, 2020.
      </p>
    </>
  );
}

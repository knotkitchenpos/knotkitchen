/* eslint-disable react/no-unescaped-entities -- legal prose keeps its apostrophes and quotation marks */
import React, { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import "../../pages/legal.css";

/**
 * Knot Eats' own policies at /legal/:key: terms, privacy, refunds and
 * grievance. A restaurant's five policies stay at /store/<id>/legal/* (the
 * store website's pages/LegalPage.jsx); these cover only what KnotKitchen
 * does as the platform. Static on purpose: no API, nothing per store.
 *
 * NOT FINAL: the owner or legal approves all four pages, and supplies the
 * entity's registered address and the grievance officer, before the Knot
 * Eats fee is switched on (contract §12, §15 step 4). Until then the blanks
 * below fall back to KnotKitchen support.
 */
const EATS_LEGAL = {
  entityName: "KnotKitchen",
  address: "", // §15: registered address, from the owner
  email: "support@knotkitchen.com",
  phone: "+91 8062181049",
  grievanceOfficer: {
    name: "", // §15: from the owner
    designation: "Grievance Officer",
    email: "support@knotkitchen.com",
    phone: "+91 8062181049",
  },
};

const PAGES = [
  { key: "terms", title: "Knot Eats Terms of Use", Body: Terms },
  { key: "privacy", title: "Knot Eats Privacy Policy", Body: Privacy },
  { key: "refunds", title: "Refunds & Cancellations", Body: Refunds },
  { key: "grievance", title: "Grievance Redressal", Body: Grievance },
];

const tel = (p) => `tel:${p.replace(/[^\d+]/g, "")}`;

export default function EatsLegalPage() {
  const { key = "" } = useParams();
  const page = PAGES.find((p) => p.key === key);

  useEffect(() => {
    document.title = `${page ? page.title : "Page not found"} | Knot Eats`;
  }, [page]);

  return (
    <div className="kk-legal">
      <div className="wrap">
        <Link className="back" to="/">
          ← Back to Knot Eats
        </Link>
        <h1>{page ? page.title : "Page not found"}</h1>
        <p className="sub">
          Knot Eats (eats.knotkitchen.com) is run by {EATS_LEGAL.entityName}
          {EATS_LEGAL.address ? `, ${EATS_LEGAL.address}` : ""}.
        </p>
        <div className="toc-title">Policies</div>
        <nav aria-label="Knot Eats policies">
          {PAGES.map((p) => (
            <Link key={p.key} to={`/legal/${p.key}`} className={p.key === key ? "on" : ""}>
              {p.title}
            </Link>
          ))}
        </nav>
        {page ? <page.Body /> : <p>The policy you asked for does not exist.</p>}
        <footer>
          © {new Date().getFullYear()} {EATS_LEGAL.entityName}. Questions: <a href={`mailto:${EATS_LEGAL.email}`}>{EATS_LEGAL.email}</a> ·{" "}
          <a href={tel(EATS_LEGAL.phone)}>{EATS_LEGAL.phone}</a>
        </footer>
      </div>
    </div>
  );
}

function Terms() {
  return (
    <>
      <h2>1. What Knot Eats is</h2>
      <p>
        {EATS_LEGAL.entityName} ("KnotKitchen") runs Knot Eats as a technology platform: an intermediary under the
        Information Technology Act, 2000. Knot Eats lists restaurants that use KnotKitchen and lets you order from them.
        KnotKitchen does not cook, sell, pack or deliver food.
      </p>
      <h2>2. The restaurant is the seller</h2>
      <p>
        Every order is a contract of sale between you and the restaurant you order from. The restaurant prepares and packs
        your food, and either delivers it with its own staff or hands it over when you pick it up. The restaurant is
        responsible for the food, its safety and labelling, its invoice and its taxes. Its name, address and licence
        numbers are shown at the foot of its store page, with its own policies.
      </p>
      <h2>3. Prices, menu and availability</h2>
      <p>
        The restaurant sets its prices, menu, opening hours, delivery area and delivery fee, and may change them. Distances
        and times shown on Knot Eats are estimates.
      </p>
      <h2>4. Payment</h2>
      <p>
        You pay before your order is placed. Payment goes to the restaurant's own payment gateway account; KnotKitchen
        does not receive or hold your payment for the food.
      </p>
      <h2>5. Platform fee</h2>
      <p>
        The <strong>Platform fee</strong> is KnotKitchen's charge for using Knot Eats. It is shown as its own line in your
        cart before you pay, includes any GST, and is collected with your order payment and passed on to KnotKitchen. If
        the restaurant rejects or cancels your order, the Platform fee is refunded with the rest of your payment.
      </p>
      <h2>6. Offers and coupons</h2>
      <p>
        Coupons shown on Knot Eats are issued and funded by the restaurant, on the restaurant's terms (minimum order, days,
        times, order type, limits per phone number). The amount off is confirmed when you check out.
      </p>
      <h2>7. Reviews</h2>
      <p>
        You can rate an order you received. Reviews must be honest, about your own order, and lawful: no abuse, threats,
        hate, other people's personal details, or links. KnotKitchen may hide a review that breaks these rules. A review
        shows your first name and the initial of your last name.
      </p>
      <h2>8. Governing law</h2>
      <p>
        These terms are governed by the laws of India. Subject to any consumer forum whose jurisdiction cannot be
        excluded, the courts at Kolkata, West Bengal have jurisdiction.
      </p>
      <h2>9. Questions and complaints</h2>
      <p>
        See <Link to="/legal/grievance">Grievance Redressal</Link>.
      </p>
    </>
  );
}

function Privacy() {
  return (
    <>
      <h2>1. What we collect</h2>
      <p>
        When you order: your name, phone number, delivery address and the delivery location point you set, and the
        details of your order.
      </p>
      <h2>2. Your location while browsing</h2>
      <p>
        The location you choose is used to find restaurants near you and work out distances. It is sent rounded (to about
        100 metres) and is not stored. Only the delivery point of an order you place is saved, on that order, so the
        restaurant can deliver it.
      </p>
      <h2>3. Kept on your device</h2>
      <p>
        Your browser keeps your saved restaurants, your recent orders, your cart and your last location in its local
        storage. Clearing your browser's site data removes them.
      </p>
      <h2>4. Who we share it with</h2>
      <ul>
        <li>
          <strong>The restaurant</strong> you order from, to prepare, deliver and contact you about your order. It may keep
          you in its own customer list.
        </li>
        <li>
          <strong>The restaurant's payment gateway</strong> (Cashfree), to take your payment.
        </li>
        <li>
          <strong>Google</strong>, for address search and distances (see{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Google's Privacy Policy
          </a>
          ).
        </li>
      </ul>
      <h2>5. What we don't do</h2>
      <p>There are no third-party analytics or advertising trackers on Knot Eats.</p>
      <h2>6. Reviews</h2>
      <p>A review you post shows your first name and the initial of your last name, never your phone number.</p>
      <h2>7. How long we keep it</h2>
      <p>
        As set out in{" "}
        <a href="https://knotkitchen.com/privacy.html" target="_blank" rel="noreferrer">
          KnotKitchen's Privacy Policy
        </a>
        : for as long as reasonably necessary to provide the service, keep business and transaction records, resolve
        disputes and meet legal obligations.
      </p>
      <h2>8. Contact</h2>
      <p>
        Write to our <Link to="/legal/grievance">Grievance Officer</Link>.
      </p>
    </>
  );
}

function Refunds() {
  return (
    <>
      <h2>1. Paid first, placed after</h2>
      <p>
        You pay before your order is placed, and the order reaches the restaurant only after the payment is confirmed. If
        a payment fails, no order is placed.
      </p>
      <h2>2. Rejected or cancelled by the restaurant</h2>
      <p>
        You get a full refund, including the Platform fee, to the payment method you used, on your payment gateway's
        timeline.
      </p>
      <h2>3. Food quality, missing items and delivery</h2>
      <p>
        The restaurant sells and delivers your food, so contact it first: its phone number is on your order page and its
        refund and cancellation policy is linked on its store page. If it is not resolved, contact our{" "}
        <Link to="/legal/grievance">Grievance Officer</Link>.
      </p>
    </>
  );
}

function Grievance() {
  const g = EATS_LEGAL.grievanceOfficer;
  return (
    <>
      <p>
        Under the Consumer Protection (E-Commerce) Rules, 2020, complaints about Knot Eats can be sent to our Grievance
        Officer:
      </p>
      <div className="contact-box">
        <b>{g.name ? `${g.name}, ${g.designation}` : g.designation}</b>
        {EATS_LEGAL.entityName}
        {EATS_LEGAL.address ? `, ${EATS_LEGAL.address}` : ""}
        <br />
        Email: <a href={`mailto:${g.email}`}>{g.email}</a> &nbsp;|&nbsp; Phone: <a href={tel(g.phone)}>{g.phone}</a>
      </div>
      <p>
        We acknowledge a complaint within 48 hours and resolve it within one month of receiving it.
      </p>
      <p>
        If you remain dissatisfied, you can approach the National Consumer Helpline (1915) or the appropriate Consumer
        Disputes Redressal Commission.
      </p>
    </>
  );
}

/* eslint-disable react/no-unescaped-entities -- legal prose keeps its apostrophes and quotation marks */
import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { LEGAL_PAGES, legalPage } from "../lib/legalPages";
import { legalPath } from "../lib/landingRoute";
import "./legal.css";

/**
 * The five legal pages of a restaurant website: Terms & Conditions, Privacy
 * Policy, Refund & Cancellation Policy, Return Policy, Shipping & Delivery
 * Policy.
 *
 * One body of policy text, split into five pages, with every restaurant
 * specific value read from the storefront payload's `legal` block: the
 * restaurant's name, address, FSSAI and GST numbers, phone and email come
 * from the POS; the refund windows, the grievance officer and the
 * jurisdiction are set in Manage Website > Legal. Nothing here is typed per
 * restaurant. KnotKitchen's role is confined throughout to the technology
 * provider: never the seller, the food business operator, the payment
 * collector, nor (unless separately contracted) the delivery agent.
 */

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : "";

const plural = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;

function Grievance({ L }) {
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

function Definitions({ L }) {
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

function Terms({ L }) {
  return (
    <>
      <Definitions L={L} />
      <h2 id="terms">2. Terms &amp; Conditions</h2>
      <h3>2.1 Acceptance of Terms</h3>
      <p>
        By accessing this website, creating an account, browsing the menu, or placing an Order, you confirm that you have
        read, understood, and agree to be bound by these Terms &amp; Conditions in full, along with the Privacy Policy,
        Refund &amp; Cancellation Policy, Return Policy, and Shipping &amp; Delivery Policy published on this website, each
        of which is incorporated by reference. If you do not agree, you must not use this website or place an Order.
      </p>
      <h3>2.2 Eligibility</h3>
      <p>
        You must be at least 18 years of age, or the age of majority in your jurisdiction, to place an Order or make a
        payment on this website. Where alcohol or age-restricted items are listed (only where lawfully permitted and
        licensed), the Restaurant reserves the right to verify age at the point of delivery and to refuse handover, without
        refund, where valid proof of age cannot be produced, in accordance with applicable excise and state licensing laws.
      </p>
      <h3>2.3 Nature of the Website and the Platform Relationship</h3>
      <p>
        This website is commercially owned and operated by the Restaurant. It has been built, is hosted, and is technically
        maintained by KnotKitchen as a website-as-a-service and technology infrastructure provider under a separate
        agreement between KnotKitchen and the Restaurant. KnotKitchen is not a party to, and assumes no obligations under,
        any contract of sale formed between a Customer and the Restaurant. That contract of sale is formed exclusively
        between the Customer and the Restaurant at the moment an Order is confirmed by the Restaurant, and all rights and
        obligations arising from it (delivery of conforming goods, payment, refund, warranty, etc.) rest between those two
        parties alone.
      </p>
      <h3>2.4 Food Quality, Safety, Allergens, and Menu Accuracy</h3>
      <p>The Restaurant is solely and exclusively responsible for:</p>
      <ol className="legal">
        <li>The quality, freshness, hygiene, temperature control, and overall safety of all food and beverages prepared and sold;</li>
        <li>
          The accuracy of menu descriptions, ingredient lists, allergen disclosures, spice-level indications, and any
          nutritional or dietary claims (e.g. "vegan," "gluten-free," "jain," "halal");
        </li>
        <li>
          Holding and renewing a valid FSSAI registration/licence appropriate to its scale of operation, and complying
          with the Food Safety and Standards Act, 2006 and all rules and regulations made under it, including packaging and
          labelling regulations;
        </li>
        <li>
          Compliance with applicable municipal trade licences, fire safety, health department, and local body requirements
          for operating a food business; and
        </li>
        <li>Maintaining appropriate food-handling training and hygiene practices among its kitchen and packing staff.</li>
      </ol>
      <p>
        KnotKitchen has no role whatsoever in food sourcing, preparation, cooking, plating, packaging, or storage, and
        exercises no supervision or quality control over any of these activities. Accordingly, KnotKitchen bears no
        liability, whether in contract, tort, or under statute, for any claim arising from or connected to food poisoning,
        allergic reaction, contamination, spoilage, mislabelling, incorrect allergen disclosure, or any other
        food-safety-related harm. Any such claim must be pursued against the Restaurant.
      </p>
      <h3>2.5 Order Placement, Acceptance, and Pricing</h3>
      <p>
        Placing an Order through this website constitutes an offer by the Customer to purchase, which is accepted only when
        the Restaurant confirms the Order (whether by automated confirmation or otherwise). The Restaurant reserves the
        right, at its sole discretion, to refuse, delay, or cancel any Order, including after payment, for reasons including
        but not limited to: item unavailability, kitchen capacity constraints, a suspected pricing or listing error,
        suspected fraudulent activity, or an inability to service the delivery location. Where an Order is cancelled by the
        Restaurant after payment, the amount paid will be refunded in accordance with the Refund &amp; Cancellation Policy.
        All menu prices, applicable taxes (including GST where the Restaurant is registered), packaging charges,
        platform/convenience fees (if any), and delivery charges are determined solely by the Restaurant (or, for delivery
        charges under the opt-in KnotKitchen delivery service, as agreed between the Restaurant and KnotKitchen) and are
        displayed to the Customer prior to checkout.
      </p>
      <h3>2.6 Payments</h3>
      <p>
        All Customer payments are processed exclusively through the Payment Gateway integrated into this website at the
        Restaurant's own selection and instruction. The Payment Gateway is a regulated payment aggregator/payment system
        operator authorised under the Payment and Settlement Systems Act, 2007 and operating under applicable Reserve Bank
        of India guidelines for payment aggregators. In relation to payments:
      </p>
      <ol className="legal">
        <li>
          KnotKitchen does not process, receive, hold, have custody of, or have access to Customer payment instrument data,
          including card numbers, UPI IDs/credentials, net-banking credentials, or wallet balances;
        </li>
        <li>
          KnotKitchen is not a party to the payment transaction between the Customer, the Restaurant, and the Payment
          Gateway, and receives no share of transaction value except any technology/platform fee separately agreed between
          KnotKitchen and the Restaurant, which is unrelated to and does not affect the Customer;
        </li>
        <li>
          KnotKitchen bears no responsibility or liability for payment failures, delayed settlement to the Restaurant,
          gateway downtime, incorrect debits, double charges, or any dispute arising from the Payment Gateway's own terms
          of service, chargeback policy, or technical performance; and
        </li>
        <li>
          Any transaction-level dispute (failed payment, amount debited but Order not confirmed, duplicate charge) must be
          raised directly with the Restaurant and, where necessary, escalated by the Restaurant to the Payment Gateway,
          whose own grievance mechanism will apply.
        </li>
      </ol>
      <h3>2.7 KnotKitchen's Role and Limitation of Liability</h3>
      <p>
        KnotKitchen's obligations to Customers, to the extent any exist at all, are limited strictly to: (a) making
        reasonable efforts to keep the website's core ordering functionality operative; (b) implementing reasonable
        security practices for data hosted on the website's infrastructure, consistent with Section 43A of the Information
        Technology Act, 2000 and the Information Technology (Reasonable Security Practices and Procedures and Sensitive
        Personal Data or Information) Rules, 2011; and (c) where separately and expressly contracted by the Restaurant,
        providing delivery fulfilment services strictly as described in the Shipping &amp; Delivery Policy. Except as
        expressly stated in this clause, and to the fullest extent permitted under Indian law, KnotKitchen expressly
        disclaims all liability, whether direct, indirect, incidental, consequential, or otherwise, for:
      </p>
      <ul>
        <li>food quality, hygiene, safety, or fitness for consumption;</li>
        <li>the accuracy of menu, pricing, allergen, or promotional information supplied by the Restaurant;</li>
        <li>order acceptance, rejection, delay, or fulfilment decisions made by the Restaurant;</li>
        <li>refund, cancellation, or return decisions and their execution;</li>
        <li>any act, omission, negligence, or misconduct of the Restaurant, its employees, or its own delivery staff;</li>
        <li>any act, omission, or service failure of the Payment Gateway or any other third party chosen by the Restaurant; and</li>
        <li>any indirect or consequential loss (event disruption, reputational harm, etc.) arising from any of the above.</li>
      </ul>
      <p>
        Nothing in this clause excludes liability that cannot lawfully be excluded under Indian law, or liability arising
        directly and solely from KnotKitchen's own gross negligence or wilful default in securing or hosting the website's
        core infrastructure. Where any liability of KnotKitchen is found to exist notwithstanding the above, such liability
        shall in any event be limited to the technology/platform fee actually paid by the Restaurant to KnotKitchen in the
        one (1) month preceding the event giving rise to the claim, and shall exclude any indirect, incidental, or
        consequential damages.
      </p>
      <h3>2.8 Restaurant's Indemnity to KnotKitchen</h3>
      <p>
        The Restaurant agrees to indemnify, defend, and hold harmless KnotKitchen, and its officers, directors, employees,
        and affiliates, from and against any and all claims, demands, losses, damages, liabilities, penalties, fines, and
        reasonable legal costs (including advocate's fees) arising out of or in any way connected with:
      </p>
      <ol className="legal">
        <li>food quality, safety, hygiene, or FSSAI non-compliance;</li>
        <li>inaccurate, misleading, or non-compliant menu, pricing, allergen, or promotional information;</li>
        <li>any dispute with, or failure of, the Payment Gateway chosen by the Restaurant;</li>
        <li>any refund, cancellation, or return decision made (or not made) by the Restaurant;</li>
        <li>
          the acts, omissions, or negligence of the Restaurant's own delivery staff or any third-party delivery
          arrangement engaged directly by the Restaurant (as opposed to the opt-in KnotKitchen delivery service);
        </li>
        <li>
          the Restaurant's breach of any applicable law, including but not limited to the Food Safety and Standards Act,
          2006, the Consumer Protection Act, 2019, the Legal Metrology Act, 2009 (weights/quantity disclosures), and
          applicable GST/tax legislation; and
        </li>
        <li>any third-party claim (including from a Customer) that arises from the Restaurant's own negligence, misrepresentation, or default.</li>
      </ol>
      <p>
        This indemnity is in addition to, and not in substitution for, any indemnity contained in the separate
        onboarding/service agreement between the Restaurant and KnotKitchen, and survives termination of that agreement
        and of these Terms.
      </p>
      <h3>2.9 User Accounts</h3>
      <p>
        Where account registration is offered, Customers are responsible for maintaining the confidentiality of their login
        credentials and for all activity under their account. The Restaurant (with KnotKitchen providing only the
        underlying technical mechanism) may suspend or terminate an account suspected of fraudulent activity, abuse, or
        violation of these Terms.
      </p>
      <h3>2.10 Prohibited Conduct</h3>
      <p>
        Customers agree not to: (a) use the website for any unlawful purpose; (b) attempt to interfere with, disrupt, or
        gain unauthorised access to the website's systems or data, which may separately constitute an offence under the
        Information Technology Act, 2000; (c) submit fraudulent orders or payment information; (d) misuse promotional codes
        or referral schemes; or (e) post abusive, defamatory, or unlawful content in any review or feedback mechanism on
        the website.
      </p>
      <h3>2.11 Coupons, Discounts, and Promotional Offers</h3>
      <p>
        Any coupon, discount code, or promotional offer displayed on this website is issued and funded by the Restaurant
        (unless expressly stated to be a KnotKitchen platform-wide promotion), is subject to the specific terms displayed
        alongside the offer, may be withdrawn or modified at the Restaurant's discretion, and cannot be combined with any
        other offer unless expressly stated.
      </p>
      <h3>2.12 Third-Party Links</h3>
      <p>
        This website may contain links to third-party services (e.g. the Payment Gateway's own hosted checkout page, social
        media pages, or map/location services). KnotKitchen and the Restaurant are not responsible for the content, privacy
        practices, or terms of any linked third-party service.
      </p>
      <h3>2.13 Intellectual Property</h3>
      <p>
        The underlying website design, source code, and platform features are the intellectual property of KnotKitchen and
        are licensed, not sold, to the Restaurant for use on this website. Menu content, brand names, trademarks, logos,
        food photography, and promotional copy uploaded by the Restaurant remain the exclusive property of the Restaurant,
        which warrants that it holds all necessary rights, licences, and consents to use such material and to grant
        KnotKitchen a limited licence to host and display it as part of operating the website.
      </p>
      <h3>2.14 Force Majeure</h3>
      <p>
        Neither the Restaurant nor KnotKitchen shall be liable for any failure or delay in performance caused by
        circumstances beyond its reasonable control, including natural disaster, fire, flood, pandemic or public health
        restriction, strike, riot, act of government, internet or telecom infrastructure failure, or failure of a
        third-party service provider (including the Payment Gateway or any courier/logistics network).
      </p>
      <h3>2.15 Amendment of Terms</h3>
      <p>
        The Restaurant, with KnotKitchen's technical assistance, may update these Terms and the associated policies from
        time to time to reflect changes in law, business practice, or the services offered. The "Last updated" date at the
        top of this page will be revised accordingly. Continued use of the website after such an update constitutes
        acceptance of the revised Terms.
      </p>
      <h3>2.16 Severability and Waiver</h3>
      <p>
        If any provision of these Terms is held invalid or unenforceable by a court or authority of competent jurisdiction,
        the remaining provisions shall continue in full force and effect. No failure or delay by the Restaurant or
        KnotKitchen in enforcing any right under these Terms shall operate as a waiver of that right.
      </p>
      <h3>2.17 Assignment</h3>
      <p>
        The Restaurant may not assign its rights or obligations under these Terms without KnotKitchen's prior written
        consent where such assignment would affect the underlying platform services. KnotKitchen may assign its rights and
        obligations relating to the technical operation of the website to a successor entity or affiliate, provided the
        Restaurant's and Customers' data continues to be handled in accordance with the Privacy Policy.
      </p>
      <h3>2.18 Governing Law and Jurisdiction</h3>
      <p>
        These Terms, and all policies incorporated by reference, are governed by the laws of India. Subject to the
        Grievance Redressal clause below and any mandatory consumer forum jurisdiction available to a Customer under the
        Consumer Protection Act, 2019 (which allows filing at the Customer's own place of residence), the courts at{" "}
        {L.jurisdictionCity}, {L.jurisdictionState} shall have exclusive jurisdiction over any other dispute.
      </p>
      <Grievance L={L} />
      <h2 id="general">General Legal Provisions</h2>
      <h3>Entire Agreement</h3>
      <p>
        These Terms, together with the Privacy Policy, Refund &amp; Cancellation Policy, Return Policy, and Shipping &amp;
        Delivery Policy on this website, constitute the entire agreement between the Customer and the Restaurant (and, to
        the limited extent described above, KnotKitchen) regarding use of this website, superseding any prior
        understanding on the same subject.
      </p>
      <h3>Notices</h3>
      <p>
        Any legal notice to the Restaurant should be sent to the address given under Grievance Redressal. Any legal notice
        to KnotKitchen, limited to matters within KnotKitchen's own responsibility under clause 2.7, should be sent to
        KnotKitchen's registered address{L.knotkitchenSupportEmail ? ` or to ${L.knotkitchenSupportEmail}` : ""}.
      </p>
      <h3>Relationship of Parties</h3>
      <p>
        Nothing in these Terms creates a partnership, joint venture, agency, or employment relationship between the
        Restaurant and KnotKitchen. Each operates as an independent contractor in relation to the other for the purposes of
        this website.
      </p>
      <h3>Language</h3>
      <p>
        These Terms are issued in English. Where a translated version is provided for convenience, the English version
        prevails in the event of any conflict.
      </p>
      <h2 id="faq">Frequently Asked Questions</h2>
      <h4>Is KnotKitchen responsible for my food order?</h4>
      <p>
        No. KnotKitchen builds and secures this website only. The Restaurant is responsible for food quality, order
        fulfilment, refunds, and (unless you're told otherwise at checkout) delivery.
      </p>
      <h4>Who do I contact for a refund?</h4>
      <p>The Restaurant directly, using the contact details under Grievance Redressal, not KnotKitchen.</p>
      <h4>Is my card/UPI information safe?</h4>
      <p>
        Your payment details go directly to the Payment Gateway chosen by the Restaurant. Neither the Restaurant nor
        KnotKitchen ever sees or stores your card or UPI credentials.
      </p>
      <h4>Who delivers my order?</h4>
      <p>
        By default, the Restaurant's own delivery staff. If the Restaurant has opted into KnotKitchen's delivery service,
        this is indicated at checkout, and the Shipping &amp; Delivery Policy explains what that changes.
      </p>
      <h4>Can I return food I don't like?</h4>
      <p>
        Prepared food cannot be physically returned for hygiene reasons; genuine issues are handled as a refund request
        under the Refund &amp; Cancellation Policy, not a return.
      </p>
    </>
  );
}

function Privacy({ L }) {
  return (
    <>
      <h2 id="privacy">Privacy Policy</h2>
      <h3>3.1 Roles under the Digital Personal Data Protection Act, 2023</h3>
      <p>
        For personal data collected through this website, the Restaurant acts as the <strong>Data Fiduciary</strong> under
        the Digital Personal Data Protection Act, 2023 ("DPDP Act"), as it determines the purpose and means of collecting
        Customer data (namely, to fulfil food orders and operate its business). KnotKitchen acts as a{" "}
        <strong>Data Processor</strong>, processing such data solely on the Restaurant's documented instructions, strictly
        to operate the website's technical infrastructure, and does not use Customer data for any independent purpose of
        its own, including cross-restaurant marketing, without separate, specific consent.
      </p>
      <h3>3.2 What Personal Data We Collect</h3>
      <div className="tbl">
        <table>
          <tbody>
            <tr>
              <th>Category</th>
              <th>Examples</th>
              <th>Collected by / stored via</th>
            </tr>
            <tr>
              <td>Identity &amp; contact data</td>
              <td>Name, phone number, email address</td>
              <td>Website (Restaurant's Data Fiduciary instance, hosted by KnotKitchen)</td>
            </tr>
            <tr>
              <td>Location data</td>
              <td>Delivery address, and (if permitted) live location for delivery tracking</td>
              <td>Website / device permissions</td>
            </tr>
            <tr>
              <td>Order data</td>
              <td>Order history, item preferences, special instructions, ratings/reviews</td>
              <td>Website</td>
            </tr>
            <tr>
              <td>Transaction data</td>
              <td>Order value, payment status, transaction reference ID</td>
              <td>Website (status only) &amp; Payment Gateway (full transaction)</td>
            </tr>
            <tr>
              <td>Payment instrument data</td>
              <td>Card number, UPI credentials, wallet login</td>
              <td>Payment Gateway only. Never received or stored by this website or KnotKitchen</td>
            </tr>
            <tr>
              <td>Technical/usage data</td>
              <td>IP address, browser/device type, cookies, page interaction logs</td>
              <td>Website infrastructure, for security and analytics</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>3.3 Cookies and Tracking Technologies</h3>
      <p>
        This website uses cookies and similar technologies to remember cart contents, keep Customers logged in, and
        understand site usage through aggregate analytics. Customers may control cookie preferences through their browser
        settings; disabling essential cookies may affect the ability to place Orders.
      </p>
      <h3>3.4 Purpose of Collection and Lawful Basis / Consent</h3>
      <p>
        Personal data is collected and processed only for: processing and delivering Orders; enabling payment via the
        Payment Gateway; customer support and complaint resolution; legally mandated record-keeping (for example, under GST
        law or the Consumer Protection Act, 2019); fraud prevention and website security; and, only where the Customer has
        separately and affirmatively opted in, promotional communication from the Restaurant. Consent for optional purposes
        is captured at the point of account creation or order placement and may be withdrawn at any time without affecting
        the lawfulness of processing already carried out, by contacting the Grievance Officer named below.
      </p>
      <h3>3.5 Data Sharing and Disclosure</h3>
      <p>
        Personal data is shared only with the following categories of recipient, and never sold to unrelated third parties
        for their own marketing purposes:
      </p>
      <ol className="legal">
        <li>The Restaurant, as Data Fiduciary, for order fulfilment and customer relationship purposes;</li>
        <li>The Payment Gateway, strictly to the extent necessary to process and confirm payment;</li>
        <li>
          The Delivery Partner (Restaurant's own staff, or KnotKitchen's delivery service where opted in), strictly to the
          extent necessary to deliver the Order (name, phone number, and delivery address only);
        </li>
        <li>KnotKitchen, strictly in its capacity as Data Processor operating the underlying website infrastructure; and</li>
        <li>
          Government or regulatory authorities, where disclosure is required under applicable law, a valid legal process,
          or to protect the rights, property, or safety of the Restaurant, KnotKitchen, or any Customer.
        </li>
      </ol>
      <h3>3.6 Children's Data</h3>
      <p>
        This website is not directed at, and does not knowingly collect personal data from, individuals below 18 years of
        age, consistent with the additional protections for children's data under the DPDP Act, 2023. If a parent or
        guardian believes a child has provided personal data through this website, they may contact the Grievance Officer
        for deletion.
      </p>
      <h3>3.7 Data Retention</h3>
      <p>
        Personal data is retained only for as long as necessary to fulfil the purposes described above, or as required
        under applicable law (for example, tax record-keeping periods under GST law, or the limitation period for consumer
        disputes under the Consumer Protection Act, 2019), after which it is securely deleted or anonymised.
      </p>
      <h3>3.8 Security Measures and Breach Notification</h3>
      <p>
        KnotKitchen implements reasonable technical and organisational security measures for data stored on the website's
        infrastructure, including encryption in transit, access controls, and regular security review, consistent with
        Section 43A of the IT Act, 2000 and the IT (Reasonable Security Practices) Rules, 2011. In the event of a personal
        data breach affecting the website's infrastructure, KnotKitchen will notify the Restaurant without undue delay; the
        Restaurant, as Data Fiduciary, is responsible for notifying affected Customers and the Data Protection Board of
        India as required under the DPDP Act, 2023, with KnotKitchen providing reasonable technical assistance to
        investigate and remediate the breach.
      </p>
      <h3>3.9 Your Rights as a Data Principal</h3>
      <p>
        Subject to the DPDP Act, 2023, Customers may: request a summary of the personal data held and the processing
        carried out; request correction or completion of inaccurate or incomplete data; request erasure of personal data no
        longer necessary for the purposes collected; withdraw previously given consent; and nominate another individual to
        exercise these rights on their behalf in the event of death or incapacity. Requests should be directed to the
        Restaurant's Grievance Officer named below. Requests relating solely to the website's security or hosting
        infrastructure may be directed to KnotKitchen's designated contact.
      </p>
      <h3>3.10 International Data Transfer</h3>
      <p>
        Where the website's hosting or backup infrastructure is located outside India, data may be transferred and stored
        accordingly, subject to any restrictions notified by the Central Government under the DPDP Act, 2023. KnotKitchen
        will ensure any such transfer is accompanied by reasonable safeguards.
      </p>
      <Grievance L={L} />
    </>
  );
}

function Refund({ L }) {
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

function Return({ L }) {
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

function Shipping({ L }) {
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

const BODIES = { terms: Terms, privacy: Privacy, "refund-cancellation": Refund, return: Return, "shipping-delivery": Shipping };

export default function LegalPage({ store, bootstrap, route }) {
  const page = legalPage(route.legalKey);
  const L = store?.legal || null;
  const name = store?.store?.name || bootstrap?.name || "";

  useEffect(() => {
    if (page) document.title = `${page.title} | ${name || "Restaurant"}`;
  }, [page, name]);

  if (!page) {
    return (
      <div className="kk-legal">
        <div className="wrap">
          <Link className="back" to={route.homePath}>← Back to {name || "the restaurant"}</Link>
          <h1>Page not found</h1>
          <p className="sub">The policy you asked for does not exist.</p>
        </div>
      </div>
    );
  }
  const Body = BODIES[page.key];

  return (
    <div className="kk-legal">
      <div className="wrap">
        <Link className="back" to={route.homePath}>← Back to {name || "the restaurant"}</Link>
        <h1>{page.title}</h1>
        {L ? (
          <p className="sub">
            For: {L.restaurantName}
            {L.websiteUrl ? <> &nbsp;|&nbsp; Website: {L.websiteUrl.replace(/^https?:\/\//, "")}</> : null}
            {L.fssaiNumber ? <> &nbsp;|&nbsp; FSSAI Licence: {L.fssaiNumber}</> : null}
            &nbsp;|&nbsp; Platform built, hosted &amp; secured by <strong>KnotKitchen</strong>
            {L.updatedAt ? <> &nbsp;|&nbsp; Last updated: {fmtDate(L.updatedAt)}</> : null}
          </p>
        ) : (
          <p className="sub">Loading…</p>
        )}
        <div className="toc-title">Policies</div>
        <nav aria-label="Legal pages">
          <Link to={route.homePath}>Home</Link>
          <Link to={route.menuPath}>Menu</Link>
          {LEGAL_PAGES.map((p) => (
            <Link key={p.key} to={legalPath(route, p.key)} className={p.key === page.key ? "on" : ""}>
              {p.title}
            </Link>
          ))}
        </nav>
        {L ? <Body L={L} /> : null}
        <footer>
          © {new Date().getFullYear()} {L?.legalName || name}. Website designed, hosted &amp; secured by KnotKitchen.
        </footer>
      </div>
    </div>
  );
}

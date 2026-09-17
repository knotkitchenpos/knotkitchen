/* eslint-disable react/no-unescaped-entities -- legal prose keeps its apostrophes and quotation marks */
import React from "react";
import { Grievance, Definitions } from "./shared";

export default function Terms({ L }) {
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

/* KnotKitchen Restaurant Service Agreement v3.0. Keep AGREEMENT_VERSION in step
   with pos-backend/constants/agreement.js, and KK_PRICES in step with the
   amounts written in the clauses below (Annexure B is generated from KK_PRICES).
   The PDF renderer supports only #/##/### headings, ---, flat "- " bullets,
   **bold**, paragraphs and a trailing \\ line break: no tables, no nested
   bullets, no numbered markdown lists. */

window.AGREEMENT_VERSION = "v3.0";

window.KK_PARTY = {
  name: "KnotKitchen",
  legalDescription: "",
  address: "J/183 Baishnabghata Patuli, Kolkata – 700094",
  supportEmail: "support@knotkitchen.com",
  supportPhone: "+91 8062181049",
};

window.KK_PRICES = {
  posPlan: 399,
  firstTopUp: 2500,
  addons: { qr: 200, website: 300, gmb: 100 },
  tabletFirst: 600,
  tabletExtra: 500,
  tabletTopUp: 4000,
  printer2in: 1900,
  printer3in: 4250,
  periodDays: 30,
  ebill: 0.25,
  orderCharge: 9,
};

window.AGREEMENT_TEMPLATE_V3 = `## KNOTKITCHEN RESTAURANT SERVICE AGREEMENT

**Agreement ID:** [AGREEMENT_ID]\\
**Agreement Version:** [VERSION]\\
**Effective Date:** [EFFECTIVE_DATE]

This Agreement is made between:

**(1) [KK_PARTY_NAME]**, having its principal place of business at [KK_PARTY_ADDRESS], which operates the KnotKitchen platform ("**KnotKitchen**"); and

**(2)** the restaurant business identified below (the "**Restaurant**"):

**Restaurant / Business Name:** [RESTAURANT_NAME]\\
**Legal Business Name:** [LEGAL_NAME]\\
**Type of Entity:** [ENTITY_TYPE]\\
**Registered / Business Address:** [ADDRESS]\\
**GSTIN:** [RESTAURANT_GSTIN]\\
**PAN:** [RESTAURANT_PAN]\\
**FSSAI Licence / Registration No.:** [FSSAI] (valid until [FSSAI_VALIDITY])\\
**Authorised Signatory:** [OWNER], [DESIGNATION]\\
**Notice Phone:** [PHONE]\\
**Notice Email:** [EMAIL]\\
**KnotKitchen Store ID:** assigned when KnotKitchen creates the Store after Verification under clause 15, and shown in the KnotKitchen application

KnotKitchen and the Restaurant are each a "**Party**" and together the "**Parties**".

---

## 0. DEFINITIONS AND INTERPRETATION

0.1 In this Agreement:

- "**Activation Date**" means the date on which the POS Plan is first activated for the Store under clause 2.3, as recorded in the KnotKitchen system and shown in the application.
- "**Activation Top-up**" means the Restaurant's first Wallet top-up of at least ₹2,500, made in a single payment, which activates the POS Plan under clause 2.3.
- "**Add-on**" means an optional Service charged per Billing Period in addition to the POS Plan, being QR Table Ordering, Website and GMB Management (clause 2.4) and any further Add-on that KnotKitchen offers in the application.
- "**Agreement**" means this document, its Annexures and the Commercial Schedule.
- "**Applicable Law**" means all Indian central and State laws, rules, regulations, notifications and binding orders in force from time to time.
- "**Billing Period**" means a period of 30 days that starts and ends at midnight (00:00) Indian Standard Time ("**IST**"), for which Subscription Fees are charged. The first Billing Period starts at 00:00 IST on the Activation Date.
- "**Cancellation Date**" has the meaning given in clause 12.2(b).
- "**Closed**" means the status of a Store whose cancellation has taken effect on the Cancellation Date under clause 12.2, or which KnotKitchen has closed under clause 12.4 (in which case the Store is Closed at once, when KnotKitchen closes it): renewals have stopped; the POS is locked except for sign-in and Billing, where the Restaurant can see its balance, charges and invoices but cannot top up the Wallet; the website, table QR ordering and table booking are no longer available; and the Store's data is kept under clause 12.7.
- "**Commercial Schedule**" means the record kept by the KnotKitchen system of what the application showed and the Restaurant accepted at each purchase (the item, its price, any pro-rata amount, Taxes and the total payable), as described in clause 2.7.
- "**Customer**" means a person who orders from, dines at, books a table with, or otherwise deals with the Restaurant.
- "**Customer Data**" means data relating to Customers that is collected or generated through the Services, including names, phone numbers, addresses, order history and payment status, and includes Personal Data of Customers.
- "**E-bill Charge**" means the charge for each e-bill described in clause 3.5.
- "**Effective Date**" means the date shown as the Effective Date at the top of this Agreement or, if later, the date on which the Restaurant's authorised signatory signs it.
- "**Equipment**" means the Tablets that KnotKitchen rents to the Restaurant under clause 5. Equipment remains KnotKitchen's property. A Printer is not Equipment.
- "**Grace Period**" means the 24-hour period described in clause 13.3.
- "**Hardware Request**" means a request for a Tablet or a Printer made from Billing in the application and handled under clauses 5.10 and 5.11.
- "**KnotKitchen Application**" or "**application**" means the KnotKitchen POS application, the onboarding portal and any KnotKitchen web or mobile interface through which the Restaurant uses the Services, makes purchases and views charges.
- "**Lock**" means the restriction of the Store described in clause 13.4, and "**Locked**" has a corresponding meaning.
- "**Order Charge**" means the charge for each Paid-Online Order described in clause 3.1.
- "**Paid-Online Order**" has the meaning given in clause 3.1.
- "**Personal Data**" has the meaning given in the Digital Personal Data Protection Act, 2023.
- "**POS Plan**" means KnotKitchen's base subscription described in clauses 1.1 and 2.1.
- "**Printer**" means a thermal receipt printer that the Restaurant buys from KnotKitchen under clause 5.7.
- "**Renewal Date**" means the date on which a Billing Period ends and the next Billing Period is due to start.
- "**Restaurant Content**" means menus, prices, descriptions, images, logos, trade names, business information and any other content the Restaurant supplies or publishes through the Services.
- "**Services**" means the POS Plan, the Add-ons the Restaurant has taken up, Tablet rental and the other services described in clause 1.
- "**Store**" means the Restaurant's account and configured outlet on the KnotKitchen platform, identified by its Store ID.
- "**Subscription Fee**" means the recurring fee per Billing Period, before Taxes, for the POS Plan, an Add-on or a rented Tablet.
- "**Suspension**" means a restriction of the Store under clause 13.9 for a reason other than non-payment.
- "**Tablet**" means a tablet device, with its standard accessories, that KnotKitchen rents to the Restaurant under clause 5.
- "**Tablet Top-up**" means a single Wallet top-up of at least ₹4,000, made after the POS Plan is active, that allows one Tablet to be rented under clause 5.2.
- "**Taxes**" means GST (CGST, SGST/UTGST, IGST and any cess) and any other tax, levy or duty imposed by Applicable Law on the Services or charges under this Agreement.
- "**Termination**" means the ending of this Agreement under clause 12, and "**Termination Effective Date**" means the date on which it ends.
- "**Third-Party Services**" means services, platforms and infrastructure operated by persons other than KnotKitchen that are integrated with or used to deliver the Services, as described in clause 9.
- "**Verification**" means KnotKitchen's review of the Restaurant's information, documents, authority and signed Agreement under clause 15.
- "**Wallet**" or "**Business Balance**" means the prepaid balance that KnotKitchen keeps for the Restaurant under clause 4.3.

0.2 Headings are for convenience only. "Including" means "including without limitation". A "day" is a calendar day, and times are Indian Standard Time. "Written" and "in writing" include email and, except where clause 20 requires otherwise, notices in the application. Amounts are in Indian Rupees. The singular includes the plural and the reverse.

---

## 1. SERVICES

1.1 KnotKitchen provides restaurant technology services. The Services are:

- **POS Plan:** a cloud-based point-of-sale system for takeaway and delivery orders, including billing, menu management, reports and e-bills.
- **QR Table Ordering Add-on:** tables and table management, dine-in service, and table QR ordering by Customers.
- **Website Add-on:** the Restaurant's ordering website, online payments into the Restaurant's own payment gateway account under clause 4A, and table booking.
- **GMB Management Add-on:** KnotKitchen keeps the Restaurant's Google Business Profile up to date under clause 1.4.
- **Tablets** on monthly rental, and **Printers** for purchase, under clause 5.
- Supported integrations with Third-Party Services and marketplaces, where offered, under clauses 9 and 9A.

1.2 The POS Plan on its own is intended for takeaway and delivery. Creating and managing tables, and table QR ordering by Customers, are available only while the QR Table Ordering Add-on is active. The ordering website, online payments and table booking are available only while the Website Add-on is active. The application shows which features belong to the POS Plan and to each Add-on.

1.3 KnotKitchen is a technology and software provider. KnotKitchen does not prepare, manufacture, package, store, sell or deliver the Restaurant's food, and is not the seller of any food or goods ordered through the Services.

1.4 **GMB Management.** While the GMB Management Add-on is active, KnotKitchen updates the Restaurant's Google Business Profile using information the Restaurant supplies or approves. The Restaurant remains the owner of its profile and will give KnotKitchen manager access to it. Google operates the profile under its own terms, and KnotKitchen does not control, and does not guarantee, Google's verification, ranking, review or suspension decisions or any search result. When the Add-on ends, KnotKitchen stops managing the profile and, on request, removes its own access.

## 1A. AVAILABILITY, MAINTENANCE AND SERVICE CHANGES

1A.1 KnotKitchen will use commercially reasonable efforts to keep the Services available. The Services depend on the internet, the Restaurant's devices and connectivity, cloud infrastructure and other Third-Party Services, and KnotKitchen does not promise uninterrupted or error-free operation. No uptime service level is offered under this Agreement.

1A.2 KnotKitchen may carry out planned maintenance, updates, patches, upgrades and security fixes. KnotKitchen will try to schedule planned maintenance outside peak restaurant hours and to give advance notice in the application of maintenance expected to interrupt the Services for more than 30 minutes. Emergency maintenance for security or stability may be carried out without notice.

1A.3 KnotKitchen may modify, add or withdraw features. KnotKitchen will give at least 30 days' notice in the application or by email before withdrawing a feature that is material to the POS Plan or to an Add-on the Restaurant is paying for, unless the withdrawal is required by law, security or a Third-Party Service change outside KnotKitchen's control. If a withdrawal materially reduces a Service the Restaurant is paying for, KnotKitchen will credit the Wallet with the Subscription Fee paid for that Service for the unused part of the Billing Period, and the Restaurant may cancel under clause 12.2.

---

## 2. POS PLAN, ACTIVATION AND ADD-ONS

2.1 **POS Plan.** The POS Plan is KnotKitchen's single base subscription. Its Subscription Fee is **₹399 per Billing Period**, plus Taxes under clause 4.4. There is no installation fee, no minimum commitment and no discount for any term.

2.2 **Before activation.** When KnotKitchen creates the Store, the Store is Locked except for sign-in and Billing until the POS Plan is activated. No Grace Period applies before activation.

2.3 **Activation.** The POS Plan starts automatically when the Restaurant makes the Activation Top-up: a first Wallet top-up of at least **₹2,500 in a single payment**. Before activation a smaller top-up is not accepted, and smaller top-ups cannot be added together to reach the minimum. When the Activation Top-up is received: (a) the POS Plan activates; (b) the first Subscription Fee, plus Taxes, is deducted from the Wallet; and (c) the first Billing Period starts at 00:00 IST on the Activation Date. The rest of the Activation Top-up stays in the Wallet as ordinary balance and pays future charges.

2.4 **Add-ons.** The Restaurant may take up the following Add-ons in the application, each charged per Billing Period from the Wallet, plus Taxes:

- **QR Table Ordering: ₹200.** Includes tables, table management, table QR ordering and dine-in service.
- **Website: ₹300.** Includes the ordering website, online payments into the Restaurant's own payment gateway account and table booking.
- **GMB Management: ₹100.** KnotKitchen keeps the Restaurant's Google Business Profile up to date under clause 1.4.

KnotKitchen may offer further Add-ons in the application. Their price and content are shown and accepted under clause 2.7 before they apply.

2.5 **Taking up an Add-on.** An Add-on can be taken up only while the POS Plan is active. An Add-on taken up during a Billing Period is charged pro rata, plus Taxes, for the time left in that Billing Period, and in full at each renewal under clause 6.

2.6 **Stopping an Add-on.** The Restaurant may stop an Add-on at any time in the application. The Add-on continues until the end of the current Billing Period and is not renewed after it. The Subscription Fee for that Billing Period is not refunded. Restarting a stopped Add-on before that Billing Period ends carries no extra charge.

2.7 **Commercial Schedule.** Before the Restaurant confirms an Add-on, a Tablet rental or a Printer purchase, the application shows the item, its price, any pro-rata amount, the Taxes and the total payable. The values displayed and accepted are recorded by the KnotKitchen system as the Commercial Schedule and form part of this Agreement. KnotKitchen may not change them retrospectively. Each later purchase or change creates a new entry, and the system keeps every entry. The standard charges at the Effective Date are listed in Annexure B.

2.8 **Price changes.** KnotKitchen may change the Subscription Fees for the POS Plan, the Add-ons and Tablet rental, the Order Charge, the E-bill Charge and the Activation Top-up and Tablet Top-up amounts for the future. KnotKitchen will give the Restaurant at least 30 days' notice of a change, by email or in the application, before the change applies. A change applies to the Restaurant only from the first Renewal Date after that notice period ends. Amounts already paid are not affected. A Printer is sold at the price shown in the application when it is bought.

2.9 **Store-specific prices.** Where KnotKitchen agrees a different price with the Restaurant, that price is shown in the application and recorded in the Commercial Schedule, and it applies instead of the standard price.

---

## 3. ORDER CHARGE AND E-BILL CHARGE

3.1 **Order Charge.** The Restaurant pays an Order Charge of **₹9 plus Taxes** for each Paid-Online Order. A "**Paid-Online Order**" is an order placed by a Customer through the Restaurant's website and paid online through the online payment gateway connected to the Services. For table QR ordering, each table bill paid online through the payment gateway counts as one Paid-Online Order, however many rounds it contains and whoever entered them. A table bill settled by cash, card at the counter or any other means is not charged. Otherwise, no Order Charge applies to: orders paid in cash; orders paid by card, UPI or any other method at the counter, at pickup or on delivery; orders received from a marketplace; orders entered in the POS by the Restaurant's staff; or unpaid orders.

3.2 **Order Charge start date.** The Order Charge does not apply from the Effective Date. It applies only to Paid-Online Orders placed on or after the start date that KnotKitchen sets and shows in the application. KnotKitchen may set a later start date for the Restaurant's Store than for other stores, and the later date then applies. KnotKitchen will show the start date in the application, and inform the Restaurant by email, before it applies.

3.3 **When the Order Charge is deducted.** The Order Charge is charged once for each Paid-Online Order, when the order has been both paid online and completed or settled, whichever happens later (for table QR ordering, including when the table's bill is settled through the online payment gateway), and is deducted from the Wallet. GST, once it applies, is added on top of the Order Charge under clause 4.4(b). If the Wallet cannot pay it, the order still proceeds, the Order Charge remains due and is collected from the next top-up, and clause 13 applies.

3.4 **Reversed payments.** If a Customer's online payment for a Paid-Online Order is refunded in full, reversed or charged back after the Order Charge was deducted, KnotKitchen will credit that Order Charge, and any Taxes on it, to the Wallet on the Restaurant's request with evidence of the refund, reversal or chargeback.

3.5 **E-bill Charge.** The Restaurant pays an E-bill Charge of **₹0.25 plus Taxes** for each e-bill that the Services send for the Restaurant, including an e-bill sent again. The E-bill Charge applies only to e-bills sent on or after the start date that KnotKitchen sets and shows in the application, and KnotKitchen will inform the Restaurant of that date in the application and by email before it applies. The E-bill Charge is deducted from the Wallet when the e-bill is sent, and GST, once it applies, is added on top of it under clause 4.4(b). An e-bill that fails to send is not charged. If the Wallet cannot pay an E-bill Charge when the e-bill is sent, that E-bill Charge is not deducted, is not collected later and does not start a Grace Period.

3.6 **Separate charges.** The Order Charge and the E-bill Charge are separate from Subscription Fees and from any fee charged by a payment gateway, marketplace or other Third-Party Service. They may be changed only under clause 2.8.

---

## 4. FEES, WALLET, INVOICING AND TAXES

4.1 **What the Restaurant pays.** The Restaurant pays, as applicable: (a) the Subscription Fees for the POS Plan, each active Add-on and each rented Tablet; (b) Order Charges and E-bill Charges; (c) the price of any Printer it buys; (d) repair or replacement costs under clause 5.5; and (e) Taxes under clause 4.4.

4.2 **How and when charges are paid.** Every charge is deducted from the Wallet, except the price of a Printer and any amount that KnotKitchen invoices separately under clause 5.5, 12A.5 or 12A.7 (payable within 15 days of the invoice; it does not start the Grace Period or a Lock). A Printer is paid for online under clause 5.7. Charges fall due as follows: Subscription Fees for a renewal, on the Renewal Date; a pro-rata Add-on or Tablet charge, when the Add-on or Tablet is taken up; the Order Charge, when the order has been both paid online and completed or settled (clause 3.3); the E-bill Charge, when the e-bill is sent (clause 3.5); and a repair or replacement cost, when KnotKitchen notifies it under clause 5.5. The application shows at all times the Wallet balance, each deduction, and the next Renewal Date and amount.

4.3 **The Wallet.**\\
(a) The Wallet is a prepaid balance that KnotKitchen keeps for the Restaurant. It is topped up only online, through KnotKitchen's payment gateway in the application.\\
(b) The Wallet can be used only to pay KnotKitchen's charges under this Agreement. It is not a bank account, a deposit or a payment instrument that can be used with anyone else.\\
(c) The Wallet is not transferable to any other person or Store, and it earns no interest.\\
(d) The Wallet balance is not refundable and cannot be withdrawn or paid out, except as stated in clause 12A.2.\\
(e) The Activation Top-up and each Tablet Top-up become ordinary Wallet balance once received.\\
(f) Apart from the Activation Top-up and Tablet Top-ups, the Restaurant chooses the amount of every top-up, and should keep in the Wallet only what it expects to use for KnotKitchen's charges.\\
(g) The Wallet balance cannot fall below zero. A charge that the Wallet cannot pay remains due under clause 4.6, except an E-bill Charge, which is not collected under clause 3.5.\\
(h) KnotKitchen may credit or debit the Wallet by a recorded adjustment, stating the reason and any reference (such as an invoice number or bank transfer reference), only where this Agreement provides for it: to give a credit or correct a charge made in error, to collect a cost under clause 5.5, to record a refund paid out under clause 5.11 or clause 12A.2, or to reverse a top-up that the payment gateway reversed or that was charged back (clauses 12A.5 and 12A.7); where the balance is too small the shortfall is invoiced as in clause 5.5. Each adjustment appears in the Wallet statement.

4.4 **Taxes and GST.**\\
(a) KnotKitchen charges GST only while it is registered under GST, and only from the GST start date shown in the application. The application and each invoice show whether GST applies. While GST does not apply, no GST is charged.\\
(b) Where KnotKitchen is or becomes registered under GST, GST applies from the GST start date that KnotKitchen sets and shows in the application, which will not be earlier than the date its registration takes effect. From that date, GST at the applicable rate is added to: the Subscription Fees for the POS Plan, the Add-ons and Tablet rental; Order Charges; and E-bill Charges. GST is shown separately on tax invoices issued under the Central Goods and Services Tax Act, 2017 ("**CGST Act**"), with KnotKitchen's GSTIN, the Restaurant's GSTIN if supplied, the taxable value and CGST/SGST or IGST as applicable, without amendment to this Agreement.\\
(c) Printer prices include GST. GST is never added on top of a Printer price. While GST applies, the invoice for a Printer shows the GST contained in its price.\\
(d) Where the application shows a price as "+ GST", GST is added only once clause 4.4(b) applies.\\
(e) The Restaurant must supply an accurate GSTIN and legal name if it wishes to claim input tax credit once GST applies, and must promptly update any change. KnotKitchen is not liable for any loss of credit, penalty or interest arising from GSTIN or address details that the Restaurant supplied incorrectly or failed to update.\\
(f) Place of supply is determined under the Integrated Goods and Services Tax Act, 2017 using the Restaurant's address in this Agreement. The Restaurant must inform KnotKitchen of any change of address.\\
(g) If a Tax rate, classification, valuation rule or statutory requirement changes, the changed treatment applies from the date the change takes effect, without amendment to this Agreement.\\
(h) Where an amount on which GST was charged is refunded or reduced under this Agreement, KnotKitchen will issue a credit note under section 34 of the CGST Act (or a refund voucher, as applicable) and adjust the tax accordingly, and the Restaurant will reverse any corresponding input tax credit to the extent required by law.\\
(i) Any withholding tax the Restaurant is required by law to deduct must be deducted and deposited by the Restaurant, which must provide the certificate within the statutory time. KnotKitchen will treat the gross amount as received once the certificate is provided.

4.5 **Invoices and statements.** KnotKitchen issues an invoice in the application for each renewal, each Add-on and Tablet charge and each Printer purchase. Order Charges and E-bill Charges are shown as deductions in the Wallet statement and, once GST applies, are invoiced as Applicable Law requires.

4.6 **Unpaid amounts.** An amount not paid when due remains due and is collected from the next top-up, oldest amount first. Clause 13 applies to it. This does not apply to an amount that KnotKitchen invoices separately under clause 5.5, 12A.5 or 12A.7, which is payable within 15 days of the invoice and does not start the Grace Period or a Lock.

4.7 **Disputed charges.** The Restaurant may dispute a charge in writing within 30 days of its deduction. KnotKitchen will review the dispute and reply within 15 days. A charge made in error is corrected under clause 12A.2(a).

## 4A. PAYMENT GATEWAYS

4A.1 **Customer payments.** Payments by Customers on the Restaurant's website and through table QR ordering are processed by a third-party payment gateway through an account in the Restaurant's own name, and are settled directly to the Restaurant. KnotKitchen does not collect, hold or settle Customer payments. The Restaurant contracts directly with the gateway, accepts its terms, pays its fees, receives its settlements, and is responsible for its KYC and compliance.

4A.2 **Credentials.** Card and payment credentials of Customers are collected and stored by the gateway, not by KnotKitchen. KnotKitchen receives only the transaction status and reference information needed to operate the Services, and stores the Restaurant's gateway keys only to operate the integration.

4A.3 **Gateway failures.** KnotKitchen does not guarantee the availability of any payment gateway and is not responsible for payment failures, settlement delays, reversals, chargebacks or holds decided or caused by the gateway, the Customer's bank or a card network. Clause 3.4 applies to Order Charges on reversed payments.

4A.4 **Payments to KnotKitchen.** Wallet top-ups and Printer purchases are paid to KnotKitchen online, through KnotKitchen's own payment gateway, by UPI, card, netbanking or another method shown in the application. A failed transaction is not a payment. A duplicate payment is refunded under clause 12A.2(a).

4A.5 **Availability.** Online payments on the Restaurant's website are available only while the Website Add-on is active and the Store is not Locked.

---

## 5. TABLETS, PRINTERS AND HARDWARE REQUESTS

5.1 **Tablet rental.** KnotKitchen rents Tablets to the Restaurant for a Subscription Fee per Billing Period, plus Taxes, deducted from the Wallet: **₹600** for the first Tablet and **₹500** for each additional Tablet. A Tablet can be rented only while the POS Plan is active and only with a Tablet Top-up under clause 5.2. The first charge is made when the Tablet is requested, pro rata for the time left in the current Billing Period; after that the Tablet renews with the POS Plan under clause 6. The rental is charged from the date of the request, not from delivery.

5.2 **Tablet Top-up.** Each Tablet needs its own Tablet Top-up: a single Wallet top-up of at least **₹4,000**, made after the POS Plan is active. One Tablet Top-up allows one Tablet to be rented, however large the top-up. The Activation Top-up never counts as a Tablet Top-up, and nor do credits or refunds made by KnotKitchen. A Tablet Top-up is not a deposit or security: it stays in the Wallet as ordinary balance, is used for the Restaurant's charges in the ordinary way, and is not refundable except under clause 12A.2.

5.3 **Ownership and care.** Tablets remain KnotKitchen's property at all times. The make, model and serial number or IMEI of each Tablet are recorded on delivery. The Restaurant holds each Tablet as bailee and must: keep it at the Restaurant's premises; use it only for the Services; take reasonable care of it; and not sell, pledge, transfer, sub-let, modify or dispose of it.

5.4 **Support.** KnotKitchen handles normal technical and software issues in the Tablets. KnotKitchen repairs or replaces, at its own cost, a Tablet that develops a fault not caused by anything described in clause 5.5. Ordinary wear and tear is not chargeable.

5.5 **Loss and damage.** If a Tablet is lost or stolen, or is damaged beyond ordinary wear and tear (including by misuse, negligence, physical or liquid damage or unauthorised modification), while the Restaurant is responsible for it, the Restaurant pays the actual cost that KnotKitchen incurs to repair it or, where repair is not possible or would cost more than replacement, to replace it with the same or an equivalent model. KnotKitchen will give the Restaurant the supplier's invoice showing that cost. KnotKitchen collects the cost by a debit adjustment to the Wallet under clause 4.3(h), with the supplier's invoice number as its reference. If the Wallet balance is less than the cost, KnotKitchen invoices the part the Wallet cannot pay, and that part is payable within 15 days of the invoice. This is compensation for the actual loss caused, recoverable under section 73 of the Indian Contract Act, 1872. It is not a penalty, and this Agreement names no sum payable on breach for the purposes of section 74 of that Act.

5.6 **End of rental and return.** The Restaurant may end a Tablet rental by written notice to KnotKitchen under clause 20. The rental then ends at the end of the current Billing Period and is not renewed, and the Subscription Fee for that Billing Period is not refunded. Every Tablet rental also ends when this Agreement ends or the Store is Closed. The Restaurant must return each Tablet, with its accessories and in working order (ordinary wear and tear excepted), **within 15 days after its rental ends**, by hand-over to KnotKitchen's representative or by the return method KnotKitchen specifies. Collection is at KnotKitchen's cost, unless the rental ended because of the Restaurant's breach. The Restaurant remains responsible for each Tablet until KnotKitchen acknowledges its return in writing. A Tablet that is not returned within 15 days, and is still not returned 7 days after KnotKitchen's written reminder, is treated as lost under clause 5.5.

5.7 **Printers.** The Restaurant may buy a Printer outright from KnotKitchen for a one-time price, with no monthly fee: **₹1,900** for a 2-inch thermal receipt printer and **₹4,250** for a 3-inch thermal receipt printer. These prices **include GST**, and no GST is added on top (clause 4.4(c)). The price is paid online at the time of the Hardware Request, through KnotKitchen's payment gateway by UPI, card or netbanking, and **not from the Wallet**.

5.8 **Ownership and risk of Printers.** Ownership of a Printer, and the risk of its loss or damage, pass to the Restaurant on delivery.

5.9 **Printer warranty.** If a Printer is dead on arrival, or fails within 7 days after delivery, and the Restaurant reports it to KnotKitchen within that time, KnotKitchen will replace it at no charge, unless the failure was caused by misuse, physical or liquid damage or unauthorised modification. If KnotKitchen cannot supply a replacement within 15 days of the report, it refunds the price paid to the original payment method. After those 7 days, the manufacturer's warranty applies on the manufacturer's terms, and KnotKitchen will help the Restaurant make a claim under it. To the extent Applicable Law permits, KnotKitchen gives no other warranty for Printers.

5.10 **Hardware Requests.** Tablets and Printers are requested from Billing in the application. After payment, each Hardware Request has one of these statuses, shown in the application: **REQUESTED** (paid and awaiting KnotKitchen); **ACCEPTED**; **DISPATCHED** (with the courier and tracking details); **DELIVERED**; or **CANCELLED**. The Restaurant must give a correct delivery address and contact. Delivery dates given by KnotKitchen are estimates.

5.11 **Cancelling a Hardware Request.** The Restaurant may cancel a Hardware Request only while it is REQUESTED, and then receives a full refund to the Wallet of everything paid for that request; for a Tablet, this includes any renewal charge taken for it, and the Tablet Top-up can be used again. KnotKitchen may cancel a Hardware Request that has not been delivered, and then refunds to the Wallet everything paid for that request. If KnotKitchen cancels because of the Restaurant (for example, because the Restaurant refused delivery, gave a wrong address or contact, or is in breach of this Agreement), KnotKitchen may deduct from that refund the costs it actually incurred for the request, as shown by documents it gives the Restaurant. A refund under this clause, including for a Printer paid through the payment gateway, becomes Wallet balance under clause 4.3. Where KnotKitchen cancelled the request, the Restaurant may ask in writing for that refund to be paid out instead by bank transfer to the Restaurant's account; KnotKitchen then pays it within 15 days of the request, to the extent it is still in the Wallet, and records the payout as a debit adjustment to the Wallet under clause 4.3(h).

---

## 6. RENEWAL

6.1 **Automatic renewal.** At the end of each Billing Period the subscription renews automatically from the Wallet for a further Billing Period, until it is cancelled or this Agreement ends.

6.2 **What is charged.** On each Renewal Date, the Subscription Fees for the POS Plan, every active Add-on and every rented Tablet, plus Taxes, are deducted from the Wallet together, under one invoice, at the prices then in force under clause 2.8. Add-ons stopped under clause 2.6 and Tablet rentals ended under clause 5.6 are not renewed.

6.3 **All or nothing.** If the Wallet cannot pay the full renewal amount, nothing is deducted, nothing is renewed, and clause 13 applies. The renewal is completed automatically as soon as the Wallet holds enough to pay it.

6.4 **Late renewal starts on the payment day.** A renewal completed on the Renewal Date continues from the end of the previous Billing Period. A renewal completed after the Renewal Date starts a new Billing Period at 00:00 IST on the day it is completed. A late renewal is not backdated: the days between the end of the previous Billing Period and the renewal are not covered by the subscription and are not charged.

6.5 **No early renewal and no minimum term.** A renewal cannot be paid before its Renewal Date; the Restaurant prepays only by keeping a balance in the Wallet. There is no minimum term. The Restaurant may stop Add-ons under clause 2.6, end Tablet rentals under clause 5.6, or cancel under clause 12.2.

6.6 **After cancellation or closure.** No renewal takes place after the Cancellation Date or after KnotKitchen closes the Store.

---

## 7. RESTAURANT RESPONSIBILITIES

7.1 The Restaurant is solely responsible for its business and, in particular, for:

**Food and safety:** food quality, safety, hygiene, preparation, ingredients, allergens and ingredient disclosures where legally required, packaging, storage, expiry and shelf-life information where applicable, and food labelling where applicable.

**Licences and compliance:** holding and renewing its FSSAI licence or registration under the Food Safety and Standards Act, 2006 and its regulations, trade and local municipal licences, fire and health permissions, shop and establishment registration, tax registrations applicable to the Restaurant, and compliance with all food laws, municipal and local requirements, labour laws and Applicable Law.

**Information and content:** the accuracy and lawfulness of Restaurant Content, including menu information, product descriptions, prices displayed to Customers (inclusive of all Taxes and charges the law requires to be displayed), availability, business hours and delivery areas; and providing accurate business and document information to KnotKitchen and keeping it current.

**Orders and Customers:** acceptance, preparation, packaging and fulfilment of orders; delivery or collection operations under the Restaurant's control; table bookings and dine-in service; Customer order cancellation and refund decisions; Customer support for food, service and fulfilment; and food-related complaints, refunds or compensation, including under the Consumer Protection Act, 2019 and the Consumer Protection (E-Commerce) Rules, 2020 to the extent they apply to the Restaurant as seller.

**Accounts and payments:** maintaining its payment gateway account (clause 4A); protecting its account credentials, security PIN and devices, and ensuring only authorised staff use the Store; and paying KnotKitchen's charges.

7.2 The Restaurant will use the Services only for lawful purposes and in accordance with any acceptable-use rules KnotKitchen publishes in the application, and will not use the Services to send unsolicited communications in breach of the Telecom Commercial Communications Customer Preference Regulations, 2018 or other Applicable Law.

7.3 KnotKitchen provides technology and software and is not responsible for the Restaurant's food, its independent business operations or its compliance with the laws that apply to it. Nothing in this clause transfers to the Restaurant any responsibility that Applicable Law places on KnotKitchen for KnotKitchen's own Services.

---

## 8. DATA PROTECTION AND PRIVACY

8.1 **Roles.** For Personal Data of the Restaurant's owners, staff and users of the Store (account, authentication, billing, support and communication data), KnotKitchen determines the purpose and means of processing and is the Data Fiduciary. For Customer Data collected through the Restaurant's website, table QR ordering, POS and integrations, the Restaurant determines the purpose (running its business and fulfilling orders) and is the Data Fiduciary, and KnotKitchen processes that data on the Restaurant's behalf as its Data Processor under this Agreement, in accordance with section 8(2) of the Digital Personal Data Protection Act, 2023 ("**DPDP Act**"). Clause 8.10 sets out the processing terms.

8.2 **Purposes.** KnotKitchen processes Personal Data only for: providing, administering and securing the Services; Customer ordering, table booking, billing and e-bills; authentication; support; service analytics and improvement (using aggregated or de-identified data where reasonably possible); fraud prevention and security; legal compliance; communications about the Services; and operating integrations the Restaurant enables.

8.3 **Restaurant obligations.** The Restaurant will: give Customers the notices and obtain the consents Applicable Law requires for the collection and use of their Personal Data through the Services, including by publishing a privacy notice on its website; use Customer Data only for lawful purposes connected with its business; not misuse or unlawfully disclose Customer information obtained through KnotKitchen; and respond to Customers' requests for access, correction or erasure, with KnotKitchen's assistance under clause 8.10.

8.4 **KnotKitchen obligations.** KnotKitchen will process Customer Data in accordance with clause 8.10, will not sell Customer Data or use it for unrelated promotional purposes, and, as Data Fiduciary for the Restaurant's own account data, will publish and follow a Privacy Policy, which forms part of the contractual framework (clause 21.6 sets the order of precedence).

8.5 **No absolute security.** KnotKitchen does not promise that security incidents will never occur. Its obligation is to apply the safeguards in clause 8.10 and to respond as described there.

8.6 **Ownership and rights.** Nothing in this Agreement transfers ownership of Customer Data to KnotKitchen. The Restaurant's contractual rights to Customer Data and KnotKitchen's processing rights are as stated here, and both are subject to the rights of Customers under Applicable Law. KnotKitchen may retain and use aggregated, de-identified statistics derived from use of the Services that do not identify the Restaurant or any Customer.

8.7 **Retention, export and deletion.** During the term, the Restaurant may export its data in the formats the application supports. After the Store is Closed, clause 12.7 applies. Deletion follows clause 8.10(h).

8.8 **Processing locations.** KnotKitchen will inform the Restaurant, on request, of the locations at which the Services and Customer Data are hosted. Personal Data is transferred outside India only where Applicable Law permits.

8.9 **Legal requests.** Each Party may disclose data where required by a court, regulator or Applicable Law, and will, where lawful, notify the other and limit the disclosure to what is required.

8.10 **Processing terms for Customer Data.** When processing Customer Data as the Restaurant's Data Processor, KnotKitchen will:\\
(a) process it only on the Restaurant's documented instructions, which include this Agreement and the settings the Restaurant chooses in the application, and as required by Applicable Law;\\
(b) ensure that its personnel who have access to it are bound by confidentiality obligations;\\
(c) implement reasonable security safeguards appropriate to the data, including access controls limited to personnel who need access, encryption of data in transit, activity logging and regular backups, as the DPDP Act and the rules made under it require;\\
(d) engage sub-processors only under written terms that protect the data no less than this clause. KnotKitchen's sub-processors fall into these categories: cloud hosting, storage and database providers; SMS, OTP, WhatsApp and email providers; payment gateways (for transaction status only); and maps and location providers. KnotKitchen will give the Restaurant the current list of sub-processors on request, and remains responsible for their processing;\\
(e) notify the Restaurant without undue delay, and where feasible within 24 hours, after becoming aware of a Personal Data breach affecting Customer Data, with the information reasonably available to help the Restaurant meet its own obligations, including any intimation to the Data Protection Board of India and to affected Customers;\\
(f) assist the Restaurant, by appropriate technical and organisational measures, to respond to requests from Customers (as Data Principals) for access, correction, completion, erasure or grievance redressal, and pass on to the Restaurant without delay any such request that KnotKitchen receives directly;\\
(g) give the Restaurant, on request, the information reasonably needed to show that KnotKitchen complies with this clause;\\
(h) when the Restaurant asks for permanent deletion under clause 12.7, or when Applicable Law requires, delete or de-identify Customer Data from live systems within 60 days, and from backups in the normal backup cycle, not exceeding a further 90 days, except for records that Applicable Law requires KnotKitchen to keep, which are kept only for the required period and then deleted; and\\
(i) not transfer Customer Data outside India except where Applicable Law permits.

---

## 9. THIRD-PARTY SERVICES

9.1 The Services use and may integrate Third-Party Services, including payment gateways, SMS and OTP providers, WhatsApp or other messaging platforms, cloud infrastructure, maps, Google Business Profile, analytics, and food-ordering and delivery platforms such as Swiggy and Zomato.

9.2 Third-Party Services are subject to their own terms, privacy policies, fees, limits, eligibility requirements, APIs, policies and availability. By enabling a Third-Party Service the Restaurant accepts that provider's terms, and any fee charged by the provider is the Restaurant's cost unless the Commercial Schedule says KnotKitchen bills it.

9.3 KnotKitchen is not responsible for the acts, omissions, outages, errors, policy decisions or changes of a Third-Party Service provider. Where a provider changes, suspends or discontinues its service or API, KnotKitchen will use reasonable efforts to adapt the integration or offer an alternative, will inform the Restaurant, and may withdraw the affected feature under clause 1A.3 without liability, other than a pro-rata credit to the Wallet of any Add-on fee paid specifically for that feature for the period it is unavailable.

## 9A. MARKETPLACE INTEGRATIONS

9A.1 Where the Restaurant enables an integration with Swiggy, Zomato or another marketplace ("**Marketplace**"), KnotKitchen provides only integration functionality: technical connectivity to the Marketplace's interfaces, order management and display of Marketplace orders in the POS, and synchronisation or transmission of menu, availability and order-status information to the extent the Marketplace supports it.

9A.2 The Restaurant's relationship with each Marketplace is governed solely by the Restaurant's own agreement with that Marketplace. The Marketplace remains responsible for its platform, its commercial relationship with the Restaurant, commissions, payment and settlement systems, orders placed on it, Customer policies, refunds, cancellations, delivery arrangements, platform outages, APIs and API changes, account restrictions, policy enforcement and platform-side errors.

9A.3 KnotKitchen is not Swiggy, Zomato or any Marketplace, is not their agent or partner, and has no control over their systems, decisions or data. KnotKitchen does not guarantee that a Marketplace will accept or maintain the integration, that its API will remain available or unchanged, or that orders, menus or statuses will synchronise without delay or error where the delay or error originates on the Marketplace side.

9A.4 KnotKitchen is not liable for any loss caused solely by a Marketplace's systems, policies, actions, outages, API changes, platform decisions, refunds, commissions or customer-service decisions. KnotKitchen remains responsible, subject to clause 16, for defects in its own integration software and for its own failure to transmit information that the Marketplace made available to it.

9A.5 The Restaurant must keep its Marketplace accounts in good standing, obtain any Marketplace approval needed for the integration, and give KnotKitchen the access credentials or authorisations the integration needs, which KnotKitchen will use only for the integration.

---

## 10. SOFTWARE AND INTELLECTUAL PROPERTY

10.1 KnotKitchen (or its licensors) owns all rights in the KnotKitchen software, source and object code, platform architecture, user interfaces and designs, trademarks and logos, APIs, documentation, proprietary systems, configuration tools, templates, analytics methods and platform know-how, and all improvements to them, whether or not suggested by the Restaurant ("**KnotKitchen IP**").

10.2 KnotKitchen grants the Restaurant a limited, non-exclusive, non-transferable, non-sublicensable right to access and use the Services and KnotKitchen IP, for the Restaurant's own business at the Store, during the term of this Agreement. The Restaurant receives no other right.

10.3 The Restaurant may not copy, resell, sublicense, rent, reverse engineer, decompile, modify, create derivative works from, or commercially redistribute KnotKitchen software or KnotKitchen IP, remove proprietary notices, or use the Services to build a competing product, except to the extent Applicable Law permits notwithstanding this clause.

10.4 The Restaurant (or its licensors) owns Restaurant Content and its pre-existing intellectual property, including its trade names, logos, images and menu data. Nothing in this Agreement transfers them to KnotKitchen.

10.5 The Restaurant grants KnotKitchen a non-exclusive, royalty-free licence, for the term, to host, store, reproduce, display, transmit, format and process Restaurant Content and Customer-submitted content (such as reviews or order notes) as needed to provide the Services, including on the Restaurant's website, its Google Business Profile and through integrations, and to use the Restaurant's name and logo to identify it as a KnotKitchen customer unless the Restaurant objects in writing. The Restaurant warrants that it has the rights needed to grant this licence and that Restaurant Content does not infringe any third party's rights or Applicable Law.

10.6 When the Store is Closed, KnotKitchen will remove Restaurant Content from public display. Restaurant Content is then kept or deleted under clause 12.7.

---

## 11. WEBSITE AND TABLE ORDERING

11.1 While the Website Add-on is active, KnotKitchen provides the Restaurant's ordering website at a KnotKitchen web address (a sub-domain of knotkitchen.com) or at a domain connected under clause 11A, with online payments into the Restaurant's own payment gateway account (clause 4A) and table booking.

11.2 The Restaurant is responsible for the accuracy of its menu, prices, stock and availability, business hours, delivery areas, business information and other Restaurant Content, and for order acceptance, preparation, packaging, fulfilment, cancellations, table bookings, Customer support, refunds and food safety for orders and bookings made through the website or table QR ordering, as set out in clause 7.

11.3 The Restaurant is the seller of food and other items ordered through the website and table QR ordering, and is the seller or "e-commerce entity" for the purposes of Applicable Law to the extent those laws apply. KnotKitchen hosts the ordering interface, is not the seller, does not collect payment for food, and is not a party to the contract between the Restaurant and its Customer.

11.4 The website will display the Restaurant's legal name, address, FSSAI licence number and other information Applicable Law requires the Restaurant to display, using the information the Restaurant provides. The Restaurant must keep that information accurate.

11.5 While the QR Table Ordering Add-on is active, KnotKitchen provides tables and table management, table QR codes and dine-in ordering. The Restaurant is responsible for displaying the QR codes at its tables and for the orders placed through them.

11.6 While the Store is Locked, the website is down and table QR ordering and table booking stop, under clause 13.4. When the Website Add-on ends or the Store is Closed, the website is taken offline. A website order that a Customer has already paid for online is still placed with the Restaurant, even if the Store becomes Locked or Closed while the payment is being completed.

## 11A. CUSTOM DOMAINS

11A.1 KnotKitchen does not register, buy, sell, renew or manage domain names for the Restaurant.

11A.2 While the Website Add-on is active, the Restaurant may connect to its website a domain name that it already owns and controls. The Restaurant is responsible for the domain's registration, renewal, DNS settings and registrar fees, and warrants that it has the right to use the domain. KnotKitchen may refuse or disconnect a domain that is unlawful, infringes another person's rights, or cannot be served securely. KnotKitchen is not liable for the loss or expiry of a domain that the Restaurant fails to renew.

11A.3 When the Website Add-on ends or the Store is Closed, KnotKitchen stops serving the website on the connected domain. The domain remains the Restaurant's.

---

## 12. TERM, CANCELLATION, TERMINATION AND SURVIVAL

12.1 **Term.** This Agreement starts on the Effective Date and continues until it ends under this clause. The subscription runs by Billing Period and renews under clause 6.

12.2 **Cancellation by the Restaurant.**\\
(a) The Restaurant may cancel its POS subscription at any time: in the application, from Billing, using the owner account; or by written notice to KnotKitchen under clause 20. KnotKitchen may also record in its system a cancellation it receives in writing.\\
(b) A cancellation takes effect at the end of the current Billing Period (the "**Cancellation Date**"). If the POS Plan was never activated, or its last Billing Period has already ended without renewal, the cancellation takes effect when it is made, and that is the Cancellation Date. Until the Cancellation Date, the Services continue and charges continue to apply, but no further renewal takes place.\\
(c) While a cancellation is pending, new Add-ons and Tablets cannot be taken up.\\
(d) A cancellation can be withdrawn before the Cancellation Date. The Restaurant may itself withdraw, in the application, only a cancellation that it made in the application. A cancellation that KnotKitchen recorded in its system, including one the Restaurant sent by written notice, is withdrawn through KnotKitchen support: the Restaurant asks by written notice under clause 20, and KnotKitchen then withdraws it. Once withdrawn, the subscription continues and renews as normal.\\
(e) On the Cancellation Date the subscription is cancelled, the Store is marked Closed, this Agreement ends, and clause 12.5 applies.\\
(f) Unused Wallet balance is not refunded on cancellation (clause 12A.1).

12.3 **Termination by the Restaurant for KnotKitchen's breach.** The Restaurant may terminate this Agreement by written notice with immediate effect if KnotKitchen commits a material breach and does not remedy it within 30 days of written notice describing the breach. Clause 12A.2(b) then applies.

12.4 **Termination and closure by KnotKitchen.** KnotKitchen may terminate this Agreement and close the Store:\\
(a) for convenience, on 30 days' written notice, in which case clause 12A.2(b) applies;\\
(b) with immediate effect by written notice, where the Restaurant commits fraud, uses the Services for an unlawful purpose, deliberately damages or misappropriates Equipment or KnotKitchen IP, creates a security threat to KnotKitchen's systems or other customers, or where a regulator or court requires it;\\
(c) for material breach (including repeated breaches of clause 7 or clause 8 after warning) not remedied within 15 days of written notice;\\
(d) for non-payment, under clause 13.7; or\\
(e) for prolonged inactivity under clause 13.8, or where the Restaurant becomes insolvent, has a liquidator or resolution professional appointed, or ceases business.\\
When KnotKitchen closes a Store, the Store is Closed at once, on the Termination Effective Date: renewals are cancelled, the POS is locked except for sign-in and Billing, and the website, table QR ordering and table booking stop, without waiting for the end of the current Billing Period. If KnotKitchen reopens the Store under clause 12.8, the subscription is reinstated and that restriction is lifted.

12.5 **Effect of cancellation and termination.** On the Cancellation Date or Termination Effective Date: the Store is Closed; the POS is locked except for sign-in and Billing, where the Restaurant can see its balance, charges and invoices but cannot top up the Wallet; the website is taken offline; table QR ordering and table booking stop; integrations are disconnected; every Tablet rental ends and the Tablets must be returned under clause 5.6; and the Wallet is dealt with under clause 12A.

12.6 **Dues survive.** Cancellation, termination, Lock or Suspension does not waive any Subscription Fees, Order Charges, E-bill Charges, repair or replacement costs, Taxes or other amounts already due, which remain payable.

12.7 **Data after closure.**\\
(a) KnotKitchen does not delete a Store's data merely because the Store is Closed. The Restaurant instructs KnotKitchen, under clause 8.10(a), to keep the Store's data, including Customer Data, for up to 12 months after closure, so that the Store can be reopened under clause 12.8 and the data exported under clause 12.7(b). After those 12 months, KnotKitchen may delete or de-identify the Customer Data under clause 8.10(h), after giving the Restaurant at least 30 days' notice, unless the Restaurant instructs otherwise in writing before then. As Data Fiduciary, the Restaurant remains responsible for deciding when Customer Data is no longer needed, and may ask for deletion at any time under clause 12.7(c). Otherwise the account is permanently deleted only if the Restaurant asks for it, or where Applicable Law requires deletion.\\
(b) At any time after closure, the Restaurant may ask in writing for an export of its order records, invoices, Customer Data and Restaurant Content. KnotKitchen will provide it within 30 days, in a commonly used electronic format.\\
(c) The Restaurant may ask in writing for permanent deletion of its account. KnotKitchen will then delete or de-identify the Store's data under clause 8.10(h) and confirm the deletion in writing. Deletion cannot be undone, and a deleted Store cannot be reopened.\\
(d) Even after deletion, KnotKitchen keeps the records it must keep under Applicable Law or needs to establish or defend legal claims, including tax and invoice records, the Wallet ledger, this Agreement, the acceptance record, the signed copy and the Commercial Schedule, for the retention period in clause 14.3 or any longer period Applicable Law requires, and then deletes them.

12.8 **Reopening a Closed Store.** KnotKitchen may, at the Restaurant's written request and at its discretion, reopen a Closed Store that has not been deleted. This Agreement, as last amended, then applies again, and the subscription is reinstated: a Billing Period that has not ended continues; otherwise the POS Plan restarts under clause 6.4 when the Wallet holds enough to pay the renewal or, if it was never activated, under clause 2.3. The Wallet balance on reopening is dealt with under clause 12A.1.

12.9 **Survival.** Clauses 0, 3.4, 4 (for amounts due), 5.3, 5.5, 5.6, 5.9, 8, 10, 12.5 to 12.9, 12A, 12B, 14.3, 14.5, 16, 16A, 17, 20 and 21, and any other clause that by its nature should survive, survive the end of this Agreement.

## 12A. WALLET AND REFUNDS

12A.1 **The Wallet is not refundable.** Unused Wallet balance, including any unused part of the Activation Top-up or a Tablet Top-up and any credit made to the Wallet under this Agreement, is not refunded, paid out or transferred on cancellation, closure, termination, Lock, Suspension or otherwise, except as stated in clause 12A.2. The Parties agree that the Wallet is a prepayment for Services that the Restaurant chooses when to use, not a deposit or security, and that its non-refundability is part of the pricing of the Services. After a cancellation, the Wallet balance continues to pay the Restaurant's charges up to the Cancellation Date and, if the cancellation is withdrawn under clause 12.2(d), the renewals that follow. If KnotKitchen reopens the Store under clause 12.8 within 12 months after it was Closed, the Wallet balance left at closure is available again.

12A.2 **The only exceptions.**\\
(a) **Duplicate or erroneous payments.** A duplicate payment, or an amount paid or charged in error, is refunded within 15 days of KnotKitchen confirming it: to the original payment method where it was paid to KnotKitchen, or to the Wallet where it was wrongly deducted from the Wallet.\\
(b) **Termination for KnotKitchen's convenience or breach.** Where KnotKitchen terminates for convenience under clause 12.4(a), or the Restaurant terminates for KnotKitchen's breach under clause 12.3, KnotKitchen refunds the unused Wallet balance and the Subscription Fees paid for the unused part of the current Billing Period, after deducting any amounts due, with a statement of the deductions. The refund is paid by bank transfer to the Restaurant's account within 30 days of the later of the Termination Effective Date and KnotKitchen's acknowledgement of the return of all Tablets.\\
(c) **Hardware Requests cancelled by KnotKitchen.** A refund for a Hardware Request that KnotKitchen cancelled is paid out by bank transfer at the Restaurant's request, under clause 5.11.\\
(d) **Applicable Law.** A refund is made where Applicable Law requires it.\\
A refund paid out of the Wallet balance under this clause is recorded as a debit adjustment to the Wallet under clause 4.3(h), with the bank transfer reference.

12A.3 **Periods already started.** Subscription Fees for a Billing Period that has started are not refunded when the Restaurant cancels, stops an Add-on or ends a Tablet rental. The Services continue until the end of that Billing Period.

12A.4 **Printers.** A Printer is not refundable once delivered, except under clause 5.9 or clause 12A.2. Before delivery, a Printer request may be cancelled under clause 5.11, and a refund for a Printer request that KnotKitchen cancelled may be paid out by bank transfer under that clause.

12A.5 **Failed transactions and reversals.** A failed top-up is not a payment, and nothing is due or refundable for it. Where a gateway reverses a top-up, the Wallet is debited accordingly under clause 4.3(h), and any amount the Wallet cannot cover is invoiced as in clause 5.5.

12A.6 **Taxes on refunds.** Refunds are made net of any Taxes that cannot be adjusted, and KnotKitchen will issue credit notes under clause 4.4(h).

12A.7 **Chargebacks.** If the Restaurant initiates a chargeback against a payment to KnotKitchen that KnotKitchen shows was validly due, the amount becomes due again: it is debited from the Wallet under clause 4.3(h), any amount the Wallet cannot cover is invoiced as in clause 5.5, and KnotKitchen may treat the chargeback as a breach under clause 13.9.

12A.8 **Mandatory rights.** Nothing in this Agreement limits a refund right that Applicable Law does not permit the Parties to exclude.

## 12B. CONFIDENTIALITY

12B.1 Each Party will keep confidential all non-public business, commercial, pricing, technical, security, credential and customer information received from the other Party in connection with this Agreement ("**Confidential Information**"), use it only to perform this Agreement, and disclose it only to its employees, advisers and sub-contractors who need it and are bound by equivalent obligations.

12B.2 Confidential Information does not include information that is or becomes public without breach; was lawfully known to the recipient before disclosure; is lawfully received from a third party without restriction; or is independently developed without use of the disclosing Party's information.

12B.3 A Party may disclose Confidential Information where required by law, a court or a regulator, after giving the other Party notice where lawful and limiting disclosure to what is required.

12B.4 This clause survives for three years after the end of this Agreement, and for trade secrets and credentials for as long as they remain confidential.

---

## 13. GRACE PERIOD, LOCK AND SUSPENSION

13.1 **Before activation.** Until the POS Plan is activated under clause 2.3, the Store is Locked except for sign-in and Billing. No Grace Period applies.

13.2 **When the Grace Period starts.** The Grace Period starts when: (a) a renewal under clause 6 cannot be paid in full; (b) any other charge, except an E-bill Charge (clause 3.5) and any amount that KnotKitchen invoices separately under clause 5.5, 12A.5 or 12A.7 (payable within 15 days of the invoice), cannot be paid from the Wallet when it falls due; or (c) the Wallet balance reaches ₹0, even if the current Billing Period is paid. The application shows on the Billing screen the amount needed and when the Lock will start. KnotKitchen may also send a reminder by SMS, WhatsApp or email, but the absence of a reminder does not delay the Lock.

13.3 **Grace Period.** The Restaurant has a **24-hour Grace Period** to pay the amount due or, under clause 13.2(c), to top up the Wallet. The Services continue during the Grace Period.

13.4 **Full Lock.** If the amount is not paid by the end of the Grace Period, the account is Locked:\\
(a) the POS is locked except for sign-in and Billing, where the Restaurant can see its balance, charges and invoices and top up the Wallet;\\
(b) the Restaurant's website is down and shows a "temporarily unavailable" page instead of the menu, and accepts no orders, payments or bookings; and\\
(c) table QR ordering and table booking stop.

13.5 **Unlocking.** The Lock ends automatically as soon as the amount due is paid, including any renewal that the top-up completes under clause 6.3, and, where the Lock arose under clause 13.2(c), as soon as the Wallet holds a positive balance.

13.6 **During a Lock.** Amounts already due remain due. No new Billing Period starts until the renewal is paid, and the days not covered are not charged (clause 6.4). Add-ons and Tablet rentals renew only together with the POS Plan. The Store's data is kept. The Restaurant keeps its rented Tablets and remains responsible for them.

13.7 **Prolonged non-payment.** If the Store remains Locked for non-payment for 30 days, KnotKitchen may send a final notice by email and in the application giving at least 7 days to pay. If payment is not received by the end of that period, KnotKitchen may close the Store under clause 12.4(d), and the Tablets must be returned under clause 5.6.

13.8 **Prolonged inactivity.** If the POS Plan has not been renewed, and the Store has processed no orders and had no sign-in, for 6 consecutive months, KnotKitchen may notify the Restaurant and, if there is no response within 30 days, close the Store under clause 12.4(e).

13.9 **Suspension for other reasons.** KnotKitchen may also suspend the Store, with as much notice as is reasonable in the circumstances, for: material breach of this Agreement; fraudulent or unlawful activity; misuse of KnotKitchen systems or Equipment; a security threat; or where required by law or a competent authority. Suspension continues until the cause is remedied, and may lead to termination under clause 12.4.

13.10 **Immediate action.** Nothing in this clause prevents KnotKitchen from suspending the Store immediately, or terminating under clause 12.4(b), where fraud, security abuse, illegal activity or a legal requirement makes immediate action necessary.

---

## 14. ELECTRONIC ACCEPTANCE AND SIGNATURE

14.1 **How this Agreement is made.** KnotKitchen staff operate the KnotKitchen onboarding portal together with the Restaurant's authorised signatory. The steps are: (a) KnotKitchen staff enter the Restaurant's details and documents supplied by the signatory; (b) the portal generates this Agreement from those details; (c) the signatory reviews the Agreement text; (d) the signatory confirms each acceptance statement in clause 18, which KnotKitchen staff record in the portal on the signatory's instruction; (e) the Agreement is downloaded as a PDF; (f) the signatory signs it by the method recorded in clause 14.2; and (g) the signed copy is uploaded to the portal and submitted. KnotKitchen accepts this Agreement by its authorised signatory countersigning it, or by creating the Store after Verification under clause 15, whichever happens first. KnotKitchen staff who operate the portal, including the onboarding agent named in the execution block, do not sign or accept this Agreement for KnotKitchen. Contracts formed through electronic means are valid under section 10A of the Information Technology Act, 2000 ("**IT Act**").

14.2 **Signature methods.** The Restaurant's signatory signs by one of these methods: (a) a **handwritten signature** on the printed Agreement, scanned and uploaded as an electronic record of the signed document (the default method), in which case the Restaurant will keep the signed paper original and give it to KnotKitchen on request; (b) **Aadhaar eSign**, for example through DigiLocker, an electronic signature technique specified in the Second Schedule to the IT Act and an electronic signature under section 3A of that Act; or (c) a **digital signature** under section 3 of the IT Act, using a Digital Signature Certificate. **The method recorded for this Agreement is: [SIGN_METHOD].** The confirmations recorded in the portal are evidence of the Restaurant's assent and identity, but are not by themselves a signature.

14.3 **Audit trail.** KnotKitchen records and keeps an acceptance record of this Agreement, including: the Agreement version; a SHA-256 hash of the Agreement text; the date of generation and the date and time of submission; a SHA-256 hash of the signed copy; the signatory's name, designation and entity type; the signature method; the KnotKitchen staff account that operated the portal; and the IP address and device information of the submission. KnotKitchen keeps the acceptance record, the signed copy and the Commercial Schedule for the term of this Agreement and 8 years after it ends, even if the account has been deleted.

14.4 **Copies.** On request, KnotKitchen will send the Restaurant, by email to its notice email, a copy of this Agreement as generated, the signed copy and its Commercial Schedule entries.

14.5 **Evidence.** The Parties agree that the acceptance record, the KnotKitchen system logs and the Commercial Schedule are electronic records that may be produced as evidence, and that KnotKitchen may provide the certificate contemplated by section 63 of the Bharatiya Sakshya Adhiniyam, 2023 in respect of them.

14.6 **Capacity and authority.** The person signing this Agreement for the Restaurant represents and warrants that: (a) the Restaurant has legal capacity to enter into this Agreement; (b) he or she is authorised to sign it on behalf of the Restaurant, being, as applicable, the proprietor, a partner authorised by the partnership, a designated partner of the LLP, a director or authorised officer of the company under a board resolution, or the authorised representative of another entity; (c) the Restaurant has the right to use the business name and information provided; (d) all information provided is accurate and complete; and (e) the Restaurant will keep its account credentials secure and is bound by actions taken through its account; and (f) the Restaurant enters into this Agreement for the purposes of its business. KnotKitchen may request proof of authority (such as a partnership deed, board resolution or authorisation letter) during Verification.

14.7 **Stamp duty.** Electronic execution does not remove any stamp duty. Stamp duty or e-stamping, if any, applicable to this Agreement under the stamp law of the State in which the Agreement is executed or the Restaurant is located will be borne by KnotKitchen, which will stamp or e-stamp the Agreement where Applicable Law requires. The Restaurant will cooperate as reasonably needed for this.

14.8 **Counterparts and copies.** This Agreement may be signed in counterparts, and an electronic copy, including a scanned copy, has the same effect as an original.

---

## 15. VERIFICATION AND ONBOARDING

15.1 Submission of the signed Agreement is not by itself approval of the Restaurant.

15.2 KnotKitchen may verify the Restaurant's information, documents, authority and signed Agreement, and may decline to create a Store that fails Verification. In that case no Store is created, nothing is payable, and neither Party has any further obligation under this Agreement.

15.3 After successful Verification, KnotKitchen creates the Store, assigns its Store ID and gives the Restaurant its sign-in details. The Restaurant then activates the POS Plan under clause 2.3.

---

## 16. LIMITATION OF LIABILITY

16.1 **Excluded losses.** Subject to clause 16.4, neither Party is liable to the other, whether in contract, tort (including negligence), under statute or otherwise, for any indirect or consequential loss, or for loss of profits, revenue, business, anticipated savings, goodwill or data (other than KnotKitchen's obligation to restore Customer Data from its last available backup where the loss was caused by KnotKitchen), even if advised of the possibility.

16.2 **Third-party causes.** KnotKitchen is not liable for loss caused by Third-Party Services, payment gateways, Marketplaces, internet or telecommunications failures, the Restaurant's devices, Restaurant-provided information or Restaurant Content, the Restaurant's operations or food, or events under clause 16B, except to the extent the loss results from KnotKitchen's own breach of this Agreement.

16.3 **Cap.** Subject to clause 16.4:\\
(a) KnotKitchen's total aggregate liability arising out of or in connection with this Agreement in any 12-month period, other than for breach of clause 8, is limited to the total Subscription Fees (for the POS Plan, Add-ons and Tablet rental), Order Charges and E-bill Charges, excluding Taxes and Printer prices, paid by the Restaurant to KnotKitchen in the **six months** immediately before the event giving rise to the claim;\\
(b) KnotKitchen's total aggregate liability for breach of clause 8 (Data Protection) in any 12-month period is limited to twice the amount in clause 16.3(a); and\\
(c) refunds, Wallet credits and payouts that KnotKitchen must make under this Agreement, including under clauses 1A.3, 3.4, 5.9, 5.11, 9.3, 12A.2 and 16B.3, are not counted towards, and are not limited by, the limits in this clause.

16.4 **Carve-outs.** Nothing in this Agreement excludes or limits either Party's liability for: fraud or fraudulent misrepresentation; wilful misconduct; death or personal injury caused by negligence; breach of clause 12B (Confidentiality); infringement of the other Party's intellectual property; the Restaurant's payment obligations and its obligations for Tablets under clauses 5.5 and 5.6; the indemnities in clause 16A; or any liability that cannot be excluded or limited under Applicable Law.

16.5 **Proportionality.** The Parties acknowledge that the fees reflect this allocation of risk and that these limits are reasonable for a subscription service of this kind.

## 16A. INDEMNITIES

16A.1 **By the Restaurant.** The Restaurant will indemnify KnotKitchen, its proprietor, directors, employees and agents against all losses, damages, costs (including reasonable legal costs), fines and claims arising from: (a) the Restaurant's food, food safety, hygiene or restaurant services; (b) failure to hold an FSSAI licence or other licence, registration or permission required for its business; (c) Restaurant Content that is unlawful, misleading or infringes third-party rights; (d) the Restaurant's misuse of the Services, KnotKitchen IP or Equipment; (e) Customer Data supplied or collected by the Restaurant without the notices or consents Applicable Law requires; (f) fraudulent activity by the Restaurant or its staff; (g) the Restaurant's breach of Applicable Law; and (h) any claim by a Customer, Marketplace or authority relating to the Restaurant's business, except to the extent caused by KnotKitchen's breach of this Agreement.

16A.2 **By KnotKitchen.** KnotKitchen will indemnify the Restaurant against damages, costs (including reasonable legal costs) and settlements finally awarded or agreed in a third-party claim that the KnotKitchen software, as provided by KnotKitchen and used in accordance with this Agreement, infringes an Indian patent, copyright or trademark. KnotKitchen has no obligation for claims arising from Restaurant Content, Third-Party Services, modifications not made by KnotKitchen, or use after KnotKitchen has offered a non-infringing alternative. KnotKitchen may, at its option, procure the right to continue, modify or replace the software, or terminate the affected Service and credit the Wallet pro rata with the fees paid for it. This clause is the Restaurant's exclusive remedy for infringement claims.

16A.3 **Procedure.** The indemnified Party must: notify the indemnifying Party promptly of the claim (delay relieves the indemnifying Party only to the extent it is prejudiced); allow the indemnifying Party to control the defence and settlement, provided no settlement admits fault of, or imposes obligations on, the indemnified Party without its consent, which is not to be unreasonably withheld; cooperate at the indemnifying Party's cost; and take reasonable steps to mitigate loss.

## 16B. FORCE MAJEURE

16B.1 Neither Party is liable for failure or delay in performing (other than payment obligations) caused by events beyond its reasonable control, including natural disaster, epidemic, war, terrorism, riot, government action or order, strikes or industrial action beyond the Party's own workforce, failure of public internet or telecommunications networks, major cloud-infrastructure or data-centre outages, payment-provider outages, or comparable events ("**Force Majeure**").

16B.2 The affected Party must notify the other promptly, use reasonable efforts to mitigate and resume performance, and keep the other informed. Force Majeure does not excuse ordinary operational failures that a Party could reasonably have prevented, and does not cover a failure of a supplier that the affected Party could have replaced with reasonable diligence.

16B.3 Where a Service is entirely unavailable for more than 7 consecutive days because of Force Majeure, KnotKitchen credits the Wallet pro rata with the Subscription Fee for that Service for the period of unavailability. If Force Majeure prevents substantial performance for more than 60 consecutive days, either Party may terminate this Agreement by written notice, and clause 12A applies.

---

## 17. GOVERNING LAW AND DISPUTE RESOLUTION

17.1 This Agreement is governed by the laws of India.

17.2 **Negotiation.** A Party with a dispute must first notify the other in writing. The Parties' representatives will meet (including by video) within 15 days to try to resolve it.

17.3 **Arbitration.** Any dispute not resolved within 30 days of the notice will be referred to and finally resolved by arbitration under the Arbitration and Conciliation Act, 1996, as amended. The tribunal will consist of a sole arbitrator appointed by agreement of the Parties or, failing agreement within 30 days of a request, under section 11 of that Act. The seat and venue of arbitration is **Kolkata, West Bengal, India**; hearings may be held by video conference. The language is English. The award is final and binding, and may be enforced in any court of competent jurisdiction.

17.4 **Interim relief and excluded matters.** Either Party may seek interim or urgent relief under section 9 of the Arbitration and Conciliation Act, 1996 or otherwise from a competent court. Clause 17.3 does not prevent either Party from pursuing a claim before any statutory forum or authority whose jurisdiction cannot lawfully be excluded by agreement, or a claim for recovery of undisputed amounts due, before the courts.

17.5 **Courts.** Subject to clauses 17.3 and 17.4, the courts at **Kolkata, West Bengal, India** have jurisdiction over matters arising from this Agreement, to the extent Applicable Law permits the Parties to so agree.

---

## 18. AGREEMENT ACCEPTANCE

By signing this Agreement in the manner described in clause 14, the Restaurant's authorised signatory confirms each of the following statements:

- The information and documents provided are accurate and complete.
- I am authorised to sign this Agreement for the Restaurant.
- I have read and accept this Agreement, including the standard charges in Annexure B and the Wallet, refund, Equipment, suspension and termination terms.
- I understand that the POS Plan starts with a first Wallet top-up of at least ₹2,500, that the Wallet is not refundable except as stated in this Agreement, and that add-ons, tablets and printers are chosen and accepted in the KnotKitchen application.
- I have signed this Agreement by the method recorded in it.

---

## 19. AMENDMENTS

19.1 **Prices.** Changes to prices and charges are made only under clause 2.8.

19.2 **Changes that reduce the Restaurant's rights.** Any other change to this Agreement that reduces the Restaurant's rights or increases its obligations applies to the Restaurant only after at least 30 days' notice by email and in the application, and with the Restaurant's express acceptance in the application or in writing. If the Restaurant does not accept, the existing terms continue to apply to it, and KnotKitchen may instead end this Agreement for convenience under clause 12.4(a).

19.3 **Operational updates.** KnotKitchen may update software features, the application interface, support procedures, the acceptable-use rules and its own Privacy Policy by notice in the application, provided the update does not reduce the Restaurant's rights under this Agreement. Changes required by Applicable Law or a regulator take effect when the law requires.

19.4 **No retrospective change.** No amendment applies to charges already made or to periods already paid for. Each version of this Agreement is dated and retained, and the version signed by the Restaurant is recorded in the acceptance record under clause 14.3.

---

## 20. NOTICES

20.1 **Notices to KnotKitchen.** Notices to KnotKitchen, including a notice of cancellation, must be sent by email to **[KK_NOTICE_EMAIL]**, or by post or courier to [KK_PARTY_ADDRESS]. KnotKitchen's support phone, **[KK_NOTICE_PHONE]**, is for support and does not replace a written notice.

20.2 **Notices to the Restaurant.** Notices to the Restaurant are sent by email to its notice email, **[EMAIL]**, in the application, or by post or courier to [ADDRESS]. Payment reminders and service messages may also be sent by SMS or WhatsApp to its notice phone, **[PHONE]**.

20.3 **Authority of the Restaurant's notices.** A notice from the Restaurant must be sent from its notice email or signed by its authorised signatory. Before acting on a cancellation, withdrawal, deletion request or change of notice details, KnotKitchen may confirm it by calling the notice phone.

20.4 **When a notice is received.** An email is received when it is sent, unless the sender receives a delivery failure message; if it is sent after 6:00 pm IST, or on a Sunday or public holiday, it is received on the next working day. A notice in the application is received when it is posted there. A notice by post or courier is received on delivery.

20.5 **Change of details.** Each Party must keep its notice details current and may change them by notice under this clause. The Restaurant may also update them in the application.

---

## 21. GENERAL

21.1 **Relationship.** The Parties are independent contractors. Nothing creates a partnership, joint venture, agency, franchise or employment relationship, and neither Party may bind the other.

21.2 **Assignment.** The Restaurant may not assign or transfer this Agreement without KnotKitchen's written consent, not to be unreasonably withheld for a transfer of the Restaurant business as a going concern. KnotKitchen may assign this Agreement to an affiliate, to a company or LLP formed to carry on the KnotKitchen business, or to a successor to its business, on notice, provided the Restaurant's rights are not reduced, and may use sub-contractors while remaining responsible for them.

21.3 **Severability.** If any provision is held invalid or unenforceable, it is severed to the minimum extent necessary and the remainder continues in force; the Parties will replace it with a valid provision closest to the original intent.

21.4 **Waiver.** A failure or delay in exercising a right is not a waiver, and a waiver of one breach is not a waiver of another.

21.5 **Entire agreement.** This Agreement, with its Annexures, the Commercial Schedule and the documents it expressly incorporates (KnotKitchen's Privacy Policy and any acceptable-use rules published in the application), is the entire agreement between the Parties on its subject matter and supersedes prior proposals and discussions. Neither Party relies on any statement not set out in it, without prejudice to liability for fraud.

21.6 **Order of precedence.** In case of conflict: (1) the Commercial Schedule, for the values it records; (2) the clauses of this Agreement; (3) Annexure B; (4) KnotKitchen's Privacy Policy; and (5) acceptable-use rules and other documents published in the application. Annexure A records the Restaurant's profile and does not alter the clauses.

21.7 **Compliance with law.** Each Party will comply with Applicable Law in performing this Agreement, including anti-bribery, tax and data-protection law.

21.8 **Security and anti-fraud.** The Restaurant will not attempt to gain unauthorised access to KnotKitchen's systems, interfere with their operation, introduce malicious code, or use the Services to defraud Customers, Marketplaces, KnotKitchen or any person, and will promptly report suspected security incidents affecting its Store.

21.9 **Non-solicitation.** During the term and for six months after, neither Party will, without the other's consent, directly solicit for employment an employee of the other with whom it dealt under this Agreement. This does not restrict general advertising or hiring a person who responds to it, and imposes no restriction on either Party's trade or business.

21.10 **Third-party rights.** No person other than the Parties has any right to enforce this Agreement.

---

## EXECUTION

Signed by the authorised signatories of the Parties.

### FOR KNOTKITCHEN

**For [KK_PARTY_NAME]**\\
Name and designation of authorised signatory: ____________________\\
Signature: ____________________\\
Date: ____________________

Onboarding agent: [SALES_AGENT]

### FOR THE RESTAURANT

**For [RESTAURANT_NAME]** ([LEGAL_NAME], [ENTITY_TYPE])\\
**Authorised Signatory:** [OWNER], [DESIGNATION]\\
**Signature method:** [SIGN_METHOD]\\
Signature: ____________________\\
Date: ____________________

ANNEXURE_A_PLACEHOLDER

ANNEXURE_B_PLACEHOLDER

---

**Agreement ID:** [AGREEMENT_ID]\\
**Agreement Version:** [VERSION]\\
**Generated On:** [GENERATED_DATE]

**End of Agreement**`;

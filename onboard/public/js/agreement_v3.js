/* KnotKitchen Restaurant Service Agreement v3.0. Keep AGREEMENT_VERSION in step
   with pos-backend/constants/agreement.js. This Agreement states no prices:
   purchase prices and minimum top-ups are shown and accepted in the KnotKitchen
   application (the Commercial Schedule); usage charges (the Platform Fee and the
   e-bill charge) are set by KnotKitchen in CSD and notified by email, and the
   POS app never shows their rates, so clause 3.2 is their contractual basis.
   The PDF renderer supports only #/##/### headings, ---, flat "- " bullets,
   **bold**, paragraphs and a trailing \\ line break: no tables, no nested
   bullets, no numbered markdown lists. */

window.AGREEMENT_VERSION = "v3.0";

window.KK_PARTY = {
  name: "KnotKitchen",
  legalDescription: "",
  address: "J/183 Baishnabghata Patuli, Kolkata – 700094",
  supportEmail: "support@knotkitchen.com",
  supportPhone: "+91 8062177510",
};

window.AGREEMENT_TEMPLATE_V3 = `## KNOTKITCHEN RESTAURANT SERVICE AGREEMENT

**Agreement ID:** [AGREEMENT_ID]\\
**Agreement Version:** [VERSION]\\
**Effective Date:** [EFFECTIVE_DATE]

This Agreement is made between **(1) [KK_PARTY_NAME]**, of [KK_PARTY_ADDRESS], which operates the KnotKitchen platform ("**KnotKitchen**"); and **(2)** the restaurant business below (the "**Restaurant**"):

**Restaurant / Business Name:** [RESTAURANT_NAME]\\
**Legal Business Name:** [LEGAL_NAME]\\
**Type of Entity:** [ENTITY_TYPE]\\
**Registered / Business Address:** [ADDRESS]\\
**GSTIN:** [RESTAURANT_GSTIN]\\
**PAN:** [RESTAURANT_PAN]\\
**FSSAI Licence / Registration No.:** [FSSAI] (valid until [FSSAI_VALIDITY])\\
**Authorised Signatory:** [OWNER], [DESIGNATION]\\
**Notice Phone:** [PHONE]\\
**Notice Email:** [EMAIL]

---

## 1. KEY TERMS

- "**Application**" means the KnotKitchen POS application, onboarding portal and any KnotKitchen web or mobile interface.
- "**Billing Period**" means a 30-day period, or a 365-day period for an Add-on that the Application shows as yearly, starting at 00:00 IST, for which Subscription Fees are charged.
- "**Commercial Schedule**" means the record kept by the KnotKitchen system of each price, charge, Tax and total that the Application showed and the Restaurant accepted.
- "**Customer Data**" means data about the Restaurant's customers collected or generated through the Services, including their Personal Data under the Digital Personal Data Protection Act, 2023 ("**DPDP Act**").
- "**Services**" means the POS Plan, the Add-ons the Restaurant takes up, Tablet and Printer sales, Tablet rentals that started before 3 October 2026, and the integrations described in clause 2.
- "**Store**" means the Restaurant's account and outlet on the KnotKitchen platform.
- "**Wallet**" means the prepaid balance KnotKitchen keeps for the Restaurant under clause 4.

Times are Indian Standard Time ("**IST**"). "Including" means "including without limitation". "Written" includes email and notices in the Application.

---

## 2. SERVICES

2.1 The Services are: a cloud **POS Plan** for takeaway and delivery (billing, menu, reports, e-bills); optional **Add-ons** (such as QR Table Ordering, an ordering Website with online payments and table booking, and Google Business Profile management); **Tablets** and **Printers** for purchase (Tablet rentals that started before 3 October 2026 continue under clauses 5.1 and 5.2); and supported integrations with third-party services and marketplaces. The Application shows which features belong to the POS Plan and to each Add-on.

2.2 KnotKitchen is a technology provider only. It does not prepare, sell or deliver food, is not the seller of anything ordered through the Services, and does not collect or hold Customer payments. Customer payments go through a payment gateway account in the Restaurant's own name and are settled directly to the Restaurant, including any Platform Fee, which the Restaurant collects with the order payment under clause 3.2.

2.3 KnotKitchen will use reasonable efforts to keep the Services available but does not promise uninterrupted operation, and offers no uptime guarantee. KnotKitchen may carry out maintenance and change features. It will give at least 30 days' notice before withdrawing a feature material to a Service the Restaurant pays for, and will credit the Wallet pro rata for any unused paid period of that Service.

2.4 For Google Business Profile management, the Restaurant remains owner of its profile and KnotKitchen does not control Google's decisions. For marketplace integrations (such as Swiggy or Zomato), KnotKitchen provides only technical connectivity; the Restaurant's relationship with each marketplace is governed by its own agreement with that marketplace.

---

## 3. PRICES AND CHARGES

3.1 **Prices are in the Application.** Prices for purchases, including Subscription Fees for the POS Plan, Add-ons and rented Tablets, Tablet and Printer prices and any minimum top-up amounts, are those shown in the Application. Before the Restaurant confirms any purchase, the Application shows the item, its price, any pro-rata amount, Taxes and the total payable. What is shown and accepted is recorded in the Commercial Schedule, forms part of this Agreement and cannot be changed retrospectively.

3.2 **Usage charges and Platform Fee.** Usage charges are set by KnotKitchen. When a Customer pays online for an order placed through the Restaurant's website or table QR ordering, a fee (the "**Platform Fee**"), plus GST where applicable under clause 3.4, is added to the Customer's bill as a separate "Platform fee" line shown before payment. The Restaurant authorises this, collects the Platform Fee with the order payment through its own payment gateway account, and KnotKitchen deducts the same amount from the Wallet once the payment is confirmed. No Platform Fee applies to an order paid in cash or at the counter. If an order carrying a deducted Platform Fee is cancelled or rejected, KnotKitchen credits that amount back to the Wallet. An e-bill charge applies once for each bill sent to a Customer as an e-bill. A usage charge applies only from the start date that KnotKitchen notifies by email in advance, and its amount and any change to it are always notified by email. Each deduction appears on the Wallet statement.

3.3 **Price changes.** KnotKitchen may change prices for the future on at least 30 days' notice by email or in the Application. A change applies from the first renewal after the notice period ends. Amounts already paid are not affected.

3.4 **Taxes.** GST is charged only while KnotKitchen is registered under GST and from the start date shown in the Application. The Application and each invoice show whether GST applies and whether a price includes it. Tablet and Printer prices include GST. The Restaurant must keep its GSTIN, legal name and address accurate for input tax credit.

3.5 **Invoices and disputes.** KnotKitchen issues invoices and a Wallet statement in the Application. The Restaurant may dispute a charge in writing within 30 days; KnotKitchen will reply within 15 days and correct any charge made in error.

---

## 4. WALLET, ACTIVATION AND RENEWAL

4.1 **Wallet.** Charges are paid from the prepaid Wallet, which is topped up online only, through KnotKitchen's payment gateway. Tablet and Printer purchases are paid online at the time of purchase. The Wallet can be used only for KnotKitchen's charges, earns no interest, is not transferable, cannot go below zero and is **not refundable**, except under clause 9. Unpaid amounts are collected from the next top-up.

4.2 **Activation.** Until activation the Store is locked except for sign-in and Billing. The POS Plan activates when the Restaurant makes a first top-up of at least the minimum shown in the Application. The first Subscription Fee is then deducted, and the first Billing Period starts at 00:00 IST that day. The rest stays in the Wallet.

4.3 **Add-ons.** Add-ons can be taken up while the POS Plan is active. A 30-day Add-on is charged pro rata for the current Billing Period and in full at each renewal. An Add-on that the Application shows as yearly is charged in full when taken up, for its own Billing Period starting at 00:00 IST that day. An Add-on may be stopped at any time and ends at the end of its current Billing Period, without refund.

4.4 **Renewal.** Each Billing Period renews automatically from the Wallet for the POS Plan, active 30-day Add-ons and rented Tablets together. If the Wallet cannot pay the full amount, nothing is renewed until it can. A yearly Add-on renews from the Wallet on its own date; if the Wallet cannot pay for it, only that Add-on stops until it is paid, and it is not renewed once the Restaurant has cancelled or the Store is Closed. A late renewal starts a new Billing Period on the day it is paid and is not backdated. There is no minimum term.

4.5 **Grace Period and Lock.** If a renewal (other than of a yearly Add-on) or charge cannot be paid, or the Wallet reaches zero, the Restaurant has a **24-hour Grace Period** to top up. If it does not, the Store is **Locked**: the POS is limited to sign-in and Billing, the website shows as unavailable, and table QR ordering and booking stop. The Lock ends automatically once the amount due is paid. Data is kept during a Lock.

4.6 **Prolonged non-payment.** If the Store stays Locked for 30 days, KnotKitchen may give a final notice of at least 7 days and then close the Store.

---

## 5. TABLETS AND PRINTERS

5.1 **Rented Tablets.** KnotKitchen no longer rents out Tablets. A Tablet rental that started before 3 October 2026 continues until it ends under clause 5.2. A rented Tablet remains KnotKitchen's property and must be kept at the Restaurant's premises and used only for the Services. KnotKitchen repairs or replaces faulty rented Tablets at its own cost, except for loss, theft or damage beyond ordinary wear and tear, for which the Restaurant pays the actual repair or replacement cost shown on the supplier's invoice (deducted from the Wallet, or invoiced and payable within 15 days).

5.2 **Return.** The Restaurant may end a Tablet rental by written notice, effective at the end of the current Billing Period. All rentals end when the Store is Closed. Rented Tablets must be returned in working order within 15 days after the rental ends. A Tablet not returned within 7 days after a written reminder is treated as lost.

5.3 **Tablets and Printers bought.** Tablets and Printers are bought outright. Ownership and risk pass on delivery. A Tablet or Printer that is dead on arrival or fails within 7 days of delivery, and is reported in that time, is replaced free (or refunded if no replacement is available within 15 days), unless caused by misuse or damage. After that, the manufacturer's warranty applies.

5.4 **Hardware Requests.** Tablets and Printers are requested from Billing, and their status is shown in the Application. The Restaurant may cancel a request while it is still REQUESTED, for a full refund to the Wallet. KnotKitchen may cancel an undelivered request and refund it to the Wallet (less documented costs if the cancellation was due to the Restaurant); the Restaurant may ask for that refund by bank transfer.

---

## 6. RESTAURANT RESPONSIBILITIES

6.1 The Restaurant is solely responsible for its food and business, including: food quality, safety, hygiene, allergens and labelling; its FSSAI licence and all other licences, registrations and legal compliance; the accuracy and lawfulness of its menus, prices, images and other content; accepting, preparing and fulfilling orders and bookings; Customer support, cancellations and refunds; its payment gateway account and its KYC; and keeping its credentials and devices secure. The Restaurant is the seller of everything ordered through its website and table QR ordering.

6.2 The Restaurant will use the Services lawfully, will not send unsolicited communications in breach of law, will not attempt unauthorised access to or misuse of KnotKitchen's systems, and will not copy, resell, reverse engineer or build a competing product from KnotKitchen software.

6.3 Any domain the Restaurant connects to its website must be one it owns; KnotKitchen does not register or renew domains.

---

## 7. DATA PROTECTION AND CONFIDENTIALITY

7.1 **Roles.** KnotKitchen is Data Fiduciary for the Restaurant's own account, staff and billing data. For Customer Data, the Restaurant is Data Fiduciary and KnotKitchen is its Data Processor under section 8(2) of the DPDP Act. The Restaurant must give Customers the notices and obtain the consents the law requires.

7.2 **KnotKitchen's duties.** KnotKitchen will process Customer Data only to provide the Services and as the law requires; will not sell it; will apply reasonable security safeguards (access controls, encryption in transit, logging and backups); will bind its staff and sub-processors (hosting, messaging, payment and maps providers) to equivalent protections and remain responsible for them; will notify the Restaurant of a Personal Data breach without undue delay and where feasible within 24 hours; will help the Restaurant respond to Customer requests; and will transfer data outside India only where the law permits.

7.3 **Ownership.** The Restaurant owns its content and Customer Data, subject to Customers' rights. KnotKitchen owns its software, platform and all related intellectual property, and grants the Restaurant a limited, non-transferable right to use the Services during this Agreement. The Restaurant licenses KnotKitchen to use its content as needed to provide the Services.

7.4 **Confidentiality.** Each Party will keep the other's non-public business, pricing, technical, credential and customer information confidential, use it only for this Agreement and disclose it only as the law requires. This survives for three years after this Agreement ends (and for credentials and trade secrets, for as long as they remain confidential).

---

## 8. TERM, CANCELLATION AND TERMINATION

8.1 **Term.** This Agreement starts on the Effective Date and continues until cancelled or terminated.

8.2 **Cancellation by the Restaurant.** The Restaurant may cancel at any time in the Application (owner account) or by written notice. Cancellation takes effect at the end of the current Billing Period (or at once if the POS Plan is not active), and may be withdrawn before then. On that date the Store is Closed and this Agreement ends.

8.3 **Termination.** The Restaurant may terminate for KnotKitchen's material breach not remedied within 30 days of notice. KnotKitchen may terminate and close the Store: for convenience on 30 days' notice; immediately for fraud, unlawful use, security threats or legal requirement; for material breach not remedied within 15 days of notice; for non-payment under clause 4.6; or after 6 months of inactivity with no response to a 30-day notice.

8.4 **Effect.** When the Store is Closed: the POS is limited to sign-in and viewing Billing; the website, table ordering and integrations stop; rented Tablets must be returned under clause 5.2; and amounts already due remain payable.

8.5 **Data after closure.** KnotKitchen keeps the Store's data for up to 12 months after closure so that the Store can be reopened or its data exported, and may then delete Customer Data after 30 days' notice. The Restaurant may ask at any time for an export (provided within 30 days) or for permanent deletion (completed within 60 days from live systems and a further 90 days from backups). KnotKitchen keeps records the law requires, including tax records, the Wallet ledger, this Agreement and its acceptance record, for 8 years after this Agreement ends.

8.6 **Reopening.** KnotKitchen may, on request, reopen a Closed Store that has not been deleted, and this Agreement then applies again. If reopened within 12 months, the Wallet balance left at closure is available again.

---

## 9. REFUNDS

9.1 The Wallet balance and Subscription Fees for a Billing Period that has started are not refunded, except:

- a duplicate or erroneous payment or charge, refunded within 15 days of confirmation;
- where KnotKitchen terminates for convenience or the Restaurant terminates for KnotKitchen's breach: the unused Wallet balance and unused Subscription Fees, less amounts due, by bank transfer within 30 days after termination and return of all rented Tablets;
- Hardware Requests cancelled under clause 5.4, and Tablets and Printers under clause 5.3; and
- where the law requires a refund.

9.2 A payment reversed or charged back by the Restaurant's gateway or bank is debited back from the Wallet, and any shortfall is invoiced and payable within 15 days.

---

## 10. LIABILITY

10.1 Neither Party is liable for indirect or consequential loss, or loss of profits, revenue, goodwill or data (except KnotKitchen's duty to restore Customer Data from backup where it caused the loss). KnotKitchen is not liable for loss caused by third-party services, payment gateways, marketplaces, internet failures, the Restaurant's devices, content, food or operations, except to the extent caused by its own breach.

10.2 KnotKitchen's total liability in any 12 months is limited to the fees (excluding Taxes and Tablet and Printer prices) paid by the Restaurant in the six months before the claim, or twice that amount for breach of clause 7. Refunds and credits due under this Agreement are not limited by this cap.

10.3 Nothing limits liability for fraud, wilful misconduct, death or personal injury caused by negligence, breach of confidentiality, infringement of the other Party's intellectual property, the Restaurant's payment and rented-Tablet obligations, the indemnities below, or any liability the law does not allow to be limited.

10.4 **Indemnities.** The Restaurant indemnifies KnotKitchen against claims arising from its food, licences, content, misuse of the Services, collection of Customer Data without required consents, fraud or breach of law. KnotKitchen indemnifies the Restaurant against third-party claims that KnotKitchen software, used as permitted, infringes Indian intellectual property rights.

10.5 **Force majeure.** Neither Party is liable for delay caused by events beyond its reasonable control (other than payment obligations). If a Service is unavailable for more than 7 consecutive days for this reason, KnotKitchen credits the Wallet pro rata; after 60 days, either Party may terminate.

---

## 11. EXECUTION, VERIFICATION AND EVIDENCE

11.1 KnotKitchen staff operate the onboarding portal with the Restaurant's authorised signatory, who reviews this Agreement, confirms the statements in clause 14, and signs it. **The signature method recorded for this Agreement is: [SIGN_METHOD]** (a handwritten signature scanned and uploaded, Aadhaar eSign, or a digital signature under the Information Technology Act, 2000). KnotKitchen accepts this Agreement by countersigning it or by creating the Store, whichever is first. Portal staff do not sign for KnotKitchen.

11.2 Submission is not approval. KnotKitchen may verify the Restaurant's information, documents and authority, and may decline to create a Store, in which case nothing is payable and this Agreement has no further effect.

11.3 KnotKitchen keeps an acceptance record (version, document hashes, timestamps, signatory, signature method, operating staff account, IP and device information). The acceptance record, system logs and Commercial Schedule may be produced as evidence, including with a certificate under section 63 of the Bharatiya Sakshya Adhiniyam, 2023. Any stamp duty is borne by KnotKitchen.

11.4 The signatory confirms that the Restaurant has capacity to enter this Agreement for its business, that the signatory is authorised to sign for it, and that all information provided is accurate.

---

## 12. DISPUTES

This Agreement is governed by the laws of India. The Parties will first try to resolve a dispute by negotiation within 30 days of written notice. Unresolved disputes go to arbitration by a sole arbitrator under the Arbitration and Conciliation Act, 1996, seated in **Kolkata, West Bengal**, in English. Either Party may seek interim relief from a court, and nothing excludes a statutory forum whose jurisdiction cannot be excluded. Subject to this, the courts at Kolkata have jurisdiction.

---

## 13. AMENDMENTS, NOTICES AND GENERAL

13.1 **Amendments.** Prices change only under clause 3.3. Any other change that reduces the Restaurant's rights applies only after 30 days' notice and the Restaurant's express acceptance; otherwise KnotKitchen may terminate for convenience. No change applies to periods already paid for.

13.2 **Notices.** Notices to KnotKitchen go to **[KK_NOTICE_EMAIL]** or by post to [KK_PARTY_ADDRESS]; the support phone **[KK_NOTICE_PHONE]** does not replace written notice. Notices to the Restaurant go to **[EMAIL]**, in the Application, or by post to [ADDRESS]; reminders may be sent by SMS or WhatsApp to **[PHONE]**. KnotKitchen may confirm a cancellation, deletion or change of details by calling the notice phone.

13.3 **General.** The Parties are independent contractors. The Restaurant may not assign this Agreement without KnotKitchen's consent; KnotKitchen may assign it to an affiliate or successor without reducing the Restaurant's rights. Invalid provisions are severed. No waiver is implied from delay. This Agreement, the Commercial Schedule and KnotKitchen's Privacy Policy are the entire agreement; the Commercial Schedule prevails for the values it records. Clauses on amounts due, rented Tablets, data, intellectual property, refunds, confidentiality, liability and disputes survive termination.

---

## 14. AGREEMENT ACCEPTANCE

By signing this Agreement, the Restaurant's authorised signatory confirms that:

- The information and documents provided are accurate and complete.
- I am authorised to sign this Agreement for the Restaurant.
- I have read and accept this Agreement, including the Wallet, refund, hardware, lock and termination terms.
- I understand that prices for purchases and minimum top-ups are shown and accepted in the KnotKitchen Application, that the Platform Fee and other usage charges are notified by email and deducted from the Wallet, and that the Wallet is not refundable except as stated in this Agreement.
- I have signed this Agreement by the method recorded in it.

---

## EXECUTION

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

---

**Agreement ID:** [AGREEMENT_ID]\\
**Agreement Version:** [VERSION]\\
**Generated On:** [GENERATED_DATE]

**End of Agreement**`;

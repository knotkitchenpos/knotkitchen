/* The agreement's text: labels, the annexures and the full agreement body,
   built from the application state. Globals; loaded before the main script. */

function inr(n){
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function gbpLabel(v){
  const gmb = ((window.KK_PRICES || {}).addons || {}).gmb;
  return v==='knotkitchen' ? `KnotKitchen will manage it (this is the paid GMB Management Add-on, ${inr(gmb)} + GST per Billing Period, taken up in the KnotKitchen application)`
    : v==='restaurant' ? 'Restaurant will manage it'
    : v==='agency' ? 'Another person / agency will manage it' : '—';
}

const SIGN_METHOD_LABELS = {
  'handwritten-scanned': 'Handwritten signature on the printed Agreement, scanned and uploaded',
  'aadhaar-esign': 'Aadhaar eSign (for example through DigiLocker)',
  'dsc': 'Digital signature using a Digital Signature Certificate (DSC)',
};

function signMethodLabel(v){
  return SIGN_METHOD_LABELS[v] || SIGN_METHOD_LABELS['handwritten-scanned'];
}

/* ============ AGREEMENT TEMPLATE ============ */
/* The clause text lives in js/agreement_v3.js (v3.0). Bracket placeholders
   are replaced from onboarding data at generation time; clause wording is
   never altered by the app. Annexure A records the Restaurant's profile;
   Annexure B lists the standard charges from window.KK_PRICES. */
const AGREEMENT_TEMPLATE = window.AGREEMENT_TEMPLATE_V3;

function buildAnnexure(){
  const d = state.data;
  return `---

## ANNEXURE A — RESTAURANT PROFILE DETAILS

Recorded in the KnotKitchen system from the Restaurant's onboarding submission. Provided for reference alongside this Agreement; it does not alter the clauses above.

- **Restaurant Display Name:** ${d.r_display || '—'}
- **GSTIN:** ${d.b_gst==='yes' ? (d.b_gstin || '—') : 'Not Applicable (not GST registered)'}
- **PAN:** ${d.b_pan || '—'}
- **FSSAI License Number:** ${d.b_fssai || '—'} (Valid until ${d.b_fssai_valid || '—'})
- **Business Type:** ${d.b_type || '—'}
- **Google Business Profile Management:** ${gbpLabel(d.gbp)}
- **Sales Agent:** ${(d.sales_agent && d.sales_agent.trim()) ? d.sales_agent.trim() : '—'}
`;
}

function buildAnnexureB(){
  const p = window.KK_PRICES;
  const per = `per Billing Period of ${p.periodDays} days`;
  return `---

## ANNEXURE B — STANDARD CHARGES AT THE EFFECTIVE DATE

- POS Plan, ${per}: ${inr(p.posPlan)}
- Activation Top-up (minimum first single Wallet top-up; it stays in the Wallet and is not a charge): ${inr(p.firstTopUp)}
- QR Table Ordering Add-on (tables, table QR ordering and dine-in), ${per}: ${inr(p.addons.qr)}
- Website Add-on (ordering website, online payments and table booking), ${per}: ${inr(p.addons.website)}
- GMB Management Add-on, ${per}: ${inr(p.addons.gmb)}
- Tablet rental, first Tablet, ${per}: ${inr(p.tabletFirst)}
- Tablet rental, each additional Tablet, ${per}: ${inr(p.tabletExtra)}
- Tablet Top-up (minimum single Wallet top-up for each Tablet; it stays in the Wallet and is not a charge): ${inr(p.tabletTopUp)}
- 2-inch thermal Printer, one-time purchase, GST included: ${inr(p.printer2in)}
- 3-inch thermal Printer, one-time purchase, GST included: ${inr(p.printer3in)}
- Order Charge, per Paid-Online Order, from the start date shown in the application: ${inr(p.orderCharge)}
- E-bill Charge, per e-bill sent, from the start date shown in the application: ${inr(p.ebill)}

Printer prices include GST, and no GST is added to them. All other amounts exclude GST. GST is added only once KnotKitchen is registered under GST, from the GST start date shown in the application (clause 4.4). The price shown in the application when the Restaurant accepts a purchase, as recorded in the Commercial Schedule, governs, and prices may change only under clause 2.8.
`;
}

function buildAgreementText(){
  const d = state.data;
  const kk = window.KK_PARTY || {};
  const map = {
    '[AGREEMENT_ID]': state.agreement.id,
    '[EFFECTIVE_DATE]': state.agreement.date,
    '[GENERATED_DATE]': state.agreement.date,
    '[VERSION]': window.AGREEMENT_VERSION,
    '[ENTITY_TYPE]': d.b_type || '—',
    '[RESTAURANT_GSTIN]': d.b_gst==='yes' ? (d.b_gstin || '—') : 'Not registered under GST',
    '[RESTAURANT_PAN]': d.b_pan || '—',
    '[FSSAI]': d.b_fssai || '—',
    '[FSSAI_VALIDITY]': d.b_fssai_valid || '—',
    '[DESIGNATION]': d.o_designation || 'Owner',
    '[KK_PARTY_NAME]': kk.legalDescription ? `${kk.legalDescription}, trading as ${kk.name || 'KnotKitchen'}` : (kk.name || 'KnotKitchen'),
    '[KK_PARTY_ADDRESS]': kk.address || '—',
    '[KK_NOTICE_EMAIL]': kk.supportEmail || '—',
    '[KK_NOTICE_PHONE]': kk.supportPhone || '—',
    '[SIGN_METHOD]': signMethodLabel(d.sign_method),
    '[RESTAURANT_NAME]': d.r_name || d.r_display || '—',
    '[LEGAL_NAME]': d.b_legalname || '—',
    '[OWNER]': d.o_name || '—',
    '[ADDRESS]': [d.r_address, d.r_city, d.r_state, d.r_pin].filter(Boolean).join(', ') || '—',
    '[PHONE]': d.o_phone || '—',
    '[EMAIL]': d.o_email || '—',
    '[SALES_AGENT]': (d.sales_agent && d.sales_agent.trim()) ? d.sales_agent.trim() : 'KnotKitchen Onboarding Team',
    // Annexures last, so the form values inside them are never re-scanned for placeholders.
    'ANNEXURE_A_PLACEHOLDER': buildAnnexure(),
    'ANNEXURE_B_PLACEHOLDER': buildAnnexureB(),
  };
  let text = AGREEMENT_TEMPLATE;
  for(const k in map){ text = text.split(k).join(map[k]); }
  return text.replace(/\n{3,}/g,'\n\n');
}

/* ---- markdown rendering helpers (display + PDF) ---- */

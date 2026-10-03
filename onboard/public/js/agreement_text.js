/* The agreement's text: labels, Annexure A and the full agreement body,
   built from the application state. Globals; loaded before the main script. */

// No amount here: the Agreement states no prices (the Add-on is priced in the app).
function gbpLabel(v){
  return v==='knotkitchen' ? 'KnotKitchen will manage it (this is the paid GMB Management Add-on, priced and taken up in the KnotKitchen application)'
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
   never altered by the app. Annexure A records the Restaurant's profile. */
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
    // Annexure last, so the form values inside it are never re-scanned for placeholders.
    'ANNEXURE_A_PLACEHOLDER': buildAnnexure(),
  };
  let text = AGREEMENT_TEMPLATE;
  for(const k in map){ text = text.split(k).join(map[k]); }
  return text.replace(/\n{3,}/g,'\n\n');
}

/* ---- markdown rendering helpers (display + PDF) ---- */

/* The agreement's text: labels, the annexure and the full agreement body,
   built from the application state. Globals; loaded before the main script. */

function printerLabel(v){
  return v==='none' ? 'No Printer' : v==='2inch' ? '2-Inch Thermal Printer' : v==='3inch' ? '3-Inch Thermal Printer' : '—';
}
function printerAmount(v){
  return v==='none' ? 2000 : v==='2inch' ? 2000 : v==='3inch' ? 3000 : 0;
}
function gbpLabel(v){
  return v==='knotkitchen' ? 'KnotKitchen will manage it' : v==='restaurant' ? 'Restaurant will manage it' : v==='agency' ? 'Another person / agency will manage it' : '—';
}

/* Minimum commitment helpers — added 2026-09-01 to back the new
   'Minimum Commitment, Discount & Early Termination' clause. Values must
   stay in sync with the AGREEMENT_TEMPLATE section that references them.
   commitmentMonths is the number of months the plan covers (0 = no
   commitment / monthly). commitmentDiscount is the % off subscription. */
function commitmentLabel(v){
  return v==='none' ? 'No Minimum Commitment'
    : v==='3' ? '3 Months'
    : v==='6' ? '6 Months (Half-Yearly)'
    : v==='12' ? '12 Months (Annual)'
    : '—';
}
function commitmentMonths(v){
  return v==='3' ? 3 : v==='6' ? 6 : v==='12' ? 12 : 0;
}
function commitmentDiscount(v){
  return v==='3' ? 5 : v==='6' ? 10 : v==='12' ? 20 : 0;
}

/* ============ AGREEMENT TEMPLATE ============ */
/* The clause text lives in js/agreement_v2.js (v2.0). Bracket placeholders
   are replaced from onboarding data at generation time; clause wording is
   never altered by the app. Annexure A records the Restaurant's profile. */
const AGREEMENT_TEMPLATE = window.AGREEMENT_TEMPLATE_V2;

function buildAnnexure(){
  const d = state.data;
  return `---

## ANNEXURE A — RESTAURANT PROFILE DETAILS

*Recorded in the KnotKitchen system from the Restaurant's onboarding submission. Provided for reference alongside this Agreement; it does not alter the clauses above.*

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
  const signingDate = state.submitted && state.submittedAt
    ? new Date(state.submittedAt).toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})
    : 'Pending eSign completion';
  const map = {
    '[AGREEMENT_ID]': state.agreement.id,
    '[EFFECTIVE_DATE]': state.agreement.date,
    '[GENERATED_DATE]': state.agreement.date,
    '[DATE]': state.agreement.date,
    '[VERSION]': window.AGREEMENT_VERSION || 'v2.0',
    '[ENTITY_TYPE]': d.b_type || '—',
    '[RESTAURANT_GSTIN]': d.b_gst==='yes' ? (d.b_gstin || '—') : 'Not registered under GST',
    '[RESTAURANT_PAN]': d.b_pan || '—',
    '[FSSAI]': d.b_fssai || '—',
    '[FSSAI_VALIDITY]': d.b_fssai_valid || '—',
    '[DESIGNATION]': d.o_designation || 'Owner',
    '[KK_PARTY_NAME]': (window.KK_PARTY||{}).name || 'KnotKitchen',
    '[KK_PARTY_DESCRIPTION]': (window.KK_PARTY||{}).description || '',
    '[KK_PARTY_ADDRESS]': (window.KK_PARTY||{}).address || '—',
    '[KK_PARTY_PAN]': (window.KK_PARTY||{}).pan || '—',
    '[KK_PARTY_GST]': (window.KK_PARTY||{}).gst || 'not registered under GST',
    '[KK_SUPPORT_EMAIL]': (window.KK_PARTY||{}).supportEmail || '—',
    '[KK_WHATSAPP_PROVIDER]': (window.KK_PARTY||{}).whatsappProvider || '—',
    '[RESTAURANT_NAME]': d.r_name || d.r_display || '—',
    '[LEGAL_NAME]': d.b_legalname || '—',
    '[OWNER]': d.o_name || '—',
    '[ADDRESS]': [d.r_address, d.r_city, d.r_state, d.r_pin].filter(Boolean).join(', ') || '—',
    '[PHONE]': d.o_phone || '—',
    '[EMAIL]': d.o_email || '—',
    '[SIGNING_DATE]': signingDate,
    '[SALES_AGENT]': (d.sales_agent && d.sales_agent.trim()) ? d.sales_agent.trim() : 'KnotKitchen Onboarding Team',
    'SALES_REPRESENTATIVE': (d.sales_agent && d.sales_agent.trim()) ? d.sales_agent.trim() : 'KnotKitchen Onboarding Team',
    '**Authorized Signatory:** OWNER': `**Authorized Signatory:** ${d.o_name || '—'}`,
    'ANNEXURE_A_PLACEHOLDER': buildAnnexure(),
  };
  let text = AGREEMENT_TEMPLATE;
  for(const k in map){ text = text.split(k).join(map[k]); }
  return text.replace(/\n{3,}/g,'\n\n');
}

/* ---- markdown rendering helpers (display + PDF) ---- */

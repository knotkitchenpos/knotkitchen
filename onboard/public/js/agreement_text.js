/* The agreement's text: labels, the annexure and the full agreement body,
   built from the application state. Globals; loaded before the main script. */

function gbpLabel(v){
  return v==='knotkitchen' ? 'KnotKitchen will manage it' : v==='restaurant' ? 'Restaurant will manage it' : v==='agency' ? 'Another person / agency will manage it' : '—';
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
    '[KK_PARTY_ADDRESS]': (window.KK_PARTY||{}).address || '—',
    '[RESTAURANT_NAME]': d.r_name || d.r_display || '—',
    '[LEGAL_NAME]': d.b_legalname || '—',
    '[OWNER]': d.o_name || '—',
    '[ADDRESS]': [d.r_address, d.r_city, d.r_state, d.r_pin].filter(Boolean).join(', ') || '—',
    '[PHONE]': d.o_phone || '—',
    '[EMAIL]': d.o_email || '—',
    '[SALES_AGENT]': (d.sales_agent && d.sales_agent.trim()) ? d.sales_agent.trim() : 'KnotKitchen Onboarding Team',
    '**Authorized Signatory:** OWNER': `**Authorized Signatory:** ${d.o_name || '—'}`,
    'ANNEXURE_A_PLACEHOLDER': buildAnnexure(),
  };
  let text = AGREEMENT_TEMPLATE;
  for(const k in map){ text = text.split(k).join(map[k]); }
  return text.replace(/\n{3,}/g,'\n\n');
}

/* ---- markdown rendering helpers (display + PDF) ---- */

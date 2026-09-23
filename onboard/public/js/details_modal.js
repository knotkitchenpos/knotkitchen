async function openRestaurantDetailsModal(agId){
  const db = await getAgreementsDb();
  const ag = db[agId];
  if(!ag){ showToast('Record not found'); return; }

  const d = ag.data || ag;
  const rDisplay = d.r_display || d.r_name || ag.r_name || '—';
  const fullAddress = [d.r_address, d.r_city, d.r_state, d.r_pin].filter(Boolean).join(', ') || '—';
  const rPhone = d.r_phone || d.o_phone || '—';
  const rMaps = d.r_maps || '—';
  const rType = d.r_type || '—';
  const oName = d.o_name || ag.o_name || '—';
  const oPhone = d.o_phone || '—';
  const oEmail = d.o_email || d.r_email || '—';
  const isGstReg = (d.b_gst === 'yes' || d.gst_reg === 'yes' || Boolean(d.b_gstin && d.b_gstin.trim()));
  const gstinVal = d.b_gstin ? d.b_gstin.trim() : '';
  const gstText = isGstReg ? ('Yes' + (gstinVal ? ' (GSTIN: ' + gstinVal + ')' : '')) : 'No';
  const fssaiNum = d.b_fssai || '—';
  const fssaiValid = d.b_fssai_valid || '—';

  const textToCopy = `RESTAURANT DETAILS (${ag.id})
Display Name: ${rDisplay}
Full Address: ${fullAddress}
Phone: ${rPhone}
Google Maps: ${rMaps}
Type: ${rType}

OWNER DETAILS
Owner Name: ${oName}
Owner Phone: ${oPhone}
Owner Email: ${oEmail}

COMPLIANCE
GST Registered?: ${gstText}
${isGstReg && gstinVal ? 'GSTIN: ' + gstinVal + '\n' : ''}FSSAI License: ${fssaiNum}
FSSAI Valid Until: ${fssaiValid}`;

  const html = getRestaurantDetailsModalHtml(ag, rDisplay, fullAddress, rPhone, rMaps, rType, oName, oPhone, oEmail, isGstReg, gstinVal, fssaiNum, fssaiValid, textToCopy);


function getRestaurantDetailsModalHtml(ag, rDisplay, fullAddress, rPhone, rMaps, rType, oName, oPhone, oEmail, isGstReg, gstinVal, fssaiNum, fssaiValid, textToCopy){
  return `<div class="modal-overlay show" style="z-index:250;" onclick="if(event.target===this)closeRestaurantDetailsModal()">
    <div class="modal" style="max-width:640px;width:95%;text-align:left;padding:24px;border-radius:18px;max-height:90vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #E5E7EB;padding-bottom:12px;margin-bottom:14px;">
        <div>
          <div style="font-size:11px;font-weight:700;color:#FF6B00;letter-spacing:0.06em;text-transform:uppercase;">RESTAURANT & OWNER DETAILS</div>
          <h2 style="margin:2px 0 0;font-size:20px;color:#111827;font-family:var(--font-display);font-weight:800;">${rDisplay}</h2>
          <div style="font-family:var(--font-mono);font-size:12px;color:#6B7280;margin-top:2px;">ID: <b>${ag.id}</b> · Agent: <b>${ag.sales_agent || '—'}</b></div>
        </div>
        <button class="btn btn-ghost" style="padding:4px 10px;border-radius:6px;font-size:12px;" onclick="closeRestaurantDetailsModal()">✕ Close</button>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
        <button type="button" class="btn btn-primary" style="padding:6px 14px;font-size:12.5px;background:#10B981;border:none;border-radius:6px;font-weight:700;cursor:pointer;" onclick="copyDetailsToClipboard('${encodeURIComponent(textToCopy)}')">📋 Copy All Details</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:12px;">
          <div style="font-size:12px;font-weight:700;color:#0F172A;margin-bottom:8px;border-bottom:1px solid #E2E8F0;padding-bottom:4px;">🏪 Restaurant Information</div>
          <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:10px;">
            <div><div style="font-size:10.5px;font-weight:700;color:#64748B;">DISPLAY NAME</div><div style="font-size:13px;font-weight:700;color:#0F172A;">${rDisplay}</div></div>
            <div><div style="font-size:10.5px;font-weight:700;color:#64748B;">TYPE</div><div style="font-size:13px;font-weight:600;color:#0F172A;">${rType}</div></div>
            <div style="grid-column:span 2;"><div style="font-size:10.5px;font-weight:700;color:#64748B;">FULL ADDRESS</div><div style="font-size:12.5px;font-weight:600;color:#0F172A;">${fullAddress}</div></div>
            <div><div style="font-size:10.5px;font-weight:700;color:#64748B;">PHONE</div><div style="font-size:13px;font-weight:600;color:#0F172A;">${rPhone}</div></div>
            <div><div style="font-size:10.5px;font-weight:700;color:#64748B;">GOOGLE MAPS LINK</div><div style="font-size:12px;word-break:break-all;">${rMaps !== '—' && rMaps.startsWith('http') ? `<a href="${rMaps}" target="_blank" style="color:#0EA5E9;font-weight:600;text-decoration:underline;">📍 View Map ↗</a>` : rMaps}</div></div>
          </div>
        </div>
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:12px;">
          <div style="font-size:12px;font-weight:700;color:#0F172A;margin-bottom:8px;border-bottom:1px solid #E2E8F0;padding-bottom:4px;">👤 Owner Information</div>
          <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;">
            <div><div style="font-size:10.5px;font-weight:700;color:#64748B;">OWNER NAME</div><div style="font-size:13px;font-weight:700;color:#0F172A;">${oName}</div></div>
            <div><div style="font-size:10.5px;font-weight:700;color:#64748B;">OWNER PHONE</div><div style="font-size:13px;font-weight:600;color:#0F172A;">${oPhone}</div></div>
            <div><div style="font-size:10.5px;font-weight:700;color:#64748B;">OWNER EMAIL</div><div style="font-size:12.5px;font-weight:600;color:#0F172A;word-break:break-all;">${oEmail}</div></div>
          </div>
        </div>
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:12px;">
          <div style="font-size:12.5px;font-weight:700;color:#0F172A;margin-bottom:8px;border-bottom:1px solid #E2E8F0;padding-bottom:4px;">🛡️ Compliance & Licenses</div>
          <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;">
            <div><div style="font-size:10.5px;font-weight:700;color:#64748B;">GST REGISTERED?</div><div style="font-size:13px;font-weight:700;color:${isGstReg ? '#15803D' : '#64748B'};">${isGstReg ? 'Yes' : 'No'}</div>${isGstReg && gstinVal ? `<div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#334155;background:#E2E8F0;padding:2px 4px;border-radius:4px;display:inline-block;">${gstinVal}</div>` : ''}</div>
            <div><div style="font-size:10.5px;font-weight:700;color:#64748B;">FSSAI NUMBER</div><div style="font-family:'IBM Plex Mono',monospace;font-size:12.5px;font-weight:700;color:#0F172A;">${fssaiNum}</div></div>
            <div><div style="font-size:10.5px;font-weight:700;color:#64748B;">FSSAI VALID UNTIL</div><div style="font-size:12.5px;font-weight:600;color:#0F172A;">${fssaiValid}</div></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

  let container = document.getElementById('restaurantDetailsModalContainer');
  if(!container){ container = document.createElement('div'); container.id = 'restaurantDetailsModalContainer'; document.body.appendChild(container); }
  container.innerHTML = html;
}


function closeRestaurantDetailsModal(){ const c = document.getElementById('restaurantDetailsModalContainer'); if(c) c.innerHTML = ''; }

function copyDetailsToClipboard(encodedText){
  navigator.clipboard.writeText(decodeURIComponent(encodedText))
    .then(() => showToast('All details copied to clipboard!'))
    .catch(() => showToast('Could not copy to clipboard'));
}

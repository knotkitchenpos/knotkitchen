/* The agreement PDF: layout engine over jsPDF, the print fallback and the
   download action. Globals; loaded before the main script. */

function tokenizeInline(line){
  // Splits a line into {text, bold} word/space tokens, preserving exact spacing.
  const parts = line.split(/(\*\*.*?\*\*)/g);
  const tokens = [];
  parts.forEach(part=>{
    if(!part) return;
    let bold=false, content=part;
    if(part.startsWith('**') && part.endsWith('**') && part.length>=4){ bold=true; content=part.slice(2,-2); }
    else content = content.replace(/\*([^*\s][^*]*?)\*/g,'$1'); // *italic*: no italic face, so plain
    content.split(/(\s+)/).forEach(w=>{ if(w!=='') tokens.push({text:w, bold}); });
  });
  return tokens;
}

function makePdfLayout(doc, opts){
  const { margin, pageWidth, pageHeight, font } = opts;
  const maxWidth = pageWidth - margin*2;
  let y = opts.startY;

  function ensureSpace(needed){
    if(y + needed > pageHeight - margin){ doc.addPage(); y = margin; }
  }

  function paragraph(line, {size=10, lineHeight=14.5, indent=0, bulletIndent=0, isBullet=false}={}){
    doc.setFontSize(size);
    const tokens = tokenizeInline(line);
    let cx = margin + indent;
    const lineStart = margin + indent + bulletIndent;
    ensureSpace(lineHeight);
    if(isBullet){
      doc.setFont(font,'normal');
      doc.text('•', margin+2, y);
    }
    tokens.forEach(tok=>{
      if(/^\s+$/.test(tok.text)){
        doc.setFont(font,'normal');
        cx += doc.getTextWidth(tok.text);
        return;
      }
      doc.setFont(font, tok.bold ? 'bold' : 'normal');
      let text = tok.text;
      let w = doc.getTextWidth(text);
      if(cx + w > margin + maxWidth && cx > lineStart){
        y += lineHeight;
        ensureSpace(lineHeight);
        cx = lineStart;
      }
      // A token wider than a whole line (a long "____" signature line, a URL)
      // is cut to fit instead of running off the page.
      while(cx + w > margin + maxWidth && text.length > 1){
        let n = text.length - 1;
        while(n > 1 && cx + doc.getTextWidth(text.slice(0, n)) > margin + maxWidth) n--;
        doc.text(text.slice(0, n), cx, y);
        text = text.slice(n);
        w = doc.getTextWidth(text);
        y += lineHeight;
        ensureSpace(lineHeight);
        cx = lineStart;
      }
      doc.text(text, cx, y);
      cx += w;
    });
    y += lineHeight;
  }

  function heading(text, {size=13, gapBefore=14, gapAfter=8}={}){
    y += gapBefore;
    ensureSpace(size+gapAfter);
    doc.setFont(font,'bold');
    doc.setFontSize(size);
    doc.text(text, margin, y);
    y += gapAfter;
  }

  function rule(){
    y += 8;
    ensureSpace(10);
    doc.setDrawColor(221,227,220);
    doc.line(margin, y, margin+maxWidth, y);
    y += 12;
  }

  function bullet(line){
    paragraph(line, {indent:16, bulletIndent:16, isBullet:true, size:10, lineHeight:14.5});
  }

  function blank(h=7){ y += h; }

  function getY(){ return y; }

  return { paragraph, heading, rule, bullet, blank, ensureSpace, getY };
}

function renderAgreementToPdf(doc, text, layout){
  // A trailing backslash is a markdown hard line break.
  const rawLines = text.replace(/\\[ \t]*\r?\n/g,'\n').replace(/\\[ \t]*$/,'').split(/\r?\n/);
  rawLines.forEach(line=>{
    const trimmed = line.trim();
    if(trimmed===''){ layout.blank(); return; }
    if(trimmed==='---'){ layout.rule(); return; }
    if(/^### /.test(trimmed)){ layout.heading(trimmed.replace(/^### /,''), {size:11.5, gapBefore:10, gapAfter:6}); return; }
    if(/^## /.test(trimmed)){ layout.heading(trimmed.replace(/^## /,''), {size:13.5, gapBefore:16, gapAfter:8}); return; }
    if(/^# /.test(trimmed)){ layout.heading(trimmed.replace(/^# /,''), {size:17, gapBefore:6, gapAfter:10}); return; }
    if(/^- /.test(trimmed)){ layout.bullet(trimmed.replace(/^- /,'')); return; }
    if(/^\|/.test(trimmed)){
      // Table rows print as one line each, cells separated; the |---| row is dropped.
      if(/^\|[\s:|-]+\|?$/.test(trimmed)) return;
      layout.paragraph(trimmed.replace(/^\||\|$/g,'').split('|').map(c=>c.trim()).join('  ·  '));
      return;
    }
    layout.paragraph(trimmed);
  });
}

function agreementVersionOf(text){
  const m = /\*\*Agreement Version:\*\*\s*(v[\d.]+)/.exec(text || '');
  return m ? m[1] : (window.AGREEMENT_VERSION || '');
}

// Drawn after layout, when the page count is known.
function drawPdfFooters(doc, { agreementId, version, pageWidth, pageHeight, font }){
  const total = doc.getNumberOfPages();
  for(let i=1; i<=total; i++){
    doc.setPage(i);
    doc.setFont(font,'normal');
    doc.setFontSize(8);
    doc.setTextColor(110,110,110);
    const label = ['KnotKitchen Restaurant Service Agreement', agreementId, version, `Page ${i} of ${total}`].filter(Boolean).join(' · ');
    doc.text(label, pageWidth/2, pageHeight - 24, { align:'center' });
    doc.setTextColor(0,0,0);
  }
}

function buildAgreementPdf(text, agreementId){
  if(!window.jspdf || !window.jspdf.jsPDF){ throw new Error('jsPDF library not available'); }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'pt', format:'a4'});

  doc.addFileToVFS('Roboto-Regular.ttf', FONT_ROBOTO_REGULAR);
  doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  doc.addFileToVFS('Roboto-Bold.ttf', FONT_ROBOTO_BOLD);
  doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');

  const margin = 50;
  const pageWidth = 595, pageHeight = 842;
  const font = 'Roboto';

  function drawLetterhead(){
    const logoW = 130, logoH = logoW * (289/479);
    try{ doc.addImage(LOGO_FULL, 'PNG', (pageWidth-logoW)/2, margin-14, logoW, logoH); }catch(imgErr){ /* continue without logo if image embed fails */ }
    const lineY = margin - 14 + logoH + 14;
    doc.setDrawColor(221,227,220);
    doc.line(margin, lineY, pageWidth-margin, lineY);
    return lineY + 22;
  }

  const startY = drawLetterhead();
  const layout = makePdfLayout(doc, { margin, pageWidth, pageHeight, font, startY });
  renderAgreementToPdf(doc, text, layout);
  drawPdfFooters(doc, { agreementId, version: agreementVersionOf(text), pageWidth, pageHeight, font });
  return doc;
}

function printAgreementFallback(){
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>KnotKitchen Agreement ${state.agreement.id}</title>
  <style>
    body{font-family:'IBM Plex Mono',monospace;font-size:12.5px;line-height:1.7;color:#14201C;max-width:720px;margin:40px auto;padding:0 20px;}
    img{height:44px;display:block;margin:0 auto 18px;}
    hr{border:none;border-top:1px solid #ddd;margin:16px 0;}
    h3,h4,h5{font-family:Georgia,serif;}
    ul{padding-left:20px;}
  </style></head><body>
  <img src="${LOGO_FULL}">
  ${mdToHtml(state.agreement.text)}
  <script>window.onload=()=>window.print();<\/script>
  </body></html>`);
  w.document.close();
}

async function downloadAgreementPdf(){
  // Always the current text (the details may have changed since step 7); a
  // signed copy of an older text is dropped on the way.
  if(!(await ensureAgreementText())) render();
  const a = state.agreement;
  // What was downloaded, so an upload signed on an older download is refused.
  try{ a.downloadedTextHash = await sha256Hex(a.text); scheduleSave(); }catch(e){}
  try{
    buildAgreementPdf(a.text, a.id).save(`KnotKitchen-Agreement-${a.id}.pdf`);
    showToast('Agreement PDF downloaded');
  }catch(err){
    console.error('PDF generation failed:', err);
    showToast('Could not generate the PDF — opening print view instead');
    printAgreementFallback();
  }
}

/* Markdown-ish rendering for the agreement text (HTML for the screen, plain
   text for the PDF). Globals; loaded before the main script. */

function escapeHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function mdToHtml(md){
  let t = escapeHtml(md);
  t = t.replace(/\\\n/g,'<br>\n');
  t = t.replace(/^### (.*)$/gm,'<h5>$1</h5>');
  t = t.replace(/^## (.*)$/gm,'<h4>$1</h4>');
  t = t.replace(/^# (.*)$/gm,'<h3>$1</h3>');
  t = t.replace(/^---$/gm,'<hr>');
  t = t.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
  t = t.replace(/\*(.*?)\*/g,'<em>$1</em>');
  t = t.replace(/(^\|.*(?:\n\|.*)*)/gm, m=>{
    const rows = m.split('\n').filter(r=>!/^\|\s*:?-{3,}/.test(r));
    const cells = r=>r.replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
    const head = rows.length ? '<tr>'+cells(rows[0]).map(c=>'<th>'+c+'</th>').join('')+'</tr>' : '';
    const body = rows.slice(1).map(r=>'<tr>'+cells(r).map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('');
    return '<table class="agr-table">'+head+body+'</table>';
  });
  t = t.replace(/(^- .*(?:\n- .*)*)/gm, m=>{
    const items = m.split('\n').map(l=>'<li>'+l.replace(/^- /,'')+'</li>').join('');
    return '<ul>'+items+'</ul>';
  });
  t = t.split(/\n{2,}/).map(block=>{
    const trimmed = block.trim();
    if(/^<h\d|^<ul|^<hr|^<table/.test(trimmed)) return block;
    if(trimmed==='') return '';
    return '<p>'+block+'</p>';
  }).join('\n');
  return t;
}

function mdToPlain(md){
  return md
    .replace(/\\\n/g,'\n')
    .replace(/\*\*(.*?)\*\*/g,'$1')
    .replace(/\*(.*?)\*/g,'$1')
    .replace(/^### (.*)$/gm,'$1')
    .replace(/^## (.*)$/gm,'$1')
    .replace(/^# (.*)$/gm,'$1')
    .replace(/^---$/gm,'')
    .replace(/^- /gm,'• ')
    .replace(/^\|\s*:?-{3,}.*$/gm,'')
    .replace(/^\|(.*)\|$/gm,(m,row)=>row.split('|').map(c=>c.trim()).join('  —  '))
    .replace(/\n{3,}/g,'\n\n');
}

/* ============ VALIDATION ============ */

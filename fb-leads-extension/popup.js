const $ = (id) => document.getElementById(id);

let sessionNew = 0;
let scrollInterval = null;
let allLeads = [];

const statusBar    = $('status-bar');
const countBadge   = $('count-badge');
const sessionBadge = $('session-badge');
const leadsBody    = $('leads-body');
const emptyRow     = $('empty-row');
const debugBox     = $('debug-box');
const btnExtract   = $('btn-extract');
const btnScroll    = $('btn-scroll');
const btnExportCsv  = $('btn-export-csv');
const btnExportJson = $('btn-export-json');
const btnClear     = $('btn-clear');
const modeSelect   = $('mode-select');

// ── helpers ───────────────────────────────────────────────────────────────────

function setStatus(msg, color = '#fff') {
  statusBar.textContent = msg;
  statusBar.style.color = color;
}

function updateBadges() {
  countBadge.textContent   = `${allLeads.length} leads stored`;
  sessionBadge.textContent = `${sessionNew} new this session`;
}

function showDebug(dbg) {
  if (!dbg) { debugBox.style.display = 'none'; return; }
  debugBox.style.display = 'block';
  debugBox.innerHTML = `
    <strong>Debug info</strong> &mdash; articles: <b>${dbg.articles}</b>,
    list items: <b>${dbg.listItems}</b>, profile links found: <b>${dbg.profileLinks}</b>
    / ${dbg.allLinks} total links.<br>
    ${dbg.profileLinks === 0
      ? '<span class="warn">No profile links detected — page may still be loading. Try Auto-scroll then Extract again.</span>'
      : ''}
  `;
}

function renderTable() {
  leadsBody.innerHTML = '';
  if (allLeads.length === 0) {
    leadsBody.appendChild(emptyRow);
    return;
  }
  allLeads.forEach((lead, i) => {
    const srcClass = lead.source === 'members' ? 'src-members'
                   : lead.source === 'posts'   ? 'src-posts'
                   : 'src-scan';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td title="${esc(lead.name)}">${esc(lead.name)}</td>
      <td><a href="${esc(lead.profileUrl)}" target="_blank">${shortUrl(lead.profileUrl)}</a></td>
      <td class="contact-cell">${fmtList(lead.emails, 'mailto:')}</td>
      <td class="contact-cell">${fmtList(lead.phones)}</td>
      <td class="contact-cell">${fmtList(lead.whatsapp)}</td>
      <td class="contact-cell">${fmtList(lead.websites, '')}</td>
      <td class="info-cell" title="${esc(lead.postText)}">${esc((lead.postText || '').slice(0, 80))}</td>
      <td><span class="src-tag ${srcClass}">${lead.source}</span></td>
    `;
    leadsBody.appendChild(tr);
  });
}

function fmtList(arr = [], prefix = '') {
  if (!arr || arr.length === 0) return '<span class="none">—</span>';
  return arr.map((v) =>
    prefix
      ? `<a href="${esc(prefix + v)}" target="_blank">${esc(v)}</a>`
      : esc(v)
  ).join('<br>');
}

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function shortUrl(url = '') {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\//g, '').slice(0, 20);
    return p || u.hostname;
  } catch { return url.slice(0, 20); }
}

// ── storage ───────────────────────────────────────────────────────────────────

function loadLeads() {
  chrome.runtime.sendMessage({ action: 'getLeads' }, (res) => {
    allLeads = (res && res.leads) || [];
    updateBadges();
    renderTable();
  });
}

// ── tab helpers ───────────────────────────────────────────────────────────────

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isFbGroup(tab) {
  return /facebook\.com\/groups\//i.test(tab.url || '');
}

// ── extract ───────────────────────────────────────────────────────────────────

btnExtract.addEventListener('click', async () => {
  const tab = await getCurrentTab();

  if (!isFbGroup(tab)) {
    setStatus('Navigate to a Facebook Group page first.', '#ffd700');
    return;
  }

  btnExtract.disabled = true;
  debugBox.style.display = 'none';
  setStatus('Extracting…');

  // Re-inject in case the tab was open before the extension was installed
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (_) { /* already injected */ }

  chrome.tabs.sendMessage(tab.id, { action: 'extract', mode: modeSelect.value }, (res) => {
    btnExtract.disabled = false;

    if (chrome.runtime.lastError || !res) {
      setStatus('Could not connect — refresh the Facebook page and try again.', '#ffd700');
      return;
    }

    showDebug(res.debug);

    if (!res.leads || res.leads.length === 0) {
      setStatus(
        'No leads found. Scroll down to load more posts, then extract again.',
        '#ffd700'
      );
      return;
    }

    chrome.runtime.sendMessage({ action: 'saveLeads', leads: res.leads }, (saveRes) => {
      const fresh = saveRes ? saveRes.saved : 0;
      sessionNew += fresh;
      loadLeads();
      setStatus(`Extracted ${res.leads.length} profiles — ${fresh} new saved.`, '#c6ffa0');
    });
  });
});

// ── auto-scroll ───────────────────────────────────────────────────────────────

btnScroll.addEventListener('click', async () => {
  if (scrollInterval) {
    clearInterval(scrollInterval);
    scrollInterval = null;
    btnScroll.textContent = '⇩ Auto-scroll';
    btnScroll.classList.remove('scrolling');
    setStatus('Auto-scroll stopped. Click Extract Leads.');
    return;
  }

  const tab = await getCurrentTab();
  if (!isFbGroup(tab)) {
    setStatus('Navigate to a Facebook Group first.', '#ffd700');
    return;
  }

  btnScroll.textContent = '◼ Stop scrolling';
  btnScroll.classList.add('scrolling');
  setStatus('Auto-scrolling to load content…');

  const doScroll = () =>
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.scrollBy({ top: 800, behavior: 'smooth' }),
    });

  doScroll();
  scrollInterval = setInterval(doScroll, 1800);

  setTimeout(() => {
    if (!scrollInterval) return;
    clearInterval(scrollInterval);
    scrollInterval = null;
    btnScroll.textContent = '⇩ Auto-scroll';
    btnScroll.classList.remove('scrolling');
    setStatus('Done scrolling. Click Extract Leads now.');
  }, 120_000);
});

// ── export CSV ────────────────────────────────────────────────────────────────

btnExportCsv.addEventListener('click', () => {
  if (allLeads.length === 0) { setStatus('Nothing to export.', '#ffd700'); return; }

  const headers = [
    '#', 'Name', 'Profile URL', 'Emails', 'Phones', 'WhatsApp',
    'Websites', 'Post Snippet', 'Post URL', 'Source', 'Extracted At',
  ];
  const rows = allLeads.map((l, i) => [
    i + 1,
    csvCell(l.name),
    csvCell(l.profileUrl),
    csvCell((l.emails || []).join(' | ')),
    csvCell((l.phones || []).join(' | ')),
    csvCell((l.whatsapp || []).join(' | ')),
    csvCell((l.websites || []).join(' | ')),
    csvCell(l.postText || ''),
    csvCell(l.postUrl || ''),
    csvCell(l.source),
    csvCell(l.extractedAt),
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  downloadText(csv, `fb-leads-${dateTag()}.csv`, 'text/csv');
  setStatus(`Exported ${allLeads.length} leads as CSV.`, '#c6ffa0');
});

// ── export JSON ───────────────────────────────────────────────────────────────

btnExportJson.addEventListener('click', () => {
  if (allLeads.length === 0) { setStatus('Nothing to export.', '#ffd700'); return; }
  downloadText(JSON.stringify(allLeads, null, 2), `fb-leads-${dateTag()}.json`, 'application/json');
  setStatus(`Exported ${allLeads.length} leads as JSON.`, '#c6ffa0');
});

// ── clear ─────────────────────────────────────────────────────────────────────

btnClear.addEventListener('click', () => {
  if (!confirm('Clear all stored leads?')) return;
  chrome.runtime.sendMessage({ action: 'clearLeads' }, () => {
    allLeads = [];
    sessionNew = 0;
    updateBadges();
    renderTable();
    debugBox.style.display = 'none';
    setStatus('All leads cleared.');
  });
});

// ── utils ─────────────────────────────────────────────────────────────────────

function csvCell(val = '') {
  return `"${String(val).replace(/"/g, '""')}"`;
}

function dateTag() {
  return new Date().toISOString().slice(0, 10);
}

function downloadText(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── init ──────────────────────────────────────────────────────────────────────

(async () => {
  loadLeads();
  const tab = await getCurrentTab();
  if (tab && isFbGroup(tab)) {
    const path = new URL(tab.url).pathname;
    modeSelect.value = path.includes('/members') ? 'members' : 'auto';
    setStatus(
      path.includes('/members')
        ? 'Members page — ready to extract.'
        : 'Group feed — ready to extract.'
    );
  }
})();

const $ = (id) => document.getElementById(id);

let sessionNew = 0;
let scrollInterval = null;
let allLeads = [];

const statusBar   = $('status-bar');
const countBadge  = $('count-badge');
const sessionBadge = $('session-badge');
const leadsBody   = $('leads-body');
const emptyRow    = $('empty-row');
const btnExtract  = $('btn-extract');
const btnScroll   = $('btn-scroll');
const btnExportCsv  = $('btn-export-csv');
const btnExportJson = $('btn-export-json');
const btnClear    = $('btn-clear');
const modeSelect  = $('mode-select');

// ── helpers ──────────────────────────────────────────────────────────────────

function setStatus(msg, color = '#fff') {
  statusBar.textContent = msg;
  statusBar.style.color = color;
}

function updateBadges() {
  countBadge.textContent  = `${allLeads.length} leads stored`;
  sessionBadge.textContent = `${sessionNew} new this session`;
}

function renderTable() {
  leadsBody.innerHTML = '';
  if (allLeads.length === 0) {
    leadsBody.appendChild(emptyRow);
    return;
  }
  allLeads.forEach((lead, i) => {
    const tr = document.createElement('tr');
    const srcClass = lead.source === 'members' ? 'src-members' : 'src-posts';

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td title="${esc(lead.name)}">${esc(lead.name)}</td>
      <td><a href="${esc(lead.profileUrl)}" target="_blank" title="${esc(lead.profileUrl)}">
        ${shortUrl(lead.profileUrl)}
      </a></td>
      <td class="info-cell" title="${esc(lead.subtitle)}">${esc(lead.subtitle.slice(0, 80))}</td>
      <td><span class="src-tag ${srcClass}">${lead.source}</span></td>
    `;
    leadsBody.appendChild(tr);
  });
}

function esc(str = '') {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function shortUrl(url = '') {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\//g, '').slice(0, 20) || u.hostname;
  } catch {
    return url.slice(0, 20);
  }
}

// ── load stored leads ─────────────────────────────────────────────────────────

function loadLeads() {
  chrome.runtime.sendMessage({ action: 'getLeads' }, (res) => {
    allLeads = (res && res.leads) || [];
    updateBadges();
    renderTable();
  });
}

// ── check if current tab is a FB group ───────────────────────────────────────

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function isFbGroup(tab) {
  return /facebook\.com\/groups\//i.test(tab.url || '');
}

// ── extract ───────────────────────────────────────────────────────────────────

btnExtract.addEventListener('click', async () => {
  const tab = await getCurrentTab();

  if (!await isFbGroup(tab)) {
    setStatus('Please navigate to a Facebook Group page first.', '#ffd700');
    return;
  }

  btnExtract.disabled = true;
  setStatus('Extracting…');

  // Ensure content script is present (handles cases where tab was opened before extension)
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (_) { /* already injected */ }

  chrome.tabs.sendMessage(tab.id, { action: 'extract', mode: modeSelect.value }, (res) => {
    btnExtract.disabled = false;

    if (chrome.runtime.lastError || !res) {
      setStatus('Could not connect to the page. Try refreshing it.', '#ffd700');
      return;
    }

    if (!res.leads || res.leads.length === 0) {
      setStatus('No leads found — try scrolling down to load more content, then extract again.', '#ffd700');
      return;
    }

    chrome.runtime.sendMessage({ action: 'saveLeads', leads: res.leads }, (saveRes) => {
      const fresh = saveRes ? saveRes.saved : 0;
      sessionNew += fresh;
      allLeads = [];
      loadLeads();
      setStatus(`Extracted ${res.leads.length} profiles — ${fresh} new added.`, '#c6ffa0');
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
    setStatus('Auto-scroll stopped.');
    return;
  }

  const tab = await getCurrentTab();
  if (!await isFbGroup(tab)) {
    setStatus('Navigate to a Facebook Group first.', '#ffd700');
    return;
  }

  btnScroll.textContent = '◼ Stop scrolling';
  btnScroll.classList.add('scrolling');
  setStatus('Auto-scrolling to load more content…');

  const doScroll = () => {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.scrollBy({ top: 800, behavior: 'smooth' }),
    });
  };

  doScroll();
  scrollInterval = setInterval(doScroll, 1800);

  // Stop automatically after 2 minutes
  setTimeout(() => {
    if (scrollInterval) {
      clearInterval(scrollInterval);
      scrollInterval = null;
      btnScroll.textContent = '⇩ Auto-scroll';
      btnScroll.classList.remove('scrolling');
      setStatus('Auto-scroll finished. Now click Extract Leads.');
    }
  }, 120_000);
});

// ── export CSV ────────────────────────────────────────────────────────────────

btnExportCsv.addEventListener('click', () => {
  if (allLeads.length === 0) { setStatus('Nothing to export yet.', '#ffd700'); return; }

  const headers = ['#', 'Name', 'Profile URL', 'Info / Post Snippet', 'Post URL', 'Source', 'Extracted At'];
  const rows = allLeads.map((l, i) => [
    i + 1,
    csvCell(l.name),
    csvCell(l.profileUrl),
    csvCell(l.subtitle),
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
  if (allLeads.length === 0) { setStatus('Nothing to export yet.', '#ffd700'); return; }
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
    setStatus('All leads cleared.');
  });
});

// ── utils ─────────────────────────────────────────────────────────────────────

function csvCell(val = '') {
  const s = String(val).replace(/"/g, '""');
  return `"${s}"`;
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
  if (tab && await isFbGroup(tab)) {
    const path = new URL(tab.url).pathname;
    if (path.includes('/members')) {
      modeSelect.value = 'members';
      setStatus('Members page detected — ready to extract.');
    } else {
      setStatus('Group feed detected — ready to extract.');
    }
  }
})();

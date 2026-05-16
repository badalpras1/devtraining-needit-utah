// ── storage helpers ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ leads: [], enrichProgress: null });
});

function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setStorage(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

// ── lead CRUD ──────────────────────────────────────────────────────────────

async function handleSaveLeads(leads) {
  const { leads: existing } = await getStorage({ leads: [] });
  const existingUrls = new Set(existing.map((l) => l.profileUrl));
  const fresh = leads.filter((l) => !existingUrls.has(l.profileUrl));
  const merged = [...existing, ...fresh];
  await setStorage({ leads: merged });
  return { saved: fresh.length, total: merged.length };
}

async function handleUpdateLead(profileUrl, patch) {
  const { leads } = await getStorage({ leads: [] });
  const updated = leads.map((l) =>
    l.profileUrl === profileUrl ? { ...l, ...patch } : l
  );
  await setStorage({ leads: updated });
}

async function upsertLead(lead) {
  const { leads } = await getStorage({ leads: [] });
  const exists = leads.find((l) => l.profileUrl === lead.profileUrl);
  let updated;
  if (exists) {
    updated = leads.map((l) => (l.profileUrl === lead.profileUrl ? { ...l, ...lead } : l));
  } else {
    updated = [...leads, lead];
  }
  await setStorage({ leads: updated });
}

// ── tab helpers ────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForLoad(tabId, timeout = 15000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeout);

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab && tab.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

async function openAndScrape(url, scriptFile, messageAction) {
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url, active: false, pinned: false });
    tabId = tab.id;
    await waitForLoad(tabId);
    await sleep(2500);
    await chrome.scripting.executeScript({ target: { tabId }, files: [scriptFile] });
    await sleep(400);
    const result = await chrome.tabs.sendMessage(tabId, { action: messageAction });
    return result || {};
  } catch (e) {
    return { error: e.message };
  } finally {
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
  }
}

// ── about-page enrichment ──────────────────────────────────────────────────

function buildAboutUrl(profileUrl, section) {
  try {
    const url = new URL(profileUrl);
    if (url.pathname.toLowerCase() === '/profile.php') {
      url.searchParams.set('sk', section);
      return url.toString();
    }
    return `${url.origin}${url.pathname.replace(/\/$/, '')}/${section}`;
  } catch {
    return `${profileUrl}/${section}`;
  }
}

async function scrapeAboutPage(url, page) {
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url, active: false, pinned: false });
    tabId = tab.id;
    await waitForLoad(tabId);
    await sleep(2500);
    await chrome.scripting.executeScript({ target: { tabId }, files: ['profile_scraper.js'] });
    await sleep(400);
    const result = await chrome.tabs.sendMessage(tabId, { action: 'scrapeProfile', page });
    return result || {};
  } catch (e) {
    return { error: e.message };
  } finally {
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
  }
}

async function enrichOne(lead) {
  const profileUrl = lead.profileUrl;

  const contact = await scrapeAboutPage(
    buildAboutUrl(profileUrl, 'about_contact_and_basic_info'), 'contact'
  );
  if (contact.error === 'login_required') return { blocked: true };
  if (enrichStop) return null;

  await sleep(1200 + Math.random() * 800);

  const work = await scrapeAboutPage(
    buildAboutUrl(profileUrl, 'about_work_and_education'), 'work'
  );
  if (enrichStop) return null;

  await sleep(1000 + Math.random() * 800);

  const places = await scrapeAboutPage(
    buildAboutUrl(profileUrl, 'about_places'), 'places'
  );

  return {
    emails:    [...new Set([...(lead.emails   || []), ...(contact.emails   || [])])],
    phones:    [...new Set([...(lead.phones   || []), ...(contact.phones   || [])])],
    websites:  [...new Set([...(lead.websites || []), ...(contact.websites || [])])],
    whatsapp:  [...new Set([...(lead.whatsapp || []), ...(contact.whatsapp || [])])],
    work:      work.work      || [],
    education: work.education || [],
    location:  places.location  || '',
    hometown:  places.hometown  || '',
    enriched:  true,
    enrichedAt: new Date().toISOString(),
  };
}

// ── shared processing state ────────────────────────────────────────────────

let enrichActive = false;
let enrichStop   = false;

function broadcastProgress(data) {
  chrome.storage.local.set({ enrichProgress: data });
  chrome.runtime.sendMessage({ action: 'enrichProgress', ...data }).catch(() => {});
}

// ── group leads enrichment ─────────────────────────────────────────────────

async function runEnrichment(profileUrls) {
  if (enrichActive) return;
  enrichActive = true;
  enrichStop   = false;

  const { leads } = await getStorage({ leads: [] });
  const targets = leads.filter((l) => profileUrls.includes(l.profileUrl));

  for (let i = 0; i < targets.length; i++) {
    if (enrichStop) break;

    const lead = targets[i];
    broadcastProgress({ current: i, total: targets.length, name: lead.name, status: 'scraping', mode: 'enrich' });

    try {
      const patch = await enrichOne(lead);
      if (patch && !patch.blocked) {
        await handleUpdateLead(lead.profileUrl, patch);
        broadcastProgress({ current: i + 1, total: targets.length, name: lead.name, status: 'done', mode: 'enrich' });
      } else if (patch?.blocked) {
        broadcastProgress({ current: i + 1, total: targets.length, name: '', status: 'blocked', mode: 'enrich' });
        break;
      } else {
        broadcastProgress({ current: i + 1, total: targets.length, name: '', status: 'stopped', mode: 'enrich' });
        break;
      }
    } catch {
      broadcastProgress({ current: i + 1, total: targets.length, name: lead.name, status: 'error', mode: 'enrich' });
    }

    if (i < targets.length - 1 && !enrichStop) await sleep(2000 + Math.random() * 2000);
  }

  enrichActive = false;
  broadcastProgress({
    current: targets.length, total: targets.length, name: '',
    status: enrichStop ? 'stopped' : 'complete', mode: 'enrich',
  });
}

// ── marketplace file processing ────────────────────────────────────────────

async function runMarketplaceProcessing(entries) {
  // entries: [{ url, type: 'listing' | 'profile' }]
  if (enrichActive) return;
  enrichActive = true;
  enrichStop   = false;

  for (let i = 0; i < entries.length; i++) {
    if (enrichStop) break;

    const entry = entries[i];
    broadcastProgress({ current: i, total: entries.length, name: entry.url, status: 'scraping', mode: 'marketplace' });

    try {
      let profileUrl = '';
      let baseLead   = {
        emails: [], phones: [], websites: [], whatsapp: [],
        work: [], education: [], location: '', hometown: '',
        source: 'marketplace',
        extractedAt: new Date().toISOString(),
      };

      // Phase 1: if it's a listing URL, visit the listing to get seller info
      if (entry.type === 'listing') {
        const listing = await openAndScrape(entry.url, 'marketplace_scraper.js', 'scrapeListing');

        if (listing.error === 'login_required') {
          broadcastProgress({ current: i + 1, total: entries.length, name: '', status: 'blocked', mode: 'marketplace' });
          break;
        }
        if (listing.error) {
          broadcastProgress({ current: i + 1, total: entries.length, name: entry.url, status: 'error', mode: 'marketplace' });
          continue;
        }

        profileUrl = listing.sellerProfileUrl;
        baseLead = {
          ...baseLead,
          name:             listing.sellerName || '',
          itemTitle:        listing.itemTitle  || '',
          price:            listing.price      || '',
          listingDesc:      listing.description || '',
          listingLocation:  listing.listingLocation || '',
          listingUrl:       entry.url,
        };

        await sleep(1500 + Math.random() * 500);
        if (enrichStop) break;

      } else {
        // It's a direct profile URL
        profileUrl = entry.url;
      }

      if (!profileUrl) {
        broadcastProgress({ current: i + 1, total: entries.length, name: entry.url, status: 'error', mode: 'marketplace' });
        continue;
      }

      baseLead.profileUrl = profileUrl;

      // Phase 2: enrich the seller's About pages
      broadcastProgress({ current: i, total: entries.length, name: baseLead.name || profileUrl, status: 'enriching', mode: 'marketplace' });

      const enriched = await enrichOne(baseLead);

      if (enriched?.blocked) {
        broadcastProgress({ current: i + 1, total: entries.length, name: '', status: 'blocked', mode: 'marketplace' });
        break;
      }

      if (enriched) {
        await upsertLead({ ...baseLead, ...enriched });
        broadcastProgress({ current: i + 1, total: entries.length, name: baseLead.name || profileUrl, status: 'done', mode: 'marketplace' });
      }

    } catch {
      broadcastProgress({ current: i + 1, total: entries.length, name: entry.url, status: 'error', mode: 'marketplace' });
    }

    if (i < entries.length - 1 && !enrichStop) await sleep(2000 + Math.random() * 2000);
  }

  enrichActive = false;
  broadcastProgress({
    current: entries.length, total: entries.length, name: '',
    status: enrichStop ? 'stopped' : 'complete', mode: 'marketplace',
  });
}

// ── message router ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'saveLeads') {
    handleSaveLeads(msg.leads || []).then(sendResponse);
    return true;
  }
  if (msg.action === 'clearLeads') {
    setStorage({ leads: [], enrichProgress: null }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'getLeads') {
    getStorage({ leads: [] }).then(sendResponse);
    return true;
  }
  if (msg.action === 'startEnrichment') {
    runEnrichment(msg.profileUrls || []).catch(console.error);
    sendResponse({ started: true });
    return true;
  }
  if (msg.action === 'startMarketplaceProcessing') {
    runMarketplaceProcessing(msg.entries || []).catch(console.error);
    sendResponse({ started: true });
    return true;
  }
  if (msg.action === 'stopEnrichment') {
    enrichStop = true;
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'getEnrichProgress') {
    getStorage({ enrichProgress: null }).then((d) => sendResponse(d.enrichProgress));
    return true;
  }
});

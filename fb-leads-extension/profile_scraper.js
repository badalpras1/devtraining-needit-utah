(() => {
  // ── regex patterns ─────────────────────────────────────────────────────────
  const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const PHONE_RE = /(?:\+?\d[\d\s\-().]{5,18}\d)/g;
  // External URLs only (skip facebook.com itself)
  const URL_RE   = /https?:\/\/(?!(?:www\.|web\.|m\.)?facebook\.com)[^\s"'<>\]]{5,}/g;
  const WA_RE    = /(?:wa\.me\/\d+|whatsapp\.com\/[^\s"'<>]+)/gi;

  function pageText() {
    return document.body ? (document.body.innerText || '') : '';
  }

  // ── page-state guards ──────────────────────────────────────────────────────

  function isLoginWall() {
    const t = pageText().toLowerCase();
    return t.includes('log in to facebook') ||
           t.includes('you must log in') ||
           document.title.toLowerCase().includes('log in');
  }

  function isUnavailable() {
    const t = pageText().toLowerCase();
    return t.includes("this content isn't available") ||
           t.includes("this page isn't available") ||
           t.includes('profile is not available');
  }

  // ── contact page scraper ───────────────────────────────────────────────────
  // URL: /username/about_contact_and_basic_info

  function scrapeContact() {
    const text = pageText();
    const emails   = [...new Set((text.match(EMAIL_RE) || []))];
    const rawPhones = (text.match(PHONE_RE) || []);
    const phones   = [...new Set(
      rawPhones.map((s) => s.trim()).filter((s) => s.replace(/\D/g, '').length >= 7)
    )];
    const websites = [...new Set(
      (text.match(URL_RE) || []).map((u) => u.replace(/[)\].,;]+$/, ''))
    )];
    const whatsapp = [...new Set((text.match(WA_RE) || []))];
    return { emails, phones, websites, whatsapp };
  }

  // ── work / education page scraper ──────────────────────────────────────────
  // URL: /username/about_work_and_education

  function scrapeWork() {
    const lines = pageText().split('\n').map((l) => l.trim()).filter(Boolean);

    const UI_NOISE = /^(Add a|Edit|Delete|See|Visible to|Only me|Friends|Public|More|·|Update|Remove|Go to|Work and Education)$/i;

    let inWork = false, inEdu = false;
    const work = [], education = [];

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^Work$/i.test(l))                               { inWork = true;  inEdu = false; continue; }
      if (/^Education$/i.test(l))                          { inEdu = true;   inWork = false; continue; }
      if (/^(Skills|Professional Skills|Places)$/i.test(l)){ inWork = false; inEdu = false;  continue; }

      if ((inWork || inEdu) && UI_NOISE.test(l)) continue;

      if (inWork && l.length >= 3 && l.length < 120) {
        work.push(l);
        if (work.length >= 8) inWork = false;
      }
      if (inEdu && l.length >= 3 && l.length < 120) {
        education.push(l);
        if (education.length >= 8) inEdu = false;
      }
    }

    return { work: [...new Set(work)], education: [...new Set(education)] };
  }

  // ── places page scraper ────────────────────────────────────────────────────
  // URL: /username/about_places

  function scrapePlaces() {
    const lines = pageText().split('\n').map((l) => l.trim()).filter(Boolean);
    const LABELS = /^(Current city|Lives in|Hometown|From|Places Lived|Add a city|Edit|Delete|See|Public|Friends|Only me|·)$/i;

    let location = '', hometown = '';

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const isCurrent  = /current city|lives in/i.test(l);
      const isHometown = /hometown|^from$/i.test(l);

      if (isCurrent || isHometown) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const next = lines[j];
          if (next.length > 2 && !LABELS.test(next)) {
            if (isCurrent  && !location)  location  = next;
            if (isHometown && !hometown)  hometown  = next;
            break;
          }
        }
      }
    }

    return { location, hometown };
  }

  // ── message handler ────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action !== 'scrapeProfile') return;

    if (isLoginWall())    { sendResponse({ error: 'login_required' });  return true; }
    if (isUnavailable())  { sendResponse({ error: 'private_profile' }); return true; }

    const page = msg.page || 'contact';
    if (page === 'contact') sendResponse(scrapeContact());
    else if (page === 'work')   sendResponse(scrapeWork());
    else if (page === 'places') sendResponse(scrapePlaces());
    else sendResponse({});

    return true;
  });
})();

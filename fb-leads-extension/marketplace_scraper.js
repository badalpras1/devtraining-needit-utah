(() => {
  // ── profile URL helpers (same rules as content.js) ─────────────────────────

  const SKIP_PATHS = [
    '/events/', '/photo/', '/photos/', '/video/', '/videos/',
    '/stories/', '/watch/', '/gaming/', '/notifications/', '/messages/',
    '/bookmarks/', '/friends/', '/help/', '/privacy/', '/settings/',
    '/ads/', '/hashtag/', '/search/', '/login', '/checkpoint',
    '/composer/', '/share', '/sharer', '/dialog/', '/policies/',
    '/about/', '/directory/', '/places/', '/business/',
  ];
  const FB_HOSTS = new Set([
    'www.facebook.com', 'web.facebook.com', 'facebook.com', 'm.facebook.com',
  ]);

  function isProfileHref(href) {
    if (!href) return false;
    try {
      const url = new URL(href, location.origin);
      if (!FB_HOSTS.has(url.hostname)) return false;
      const path = url.pathname;
      const low  = path.toLowerCase();
      if (path.length < 2 || path === '/') return false;
      if (SKIP_PATHS.some((p) => low.startsWith(p))) return false;
      if (low.startsWith('/marketplace/')) return false; // handled separately
      const first = path.split('/')[1] || '';
      if (first.includes('.php') && first !== 'profile.php') return false;
      if (low === '/profile.php') return url.searchParams.has('id');
      if (low.startsWith('/people/')) return true;
      if (low.startsWith('/user/')) return true;
      if (/^\/[a-zA-Z][a-zA-Z0-9._-]{2,}$/.test(path)) return true;
      return false;
    } catch { return false; }
  }

  // Convert /marketplace/profile/USER_ID/ → /profile.php?id=USER_ID
  function marketplaceProfileToUser(href) {
    try {
      const url = new URL(href, location.origin);
      const m = url.pathname.match(/\/marketplace\/profile\/(\d+)/);
      if (m) return `https://www.facebook.com/profile.php?id=${m[1]}`;
    } catch {}
    return null;
  }

  function pageText() {
    return document.body ? (document.body.innerText || '') : '';
  }

  // ── listing page guards ────────────────────────────────────────────────────

  function isLoginWall() {
    const t = pageText().toLowerCase();
    return t.includes('log in to facebook') || t.includes('you must log in');
  }

  function isUnavailable() {
    const t = pageText().toLowerCase();
    return t.includes("this listing isn't available") ||
           t.includes("this content isn't available") ||
           t.includes('no longer available');
  }

  // ── main scraper ───────────────────────────────────────────────────────────

  function scrapeListing() {
    if (isLoginWall())    return { error: 'login_required' };
    if (isUnavailable())  return { error: 'unavailable' };

    // ── seller link ──────────────────────────────────────────────────────────
    let sellerProfileUrl = '';
    let sellerName = '';

    // Priority 1: marketplace profile link (most reliable on listing pages)
    const mpLink = document.querySelector('a[href*="/marketplace/profile/"]');
    if (mpLink) {
      sellerProfileUrl = marketplaceProfileToUser(mpLink.href) || mpLink.href;
      sellerName = mpLink.textContent.trim();
    }

    // Priority 2: regular profile link (when seller has a username)
    if (!sellerProfileUrl) {
      const links = document.querySelectorAll('a[href]');
      for (const link of links) {
        if (isProfileHref(link.href)) {
          sellerProfileUrl = link.href;
          sellerName = link.textContent.trim();
          break;
        }
      }
    }

    // ── item metadata ────────────────────────────────────────────────────────
    const text = pageText();

    // Title: first h1, or largest heading
    const h1 = document.querySelector('h1');
    const itemTitle = h1 ? h1.textContent.trim() : '';

    // Price: dollar/currency amounts
    const priceMatch = text.match(/(?:USD\s*)?[\$£€]\s*[\d,]+(?:\.\d{2})?|\d[\d,]*\s*(?:USD|EUR|GBP|AUD|CAD)/);
    const price = priceMatch ? priceMatch[0].trim() : '';

    // Description: first substantial [dir=auto] block that isn't the title/seller
    let description = '';
    document.querySelectorAll('[dir="auto"]').forEach((el) => {
      if (description) return;
      const t = el.textContent.trim();
      if (t.length > 40 && t !== itemTitle && t !== sellerName) {
        description = t.slice(0, 500);
      }
    });

    // Location: text near "Location" label or common patterns
    const locMatch = text.match(/(?:^|\n)([\w\s,]+,\s*[A-Z]{2}(?:\s+\d{5})?)/m);
    const listingLocation = locMatch ? locMatch[1].trim() : '';

    return { sellerProfileUrl, sellerName, itemTitle, price, description, listingLocation };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'scrapeListing') {
      sendResponse(scrapeListing());
    }
    return true;
  });
})();

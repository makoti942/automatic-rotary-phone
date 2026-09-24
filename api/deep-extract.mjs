async function handler(req, res) {
  console.log('=== DEEP EXTRACT v5 ===');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const targetUrl = new URL(url);
    const baseUrl = targetUrl.origin;
    const bots = [];
    const seenContent = new Set();
    const fetchedUrls = new Set();
    const checkedUrls = new Set();

    console.log('Target:', url);

    const html = await safeFetch(url);
    if (!html) return res.status(500).json({ error: 'Failed to fetch target page' });

    const discoveredFiles = new Set();

    const scriptSrcRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
    const scriptSrcs = [];
    let m;
    while ((m = scriptSrcRegex.exec(html)) !== null) {
      try { scriptSrcs.push(new URL(m[1], baseUrl).href); } catch {}
    }

    for (const scriptUrl of scriptSrcs) {
      if (fetchedUrls.has(scriptUrl)) continue;
      fetchedUrls.add(scriptUrl);
      try {
        const js = await safeFetch(scriptUrl, 10000);
        if (js) discoverXmlFiles(js, discoveredFiles);
      } catch {}
    }

    discoverXmlFiles(html, discoveredFiles);
    console.log('Phase 1 - JS scan:', discoveredFiles.size, 'files:', [...discoveredFiles]);

    const internalPages = new Set();
    const linkRegex = /href=["']([^"'#][^"']*?)["']/gi;
    let lm;
    while ((lm = linkRegex.exec(html)) !== null) {
      try {
        const full = new URL(lm[1], baseUrl).href;
        if (full.startsWith(baseUrl)) internalPages.add(full);
      } catch {}
    }

    const botPagePatterns = ['free-bots', 'browse-bots', 'strategies', 'bots', 'library', 'market', 'trade'];
    for (const pattern of botPagePatterns) {
      for (const suffix of ['', '/', '.html']) {
        internalPages.add(`${baseUrl}/${pattern}${suffix}`);
      }
    }

    console.log('Phase 2 - Crawling', internalPages.size, 'internal pages...');

    const pageArray = [...internalPages].slice(0, 30);
    const pageResults = await Promise.allSettled(
      pageArray.map(async (pageUrl) => {
        if (checkedUrls.has(pageUrl)) return;
        checkedUrls.add(pageUrl);
        try {
          const pageHtml = await safeFetch(pageUrl, 6000);
          if (!pageHtml) return;
          discoverXmlFiles(pageHtml, discoveredFiles);

          const subLinkRegex = /href=["']([^"'#][^"']*?)["']/gi;
          let slm;
          while ((slm = subLinkRegex.exec(pageHtml)) !== null) {
            try {
              const subFull = new URL(slm[1], pageUrl).href;
              if (subFull.startsWith(baseUrl) && subFull.endsWith('.xml') && !checkedUrls.has(subFull)) {
                checkedUrls.add(subFull);
                discoveredFiles.add(subFull.split('/').pop());
              }
            } catch {}
          }
        } catch {}
      })
    );
    console.log('Phase 2 - After crawl:', discoveredFiles.size, 'files');

    const allPaths = ['/xml/', '/bots/', '/public/xml/', '/assets/xml/', '/static/xml/', '/bot/', '/strategies/', '/files/', '/downloads/', '/'];
    const fetchPromises = [];

    for (const filename of discoveredFiles) {
      for (const basePath of allPaths) {
        let fileUrl;
        try { fileUrl = new URL(basePath + filename, baseUrl).href; } catch { continue; }
        if (fetchedUrls.has(fileUrl)) continue;
        fetchedUrls.add(fileUrl);
        fetchPromises.push(fetchAndValidate(fileUrl, filename, bots, seenContent));
      }
    }

    console.log('Phase 3 - Fetching', fetchPromises.length, 'discovered file URLs...');
    await Promise.allSettled(fetchPromises);
    console.log('Phase 3 - After fetch:', bots.length, 'valid bots');

    const probeNames = [
      'BEST_RISE_FALL', 'MAKOTI_AUTOMATED_RISE_FALL', 'STARTER_BOT', 'Poverty_Killer',
      'Market_Killer', 'O_U_KILLER', 'HIGH_LOW', 'UNDER_6', 'OVER_1',
      'EVEN_ODD_KILLER', 'DIFFERS_AUTO', 'AI_Analyst', 'Multi_Killer', 'Digit_Hunter',
      'Entry_Digit', 'NEW_BOT_WITH_ENTRY_POINT', 'SPLIT_MARTINGALE_BOT_PREMIUM',
      'Martingale', 'Dalembert', 'Oscar_Grinde', 'Oscar', 'Fibonacci', 'Paroli',
      'Anti_Martingale', 'Custom_Strategy', 'Rise_Fall', 'Both_Sides',
      'Accumulators', 'Multipliers', 'Turbos', 'Ticks',
      'Under_5', 'Under_7', 'Over_2', 'Over_3', 'Over_4', 'Over_5',
      'RNG', 'Static', 'Dynamic', 'Smart', 'Auto',
      'Recovery', 'Premium', 'Advanced', 'Basic', 'Pro', 'Elite',
    ];

    const probePromises = [];
    for (const basePath of ['/xml/', '/bots/']) {
      for (const name of probeNames) {
        const candidates = [`${name}.xml`, `${name.toLowerCase()}.xml`];
        for (const filename of candidates) {
          const tryUrl = `${baseUrl}${basePath}${filename}`;
          if (fetchedUrls.has(tryUrl)) continue;
          fetchedUrls.add(tryUrl);
          probePromises.push(fetchAndValidate(tryUrl, filename, bots, seenContent));
        }
      }
    }

    console.log('Phase 4 - Probing', probePromises.length, 'common names...');
    await Promise.allSettled(probePromises);
    console.log('Phase 4 - After probe:', bots.length, 'valid bots');

    const dirPromises = [];
    for (const dir of ['/xml/', '/bots/']) {
      const dirUrl = `${baseUrl}${dir}`;
      if (!fetchedUrls.has(dirUrl)) {
        fetchedUrls.add(dirUrl);
        dirPromises.push((async () => {
          try {
            const dirContent = await safeFetch(dirUrl, 5000);
            if (dirContent) {
              const fileLinks = dirContent.match(/href=["']([^"']+\.xml)["']/gi);
              if (fileLinks) {
                for (const fl of fileLinks) {
                  const fname = fl.match(/href=["']([^"']+\.xml)["']/i)?.[1];
                  if (fname) discoveredFiles.add(fname.split('/').pop());
                }
              }
            }
          } catch {}
        })());
      }
    }
    await Promise.allSettled(dirPromises);
    console.log('Phase 5 - After dir listing:', discoveredFiles.size, 'total files');

    const finalFetchPromises = [];
    for (const filename of discoveredFiles) {
      for (const basePath of ['/xml/', '/bots/']) {
        let fileUrl;
        try { fileUrl = new URL(basePath + filename, baseUrl).href; } catch { continue; }
        if (fetchedUrls.has(fileUrl)) continue;
        fetchedUrls.add(fileUrl);
        finalFetchPromises.push(fetchAndValidate(fileUrl, filename, bots, seenContent));
      }
    }
    if (finalFetchPromises.length > 0) {
      await Promise.allSettled(finalFetchPromises);
    }

    bots.sort((a, b) => b.size - a.size);

    console.log('=== RESULT:', bots.length, 'valid bots ===');
    for (const b of bots) console.log(`  ${b.name} (${b.size} bytes)`);
    return res.json({ bots, count: bots.length });

  } catch (error) {
    console.error('ERROR:', error.message);
    return res.status(500).json({ error: error.message || 'Extraction failed' });
  }
}

async function fetchAndValidate(fileUrl, filename, bots, seenContent) {
  try {
    const content = await safeFetch(fileUrl, 6000);
    if (!content) return;
    if (content.includes('<!DOCTYPE html') || content.includes('<html')) return;
    if (content.includes('MODULE_NOT_FOUND') || content.includes('Cannot find module')) return;

    if (isValidDerivBotXml(content) && !seenContent.has(content)) {
      seenContent.add(content);
      const name = filename.replace('.xml', '').replace(/[_-]/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, c => c.toUpperCase());
      bots.push({ name, xml: content.trim(), source: fileUrl, size: content.length });
      console.log('FOUND:', name, `(${content.length} bytes)`);
    }
  } catch {}
}

function discoverXmlFiles(content, discovered) {
  const patterns = [
    /["']([A-Za-z][A-Za-z0-9_ .-]+\.xml)["']/g,
    /\/([A-Za-z][A-Za-z0-9_ .-]+\.xml)/g,
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      let filename = match[1] || match[0];
      if (!filename.endsWith('.xml')) continue;
      if (filename.length < 5 || filename.length > 80) continue;
      filename = filename.replace(/^["'\/]+/, '').replace(/["']+$/, '');
      if (filename.includes('blockly') || filename.includes('node_modules')) continue;
      discovered.add(filename);
    }
  }

  const arrayPattern = /\[([^[\]]*\.xml[^[\]]*)\]/g;
  while ((match = arrayPattern.exec(content)) !== null) {
    const block = match[1];
    const items = block.match(/["']([A-Za-z][A-Za-z0-9_-]+\.xml)["']/g);
    if (items && items.length >= 2) {
      for (const item of items) {
        discovered.add(item.replace(/["']/g, ''));
      }
    }
  }
}

function isValidDerivBotXml(content) {
  if (!content || typeof content !== 'string') return false;
  const trimmed = content.trim();
  if (trimmed.length < 200) return false;
  if (trimmed.length > 500000) return false;

  if (!trimmed.startsWith('<xml') && !trimmed.startsWith('<?xml')) return false;
  if (!trimmed.includes('<block')) return false;
  if (!trimmed.includes('type="')) return false;

  const blockCount = (trimmed.match(/<block /g) || []).length;
  if (blockCount < 2) return false;

  return true;
}

async function safeFetch(url, timeout = 8000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('image') || ct.includes('video') || ct.includes('font')) return null;
    return await resp.text();
  } catch { return null; }
}

export default handler;
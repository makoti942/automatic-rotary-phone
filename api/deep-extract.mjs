async function handler(req, res) {
  console.log('=== DEEP EXTRACT v4 ===');

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

    console.log('Target:', url);

    const html = await safeFetch(url);
    if (!html) return res.status(500).json({ error: 'Failed to fetch target page' });

    const discoveredFiles = new Set();

    discoverXmlFilesFromHtml(html, baseUrl, discoveredFiles);

    const scriptSrcRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
    const scriptSrcs = [];
    let m;
    while ((m = scriptSrcRegex.exec(html)) !== null) {
      try { scriptSrcs.push(new URL(m[1], baseUrl).href); } catch {}
    }
    console.log('Scanning', scriptSrcs.length, 'JS files for .xml references...');

    for (const scriptUrl of scriptSrcs) {
      if (fetchedUrls.has(scriptUrl)) continue;
      fetchedUrls.add(scriptUrl);
      try {
        const jsContent = await safeFetch(scriptUrl, 12000);
        if (jsContent) {
          discoverXmlFilesFromJs(jsContent, baseUrl, discoveredFiles);
        }
      } catch {}
    }

    console.log('Discovered .xml files:', discoveredFiles.size, [...discoveredFiles]);

    const paths = ['/xml/', '/bots/', '/assets/xml/', '/public/xml/', '/static/xml/', '/bot/', '/'];

    for (const filename of discoveredFiles) {
      for (const basePath of paths) {
        let fileUrl;
        try { fileUrl = new URL(basePath + filename, baseUrl).href; } catch { continue; }
        if (fetchedUrls.has(fileUrl)) continue;
        fetchedUrls.add(fileUrl);

        try {
          const content = await safeFetch(fileUrl, 8000);
          if (!content) continue;

          if (isValidDerivBotXml(content) && !seenContent.has(content)) {
            seenContent.add(content);
            const name = extractBotName(filename, content);
            bots.push({ name, xml: content.trim(), source: fileUrl, size: content.length });
            console.log('FOUND:', name, `(${content.length} bytes)`, fileUrl);
          } else if (content.includes('<html') || content.includes('<!DOCTYPE')) {
            console.log('SPA shell returned for:', fileUrl);
          }
        } catch {}
      }
    }

    const commonBots = [
      'STARTER_BOT', 'BEST_RISE_FALL', 'MAKOTI_AUTOMATED_RISE_FALL',
      'NEW_BOT_WITH_ENTRY_POINT', 'SPLIT_MARTINGALE_BOT_PREMIUM',
      'Poverty_Killer', 'Market_Killer', 'O_U_KILLER', 'HIGH_LOW',
      'UNDER_6', 'UNDER6', 'OVER_1', 'EVEN_ODD_KILLER',
      'DIFFERS_AUTO', 'AI_Analyst', 'Multi_Killer', 'Digit_Hunter',
      'Entry_Digit', 'Martingale', 'Dalembert', 'Oscar_Grinde',
      'Fibonacci', 'Paroli', 'Anti_Martingale',
    ];
    for (const basePath of ['/xml/', '/bots/']) {
      for (const name of commonBots) {
        const candidates = [
          `${name}.xml`,
          `${name.toLowerCase()}.xml`,
          `${name.replace(/ /g, '_')}.xml`,
        ];
        for (const filename of candidates) {
          const tryUrl = `${baseUrl}${basePath}${filename}`;
          if (fetchedUrls.has(tryUrl)) continue;
          fetchedUrls.add(tryUrl);
          try {
            const content = await safeFetch(tryUrl, 5000);
            if (content && isValidDerivBotXml(content) && !seenContent.has(content)) {
              seenContent.add(content);
              const cleanName = name.replace(/_/g, ' ');
              bots.push({ name: cleanName, xml: content.trim(), source: tryUrl, size: content.length });
              console.log('COMMON HIT:', cleanName, tryUrl);
            }
          } catch {}
        }
      }
    }

    console.log('=== RESULT:', bots.length, 'valid bots ===');
    for (const b of bots) console.log(`  ${b.name} (${b.size} bytes)`);
    return res.json({ bots, count: bots.length });

  } catch (error) {
    console.error('ERROR:', error.message);
    return res.status(500).json({ error: error.message || 'Extraction failed' });
  }
}

function discoverXmlFilesFromHtml(html, baseUrl, discovered) {
  const patterns = [
    /href=["']([^"']*\.xml)["']/gi,
    /src=["']([^"']*\.xml)["']/gi,
    /["']([A-Za-z][A-Za-z0-9_-]+\.xml)["']/g,
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(html)) !== null) {
      let filename = match[1];
      if (!filename || !filename.endsWith('.xml')) continue;
      if (filename.length < 5 || filename.length > 80) continue;

      if (filename.startsWith('http')) {
        try {
          const u = new URL(filename);
          filename = u.pathname.split('/').pop();
        } catch { continue; }
      } else {
        filename = filename.replace(/^\/+/, '');
      }

      if (filename.includes('node_modules') || filename.includes('.chunk') || filename.includes('.bundle')) continue;
      discovered.add(filename);
    }
  }
}

function discoverXmlFilesFromJs(jsContent, baseUrl, discovered) {
  const xmlFilePattern = /["']([A-Za-z][A-Za-z0-9_-]+\.xml)["']/g;
  let match;
  while ((match = xmlFilePattern.exec(jsContent)) !== null) {
    const filename = match[1];
    if (filename.length < 5 || filename.length > 80) continue;
    if (filename.includes('node_modules') || filename.includes('.chunk') || filename.includes('.bundle')) continue;

    const lower = filename.toLowerCase();
    if (lower.includes('error') || lower.includes('module') || lower.includes('not_found')) continue;

    discovered.add(filename);
    discovered.add(lower);
  }

  const arrayPattern = /\[([^[\]]*\.xml[^[\]]*)\]/g;
  while ((match = arrayPattern.exec(jsContent)) !== null) {
    const block = match[1];
    const items = block.match(/["']([A-Za-z][A-Za-z0-9_-]+\.xml)["']/g);
    if (items && items.length >= 2) {
      for (const item of items) {
        const name = item.replace(/["']/g, '');
        discovered.add(name);
        discovered.add(name.toLowerCase());
      }
    }
  }

  const xmlRefPatterns = [
    /fetch\s*\(\s*["']([^"']*\.xml)["']/gi,
    /\.get\s*\(\s*["']([^"']*\.xml)["']/gi,
    /import\s*\(\s*["']([^"']*\.xml)["']/gi,
    /require\s*\(\s*["']([^"']*\.xml)["']/gi,
    /loadFile\s*\(\s*["']([^"']*\.xml)["']/gi,
  ];

  for (const regex of xmlRefPatterns) {
    while ((match = regex.exec(jsContent)) !== null) {
      let path = match[1];
      if (path && path.endsWith('.xml')) {
        const parts = path.split('/');
        const filename = parts[parts.length - 1];
        if (filename.length >= 5 && filename.length <= 80) {
          discovered.add(filename);
        }
      }
    }
  }
}

function isValidDerivBotXml(content) {
  if (!content || typeof content !== 'string') return false;
  const trimmed = content.trim();
  if (trimmed.length < 200) return false;
  if (trimmed.length > 500000) return false;

  if (trimmed.includes('<!DOCTYPE html') || trimmed.includes('<html')) return false;
  if (trimmed.includes('MODULE_NOT_FOUND') || trimmed.includes('Cannot find module')) return false;
  if (trimmed.includes('error') && trimmed.includes('Error:')) return false;

  if (!trimmed.startsWith('<xml') && !trimmed.startsWith('<?xml')) return false;
  if (!trimmed.includes('<block')) return false;
  if (!trimmed.includes('type="')) return false;

  const blockCount = (trimmed.match(/<block /g) || []).length;
  if (blockCount < 2) return false;

  const tagOpen = (trimmed.match(/<block[\s>]/g) || []).length;
  const tagClose = (trimmed.match(/<\/block>/g) || []).length;
  if (tagClose === 0 && tagOpen > 3) return false;

  const hasXmlClosing = trimmed.endsWith('</xml>');
  if (!hasXmlClosing && blockCount > 3) return false;

  return true;
}

function extractBotName(filename, content) {
  let name = filename.replace('.xml', '');

  const prettyName = name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());

  return prettyName;
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
    if (ct.includes('image') || ct.includes('video') || ct.includes('audio') || ct.includes('font')) return null;
    return await resp.text();
  } catch { return null; }
}

export default handler;
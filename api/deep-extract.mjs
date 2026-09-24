async function handler(req, res) {
  console.log('=== DEEP EXTRACT START ===');

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
    const seenXml = new Set();
    const fetchedUrls = new Set();

    console.log('Target:', url);

    const html = await safeFetch(url);
    if (!html) return res.status(500).json({ error: 'Failed to fetch target page' });

    const scriptSrcs = [];
    const scriptSrcRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let srcMatch;
    while ((srcMatch = scriptSrcRegex.exec(html)) !== null) {
      try { scriptSrcs.push(new URL(srcMatch[1], baseUrl).href); } catch {}
    }

    const inlineScripts = [];
    const scriptTagRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptTagRegex.exec(html)) !== null) {
      if (match[1] && match[1].length > 100) {
        inlineScripts.push(match[1]);
      }
    }
    console.log('Script sources:', scriptSrcs.length, 'Inline scripts:', inlineScripts.length);

    for (const scriptUrl of scriptSrcs) {
      if (fetchedUrls.has(scriptUrl)) continue;
      fetchedUrls.add(scriptUrl);
      try {
        const scriptContent = await safeFetch(scriptUrl);
        if (scriptContent) {
          inlineScripts.push(scriptContent);
          extractXmlFromScript(scriptContent, scriptUrl, bots, seenXml);
          await extractXmlFilenames(scriptContent, baseUrl, bots, seenXml, fetchedUrls);
        }
      } catch {}
    }

    for (const script of inlineScripts) {
      extractXmlFromScript(script, url, bots, seenXml);
      await extractXmlFilenames(script, baseUrl, bots, seenXml, fetchedUrls);
    }

    extractXmlFromScript(html, url, bots, seenXml);
    await extractXmlFilenames(html, baseUrl, bots, seenXml, fetchedUrls);

    const xmlLinks = [];
    const linkRegex = /href=["']([^"']*\.xml[^"']*?)["']/gi;
    while ((match = linkRegex.exec(html)) !== null) {
      try { xmlLinks.push(new URL(match[1], baseUrl).href); } catch {}
    }
    const srcXmlRegex = /src=["']([^"']*\.xml[^"']*?)["']/gi;
    while ((match = srcXmlRegex.exec(html)) !== null) {
      try { xmlLinks.push(new URL(match[1], baseUrl).href); } catch {}
    }

    for (const xmlUrl of xmlLinks) {
      if (fetchedUrls.has(xmlUrl)) continue;
      fetchedUrls.add(xmlUrl);
      try {
        const content = await safeFetch(xmlUrl);
        if (content && content.includes('<block') && content.length > 200 && !seenXml.has(content)) {
          seenXml.add(content);
          const name = xmlUrl.split('/').pop()?.replace('.xml', '').replace(/[_-]/g, ' ') || 'Unknown';
          bots.push({ name, xml: content.trim(), source: xmlUrl, size: content.length });
          console.log('Found XML link:', name);
        }
      } catch {}
    }

    const commonNames = ['Poverty_Killer', 'BEST_RISE_FALL', 'MAKOTI_AUTOMATED_RISE_FALL', 'UNDER_6', 'Market_Killer', 'O_U_KILLER', 'HIGH_LOW', 'EVEN_ODD_KILLER', 'DIFFERS_AUTO', 'AI_Analyst', 'Multi_Killer', 'Digit_Hunter', 'Entry_Digit', 'STARTER_BOT', 'SPLIT_MARTINGALE_BOT_PREMIUM', 'NEW_BOT_WITH_ENTRY_POINT'];
    for (const p of ['/xml/', '/bots/']) {
      for (const n of commonNames) {
        const tryUrl = `${baseUrl}${p}${n}.xml`;
        if (fetchedUrls.has(tryUrl)) continue;
        fetchedUrls.add(tryUrl);
        try {
          const content = await safeFetch(tryUrl);
          if (content && content.includes('<block') && content.length > 200 && !seenXml.has(content)) {
            seenXml.add(content);
            bots.push({ name: n.replace(/_/g, ' '), xml: content.trim(), source: tryUrl, size: content.length });
            console.log('Common path hit:', n);
          }
        } catch {}
      }
    }

    console.log('=== COMPLETE:', bots.length, 'bots found ===');
    return res.json({ bots, count: bots.length });

  } catch (error) {
    console.error('Error:', error.message);
    return res.status(500).json({ error: error.message || 'Extraction failed' });
  }
}

async function safeFetch(url, timeout = 8000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const text = await resp.text();
    if (text.includes('<!DOCTYPE') || text.includes('<html')) {
      if (text.includes('<block') && text.includes('<xml')) return text;
      if (text.length < 5000) return text;
      return text;
    }
    return text;
  } catch { return null; }
}

function extractXmlFromScript(content, source, bots, seenXml) {
  let pos = 0;
  while (pos < content.length) {
    const xmlStart = content.indexOf('<xml', pos);
    if (xmlStart === -1) break;
    const xmlEnd = content.indexOf('</xml>', xmlStart);
    if (xmlEnd === -1) { pos = xmlStart + 4; continue; }

    let xml = content.substring(xmlStart, xmlEnd + 6);
    xml = xml.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\'/g, "'");

    if (xml.length > 100 && xml.includes('<block') && !seenXml.has(xml)) {
      seenXml.add(xml);
      const nameMatch = xml.match(/<category[^>]*name=["']([^"']+)["']/i);
      const blockMatch = xml.match(/type=["']([a-z_]+)["']/i);
      const name = nameMatch?.[1] || blockMatch?.[1] || `Bot ${bots.length + 1}`;
      bots.push({ name, xml: xml.trim(), source, size: xml.length });
      console.log('Embedded XML:', name, 'size:', xml.length);
    }
    pos = xmlEnd + 6;
  }
}

async function extractXmlFilenames(content, baseUrl, bots, seenXml, fetchedUrls) {
  const patterns = [
    /["']([A-Za-z][A-Za-z0-9_-]*\.xml)["']/g,
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      if (!name.endsWith('.xml')) continue;

      for (const p of ['/xml/', '/bots/', '/']) {
        const xmlUrl = `${baseUrl}${p}${name}`;
        if (fetchedUrls.has(xmlUrl)) continue;
        fetchedUrls.add(xmlUrl);
        try {
          const fileContent = await safeFetch(xmlUrl);
          if (fileContent && fileContent.includes('<block') && fileContent.length > 200 && !seenXml.has(fileContent)) {
            seenXml.add(fileContent);
            const label = name.replace('.xml', '').replace(/[_-]/g, ' ');
            bots.push({ name: label, xml: fileContent.trim(), source: xmlUrl, size: fileContent.length });
            console.log('Fetched file:', name);
          }
        } catch {}
      }
    }
  }
}

export default handler;
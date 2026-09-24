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
        const scriptContent = await safeFetch(scriptUrl, 10000);
        if (scriptContent) {
          inlineScripts.push(scriptContent);
        }
      } catch {}
    }

    for (const script of inlineScripts) {
      await extractAllBots(script, baseUrl, bots, seenXml, fetchedUrls);
    }

    await extractAllBots(html, baseUrl, bots, seenXml, fetchedUrls);

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
    return await resp.text();
  } catch { return null; }
}

async function extractAllBots(content, baseUrl, bots, seenXml, fetchedUrls) {
  const escapedVariants = [
    { open: '<xml', close: '</xml>' },
    { open: '&lt;xml', close: '&lt;/xml' },
    { open: '\\u003cxml', close: '\\u003c/xml' },
    { open: '\\x3cxml', close: '\\x3c/xml' },
    { open: '<XML', close: '</XML>' },
    { open: '\\u003Cxml', close: '\\u003C/xml' },
    { open: '\\u003CXML', close: '\\u003C/XML' },
  ];

  for (const { open, close } of escapedVariants) {
    let pos = 0;
    while (pos < content.length) {
      const xmlStart = content.indexOf(open, pos);
      if (xmlStart === -1) break;

      let xmlEnd = content.indexOf(close, xmlStart + open.length);
      if (xmlEnd === -1) { pos = xmlStart + open.length; continue; }
      xmlEnd += close.length;

      let xml = content.substring(xmlStart, xmlEnd);
      xml = unescapeXml(xml);

      if (!xml.includes('<block') || xml.length < 300) {
        pos = xmlEnd;
        continue;
      }

      if (isCompleteBotWorkspace(xml) && !seenXml.has(xml)) {
        seenXml.add(xml);
        const name = guessBotName(xml, content, xmlStart, bots.length);
        bots.push({ name, xml: xml.trim(), source: 'embedded', size: xml.length });
        console.log('Found bot:', name, 'size:', xml.length);
      }
      pos = xmlEnd;
    }
  }

  const stringXmlPatterns = [
    /["'`]((?:\s*<xml[\s\S]*?<\/xml>\s*)?)["'`]/g,
    /innerHTML\s*=\s*["'`]([^"'`]*<xml[\s\S]*?<\/xml>[^"'`]*)["'`]/gi,
    /value\s*[:=]\s*["'`]([^"'`]*<xml[\s\S]*?<\/xml>[^"'`]*)["'`]/gi,
    /Blockly\..Xml\.domToText\(([^)]+)\)/gi,
    /xml_text\s*[:=]\s*["'`]([^"'`]*<xml[\s\S]*?<\/xml>[^"'`]*)["'`]/gi,
    /botXml\s*[:=]\s*["'`]([^"'`]*<xml[\s\S]*?<\/xml>[^"'`]*)["'`]/gi,
    /workspaceXml\s*[:=]\s*["'`]([^"'`]*<xml[\s\S]*?<\/xml>[^"'`]*)["'`]/gi,
  ];

  for (const regex of stringXmlPatterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const xml = unescapeXml(match[1] || match[0]);
      if (xml.includes('<block') && xml.length > 300 && isCompleteBotWorkspace(xml) && !seenXml.has(xml)) {
        seenXml.add(xml);
        const name = guessBotName(xml, content, match.index, bots.length);
        bots.push({ name, xml: xml.trim(), source: 'embedded', size: xml.length });
        console.log('Found bot (string):', name, 'size:', xml.length);
      }
    }
  }

  const filenamePatterns = [
    /["']([A-Za-z][A-Za-z0-9_ -]*\.xml)["']/g,
  ];

  for (const regex of filenamePatterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      if (!name.endsWith('.xml') || name.length < 4) continue;
      if (fetchedUrls.has(name)) continue;

      for (const p of ['/xml/', '/bots/', '/']) {
        let xmlUrl;
        try { xmlUrl = new URL(p + name, baseUrl).href; } catch { continue; }
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

function isCompleteBotWorkspace(xml) {
  const hasTradeBlock = xml.includes('type="trade"') || xml.includes('type="trade_block"');
  const hasDerivBot = xml.includes('deriv_bot') || xml.includes('bot_run') || xml.includes('trade_run');
  const hasCategory = (xml.match(/<category/g) || []).length >= 2;
  const hasPurchase = xml.includes('purchase') || xml.includes('PURCHASE');
  const hasRun = xml.includes('bot_run') || xml.includes('run_bot') || xml.includes('trade_run');
  const hasSubtrade = xml.includes('submarket') || xml.includes('contract');
  const hasMultipleBlocks = (xml.match(/<block /g) || []).length >= 3;
  const size = xml.length >= 500;

  return (hasTradeBlock || hasDerivBot || hasPurchase || hasRun || hasSubtrade || hasCategory) && hasMultipleBlocks && size;
}

function guessBotName(xml, fullContent, position, botIndex) {
  const nameFromXml = xml.match(/<field name="BOT_NAME">([^<]+)<\/field>/i);
  if (nameFromXml) return nameFromXml[1].trim();

  const nameFromMutation = xml.match(/<mutation[^>]*bot_name=["']([^"']+)["']/i);
  if (nameFromMutation) return nameFromMutation[1].trim();

  const nameFromTitle = xml.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (nameFromTitle) {
    const t = nameFromTitle[1].trim();
    if (t.length > 1 && t.length < 60 && !t.match(/^[0-9]+$/)) return t;
  }

  const nameFromComment = xml.match(/<comment[^>]*>([^<]+)<\/comment>/i);
  if (nameFromComment) {
    const c = nameFromComment[1].trim();
    if (c.length > 1 && c.length < 60) return c;
  }

  const contextWindow = fullContent.substring(Math.max(0, position - 300), position);
  const contextName = contextWindow.match(/["']([A-Z][A-Za-z0-9_ -]{2,50})["']\s*[,:=]/g);
  if (contextName) {
    const last = contextName[contextName.length - 1];
    const cleaned = last.replace(/["':=,]/g, '').trim();
    if (cleaned.length > 2 && !cleaned.match(/^(function|const|let|var|return|import|export)$/i)) {
      return cleaned;
    }
  }

  const xmlFilename = fullContent.substring(Math.max(0, position - 500), position + 500).match(/["']([A-Za-z][A-Za-z0-9_-]+)\.xml["']/g);
  if (xmlFilename) {
    const lastFile = xmlFilename[xmlFilename.length - 1].replace(/["']/g, '').replace('.xml', '');
    return lastFile.replace(/[_-]/g, ' ');
  }

  return `Bot ${botIndex + 1}`;
}

function unescapeXml(str) {
  return str
    .replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>')
    .replace(/\\x3c/gi, '<').replace(/\\x3e/gi, '>')
    .replace(/\\n/g, '\n').replace(/\\t/g, '\t')
    .replace(/\\"/g, '"').replace(/\\'/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#60;/g, '<').replace(/&#62;/g, '>')
    .replace(/<xml xmlns=["']http:\/\/[^"']+["']>/g, '<xml>')
    .replace(/<xml\s+ns=["']http:\/\/[^"']+["']\s*>/g, '<xml>');
}

export default handler;
const MAX_PAGES = 60;
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 12_000;
const MAX_BOTS = 250;

function decodeMarkup(value) {
  return value
    .replace(/\\u003[cC]/g, '<').replace(/\\u003[eE]/g, '>')
    .replace(/\\x3[cC]/g, '<').replace(/\\x3[eE]/g, '>')
    .replace(/\\u0026/g, '&').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&');
}

function isValidBotXml(value) {
  const xml = decodeMarkup(value || '').trim();
  if (xml.length < 500 || xml.length > 1_000_000) return false;
  if (!/^(?:<\?xml\b[^>]*\?>\s*)?<xml\b/i.test(xml) || !/<\/xml>\s*$/i.test(xml)) return false;
  if (/<(?:!doctype\s+html|html)\b/i.test(xml)) return false;
  if (!/<xml\b[^>]*\bis_dbot=["']true["']/i.test(xml)) return false;
  if (/MODULE_NOT_FOUND|Cannot find module|Blockly\.(?:Blocks|JavaScript)/i.test(xml)) return false;
  if ((xml.match(/<block\b/gi) || []).length < 5) return false;
  return /<block\b[^>]*type=["']trade_definition["']/i.test(xml)
    && /<block\b[^>]*type=["']purchase["']/i.test(xml)
    && /<block\b[^>]*type=["'](?:before_purchase|during_purchase|after_purchase|trade_again)["']/i.test(xml);
}

function isBuiltInBundle(url) {
  return /(?:^|[\\/])(?:[^\\/]+-xml(?:\.[a-f0-9]{6,})?\.js|dbot-collection(?:\.[a-f0-9]{6,})?\.js)$/i.test(url);
}

function normalizeName(value) {
  if (!value) return null;
  const name = value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name || /^(?:bot|xml|data|payload|content|strategy|workspace|document|template)(?:\s*\d+)?$/i.test(name)) return null;
  return name.length >= 2 && name.length <= 140 ? name : null;
}

function nameFromXml(xml) {
  return normalizeName(
    xml.match(/<field\s+name=["']BOT_NAME["']>([^<]+)<\/field>/i)?.[1]
    || xml.match(/<mutation[^>]*bot_name=["']([^"']+)["']/i)?.[1]
    || xml.match(/<title[^>]*>([^<]{2,140})<\/title>/i)?.[1]
  );
}

function nameFromContext(content, position, source) {
  const before = content.slice(Math.max(0, position - 2500), position);
  const match = [...before.matchAll(/(?:name|label|title|displayName|botName|strategyName)\s*[:=]\s*["'`]([^"'`]{2,140})["'`]/gi)].pop();
  if (match) return normalizeName(match[1]);
  if (!/\.(?:xml|json)(?:[?#]|$)/i.test(source)) return null;
  try {
    const file = decodeURIComponent(new URL(source).pathname.split('/').pop() || '').replace(/\.(?:xml|json|js)$/i, '');
    return normalizeName(file);
  } catch { return null; }
}

function extractXmlDocuments(content, source) {
  const decoded = decodeMarkup(content);
  if (isBuiltInBundle(source)) return [];
  const output = [];
  const open = /<xml\b[^>]*>/gi;
  let match;
  while ((match = open.exec(decoded))) {
    const end = decoded.indexOf('</xml>', match.index + match[0].length);
    if (end < 0) continue;
    const xml = decoded.slice(match.index, end + 6).trim();
    if (!isValidBotXml(xml) || output.some(item => item.xml === xml)) {
      open.lastIndex = end + 6;
      continue;
    }
    const name = nameFromXml(xml) || nameFromContext(decoded, match.index, source);
    if (name) output.push({ name, xml, source, size: xml.length });
    open.lastIndex = end + 6;
  }
  return output;
}

function addReferencedUrls(content, source, queue, targetHost) {
  const add = (raw, onlySameHost = false) => {
    try {
      const url = new URL(raw.replace(/[),;]+$/, ''), source);
      if (!['http:', 'https:'].includes(url.protocol)) return;
      if (onlySameHost && url.hostname !== targetHost) return;
      if (!queue.has(url.href)) queue.add(url.href);
    } catch {}
  };
  const urlPattern = /(?:https?:\/\/[^\s"'`<>]+|(?:\.\.?\/|\/)[^\s"'`<>]+|[A-Za-z0-9_./-]+)(?:\.xml|\.json|\.js)(?:[?#][^\s"'`<>]*)?/gi;
  for (const match of content.matchAll(urlPattern)) add(match[0]);
  const endpointPattern = /["'`]((?:https?:\/\/|\/|\.\.?\/)[^"'`<>]{1,260})["'`]/gi;
  for (const match of content.matchAll(endpointPattern)) {
    if (/(?:bot|strategy|free|download|workspace|xml)/i.test(match[1])) add(match[1]);
  }
  const srcPattern = /<(?:script[^>]+src|link[^>]+href|a[^>]+href)=["']([^"']+)["']/gi;
  for (const match of content.matchAll(srcPattern)) add(match[1], true);
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; CustomBotExtractor/2.0)',
      Accept: 'text/html,application/xhtml+xml,application/xml,application/json,text/javascript,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_BYTES) return null;
  const text = await response.text();
  return text.length <= MAX_BYTES ? { text, type: response.headers.get('content-type') || '' } : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const input = String(req.body?.url || '').trim();
  if (!input) return res.status(400).json({ error: 'Missing url' });

  let start;
  try { start = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!['http:', 'https:'].includes(start.protocol)) return res.status(400).json({ error: 'Invalid protocol' });

  const targetHost = start.hostname;
  const queue = new Set([start.href]);
  const visited = new Set();
  const bots = [];
  const seenXml = new Set();
  let spaShells = 0;

  while (queue.size && visited.size < MAX_PAGES && bots.length < MAX_BOTS) {
    const batch = [...queue].filter(url => !visited.has(url)).slice(0, 8);
    if (!batch.length) break;
    batch.forEach(url => visited.add(url));
    const results = await Promise.allSettled(batch.map(async url => ({ url, result: await fetchText(url) })));
    for (const item of results) {
      if (item.status !== 'fulfilled' || !item.value.result) continue;
      const { url, result } = item.value;
      const { text, type } = result;
      if (/<(?:!doctype\s+html|html)\b/i.test(text) && !/\.xml(?:[?#]|$)/i.test(url)) spaShells++;
      for (const bot of extractXmlDocuments(text, url)) {
        if (!seenXml.has(bot.xml)) { seenXml.add(bot.xml); bots.push(bot); }
      }
      if (/html|javascript|json|xml|text\//i.test(type) || /\.(?:html?|js|json|xml)(?:[?#]|$)/i.test(url)) {
        addReferencedUrls(text, url, queue, targetHost);
      }
    }
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ count: bots.length, bots, pagesScanned: visited.size, spaShells });
}

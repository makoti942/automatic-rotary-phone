const MAX_PAGES = 24;
const MAX_BYTES = 4_000_000;
const TIMEOUT_MS = 8_000;
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
  const hasTradeFlow = /<block\b[^>]*type=["'](?:before_purchase|during_purchase|after_purchase|trade_again)["']/i.test(xml)
    || /<statement\s+name=["'](?:BEFOREPURCHASE_STACK|DURINGPURCHASE_STACK|AFTERPURCHASE_STACK)["']/i.test(xml);
  return /<block\b[^>]*type=["']trade_definition["']/i.test(xml)
    && /<block\b[^>]*type=["'](?:purchase|apollo_purchase|apollo_purchase2)["']/i.test(xml)
    && hasTradeFlow;
}

function isBuiltInBundle(url) {
  return /(?:^|[\\/])(?:accumulators?|dalembert|martingale|max-stake|oscars?|reverse|1_3_2_6|dbot-collection)[^\\/]*?(?:-xml)?(?:\.[a-f0-9]{6,})?\.js$/i.test(url);
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
  const beforeDocument = content.slice(0, position);
  const moduleMatches = [...beforeDocument.matchAll(/(?:^|[,{}])(\d+):function\(/g)];
  const moduleId = moduleMatches.pop()?.[1];
  if (moduleId) {
    const escapedId = moduleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const moduleFile = content.match(new RegExp(`["']([^"']+\\.xml)["']\\s*:\\s*["']${escapedId}["']`, 'i'));
    if (moduleFile) return normalizeName(moduleFile[1].replace(/^\.\//, '').replace(/\.xml$/i, ''));
  }
  const before = content.slice(Math.max(0, position - 2500), position);
  const match = [...before.matchAll(/(?:name|label|title|displayName|botName|strategyName)\s*[:=]\s*["'`]([^"'`]{2,140})["'`]/gi)].pop();
  if (match) return normalizeName(match[1]);
  if (!/\.(?:xml|json)(?:[?#]|$)/i.test(source)) {
    const chunk = decodeURIComponent(new URL(source).pathname.split('/').pop() || '')
      .replace(/\.[a-f0-9]{6,}\.js$/i, '').replace(/-xml$/i, '');
    // Custom XML context chunks are often named after the bot itself, but
    // names such as "Reborn-HnR" or "PATEL" do not contain bot/strategy.
    // The `-xml` suffix is the reliable signal that this is a bot payload.
    if (/-xml\./i.test(decodeURIComponent(new URL(source).pathname.split('/').pop() || ''))) {
      return normalizeName(chunk);
    }
    if (chunk && /(?:free|bot|strategy|scalper)/i.test(chunk)) {
      return normalizeName(chunk.replace(/^(?:dollarprinter|dbotspace|dbtraders|traderkit|money8gg|exwager|osam|mkorean)-/i, '').replace(/^(?:free|bots?|strateg(?:y|ies)|scalper)-/i, '').replace(/[-_]+/g, ' '));
    }
    return null;
  }
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

function addReferencedUrls(content, source, queue, targetHost, targetOrigin, candidateFiles, priorityQueue) {
  const add = (raw, onlySameHost = false, priority = false) => {
    try {
      const url = new URL(raw.replace(/[),;]+$/, ''), source);
      if (!['http:', 'https:'].includes(url.protocol)) return;
      if (onlySameHost && url.hostname !== targetHost) return;
      if (priority && priorityQueue) priorityQueue.add(url.href);
      else if (!queue.has(url.href)) queue.add(url.href);
    } catch {}
  };
  const urlPattern = /(?:https?:\/\/[^\s"'`<>]+|(?:\.\.?\/|\/)[^\s"'`<>]+|[A-Za-z0-9_./-]+)(?:\.xml|\.json|\.js|\.map)(?:[?#][^\s"'`<>]*)?/gi;
  for (const match of content.matchAll(urlPattern)) {
    const raw = match[0];
    add(raw);
    if (/\.xml(?:[?#]|$)/i.test(raw)) {
      try {
        const parsed = new URL(raw, source);
        const rawPath = raw.split(/[?#]/)[0].replace(/^\.\//, '').replace(/^\//, '');
        const file = decodeURIComponent(rawPath || parsed.pathname.split('/').pop() || '');
        if (file) candidateFiles.add(file);
      } catch {}
    }
  }
  const endpointPattern = /["'`]((?:https?:\/\/|\/|\.\.?\/)[^"'`<>]{1,260})["'`]/gi;
  for (const match of content.matchAll(endpointPattern)) {
    if (/(?:bot|strategy|free|download|workspace|xml)/i.test(match[1])) add(match[1]);
  }
  const srcPattern = /<(?:script[^>]+src|link[^>]+href|a[^>]+href)=["']([^"']+)["']/gi;
  for (const match of content.matchAll(srcPattern)) add(match[1], true);
  const mapComment = /[#@]\s*sourceMappingURL[=:]\s*([^\s]+)/gi;
  for (const match of content.matchAll(mapComment)) add(match[1]);

  // Webpack/Rspack keeps lazy application modules in an id -> hash map. A
  // normal HTML fetch only contains the entry bundle, so enumerate these
  // chunks as a browser would; custom Free Bots manifests commonly live in a
  // lazy route chunk rather than the entry bundle.
  const hashMap = new Map();
  const hashPairs = /(?:^|[,\{])(\d+):["']([a-f0-9]{6,})["']/gi;
  for (const match of content.matchAll(hashPairs)) hashMap.set(match[1], match[2]);
  const namePairs = /(?:^|[,\{])(\d+):["']([^"']+)["']/g;
  for (const match of content.matchAll(namePairs)) {
    const hash = hashMap.get(match[1]);
    const name = match[2];
    if (hash && !/^[a-f0-9]{6,}$/i.test(name) && !/[\\/]/.test(name)) {
      add(`/static/js/async/${name}.${hash}.js`, true);
    }
  }
  const runtime = content.slice(content.indexOf('static/js/async/'));
  const maps = [...runtime.matchAll(/\(\{([^{}]+)\}\)\[e\]/g)].map(match => match[1]);
  if (maps.length >= 2) {
    const parseMap = (value) => new Map([...value.matchAll(/(?:^|,)(\d+):["']([^"']+)["']/g)].map(match => [match[1], match[2]]));
    const names = parseMap(maps[0]);
    const hashes = parseMap(maps[1]);
    for (const [id, name] of names) {
      const hash = hashes.get(id);
      if (hash && !/[\\/]/.test(name)) add(`/static/js/async/${name}.${hash}.js`, true, true);
    }
    const contextEntries = /["']([^"']+\.xml)["']:\["[^"']+","(\d+)"\]/g;
    for (const match of content.matchAll(contextEntries)) {
      const sourceName = match[1];
      const chunkId = match[2];
      candidateFiles.add(sourceName.replace(/^\.\//, ''));
      const name = names.get(chunkId);
      const hash = hashes.get(chunkId);
      if (name && hash) add(`/static/js/async/${name}.${hash}.js`, true, true);
    }
  }
}

async function fetchText(url) {
  try {
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
  } catch { return null; }
}

function manifestBotEntries(value, output = []) {
  if (!value || output.length >= MAX_BOTS) return output;
  if (Array.isArray(value)) { for (const item of value) manifestBotEntries(item, output); return output; }
  if (typeof value !== 'object') return output;
  const url = value.xml_url || value.xmlUrl || value.xml || value.download_url || value.downloadUrl;
  if (typeof url === 'string' && /(?:\.xml(?:[?#]|$)|\/api\/asset\/)/i.test(url)) {
    output.push({ url, name: value.name || value.title || value.label || null, category: value.category || value.tab || 'Custom Bots' });
  }
  for (const child of Object.values(value)) manifestBotEntries(child, output);
  return output;
}

async function extractManifestBots(start) {
  const paths = ['/config.json', '/bots.json', '/bot-manifest.json', '/xml/manifest.json', '/assets/bots.json'];
  const found = [], seen = new Set();
  for (const path of paths) {
    const manifest = await fetchText(new URL(path, start.origin).href);
    if (!manifest || !/^\s*[\[{]/.test(manifest.text)) continue;
    let parsed;
    try { parsed = JSON.parse(manifest.text); } catch { continue; }
    for (const entry of manifestBotEntries(parsed)) {
      try {
        const xmlUrl = new URL(entry.url, start.origin).href;
        if (seen.has(xmlUrl)) continue;
        seen.add(xmlUrl);
        const result = await fetchText(xmlUrl);
        if (!result || !isValidBotXml(result.text)) continue;
        const fallback = decodeURIComponent(new URL(xmlUrl).pathname.split('/').pop() || 'Bot.xml').replace(/\.xml$/i, '');
        found.push({ name: normalizeName(entry.name) || nameFromXml(result.text) || normalizeName(fallback), xml: decodeMarkup(result.text).trim(), source: `manifest:${xmlUrl}`, size: result.text.length, fromTab: entry.category });
        if (found.length >= MAX_BOTS) return found;
      } catch {}
    }
  }
  return found;
}

async function runtimeBrowserScan(startUrl) {
  const found = [];
  const seen = new Set();
  let browser;
  try {
    const chromium = (await import('@sparticuz/chromium')).default;
    const puppeteer = await import('puppeteer-core');
    browser = await puppeteer.default.launch({ args: chromium.args, defaultViewport: { width: 1365, height: 900 }, executablePath: await chromium.executablePath(), headless: true });
    const page = await browser.newPage();
    const pending = new Set();
    const inspect = (text, source) => extractXmlDocuments(text, source).forEach(bot => {
      if (!seen.has(bot.xml)) { seen.add(bot.xml); found.push(bot); }
    });
    page.on('response', response => {
      const source = response.url();
      const type = response.headers()['content-type'] || '';
      if (!/xml|json|javascript|text\//i.test(type) && !/\.(?:xml|json|js)(?:[?#]|$)/i.test(source)) return;
      const task = response.text().then(text => inspect(text, source)).catch(() => {}).finally(() => pending.delete(task));
      pending.add(task);
    });
    const routes = ['', '/free-bots', '/trading-bots', '/browse-bots', '/bot-builder', '/dashboard'];
    for (const route of routes) {
      const target = new URL(route, startUrl).href;
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 700));
      const labels = await page.evaluate(() => [...document.querySelectorAll('button,a,[role="tab"]')]
        .map(element => (element.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(text => text && /bot|import|library|strategy|load|free|trading/i.test(text)).slice(0, 30));
      for (const label of labels) {
        await page.evaluate(targetLabel => [...document.querySelectorAll('button,a,[role="tab"]')]
          .find(element => (element.textContent || '').replace(/\s+/g, ' ').trim() === targetLabel)?.click(), label).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    await new Promise(resolve => setTimeout(resolve, 700));
    await Promise.allSettled([...pending]);
    inspect(await page.content(), page.url());
    const browserState = await page.evaluate(async () => {
      const values = [];
      for (const storage of [window.localStorage, window.sessionStorage]) {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key) values.push(`${key}=${storage.getItem(key) || ''}`);
        }
      }
      try {
        const databases = await indexedDB.databases();
        for (const database of databases.slice(0, 10)) {
          if (!database.name) continue;
          await new Promise(resolve => {
            const request = indexedDB.open(database.name);
            request.onerror = () => resolve();
            request.onsuccess = () => {
              const db = request.result;
              const names = [...db.objectStoreNames].slice(0, 20);
              if (!names.length) { db.close(); resolve(); return; }
              let remaining = names.length;
              for (const name of names) {
                try {
                  const get = db.transaction(name, 'readonly').objectStore(name).getAll();
                  get.onsuccess = () => { values.push(`indexeddb:${database.name}/${name}=${JSON.stringify(get.result).slice(0, 500000)}`); if (!--remaining) { db.close(); resolve(); } };
                  get.onerror = () => { if (!--remaining) { db.close(); resolve(); } };
                } catch { if (!--remaining) { db.close(); resolve(); } }
              }
            };
          });
        }
      } catch {}
      return values;
    }).catch(() => []);
    for (const value of browserState) inspect(value, `${page.url()}#browser-storage`);
    await browser.close();
  } catch {
    try { await browser?.close(); } catch {}
  }
  return found;
}

async function fastBundleScan(startUrl) {
  const found = [];
  const seen = new Set();
  const page = await fetchText(startUrl);
  if (!page) return found;
  const entryUrls = new Set();
  const scriptPattern = /(?:src|href)=["']([^"']+\.js(?:[?#][^"']*)?)["']/gi;
  for (const match of page.text.matchAll(scriptPattern)) {
    try { entryUrls.add(new URL(match[1], startUrl).href); } catch {}
  }
  for (const match of page.text.matchAll(/https?:\/\/[^\s"'<>]+\.js(?:[?#][^\s"'<>]*)?/gi)) entryUrls.add(match[0]);
  const entries = [...entryUrls].slice(0, 12);
  const entryResults = await Promise.allSettled(entries.map(async url => ({ url, result: await fetchText(url) })));
  const chunkUrls = new Set();
  for (const item of entryResults) {
    if (item.status !== 'fulfilled' || !item.value.result) continue;
    const { url, result } = item.value;
    for (const bot of extractXmlDocuments(result.text, url)) {
      if (!seen.has(bot.xml)) { seen.add(bot.xml); found.push(bot); }
    }
    const runtime = result.text.slice(Math.max(0, result.text.indexOf('static/js/async/')));
    const maps = [...runtime.matchAll(/\(\{([^{}]+)\}\)\[e\]/g)].map(match => match[1]);
    const parseMap = value => new Map([...value.matchAll(/(?:^|,)(\d+):["']([^"']+)["']/g)].map(match => [match[1], match[2]]));
    const names = maps.length >= 1 ? parseMap(maps[0]) : new Map();
    const hashes = maps.length >= 2 ? parseMap(maps[1]) : new Map();
    // Some Rsbuild builds expose the same mapping in d.u directly instead of
    // the older ({...})[e] runtime form. This is used by BinaryLab/GlobalTrades:
    // d.u=e=>"static/js/async/"+({920:"EVEN_Autobot-(1)-xml"}[e])+"."+
    // ({920:"hash"}[e])+".js".
    const runtimeChunkNames = new Map();
    const runtimeChunkHashes = new Map();
    const chunkNameObject = result.text.match(/(?:d\.u|__webpack_require__\.u)\s*=.*?\(\{([^{}]+)\}\)\[e\]/s)?.[1];
    const chunkHashObjects = [...result.text.matchAll(/\}\)\[e\]\|\|e\)\+"\."\+\(\{([^{}]+)\}\)\[e\]/gs)];
    if (chunkNameObject) {
      for (const [id, name] of parseMap(chunkNameObject)) runtimeChunkNames.set(id, name);
    }
    if (chunkHashObjects[0]) {
      for (const [id, hash] of parseMap(chunkHashObjects[0][1])) runtimeChunkHashes.set(id, hash);
    }
    const addChunkForId = (chunkId) => {
      const name = names.get(chunkId) || runtimeChunkNames.get(chunkId);
      const hash = hashes.get(chunkId) || runtimeChunkHashes.get(chunkId);
      if (name && hash) chunkUrls.add(new URL(`/static/js/async/${name}.${hash}.js`, url).href);
    };
    const contextEntries = /["']([^"']+\.xml)["']:\[["'][^"']+["'],["'](\d+)["']\]/g;
    for (const match of result.text.matchAll(contextEntries)) {
      addChunkForId(match[2]);
    }
    // Also support the compact runtime mapping when the context map is
    // minified differently and the XML filenames are still visible nearby.
    for (const id of new Set([...runtimeChunkNames.keys(), ...runtimeChunkHashes.keys()])) {
      if (result.text.includes(`"${id}"`) || result.text.includes(`:${id}`)) addChunkForId(id);
    }
  }
  const chunks = [...chunkUrls].slice(0, 220);
  for (let offset = 0; offset < chunks.length; offset += 50) {
    const batch = chunks.slice(offset, offset + 50);
    const results = await Promise.allSettled(batch.map(async url => ({ url, result: await fetchText(url) })));
    for (const item of results) {
      if (item.status !== 'fulfilled' || !item.value.result) continue;
      for (const bot of extractXmlDocuments(item.value.result.text, item.value.url)) {
        if (!seen.has(bot.xml)) { seen.add(bot.xml); found.push(bot); }
      }
    }
  }
  return found;
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
  const priorityQueue = new Set();
  const visited = new Set();
  const bots = [];
  const seenXml = new Set();
  const candidateFiles = new Set();
  const candidateDirs = ['/xml/', '/bots/', '/public/xml/', '/assets/xml/', '/static/xml/', '/bot/', '/strategies/', '/files/', '/downloads/', '/'];
  const manifestPaths = ['/config.json', '/bots.json', '/bot-manifest.json', '/xml/manifest.json', '/assets/bots.json', '/public/xml/manifest.json'];
  for (const path of manifestPaths) priorityQueue.add(new URL(path, start.origin).href);
  let spaShells = 0;

  const fastBots = await fastBundleScan(start.href);
  for (const bot of fastBots) {
    if (!seenXml.has(bot.xml)) { seenXml.add(bot.xml); bots.push(bot); }
  }
  if (bots.length) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ count: bots.length, bots, pagesScanned: 1, spaShells: 0, mode: 'webpack-context' });
  }

  const manifestBots = await extractManifestBots(start);
  for (const bot of manifestBots) {
    if (!seenXml.has(bot.xml)) { seenXml.add(bot.xml); bots.push(bot); }
  }
  if (bots.length) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ count: bots.length, bots, pagesScanned: 1, spaShells: 0, mode: 'public-manifest' });
  }

  while ((queue.size || priorityQueue.size) && visited.size < MAX_PAGES && bots.length < MAX_BOTS) {
    const batch = [...priorityQueue, ...queue].filter(url => !visited.has(url)).slice(0, 8);
    if (!batch.length) break;
    batch.forEach(url => { visited.add(url); priorityQueue.delete(url); queue.delete(url); });
    const results = await Promise.allSettled(batch.map(async url => ({ url, result: await fetchText(url) })));
    for (const item of results) {
      if (item.status !== 'fulfilled' || !item.value.result) continue;
      const { url, result } = item.value;
      const { text, type } = result;
      if (/<(?:!doctype\s+html|html)\b/i.test(text) && !/\.xml(?:[?#]|$)/i.test(url)) spaShells++;
      if (/\.map(?:[?#]|$)/i.test(url)) {
        try {
          const sourceMap = JSON.parse(text);
          for (let index = 0; index < (sourceMap.sourcesContent || []).length; index++) {
            const sourceText = sourceMap.sourcesContent[index];
            const sourceName = sourceMap.sources?.[index] || `source-${index}.txt`;
            if (sourceText && /\.xml(?:[?#]|$)/i.test(sourceName)) {
              candidateFiles.add(decodeURIComponent(sourceName.split('/').pop()));
              for (const bot of extractXmlDocuments(sourceText, new URL(sourceName, url).href)) {
                if (!seenXml.has(bot.xml)) { seenXml.add(bot.xml); bots.push(bot); }
              }
            }
          }
        } catch {}
      }
      for (const bot of extractXmlDocuments(text, url)) {
        if (!seenXml.has(bot.xml)) { seenXml.add(bot.xml); bots.push(bot); }
      }
      if (/html|javascript|json|xml|text\//i.test(type) || /\.(?:html?|js|json|xml|map)(?:[?#]|$)/i.test(url)) {
        addReferencedUrls(text, url, queue, targetHost, start.origin, candidateFiles, priorityQueue);
      }
    }
    for (const file of candidateFiles) {
      try { priorityQueue.add(new URL(`/${file}`, start.origin).href); } catch {}
      for (const directory of candidateDirs) {
        if (directory === '/') continue;
        try { priorityQueue.add(new URL(`${directory}${file}`, start.origin).href); } catch {}
      }
    }
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ count: bots.length, bots, pagesScanned: visited.size, spaShells });
}

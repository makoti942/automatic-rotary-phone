import assert from 'node:assert/strict';
import test from 'node:test';
import deepExtractHandler, { extractBinaryLabFreeBots, extractSavewayFreeBots, extractXmlDocuments, isBuiltInBotName, isBuiltInBotSource } from './deep-extract.mjs';

function makeBotXml(name) {
  return `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true">
    <block type="trade_definition"><field name="BOT_NAME">${name}</field></block>
    <block type="purchase"></block>
    <block type="before_purchase"></block>
    <block type="math_number"></block>
    <block type="logic_boolean"></block>
    <block type="text"><field name="TEXT">${'custom-block-'.repeat(50)}</field></block>
  </xml>`;
}

test('filters stock Reverse D’Alembert JavaScript chunks on white-label hosts', () => {
  const source = 'https://legacyprime.live/static/js/async/reverse_dalembert-xml.78606053.js';
  assert.equal(isBuiltInBotSource(source), true);
  assert.deepEqual(extractXmlDocuments(makeBotXml('Reverse D’Alembert'), source), []);
});

test('filters built-in XML files and built-in names embedded in generic bundles', () => {
  assert.equal(isBuiltInBotSource('https://example.org/xml/reverse_dalembert.xml'), true);
  assert.equal(isBuiltInBotName("Reverse D'Alembert Bot"), true);
  assert.deepEqual(extractXmlDocuments(makeBotXml("Reverse D'Alembert"), 'https://example.org/static/js/index.a1b2c3d4.js'), []);
});

test('keeps genuine custom bots, including custom bots whose names reference a stock strategy', () => {
  const source = 'https://example.org/static/js/async/my-reverse-dalembert-system-xml.a1b2c3d4.js';
  const bots = extractXmlDocuments(makeBotXml('My Reverse D’Alembert System'), source);
  assert.equal(bots.length, 1);
  assert.equal(bots[0].name, 'My Reverse D’Alembert System');
});

test('extracts named bots from BinaryLab-style JSON xmlContent fields', () => {
  const payload = {
    mode: 'filtered',
    domain: 'https://binarylab.site',
    bots: [
      { id: 'custom-1', name: 'Nova Switcher', fileName: 'Nova Switcher.xml', xmlContent: makeBotXml('Workspace') },
      { id: 'stock-1', name: "Reverse D'Alembert", fileName: 'reverse_dalembert.xml', xmlContent: makeBotXml('Workspace') },
    ],
  };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const bots = extractXmlDocuments(json, 'https://www.binarylab.site/api/free-bots');
  assert.equal(bots.length, 1);
  assert.equal(bots[0].name, 'Nova Switcher');
  assert.match(bots[0].source, /api\/free-bots/);
  assert.match(bots[0].xml, /^<xml\b/);
});

test('fetches BinaryLab’s public catalog and falls back from the trade host to www', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (url.startsWith('https://trade.binarylab.site/')) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify({
      mode: 'filtered',
      bots: [{ name: 'Nova Switcher', fileName: 'Nova Switcher.xml', xmlContent: makeBotXml('Workspace') }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const bots = await extractBinaryLabFreeBots(new URL('https://trade.binarylab.site/'));
    assert.deepEqual(requests, [
      'https://trade.binarylab.site/api/free-bots',
      'https://www.binarylab.site/api/free-bots',
    ]);
    assert.equal(bots.length, 1);
    assert.equal(bots[0].name, 'Nova Switcher');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetches all publicly listed Saveway Free Bots and skips gated or unrelated entries', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const siteId = 'saveway-site-id';
  const bots = [
    { file_name: 'Public One', file_id: 'file-1', category: 'free', site_ids: [siteId], access_keys: [] },
    { file_name: 'Public Two', file_id: 'file-2', category: 'free', site_ids: [siteId], access_keys: [] },
    { file_name: 'Gated Bot', file_id: 'file-3', category: 'free', site_ids: [siteId], access_keys: ['secret'] },
    { file_name: 'Other Site Bot', file_id: 'file-4', category: 'free', site_ids: ['another-site'], access_keys: [] },
    { file_name: 'Premium Bot', file_id: 'file-5', category: 'premium', site_ids: [siteId], access_keys: [] },
  ];
  globalThis.fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (url === 'https://dforge.site/api/sites/config?domain=saveway.site') {
      return new Response(JSON.stringify({ config: { siteId, botUserId: 'saveway-user-id' } }), { status: 200 });
    }
    if (url.includes('/api/bots/proxy?userId=')) {
      return new Response(JSON.stringify({ success: true, total: bots.length, bots }), { status: 200 });
    }
    const fileId = new URL(url).searchParams.get('fileId');
    if (fileId === 'file-1' || fileId === 'file-2') {
      return new Response(makeBotXml(fileId === 'file-1' ? 'Public One' : 'Public Two'), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  try {
    const extracted = await extractSavewayFreeBots(new URL('https://saveway.site/'));
    assert.deepEqual(extracted.map(bot => bot.name), ['Public One', 'Public Two']);
    assert.ok(extracted.every(bot => bot.fromTab === 'Saveway Free Bots'));
    assert.ok(requests.some(url => url === 'https://dforge.site/api/sites/config?domain=saveway.site'));
    assert.equal(requests.filter(url => new URL(url).searchParams.has('action')).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('continues generic manifest and page crawling after the bundle scan finds a bot', async () => {
  const originalFetch = globalThis.fetch;
  const bundledXml = makeBotXml('Bundle Bot');
  const linkedXml = makeBotXml('Linked Download Bot');
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === 'https://example.test/') {
      return new Response('<!doctype html><html><head><script src="/app.js"></script></head><body><a href="/downloads/linked.xml">Download</a></body></html>', {
        status: 200, headers: { 'Content-Type': 'text/html' },
      });
    }
    if (url === 'https://example.test/app.js') {
      return new Response(`const bot = \`${bundledXml}\`;`, {
        status: 200, headers: { 'Content-Type': 'application/javascript' },
      });
    }
    if (url === 'https://example.test/downloads/linked.xml') {
      return new Response(linkedXml, { status: 200, headers: { 'Content-Type': 'application/xml' } });
    }
    return new Response('not found', { status: 404 });
  };
  const response = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  try {
    await deepExtractHandler({ method: 'POST', body: { url: 'https://example.test/' } }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.bots.map(bot => bot.name).sort(), ['Bundle Bot', 'Linked Download Bot']);
    assert.ok(response.body.strategiesTried.includes('standard JSON/XML manifests'));
    assert.ok(response.body.strategiesTried.includes('site page/API/link crawl'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('tries the known public extraction methods on an unlisted domain and extracts a matching bot', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const customXml = makeBotXml('Unlisted Site Bot');
  globalThis.fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (url === 'https://dforge.site/api/sites/config?domain=unlisted.example') {
      return new Response(JSON.stringify({ config: {} }), { status: 200 });
    }
    if (url === 'https://unlisted.example/xml/apex_ai_v3.xml') {
      return new Response(customXml, { status: 200, headers: { 'Content-Type': 'application/xml' } });
    }
    if (url === 'https://unlisted.example/') {
      return new Response('<!doctype html><html><body>Bot library</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    return new Response('not found', { status: 404 });
  };
  const response = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  try {
    await deepExtractHandler({ method: 'POST', body: { url: 'https://unlisted.example/' } }, response);
    assert.ok(requests.includes('https://dforge.site/api/sites/config?domain=unlisted.example'));
    assert.ok(requests.includes('https://unlisted.example/api/free-bots'));
    assert.ok(requests.includes('https://unlisted.example/xml/apex_ai_v3.xml'));
    assert.ok(response.body.bots.some(bot => bot.name === 'Unlisted Site Bot'));
    assert.ok(response.body.strategiesTried.includes('public catalog/API and product-path probes'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

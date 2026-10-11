import assert from 'node:assert/strict';
import test from 'node:test';
import { extractBinaryLabFreeBots, extractXmlDocuments, isBuiltInBotName, isBuiltInBotSource } from './deep-extract.mjs';

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

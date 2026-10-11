import assert from 'node:assert/strict';
import test from 'node:test';
import { extractXmlDocuments, isBuiltInBotName, isBuiltInBotSource } from './deep-extract.mjs';

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

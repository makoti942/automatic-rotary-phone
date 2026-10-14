import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyBlockTypes, resolveForeignBlockAdapter, registerCompatibilityBlocks, LOCAL_LAST_DIGITS_CONDITION } from '../src/pages/bot-extractor/bot-compatibility.mjs';
import { isLastDigitsConditionMet } from '../src/external/bot-skeleton/services/tradeEngine/utils/last-digits-condition.mjs';

const repo = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, repo), 'utf8');
function extractBlocks(xml, targetType) {
  const blocks = [];
  const starts = [...xml.matchAll(new RegExp(`<block\\b(?=[^>]*\\btype=["']${targetType}["'])[^>]*>`, 'g'))];
  const tags = /<\/?(?:block|shadow)\b[^>]*>/g;
  for (const start of starts) {
    tags.lastIndex = start.index;
    let depth = 0;
    let end = start.index;
    let token;
    while ((token = tags.exec(xml))) {
      const text = token[0];
      if (/^<\//.test(text)) depth--;
      else if (!/\/>$/.test(text)) depth++;
      if (depth === 0) {
        end = tags.lastIndex;
        break;
      }
    }
    const fragment = xml.slice(start.index, end);
    const rootTokens = /<\/?(?:block|shadow|field|value|statement)\b[^>]*>/g;
    rootTokens.lastIndex = 0;
    let nesting = 0;
    const fields = {};
    const inputNames = [];
    let item;
    while ((item = rootTokens.exec(fragment))) {
      const tag = item[0];
      const name = tag.match(/\bname=["']([^"']+)["']/)?.[1];
      const tagType = tag.match(/^<\/?(?:[\w.-]+:)?(block|shadow|field|value|statement)\b/)?.[1];
      if (/^<\//.test(tag)) {
        nesting--;
        continue;
      }
      if (nesting === 1 && tagType === 'field' && name) {
        const fieldStart = item.index + tag.length;
        const close = fragment.indexOf('</field>', fieldStart);
        if (close >= 0) fields[name] = fragment.slice(fieldStart, close).trim();
      }
      if (nesting === 1 && ['value', 'statement'].includes(tagType) && name) inputNames.push(name);
      if (!/\/>$/.test(tag)) nesting++;
    }
    blocks.push({ fragment, fields, inputNames, hasNInput: inputNames.includes('N') });
  }
  return blocks;
}

test('classifies app-native digit and trade blocks as supported', () => {
  const report = classifyBlockTypes(['digit_percentage', 'last_digit', 'digit_percentage'], ['digit_percentage', 'last_digit', 'trade_definition']);
  assert.deepEqual(report.supported, ['digit_percentage', 'last_digit']);
  assert.deepEqual(report.unsupported, []);
  assert.equal(report.canLoadSafely, true);
});

test('keeps unknown site-specific blocks fail-closed', () => {
  const report = classifyBlockTypes(['trade_definition', 'vendor_even_odd_switch', 'vendor_digit_calculator'], ['trade_definition', 'last_digit', 'digit_percentage']);
  assert.deepEqual(report.supported, ['trade_definition']);
  assert.deepEqual(report.unsupported, ['vendor_digit_calculator', 'vendor_even_odd_switch']);
  assert.equal(report.canLoadSafely, false);
});

test('adapts Legoo purchase and notification shapes found in repository XML', () => {
  const purchaseXml = read('public/xml/kingstraders.site/Legoo-sniper-bot.xml');
  const purchase = extractBlocks(purchaseXml, 'traderlegoo_purchase');
  assert.ok(purchase.length > 0);
  for (const block of purchase) assert.equal(resolveForeignBlockAdapter('traderlegoo_purchase', block.fields, true, block.inputNames)?.targetType, 'purchase');

  const noticeXml = read('public/xml/kingstraders.site/Mathews\' speed bot.xml');
  const notices = extractBlocks(noticeXml, 'traderlegoonotify');
  assert.ok(notices.length > 0);
  for (const block of notices) assert.equal(resolveForeignBlockAdapter('traderlegoonotify', block.fields, true, block.inputNames)?.targetType, 'notify');
});

test('adapts only known last-digit predicates with an N value input', () => {
  const xml = read('public/xml/kingstraders.site/Digits Switcher Bot.xml');
  const blocks = extractBlocks(xml, 'last_digits_condition');
  assert.deepEqual(blocks.map(b => b.fields.CONDITION).sort(), ['ALL_EVEN', 'ALL_ODD']);
  for (const block of blocks) assert.equal(resolveForeignBlockAdapter('last_digits_condition', block.fields, block.hasNInput, block.inputNames)?.targetType, LOCAL_LAST_DIGITS_CONDITION);
  assert.equal(resolveForeignBlockAdapter('last_digits_condition', { CONDITION: 'ANY_ODD' }, true, ['N']), null);
  assert.equal(resolveForeignBlockAdapter('last_digits_condition', { CONDITION: 'ALL_ODD' }, false, ['N']), null);
});

test('latest N tick digits must all match the requested parity', () => {
  assert.equal(isLastDigitsConditionMet([2, 4, 7, 1, 9], 'ALL_ODD', 3), true);
  assert.equal(isLastDigitsConditionMet([2, 4, 7, 1, 8], 'ALL_ODD', 3), false);
  assert.equal(isLastDigitsConditionMet([1, 3, 4, 8], 'ALL_EVEN', 2), true);
  assert.equal(isLastDigitsConditionMet([1, 3], 'ALL_EVEN', 3), false);
  assert.equal(isLastDigitsConditionMet([1, 2], 'ALL_ODD', 0), false);
  assert.equal(isLastDigitsConditionMet([1, 2], 'ALL_ODD', 1001), false);
});

test('registers a boolean generator that calls the asynchronous local tick predicate', () => {
  const Blockly = { Blocks: {}, JavaScript: { javascriptGenerator: { forBlock: {}, ORDER_ATOMIC: 0 } } };
  registerCompatibilityBlocks(Blockly);
  const generated = Blockly.JavaScript.javascriptGenerator.forBlock[LOCAL_LAST_DIGITS_CONDITION](
    { getFieldValue: () => 'ALL_EVEN' },
    { valueToCode: () => '3', ORDER_ATOMIC: 0 }
  );
  assert.equal(generated[0], "Bot.checkLastDigits('ALL_EVEN', 3)");
  assert.equal(generated[1], 0);
  assert.equal(typeof Blockly.Blocks[LOCAL_LAST_DIGITS_CONDITION].init, 'function');
});

test('rejects unmapped purchase/notification fields instead of silently defaulting', () => {
  assert.equal(resolveForeignBlockAdapter('traderlegoo_purchase', { PURCHASE_LIST: 'UNKNOWN_CONTRACT' }), null);
  assert.equal(resolveForeignBlockAdapter('traderlegoonotify', { NOTIFICATION_TYPE: 'debug', NOTIFICATION_SOUND: 'alert' }), null);
  assert.equal(resolveForeignBlockAdapter('traderlegoonotify', { NOTIFICATION_TYPE: 'info', NOTIFICATION_SOUND: 'silent' }, true, []), null);
  assert.equal(resolveForeignBlockAdapter('traderlegoo_purchase', { PURCHASE_LIST: 'DIGITOVER' }, true, ['EXTRA']), null);
});

test('returns a safe result for empty XML block lists', () => {
  const report = classifyBlockTypes([], ['last_digit']);
  assert.deepEqual(report, { supported: [], unsupported: [], canLoadSafely: true });
});

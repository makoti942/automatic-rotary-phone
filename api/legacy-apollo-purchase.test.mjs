import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLegacyApolloPurchases } from '../src/pages/bot-extractor/legacy-apollo-purchase.mjs';

const botXml = fields => `<xml is_dbot="true">
  <block type="before_purchase">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="Apollo_purchase" id="legacy">
        <field name="PURCHASE_LIST">DIGITOVER</field>
        ${fields}
        <value name="PREDICTION"><block type="math_number"><field name="NUM">5</field></block></value>
      </block>
    </statement>
  </block>
</xml>`;

test('converts legacy Apollo single-contract purchases into the native Apollo block', () => {
  const result = normalizeLegacyApolloPurchases(botXml(
    '<field name="MULTIPLE_CONTRACTS">FALSE</field><field name="CONTRACT_QUANTITY">1</field>'
  ));
  assert.equal(result.convertedCount, 1);
  assert.match(result.xml, /type="apollo_purchase2"/);
  assert.doesNotMatch(result.xml, /type="Apollo_purchase"/i);
  assert.doesNotMatch(result.xml, /name="(?:MULTIPLE_CONTRACTS|CONTRACT_QUANTITY)"/);
  assert.match(result.xml, /<block type="math_number">/);
  assert.match(result.xml, /<field name="PURCHASE_LIST">DIGITOVER<\/field>/);
});

test('does not rewrite XML without the legacy Apollo purchase type', () => {
  const xml = '<xml><block type="apollo_purchase2"></block></xml>';
  assert.deepEqual(normalizeLegacyApolloPurchases(xml), { xml, convertedCount: 0 });
});

test('refuses legacy multiple-contract behavior instead of silently downgrading it', () => {
  assert.throws(
    () => normalizeLegacyApolloPurchases(botXml(
      '<field name="MULTIPLE_CONTRACTS">TRUE</field><field name="CONTRACT_QUANTITY">1</field>'
    )),
    /multiple contracts or quantity 1.*not supported/i
  );
  assert.throws(
    () => normalizeLegacyApolloPurchases(botXml(
      '<field name="MULTIPLE_CONTRACTS">FALSE</field><field name="CONTRACT_QUANTITY">3</field>'
    )),
    /multiple contracts or quantity 3.*not supported/i
  );
});

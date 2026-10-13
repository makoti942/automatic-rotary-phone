const LEGACY_APOLLO_PURCHASE_TYPE = 'apollo_purchase';

function fieldValue(blockXml, name, fallback) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`<field\\b(?=[^>]*\\bname=["']${escapedName}["'])[^>]*>([^<]*)<\\/field>`, 'i');
  return (blockXml.match(expression)?.[1] ?? fallback).trim();
}

function findLegacyApolloBlocks(xml) {
  const blocks = [];
  const stack = [];
  const tokens = /<\/?block\b[^>]*>/gi;
  let match;

  while ((match = tokens.exec(xml))) {
    const token = match[0];
    const index = match.index;
    if (/^<\//.test(token)) {
      const opening = stack.pop();
      if (!opening) throw new Error('The bot XML has an unmatched Blockly block tag.');
      if (opening.type === LEGACY_APOLLO_PURCHASE_TYPE) {
        blocks.push({ start: opening.start, openEnd: opening.start + opening.tag.length, end: index + token.length });
      }
      continue;
    }

    const type = token.match(/\btype\s*=\s*(["'])(.*?)\1/i)?.[2]?.toLowerCase();
    if (/\/\s*>$/.test(token)) {
      if (type === LEGACY_APOLLO_PURCHASE_TYPE) blocks.push({ start: index, openEnd: index + token.length, end: index + token.length });
      continue;
    }
    stack.push({ start: index, tag: token, type });
  }

  if (stack.length) throw new Error('The bot XML has an unclosed Blockly block tag.');
  return blocks;
}

/**
 * DBTraders and other older bot libraries use `apollo_purchase`. This app's
 * native equivalent is `apollo_purchase2`, but the old block also has optional
 * multiple-contract/quantity settings. Only the default single-contract form
 * can be translated without changing strategy behavior.
 */
export function normalizeLegacyApolloPurchases(xml) {
  const source = String(xml || '');
  const ranges = findLegacyApolloBlocks(source);
  if (!ranges.length) return { xml: source, convertedCount: 0 };

  let normalized = source;
  for (const range of ranges.sort((left, right) => right.start - left.start)) {
    const originalBlock = source.slice(range.start, range.end);
    const contractType = fieldValue(originalBlock, 'PURCHASE_LIST', '');
    const multipleContracts = fieldValue(originalBlock, 'MULTIPLE_CONTRACTS', 'FALSE').toUpperCase();
    const quantityRaw = fieldValue(originalBlock, 'CONTRACT_QUANTITY', '1');
    const quantity = Number(quantityRaw || '1');

    if (!contractType) {
      throw new Error('A legacy Apollo purchase block has no contract type, so it cannot be safely converted.');
    }
    if (multipleContracts !== 'FALSE' || !Number.isInteger(quantity) || quantity !== 1) {
      throw new Error(
        `This bot uses a legacy Apollo purchase configured for multiple contracts or quantity ${quantityRaw}. ` +
          'That setting is not supported here, so the bot was not loaded rather than silently changing its trade behavior.'
      );
    }

    const openingTag = originalBlock.slice(0, range.openEnd - range.start);
    const normalizedOpeningTag = openingTag.replace(/(\btype\s*=\s*["'])apollo_purchase(["'])/i, '$1apollo_purchase2$2');
    const body = originalBlock.slice(openingTag.length, range.end - range.start - '</block>'.length);
    const cleanedBody = body.replace(
      /<field\b(?=[^>]*\bname=["'](?:MULTIPLE_CONTRACTS|CONTRACT_QUANTITY)["'])[^>]*>[\s\S]*?<\/field>/gi,
      ''
    );
    const replacement = `${normalizedOpeningTag}${cleanedBody}</block>`;
    normalized = normalized.slice(0, range.start) + replacement + normalized.slice(range.end);
  }

  return { xml: normalized, convertedCount: ranges.length };
}

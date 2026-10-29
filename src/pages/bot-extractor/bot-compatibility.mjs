/**
 * Safe compatibility adapters for extracted Blockly XML.
 * Unknown blocks are never replaced with placeholders: trading logic must be
 * understood by a registered local block and generator before it is loaded.
 */
export const LOCAL_LAST_DIGITS_CONDITION = 'compat_last_digits_condition';

const PURCHASE_TYPES = new Set([
  'CALL', 'PUT', 'DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD',
  'ONETOUCH', 'NOTOUCH', 'RANGE', 'UPORDOWN', 'EXPIRYMISS', 'EXPIRYRANGE', 'STAYIN', 'STAYOUT',
  'HIGHLOW', 'MULTUP', 'MULTDOWN', 'ACCU', 'CALLSPREAD', 'PUTSPREAD',
]);
const NOTIFICATION_TYPES = new Set(['success', 'warn', 'info']);
const NOTIFICATION_SOUNDS = new Set(['silent']);

export function classifyBlockTypes(blockTypes, availableTypes) {
  const available = availableTypes instanceof Set ? availableTypes : new Set(availableTypes || []);
  const uniqueTypes = [...new Set((blockTypes || []).filter(type => typeof type === 'string' && type.trim()))].sort();
  return {
    supported: uniqueTypes.filter(type => available.has(type)),
    unsupported: uniqueTypes.filter(type => !available.has(type)),
    canLoadSafely: uniqueTypes.every(type => available.has(type)),
  };
}

/** Return a verified target alias, or null when the source shape is unknown. */
export function resolveForeignBlockAdapter(type, fields = {}, hasNInput = true, inputNames = []) {
  if (type === 'traderlegoo_purchase') {
    const purchaseType = String(fields.PURCHASE_LIST || '').trim().toUpperCase();
    const exactFields = Object.keys(fields).length === 1 && Object.hasOwn(fields, 'PURCHASE_LIST');
    return exactFields && inputNames.length === 0 && PURCHASE_TYPES.has(purchaseType)
      ? { targetType: 'purchase', reason: 'native purchase semantics' }
      : null;
  }
  if (type === 'traderlegoonotify') {
    const notificationType = String(fields.NOTIFICATION_TYPE || '').trim().toLowerCase();
    const sound = String(fields.NOTIFICATION_SOUND || '').trim().toLowerCase();
    const fieldNames = Object.keys(fields);
    const hasOnlyKnownFields = fieldNames.every(field => ['NOTIFICATION_TYPE', 'NOTIFICATION_SOUND', 'TEXT', 'VAR'].includes(field));
    const exactFields = hasOnlyKnownFields
      && Object.hasOwn(fields, 'NOTIFICATION_TYPE')
      && Object.hasOwn(fields, 'NOTIFICATION_SOUND');
    if (!exactFields || inputNames.length !== 1 || inputNames[0] !== 'MESSAGE'
      || !NOTIFICATION_TYPES.has(notificationType) || !NOTIFICATION_SOUNDS.has(sound)) return null;
    return { targetType: 'notify', reason: 'native notification fields and runtime' };
  }
  if (type === 'last_digits_condition') {
    const condition = String(fields.CONDITION || '').trim();
    if (Object.keys(fields).length !== 1 || !Object.hasOwn(fields, 'CONDITION')
      || !hasNInput || inputNames.length !== 1 || inputNames[0] !== 'N'
      || !['ALL_ODD', 'ALL_EVEN'].includes(condition)) return null;
    return { targetType: LOCAL_LAST_DIGITS_CONDITION, reason: `verified ${condition} predicate` };
  }
  return null;
}

function localName(node) {
  return node.localName || node.nodeName.split(':').pop();
}

function getDirectFieldValues(blockNode) {
  const fields = {};
  for (const child of Array.from(blockNode.children || [])) {
    if (localName(child) === 'field' && child.getAttribute('name')) {
      fields[child.getAttribute('name')] = (child.textContent || '').trim();
    }
  }
  return fields;
}

function getDirectInputNames(blockNode) {
  return Array.from(blockNode.children || [])
    .filter(child => ['value', 'statement'].includes(localName(child)))
    .map(child => child.getAttribute('name'));
}

/**
 * Convert only known foreign block shapes before checking local registration.
 * The caller should retain the original XML and report adapter names to users.
 */
export function adaptForeignBlocks(xml, Parser = globalThis.DOMParser, Serializer = globalThis.XMLSerializer) {
  if (typeof Parser !== 'function') throw new Error('XML parsing is not available in this environment.');
  const document = new Parser().parseFromString(String(xml || ''), 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('The bot contains malformed XML.');

  const adaptations = [];
  const rejectedAdapters = [];
  for (const node of Array.from(document.querySelectorAll('block[type], shadow[type]'))) {
    const sourceType = node.getAttribute('type');
    if (!['traderlegoo_purchase', 'traderlegoonotify', 'last_digits_condition'].includes(sourceType)) continue;
    const hasNInput = Array.from(node.children || []).some(child =>
      localName(child) === 'value' && child.getAttribute('name') === 'N'
    );
    const decision = resolveForeignBlockAdapter(sourceType, getDirectFieldValues(node), hasNInput, getDirectInputNames(node));
    if (!decision) {
      rejectedAdapters.push(sourceType);
      continue;
    }
    node.setAttribute('type', decision.targetType);
    if (sourceType === 'traderlegoonotify') {
      Array.from(node.children || [])
        .filter(child => localName(child) === 'field' && ['TEXT', 'VAR'].includes(child.getAttribute('name')))
        .forEach(field => field.remove());
    }
    adaptations.push({ from: sourceType, to: decision.targetType, reason: decision.reason });
  }

  const normalizedXml = typeof Serializer === 'function'
    ? new Serializer().serializeToString(document)
    : String(xml || '');
  return { xml: normalizedXml, adaptations, rejectedAdapters: [...new Set(rejectedAdapters)].sort() };
}

export function analyzeBotCompatibility(xml, availableTypes, Parser = globalThis.DOMParser) {
  if (typeof Parser !== 'function') throw new Error('XML parsing is not available in this environment.');
  const document = new Parser().parseFromString(String(xml || ''), 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('The bot contains malformed XML.');
  const blockTypes = [...document.querySelectorAll('block[type], shadow[type]')]
    .map(node => node.getAttribute('type'))
    .filter(Boolean);
  return classifyBlockTypes(blockTypes, availableTypes);
}

/** Register the local boolean block and its runnable generator on the app Blockly instance. */
export function registerCompatibilityBlocks(Blockly) {
  if (!Blockly?.Blocks || !Blockly?.JavaScript?.javascriptGenerator) {
    throw new Error('Blockly block and generator registries are not available.');
  }
  // Free Bots can be mounted after Blockly's cached block modules have already
  // been evaluated. In that case the native root block may be absent from the
  // active registry even though it is required by every trading bot XML.
  if (!Blockly.Blocks.before_purchase) {
    Blockly.Blocks.before_purchase = {
      init() {
        this.jsonInit({
          message0: '%1 %2 %3',
          message1: '%1',
          message2: '%1',
          args0: [
            { type: 'field_label', text: '2. Purchase conditions' },
            { type: 'input_dummy' },
            { type: 'input_dummy' },
          ],
          args1: [{ type: 'input_statement', name: 'BEFOREPURCHASE_STACK', check: 'Purchase' }],
          args2: [{ type: 'input_dummy' }],
          colour: Blockly.Colours?.RootBlock?.colour,
          colourSecondary: Blockly.Colours?.RootBlock?.colourSecondary,
          colourTertiary: Blockly.Colours?.RootBlock?.colourTertiary,
        });
        this.setDeletable(false);
      },
    };
  }
  if (!Blockly.JavaScript.javascriptGenerator.forBlock.before_purchase) {
    Blockly.JavaScript.javascriptGenerator.forBlock.before_purchase = block => {
      const stack = Blockly.JavaScript.javascriptGenerator.statementToCode(block, 'BEFOREPURCHASE_STACK');
      return `BinaryBotPrivateBeforePurchase = function BinaryBotPrivateBeforePurchase() {\n${stack}};\n`;
    };
  }
  if (!Blockly.Blocks[LOCAL_LAST_DIGITS_CONDITION]) {
    Blockly.Blocks[LOCAL_LAST_DIGITS_CONDITION] = {
      init() {
        this.jsonInit({
          message0: 'all of the last %1 digits are %2',
          args0: [
            { type: 'input_value', name: 'N', check: 'Number' },
            { type: 'field_dropdown', name: 'CONDITION', options: [['odd', 'ALL_ODD'], ['even', 'ALL_EVEN']] },
          ],
          output: 'Boolean',
          colour: 210,
          tooltip: 'Checks whether each of the latest N tick digits is odd or even.',
        });
      },
    };
  }
  const generator = Blockly.JavaScript.javascriptGenerator;
  generator.forBlock[LOCAL_LAST_DIGITS_CONDITION] = (block, codeGenerator) => {
    const count = codeGenerator.valueToCode(block, 'N', codeGenerator.ORDER_ATOMIC) || '0';
    const condition = block.getFieldValue('CONDITION');
    return [`Bot.checkLastDigits('${condition}', ${count})`, codeGenerator.ORDER_ATOMIC];
  };
}

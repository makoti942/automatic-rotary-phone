import { localize } from '@deriv-com/translations';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.hedging = {
    init() {
        this.jsonInit(this.definition());
        this.setPreviousStatement(true, 'Purchase');
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Hedging: first purchase %1'),
            message1: localize('second purchase %1'),
            args0: [{ type: 'input_statement', name: 'FIRST_PURCHASE', check: 'Purchase' }],
            args1: [{ type: 'input_statement', name: 'SECOND_PURCHASE', check: 'Purchase' }],
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('Purchase the two connected contracts at the same time.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Hedging'),
            description: localize('Connect two Purchase blocks. Both contracts are submitted in parallel when the bot reaches this block.'),
            key_words: localize('hedge, parallel, two purchases'),
        };
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
};

const getPurchaseType = (block, inputName) => {
    const purchase = block.getInputTargetBlock(inputName);
    return purchase?.type === 'purchase' ? purchase.getFieldValue('PURCHASE_LIST') : '';
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.hedging = block => {
    const first = getPurchaseType(block, 'FIRST_PURCHASE');
    const second = getPurchaseType(block, 'SECOND_PURCHASE');
    if (!first || !second) return '';
    return `Bot.hedgePurchase(${JSON.stringify([first, second])});\n`;
};

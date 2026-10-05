import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

const ApolloPurchase = {
    init() {
        // Start with the native purchase block so contract options and its
        // market/trade-type onchange behavior remain fully supported.
        window.Blockly.Blocks.purchase.init.call(this);
        this.appendValueInput('PREDICTION').setCheck('Number').appendField(localize('prediction'));
        this.setTooltip(localize('Purchase a contract, with an optional prediction/barrier.'));
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.Blocks.apollo_purchase2 = ApolloPurchase;
window.Blockly.JavaScript.javascriptGenerator.forBlock.apollo_purchase2 = block => {
    const purchaseList = block.getFieldValue('PURCHASE_LIST');
    const prediction = window.Blockly.JavaScript.javascriptGenerator.valueToCode(
        block,
        'PREDICTION',
        window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
    );
    return `Bot.purchase('${purchaseList}'${prediction ? `, ${prediction}` : ''});\n`;
};

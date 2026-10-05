import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

const ApolloPurchase = {
    init() {
        // Use the native purchase schema and lifecycle. Calling purchase.init
        // directly would lose its `definition()` method because Blockly binds
        // the definition object to the new block type.
        this.jsonInit(this.definition());
        this.setNextStatement(false);
        this.updatePredictionInput();
        this.setTooltip(localize('Purchase a contract, with an optional prediction/barrier.'));
    },
    definition() {
        return window.Blockly.Blocks.purchase.definition();
    },
    updatePredictionInput() {
        const purchaseType = this.getFieldValue('PURCHASE_LIST');
        const needsPrediction = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(purchaseType);
        const hasPrediction = !!this.getInput('PREDICTION');
        if (needsPrediction && !hasPrediction) {
            this.appendValueInput('PREDICTION').setCheck('Number').appendField(localize('prediction'));
        } else if (!needsPrediction && hasPrediction) {
            this.removeInput('PREDICTION', true);
        }
    },
    onchange(event) {
        window.Blockly.Blocks.purchase?.onchange?.call(this, event);
        this.updatePredictionInput();
    },
    populatePurchaseList: window.Blockly.Blocks.purchase.populatePurchaseList,
    customContextMenu: window.Blockly.Blocks.purchase.customContextMenu,
    restricted_parents: ['before_purchase'],
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

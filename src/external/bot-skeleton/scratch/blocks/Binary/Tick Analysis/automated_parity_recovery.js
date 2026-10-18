import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

const baseStyle = () => ({
    colour: window.Blockly.Colours.Base.colour,
    colourSecondary: window.Blockly.Colours.Base.colourSecondary,
    colourTertiary: window.Blockly.Colours.Base.colourTertiary,
    category: window.Blockly.Categories.Tick_Analysis,
});

window.Blockly.Blocks.automated_parity_recovery_purchase = {
    init() {
        this.jsonInit({
            message0: localize('Automated even/odd recovery purchase'),
            previousStatement: null,
            ...baseStyle(),
            tooltip: localize('Scans volatility indices, waits for the parity reversal pattern, and purchases the selected parity.'),
        });
    },
    meta() {
        return {
            display_name: localize('Automated even/odd recovery purchase'),
            description: localize('Fast parity recovery: scan 200 ticks across all available volatility indices, use the latest 100 for selection, wait for three opposite digits and a confirmation digit, then trade the selected parity.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.Blocks.automated_parity_recovery_update = {
    init() {
        this.jsonInit({
            message0: localize('Update automated recovery with profit %1 and stake %2'),
            args0: [
                { type: 'input_value', name: 'PROFIT', check: 'Number' },
                { type: 'input_value', name: 'STAKE', check: 'Number' },
            ],
            previousStatement: null,
            ...baseStyle(),
            tooltip: localize('Updates accumulated losses and recalculates the exact recovery stake after settlement.'),
        });
    },
    meta() {
        return {
            display_name: localize('Update automated recovery'),
            description: localize('Adds losses to the recovery pool, clears the pool only after all losses are recovered, and returns to normal trading.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.automated_parity_recovery_purchase = () =>
    'Bot.automatedParityRecoveryPurchase();\n';

window.Blockly.JavaScript.javascriptGenerator.forBlock.automated_parity_recovery_update = block => {
    const profit = window.Blockly.JavaScript.javascriptGenerator.valueToCode(
        block,
        'PROFIT',
        window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
    ) || '0';
    const stake = window.Blockly.JavaScript.javascriptGenerator.valueToCode(
        block,
        'STAKE',
        window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
    ) || '0';
    return `Bot.automatedParityRecoveryUpdate(${profit}, ${stake});\n`;
};

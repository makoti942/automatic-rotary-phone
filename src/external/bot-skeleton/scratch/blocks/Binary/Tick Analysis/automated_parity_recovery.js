import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

const baseStyle = () => ({
    colour: window.Blockly.Colours.Base.colour,
    colourSecondary: window.Blockly.Colours.Base.colourSecondary,
    colourTertiary: window.Blockly.Colours.Base.colourTertiary,
    category: window.Blockly.Categories.Tick_Analysis,
});

window.Blockly.Blocks.automated_parity_status = {
    init() {
        this.jsonInit({
            message0: localize('Show automated recovery status'),
            previousStatement: null,
            nextStatement: null,
            ...baseStyle(),
            tooltip: localize('Shows the current symbol, last digit, even/odd percentages, and recovery state in the Journal.'),
        });
    },
    meta() {
        return {
            display_name: localize('Show automated recovery status'),
            description: localize('Displays live normal-entry and recovery status in the Journal.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.Blocks.automated_trade_purchase = {
    init() {
        this.jsonInit({
            message0: localize('Automated Under 7/8 or even/odd recovery'),
            previousStatement: 'Purchase',
            ...baseStyle(),
            tooltip: localize('Runs Under 7 on the first normal trade, Under 8 afterward, and parity recovery after a loss.'),
        });
        this.setNextStatement(false);
    },
    meta() {
        return {
            display_name: localize('Automated Under/Parity Purchase'),
            description: localize('A registered purchase block that preserves the Under 7/8 prediction flow and enters even/odd recovery after a loss.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
    restricted_parents: ['before_purchase'],
};

window.Blockly.Blocks.automated_parity_recovery_purchase = {
    init() {
        this.jsonInit({
            message0: localize('Automated Under or even/odd recovery purchase'),
            previousStatement: null,
            ...baseStyle(),
            tooltip: localize('Trades Under during normal mode and switches to parity only after a recorded loss.'),
        });
    },
    meta() {
        return {
            display_name: localize('Automated Under or parity recovery purchase'),
            description: localize('Uses the original Under entry trade with parity recovery after losses.'),
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

window.Blockly.JavaScript.javascriptGenerator.forBlock.automated_parity_status = () =>
    'Bot.automatedParityRecoveryStatus();\n';

window.Blockly.JavaScript.javascriptGenerator.forBlock.automated_trade_purchase = () =>
    'Bot.automatedTradePurchase();\n';

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

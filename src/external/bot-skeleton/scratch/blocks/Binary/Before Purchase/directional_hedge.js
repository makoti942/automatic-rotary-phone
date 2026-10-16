import { localize } from '@deriv-com/translations';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

const stakeField = (name, value) => ({
    type: 'field_number',
    name,
    value,
    min: 0.01,
    precision: 0.01,
});

window.Blockly.Blocks.directional_contract_automation = {
    init() {
        this.jsonInit(this.definition());
        this.setPreviousStatement(true, 'Purchase');
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('After 2 consecutive rising movements: Fall (1 tick) stake %1; Only Ups (2 ticks) stake %2'),
            args0: [stakeField('RISE_TO_FALL_STAKE', 1), stakeField('RISE_TO_ONLY_UPS_STAKE', 1)],
            message1: localize('If the first Fall loses, retry Fall (1 tick) stake %1'),
            args1: [stakeField('RISE_FALL_RETRY_STAKE', 1)],
            message2: localize('After 2 consecutive falling movements: Only Downs (2 ticks) stake %1; Rise (1 tick) stake %2'),
            args2: [stakeField('FALL_TO_ONLY_DOWNS_STAKE', 1), stakeField('FALL_TO_RISE_STAKE', 1)],
            message3: localize('If the first Rise loses, retry Rise (1 tick) stake %1'),
            args3: [stakeField('FALL_RISE_RETRY_STAKE', 1)],
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize(
                'Wait for two consecutive tick-to-tick movements in one direction. Rising sequence: buy Fall for 1 tick and Only Ups for 2 ticks; if Fall loses on the next tick, immediately submit another 1-tick Fall. Falling sequence: buy Only Downs for 2 ticks and Rise for 1 tick; if Rise loses on the next tick, immediately submit another 1-tick Rise.'
            ),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Only Downs / Fall directional automation'),
            description: localize(
                'Runs the two-movement directional strategy. The stakes for both contracts and their one-time loss retries are independently configurable.'
            ),
            key_words: localize('direction, two movements, fall, only downs, only ups, rise, parallel'),
        };
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.directional_contract_automation = block => {
    const positiveStake = fieldName => Math.max(0.01, Number(block.getFieldValue(fieldName)) || 1);
    const settings = {
        riseToFallStake: positiveStake('RISE_TO_FALL_STAKE'),
        riseToOnlyUpsStake: positiveStake('RISE_TO_ONLY_UPS_STAKE'),
        riseFallRetryStake: positiveStake('RISE_FALL_RETRY_STAKE'),
        fallToOnlyDownsStake: positiveStake('FALL_TO_ONLY_DOWNS_STAKE'),
        fallToRiseStake: positiveStake('FALL_TO_RISE_STAKE'),
        fallRiseRetryStake: positiveStake('FALL_RISE_RETRY_STAKE'),
    };

    return `Bot.directionalHedgePurchase(${JSON.stringify(settings)});\n`;
};

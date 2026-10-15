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
            message0: localize('After 3 rising ticks: Fall stake %1; Only Downs stake %2'),
            args0: [stakeField('RISE_TO_FALL_STAKE', 1), stakeField('RISE_TO_ONLY_DOWNS_STAKE', 1)],
            message1: localize('After 3 falling ticks: Only Ups stake %1; Rise stake %2'),
            args1: [stakeField('FALL_TO_ONLY_UPS_STAKE', 1), stakeField('FALL_TO_RISE_STAKE', 1)],
            message2: localize('If the first Rise loses, retry Rise once with stake %1'),
            args2: [stakeField('RISE_RETRY_STAKE', 1)],
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize(
                'Wait for three consecutive tick movements in one direction. A rising sequence buys Fall and Only Downs (2 ticks). A falling sequence buys Only Ups (2 ticks) and Rise (1 tick); if the first Rise loses, buy one additional Rise immediately.'
            ),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Only Downs / Fall directional automation'),
            description: localize(
                'Runs the custom three-movement directional strategy. Each contract stake, including the single Rise retry stake, can be configured independently.'
            ),
            key_words: localize('direction, three ticks, fall, only downs, only ups, rise, parallel'),
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
        riseToOnlyDownsStake: positiveStake('RISE_TO_ONLY_DOWNS_STAKE'),
        fallToOnlyUpsStake: positiveStake('FALL_TO_ONLY_UPS_STAKE'),
        fallToRiseStake: positiveStake('FALL_TO_RISE_STAKE'),
        riseRetryStake: positiveStake('RISE_RETRY_STAKE'),
    };

    return `Bot.directionalHedgePurchase(${JSON.stringify(settings)});\n`;
};

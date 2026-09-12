import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../../utils';

window.Blockly.Blocks.bulk_trade = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Bulk Trade {{ enabled }} Count: {{ count }}', {
                enabled: '%1',
                count: '%2',
            }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'BULK_ENABLED',
                    options: [
                        [localize('ON'), 'TRUE'],
                        [localize('OFF'), 'FALSE'],
                    ],
                },
                {
                    type: 'field_number',
                    name: 'BULK_COUNT',
                    value: 1,
                    min: 1,
                    max: 100,
                    precision: 1,
                },
            ],
            colour: window.Blockly.Colours.Special3.colour,
            colourSecondary: window.Blockly.Colours.Special3.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special3.colourTertiary,
            previousStatement: null,
            nextStatement: null,
            tooltip: localize('Execute multiple identical trades simultaneously. All trades share the same entry and exit spots.'),
            category: window.Blockly.Categories.Miscellaneous,
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
    meta() {
        return {
            display_name: localize('Bulk Trade'),
            description: localize(
                'When enabled, every purchase will execute multiple trades at once. All trades share the same entry/exit spots and contract type. Useful for scaling into a position.'
            ),
        };
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.bulk_trade = block => {
    const enabled = block.getFieldValue('BULK_ENABLED') === 'TRUE';
    const count = block.getFieldValue('BULK_COUNT') || 1;

    const code = `Bot.setBulkTrade({ enabled: ${enabled}, count: ${count} });\n`;
    return code;
};

import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.digit_percentage = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Digit %1 percentage'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'DIGIT',
                    options: Array.from({ length: 10 }, (_, digit) => [String(digit), String(digit)]),
                },
            ],
            output: 'Number',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize(
                'Returns the current percentage for this digit from the Manual Trade tab’s selected symbol and recent tick sample.'
            ),
            category: window.Blockly.Categories.Tick_Analysis,
        };
    },
    meta() {
        return {
            display_name: localize('Digit percentage'),
            description: localize(
                'Returns the percentage displayed for the selected digit in Manual Trade, using its current sample of up to 1,000 ticks.'
            ),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.digit_percentage = block => [
    `Bot.getDigitPercentage(${Number(block.getFieldValue('DIGIT'))})`,
    window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC,
];

import { modifyContextMenu } from '../../../utils';

const optionField = () => new window.Blockly.FieldTextInput('');

window.Blockly.Blocks.variables_is_option = {
    init() {
        this.appendDummyInput()
            .appendField('is')
            .appendField(new window.Blockly.FieldVariable('item'), 'VAR')
            .appendField('option')
            .appendField(optionField(), 'OPTION');
        this.setOutput(true, 'Boolean');
        this.setColour(window.Blockly.Colours?.Special2?.colour || 330);
        this.setTooltip('Checks whether a variable contains the selected option.');
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.Blocks.variables_set_option = {
    init() {
        this.appendDummyInput()
            .appendField('set')
            .appendField(new window.Blockly.FieldVariable('item'), 'VAR')
            .appendField('to option')
            .appendField(optionField(), 'OPTION');
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(window.Blockly.Colours?.Special2?.colour || 330);
        this.setTooltip('Sets a variable to the selected option.');
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

const variableName = block => window.Blockly.JavaScript.variableDB_.getName(
    block.getFieldValue('VAR'),
    window.Blockly.Variables.CATEGORY_NAME
);

window.Blockly.JavaScript.javascriptGenerator.forBlock.variables_is_option = block => [
    `${variableName(block)} === ${JSON.stringify(block.getFieldValue('OPTION') || '')}`,
    window.Blockly.JavaScript.javascriptGenerator.ORDER_EQUALITY,
];

window.Blockly.JavaScript.javascriptGenerator.forBlock.variables_set_option = block =>
    `${variableName(block)} = ${JSON.stringify(block.getFieldValue('OPTION') || '')};\n`;

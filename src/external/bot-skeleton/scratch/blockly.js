import * as BlocklyJavaScript from 'blockly/javascript';
import { localize } from '@deriv-com/translations';
import { setColors } from './hooks/colours.js';
import goog from './goog.js';

window.goog = goog;

const modifyBlocklyWorkSpaceContextMenu = () => {
    const exclude_item = ['blockInline'];
    exclude_item.forEach(item_id => {
        const option = window.Blockly.ContextMenuRegistry.registry.getItem(item_id);
        option.preconditionFn = () => 'hidden';
    });

    const items_to_localize = {
        undoWorkspace: localize('Undo'),
        redoWorkspace: localize('Redo'),
        cleanWorkspace: localize('Clean up Blocks'),
        collapseWorkspace: localize('Collapse Blocks'),
        expandWorkspace: localize('Expand Blocks'),
        workspaceDelete: localize('Delete All Blocks'),
    };

    Object.keys(items_to_localize).forEach(item_id => {
        const option = window.Blockly.ContextMenuRegistry.registry.getItem(item_id);
        option.displayText = localize(items_to_localize[item_id]);
    });
};

export const loadBlockly = async isDarkMode => {
    const BlocklyModule = await import('blockly');
    // Keep the existing Blockly singleton when the Bot Builder is mounted again.
    // Replacing it while the block modules are cached leaves the new registry
    // without the definitions that those modules registered on the first mount.
    window.Blockly = window.Blockly || BlocklyModule.default;
    window.Blockly.Colours = {};
    const BlocklyGenerator = new window.Blockly.Generator('code');
    const BlocklyJavaScriptGenerator = {
        ...BlocklyJavaScript,
        ...BlocklyGenerator,
    };
    window.Blockly.JavaScript = BlocklyJavaScriptGenerator;
    window.Blockly.Themes.zelos_renderer = window.Blockly.Theme.defineTheme('zelos_renderer', {
        base: window.Blockly.Themes.Zelos,
        componentStyles: {},
    });
    modifyBlocklyWorkSpaceContextMenu();
    setColors(isDarkMode);
    await import('./hooks/index.js');
    await import('./blocks');

    // before_purchase is mandatory in the default strategy. Some navigation
    // paths can reuse a cached blocks module after the workspace is recreated,
    // so restore the definition before any XML is deserialized.
    if (!window.Blockly.Blocks.before_purchase) {
        window.Blockly.Blocks.before_purchase = {
            init() {
                this.jsonInit({
                    message0: '%1 %2 %3',
                    message1: '%1',
                    message2: '%1',
                    args0: [
                        { type: 'field_label', text: '2. Purchase conditions' },
                        { type: 'input_dummy' },
                        { type: 'input_dummy' },
                    ],
                    args1: [{ type: 'input_statement', name: 'BEFOREPURCHASE_STACK', check: 'Purchase' }],
                    args2: [{ type: 'input_dummy' }],
                    colour: window.Blockly.Colours.RootBlock?.colour,
                    colourSecondary: window.Blockly.Colours.RootBlock?.colourSecondary,
                    colourTertiary: window.Blockly.Colours.RootBlock?.colourTertiary,
                });
                this.setDeletable(false);
            },
        };
    }

    if (!window.Blockly.JavaScript.javascriptGenerator.forBlock.before_purchase) {
        window.Blockly.JavaScript.javascriptGenerator.forBlock.before_purchase = block => {
            const stack = window.Blockly.JavaScript.javascriptGenerator.statementToCode(
                block,
                'BEFOREPURCHASE_STACK'
            );
            return `BinaryBotPrivateBeforePurchase = function BinaryBotPrivateBeforePurchase() {\n${stack}};\n`;
        };
    }
};

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './blockly-ios-prompt.scss';

/**
 * Replaces Blockly's native field editor with an iOS-style bottom-sheet.
 *
 * Root cause of the keyboard-flash bug:
 *   On mobile, Blockly's showEditor_ creates a real <input> DOM element —
 *   it does NOT call window.prompt. Wrapping showEditor_ and still calling
 *   orig() opens that native input (keyboard flash), then it disappears.
 *
 * Fix:
 *   Completely REPLACE showEditor_ (never call orig) so no native input
 *   is ever created. We capture field + current value and call our sheet
 *   via a stable global callback registered by this component.
 */

// ── Module-level state shared with the Blockly patch ─────────────
let _activeField: any = null;

// The React component registers this so the patch can trigger our UI.
// Using a plain object avoids stale-closure issues.
const _bridge = { show: (_label: string, _val: string) => {} };

// Patch is applied once and remembered across HMR re-mounts
let _patched = false;

function applyBlocklyPatch() {
    if (_patched) return;
    const B = (window as any).Blockly;
    if (!B) { setTimeout(applyBlocklyPatch, 500); return; }
    _patched = true;

    const replaceEditor = (FieldCtor: any, label: string) => {
        if (!FieldCtor?.prototype) return;

        // Store the original so the desktop path (non-touch) still works
        const orig = FieldCtor.prototype.showEditor_;

        FieldCtor.prototype.showEditor_ = function (e?: Event) {
            // On desktop let Blockly do its own thing (inline editor)
            const isTouch = e instanceof TouchEvent ||
                (e as any)?.pointerType === 'touch' ||
                (e as any)?.sourceCapabilities?.firesTouchEvents === true ||
                ('ontouchstart' in window && window.matchMedia('(pointer: coarse)').matches);

            if (!isTouch) {
                // Desktop: use original behaviour
                if (orig) orig.call(this, e);
                return;
            }

            // Mobile: intercept — never open the native input
            _activeField = this;
            const current = String(this.getValue() ?? '');
            _bridge.show(label, current);
        };
    };

    replaceEditor(B.FieldNumber,    'Number');
    replaceEditor(B.FieldTextInput, 'Text');
    replaceEditor(B.FieldAngle,     'Angle');
}

// ── React component ───────────────────────────────────────────────
const BlocklyIOSPrompt: React.FC = () => {
    const [visible, setVisible]   = useState(false);
    const [inputVal, setInputVal] = useState('');
    const [label, setLabel]       = useState('Value');
    const inputRef                = useRef<HTMLInputElement>(null);

    const show = useCallback((lbl: string, val: string) => {
        setLabel(lbl);
        setInputVal(val);
        setVisible(true);
        // Focus after sheet animates in
        setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        }, 180);
    }, []);

    const hide = useCallback(() => {
        setVisible(false);
        _activeField = null;
    }, []);

    const confirm = useCallback(() => {
        if (_activeField) {
            try {
                const num = parseFloat(inputVal);
                _activeField.setValue(isNaN(num) ? inputVal : num);
            } catch (_) { /* ignore */ }
        }
        hide();
    }, [inputVal, hide]);

    // Register the bridge callback so the Blockly patch can reach us
    useEffect(() => {
        _bridge.show = show;
        return () => { _bridge.show = () => {}; };
    }, [show]);

    // Apply patch (safe to call multiple times — guarded by _patched flag)
    useEffect(() => {
        applyBlocklyPatch();
    }, []);

    if (!visible) return null;

    return createPortal(
        <div className='bip-backdrop' onPointerDown={hide}>
            <div
                className='bip-sheet'
                onPointerDown={e => e.stopPropagation()}
            >
                <div className='bip-handle' />

                <div className='bip-header'>
                    <span className='bip-title'>Edit {label}</span>
                </div>

                <input
                    ref={inputRef}
                    className='bip-input'
                    type='number'
                    inputMode='decimal'
                    value={inputVal}
                    onChange={e => setInputVal(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter')  confirm();
                        if (e.key === 'Escape') hide();
                    }}
                />

                <div className='bip-actions'>
                    <button className='bip-btn bip-btn--cancel'  onPointerDown={hide}>Cancel</button>
                    <button className='bip-btn bip-btn--confirm' onPointerDown={confirm}>Done</button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default BlocklyIOSPrompt;

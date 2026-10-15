import { isPurchaseBlock } from '../workspace';

describe('isPurchaseBlock', () => {
    it('recognizes the directional automation as a purchase action', () => {
        expect(isPurchaseBlock({ type: 'directional_contract_automation' })).toBeTruthy();
    });

    it('continues to recognize the standard and supported custom purchase blocks', () => {
        expect(isPurchaseBlock({ type: 'purchase' })).toBeTruthy();
        expect(isPurchaseBlock({ type: 'apollo_purchase2' })).toBeTruthy();
        expect(isPurchaseBlock({ getField: name => (name === 'PURCHASE_LIST' ? {} : null) })).toBeTruthy();
    });

    it('does not classify unrelated blocks as purchase actions', () => {
        expect(isPurchaseBlock({ type: 'controls_if' })).toBeFalsy();
        expect(isPurchaseBlock(null)).toBeFalsy();
    });
});

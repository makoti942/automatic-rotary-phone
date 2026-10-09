import { getEqualIndicatorHeightRatio } from '../equal-indicator-layout';

describe('getEqualIndicatorHeightRatio', () => {
    it('splits chart height equally between the price pane and each indicator', () => {
        expect(getEqualIndicatorHeightRatio(900, 2)).toEqual({ height: 300, percent: 1 / 3 });
    });

    it('keeps small chart panes equal rather than reserving a fixed price-chart height', () => {
        expect(getEqualIndicatorHeightRatio(360, 1)).toEqual({ height: 180, percent: 0.5 });
    });

    it('lets indicators use the full chart area when the price pane is hidden', () => {
        expect(getEqualIndicatorHeightRatio(310, 1, false)).toEqual({ height: 310, percent: 1 });
    });

    it('safely handles an empty chart height and indicator count', () => {
        expect(getEqualIndicatorHeightRatio(0, 0)).toEqual({ height: 0, percent: 0 });
    });
});

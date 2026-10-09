export type TIndicatorHeightRatio = {
    height: number;
    percent: number;
};

/**
 * SmartCharts asks for the height of each indicator pane. Split the available
 * chart height across the price pane and all indicators, or let indicators use
 * the full area when the price pane is intentionally hidden.
 */
export const getEqualIndicatorHeightRatio = (
    chartHeight: number,
    indicatorCount: number,
    includePricePane = true
): TIndicatorHeightRatio => {
    const availableHeight = Math.max(0, Math.floor(chartHeight));
    const count = Math.max(0, Math.floor(Number(indicatorCount) || 0));
    const paneCount = Math.max(1, count + (includePricePane ? 1 : 0));
    const height = Math.floor(availableHeight / paneCount);

    return {
        height,
        percent: availableHeight > 0 ? height / availableHeight : 0,
    };
};

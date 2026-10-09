import { useEffect, useId, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { SmartChart, TGranularity, TStateChangeListener } from '@deriv-com/smartcharts-champion';
import { useDevice } from '@deriv-com/ui';
import { useSmartChartAdaptor } from '@/hooks/useSmartChartAdaptor';
import { useStore } from '@/hooks/useStore';
import chart_api from '@/external/bot-skeleton/services/api/chart-api';
import ToolbarWidgets from '@/pages/chart/toolbar-widgets';
import { observeChartPanelLayout } from '@/pages/chart/chart-panel-layout';
import '@deriv-com/smartcharts-champion/dist/smartcharts.css';

interface ManualRiseFallChartProps {
    symbol: string;
}

const ManualRiseFallChart = observer(({ symbol }: ManualRiseFallChartProps) => {
    const { common, ui, chart_store } = useStore();
    const { isDesktop, isMobile } = useDevice();
    const { chartData, getQuotes, subscribeQuotes, unsubscribeQuotes } = useSmartChartAdaptor();
    const chartInstanceId = useId().replace(/:/g, '');
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const [chartType, setChartType] = useState('candles');
    const [granularity, setGranularity] = useState(60);
    const [macdOnly, setMacdOnly] = useState(false);
    const [hasMacd, setHasMacd] = useState(false);

    useEffect(() => () => {
        chart_api.api?.forgetAll('ticks');
    }, []);

    // Detect the active MACD panel, not the indicator picker or any arbitrary second panel.
    useEffect(() => {
        const root = chartContainerRef.current;
        if (!root) return;

        const checkMacd = () => {
            const panels = Array.from(root.querySelectorAll<HTMLElement>('.stx-panel'));
            const macdPanel = panels.find(panel => {
                const panelInfo = [panel.id, panel.className, panel.getAttribute('data-name'), panel.textContent]
                    .join(' ');
                return /macd/i.test(panelInfo);
            });

            panels.forEach(panel => {
                panel.classList.toggle('mt-chart-panel--macd-target', panel === macdPanel);
                panel.classList.toggle('mt-chart-panel--hidden', !!macdPanel && panel !== macdPanel);
            });
            setHasMacd(!!macdPanel);
        };
        return observeChartPanelLayout(root, checkMacd);
    }, [symbol]);

    // Auto-switch to MACD-only when MACD is added (user wants chart to disappear, MACD takes its place)
    useEffect(() => {
        if (hasMacd && !macdOnly) {
            setMacdOnly(true);
        } else if (!hasMacd && macdOnly) {
            setMacdOnly(false);
        }
    }, [hasMacd, macdOnly]);

    // Keep MACD when volatility (symbol) changes — don't remount chart (key is stable, not per-symbol)
    // So MACD study persists across symbol changes

    const handleStateChange: TStateChangeListener = () => {};
    const isReady = chartData.activeSymbols.length > 0 && !!chart_api.api;

    return (
        <div ref={chartContainerRef} className={`mt-mini-chart ${macdOnly ? 'mt-mini-chart--macd-only' : ''}`} dir='ltr'>
            <div className='mt-mini-chart__header'>
                <span>Rise / Fall price action</span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {hasMacd && (
                        <button
                            type='button'
                            className={`mt-mini-chart__macd-toggle ${macdOnly ? 'is-active' : ''}`}
                            onClick={() => setMacdOnly(v => !v)}
                            title={macdOnly ? 'Show chart again' : 'Hide chart, show MACD full'}
                        >
                            {macdOnly ? 'Show Chart' : 'Show MACD only'}
                        </button>
                    )}
                    <span className='mt-mini-chart__hint'>Use the chart controls to zoom and change interval</span>
                </div>
            </div>
            {!isReady ? (
                <div className='mt-mini-chart__loading'>Loading candles…</div>
            ) : (
                <div className='mt-mini-chart__surface'>
                <SmartChart
                    id={`manual-rise-fall-${chartInstanceId}`}
                    key='manual-rise-fall-chart'
                    barriers={[]}
                    showLastDigitStats={false}
                    chartControlsWidgets={null}
                    enabledChartFooter={false}
                    stateChangeListener={handleStateChange}
                    toolbarWidget={() => (
                        <ToolbarWidgets
                            updateChartType={setChartType}
                            updateGranularity={setGranularity}
                            position='top'
                            isDesktop={isDesktop}
                        />
                    )}
                    chartType={chartType}
                    isMobile={isMobile}
                    enabledNavigationWidget={isDesktop}
                    granularity={granularity as TGranularity}
                    getQuotes={getQuotes}
                    subscribeQuotes={subscribeQuotes}
                    unsubscribeQuotes={unsubscribeQuotes}
                    chartData={{ activeSymbols: chartData.activeSymbols, tradingTimes: chartData.tradingTimes }}
                    settings={{
                        assetInformation: false,
                        countdown: true,
                        isHighestLowestMarkerEnabled: false,
                        language: common.current_language.toLowerCase(),
                        position: 'bottom',
                        theme: ui.is_dark_mode_on ? 'dark' : 'light',
                    }}
                    symbol={symbol}
                    topWidgets={() => null}
                    isConnectionOpened={!!chart_api.api}
                    getMarketsOrder={chart_store.getMarketsOrder}
                    isLive
                    leftMargin={55}
                />
                </div>
            )}
        </div>
    );
});

export default ManualRiseFallChart;

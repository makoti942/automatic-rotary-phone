import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { SmartChart, TGranularity, TStateChangeListener } from '@deriv-com/smartcharts-champion';
import { useDevice } from '@deriv-com/ui';
import { useSmartChartAdaptor } from '@/hooks/useSmartChartAdaptor';
import { useStore } from '@/hooks/useStore';
import chart_api from '@/external/bot-skeleton/services/api/chart-api';
import { getEqualIndicatorHeightRatio } from '@/pages/chart/equal-indicator-layout';
import ToolbarWidgets from '@/pages/chart/toolbar-widgets';
import '@deriv-com/smartcharts-champion/dist/smartcharts.css';

interface ManualRiseFallChartProps {
    symbol: string;
}

const ManualRiseFallChart = observer(({ symbol }: ManualRiseFallChartProps) => {
    const { common, ui, chart_store } = useStore();
    const { isDesktop, isMobile } = useDevice();
    const { chartData, getQuotes, subscribeQuotes, unsubscribeQuotes } = useSmartChartAdaptor();
    const macdStudyCount = useRef(0);
    const [chartType, setChartType] = useState('candles');
    const [granularity, setGranularity] = useState(60);
    const [macdOnly, setMacdOnly] = useState(false);
    const [hasMacd, setHasMacd] = useState(false);

    useEffect(() => () => {
        chart_api.api?.forgetAll('ticks');
    }, []);

    // SmartCharts reports indicator add/remove events with the study's actual ID.
    const handleStateChange: TStateChangeListener = (state, option) => {
        const isMacd = /macd/i.test(option?.indicator_type_name ?? '');

        if (state === 'INDICATOR_ADDED' && isMacd) {
            macdStudyCount.current += 1;
            setHasMacd(true);
            setMacdOnly(true);
        } else if (state === 'INDICATOR_DELETED' && isMacd) {
            macdStudyCount.current = Math.max(0, macdStudyCount.current - 1);
            const stillHasMacd = macdStudyCount.current > 0;
            setHasMacd(stillHasMacd);
            if (!stillHasMacd) setMacdOnly(false);
        } else if (state === 'INDICATORS_CLEAR_ALL') {
            macdStudyCount.current = 0;
            setHasMacd(false);
            setMacdOnly(false);
        }
    };

    const isReady = chartData.activeSymbols.length > 0 && !!chart_api.api;

    return (
        <div className={`mt-mini-chart ${macdOnly ? 'mt-mini-chart--macd-only' : ''}`} dir='ltr'>
            <div className='mt-mini-chart__header'>
                <span>Rise / Fall price action</span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {hasMacd && (
                        <button
                            type='button'
                            className={`mt-mini-chart__macd-toggle ${macdOnly ? 'is-active' : ''}`}
                            onClick={() => setMacdOnly(value => !value)}
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
                        id='dbot-manual-rise-fall'
                        key='dbot-manual-rise-fall'
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
                        getIndicatorHeightRatio={(chartHeight, indicatorCount) =>
                            getEqualIndicatorHeightRatio(
                                chartHeight,
                                indicatorCount,
                                !(macdOnly && hasMacd)
                            )
                        }
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

import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { SmartChart, TGranularity, TStateChangeListener } from '@deriv-com/smartcharts-champion';
import { useDevice } from '@deriv-com/ui';
import { useSmartChartAdaptor } from '@/hooks/useSmartChartAdaptor';
import { useStore } from '@/hooks/useStore';
import chart_api from '@/external/bot-skeleton/services/api/chart-api';
import ToolbarWidgets from '@/pages/chart/toolbar-widgets';
import '@deriv-com/smartcharts-champion/dist/smartcharts.css';

interface ManualRiseFallChartProps {
    symbol: string;
}

const ManualRiseFallChart = observer(({ symbol }: ManualRiseFallChartProps) => {
    const { common, ui, chart_store } = useStore();
    const { isDesktop, isMobile } = useDevice();
    const { chartData, getQuotes, subscribeQuotes, unsubscribeQuotes } = useSmartChartAdaptor();
    const [chartType, setChartType] = useState('candles');
    const [granularity, setGranularity] = useState(60);

    useEffect(() => () => {
        chart_api.api?.forgetAll('ticks');
    }, []);

    const handleStateChange: TStateChangeListener = () => {};
    const isReady = chartData.activeSymbols.length > 0 && !!chart_api.api;

    return (
        <div className='mt-mini-chart' dir='ltr'>
            <div className='mt-mini-chart__header'>
                <span>Rise / Fall price action</span>
                <span className='mt-mini-chart__hint'>Use the chart controls to zoom and change interval</span>
            </div>
            {!isReady ? (
                <div className='mt-mini-chart__loading'>Loading candles…</div>
            ) : (
                <div className='mt-mini-chart__surface'>
                <SmartChart
                    id={`manual-rise-fall-${symbol}`}
                    key={`manual-rise-fall-${symbol}`}
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

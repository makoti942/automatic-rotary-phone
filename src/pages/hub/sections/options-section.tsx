import { useState } from 'react';
import useHubBalance from '../use-hub-balance';
import { MARKETS } from '../mock-data';
import { ResetIcon, TradeIcon } from '../sidebar/icons';
import MarketCard from '../components/market-card';
import MockTradeTicket from '../components/mock-trade-ticket';
import TotalValueCard from '../components/total-value-card';
import './options-section.scss';

const OptionsSection = () => {
    const hub = useHubBalance();
    const [showTradeTicket, setShowTradeTicket] = useState(false);
    const [selectedMarket, setSelectedMarket] = useState(MARKETS[4]);
    const [toast, setToast] = useState<string | null>(null);

    const handleTrade = (market: (typeof MARKETS)[number]) => {
        setSelectedMarket(market);
        setShowTradeTicket(true);
    };

    const handleResetBalance = () => {
        try {
            localStorage.removeItem('trick_fake_balance');
            localStorage.removeItem('sandbox_balance');
            window.dispatchEvent(new CustomEvent('trick_fixed_balance'));
            window.dispatchEvent(new CustomEvent('sandbox_state_changed', { detail: { isSandbox: false, sandboxBalance: 0 } }));
            setToast('Balance reset successful');
            hub.refresh();
        } catch {
            setToast('Failed to reset balance');
        }
        window.setTimeout(() => setToast(null), 3000);
    };

    return (
        <div className='hub-options'>
            <TotalValueCard
                totalValue={hub.totalValue}
                currency={hub.activeCurrency}
                selectedView={hub.selectedView}
                onSelectView={hub.setSelectedView}
                variant='options'
            />

            <div className='hub-options__actions'>
                <button
                    type='button'
                    className='hub-options__action-btn hub-options__action-btn--trade'
                    onClick={() => handleTrade(MARKETS[4])}
                >
                    <TradeIcon />
                </button>
                <button
                    type='button'
                    className='hub-options__action-btn hub-options__action-btn--reset'
                    onClick={handleResetBalance}
                >
                    <ResetIcon />
                </button>
            </div>

            <section className='hub-options__section'>
                <h3 className='hub-options__section-title'>Most traded markets</h3>
                <div className='hub-options__markets'>
                    {MARKETS.map(market => (
                        <MarketCard key={market.symbol} {...market} onClick={() => handleTrade(market)} />
                    ))}
                </div>
            </section>

            {showTradeTicket && (
                <div className='hub-options__trade-modal' onClick={() => setShowTradeTicket(false)}>
                    <div className='hub-options__trade-modal-content' onClick={e => e.stopPropagation()}>
                        <button type='button' className='hub-options__trade-close' onClick={() => setShowTradeTicket(false)}>
                            ×
                        </button>
                        <MockTradeTicket marketName={selectedMarket.name} />
                    </div>
                </div>
            )}

            {toast && <div className='hub-options__toast'>{toast}</div>}
        </div>
    );
};

export default OptionsSection;

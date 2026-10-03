import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useHubBalance from '../use-hub-balance';
import { MARKETS, PROMO_SLIDES } from '../mock-data';
import MarketCard from '../components/market-card';
import MockTradeTicket from '../components/mock-trade-ticket';
import PromoBanner from '../components/promo-banner';
import TotalValueCard from '../components/total-value-card';
import './options-section.scss';

const OptionsSection = () => {
    const navigate = useNavigate();
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
                isTrickActive={hub.isTrickActive}
                isSandboxActive={hub.isSandboxActive}
                variant='options'
            />

            <div className='hub-options__actions'>
                <button type='button' className='hub-options__action-btn hub-options__action-btn--trade' onClick={() => handleTrade(MARKETS[4])}>
                    <span className='hub-options__action-icon'>
                        <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <polyline points='23 6 13.5 15.5 8.5 10.5 1 18' />
                            <polyline points='17 6 23 6 23 12' />
                        </svg>
                    </span>
                    <span>Trade</span>
                </button>
                <button type='button' className='hub-options__action-btn hub-options__action-btn--reset' onClick={handleResetBalance}>
                    <span className='hub-options__action-icon'>
                        <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <polyline points='1 4 1 10 7 10' />
                            <path d='M3.51 15a9 9 0 102.13-9.36L1 10' />
                        </svg>
                    </span>
                    <span>Reset balance</span>
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

            <section className='hub-options__section'>
                <PromoBanner {...PROMO_SLIDES[1]} />
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

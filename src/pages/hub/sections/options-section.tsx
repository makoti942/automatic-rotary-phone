import { useState } from 'react';
import useHubBalance from '../use-hub-balance';
import { MARKETS, PLATFORMS, TRADE_TYPES } from '../mock-data';
import MarketCard from '../components/market-card';
import MockTradeTicket from '../components/mock-trade-ticket';
import TotalValueCard from '../components/total-value-card';
import './options-section.scss';

const PlatformIcon = ({ code, color }: { code: string; color: string }) => (
    <span className='hub-options__platform-icon' style={{ background: color }}>
        <span className='hub-options__platform-code'>{code}</span>
    </span>
);

const TradeTypeIcon = ({ index }: { index: number }) => {
    const icons = [
        <svg key='0' width='32' height='32' viewBox='0 0 32 32' fill='none'><path d='M6 22L16 6L26 22' stroke='#ff444f' strokeWidth='2.5' strokeLinecap='round' /><path d='M22 6L26 10L22 14' stroke='#ff444f' strokeWidth='2' strokeLinecap='round' /></svg>,
        <svg key='1' width='32' height='32' viewBox='0 0 32 32' fill='none'><path d='M6 16H26' stroke='#888' strokeWidth='2' /><path d='M10 10L16 16L22 10' stroke='#ff444f' strokeWidth='2.5' strokeLinecap='round' /><path d='M10 22L16 16L22 22' stroke='#ff444f' strokeWidth='2.5' strokeLinecap='round' /></svg>,
        <svg key='2' width='32' height='32' viewBox='0 0 32 32' fill='none'><path d='M8 8L16 16L8 24' stroke='#ff444f' strokeWidth='2.5' strokeLinecap='round' /><path d='M24 8L16 16L24 24' stroke='#888' strokeWidth='2.5' strokeLinecap='round' /></svg>,
        <svg key='3' width='32' height='32' viewBox='0 0 32 32' fill='none'><rect x='6' y='6' width='8' height='8' rx='1' fill='#ff444f' /><rect x='18' y='6' width='8' height='8' rx='1' fill='#888' /><rect x='6' y='18' width='8' height='8' rx='1' fill='#888' /><rect x='18' y='18' width='8' height='8' rx='1' fill='#ff444f' /></svg>,
        <svg key='4' width='32' height='32' viewBox='0 0 32 32' fill='none'><path d='M6 20L12 12L18 18L26 8' stroke='#ff444f' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' /></svg>,
        <svg key='5' width='32' height='32' viewBox='0 0 32 32' fill='none'><path d='M6 10L16 20L26 10' stroke='#ff444f' strokeWidth='2.5' strokeLinecap='round' /><line x1='6' y1='22' x2='26' y2='22' stroke='#888' strokeWidth='2' /></svg>,
        <svg key='6' width='32' height='32' viewBox='0 0 32 32' fill='none'><path d='M8 24L16 8L24 24' stroke='#ff444f' strokeWidth='2.5' strokeLinecap='round' /><path d='M12 18H20' stroke='#888' strokeWidth='2' /></svg>,
        <svg key='7' width='32' height='32' viewBox='0 0 32 32' fill='none'><path d='M8 16H24' stroke='#ff444f' strokeWidth='2.5' /><circle cx='16' cy='16' r='4' stroke='#888' strokeWidth='2' /></svg>,
        <svg key='8' width='32' height='32' viewBox='0 0 32 32' fill='none'><path d='M8 8H24V24H8Z' stroke='#ff444f' strokeWidth='2.5' /><path d='M12 16H20' stroke='#888' strokeWidth='2' /></svg>,
        <svg key='9' width='32' height='32' viewBox='0 0 32 32' fill='none'><path d='M6 22L16 6L26 22' stroke='#ff444f' strokeWidth='2.5' strokeLinecap='round' /><path d='M10 16H22' stroke='#888' strokeWidth='2' /></svg>,
    ];
    return <>{icons[index % icons.length]}</>;
};

const OptionsSection = () => {
    const hub = useHubBalance();
    const [showTradeTicket, setShowTradeTicket] = useState(false);
    const [selectedMarket, setSelectedMarket] = useState(MARKETS[0]);
    const [toast, setToast] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState('Deriv Trader');

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
                onReset={handleResetBalance}
                variant='options'
            />

            <section className='hub-options__section'>
                <h3 className='hub-options__section-title'>Most traded markets</h3>
                <div className='hub-options__markets'>
                    {MARKETS.slice(0, 4).map(market => (
                        <MarketCard key={market.symbol} {...market} onClick={() => handleTrade(market)} />
                    ))}
                    <button type='button' className='hub-options__markets-more' onClick={() => handleTrade(MARKETS[0])}>
                        <svg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <line x1='5' y1='12' x2='19' y2='12' />
                            <polyline points='12 5 19 12 12 19' />
                        </svg>
                    </button>
                </div>
            </section>

            <section className='hub-options__section'>
                <h3 className='hub-options__section-title'>Platforms</h3>
                <div className='hub-options__platforms'>
                    {PLATFORMS.map(platform => (
                        <div key={platform.code} className='hub-options__platform-card'>
                            <PlatformIcon code={platform.code} color={platform.color} />
                            <div className='hub-options__platform-info'>
                                <p className='hub-options__platform-name'>{platform.name}</p>
                                <p className='hub-options__platform-desc'>{platform.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className='hub-options__section'>
                <h3 className='hub-options__section-title'>Trade types</h3>
                <div className='hub-options__tabs'>
                    {['Deriv Trader', 'Deriv Bot', 'SmartTrader'].map(tab => (
                        <button
                            key={tab}
                            type='button'
                            className={`hub-options__tab${activeTab === tab ? ' hub-options__tab--active' : ''}`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
                <div className='hub-options__trade-types'>
                    {TRADE_TYPES.map((type, i) => (
                        <button key={type.name} type='button' className='hub-options__trade-type-card' onClick={() => handleTrade(MARKETS[0])}>
                            <TradeTypeIcon index={i} />
                            <span className='hub-options__trade-type-name'>{type.name}</span>
                        </button>
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

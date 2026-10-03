import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useHubBalance from '../use-hub-balance';
import { MARKETS, PLATFORMS, TRADE_TYPES } from '../mock-data';
import MarketCard from '../components/market-card';
import MockTradeTicket from '../components/mock-trade-ticket';
import TotalValueCard from '../components/total-value-card';
import { TradeTypeIcons } from '../sidebar/icons';
import './options-section.scss';

const PlatformIcon = ({ code, color }: { code: string; color: string }) => (
    <span className='hub-options__platform-icon' style={{ background: color }}>
        <span className='hub-options__platform-code'>{code}</span>
    </span>
);

const OptionsSection = () => {
    const hub = useHubBalance();
    const navigate = useNavigate();
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
                onTransfer={() => navigate('/dashboard/transfer')}
                onRefresh={hub.refresh}
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
                    {TRADE_TYPES.map(type => (
                        <button key={type.name} type='button' className='hub-options__trade-type-card' onClick={() => handleTrade(MARKETS[0])}>
                            <span className='hub-options__trade-type-icon'>
                                {TradeTypeIcons[type.name]}
                            </span>
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

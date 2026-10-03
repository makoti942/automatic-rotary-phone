import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useHubBalance from '../use-hub-balance';
import { MARKETS, MOCK_POSITIONS, PROMO_SLIDES, formatBalance } from '../mock-data';
import MarketCard from '../components/market-card';
import PromoBanner from '../components/promo-banner';
import TotalValueCard from '../components/total-value-card';
import TradingAccountCard from '../components/trading-account-card';
import './home-section.scss';

const HomeSection = () => {
    const navigate = useNavigate();
    const hub = useHubBalance();
    const [showTradeTicket, setShowTradeTicket] = useState(false);
    const [selectedMarket, setSelectedMarket] = useState(MARKETS[4]);

    const handleTrade = (market: (typeof MARKETS)[number]) => {
        setSelectedMarket(market);
        setShowTradeTicket(true);
    };

    return (
        <div className='hub-home'>
            <TotalValueCard
                totalValue={hub.totalValue}
                currency={hub.activeCurrency}
                selectedView={hub.selectedView}
                onSelectView={hub.setSelectedView}
                isTrickActive={hub.isTrickActive}
                isSandboxActive={hub.isSandboxActive}
            />

            <section className='hub-home__section'>
                <h3 className='hub-home__section-title'>My trading accounts</h3>
                <div className='hub-home__accounts'>
                    <TradingAccountCard
                        title='Real account'
                        loginid={hub.activeLoginid || 'CR0000000'}
                        balance={hub.realDemoBalance}
                        currency={hub.activeCurrency}
                        isReal
                        isActive={hub.selectedView === 'real'}
                        onClick={() => hub.setSelectedView('real')}
                    />
                    <TradingAccountCard
                        title='Demo account'
                        loginid={hub.activeLoginid || 'VRTC000000'}
                        balance={hub.isSandboxActive ? hub.sandboxBalance : hub.trickBalance}
                        currency={hub.activeCurrency}
                        isActive={hub.selectedView === 'demo'}
                        onClick={() => hub.setSelectedView('demo')}
                    />
                    <button type='button' className='hub-home__add-account'>
                        <span className='hub-home__add-icon'>+</span>
                        <span>Add more accounts</span>
                    </button>
                </div>
            </section>

            <section className='hub-home__section'>
                <div className='hub-home__promo'>
                    <PromoBanner {...PROMO_SLIDES[0]} />
                </div>
            </section>

            <section className='hub-home__section'>
                <div className='hub-home__markets-header'>
                    <h3 className='hub-home__section-title'>Most traded markets</h3>
                    <button type='button' className='hub-home__view-all' onClick={() => navigate('/dashboard/options')}>
                        View all
                    </button>
                </div>
                <div className='hub-home__markets'>
                    {MARKETS.slice(0, 4).map(market => (
                        <MarketCard key={market.symbol} {...market} onClick={() => handleTrade(market)} />
                    ))}
                </div>
            </section>

            {showTradeTicket && (
                <div className='hub-home__trade-modal' onClick={() => setShowTradeTicket(false)}>
                    <div className='hub-home__trade-modal-content' onClick={e => e.stopPropagation()}>
                        <button type='button' className='hub-home__trade-close' onClick={() => setShowTradeTicket(false)}>
                            ×
                        </button>
                        <div className='hub-home__trade-ticket'>
                            <h3 className='hub-home__trade-title'>Trade — {selectedMarket.name}</h3>
                            <div className='hub-home__trade-fields'>
                                <div className='hub-home__trade-field'>
                                    <label>Contract</label>
                                    <div className='hub-home__trade-toggle'>
                                        <button type='button' className='hub-home__trade-btn hub-home__trade-btn--rise hub-home__trade-btn--active'>
                                            Rise
                                        </button>
                                        <button type='button' className='hub-home__trade-btn hub-home__trade-btn--fall'>
                                            Fall
                                        </button>
                                    </div>
                                </div>
                                <div className='hub-home__trade-field'>
                                    <label>Duration</label>
                                    <select className='hub-home__trade-select' defaultValue='5 ticks'>
                                        <option>5 ticks</option>
                                        <option>10 ticks</option>
                                        <option>1 min</option>
                                    </select>
                                </div>
                                <div className='hub-home__trade-field'>
                                    <label>Stake (USD)</label>
                                    <input type='number' className='hub-home__trade-input' defaultValue='10.00' min='0.35' step='0.01' />
                                </div>
                                <div className='hub-home__trade-payout'>
                                    <span>Payout</span>
                                    <span className='hub-home__trade-payout-value'>~$19.50</span>
                                </div>
                                <button type='button' className='hub-home__trade-purchase' onClick={() => setShowTradeTicket(false)}>
                                    Purchase
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default HomeSection;

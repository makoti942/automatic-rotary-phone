import { useNavigate } from 'react-router-dom';
import useHubBalance from '../use-hub-balance';
import { MARKETS, PROMO_SLIDES } from '../mock-data';
import MarketCard from '../components/market-card';
import PromoBanner from '../components/promo-banner';
import TotalValueCard from '../components/total-value-card';
import TradingAccountCard from '../components/trading-account-card';
import './home-section.scss';

const MT5_BALANCE = 0;
const DXN_BALANCE = 0;

const HomeSection = () => {
    const navigate = useNavigate();
    const hub = useHubBalance();

    return (
        <div className='hub-home'>
            <TotalValueCard
                totalValue={hub.totalValue}
                currency={hub.activeCurrency}
                onRefresh={hub.refresh}
                variant='home'
            />

            <section className='hub-home__section'>
                <h3 className='hub-home__section-title'>My trading accounts</h3>
                <div className='hub-home__accounts'>
                    <TradingAccountCard
                        title='CFDs | Standard'
                        balance={MT5_BALANCE}
                        currency='USD'
                        iconType='mt5'
                    />
                    <TradingAccountCard
                        title='Options'
                        balance={hub.selectedView === 'real' ? hub.realDemoBalance : hub.isSandboxActive ? hub.sandboxBalance : hub.trickBalance}
                        currency={hub.activeCurrency}
                        iconType='options'
                        isActive
                    />
                    <TradingAccountCard
                        title='Crypto'
                        balance={DXN_BALANCE}
                        currency='USDT'
                        iconType='dxn'
                    />
                    <button type='button' className='hub-home__add-account'>
                        <span className='hub-home__add-icon'>
                            <svg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                                <circle cx='12' cy='12' r='10' />
                                <line x1='12' y1='8' x2='12' y2='16' />
                                <line x1='8' y1='12' x2='16' y2='12' />
                            </svg>
                        </span>
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
                        <MarketCard key={market.symbol} {...market} onClick={() => navigate('/dashboard/options')} />
                    ))}
                </div>
            </section>
        </div>
    );
};

export default HomeSection;

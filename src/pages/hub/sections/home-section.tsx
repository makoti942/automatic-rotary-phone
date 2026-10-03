import { useNavigate } from 'react-router-dom';
import useHubBalance from '../use-hub-balance';
import { MARKETS, PROMO_SLIDES } from '../mock-data';
import MarketCard from '../components/market-card';
import PromoBanner from '../components/promo-banner';
import TotalValueCard from '../components/total-value-card';
import TradingAccountCard from '../components/trading-account-card';
import './home-section.scss';

const MT5_BALANCE = 10000;
const DXN_BALANCE = 1250;

const HomeSection = () => {
    const navigate = useNavigate();
    const hub = useHubBalance();

    return (
        <div className='hub-home'>
            <TotalValueCard
                totalValue={hub.totalValue}
                currency={hub.activeCurrency}
                selectedView={hub.selectedView}
                onSelectView={hub.setSelectedView}
            />

            <section className='hub-home__section'>
                <h3 className='hub-home__section-title'>My trading accounts</h3>
                <div className='hub-home__accounts'>
                    <TradingAccountCard
                        title='Options'
                        loginid={hub.activeLoginid || 'CR0000000'}
                        balance={hub.selectedView === 'real' ? hub.realDemoBalance : hub.isSandboxActive ? hub.sandboxBalance : hub.trickBalance}
                        currency={hub.activeCurrency}
                        isActive
                    />
                    <TradingAccountCard
                        title='MT5 Standard'
                        loginid='MT51234567'
                        balance={MT5_BALANCE}
                        currency='USD'
                    />
                    <TradingAccountCard
                        title='DXN'
                        loginid='DXN1234567'
                        balance={DXN_BALANCE}
                        currency='USD'
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
                        <MarketCard key={market.symbol} {...market} onClick={() => navigate('/dashboard/options')} />
                    ))}
                </div>
            </section>
        </div>
    );
};

export default HomeSection;

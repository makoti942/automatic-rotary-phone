import { useLocation, useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import './menu-items.scss';

type TTopNavItem = {
    key: string;
    label: string;
    tab?: number;
    path?: string;
};

const NAV_ITEMS: TTopNavItem[] = [
    { key: 'dashboard', label: 'Dashboard', tab: DBOT_TABS.DASHBOARD },
    { key: 'bot-builder', label: 'Bot Builder', tab: DBOT_TABS.BOT_BUILDER },
    { key: 'charts', label: 'Charts', tab: DBOT_TABS.CHART },
    { key: 'trading-bots', label: 'Trading Bots', tab: DBOT_TABS.TRADING_BOTS },
    { key: 'analysis', label: 'Analysis', tab: DBOT_TABS.ANALYSIS },
    { key: 'manual-trade', label: 'Manual Trade', tab: DBOT_TABS.MANUAL_TRADE },
    { key: 'trading-view', label: 'Trading View', tab: DBOT_TABS.TRADING_VIEW },
    { key: 'copy-trading', label: 'Copy Trading', tab: DBOT_TABS.COPY_TRADING },
    { key: 'bot-extractor', label: 'Bot Extractor', tab: DBOT_TABS.BOT_EXTRACTOR },
];

const MenuItems = observer(() => {
    const navigate = useNavigate();
    const location = useLocation();
    const store = useStore();
    const isBotRoute =
        location.pathname === '/' || location.pathname === '/preview' || location.pathname.startsWith('/bot');
    const activeTab = store?.dashboard?.active_tab;

    const handleClick = (item: TTopNavItem) => {
        if (!isBotRoute) {
            navigate('/');
        }
        if (typeof item.tab === 'number') {
            try {
                store?.dashboard?.setActiveTab(item.tab);
            } catch {}
        } else if (item.path) {
            navigate(item.path);
        }
    };

    const isActive = (item: TTopNavItem) => {
        if (!isBotRoute || typeof item.tab !== 'number') return false;
        return activeTab === item.tab;
    };

    return (
        <nav className='makoti-topnav' aria-label='Primary'>
            {NAV_ITEMS.map(item => (
                <button
                    key={item.key}
                    type='button'
                    className={`makoti-topnav__item${isActive(item) ? ' makoti-topnav__item--active' : ''}`}
                    onClick={() => handleClick(item)}
                >
                    {item.label}
                </button>
            ))}
        </nav>
    );
});

export const TradershubLink = observer(() => null);

type MenuItemsType = typeof MenuItems & {
    TradershubLink: typeof TradershubLink;
};

(MenuItems as MenuItemsType).TradershubLink = TradershubLink;

export default MenuItems as MenuItemsType;

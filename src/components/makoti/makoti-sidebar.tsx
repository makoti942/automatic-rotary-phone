import { useLocation, useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import './makoti-sidebar.scss';

type TSidebarLink = {
    key: string;
    label: string;
    path?: string;
    tab?: number;
    icon: React.ReactNode;
};

const icon = (path: string) => (
    <svg
        width='20'
        height='20'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.8'
        strokeLinecap='round'
        strokeLinejoin='round'
    >
        <path d={path} />
    </svg>
);

const LINKS: TSidebarLink[] = [
    {
        key: 'home',
        label: 'Home',
        path: '/',
        icon: icon('M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1V10.5z'),
    },
    {
        key: 'bots',
        label: 'Bots',
        tab: DBOT_TABS.TRADING_BOTS,
        icon: icon('M12 8V4H8M8 8h8v8H8zM4 12h4v8H4zM16 12h4v8h-4z'),
    },
    {
        key: 'strategies',
        label: 'Strategies',
        tab: DBOT_TABS.BOT_BUILDER,
        icon: icon('M12 3l2.5 5.5L20 10l-4.5 3.5L17 20l-5-3-5 3 1.5-6.5L4 10l5.5-1.5L12 3z'),
    },
    {
        key: 'settings',
        label: 'Settings',
        path: '/bot',
        icon: icon(
            'M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2v.2a2 2 0 11-4 0v-.1a1.7 1.7 0 00-3-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H3a2 2 0 110-4h.2a1.7 1.7 0 001.2-3l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 002.9-1.2V3a2 2 0 114 0v.2a1.7 1.7 0 003 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 001.2 2.9h.2a2 2 0 110 4h-.1a1.7 1.7 0 00-1.2 1.1z'
        ),
    },
    {
        key: 'help',
        label: 'Help',
        tab: DBOT_TABS.TUTORIAL,
        icon: icon('M12 18h.01M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01'),
    },
];

const MakotiSidebar = observer(() => {
    const navigate = useNavigate();
    const location = useLocation();
    const store = useStore();
    const isBotRoute =
        location.pathname === '/' || location.pathname.startsWith('/bot') || location.pathname === '/preview';

    const handleClick = (link: TSidebarLink) => {
        if (link.path && typeof link.tab !== 'number') {
            navigate(link.path);
            return;
        }
        if (typeof link.tab === 'number') {
            if (!isBotRoute) {
                navigate('/');
            }
            try {
                store?.dashboard?.setActiveTab(link.tab);
            } catch {}
            return;
        }
        navigate(link.path || '/');
    };

    return (
        <aside className='makoti-sidebar'>
            <nav className='makoti-sidebar__nav' aria-label='Main'>
                {LINKS.map(link => {
                    const isActive =
                        (link.key === 'home' && (location.pathname === '/' || location.pathname === '/preview')) ||
                        (link.key === 'bots' && location.pathname.startsWith('/bot'));
                    return (
                        <button
                            key={link.key}
                            type='button'
                            className={`makoti-sidebar__item${isActive ? ' makoti-sidebar__item--active' : ''}`}
                            onClick={() => handleClick(link)}
                        >
                            <span className='makoti-sidebar__icon'>{link.icon}</span>
                            <span className='makoti-sidebar__label'>{link.label}</span>
                        </button>
                    );
                })}
            </nav>
            <div className='makoti-sidebar__promo'>
                <div className='makoti-sidebar__promo-icon' aria-hidden='true'>
                    <svg width='28' height='28' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6'>
                        <path d='M3 17l6-6 4 4 8-8' strokeLinecap='round' strokeLinejoin='round' />
                        <path d='M14 7h7v7' strokeLinecap='round' strokeLinejoin='round' />
                    </svg>
                </div>
                <p className='makoti-sidebar__promo-text'>
                    Better Strategy
                    <br />
                    Bigger Profits
                </p>
                <span className='makoti-sidebar__promo-line' />
            </div>
        </aside>
    );
});

export default MakotiSidebar;

import { NavLink, useLocation } from 'react-router-dom';
import { NAV_ITEMS } from '../mock-data';
import { AskAmyIcon, CfdsIcon, CryptoIcon, DerivLogo, HomeIcon, OptionsIcon, PortfolioIcon, QrCodeIcon } from './icons';
import './hub-sidebar.scss';

const ICONS: Record<string, React.ReactNode> = {
    home: <HomeIcon />,
    cfds: <CfdsIcon />,
    crypto: <CryptoIcon />,
    options: <OptionsIcon />,
    portfolio: <PortfolioIcon />,
};

const BellIcon = () => (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='#333' strokeWidth='2'>
        <path d='M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9' />
        <path d='M13.73 21a2 2 0 01-3.46 0' />
    </svg>
);

const HubSidebar = () => {
    const location = useLocation();

    return (
        <aside className='hub-sidebar'>
            <div className='hub-sidebar__top'>
                <div className='hub-sidebar__logo-row'>
                    <DerivLogo />
                    <span className='hub-sidebar__bell'><BellIcon /></span>
                </div>

                <nav className='hub-sidebar__nav'>
                    {NAV_ITEMS.map(item => {
                        const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
                        return (
                            <NavLink
                                key={item.key}
                                to={item.path}
                                className={`hub-sidebar__nav-item${isActive ? ' hub-sidebar__nav-item--active' : ''}`}
                            >
                                <span className='hub-sidebar__nav-indicator' />
                                <span className='hub-sidebar__nav-icon'>{ICONS[item.key]}</span>
                                <span className='hub-sidebar__nav-label'>{item.label}</span>
                            </NavLink>
                        );
                    })}
                </nav>
            </div>

            <div className='hub-sidebar__bottom'>
                <button type='button' className='hub-sidebar__ask-amy'>
                    <AskAmyIcon />
                    <span>Ask Amy</span>
                </button>

                <div className='hub-sidebar__mobile-card'>
                    <button type='button' className='hub-sidebar__mobile-close' aria-label='Close'>
                        <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5'>
                            <line x1='18' y1='6' x2='6' y2='18' />
                            <line x1='6' y1='6' x2='18' y2='18' />
                        </svg>
                    </button>
                    <p className='hub-sidebar__mobile-title'>Deriv is on mobile</p>
                    <p className='hub-sidebar__mobile-sub'>Scan to download</p>
                    <div className='hub-sidebar__qr'>
                        <QrCodeIcon />
                    </div>
                    <p className='hub-sidebar__mobile-footer'>Available on App Store and Play Store</p>
                </div>
            </div>
        </aside>
    );
};

export default HubSidebar;

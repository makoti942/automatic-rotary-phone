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

const HubSidebar = () => {
    const location = useLocation();

    return (
        <aside className='hub-sidebar'>
            <div className='hub-sidebar__top'>
                <DerivLogo />

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
                    <p className='hub-sidebar__mobile-title'>Deriv is on mobile</p>
                    <p className='hub-sidebar__mobile-sub'>Scan the QR code to download the Deriv app</p>
                    <div className='hub-sidebar__qr'>
                        <QrCodeIcon />
                    </div>
                </div>
            </div>
        </aside>
    );
};

export default HubSidebar;

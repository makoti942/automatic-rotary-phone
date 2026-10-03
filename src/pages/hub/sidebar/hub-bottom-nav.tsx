import { NavLink, useLocation } from 'react-router-dom';
import { NAV_ITEMS } from '../mock-data';
import { CfdsIcon, CryptoIcon, HomeIcon, OptionsIcon, PortfolioIcon } from './icons';
import './hub-bottom-nav.scss';

const ICONS: Record<string, React.ReactNode> = {
    home: <HomeIcon />,
    cfds: <CfdsIcon />,
    crypto: <CryptoIcon />,
    options: <OptionsIcon />,
    portfolio: <PortfolioIcon />,
};

const HubBottomNav = () => {
    const location = useLocation();

    return (
        <nav className='hub-bottom-nav'>
            {NAV_ITEMS.map(item => {
                const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
                return (
                    <NavLink
                        key={item.key}
                        to={item.path}
                        className={`hub-bottom-nav__item${isActive ? ' hub-bottom-nav__item--active' : ''}`}
                    >
                        <span className='hub-bottom-nav__indicator' />
                        <span className='hub-bottom-nav__icon'>{ICONS[item.key]}</span>
                        <span className='hub-bottom-nav__label'>{item.label}</span>
                    </NavLink>
                );
            })}
        </nav>
    );
};

export default HubBottomNav;

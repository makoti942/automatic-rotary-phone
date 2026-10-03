import { AskAmyIcon, BellIcon, EyeIcon } from './icons';
import './hub-hero-topbar.scss';

type THeroTopBarProps = {
    onToggleEye?: () => void;
};

const HubHeroTopBar = ({ onToggleEye }: THeroTopBarProps) => (
    <div className='hub-hero-topbar'>
        <button type='button' className='hub-hero-topbar__pm' aria-label='Profile'>PM</button>
        <button type='button' className='hub-hero-topbar__amy'>
            <AskAmyIcon />
            <span>Ask Amy</span>
        </button>
        <div className='hub-hero-topbar__actions'>
            <button type='button' className='hub-hero-topbar__icon-btn' onClick={onToggleEye} aria-label='Toggle balance visibility'>
                <EyeIcon />
            </button>
            <button type='button' className='hub-hero-topbar__icon-btn' aria-label='Notifications'>
                <BellIcon />
            </button>
        </div>
    </div>
);

export default HubHeroTopBar;

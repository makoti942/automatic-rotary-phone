import { BrandDerivWordmarkCoralIcon } from '@deriv/quill-icons/Logo';
import './hub-top-header.scss';

const BellIcon = () => (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
        <path d='M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9' />
        <path d='M13.73 21a2 2 0 01-3.46 0' />
    </svg>
);

const HubTopHeader = () => (
    <header className='hub-top-header'>
        <div className='hub-top-header__logo'>
            <BrandDerivWordmarkCoralIcon height={28} width={84} />
        </div>
        <button type='button' className='hub-top-header__bell' aria-label='Notifications'>
            <BellIcon />
        </button>
    </header>
);

export default HubTopHeader;

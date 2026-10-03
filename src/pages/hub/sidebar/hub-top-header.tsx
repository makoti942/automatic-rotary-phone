import { useState } from 'react';
import { BrandDerivWordmarkCoralIcon } from '@deriv/quill-icons/Logo';
import { AskAmyIcon, BellIcon, EyeIcon } from './icons';
import './hub-top-header.scss';

const HubTopHeader = () => {
    const [eyeHidden, setEyeHidden] = useState(false);

    return (
        <header className='hub-top-header'>
            <div className='hub-top-header__logo'>
                <BrandDerivWordmarkCoralIcon height={28} width={84} />
            </div>
            <button type='button' className='hub-top-header__amy'>
                <AskAmyIcon />
                <span>Ask Amy</span>
            </button>
            <div className='hub-top-header__actions'>
                <button type='button' className='hub-top-header__icon-btn' onClick={() => setEyeHidden(v => !v)} aria-label='Toggle balance visibility'>
                    <EyeIcon />
                </button>
                <button type='button' className='hub-top-header__icon-btn' aria-label='Notifications'>
                    <BellIcon />
                </button>
            </div>
        </header>
    );
};

export default HubTopHeader;

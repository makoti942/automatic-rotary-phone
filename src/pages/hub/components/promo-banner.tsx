import { useState } from 'react';
import './promo-banner.scss';

const SpaceXLogo = () => (
    <svg width='120' height='28' viewBox='0 0 120 28' fill='none'>
        <text x='0' y='20' fill='#ffffff' fontSize='18' fontWeight='700' fontFamily='Arial, sans-serif' letterSpacing='4'>SPACEX</text>
    </svg>
);

type TPromoBannerProps = {
    title: string;
    subtitle: string;
    cta?: string;
    gradient?: string;
    accent?: string;
};

const PromoBanner = ({ title, subtitle }: TPromoBannerProps) => {
    const [dismissed, setDismissed] = useState(false);
    const [slide, setSlide] = useState(0);

    if (dismissed) return null;

    return (
        <div className='promo-banner'>
            <button type='button' className='promo-banner__close' onClick={() => setDismissed(true)} aria-label='Close'>
                <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5'>
                    <line x1='18' y1='6' x2='6' y2='18' />
                    <line x1='6' y1='6' x2='18' y2='18' />
                </svg>
            </button>
            <div className='promo-banner__content'>
                <h3 className='promo-banner__title'>{title}</h3>
                <p className='promo-banner__subtitle'>{subtitle}</p>
            </div>
            <div className='promo-banner__visual'>
                <SpaceXLogo />
            </div>
            <div className='promo-banner__dots'>
                <span className={`promo-banner__dot${slide === 0 ? ' promo-banner__dot--active' : ''}`} onClick={() => setSlide(0)} />
                <span className={`promo-banner__dot${slide === 1 ? ' promo-banner__dot--active' : ''}`} onClick={() => setSlide(1)} />
                <span className={`promo-banner__dot${slide === 2 ? ' promo-banner__dot--active' : ''}`} onClick={() => setSlide(2)} />
            </div>
        </div>
    );
};

export default PromoBanner;

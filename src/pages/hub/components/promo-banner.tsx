import { useState } from 'react';
import './promo-banner.scss';

const RocketIllustration = () => (
    <svg width='120' height='140' viewBox='0 0 120 140' fill='none'>
        <ellipse cx='60' cy='130' rx='50' ry='10' fill='rgba(255,255,255,0.05)' />
        <path d='M60 10C60 10 35 45 35 85C35 105 45 120 60 120C75 120 85 105 85 85C85 45 60 10 60 10Z' fill='#e8e8e8' stroke='#ccc' strokeWidth='1' />
        <path d='M60 10C60 10 40 45 40 85C40 100 48 115 60 115V10Z' fill='#f5f5f5' />
        <circle cx='60' cy='70' r='12' fill='#ff444f' />
        <circle cx='60' cy='70' r='8' fill='#fff' />
        <path d='M35 85L15 100L25 100L40 90Z' fill='#ff444f' />
        <path d='M85 85L105 100L95 100L80 90Z' fill='#ff444f' />
        <path d='M50 115L45 135L55 125L60 135L65 125L75 135L70 115' fill='#ff444f' opacity='0.8' />
        <circle cx='20' cy='20' r='2' fill='rgba(255,255,255,0.3)' />
        <circle cx='100' cy='30' r='1.5' fill='rgba(255,255,255,0.3)' />
        <circle cx='90' cy='15' r='1' fill='rgba(255,255,255,0.2)' />
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
                <RocketIllustration />
            </div>
            <div className='promo-banner__dots'>
                <span className={`promo-banner__dot${slide === 0 ? ' promo-banner__dot--active' : ''}`} />
                <span className={`promo-banner__dot${slide === 1 ? ' promo-banner__dot--active' : ''}`} />
                <span className={`promo-banner__dot${slide === 2 ? ' promo-banner__dot--active' : ''}`} />
            </div>
        </div>
    );
};

export default PromoBanner;

import './promo-banner.scss';

type TPromoBannerProps = {
    title: string;
    subtitle: string;
    cta: string;
    gradient: string;
    accent: string;
};

const PromoBanner = ({ title, subtitle, cta, gradient, accent }: TPromoBannerProps) => {
    return (
        <div className='promo-banner' style={{ background: gradient }}>
            <div className='promo-banner__content'>
                <h3 className='promo-banner__title'>{title}</h3>
                <p className='promo-banner__subtitle'>{subtitle}</p>
                <button type='button' className='promo-banner__cta' style={{ background: accent }}>
                    {cta}
                </button>
            </div>
            <div className='promo-banner__visual'>
                <div className='promo-banner__rocket' style={{ color: accent }}>
                    <svg width='64' height='64' viewBox='0 0 24 24' fill='currentColor'>
                        <path d='M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71L12 2z' />
                    </svg>
                </div>
            </div>
        </div>
    );
};

export default PromoBanner;

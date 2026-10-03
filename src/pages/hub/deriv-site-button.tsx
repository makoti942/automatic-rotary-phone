import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const isTrickActive = (): boolean => {
    try {
        return localStorage.getItem('is_custom_demo_icon_active') === 'true';
    } catch {
        return false;
    }
};

export const openDerivSite = (): void => {
    if (isTrickActive()) {
        window.location.href = '/dashboard/home';
    } else {
        window.open('https://home.deriv.com/dashboard/home', '_blank');
    }
};

const DerivSiteButton = ({ className }: { className?: string }) => {
    return (
        <button type='button' className={className ?? 'app-footer__icon'} onClick={openDerivSite} title='Deriv site'>
            <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                <circle cx='12' cy='12' r='10' />
                <line x1='2' y1='12' x2='22' y2='12' />
                <path d='M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z' />
            </svg>
        </button>
    );
};

export default DerivSiteButton;

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import './fake-browser-chrome.scss';

const FAKE_DOMAIN = 'home.derlv.com';

const getFakeUrl = (pathname: string): string => {
    const path = pathname.replace(/\/$/, '') || '/dashboard/home';
    return `${FAKE_DOMAIN}${path}`;
};

const FakeBrowserChrome = ({ children }: { children: React.ReactNode }) => {
    const location = useLocation();
    const [fakeUrl, setFakeUrl] = useState(() => getFakeUrl(location.pathname));

    useEffect(() => {
        setFakeUrl(getFakeUrl(location.pathname));
    }, [location.pathname]);

    return (
        <div className='hub-chrome'>
            <div className='hub-chrome__bar'>
                <div className='hub-chrome__nav'>
                    <button type='button' className='hub-chrome__nav-btn' aria-label='Back'>
                        <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <path d='M15 18l-6-6 6-6' />
                        </svg>
                    </button>
                    <button type='button' className='hub-chrome__nav-btn' aria-label='Forward'>
                        <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <path d='M9 18l6-6-6-6' />
                        </svg>
                    </button>
                    <button type='button' className='hub-chrome__nav-btn' aria-label='Reload'>
                        <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <path d='M23 4v6h-6M1 20v-6h6' />
                            <path d='M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15' />
                        </svg>
                    </button>
                </div>
                <div className='hub-chrome__url'>
                    <svg className='hub-chrome__lock' width='12' height='12' viewBox='0 0 24 24' fill='currentColor'>
                        <path d='M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9z' />
                    </svg>
                    <span className='hub-chrome__url-text'>{fakeUrl}</span>
                </div>
            </div>
            <div className='hub-chrome__content'>{children}</div>
        </div>
    );
};

export default FakeBrowserChrome;

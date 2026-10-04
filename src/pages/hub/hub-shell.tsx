import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import FakeBrowserChrome from './fake-browser-chrome';
import HubBarspinner from './components/hub-barspinner';
import HubBottomNav from './sidebar/hub-bottom-nav';
import './hub-shell.scss';

const HubSectionFallback = () => (
    <div className='hub-shell__section-loading' role='status' aria-label='Loading section'>
        <HubBarspinner size='md' />
    </div>
);

const HubShell = () => {
    const location = useLocation();

    useEffect(() => {
        document.title = 'Dashboard | Deriv';
        return () => {
            document.title = 'Deriv Bot';
        };
    }, [location.pathname]);

    return (
        <div className='hub-shell'>
            <FakeBrowserChrome>
                <div className='hub-shell__layout'>
                    <main className='hub-shell__content'>
                        <Suspense fallback={<HubSectionFallback />}>
                            <Outlet />
                        </Suspense>
                    </main>
                    <HubBottomNav />
                </div>
            </FakeBrowserChrome>
        </div>
    );
};

export default HubShell;

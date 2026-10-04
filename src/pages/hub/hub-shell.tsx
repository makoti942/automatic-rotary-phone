import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import FakeBrowserChrome from './fake-browser-chrome';
import HubPageLoader from './components/hub-page-loader';
import HubBottomNav from './sidebar/hub-bottom-nav';
import './hub-shell.scss';

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
                        <Suspense fallback={<HubPageLoader variant='balance' />}>
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

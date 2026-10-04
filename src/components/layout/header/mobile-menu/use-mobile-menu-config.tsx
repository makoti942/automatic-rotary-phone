import { ComponentProps, ReactNode, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import RootStore from '@/stores/root-store';
import { navigateToTransfer } from '@/utils/transfer-utils';
import { LegacyLogout1pxIcon, LegacyTheme1pxIcon, LegacyTransferIcon } from '@deriv/quill-icons/Legacy';
import { useTranslations } from '@deriv-com/translations';
import { ToggleSwitch } from '@deriv-com/ui';

export type TSubmenuSection = 'accountSettings' | 'cashier' | 'reports';

//IconTypes
type TMenuConfig = {
    LeftComponent: React.ElementType;
    RightComponent?: ReactNode;
    as: 'a' | 'button';
    href?: string;
    label: ReactNode;
    onClick?: () => void;
    removeBorderBottom?: boolean;
    submenu?: TSubmenuSection;
    target?: ComponentProps<'a'>['target'];
    isActive?: boolean;
}[];

const LegacyGlobeIcon = (props: { iconSize?: string }) => (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' {...props}>
        <circle cx='12' cy='12' r='10' />
        <line x1='2' y1='12' x2='22' y2='12' />
        <path d='M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z' />
    </svg>
);

const LegacyTabIcon = (props: { iconSize?: string }) => (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' {...props}>
        <rect x='3' y='4' width='18' height='16' rx='2' />
        <path d='M3 9h18M9 9v11' />
    </svg>
);

const BOT_TABS_MENU: { key: string; label: string; tab: number }[] = [
    { key: 'dashboard', label: 'Dashboard', tab: DBOT_TABS.DASHBOARD },
    { key: 'bot-builder', label: 'Bot Builder', tab: DBOT_TABS.BOT_BUILDER },
    { key: 'charts', label: 'Charts', tab: DBOT_TABS.CHART },
    { key: 'trading-bots', label: 'Trading Bots', tab: DBOT_TABS.TRADING_BOTS },
    { key: 'analysis', label: 'Analysis', tab: DBOT_TABS.ANALYSIS },
    { key: 'manual-trade', label: 'Manual Trade', tab: DBOT_TABS.MANUAL_TRADE },
    { key: 'trading-view', label: 'Trading View', tab: DBOT_TABS.TRADING_VIEW },
    { key: 'copy-trading', label: 'Copy Trading', tab: DBOT_TABS.COPY_TRADING },
    { key: 'bot-extractor', label: 'Bot Extractor', tab: DBOT_TABS.BOT_EXTRACTOR },
    { key: 'tutorials', label: 'Tutorials', tab: DBOT_TABS.TUTORIAL },
];

const useMobileMenuConfig = (
    client?: RootStore['client'],
    onLogout?: () => void,
    enableThemeToggle: boolean = true
) => {
    const { localize } = useTranslations();
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();
    const navigate = useNavigate();
    const location = useLocation();
    const store = useStore();

    const isBotRoute =
        location.pathname === '/' || location.pathname === '/preview' || location.pathname.startsWith('/bot');

    const handleTransfer = useCallback(() => {
        const currency = client?.all_accounts_balance?.accounts?.[client.activeLoginid ?? '']?.currency;
        if (currency) {
            navigateToTransfer(currency);
        }
    }, [client]);

    const handleDerivSite = useCallback(() => {
        const trickOn = localStorage.getItem('is_custom_demo_icon_active') === 'true';
        if (trickOn) {
            navigate('/dashboard/home');
        } else {
            window.open('https://home.deriv.com/dashboard/home', '_blank');
        }
    }, [navigate]);

    const handleTabNav = useCallback(
        (tab: number) => {
            if (!isBotRoute) {
                navigate('/');
            }
            try {
                store?.dashboard?.setActiveTab(tab);
            } catch {}
        },
        [isBotRoute, navigate, store]
    );

    const menuConfig = useMemo((): TMenuConfig[] => {
        const botTabsSection = BOT_TABS_MENU.map(item => ({
            as: 'button' as const,
            label: item.label,
            LeftComponent: LegacyTabIcon,
            onClick: () => handleTabNav(item.tab),
            isActive: isBotRoute && store?.dashboard?.active_tab === item.tab,
        }));

        return [
            botTabsSection,
            [
                // Conditionally include theme toggle based on brand config
                enableThemeToggle && {
                    as: 'button',
                    label: localize('Dark theme'),
                    LeftComponent: LegacyTheme1pxIcon,
                    RightComponent: <ToggleSwitch value={is_dark_mode_on} onChange={toggleTheme} />,
                },
                {
                    as: 'button',
                    label: localize('Deriv site'),
                    LeftComponent: LegacyGlobeIcon,
                    onClick: handleDerivSite,
                },
            ].filter(Boolean) as TMenuConfig,
            [
                client?.is_logged_in && {
                    as: 'button',
                    label: localize('Transfer'),
                    LeftComponent: LegacyTransferIcon,
                    onClick: handleTransfer,
                },
                client?.is_logged_in &&
                    onLogout && {
                        as: 'button',
                        label: localize('Log out'),
                        LeftComponent: LegacyLogout1pxIcon,
                        onClick: onLogout,
                        removeBorderBottom: true,
                    },
            ].filter(Boolean) as TMenuConfig,
        ].filter(section => section.length > 0);
    }, [
        client,
        onLogout,
        handleTransfer,
        handleDerivSite,
        handleTabNav,
        isBotRoute,
        store?.dashboard?.active_tab,
        is_dark_mode_on,
        toggleTheme,
        localize,
        enableThemeToggle,
    ]);

    // [AI] Check if menu has any items to determine if mobile menu should be shown
    const hasMenuItems = menuConfig.some(section => section.length > 0);
    // [/AI]

    return {
        config: menuConfig,
        // [AI] Return flag indicating if menu has any items
        hasMenuItems,
        // [/AI]
    };
};

export default useMobileMenuConfig;

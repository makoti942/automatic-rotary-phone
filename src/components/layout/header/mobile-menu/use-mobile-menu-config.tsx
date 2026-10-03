import { ComponentProps, ReactNode, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
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

const useMobileMenuConfig = (
    client?: RootStore['client'],
    onLogout?: () => void,
    enableThemeToggle: boolean = true
) => {
    const { localize } = useTranslations();
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();
    const navigate = useNavigate();

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

    const menuConfig = useMemo((): TMenuConfig[] => {

        return [
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

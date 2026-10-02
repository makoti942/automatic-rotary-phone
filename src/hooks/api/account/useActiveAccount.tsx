import { useEffect, useMemo, useState } from 'react';
/* [AI] - Analytics removed - utility functions moved to @/utils/account-helpers */
import { isVirtualAccount } from '@/utils/account-helpers';
/* [/AI] */
import { CurrencyIcon } from '@/components/currency/currency-icon';
import { addComma, getDecimalPlaces } from '@/components/shared';
import { useApiBase } from '@/hooks/useApiBase';
import { Balance } from '@deriv/api-types';

/** A custom hook that returns the account object for the current active account. */
const useActiveAccount = ({
    allBalanceData,
    directBalance,
}: {
    allBalanceData: Balance | null;
    directBalance?: string;
}) => {
    const { accountList, activeLoginid } = useApiBase();
    const [modeRevision, setModeRevision] = useState(0);

    useEffect(() => {
        const refresh = () => setModeRevision(value => value + 1);
        window.addEventListener('custom_demo_icon_changed', refresh);
        window.addEventListener('sandbox_state_changed', refresh);
        return () => {
            window.removeEventListener('custom_demo_icon_changed', refresh);
            window.removeEventListener('sandbox_state_changed', refresh);
        };
    }, []);

    const activeAccount = useMemo(
        () => accountList?.find(account => account.loginid === activeLoginid),
        [activeLoginid, accountList]
    );

    const currentBalanceData = allBalanceData?.accounts?.[activeAccount?.loginid ?? ''];

    const modifiedAccount = useMemo(() => {
        if (!activeAccount) return undefined;

        // Use centralized utility to determine if demo account
        const isVirtual = isVirtualAccount(activeAccount.loginid);
        const isTrickActive = localStorage.getItem('is_custom_demo_icon_active') === 'true';
        const isSandboxActive = localStorage.getItem('sandbox_active') === 'true';
        const sandboxBalance = Number(localStorage.getItem('sandbox_balance') ?? 0);
        const displayedBalance = isSandboxActive && sandboxBalance > 0
            ? sandboxBalance
            : currentBalanceData?.balance
              ? currentBalanceData.balance
              : directBalance
                ? parseFloat(directBalance)
                : 0;

        return {
            ...activeAccount,
            balance: addComma(displayedBalance.toFixed(getDecimalPlaces(activeAccount.currency))),
            currencyLabel: isSandboxActive ? 'Demo' : (isVirtual && !isTrickActive ? 'Demo' : activeAccount?.currency),
            icon: <CurrencyIcon currency={activeAccount?.currency?.toLowerCase()} isVirtual={isVirtual && !isTrickActive} />,
            isVirtual: isSandboxActive ? true : (isVirtual && !isTrickActive),
            isActive: activeAccount?.loginid === activeLoginid,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeAccount, activeLoginid, allBalanceData, directBalance, modeRevision]);

    return {
        /** User's current active account. */
        data: modifiedAccount,
    };
};

export default useActiveAccount;

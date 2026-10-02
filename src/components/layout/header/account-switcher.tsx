import { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { addComma, getCurrencyDisplayCode, getDecimalPlaces } from '@/components/shared';
import Text from '@/components/shared_ui/text';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { sendViaNewSystemWithPromise } from '@/auth/NewDerivAuth';
import { getAuthInfo } from '@/external/deriv-core';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { getAccountId, isDemoAccount } from '@/utils/account-helpers';
import { isCustomDemoIconActive } from '@/utils/custom-demo-icon-utils';
import { useSandbox } from '@/components/layout/header/sandbox-context';
import { Localize } from '@deriv-com/translations';
import { TAccountSwitcher } from './common/types';
import AccountInfoWrapper from './account-info-wrapper';
import './account-switcher.scss';

const FAKE_BALANCES = [
    1247.83, 1589.41, 2103.67, 2754.92, 3128.56, 3891.24, 4235.78, 4967.13,
    5382.49, 5914.86, 6247.31, 6893.57, 7126.94, 7548.23, 8013.68, 8479.15,
    9036.42, 9581.73, 10247.56, 11038.91, 11872.34, 12456.87, 13294.15, 14067.43,
    15328.69, 16741.52, 18293.84, 19547.26, 21836.91, 24179.38,
];

const FIXED_TRICK_BALANCE = 24654.67;

const AccountSwitcher = observer(({ activeAccount }: TAccountSwitcher) => {
    const [isOpen, setIsOpen] = useState(false);
    const [showAsReal, setShowAsReal] = useState(false);
    const [fakeBalance, setFakeBalance] = useState(() =>
        FAKE_BALANCES[Math.floor(Math.random() * FAKE_BALANCES.length)]
    );
    const [resetBusy, setResetBusy] = useState(false);
    const [isSandboxTransitioning, setIsSandboxTransitioning] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const { accountList, activeLoginid } = useApiBase();
    const { client, run_panel } = useStore() ?? {};
    const { isSandbox, sandboxBalance, enterSandbox, exitSandbox } = useSandbox();

    // Mirror sandbox state in local state — observer (mobx) does NOT re-render on React context changes
    const [localSandbox, setLocalSandbox] = useState(false);
    const [localSandboxBalance, setLocalSandboxBalance] = useState(() => {
        const v = localStorage.getItem('sandbox_balance');
        return v ? Number(v) : 0;
    });

    useEffect(() => {
        const handleSandboxChange = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            console.log('[AccountSwitcher] sandbox_state_changed:', detail);
            if (detail) {
                setLocalSandbox(!!detail.isSandbox);
                setLocalSandboxBalance(Number(detail.sandboxBalance) || 0);
            } else {
                // Fallback: read from localStorage
                setLocalSandbox(localStorage.getItem('sandbox_active') === 'true');
                const v = localStorage.getItem('sandbox_balance');
                setLocalSandboxBalance(v ? Number(v) : 0);
            }
        };
        window.addEventListener('sandbox_state_changed', handleSandboxChange);
        return () => window.removeEventListener('sandbox_state_changed', handleSandboxChange);
    }, []);

    // Use local mirrors everywhere instead of context values (which observer can't see)
    const isSandboxActive = localSandbox;
    const sandboxBal = localSandboxBalance;
    // Older builds used tripple_trick_active while the current tab trick uses
    // is_custom_demo_icon_active. Treat either flag as active so the visual
    // Demo/Real entries and their click behavior stay in sync.
    const persistedTrickActive = typeof window !== 'undefined' && localStorage.getItem('is_custom_demo_icon_active') === 'true';
    const trickModeActive = showAsReal || persistedTrickActive;
    // The provider is authoritative. localStorage is only persistence, not a
    // live transition signal; trusting it here can leave a stale Demo row that
    // returns early and makes the account appear unclickable.
    const sandboxIsActive = isSandboxActive || isSandbox;

    useEffect(() => {
        if (!isSandboxTransitioning) return;
        const timeout = window.setTimeout(() => setIsSandboxTransitioning(false), 3000);
        return () => window.clearTimeout(timeout);
    }, [isSandboxTransitioning]);

    useEffect(() => {
        const handleIconChange = () => {
            const active = isCustomDemoIconActive();
            setShowAsReal(active);
            if (active) {
                setFakeBalance(FAKE_BALANCES[Math.floor(Math.random() * FAKE_BALANCES.length)]);
            }
        };
        const handleFixedBalance = () => {
            setFakeBalance(FIXED_TRICK_BALANCE);
        };
        window.addEventListener('custom_demo_icon_changed', handleIconChange);
        window.addEventListener('trick_fixed_balance', handleFixedBalance);
        handleIconChange();
        return () => {
            window.removeEventListener('custom_demo_icon_changed', handleIconChange);
            window.removeEventListener('trick_fixed_balance', handleFixedBalance);
        };
    }, []);

    const is_bot_running = run_panel?.is_running || api_base.is_running;
    const isSingleAccount = !accountList || accountList.length <= 1;
    // Trick mode and sandbox mode create an additional visual account entry
    // even when Deriv returns only one underlying account. Do not disable the
    // switcher in that case, otherwise the Demo entry cannot be clicked.
    const canOpenAccountMenu = !is_bot_running && (!isSingleAccount || trickModeActive || isSandboxActive);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const toggleDropdown = useCallback(() => {
        if (!canOpenAccountMenu) return;
        setIsOpen(prev => !prev);
    }, [canOpenAccountMenu]);

    const handleResetBalance = useCallback(
        async (e: React.MouseEvent) => {
            e.stopPropagation();
            e.preventDefault();
            if (resetBusy) return;
            setResetBusy(true);
            try {
                // Prefer the REST reset endpoint: topup_virtual only tops up to the
                // current virtual credit limit and does NOT restore a blown balance.
                const authInfo = getAuthInfo();
                const accessToken = authInfo?.access_token || localStorage.getItem('authToken');
                const accountId = getAccountId() || activeLoginid;
                let reset = false;
                if (accountId && accessToken) {
                    try {
                        await DerivWSAccountsService.resetDemoBalance(accessToken, accountId);
                        reset = true;
                    } catch (err) {
                        console.warn('[ResetBalance] REST reset failed, falling back to topup_virtual:', err);
                    }
                }
                if (!reset) {
                    await sendViaNewSystemWithPromise({ topup_virtual: 1 });
                }
                // Force an immediate balance refresh (the balance stream also pushes on its own).
                await sendViaNewSystemWithPromise({ balance: 1 });
            } catch (err) {
                console.error('[ResetBalance] Failed to reset demo balance:', err);
            } finally {
                setResetBusy(false);
            }
        },
        [resetBusy, activeLoginid]
    );

    const handleAccountSelect = useCallback(
        (loginid: string) => {
            localStorage.setItem('active_loginid', loginid);
            client?.checkAndRegenerateWebSocket();
            setIsOpen(false);
        },
        [client]
    );

    const getFormattedAccounts = () => {
        if (!accountList) return [];
        const allBal = client?.all_accounts_balance?.accounts ?? {};
        const liveBalance = client?.balance;
        const results: Array<{
            loginid: string;
            currency: string;
            balance: string;
            isVirtual: boolean;
            isActive: boolean;
            _isFakeReal?: boolean;
            _isSandbox?: boolean;
        }> = [];

        // Sandbox mode: show Demo (sandbox balance) + Real (actual Deriv demo balance)
        if (sandboxIsActive) {
            const virtualAccount = accountList.find(a => isDemoAccount(a.loginid));
            if (virtualAccount) {
                // Use live client-store balance (same source as trick mode),
                // NOT getActualDemoBalance() which reads stale localStorage.
                const rawBal = allBal[virtualAccount.loginid]?.balance ?? virtualAccount.balance ?? 0;
                results.push({
                    loginid: virtualAccount.loginid,
                    currency: virtualAccount.currency,
                    balance: addComma(sandboxBal.toFixed(getDecimalPlaces(virtualAccount.currency))),
                    isVirtual: true,
                    isActive: true,
                    _isSandbox: true,
                });
                results.push({
                    loginid: virtualAccount.loginid,
                    currency: virtualAccount.currency,
                    balance: addComma(Number(rawBal).toFixed(getDecimalPlaces(virtualAccount.currency))),
                    isVirtual: false,
                    isActive: false,
                    _isFakeReal: true,
                });
            }
            return results;
        }

        for (const account of accountList) {
            const isVirtual = isDemoAccount(account.loginid);
            const isActive = account.loginid === activeLoginid;
            const rawBal = isActive && liveBalance ? liveBalance : (allBal[account.loginid]?.balance ?? account.balance ?? 0);
            const entry = {
                loginid: account.loginid,
                currency: account.currency,
                balance: addComma(Number(rawBal).toFixed(getDecimalPlaces(account.currency))),
                isVirtual,
                isActive,
            };

            if (trickModeActive && isVirtual) {
                const fakeReal = { ...entry, isVirtual: false, isActive: entry.isActive, _isFakeReal: true };
                entry.balance = addComma(fakeBalance.toFixed(getDecimalPlaces(account.currency)));
                entry.isActive = false;
                results.push(fakeReal);
                results.push(entry);
            } else if (!trickModeActive) {
                results.push(entry);
            }
        }

        return results.sort((a, b) => {
            if (a._isFakeReal) return -1;
            if (b._isFakeReal) return 1;
            if (a.isActive) return -1;
            if (b.isActive) return 1;
            return 0;
        });
    };
    const formattedAccounts = getFormattedAccounts();
    const hasTrickAccountPair = formattedAccounts.some(account => account._isFakeReal);

    if (!activeAccount) return null;

    const { currency, isVirtual, balance } = activeAccount;
    const showChevron = canOpenAccountMenu;
    const displayBalance = sandboxIsActive
        ? addComma(sandboxBal.toFixed(getDecimalPlaces(currency)))
        : balance;
    const displayIsVirtual = sandboxIsActive ? true : (isVirtual && !trickModeActive);

    return (
        <div className='acc-info__wrapper' ref={wrapperRef}>
            <AccountInfoWrapper>
                <div
                    data-testid='dt_acc_info'
                    id='dt_core_account-info_acc-info'
                    role={showChevron ? 'button' : undefined}
                    tabIndex={showChevron ? 0 : -1}
                    aria-expanded={showChevron ? isOpen : undefined}
                    aria-haspopup={showChevron ? 'listbox' : undefined}
                    className={classNames('acc-info', {
                        'acc-info--is-virtual': displayIsVirtual,
                        'acc-info--interactive': showChevron,
                    })}
                    onClick={toggleDropdown}
                    onKeyDown={e => {
                        if (showChevron && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            toggleDropdown();
                        }
                    }}
                >
                    <span className='acc-info__id' aria-hidden='true'></span>
                    <div className='acc-info__content'>
                        {isSandboxTransitioning ? (
                            <div className='acc-info__sandbox-loading'>
                                <svg
                                    className='acc-info__sandbox-spinner'
                                    viewBox='0 0 24 24'
                                    fill='none'
                                    xmlns='http://www.w3.org/2000/svg'
                                >
                                    <circle
                                        cx='12'
                                        cy='12'
                                        r='10'
                                        stroke='currentColor'
                                        strokeWidth='2.5'
                                        strokeLinecap='round'
                                        strokeDasharray='31.416'
                                        strokeDashoffset='10'
                                    />
                                </svg>
                            </div>
                        ) : (
                        <>
                        <div className='acc-info__account-type-header'>
                            <Text as='p' size='xs' className='acc-info__account-type'>
                                {sandboxIsActive ? (
                                    <Localize i18n_default_text='Demo account' />
                                ) : trickModeActive && isVirtual ? (
                                    <Localize i18n_default_text='Real account' />
                                ) : isVirtual ? (
                                    <Localize i18n_default_text='Demo account' />
                                ) : (
                                    <Localize i18n_default_text='Real account' />
                                )}
                            </Text>
                            {showChevron && (
                                <span
                                    className={classNames('acc-info__select-arrow', {
                                        'acc-info__select-arrow--invert': isOpen,
                                    })}
                                >
                                    <svg width='12' height='12' viewBox='0 0 12 12' fill='none'>
                                        <path
                                            d='M2 4L6 8L10 4'
                                            stroke='currentColor'
                                            strokeWidth='1.5'
                                            strokeLinecap='round'
                                            strokeLinejoin='round'
                                        />
                                    </svg>
                                </span>
                            )}
                        </div>
                        {(typeof balance !== 'undefined' || !currency) && (
                            <div className='acc-info__balance-section'>
                                <p
                                    data-testid='dt_balance'
                                    className={classNames('acc-info__balance', {
                                        'acc-info__balance--no-currency': !currency && !isVirtual,
                                    })}
                                >
                                    {!currency ? (
                                        <Localize i18n_default_text='No currency assigned' />
                                    ) : (
                                        `${displayBalance} ${getCurrencyDisplayCode(currency)}`
                                    )}
                                </p>
                                {isVirtual && !trickModeActive && (
                                    <button
                                        type='button'
                                        className={`acc-info__reset-balance${resetBusy ? ' acc-info__reset-balance--busy' : ''}`}
                                        title='Reset demo balance'
                                        aria-label='Reset demo balance'
                                        onClick={handleResetBalance}
                                    >
                                        <svg width='12' height='12' viewBox='0 0 24 24' fill='none'>
                                            <path
                                                d='M4 4v6h6'
                                                stroke='currentColor'
                                                strokeWidth='2'
                                                strokeLinecap='round'
                                                strokeLinejoin='round'
                                            />
                                            <path
                                                d='M20 20v-6h-6'
                                                stroke='currentColor'
                                                strokeWidth='2'
                                                strokeLinecap='round'
                                                strokeLinejoin='round'
                                            />
                                            <path
                                                d='M4 10a8 8 0 0 1 14-3l2 3'
                                                stroke='currentColor'
                                                strokeWidth='2'
                                                strokeLinecap='round'
                                                strokeLinejoin='round'
                                            />
                                            <path
                                                d='M20 14a8 8 0 0 1-14 3l-2-3'
                                                stroke='currentColor'
                                                strokeWidth='2'
                                                strokeLinecap='round'
                                                strokeLinejoin='round'
                                            />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        )}
                        </>
                        )}
                    </div>
                </div>
            </AccountInfoWrapper>
            {isOpen && (
                <div className='acc-dropdown' role='listbox'>
                    {formattedAccounts.map((account, idx) => (
                        <div
                            key={account._isFakeReal ? `${account.loginid}-real` : `${account.loginid}-${idx}`}
                            role='option'
                            aria-selected={account.isActive}
                            data-sandbox-entry={account.isVirtual && !account._isFakeReal ? 'true' : undefined}
                            tabIndex={0}
                            className={classNames('acc-dropdown__account', {
                                'acc-dropdown__account--selected': account.isActive,
                                'acc-dropdown__account--virtual': account.isVirtual && !account._isFakeReal,
                            })}
                            onClick={() => {
                                console.log('[AccountSwitcher] Click:', {
                                    loginid: account.loginid,
                                    isVirtual: account.isVirtual,
                                    isFakeReal: account._isFakeReal,
                                    isSandboxEntry: account._isSandbox,
                                    showAsReal,
                                    isSandboxActive,
                                    fakeBalance,
                                });
                                if (account._isSandbox && isSandbox) return; // already in sandbox
                                if (account._isFakeReal && sandboxIsActive) {
                                    // Clicking "Real account" while in sandbox → exit sandbox
                                    console.log('[AccountSwitcher] Exiting sandbox');
                                    setIsSandboxTransitioning(true);
                                    exitSandbox();
                                    setIsOpen(false);
                                    return;
                                }
                                // Clicking "Demo account" while trick is active → enter sandbox
                                // Use !account._isFakeReal as the primary check (more reliable than isVirtual)
                                const isSandboxDemoEntry =
                                    !sandboxIsActive &&
                                    !account._isFakeReal &&
                                    isDemoAccount(account.loginid) &&
                                    (trickModeActive || hasTrickAccountPair);
                                if (isSandboxDemoEntry) {
                                    console.log('[AccountSwitcher] Entering sandbox with balance:', fakeBalance);
                                    setIsSandboxTransitioning(true);
                                    enterSandbox(fakeBalance);
                                    setIsOpen(false);
                                    return;
                                }
                                if (!account.isActive) handleAccountSelect(account.loginid);
                            }}
                            onKeyDown={e => {
                                if (!account.isActive && (e.key === 'Enter' || e.key === ' ')) {
                                    e.preventDefault();
                                    handleAccountSelect(account.loginid);
                                }
                            }}
                        >
                            <Text
                                size='xxxs'
                                className={classNames('acc-dropdown__account-type', {
                                    'acc-dropdown__account-type--virtual': account.isVirtual && !account._isFakeReal,
                                })}
                            >
                                {account._isSandbox ? (
                                    <Localize i18n_default_text='Demo account' />
                                ) : account.isVirtual && !account._isFakeReal ? (
                                    <Localize i18n_default_text='Demo account' />
                                ) : (
                                    <Localize i18n_default_text='Real account' />
                                )}
                            </Text>
                            <Text size='xs' weight='bold' className='acc-dropdown__balance'>
                                {account.currency ? (
                                    `${account.balance} ${getCurrencyDisplayCode(account.currency)}`
                                ) : (
                                    <Localize i18n_default_text='No currency assigned' />
                                )}
                            </Text>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});

export default AccountSwitcher;

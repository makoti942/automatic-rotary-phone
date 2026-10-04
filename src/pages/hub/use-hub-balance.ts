import { useCallback, useEffect, useState } from 'react';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';

const FIXED_TRICK_BALANCE = 24654.67;
const BALANCE_GRACE_MS = 600;

const isDemoLoginid = (loginid: string): boolean =>
    /^(VRTC|VRW|DEM|DOT|CR9|CRW)/.test(loginid) ||
    loginid.startsWith('VRT') ||
    loginid.startsWith('VRW') ||
    loginid.startsWith('DEM') ||
    loginid.startsWith('DOT');

export type THubBalance = {
    isTrickActive: boolean;
    isSandboxActive: boolean;
    isDemoAccount: boolean;
    isBalanceLoading: boolean;
    activeLoginid: string;
    activeCurrency: string;
    realDemoBalance: number;
    trickBalance: number;
    sandboxBalance: number;
    selectedView: 'real' | 'demo';
    totalValue: number;
    setSelectedView: (view: 'real' | 'demo') => void;
    refresh: () => void;
};

export const useHubBalance = (): THubBalance => {
    const store = useStore();
    const { accountList, activeLoginid: apiLoginid, isAuthorizing } = useApiBase();
    const client = store?.client;

    const [modeRevision, setModeRevision] = useState(0);
    const [selectedView, setSelectedView] = useState<'real' | 'demo'>(() => {
        const stored = localStorage.getItem('hub_selected_view');
        return stored === 'demo' ? 'demo' : 'real';
    });
    const [realDemoBalance, setRealDemoBalance] = useState<number>(0);
    const [trickBalance, setTrickBalance] = useState<number>(FIXED_TRICK_BALANCE);
    const [sandboxBalance, setSandboxBalance] = useState<number>(0);
    const [isTrickActive, setIsTrickActive] = useState(false);
    const [isSandboxActive, setIsSandboxActive] = useState(false);
    const [balanceSettled, setBalanceSettled] = useState(false);

    const handleSetSelectedView = useCallback((view: 'real' | 'demo') => {
        setSelectedView(view);
        try {
            localStorage.setItem('hub_selected_view', view);
        } catch {}
    }, []);

    const activeLoginid = apiLoginid || localStorage.getItem('active_loginid') || '';
    const activeAccount = accountList?.find((a: any) => a.loginid === activeLoginid);
    const activeCurrency = activeAccount?.currency || 'USD';
    const isDemoAccount = isDemoLoginid(activeLoginid);

    const refresh = useCallback(() => {
        const trickOn = localStorage.getItem('is_custom_demo_icon_active') === 'true';
        const sandboxOn = localStorage.getItem('sandbox_active') === 'true';
        const storedTrick = Number(localStorage.getItem('trick_fake_balance'));
        const storedSandbox = Number(localStorage.getItem('sandbox_balance'));

        setIsTrickActive(trickOn);
        setIsSandboxActive(sandboxOn);
        setTrickBalance(!isNaN(storedTrick) && storedTrick > 0 ? storedTrick : FIXED_TRICK_BALANCE);
        setSandboxBalance(!isNaN(storedSandbox) && storedSandbox > 0 ? storedSandbox : 0);

        const storeBal = Number(client?.balance ?? 0);
        if (storeBal > 0) setRealDemoBalance(storeBal);
    }, [client]);

    useEffect(() => {
        refresh();
    }, [refresh, modeRevision]);

    useEffect(() => {
        const handleChange = () => setModeRevision(v => v + 1);
        window.addEventListener('sandbox_state_changed', handleChange);
        window.addEventListener('custom_demo_icon_changed', handleChange);
        window.addEventListener('trick_fixed_balance', handleChange);
        return () => {
            window.removeEventListener('sandbox_state_changed', handleChange);
            window.removeEventListener('custom_demo_icon_changed', handleChange);
            window.removeEventListener('trick_fixed_balance', handleChange);
        };
    }, []);

    useEffect(() => {
        const handler = (event: Event) => {
            try {
                const detail = (event as CustomEvent).detail;
                const raw = detail?.data ?? detail;
                if (!raw) return;
                const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (data?.msg_type === 'balance' && data?.balance) {
                    const bal = Number(data.balance?.balance ?? 0);
                    if (bal > 0) setRealDemoBalance(bal);
                }
            } catch {}
        };
        window.addEventListener('newSystemMessage', handler as EventListener);
        return () => window.removeEventListener('newSystemMessage', handler as EventListener);
    }, []);

    const storeLiveBalance = Number(client?.balance ?? 0);
    const liveDemoBalance = storeLiveBalance > 0 ? storeLiveBalance : realDemoBalance;
    const hasBalanceValue = storeLiveBalance > 0 || realDemoBalance > 0;

    // Only show loader while auth is still resolving, or briefly while first balance arrives.
    // Never treat a legitimate 0 balance as "still loading".
    useEffect(() => {
        if (hasBalanceValue) {
            setBalanceSettled(true);
            return;
        }
        if (!isAuthorizing) {
            const timer = window.setTimeout(() => setBalanceSettled(true), BALANCE_GRACE_MS);
            return () => window.clearTimeout(timer);
        }
        setBalanceSettled(false);
    }, [isAuthorizing, hasBalanceValue]);

    const isBalanceLoading = !balanceSettled;

    const totalValue = selectedView === 'real'
        ? liveDemoBalance
        : trickBalance;

    return {
        isTrickActive,
        isSandboxActive,
        isDemoAccount,
        isBalanceLoading,
        activeLoginid,
        activeCurrency,
        realDemoBalance: liveDemoBalance,
        trickBalance,
        sandboxBalance,
        selectedView,
        totalValue,
        setSelectedView: handleSetSelectedView,
        refresh,
    };
};

export default useHubBalance;

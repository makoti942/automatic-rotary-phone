import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { calcPayout, getWinCondition } from '@/utils/sandbox-payout';
import * as sandboxEngine from '@/utils/sandbox-engine';

// Re-export for backward compatibility
export { calcPayout, getWinCondition };

// ─── Types ────────────────────────────────────────────────────────────────────
export interface SandboxTrade {
    contractId: number;
    symbol: string;
    contractType: string;
    barrier: number;
    stake: number;
    payout: number;
    entryDigit: number;
    resultDigit: number | null;
    profit: number | null;
    status: 'open' | 'won' | 'lost';
    openedAt: number;
    settledAt: number | null;
    duration: number;
}

interface SandboxContextValue {
    isSandbox: boolean;
    sandboxBalance: number;
    sandboxTrades: SandboxTrade[];
    activeSandboxContract: SandboxTrade | null;
    enterSandbox: (initialBalance: number) => void;
    exitSandbox: () => void;
    executeSandboxTrade: (params: {
        symbol: string;
        contractType: string;
        barrier: number;
        stake: number;
        duration: number;
        entryDigit: number;
    }) => SandboxTrade | null;
    getActualDemoBalance: () => number;
}

const SandboxContext = createContext<SandboxContextValue | null>(null);

export const useSandbox = () => {
    const ctx = useContext(SandboxContext);
    // Safe fallback if provider is missing (prevents crash)
    return ctx ?? {
        isSandbox: false,
        sandboxBalance: 0,
        sandboxTrades: [],
        activeSandboxContract: null,
        enterSandbox: () => {},
        exitSandbox: () => {},
        executeSandboxTrade: () => null,
        getActualDemoBalance: () => 0,
    };
};

export const SandboxProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isSandbox, setIsSandbox] = useState(false);
    const [sandboxBalance, setSandboxBalance] = useState(0);
    const [sandboxTrades, setSandboxTrades] = useState<SandboxTrade[]>([]);
    const [activeSandboxContract, setActiveSandboxContract] = useState<SandboxTrade | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    // Restore sandbox state from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem('sandbox_active');
            if (saved === 'true') {
                const savedBalance = localStorage.getItem('sandbox_balance');
                const balance = savedBalance ? Number(savedBalance) : 0;
                if (balance > 0) {
                    setIsSandbox(true);
                    setSandboxBalance(balance);
                } else {
                    localStorage.removeItem('sandbox_active');
                    localStorage.removeItem('sandbox_balance');
                }
            }
        } catch {}
    }, []);

    // Listen for balance changes dispatched by the sandbox engine
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (!mountedRef.current || !detail) return;
            if (typeof detail.isSandbox === 'boolean') setIsSandbox(detail.isSandbox);
            if (typeof detail.sandboxBalance === 'number') setSandboxBalance(detail.sandboxBalance);
        };
        window.addEventListener('sandbox_state_changed', handler);
        return () => window.removeEventListener('sandbox_state_changed', handler);
    }, []);

    // Listen for trade settlements from the sandbox engine
    useEffect(() => {
        const handler = (e: Event) => {
            const settled = (e as CustomEvent).detail as SandboxTrade;
            if (!mountedRef.current || !settled) return;
            setActiveSandboxContract(null);
            setSandboxTrades(prev => prev.map(t => t.contractId === settled.contractId ? settled : t));
        };
        window.addEventListener('sandbox_trade_settled', handler);
        return () => window.removeEventListener('sandbox_trade_settled', handler);
    }, []);

    const enterSandbox = useCallback((initialBalance: number) => {
        localStorage.setItem('sandbox_active', 'true');
        localStorage.setItem('sandbox_balance', String(initialBalance));
        setIsSandbox(true);
        setSandboxBalance(initialBalance);
        setSandboxTrades([]);
        setActiveSandboxContract(null);
        window.dispatchEvent(new CustomEvent('sandbox_state_changed', {
            detail: { isSandbox: true, sandboxBalance: initialBalance },
        }));
    }, []);

    const exitSandbox = useCallback(() => {
        localStorage.removeItem('sandbox_active');
        localStorage.removeItem('sandbox_balance');
        setIsSandbox(false);
        setSandboxBalance(0);
        setActiveSandboxContract(null);
        setSandboxTrades([]);
        window.dispatchEvent(new CustomEvent('sandbox_state_changed', {
            detail: { isSandbox: false, sandboxBalance: 0 },
        }));
    }, []);

    // Delegate trade execution to the sandbox engine (single source of truth)
    const executeSandboxTrade = useCallback((params: {
        symbol: string;
        contractType: string;
        barrier: number;
        stake: number;
        duration: number;
        entryDigit: number;
    }): SandboxTrade | null => {
        if (!sandboxEngine.isSandboxActive()) return null;

        const balance = sandboxEngine.getSandboxBalance();
        if (balance < params.stake) return null;

        const payout = calcPayout(params.contractType, params.barrier, params.stake);
        const newBalance = balance - params.stake;

        // Build a fake buy message the sandbox engine can process
        const fakeMsg = {
            buy: 1,
            price: params.stake,
            parameters: {
                contract_type: params.contractType,
                barrier: params.barrier,
                amount: params.stake,
                underlying_symbol: params.symbol,
                symbol: params.symbol,
                duration: params.duration,
            },
        };

        const response = sandboxEngine.trySandboxBuy(fakeMsg);
        if (!response || response.error) return null;

        const contractId = Number(response.buy.contract_id);
        const trade: SandboxTrade = {
            contractId,
            symbol: params.symbol,
            contractType: params.contractType,
            barrier: params.barrier,
            stake: params.stake,
            payout: response.buy.payout,
            entryDigit: params.entryDigit,
            resultDigit: null,
            profit: null,
            status: 'open',
            openedAt: Date.now(),
            settledAt: null,
            duration: params.duration,
        };

        // Sync React state from engine
        setSandboxBalance(response.buy.balance_after);
        setActiveSandboxContract(trade);
        setSandboxTrades(prev => [...prev, trade]);

        return trade;
    }, []);

    const getActualDemoBalance = useCallback((): number => {
        try {
            const clientAccounts = localStorage.getItem('clientAccounts');
            if (clientAccounts) {
                const accounts = JSON.parse(clientAccounts);
                const demoLoginid = Object.keys(accounts).find(id =>
                    id.startsWith('VRTC') || id.startsWith('VRW') || id.startsWith('DEM') || id.startsWith('DOT')
                );
                if (demoLoginid && accounts[demoLoginid]?.balance !== undefined) {
                    return Number(accounts[demoLoginid].balance);
                }
            }
        } catch {}
        return 0;
    }, []);

    return (
        <SandboxContext.Provider value={{
            isSandbox, sandboxBalance, sandboxTrades, activeSandboxContract,
            enterSandbox, exitSandbox, executeSandboxTrade, getActualDemoBalance,
        }}>
            {children}
        </SandboxContext.Provider>
    );
};

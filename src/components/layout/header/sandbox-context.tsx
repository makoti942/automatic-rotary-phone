import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onNewSystemMessage } from '@/auth/NewDerivAuth';

// ─── Payout Calculator ────────────────────────────────────────────────────────
// Deriv digit contract payouts (approximate, ~5% house edge)
// payout = (1 / probability) * 0.95

export function calcPayout(contractType: string, barrier: number, stake: number): number {
    let probability = 0.5;
    switch (contractType) {
        case 'DIGITMATCH': probability = 0.1; break;
        case 'DIGITDIFF': probability = 0.9; break;
        case 'DIGITOVER': probability = (9 - barrier) / 10; break;
        case 'DIGITUNDER': probability = barrier / 10; break;
        case 'DIGITEVEN':
        case 'DIGITODD': probability = 0.5; break;
    }
    if (probability <= 0) probability = 0.01;
    const multiplier = (1 / probability) * 0.95;
    return Math.round(stake * multiplier * 100) / 100;
}

export function getWinCondition(contractType: string, barrier: number, resultDigit: number): boolean {
    switch (contractType) {
        case 'DIGITMATCH': return resultDigit === barrier;
        case 'DIGITDIFF': return resultDigit !== barrier;
        case 'DIGITOVER': return resultDigit > barrier;
        case 'DIGITUNDER': return resultDigit < barrier;
        case 'DIGITEVEN': return resultDigit % 2 === 0;
        case 'DIGITODD': return resultDigit % 2 === 1;
        default: return false;
    }
}

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

let nextContractId = 900000;

export const SandboxProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isSandbox, setIsSandbox] = useState(false);
    const [sandboxBalance, setSandboxBalance] = useState(0);
    const [sandboxTrades, setSandboxTrades] = useState<SandboxTrade[]>([]);
    const [activeSandboxContract, setActiveSandboxContract] = useState<SandboxTrade | null>(null);

    const isSandboxRef = useRef(false);
    const balanceRef = useRef(0);
    const activeContractRef = useRef<SandboxTrade | null>(null);
    const tickBufferRef = useRef<number[]>([]);
    const mountedRef = useRef(true);

    isSandboxRef.current = isSandbox;
    balanceRef.current = sandboxBalance;
    activeContractRef.current = activeSandboxContract;

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
                    isSandboxRef.current = true;
                    balanceRef.current = balance;
                }
            }
        } catch {}
    }, []);

    // Broadcast sandbox state changes so observer-wrapped components (e.g. AccountSwitcher) re-render
    useEffect(() => {
        window.dispatchEvent(new CustomEvent('sandbox_state_changed', {
            detail: { isSandbox, sandboxBalance },
        }));
    }, [isSandbox, sandboxBalance]);

    // Persist sandbox balance to localStorage whenever it changes
    useEffect(() => {
        if (isSandbox) {
            localStorage.setItem('sandbox_balance', String(sandboxBalance));
        }
    }, [isSandbox, sandboxBalance]);

    // Listen for ticks to settle sandbox contracts
    useEffect(() => {
        const unsub = onNewSystemMessage((event: MessageEvent) => {
            if (!mountedRef.current) return;
            try {
                const data = JSON.parse(event.data);
                if (!data.tick) return;

                const contract = activeContractRef.current;
                if (!contract || contract.status !== 'open') return;
                if (data.tick.symbol !== contract.symbol) return;

                const digit = Number(String(data.tick.quote).slice(-1));
                tickBufferRef.current.push(digit);

                if (tickBufferRef.current.length >= contract.duration) {
                    const resultDigit = tickBufferRef.current[tickBufferRef.current.length - 1];
                    const won = getWinCondition(contract.contractType, contract.barrier, resultDigit);
                    const profit = won ? contract.payout - contract.stake : -contract.stake;
                    const newBalance = balanceRef.current + (won ? contract.payout : 0);

                    const settled: SandboxTrade = {
                        ...contract,
                        resultDigit,
                        profit,
                        status: won ? 'won' : 'lost',
                        settledAt: Date.now(),
                    };

                    if (mountedRef.current) {
                        setSandboxBalance(newBalance);
                        setActiveSandboxContract(null);
                        setSandboxTrades(prev => prev.map(t => t.contractId === contract.contractId ? settled : t));
                    }
                    activeContractRef.current = null;
                    tickBufferRef.current = [];
                }
            } catch {}
        });
        return unsub;
    }, []);

    const enterSandbox = useCallback((initialBalance: number) => {
        setSandboxBalance(initialBalance);
        balanceRef.current = initialBalance;
        setIsSandbox(true);
        isSandboxRef.current = true;
        localStorage.setItem('sandbox_active', 'true');
        localStorage.setItem('sandbox_balance', String(initialBalance));
        window.dispatchEvent(new CustomEvent('sandbox_state_changed', {
            detail: { isSandbox: true, sandboxBalance: initialBalance },
        }));
        setSandboxTrades([]);
        setActiveSandboxContract(null);
        activeContractRef.current = null;
        tickBufferRef.current = [];
    }, []);

    const exitSandbox = useCallback(() => {
        setIsSandbox(false);
        isSandboxRef.current = false;
        localStorage.removeItem('sandbox_active');
        localStorage.removeItem('sandbox_balance');
        window.dispatchEvent(new CustomEvent('sandbox_state_changed', {
            detail: { isSandbox: false, sandboxBalance: 0 },
        }));
        setActiveSandboxContract(null);
        activeContractRef.current = null;
        tickBufferRef.current = [];
    }, []);

    const executeSandboxTrade = useCallback((params: {
        symbol: string;
        contractType: string;
        barrier: number;
        stake: number;
        duration: number;
        entryDigit: number;
    }): SandboxTrade | null => {
        if (!isSandboxRef.current) return null;
        if (activeContractRef.current) return null; // one trade at a time
        if (balanceRef.current < params.stake) return null;

        const payout = calcPayout(params.contractType, params.barrier, params.stake);
        const newBalance = balanceRef.current - params.stake;

        const trade: SandboxTrade = {
            contractId: nextContractId++,
            symbol: params.symbol,
            contractType: params.contractType,
            barrier: params.barrier,
            stake: params.stake,
            payout,
            entryDigit: params.entryDigit,
            resultDigit: null,
            profit: null,
            status: 'open',
            openedAt: Date.now(),
            settledAt: null,
            duration: params.duration,
        };

        tickBufferRef.current = [];
        activeContractRef.current = trade;

        if (mountedRef.current) {
            setSandboxBalance(newBalance);
            setActiveSandboxContract(trade);
            setSandboxTrades(prev => [...prev, trade]);
        }

        return trade;
    }, []);

    const getActualDemoBalance = useCallback((): number => {
        try {
            const clientAccounts = localStorage.getItem('clientAccounts');
            if (clientAccounts) {
                const accounts = JSON.parse(clientAccounts);
                const activeLoginid = localStorage.getItem('active_loginid');
                if (activeLoginid && accounts[activeLoginid]?.balance !== undefined) {
                    return Number(accounts[activeLoginid].balance);
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

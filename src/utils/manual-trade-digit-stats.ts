export interface ManualTradeDigitStats {
    symbol: string;
    percentages: number[];
    totalTicks: number;
    updatedAt: number;
}

declare global {
    interface Window {
        __manualTradeDigitStats?: ManualTradeDigitStats;
    }
}

export function publishManualTradeDigitStats(symbol: string, counts: number[], totalTicks: number): void {
    if (typeof window === 'undefined') return;

    const safeCounts = Array.from({ length: 10 }, (_, digit) => {
        const count = Number(counts[digit]);
        return Number.isFinite(count) && count > 0 ? count : 0;
    });
    const safeTotal = Number.isFinite(totalTicks) && totalTicks > 0 ? totalTicks : 0;
    const percentages = safeTotal > 0 ? safeCounts.map(count => (count / safeTotal) * 100) : Array(10).fill(0);

    window.__manualTradeDigitStats = {
        symbol,
        percentages,
        totalTicks: safeTotal,
        updatedAt: Date.now(),
    };
}

export function clearManualTradeDigitStats(): void {
    if (typeof window !== 'undefined') {
        delete window.__manualTradeDigitStats;
    }
}

/** Return the same one-decimal percentage rendered by the Manual Trade digit cards. */
export function getManualTradeDigitPercentage(digit: number): number {
    if (!Number.isInteger(digit) || digit < 0 || digit > 9 || typeof window === 'undefined') return 0;

    const stats = window.__manualTradeDigitStats;
    if (!stats || stats.totalTicks <= 0) return 0;

    const percentage = Number(stats.percentages[digit]);
    return Number.isFinite(percentage) ? Math.round(percentage * 10) / 10 : 0;
}

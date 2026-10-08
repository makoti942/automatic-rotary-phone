// Payout calculator and win condition — extracted to avoid circular imports.

export function calcPayout(contractType: string, barrier: number, stake: number): number {
    let probability = 0.5;
    switch (contractType) {
        case 'DIGITMATCH': probability = 0.1; break;
        case 'DIGITDIFF': probability = 0.9; break;
        case 'DIGITOVER': probability = (9 - barrier) / 10; break;
        case 'DIGITUNDER': probability = barrier / 10; break;
        case 'DIGITEVEN':
        case 'DIGITODD':
        case 'CALL':
        case 'PUT': probability = 0.5; break;
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

export interface SpecialAccountConfig {
    loginid: string;
    subtract: number;
    demoAccountId: string;
    description?: string;
}

export const SPECIAL_CR_ACCOUNTS: SpecialAccountConfig[] = [
    {
        loginid: 'CR6779123',
        subtract: 8000.00,
        demoAccountId: 'VRTC10109979',
        description: 'Main CR Account - Shares balance with VRTC10109979 demo account',
    },
];

export const isSpecialCRAccount = (loginid: string): boolean => {
    return SPECIAL_CR_ACCOUNTS.some(account => account.loginid === loginid);
};

export const getSubtractAmount = (loginid: string): number => {
    const account = SPECIAL_CR_ACCOUNTS.find(acc => acc.loginid === loginid);
    return account?.subtract || 0;
};

export const getSpecialAccountConfig = (loginid: string): SpecialAccountConfig | undefined => {
    return SPECIAL_CR_ACCOUNTS.find(acc => acc.loginid === loginid);
};

export const getDemoAccountIdForSpecialCR = (loginid: string): string | null => {
    const config = getSpecialAccountConfig(loginid);
    return config?.demoAccountId || null;
};

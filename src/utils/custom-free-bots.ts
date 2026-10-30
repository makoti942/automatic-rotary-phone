import localForage from 'localforage';

export interface CustomFreeBot {
    id: string;
    name: string;
    xml: string;
    source: string;
    size: number;
    savedAt: number;
}

export const CUSTOM_FREE_BOTS_STORAGE_KEY = 'free-bots:custom:v1';

const isValidCustomFreeBot = (bot: any): bot is CustomFreeBot =>
    Boolean(bot?.id && bot?.name && typeof bot?.xml === 'string' && bot.xml.trim());

export async function getCustomFreeBots(): Promise<CustomFreeBot[]> {
    try {
        const saved = await localForage.getItem<CustomFreeBot[]>(CUSTOM_FREE_BOTS_STORAGE_KEY);
        return Array.isArray(saved) ? saved.filter(isValidCustomFreeBot) : [];
    } catch {
        return [];
    }
}

export async function saveCustomFreeBot(bot: Omit<CustomFreeBot, 'savedAt'>): Promise<CustomFreeBot> {
    const existing = await getCustomFreeBots();
    const savedBot: CustomFreeBot = { ...bot, savedAt: Date.now() };
    const withoutDuplicate = existing.filter(item => item.id !== bot.id && item.xml !== bot.xml);
    await localForage.setItem(CUSTOM_FREE_BOTS_STORAGE_KEY, [...withoutDuplicate, savedBot]);
    return savedBot;
}

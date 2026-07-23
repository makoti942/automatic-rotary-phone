export type TBotsManifestItem = {
    name: string;
    file: string;
    description?: string;
    difficulty?: string;
    strategy?: string;
    features?: string[];
};

const memoryCache = new Map<string, string>();
let XML_BASE = '/xml/';
export const getXmlBase = () => XML_BASE;

export const getCachedXml = async (file: string): Promise<string | null> => {
    return memoryCache.get(file) || null;
};

export const setCachedXml = async (file: string, xml: string) => {
    memoryCache.set(file, xml);
};

export const fetchXmlWithCache = async (file: string): Promise<string | null> => {
    if (memoryCache.has(file)) return memoryCache.get(file)!;
    try {
        const res = await fetch(`${getXmlBase()}${encodeURIComponent(file)}`);
        if (!res.ok) return null;
        const xml = await res.text();
        memoryCache.set(file, xml);
        return xml;
    } catch { return null; }
};

export const prefetchAllXmlInBackground = async (files: string[]) => {
    const batchSize = 3;
    for (let i = 0; i < files.length; i += batchSize) {
        await Promise.allSettled(files.slice(i, i + batchSize).map(f => fetchXmlWithCache(f)));
    }
};

export const getBotsManifest = async (): Promise<TBotsManifestItem[] | null> => {
    try {
        const res = await fetch('/xml/bots.json', { cache: 'force-cache' });
        if (!res.ok) return null;
        const data = await res.json();
        return Array.isArray(data) ? data : null;
    } catch { return null; }
};

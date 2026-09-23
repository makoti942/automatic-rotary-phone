/**
 * Firebase Realtime Database REST API — zero dependencies.
 */

const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyAj4CacWMYN0iCHbDz7vVUQ-ujEs6R8s0o',
    authDomain: 'makoti-6ba23.firebaseapp.com',
    databaseURL: 'https://makoti-6ba23-default-rtdb.firebaseio.com',
    projectId: 'makoti-6ba23',
    storageBucket: 'makoti-6ba23.firebasestorage.app',
    messagingSenderId: '921946129628',
    appId: '1:921946129628:web:9173f94cff073c78b3e019',
    measurementId: 'G-WESX4VSSP9',
};

const DB_URL = FIREBASE_CONFIG.databaseURL;

async function dbGet(path: string) {
    const res = await fetch(`${DB_URL}/${path}.json`);
    if (!res.ok) return null;
    return res.json();
}

export async function dbSet(path: string, data: unknown) {
    const res = await fetch(`${DB_URL}/${path}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return res.ok;
}

async function dbRemove(path: string) {
    const res = await fetch(`${DB_URL}/${path}.json`, { method: 'DELETE' });
    return res.ok;
}

// ── Types ──────────────────────────────────────────────────────
export interface MasterProfile {
    name: string;
    account_id: string;
    created_at: number;
}

export interface FollowerEntry {
    token: string;
    name: string;
    account_id: string;
    created_at: number;
}

export interface FollowerStats {
    totalTrades: number;
    wins: number;
    losses: number;
    totalPnl: number;
    contracts: { id: string; type: string; stake: number; pnl: number; time: number }[];
}

// ── Master CRUD ────────────────────────────────────────────────
export async function getMaster(masterId: string): Promise<MasterProfile | null> {
    return dbGet(`masters/${masterId}`);
}

export async function setMaster(masterId: string, profile: MasterProfile): Promise<boolean> {
    return dbSet(`masters/${masterId}`, profile);
}

export async function removeMaster(masterId: string): Promise<boolean> {
    return dbRemove(`masters/${masterId}`);
}

export async function getAllMasters(): Promise<Record<string, MasterProfile>> {
    const data = await dbGet('masters');
    if (!data) return {};
    const result: Record<string, MasterProfile> = {};
    for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object') {
            const v = value as any;
            // Masters have created_at but NOT token (followers have token)
            if (v.account_id && v.name && v.created_at && !v.token) {
                result[key] = v as MasterProfile;
            }
        }
    }
    return result;
}

// ── Follower CRUD ──────────────────────────────────────────────
export async function addFollower(
    masterId: string,
    followerId: string,
    entry: FollowerEntry
): Promise<boolean> {
    return dbSet(`masters/${masterId}/followers/${followerId}`, entry);
}

export async function removeFollower(masterId: string, followerId: string): Promise<boolean> {
    return dbRemove(`masters/${masterId}/followers/${followerId}`);
}

export async function getFollowers(
    masterId: string
): Promise<Record<string, FollowerEntry> | null> {
    return dbGet(`masters/${masterId}/followers`);
}

// ── Follower Stats ──────────────────────────────────────────────
export async function getFollowerStats(
    masterId: string,
    followerId: string
): Promise<FollowerStats | null> {
    return dbGet(`masters/${masterId}/followers/${followerId}/stats`);
}

export async function setFollowerStats(
    masterId: string,
    followerId: string,
    stats: FollowerStats
): Promise<boolean> {
    return dbSet(`masters/${masterId}/followers/${followerId}/stats`, stats);
}

export async function clearFollowerStats(
    masterId: string,
    followerId: string
): Promise<boolean> {
    const empty: FollowerStats = { totalTrades: 0, wins: 0, losses: 0, totalPnl: 0, contracts: [] };
    return setFollowerStats(masterId, followerId, empty);
}

/**
 * Firebase Realtime Database REST API — zero dependencies.
 *
 * SETUP:
 * 1. Go to https://console.firebase.google.com → Create project
 * 2. Go to Realtime Database → Create database → Start in test mode
 * 3. Go to Project Settings → General → Your apps → Add web app
 * 4. Copy the config object and paste below
 * 5. Go to Realtime Database → Rules → set read/write to true (or use auth)
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

// ── Helpers ────────────────────────────────────────────────────
async function dbGet(path: string) {
    const res = await fetch(`${DB_URL}/${path}.json`);
    if (!res.ok) return null;
    return res.json();
}

async function dbSet(path: string, data: unknown) {
    const res = await fetch(`${DB_URL}/${path}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return res.ok;
}

async function dbPush(path: string, data: unknown) {
    const res = await fetch(`${DB_URL}/${path}.json`, {
        method: 'POST',
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

export async function isFollowerConnected(
    masterId: string,
    followerId: string
): Promise<FollowerEntry | null> {
    return dbGet(`masters/${masterId}/followers/${followerId}`);
}

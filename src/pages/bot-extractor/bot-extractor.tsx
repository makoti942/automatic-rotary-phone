import React, { useState, useCallback } from 'react';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import './bot-extractor.scss';

interface ExtractedBot {
    name: string;
    xml: string;
    source: string;
    size: number;
    fromTab: string;
}

const CORS_PROXIES = [
    (url: string) => `/api/proxy?url=${encodeURIComponent(url)}`,
    (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

const BotExtractor = () => {
    const { dashboard, load_modal } = useStore();
    const { setActiveTab } = dashboard;

    const [url, setUrl] = useState('');
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractedBots, setExtractedBots] = useState<ExtractedBot[]>([]);
    const [error, setError] = useState('');
    const [progress, setProgress] = useState('');
    const [loadedBots, setLoadedBots] = useState<Set<string>>(new Set());
    const [scanLog, setScanLog] = useState<string[]>([]);

    const addLog = useCallback((msg: string) => {
        setScanLog(prev => [...prev, msg]);
    }, []);

    const fetchText = useCallback(async (targetUrl: string): Promise<string> => {
        for (const proxyFn of CORS_PROXIES) {
            try {
                const proxyUrl = proxyFn(targetUrl);
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 20000);
                const res = await fetch(proxyUrl, { signal: controller.signal });
                clearTimeout(timeout);
                if (res.ok) {
                    const text = await res.text();
                    if (text && text.length > 50) return text;
                }
            } catch {}
        }
        throw new Error('All proxies failed');
    }, []);

    const extractBots = useCallback(async () => {
        if (!url.trim()) { setError('Please enter a URL'); return; }

        let targetUrl = url.trim();
        if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

        setIsExtracting(true);
        setError('');
        setExtractedBots([]);
        setScanLog([]);

        const allBots: ExtractedBot[] = [];
        const visited = new Set<string>();

        const isValidUrl = (u: string) => { try { new URL(u); return true; } catch { return false; } };
        const isSameDomain = (u: string, base: string) => { try { return new URL(u).hostname === new URL(base).hostname; } catch { return false; } };

        try {
            const baseUrl = new URL(targetUrl).origin;

            // ===== STEP 1: Fetch main page, find all tabs/links =====
            addLog('--- Step 1: Scanning main page for tabs ---');
            setProgress('Finding all tabs on the site...');
            const mainHtml = await fetchText(targetUrl);
            const mainDoc = new DOMParser().parseFromString(mainHtml, 'text/html');

            // Find navigation tabs and page links
            const tabs: { name: string; href: string }[] = [];
            mainDoc.querySelectorAll('a[href]').forEach(a => {
                const href = a.getAttribute('href');
                const text = (a.textContent || '').trim();
                if (href && text && !href.match(/\.(png|jpg|gif|svg|css|js|ico|woff|ttf)/i)) {
                    try {
                        const full = new URL(href, targetUrl).href;
                        if (isSameDomain(full, targetUrl) && isValidUrl(full) && !full.includes('#') && !visited.has(full)) {
                            tabs.push({ name: text, href: full });
                            visited.add(full);
                        }
                    } catch {}
                }
            });
            addLog(`Found ${tabs.length} tab(s)/page(s) on the site:`);
            tabs.forEach(t => addLog(`  - ${t.name}: ${t.href}`));

            // ===== STEP 2: Scan each tab for .xml bot links =====
            addLog('\n--- Step 2: Checking each tab for bots ---');
            setProgress(`Checking ${tabs.length} tabs for bots...`);

            const botTabs: { name: string; href: string; xmlLinks: string[] }[] = [];

            for (const tab of tabs) {
                try {
                    addLog(`\nChecking: ${tab.name} (${tab.href})`);
                    setProgress(`Checking: ${tab.name}...`);
                    const tabHtml = await fetchText(tab.href);
                    const tabDoc = new DOMParser().parseFromString(tabHtml, 'text/html');

                    const xmlLinks: string[] = [];

                    // Find .xml links on this tab
                    tabDoc.querySelectorAll('a[href*=".xml"]').forEach(el => {
                        const href = el.getAttribute('href');
                        if (href) {
                            try {
                                const full = new URL(href, tab.href).href;
                                if (isSameDomain(full, baseUrl)) xmlLinks.push(full);
                            } catch {}
                        }
                    });

                    if (xmlLinks.length > 0) {
                        botTabs.push({ name: tab.name, href: tab.href, xmlLinks });
                        addLog(`  ✅ Found ${xmlLinks.length} .xml bot(s) on "${tab.name}"`);
                        xmlLinks.forEach(l => addLog(`    - ${l.split('/').pop()}`));
                    } else {
                        addLog(`  ❌ No bots on "${tab.name}"`);
                    }
                } catch (err) {
                    addLog(`  ⚠️ Could not load "${tab.name}"`);
                }
            }

            // ===== STEP 3: Also scan JS bundles for .xml filenames =====
            addLog('\n--- Step 3: Scanning JavaScript for bot filenames ---');
            setProgress('Scanning JavaScript...');
            const jsUrls: string[] = [];
            mainDoc.querySelectorAll('script[src]').forEach(s => {
                const src = s.getAttribute('src');
                if (src && src.includes('.js')) {
                    try { jsUrls.push(new URL(src, targetUrl).href); } catch {}
                }
            });

            // Find chunk maps in JS bundles
            const chunkUrls = new Set<string>();
            for (const jsUrl of [...jsUrls]) {
                try {
                    const jsContent = await fetchText(jsUrl);

                    // Find .xml filenames in string literals
                    const xmlMatches = [...jsContent.matchAll(/["'`]([a-zA-Z0-9_ .\-]+\.xml)["'`]/gi)];
                    for (const m of xmlMatches) {
                        const fileName = m[1];
                        if (fileName.length > 3 && !fileName.includes('blockly') && !fileName.includes('module$')) {
                            // Try common directories
                            for (const dir of ['/xml/', '/bots/', '/public/xml/', '/assets/xml/', '/static/xml/', '/files/']) {
                                const tryUrl = `${baseUrl}${dir}${fileName}`;
                                if (!visited.has(tryUrl)) {
                                    visited.add(tryUrl);
                                    // Check if this XML is valid
                                    try {
                                        const content = await fetchText(tryUrl);
                                        if (content && (content.includes('<block') || content.includes('<xml'))) {
                                            const name = fileName.replace('.xml', '').replace(/[_-]/g, ' ');
                                            allBots.push({
                                                name,
                                                xml: content.trim(),
                                                source: tryUrl,
                                                size: content.length,
                                                fromTab: 'JavaScript',
                                            });
                                            addLog(`  Found in JS: ${fileName}`);
                                        }
                                    } catch {}
                                }
                            }
                        }
                    }

                    // Find chunk hash maps
                    const chunkEntries = [...jsContent.matchAll(/(\d+):"([a-f0-9]{6,8})"/g)];
                    for (const entry of chunkEntries) {
                        const chunkUrl = `${baseUrl}/static/js/${entry[1]}.${entry[2]}.js`;
                        if (!chunkUrls.has(chunkUrl)) chunkUrls.add(chunkUrl);
                    }
                } catch {}
            }

            // Scan chunks for more .xml references
            if (chunkUrls.size > 0) {
                addLog(`Scanning ${chunkUrls.size} JS chunks...`);
                await Promise.allSettled(
                    [...chunkUrls].map(async (chunkUrl) => {
                        try {
                            const chunkContent = await fetchText(chunkUrl);
                            const matches = [...chunkContent.matchAll(/["'`]([a-zA-Z0-9_ .\-]+\.xml)["'`]/gi)];
                            for (const m of matches) {
                                const fileName = m[1];
                                if (fileName.length > 3 && !fileName.includes('blockly') && !fileName.includes('module$')) {
                                    for (const dir of ['/xml/', '/bots/', '/public/xml/', '/assets/xml/']) {
                                        const tryUrl = `${baseUrl}${dir}${fileName}`;
                                        if (!visited.has(tryUrl)) {
                                            visited.add(tryUrl);
                                            try {
                                                const content = await fetchText(tryUrl);
                                                if (content && (content.includes('<block') || content.includes('<xml'))) {
                                                    const name = fileName.replace('.xml', '').replace(/[_-]/g, ' ');
                                                    allBots.push({
                                                        name,
                                                        xml: content.trim(),
                                                        source: tryUrl,
                                                        size: content.length,
                                                        fromTab: 'JavaScript Chunk',
                                                    });
                                                    addLog(`  Found in chunk: ${fileName}`);
                                                }
                                            } catch {}
                                        }
                                    }
                                }
                            }
                        } catch {}
                    })
                );
            }

            // ===== STEP 4: Fetch all .xml files from bot tabs =====
            addLog('\n--- Step 4: Fetching all .xml bot files ---');
            setProgress(`Fetching .xml files from ${botTabs.length} bot tab(s)...`);

            for (const botTab of botTabs) {
                addLog(`\nFetching bots from "${botTab.name}":`);
                for (const xmlUrl of botTab.xmlLinks) {
                    if (visited.has(xmlUrl) && allBots.some(b => b.source === xmlUrl)) continue;
                    visited.add(xmlUrl);
                    try {
                        const content = await fetchText(xmlUrl);
                        if (content && (content.includes('<block') || content.includes('<xml'))) {
                            const fileName = decodeURIComponent(xmlUrl.split('/').pop()?.split('?')[0]?.replace('.xml', '') || 'Unknown');
                            const name = fileName.replace(/[_-]/g, ' ');
                            allBots.push({
                                name,
                                xml: content.trim(),
                                source: xmlUrl,
                                size: content.length,
                                fromTab: botTab.name,
                            });
                            addLog(`  ✅ ${fileName} (${(content.length / 1024).toFixed(1)} KB)`);
                        } else {
                            addLog(`  ❌ ${xmlUrl.split('/').pop()}: not a valid bot`);
                        }
                    } catch {
                        addLog(`  ❌ ${xmlUrl.split('/').pop()}: failed to fetch`);
                    }
                }
            }

            // ===== STEP 5: Summary =====
            addLog(`\n=== COMPLETE ===`);
            addLog(`Total bots found: ${allBots.length}`);
            botTabs.forEach(t => addLog(`  From "${t.name}": ${t.xmlLinks.length} bot(s)`);

            setExtractedBots(allBots);
            setProgress('');

            if (allBots.length === 0) {
                setError('No bots found on any tab. The site may load bots dynamically or use a non-standard format.');
            }
        } catch (err: any) {
            setError(`Extraction failed: ${err.message}`);
            setProgress('');
        } finally {
            setIsExtracting(false);
        }
    }, [url, fetchText, addLog]);

    const loadBotToBuilder = useCallback(async (bot: ExtractedBot) => {
        if (!bot.xml) return;
        const tempId = `extracted_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        try {
            await load_modal.loadStrategyToBuilder(
                { id: tempId, xml: bot.xml, name: bot.name, save_type: 'pending' },
                true
            );
            setLoadedBots(prev => new Set(prev).add(bot.source));
            setActiveTab(DBOT_TABS.BOT_BUILDER);
        } catch (err: any) {
            setError(`Failed to load bot: ${err.message}`);
        }
    }, [load_modal, setActiveTab]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !isExtracting) extractBots();
    }, [extractBots, isExtracting]);

    return (
        <div className='bot-extractor'>
            <div className='bot-extractor__header'>
                <h2 className='bot-extractor__title'>Bot Extractor</h2>
                <p className='bot-extractor__subtitle'>
                    Scan any Deriv site, find the tab with bots, and extract them all
                </p>
            </div>

            <div className='bot-extractor__input-section'>
                <div className='bot-extractor__input-row'>
                    <input
                        type='text'
                        className='bot-extractor__input'
                        placeholder='Paste site URL (e.g. https://example.com)'
                        value={url}
                        onChange={e => setUrl(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={isExtracting}
                    />
                    <button
                        className='bot-extractor__btn bot-extractor__btn--extract'
                        onClick={extractBots}
                        disabled={isExtracting || !url.trim()}
                    >
                        {isExtracting ? (
                            <><span className='bot-extractor__spinner' /> Extracting...</>
                        ) : (
                            'Extract Bots'
                        )}
                    </button>
                </div>
                {progress && <div className='bot-extractor__progress'>{progress}</div>}
                {error && <div className='bot-extractor__error'>{error}</div>}

                {scanLog.length > 0 && (
                    <div className='bot-extractor__log'>
                        <div className='bot-extractor__log-title' onClick={() => {
                            const el = document.querySelector('.bot-extractor__log-content');
                            if (el) el.classList.toggle('bot-extractor__log-content--collapsed');
                        }}>
                            Scan Log ({scanLog.length} entries) ▾
                        </div>
                        <div className='bot-extractor__log-content'>
                            {scanLog.map((entry, i) => (
                                <div key={i} className='bot-extractor__log-entry'>{entry}</div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {extractedBots.length > 0 && (
                <div className='bot-extractor__results'>
                    <div className='bot-extractor__results-header'>
                        <h3>Extracted Bots ({extractedBots.length})</h3>
                        <p className='bot-extractor__results-subtitle'>
                            Real .xml files copied from the site — ready to use
                        </p>
                    </div>

                    <div className='bot-extractor__bot-list'>
                        {extractedBots.map((bot, index) => (
                            <div key={index} className='bot-extractor__bot-card'>
                                <div className='bot-extractor__bot-info'>
                                    <div className='bot-extractor__bot-name'>{bot.name}</div>
                                    <div className='bot-extractor__bot-meta'>
                                        <span className='bot-extractor__bot-tab'>{bot.fromTab}</span>
                                        <span className='bot-extractor__bot-size'>
                                            {(bot.size / 1024).toFixed(1)} KB
                                        </span>
                                    </div>
                                </div>
                                <button
                                    className={`bot-extractor__btn bot-extractor__btn--load ${loadedBots.has(bot.source) ? 'bot-extractor__btn--loaded' : ''}`}
                                    onClick={() => loadBotToBuilder(bot)}
                                    disabled={loadedBots.has(bot.source)}
                                >
                                    {loadedBots.has(bot.source) ? 'Loaded ✓' : 'Load to Builder'}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {!isExtracting && extractedBots.length === 0 && !error && (
                <div className='bot-extractor__empty'>
                    <div className='bot-extractor__empty-icon'>🔍</div>
                    <p>Paste a URL above and click Extract to scan for bots</p>
                    <p className='bot-extractor__empty-hint'>
                        Scans every tab on the site, finds the one with .xml bot files, and extracts them all
                    </p>
                </div>
            )}
        </div>
    );
};

export default BotExtractor;

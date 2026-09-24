import React, { useState, useCallback } from 'react';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import './bot-extractor.scss';

interface ExtractedBot {
    name: string;
    xml: string;
    source: string;
    size: number;
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
        const seenXmlUrls = new Set<string>();
        const xmlUrlsToFetch = new Set<string>();

        const isValidUrl = (u: string) => { try { new URL(u); return true; } catch { return false; } };
        const isSameDomain = (u: string, base: string) => { try { return new URL(u).hostname === new URL(base).hostname; } catch { return false; } };

        try {
            const baseUrl = new URL(targetUrl).origin;

            // Step 1: Fetch main page + find all .xml links + all page links
            addLog(`Fetching: ${targetUrl}`);
            setProgress('Scanning main page...');
            const html = await fetchText(targetUrl);
            const doc = new DOMParser().parseFromString(html, 'text/html');

            // Find .xml links in main page
            doc.querySelectorAll('a[href$=".xml"], link[href$=".xml"]').forEach(el => {
                const href = el.getAttribute('href');
                if (href) {
                    try {
                        const full = new URL(href, targetUrl).href;
                        if (!seenXmlUrls.has(full)) { xmlUrlsToFetch.add(full); seenXmlUrls.add(full); }
                    } catch {}
                }
            });

            // Find all same-domain page links
            const pageLinks: string[] = [];
            doc.querySelectorAll('a[href]').forEach(a => {
                const href = a.getAttribute('href');
                if (href && !href.match(/\.(png|jpg|gif|svg|css|js|ico|woff|ttf|css\?|js\?)/i)) {
                    try {
                        const full = new URL(href, targetUrl).href;
                        if (isSameDomain(full, targetUrl) && isValidUrl(full) && !full.includes('#')) {
                            pageLinks.push(full);
                        }
                    } catch {}
                }
            });
            addLog(`Main page: ${xmlUrlsToFetch.size} .xml links, ${pageLinks.length} page links`);

            // Step 2: Scan all linked pages for .xml links
            addLog(`Scanning ${pageLinks.length} linked pages for .xml files...`);
            setProgress(`Scanning ${pageLinks.length} pages for .xml links...`);

            await Promise.allSettled(
                pageLinks.map(async (link) => {
                    try {
                        const pageHtml = await fetchText(link);
                        const pageDoc = new DOMParser().parseFromString(pageHtml, 'text/html');
                        pageDoc.querySelectorAll('a[href$=".xml"], link[href$=".xml"], a[href*=".xml?"], a[href*=".xml#"]').forEach(el => {
                            const href = el.getAttribute('href');
                            if (href) {
                                try {
                                    const full = new URL(href, link).href;
                                    if (!seenXmlUrls.has(full) && isSameDomain(full, targetUrl)) {
                                        xmlUrlsToFetch.add(full);
                                        seenXmlUrls.add(full);
                                    }
                                } catch {}
                            }
                        });
                    } catch {}
                })
            );
            addLog(`Found ${xmlUrlsToFetch.size} .xml file(s) across all pages`);

            // Step 3: Scan JS bundles for .xml filename references
            addLog('Scanning JavaScript for .xml references...');
            setProgress('Scanning JavaScript bundles...');
            const jsUrls: string[] = [];
            doc.querySelectorAll('script[src]').forEach(s => {
                const src = s.getAttribute('src');
                if (src && src.includes('.js')) {
                    try {
                        const full = new URL(src, targetUrl).href;
                        jsUrls.push(full);
                    } catch {}
                }
            });

            // Find chunk hash maps and add lazy-loaded chunks
            for (const jsUrl of [...jsUrls]) {
                try {
                    const jsContent = await fetchText(jsUrl);
                    // Find .xml filenames in string literals
                    const xmlFileMatches = [...jsContent.matchAll(/["'`]([a-zA-Z0-9_ .\-]+\.xml)["'`]/gi)];
                    for (const m of xmlFileMatches) {
                        const fileName = m[1];
                        if (fileName.length > 3 && !fileName.includes('blockly') && !fileName.includes('module$') && !fileName.includes('.js')) {
                            // Try common directories
                            for (const dir of ['/xml/', '/bots/', '/public/xml/', '/assets/xml/', '/static/xml/', '/files/']) {
                                const tryUrl = `${baseUrl}${dir}${fileName}`;
                                if (!seenXmlUrls.has(tryUrl)) { xmlUrlsToFetch.add(tryUrl); seenXmlUrls.add(tryUrl); }
                            }
                        }
                    }

                    // Find chunk hash maps for lazy-loaded chunks
                    const chunkEntries = [...jsContent.matchAll(/(\d+):"([a-f0-9]{6,8})"/g)];
                    if (chunkEntries.length > 5) {
                        addLog(`  Found ${chunkEntries.length} chunks in ${jsUrl.split('/').pop()}`);
                        for (const entry of chunkEntries) {
                            const chunkUrl = `${baseUrl}/static/js/${entry[1]}.${entry[2]}.js`;
                            if (!seenXmlUrls.has(chunkUrl)) {
                                seenXmlUrls.add(chunkUrl);
                                jsUrls.push(chunkUrl);
                            }
                        }
                    }
                } catch {}
            }

            // Scan all JS (including chunks) for .xml references
            const newlyFoundXml = new Set<string>();
            await Promise.allSettled(
                jsUrls.map(async (jsUrl) => {
                    try {
                        const jsContent = await fetchText(jsUrl);
                        const matches = [...jsContent.matchAll(/["'`]([a-zA-Z0-9_ .\-]+\.xml)["'`]/gi)];
                        for (const m of matches) {
                            const fileName = m[1];
                            if (fileName.length > 3 && !fileName.includes('blockly') && !fileName.includes('module$')) {
                                for (const dir of ['/xml/', '/bots/', '/public/xml/', '/assets/xml/', '/static/xml/', '/files/']) {
                                    const tryUrl = `${baseUrl}${dir}${fileName}`;
                                    if (!seenXmlUrls.has(tryUrl)) { newlyFoundXml.add(tryUrl); seenXmlUrls.add(tryUrl); xmlUrlsToFetch.add(tryUrl); }
                                }
                            }
                        }
                    } catch {}
                })
            );
            if (newlyFoundXml.size > 0) addLog(`Found ${newlyFoundXml.size} more .xml file(s) in JS bundles`);

            // Step 4: Fetch each .xml file and extract the bot
            addLog(`Fetching ${xmlUrlsToFetch.size} .xml file(s)...`);
            setProgress(`Fetching ${xmlUrlsToFetch.size} .xml files...`);

            await Promise.allSettled(
                [...xmlUrlsToFetch].map(async (xmlUrl) => {
                    try {
                        const content = await fetchText(xmlUrl);
                        if (content && (content.includes('<block') || content.includes('<xml'))) {
                            const fileName = decodeURIComponent(xmlUrl.split('/').pop()?.split('?')[0]?.replace('.xml', '') || 'Unknown Bot');
                            const botName = fileName.replace(/[_-]/g, ' ');
                            allBots.push({
                                name: botName,
                                xml: content.trim(),
                                source: xmlUrl,
                                size: content.length,
                            });
                        }
                    } catch {}
                })
            );

            // Done
            setExtractedBots(allBots);
            setProgress('');
            addLog(`\n=== DONE: Found ${allBots.length} bot(s) with complete XML ===`);

            if (allBots.length === 0) {
                setError('No XML bots found. The site may load bots dynamically, or bots may not be in .xml format.');
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
                    Paste a Deriv third-party site URL to extract all its XML trading bots
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
                    </div>

                    <div className='bot-extractor__bot-list'>
                        {extractedBots.map((bot, index) => (
                            <div key={index} className='bot-extractor__bot-card'>
                                <div className='bot-extractor__bot-info'>
                                    <div className='bot-extractor__bot-name'>{bot.name}</div>
                                    <div className='bot-extractor__bot-meta'>
                                        <span className='bot-extractor__bot-source'>{bot.source.split('/').pop()}</span>
                                        {bot.size > 0 && (
                                            <span className='bot-extractor__bot-size'>
                                                {(bot.size / 1024).toFixed(1)} KB
                                            </span>
                                        )}
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
                        Scans all pages and JavaScript for .xml bot files, then downloads each one completely
                    </p>
                </div>
            )}
        </div>
    );
};

export default BotExtractor;

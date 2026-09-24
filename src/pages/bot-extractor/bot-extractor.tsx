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

const COMMON_XML_DIRS = [
    '/xml/', '/bots/', '/public/xml/', '/assets/xml/', '/static/xml/',
    '/files/', '/strategies/', '/downloads/',
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
                const timeout = setTimeout(() => controller.abort(), 30000);
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

        const isSameDomain = (u: string, base: string) => { try { return new URL(u).hostname === new URL(base).hostname; } catch { return false; } };

        try {
            const baseUrl = new URL(targetUrl).origin;

            // ===== STEP 1: Fetch main page, find JS bundles =====
            addLog('--- Step 1: Fetching main page ---');
            setProgress('Fetching main page...');
            const mainHtml = await fetchText(targetUrl);
            const mainDoc = new DOMParser().parseFromString(mainHtml, 'text/html');

            // Find all JS bundles
            const jsUrls: string[] = [];
            mainDoc.querySelectorAll('script[src]').forEach(s => {
                const src = s.getAttribute('src');
                if (src && src.includes('.js')) {
                    try { jsUrls.push(new URL(src, targetUrl).href); } catch {}
                }
            });
            addLog(`Found ${jsUrls.length} JS bundle(s)`);

            // ===== STEP 2: Scan JS for bot filenames =====
            addLog('\n--- Step 2: Scanning JS for bot filenames ---');
            setProgress('Scanning JavaScript for bot filenames...');

            const discoveredXmlFiles = new Set<string>();

            for (const jsUrl of jsUrls) {
                try {
                    const jsContent = await fetchText(jsUrl);
                    const shortName = jsUrl.split('/').pop() || jsUrl;
                    addLog(`Scanning: ${shortName} (${(jsContent.length / 1024).toFixed(0)} KB)`);

                    // Pattern 1: Find arrays of .xml filenames (like getXmlFiles())
                    // Looks for: ['FILE1.xml', 'FILE2.xml', ...] or ["FILE1.xml", ...]
                    const arrayPattern = /(?:return\s*)?\[([\s\S]*?)\]/g;
                    let arrayMatch;
                    while ((arrayMatch = arrayPattern.exec(jsContent)) !== null) {
                        const arrayContent = arrayMatch[1];
                        const xmlFiles = [...arrayContent.matchAll(/['"`]([a-zA-Z0-9_ .\-]+\.xml)['"`]/gi)];
                        if (xmlFiles.length >= 2) {
                            addLog(`  Found array with ${xmlFiles.length} .xml files:`);
                            for (const m of xmlFiles) {
                                discoveredXmlFiles.add(m[1]);
                                addLog(`    ${m[1]}`);
                            }
                        }
                    }

                    // Pattern 2: Find .xml filenames in string literals
                    const singleXml = [...jsContent.matchAll(/['"`]([a-zA-Z0-9_ .\-]+\.xml)['"`]/gi)];
                    for (const m of singleXml) {
                        const fileName = m[1];
                        if (fileName.length > 3 && !fileName.includes('blockly') && !fileName.includes('module$') && !fileName.includes('window.')) {
                            discoveredXmlFiles.add(fileName);
                        }
                    }

                    // Pattern 3: Find embedded <xml>...</xml> blocks (SPA sites bundle XML in JS)
                    let pos = 0;
                    while (pos < jsContent.length) {
                        const xmlStart = jsContent.indexOf('<xml', pos);
                        if (xmlStart === -1) break;
                        const xmlEnd = jsContent.indexOf('</xml>', xmlStart);
                        if (xmlEnd === -1) { pos = xmlStart + 4; continue; }

                        let xml = jsContent.substring(xmlStart, xmlEnd + 6);
                        xml = xml.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
                            .replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\//g, '/');

                        if (xml.length > 100 && xml.includes('<block') && !allBots.some(b => b.xml === xml)) {
                            const catMatch = xml.match(/<category[^>]*name=["']([^"']+)["']/i);
                            const blockMatch = xml.match(/type=["']([a-z_]+)["']/i);
                            const name = catMatch?.[1] || blockMatch?.[1] || `Bot ${allBots.length + 1}`;
                            allBots.push({
                                name,
                                xml,
                                source: jsUrl,
                                size: xml.length,
                                fromTab: 'Embedded in JS',
                            });
                            addLog(`  Embedded bot: ${name} (${(xml.length / 1024).toFixed(1)} KB)`);
                        }
                        pos = xmlEnd + 6;
                    }
                } catch {
                    addLog(`  ⚠️ Failed to scan bundle`);
                }
            }

            addLog(`\nDiscovered ${discoveredXmlFiles.size} .xml filename(s) from JS`);

            // ===== STEP 3: Fetch each .xml file =====
            addLog('\n--- Step 3: Fetching .xml files ---');
            setProgress(`Fetching ${discoveredXmlFiles.size} .xml file(s)...`);

            for (const fileName of discoveredXmlFiles) {
                for (const dir of COMMON_XML_DIRS) {
                    const tryUrl = `${baseUrl}${dir}${fileName}`;
                    if (!visited.has(tryUrl)) {
                        visited.add(tryUrl);
                        try {
                            const content = await fetchText(tryUrl);
                            if (content && (content.includes('<block') || content.includes('<xml')) && content.length > 200) {
                                const botName = fileName.replace('.xml', '').replace(/[_-]/g, ' ');
                                allBots.push({
                                    name: botName,
                                    xml: content.trim(),
                                    source: tryUrl,
                                    size: content.length,
                                    fromTab: dir,
                                });
                                addLog(`  ✅ ${fileName} from ${dir} (${(content.length / 1024).toFixed(1)} KB)`);
                                break; // Found it, don't try other dirs
                            }
                        } catch {}
                    }
                }
            }

            // ===== STEP 4: Scan linked pages for .xml links =====
            addLog('\n--- Step 4: Checking linked pages for .xml links ---');
            setProgress('Checking linked pages...');
            const pageLinks: string[] = [];
            mainDoc.querySelectorAll('a[href]').forEach(a => {
                const href = a.getAttribute('href');
                if (href && !href.match(/\.(png|jpg|gif|svg|css|js|ico|woff|ttf)/i)) {
                    try {
                        const full = new URL(href, targetUrl).href;
                        if (isSameDomain(full, baseUrl) && !visited.has(full) && !full.includes('#')) {
                            pageLinks.push(full);
                        }
                    } catch {}
                }
            });

            await Promise.allSettled(
                pageLinks.slice(0, 20).map(async (link) => {
                    try {
                        const pageHtml = await fetchText(link);
                        const pageDoc = new DOMParser().parseFromString(pageHtml, 'text/html');
                        pageDoc.querySelectorAll('a[href*=".xml"]').forEach(el => {
                            const href = el.getAttribute('href');
                            if (href) {
                                try {
                                    const full = new URL(href, link).href;
                                    if (!visited.has(full) && isSameDomain(full, baseUrl)) {
                                        visited.add(full);
                                        // Will fetch below
                                    }
                                } catch {}
                            }
                        });
                    } catch {}
                })
            );

            // ===== DONE =====
            addLog(`\n=== COMPLETE ===`);
            addLog(`Total bots found: ${allBots.length}`);

            setExtractedBots(allBots);
            setProgress('');

            if (allBots.length === 0) {
                setError('No bots found. The site may use a non-standard format.');
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
                    Scan any Deriv site — finds bot filenames from JS bundles and .xml files
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
                            Real bots copied from the site — ready to load and trade
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
                        Scans JS bundles for .xml filenames and embedded XML, then downloads each bot
                    </p>
                </div>
            )}
        </div>
    );
};

export default BotExtractor;

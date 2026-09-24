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

function isValidDerivBot(content: string): boolean {
    if (!content || typeof content !== 'string') return false;
    const trimmed = content.trim();
    if (trimmed.length < 200) return false;
    if (trimmed.length > 500000) return false;
    if (trimmed.includes('<!DOCTYPE html') || trimmed.includes('<html')) return false;
    if (trimmed.includes('MODULE_NOT_FOUND') || trimmed.includes('Cannot find module')) return false;
    if (!trimmed.startsWith('<xml') && !trimmed.startsWith('<?xml')) return false;
    if (!trimmed.includes('<block')) return false;
    if (!trimmed.includes('type="')) return false;
    const blockCount = (trimmed.match(/<block /g) || []).length;
    if (blockCount < 2) return false;
    return true;
}

function extractEmbeddedBotsFromJs(jsContent: string, jsSource: string, seenContent: Set<string>): { name: string; xml: string; source: string; size: number }[] {
    const results: { name: string; xml: string; source: string; size: number }[] = [];
    const escapePatterns = [
        { open: '\\u003cxml', close: '\\u003c/xml\\u003e', esc: true },
        { open: '\\u003Cxml', close: '\\u003C/xml\\u003E', esc: true },
        { open: '\\x3cxml', close: '\\x3c/xml\\x3e', esc: true },
        { open: '\\x3Cxml', close: '\\x3C/xml\\x3E', esc: true },
        { open: '<xml', close: '</xml>', esc: false },
        { open: '<XML', close: '</XML>', esc: false },
    ];

    for (const { open, close, esc } of escapePatterns) {
        let pos = 0;
        while (pos < jsContent.length) {
            const start = jsContent.indexOf(open, pos);
            if (start === -1) break;
            const end = jsContent.indexOf(close, start + open.length);
            if (end === -1) { pos = start + open.length; continue; }

            let xml = jsContent.substring(start, end + close.length);
            if (esc) {
                xml = xml
                    .replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>')
                    .replace(/\\u003C/gi, '<').replace(/\\u003E/gi, '>')
                    .replace(/\\x3c/gi, '<').replace(/\\x3e/gi, '>')
                    .replace(/\\x3C/gi, '<').replace(/\\x3E/gi, '>')
                    .replace(/\\n/g, '\n').replace(/\\t/g, '\t')
                    .replace(/\\"/g, '"').replace(/\\'/g, "'");
            }

            if (xml.length > 500 && xml.includes('<block') && !seenContent.has(xml)) {
                const blockCount = (xml.match(/<block /g) || []).length;
                if (xml.trimStart().startsWith('<xml') && xml.includes('type="') && blockCount >= 3) {
                    const name = guessNameFromContext(jsContent, start, xml);
                    seenContent.add(xml);
                    results.push({ name, xml: xml.trim(), source: 'embedded:' + jsSource, size: xml.length });
                }
            }
            pos = end + close.length;
        }
    }

    const derivKeywords = ['trade_definition', 'bot_run', 'purchase', 'submarket', 'INITIAL_STAKE', 'take_profit', 'stop_loss', 'entry_digit', 'prediction', 'deriv_bot'];
    let keywordPos = 0;
    while (keywordPos < jsContent.length) {
        let earliest = -1;
        let earliestKw = '';
        for (const kw of derivKeywords) {
            const idx = jsContent.indexOf(kw, keywordPos);
            if (idx !== -1 && (earliest === -1 || idx < earliest)) {
                earliest = idx;
                earliestKw = kw;
            }
        }
        if (earliest === -1) break;

        let xmlStart = earliest;
        for (let i = earliest; i >= Math.max(0, earliest - 2000); i--) {
            if (jsContent.substring(i, i + 4) === '<xml') { xmlStart = i; break; }
            if (jsContent.substring(i, i + 11) === '\\u003cxml') { xmlStart = i; break; }
            if (jsContent.substring(i, i + 8) === '\\x3cxml') { xmlStart = i; break; }
        }

        let xmlEnd = -1;
        const searchFrom = Math.min(jsContent.length, earliest + 50000);
        for (let i = earliest; i < searchFrom; i++) {
            if (jsContent.substring(i - 5, i + 1) === '</xml>') { xmlEnd = i + 6; break; }
            if (jsContent.substring(i - 10, i + 6) === '/xml\\u003e') { xmlEnd = i + 6; break; }
            if (jsContent.substring(i - 9, i + 5) === '/xml\\x3e') { xmlEnd = i + 5; break; }
        }

        if (xmlEnd > xmlStart) {
            let xml = jsContent.substring(xmlStart, xmlEnd);
            xml = xml
                .replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>')
                .replace(/\\u003C/gi, '<').replace(/\\u003E/gi, '>')
                .replace(/\\x3c/gi, '<').replace(/\\x3e/gi, '>')
                .replace(/\\x3C/gi, '<').replace(/\\x3E/gi, '>')
                .replace(/\\n/g, '\n').replace(/\\t/g, '\t')
                .replace(/\\"/g, '"').replace(/\\'/g, "'");

            if (xml.length > 500 && xml.includes('<block') && xml.trimStart().startsWith('<xml') && !seenContent.has(xml)) {
                const blockCount = (xml.match(/<block /g) || []).length;
                if (blockCount >= 3) {
                    const name = guessNameFromContext(jsContent, xmlStart, xml);
                    seenContent.add(xml);
                    results.push({ name, xml: xml.trim(), source: 'embedded:' + jsSource, size: xml.length });
                }
            }
            keywordPos = xmlEnd;
        } else {
            keywordPos = earliest + earliestKw.length;
        }
    }

    return results;
}

function guessNameFromContext(jsContent: string, position: number, xml: string): string {
    const nameFromField = xml.match(/<field name="BOT_NAME">([^<]+)<\/field>/i);
    if (nameFromField) return nameFromField[1].trim();
    const nameFromMutation = xml.match(/<mutation[^>]*bot_name=["']([^"']+)["']/i);
    if (nameFromMutation) return nameFromMutation[1].trim();

    const contextBefore = jsContent.substring(Math.max(0, position - 500), position);
    const varMatch = contextBefore.match(/(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*["'`][^"'`]*$/g);
    if (varMatch) {
        const last = varMatch[varMatch.length - 1];
        const name = last.replace(/(?:const|let|var)\s+/, '').replace(/\s*=.*/, '').trim();
        if (name.length > 2 && name.length < 60) return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
    }
    const propMatch = contextBefore.match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*["'`][^"'`]*$/g);
    if (propMatch) {
        const last = propMatch[propMatch.length - 1];
        const name = last.replace(/\s*:.*$/, '').trim();
        if (name.length > 2 && name.length < 60 && !['return', 'const', 'let', 'var', 'function'].includes(name)) {
            return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
        }
    }
    const fileMatch = contextBefore.match(/["']([A-Za-z][A-Za-z0-9_-]+)\.xml["']/g);
    if (fileMatch) {
        const last = fileMatch[fileMatch.length - 1].replace(/["']/g, '').replace('.xml', '');
        return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
    }
    return `Bot ${Math.floor(position / 100)}`;
}

const BotExtractor = () => {
    const { dashboard, load_modal } = useStore();
    const { setActiveTab } = dashboard;

    const [url, setUrl] = useState('');
    const [isExtracting, setIsExtracting] = useState(false);
    const [isDeepExtracting, setIsDeepExtracting] = useState(false);
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
        const seenContent = new Set<string>();
        const discoveredFiles = new Set<string>();

        const isSameDomain = (u: string, base: string) => { try { return new URL(u).hostname === new URL(base).hostname; } catch { return false; } };

        const fetchTextSafe = async (fUrl: string, timeout = 15000): Promise<string | null> => {
            for (const proxyFn of CORS_PROXIES) {
                try {
                    const proxyUrl = proxyFn(fUrl);
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), timeout);
                    const res = await fetch(proxyUrl, { signal: controller.signal });
                    clearTimeout(timer);
                    if (res.ok) {
                        const text = await res.text();
                        if (text && text.length > 50) return text;
                    }
                } catch {}
            }
            return null;
        };

        const discoverXml = (content: string) => {
            const patterns = [
                /["']([A-Za-z][A-Za-z0-9_ .-]+\.xml)["']/g,
                /\/([A-Za-z][A-Za-z0-9_ .-]+\.xml)/g,
            ];
            for (const regex of patterns) {
                let m;
                while ((m = regex.exec(content)) !== null) {
                    let fname = m[1] || m[0];
                    if (!fname.endsWith('.xml') || fname.length < 5 || fname.length > 80) continue;
                    fname = fname.replace(/^["'\/]+/, '').replace(/["']+$/, '');
                    if (fname.includes('blockly') || fname.includes('node_modules')) continue;
                    discoveredFiles.add(fname);
                }
            }
            const arr = /\[([^[\]]*\.xml[^[\]]*)\]/g;
            let am;
            while ((am = arr.exec(content)) !== null) {
                const items = am[1].match(/["']([A-Za-z][A-Za-z0-9_-]+\.xml)["']/g);
                if (items && items.length >= 2) {
                    for (const item of items) discoveredFiles.add(item.replace(/["']/g, ''));
                }
            }
        };

        try {
            const baseUrl = new URL(targetUrl).origin;

            addLog('--- Step 1: Fetching main page ---');
            setProgress('Fetching main page...');
            const mainHtml = await fetchTextSafe(targetUrl);
            if (!mainHtml) throw new Error('Failed to fetch main page');
            discoverXml(mainHtml);
            addLog(`Main page scanned, ${discoveredFiles.size} .xml files found`);

            addLog('\n--- Step 2: Scanning JS bundles ---');
            setProgress('Scanning JavaScript bundles...');
            const jsUrls: string[] = [];
            const jsRegex = /<script[^>]+src=["']([^"']+\.js)["'][^>]*>/gi;
            let jm;
            while ((jm = jsRegex.exec(mainHtml)) !== null) {
                try { jsUrls.push(new URL(jm[1], targetUrl).href); } catch {}
            }
            addLog(`Found ${jsUrls.length} JS bundle(s)`);

            const jsResults = await Promise.allSettled(jsUrls.map(async (jsUrl) => {
                const js = await fetchTextSafe(jsUrl, 12000);
                if (js) {
                    discoverXml(js);
                    const embedded = extractEmbeddedBotsFromJs(js, jsUrl, seenContent);
                    for (const bot of embedded) {
                        allBots.push({ ...bot, fromTab: 'Embedded JS' });
                        addLog(`  Embedded: ${bot.name} (${(bot.size / 1024).toFixed(1)} KB)`);
                    }
                    const short = jsUrl.split('/').pop() || '';
                    addLog(`  ${short}: ${[...discoveredFiles].length} files so far`);
                }
            }));
            addLog(`After JS scan: ${discoveredFiles.size} .xml files, ${allBots.length} embedded bots`);

            addLog('\n--- Step 3: Crawling internal pages ---');
            setProgress('Crawling pages for .xml references...');
            const internalPages = new Set<string>();
            const linkRegex = /href=["']([^"'#][^"']*?)["']/gi;
            let lm;
            while ((lm = linkRegex.exec(mainHtml)) !== null) {
                try {
                    const full = new URL(lm[1], targetUrl).href;
                    if (isSameDomain(full, baseUrl)) internalPages.add(full);
                } catch {}
            }

            const botPageHints = ['free-bots', 'browse-bots', 'strategies', 'bots', 'library', 'market', 'trade', 'xml', 'bot', 'dashboard', 'workspace', 'editor', 'builder', 'create'];
            for (const hint of botPageHints) {
                for (const suffix of ['', '/', '.html']) {
                    internalPages.add(`${baseUrl}/${hint}${suffix}`);
                }
            }

            const pages = [...internalPages].slice(0, 25);
            addLog(`Checking ${pages.length} pages...`);
            const crawledJsUrls = new Set<string>();

            await Promise.allSettled(pages.map(async (pageUrl) => {
                const pageHtml = await fetchTextSafe(pageUrl, 8000);
                if (pageHtml) {
                    discoverXml(pageHtml);
                    const scriptRegex2 = /<script[^>]+src=["']([^"']+\.js)["'][^>]*>/gi;
                    let sm;
                    while ((sm = scriptRegex2.exec(pageHtml)) !== null) {
                        try {
                            const jsUrl = new URL(sm[1], pageUrl).href;
                            if (isSameDomain(jsUrl, baseUrl)) crawledJsUrls.add(jsUrl);
                        } catch {}
                    }
                    const subLinks = pageHtml.match(/href=["']([^"'#]+\.xml)["']/gi);
                    if (subLinks) {
                        for (const sl of subLinks) {
                            const href = sl.match(/href=["']([^"']+)["']/i)?.[1];
                            if (href) {
                                try {
                                    const full = new URL(href, pageUrl).href;
                                    if (isSameDomain(full, baseUrl)) {
                                        const fname = full.split('/').pop();
                                        if (fname && fname.endsWith('.xml')) discoveredFiles.add(fname);
                                    }
                                } catch {}
                            }
                        }
                    }
                }
            }));
            addLog(`After page crawl: ${discoveredFiles.size} .xml files, ${crawledJsUrls.size} new JS files`);

            addLog('\n--- Step 3b: Scanning crawled JS files for embedded XML ---');
            setProgress('Scanning crawled JS files...');
            const crawledJsResults = await Promise.allSettled([...crawledJsUrls].map(async (jsUrl) => {
                const js = await fetchTextSafe(jsUrl, 10000);
                if (js) {
                    discoverXml(js);
                    const embedded = extractEmbeddedBotsFromJs(js, jsUrl, seenContent);
                    for (const bot of embedded) {
                        allBots.push({ ...bot, fromTab: 'Embedded JS' });
                        addLog(`  Embedded: ${bot.name} (${(bot.size / 1024).toFixed(1)} KB)`);
                    }
                }
            }));
            addLog(`After crawled JS scan: ${discoveredFiles.size} .xml files, ${allBots.length} embedded bots`);

            addLog('\n--- Step 4: Probing common bot names ---');
            setProgress('Probing common bot paths...');
            const commonNames = [
                'Martingale', 'Dalembert', 'Oscar_Grinde', 'Fibonacci', 'Paroli',
                'Anti_Martingale', 'Custom_Strategy', 'Rise_Fall', 'Both_Sides',
                'Accumulators', 'Multipliers', 'Turbos', 'Ticks',
                'Under_5', 'Under_6', 'Under_7', 'Under_8',
                'Over_1', 'Over_2', 'Over_3', 'Over_4', 'Over_5',
                'Even_Odd', 'Differs', 'Digits', 'Matches',
                'Market_Killer', 'Entry_Digit', 'Digit_Hunter',
                'Multi_Killer', 'AI_Analyst', 'Recovery', 'Starter',
                'Killer', 'Sniper', 'Hunter', 'Blaster', 'Turbo',
                'Premium', 'Advanced', 'Basic', 'Pro', 'Elite',
            ];
            for (const name of commonNames) {
                discoveredFiles.add(`${name}.xml`);
                const lower = name.toLowerCase();
                if (lower !== name) discoveredFiles.add(`${lower}.xml`);
                const upper = name.toUpperCase();
                if (upper !== name) discoveredFiles.add(`${upper}.xml`);
                discoveredFiles.add(`${name.replace(/ /g, '_')}.xml`);
            }
            addLog(`Total candidate files: ${discoveredFiles.size}`);

            addLog('\n--- Step 5: Fetching .xml files ---');
            setProgress(`Fetching ${discoveredFiles.size} candidate files...`);

            const dirs = ['/xml/', '/bots/', '/public/xml/', '/assets/xml/', '/static/xml/', '/bot/', '/strategies/', '/files/', '/downloads/', '/'];
            const fetchQueue: { url: string; name: string }[] = [];

            for (const fname of discoveredFiles) {
                for (const dir of dirs) {
                    const tryUrl = `${baseUrl}${dir}${fname}`;
                    if (!visited.has(tryUrl)) {
                        visited.add(tryUrl);
                        fetchQueue.push({ url: tryUrl, name: fname });
                    }
                }
            }

            addLog(`Testing ${fetchQueue.length} URLs...`);
            let fetched = 0;
            const batchSize = 10;
            for (let i = 0; i < fetchQueue.length; i += batchSize) {
                const batch = fetchQueue.slice(i, i + batchSize);
                const results = await Promise.allSettled(batch.map(async ({ url: fUrl, name }) => {
                    const content = await fetchTextSafe(fUrl, 6000);
                    fetched++;
                    if (!content) return;
                    if (content.includes('<!DOCTYPE html') || content.includes('<html')) return;
                    if (content.includes('MODULE_NOT_FOUND') || content.includes('Cannot find module')) return;

                    if (isValidDerivBot(content) && !seenContent.has(content)) {
                        seenContent.add(content);
                        const botName = name.replace('.xml', '').replace(/[_-]/g, ' ')
                            .replace(/([a-z])([A-Z])/g, '$1 $2')
                            .replace(/\b\w/g, c => c.toUpperCase());
                        allBots.push({
                            name: botName,
                            xml: content.trim(),
                            source: fUrl,
                            size: content.length,
                            fromTab: 'Extract',
                        });
                        addLog(`  ✅ ${botName} (${(content.length / 1024).toFixed(1)} KB)`);
                    }
                }));

                if (fetched % 30 === 0) {
                    setProgress(`Fetched ${fetched}/${fetchQueue.length}, found ${allBots.length} bots...`);
                }
            }

            addLog(`\n=== COMPLETE ===`);
            addLog(`Total bots found: ${allBots.length}`);

            setExtractedBots(allBots);
            setProgress('');

            if (allBots.length === 0) {
                setError('No bots found. This site either does not serve .xml bot files, or bots are stored in a database/localStorage. Only sites with actual .xml files in /xml/ or /bots/ paths can be extracted.');
            }
        } catch (err: any) {
            setError(`Extraction failed: ${err.message}`);
            setProgress('');
        } finally {
            setIsExtracting(false);
        }
    }, [url, addLog]);

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

    const deepExtractBots = useCallback(async () => {
        if (!url.trim()) { setError('Please enter a URL'); return; }

        let targetUrl = url.trim();
        if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

        setIsDeepExtracting(true);
        setError('');
        setExtractedBots([]);
        setScanLog([]);

        const addLog = (msg: string) => setScanLog(prev => [...prev, msg]);

        addLog('--- Deep Extract: Launching headless browser ---');
        setProgress('Starting browser...');

        try {
            const res = await fetch('/api/deep-extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: targetUrl }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Server error: ${res.status}`);
            }

            const data = await res.json();
            addLog(`Deep extract complete: ${data.count} bot(s) found`);
            if (data.spaShells > 0) {
                addLog(`Note: ${data.spaShells} path(s) returned SPA HTML (bots may not exist as .xml files on server)`);
            }

            const allBots: ExtractedBot[] = data.bots.map((bot: any, i: number) => ({
                name: bot.name || `Bot ${i + 1}`,
                xml: bot.xml,
                source: bot.source || targetUrl,
                size: bot.size || bot.xml.length,
                fromTab: 'Deep Extract',
            }));

            setExtractedBots(allBots);
            setProgress('');
            addLog(`=== COMPLETE: ${allBots.length} bot(s) extracted ===`);

            if (allBots.length === 0) {
                setError('No bots found. The site either does not serve .xml bot files, or uses a different storage method (database/localStorage). Only sites with actual .xml files in accessible paths can be extracted.');
            }
        } catch (err: any) {
            setError(`Deep extraction failed: ${err.message}`);
            setProgress('');
        } finally {
            setIsDeepExtracting(false);
        }
    }, [url]);

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
                        disabled={isExtracting || isDeepExtracting}
                    />
                    <button
                        className='bot-extractor__btn bot-extractor__btn--extract'
                        onClick={extractBots}
                        disabled={isExtracting || isDeepExtracting || !url.trim()}
                    >
                        {isExtracting ? (
                            <><span className='bot-extractor__spinner' /> Extracting...</>
                        ) : (
                            'Extract Bots'
                        )}
                    </button>
                    <button
                        className='bot-extractor__btn bot-extractor__btn--deep'
                        onClick={deepExtractBots}
                        disabled={isExtracting || isDeepExtracting || !url.trim()}
                    >
                        {isDeepExtracting ? (
                            <><span className='bot-extractor__spinner' /> Deep Extracting...</>
                        ) : (
                            'Deep Extract'
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

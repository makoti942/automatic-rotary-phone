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

function decodeMarkup(content: string): string {
    return content
        .replace(/\\u003[cC]/g, '<').replace(/\\u003[eE]/g, '>')
        .replace(/\\x3[cC]/g, '<').replace(/\\x3[eE]/g, '>')
        .replace(/\\u0026/g, '&').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
        .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&');
}

function isValidDerivBot(content: string): boolean {
    if (!content || typeof content !== 'string') return false;
    const trimmed = decodeMarkup(content).trim();
    if (trimmed.length < 500 || trimmed.length > 1000000) return false;
    if (!/^(?:<\?xml\b[^>]*\?>\s*)?<xml\b/i.test(trimmed) || !/<\/xml>\s*$/i.test(trimmed)) return false;
    if (/<(?:!doctype|html|head|body)\b/i.test(trimmed)) return false;
    if (/MODULE_NOT_FOUND|Cannot find module|Blockly\.(?:Blocks|JavaScript)/i.test(trimmed)) return false;
    const blockCount = (trimmed.match(/<block\b/gi) || []).length;
    if (blockCount < 5) return false;
    const hasTradeDefinition = /<block\b[^>]*type=["']trade_definition["']/i.test(trimmed);
    const hasPurchase = /<block\b[^>]*type=["']purchase["']/i.test(trimmed);
    const hasTradeFlow = /<block\b[^>]*type=["'](?:before_purchase|during_purchase|after_purchase|trade_again)["']/i.test(trimmed);
    return hasTradeDefinition && hasPurchase && hasTradeFlow;
}

function extractXmlDocuments(content: string): string[] {
    const decoded = decodeMarkup(content);
    const results: string[] = [];
    const open = /<xml\b[^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = open.exec(decoded))) {
        const end = decoded.indexOf('</xml>', match.index + match[0].length);
        if (end === -1) continue;
        const xml = decoded.slice(match.index, end + 6).trim();
        if (isValidDerivBot(xml) && !results.includes(xml)) results.push(xml);
        open.lastIndex = end + 6;
    }
    return results;
}

function isBuiltInBotBundle(source: string): boolean {
    return /(?:^|[\\/])(?:[^\\/]+-xml(?:\\.[a-f0-9]{6,})?\\.js|dbot-collection(?:\\.[a-f0-9]{6,})?\\.js)$/i.test(source);
}

function normalizeBotName(name: string | null | undefined): string | null {
    if (!name) return null;
    const cleaned = name.replace(/[_-]+/g, ' ').replace(/\\s+/g, ' ').trim();
    if (!cleaned || /^(?:bot|xml|data|payload|content|strategy|s|t|e|i|o|n)(?:\\s+\\d+)?$/i.test(cleaned)) return null;
    if (cleaned.length < 2 || cleaned.length > 120) return null;
    return cleaned;
}

function hasCustomBotName(name: string | null | undefined): boolean {
    return !!normalizeBotName(name);
}

function extractEmbeddedBotsFromJs(jsContent: string, jsSource: string, seenContent: Set<string>): { name: string; xml: string; source: string; size: number }[] {
    return extractXmlDocuments(jsContent).flatMap((xml, index) => {
        if (seenContent.has(xml)) return [];
        if (isBuiltInBotBundle(jsSource)) return [];
        const name = normalizeBotName(guessNameFromContext(jsContent, jsContent.indexOf(xml.slice(0, 40)), xml));
        if (!name) return [];
        seenContent.add(xml);
        return [{ name, xml, source: 'embedded:' + jsSource, size: xml.length }];
    });
}
function guessNameFromContext(jsContent: string, position: number, xml: string): string {
    const nameFromField = xml.match(/<field name="BOT_NAME">([^<]+)<\/field>/i);
    if (nameFromField) return nameFromField[1].trim();
    const nameFromMutation = xml.match(/<mutation[^>]*bot_name=["']([^"']+)["']/i);
    if (nameFromMutation) return nameFromMutation[1].trim();

    const contextBefore = jsContent.substring(Math.max(0, position - 1500), position);
    const metadataMatches = [...contextBefore.matchAll(/(?:name|label|title|displayName|botName|strategyName)\s*[:=]\s*["'`]([^"'`]{2,120})["'`]/gi)];
    if (metadataMatches.length) return metadataMatches[metadataMatches.length - 1][1].trim();
    const varMatch = contextBefore.match(/(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*["'`][^"'`]*$/g);
    if (varMatch) {
        const last = varMatch[varMatch.length - 1];
        const name = last.replace(/(?:const|let|var)\s+/, '').replace(/\s*=.*/, '').trim();
        if (name.length > 2 && name.length < 60) return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
    }
    const fileMatch = contextBefore.match(/["']([A-Za-z][A-Za-z0-9_-]+)\.xml["']/g);
    if (fileMatch) {
        const last = fileMatch[fileMatch.length - 1].replace(/["']/g, '').replace('.xml', '');
        return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
    }
    return `Bot ${Math.floor(position / 100)}`;
}

function extractLoadBotUrls(html: string, baseUrl: string): string[] {
    const urls = new Set<string>();
    const patterns = [
        /<button[^>]*data-(?:bot|id|xml|url)=["']([^"']+)["']/gi,
        /<button[^>]*onclick=["']([^"']*load[^"']*)["']/gi,
        /<a[^>]*href=["']([^"']*load[^"']*)["']/gi,
    ];
    for (const regex of patterns) {
        let match;
        while ((match = regex.exec(html)) !== null) {
            const val = match[1] || match[0];
            try {
                const url = new URL(val, baseUrl).href;
                if (url.startsWith(baseUrl) && (url.includes('.xml') || url.includes('/api/') || url.includes('/bot/') || url.includes('/load'))) {
                    urls.add(url);
                }
            } catch {}
        }
    }
    const dataAttrRegex = /data-(?:bot|xml|id|url)=["']([^"']+\.xml)["']/gi;
    let match;
    while ((match = dataAttrRegex.exec(html)) !== null) {
        try {
            const url = new URL(match[1], baseUrl).href;
            if (url.startsWith(baseUrl)) urls.add(url);
        } catch {}
    }
    const selectRegex = /<select[^>]*name=["'][^"']*bot[^"']*["'][^>]*>([\s\S]*?)<\/select>/gi;
    while ((match = selectRegex.exec(html)) !== null) {
        const options = match[1].match(/<option[^>]*value=["']([^"']+)["']/gi);
        if (options) {
            for (const opt of options) {
                const valMatch = opt.match(/value=["']([^"']+)["']/i);
                if (valMatch) {
                    try {
                        const url = new URL(valMatch[1], baseUrl).href;
                        if (url.startsWith(baseUrl)) urls.add(url);
                    } catch {}
                }
            }
        }
    }
    return [...urls];
}

function extractNameFromXml(xml: string): string | null {
    const nameFromField = xml.match(/<field name="BOT_NAME">([^<]+)<\/field>/i);
    if (nameFromField) return nameFromField[1].trim();
    const nameFromMutation = xml.match(/<mutation[^>]*bot_name=["']([^"']+)["']/i);
    if (nameFromMutation) return nameFromMutation[1].trim();
    const nameFromTitle = xml.match(/<title[^>]*>([^<]{2,50})<\/title>/i);
    if (nameFromTitle && !nameFromTitle[1].match(/^\d+$/)) return nameFromTitle[1].trim();
    return null;
}

function scanCurrentPageDOM(): { name: string; xml: string; source: string; size: number; fetchUrl: string }[] {
    const results: { name: string; xml: string; source: string; size: number; fetchUrl: string }[] = [];
    const seen = new Set<string>();

    const buttons = document.querySelectorAll('button[data-bot], button[data-xml], button[data-id], button[data-url], button[onclick*="load" i], a[href*="load" i], a[href*="import" i], a[href*="bot" i]');
    for (const btn of buttons) {
        const url = btn.getAttribute('data-bot') || btn.getAttribute('data-xml') || btn.getAttribute('data-id') || btn.getAttribute('data-url') || btn.getAttribute('href') || btn.getAttribute('onclick')?.match(/["']([^"']*load[^"']*)["']/i)?.[1];
        if (url) {
            try {
                const full = new URL(url, window.location.origin).href;
                if (full.startsWith(window.location.origin)) {
                    results.push({ name: btn.textContent?.trim() || 'Button Bot', xml: '', source: 'dom-button:' + full, size: 0, fetchUrl: full });
                }
            } catch {}
        }
    }

    const selects = document.querySelectorAll<HTMLSelectElement>('select[name*="bot" i], select[id*="bot" i]');
    for (const sel of selects) {
        for (const opt of sel.options) {
            if (opt.value) {
                try {
                    const full = new URL(opt.value, window.location.origin).href;
                    if (full.startsWith(window.location.origin)) {
                        results.push({ name: opt.textContent?.trim() || 'Select Bot', xml: '', source: 'dom-select:' + full, size: 0, fetchUrl: full });
                    }
                } catch {}
            }
        }
    }

    const links = document.querySelectorAll<HTMLAnchorElement>('a[href$=".xml"], a[href*="/bot/"], a[href*="/api/bot"]');
    for (const link of links) {
        try {
            const full = new URL(link.href, window.location.origin).href;
            if (full.startsWith(window.location.origin)) {
                results.push({ name: link.textContent?.trim() || 'Link Bot', xml: '', source: 'dom-link:' + full, size: 0, fetchUrl: full });
            }
        } catch {}
    }

    return results;
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
        const discoveredXmlUrls = new Set<string>();
        const discoveredJsUrls = new Set<string>();
        const discoveredDataUrls = new Set<string>();

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

        const discoverAssets = (content: string, sourceUrl: string) => {
            const addUrl = (value: string, kind: 'xml' | 'js' | 'data') => {
                try {
                    const clean = value.replace(/\\\"|\\\'/g, '').replace(/\\u0026/g, '&');
                    const full = new URL(clean, sourceUrl).href;
                    if (kind === 'xml') discoveredXmlUrls.add(full);
                    else if (kind === 'js') discoveredJsUrls.add(full);
                    else discoveredDataUrls.add(full);
                } catch {}
            };
            const xmlPattern = /(?:https?:\/\/[^\s"'\x60<>]+|(?:\.\.?\/|\/)[^\s"'\x60<>]+|[A-Za-z0-9_ .-]+)\.xml(?:[?#][^\s"'\x60<>]*)?/gi;
            let m: RegExpExecArray | null;
            while ((m = xmlPattern.exec(content))) {
                const value = m[0].replace(/[),;]+$/, '');
                if (value.length >= 5 && value.length <= 300 && !/node_modules|blockly/i.test(value)) {
                    addUrl(value, 'xml');
                    discoveredFiles.add(value.split('/').pop()!.split(/[?#]/)[0]);
                }
            }
            const jsPattern = /(?:https?:\/\/[^\s"'\x60<>]+|(?:\.\.?\/|\/)[^\s"'\x60<>]+|[A-Za-z0-9_./-]+)\.js(?:[?#][^\s"'\x60<>]*)?/gi;
            while ((m = jsPattern.exec(content))) addUrl(m[0].replace(/[),;]+$/, ''), 'js');
            const dataPattern = /(?:https?:\/\/[^\s"'\x60<>]+|(?:\.\.?\/|\/)[^\s"'\x60<>]+|[A-Za-z0-9_./-]+)(?:\.json(?:[?#][^\s"'\x60<>]*)?|\/api\/(?:[^\s"'\x60<>]*(?:bot|strategy|free)[^\s"'\x60<>]*))/gi;
            while ((m = dataPattern.exec(content))) addUrl(m[0].replace(/[),;]+$/, ''), 'data');
            const endpointPattern = /["'\x60]((?:https?:\/\/|\/|\.\.?\/)[^"'\x60<>]{1,240})["'\x60]/gi;
            while ((m = endpointPattern.exec(content))) {
                const value = m[1];
                if (/(?:bot|strategy|free|download|workspace|xml)/i.test(value) && !/\.js(?:[?#]|$)/i.test(value)) {
                    addUrl(value, 'data');
                }
            }

            // Webpack/Rspack often keeps XML bots in hashed async chunks and only
            // exposes the chunk name/id mapping in the runtime bundle.
            const asyncRoot = content.indexOf('static/js/async/');
            if (asyncRoot !== -1) {
                const hashSection = content.slice(asyncRoot);
                const chunkNames = /([0-9]+):["']([^"']+-xml)["']/g;
                let chunk: RegExpExecArray | null;
                while ((chunk = chunkNames.exec(content))) {
                    const hash = hashSection.match(new RegExp(`(?:^|[^0-9])${chunk[1]}:["']([a-f0-9]{6,})["']`, 'i'))?.[1];
                    if (hash) addUrl(`/static/js/async/${chunk[2]}.${hash}.js`, 'js');
                }
            }
        };

        try {
            const baseUrl = new URL(targetUrl).origin;

            addLog('--- Step 1: Fetching main page ---');
            setProgress('Fetching main page...');
            const mainHtml = await fetchTextSafe(targetUrl);
            if (!mainHtml) throw new Error('Failed to fetch main page');
            discoverAssets(mainHtml, targetUrl);
            addLog(`Main page scanned, ${discoveredFiles.size} .xml files found`);

            addLog('\n--- Step 2: Scanning JS bundles ---');
            setProgress('Scanning JavaScript bundles...');
            const jsUrls = new Set<string>();
            const jsRegex = /<(?:script[^>]+src|link[^>]+href)=["']([^"']+\.js(?:\?[^"']*)?)["']/gi;
            let jm;
            while ((jm = jsRegex.exec(mainHtml)) !== null) {
                try { jsUrls.add(new URL(jm[1], targetUrl).href); } catch {}
            }
            discoveredJsUrls.forEach(jsUrl => jsUrls.add(jsUrl));
            addLog(`Found ${jsUrls.size} JavaScript asset(s)`);

            const jsResults = await Promise.allSettled([...jsUrls].map(async (jsUrl) => {
                const js = await fetchTextSafe(jsUrl, 12000);
                if (js) {
                    discoverAssets(js, jsUrl);
                    const embedded = extractEmbeddedBotsFromJs(js, jsUrl, seenContent);
                    for (const bot of embedded) {
                        allBots.push({ ...bot, fromTab: 'Embedded JS' });
                        addLog(`  Embedded: ${bot.name} (${(bot.size / 1024).toFixed(1)} KB)`);
                    }
                    const short = jsUrl.split('/').pop() || '';
                    addLog(`  ${short}: ${[...discoveredFiles].length} files so far`);
                }
            }));
            const asyncJsUrls = [...discoveredJsUrls].filter(jsUrl => !jsUrls.has(jsUrl));
            if (asyncJsUrls.length) {
                addLog(`Fetching ${asyncJsUrls.length} discovered async bundle(s)...`);
                await Promise.allSettled(asyncJsUrls.map(async jsUrl => {
                    const js = await fetchTextSafe(jsUrl, 12000);
                    if (!js) return;
                    discoverAssets(js, jsUrl);
                    for (const bot of extractEmbeddedBotsFromJs(js, jsUrl, seenContent)) {
                        allBots.push({ ...bot, fromTab: 'Embedded JS' });
                        addLog(`  Embedded: ${bot.name} (${(bot.size / 1024).toFixed(1)} KB)`);
                    }
                }));
            }
            if (discoveredDataUrls.size) {
                addLog(`Fetching ${discoveredDataUrls.size} discovered bot data source(s)...`);
                await Promise.allSettled([...discoveredDataUrls].map(async dataUrl => {
                    const data = await fetchTextSafe(dataUrl, 10000);
                    if (!data) return;
                    discoverAssets(data, dataUrl);
                    for (const bot of extractEmbeddedBotsFromJs(data, dataUrl, seenContent)) {
                        allBots.push({ ...bot, fromTab: 'Custom Bot Data' });
                        addLog(`  Custom data: ${bot.name} (${(bot.size / 1024).toFixed(1)} KB)`);
                    }
                }));
            }
            addLog(`After JS scan: ${discoveredXmlUrls.size || discoveredFiles.size} XML references, ${allBots.length} embedded bots`);

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
            const checkedPages = new Set<string>([targetUrl, ...pages]);

            await Promise.allSettled(pages.map(async (pageUrl) => {
                checkedPages.add(pageUrl);
                const pageHtml = await fetchTextSafe(pageUrl, 8000);
                if (pageHtml) {
                    discoverAssets(pageHtml, pageUrl);
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

            addLog('\n--- Step 3b: Detecting Load Bot buttons ---');
            setProgress('Finding Load Bot buttons...');
            const loadBotUrls = new Set<string>();
            for (const pageUrl of checkedPages) {
                try {
                    const pageHtml = await fetchTextSafe(pageUrl, 4000);
                    if (pageHtml) {
                        const urls = extractLoadBotUrls(pageHtml, baseUrl);
                        for (const u of urls) loadBotUrls.add(u);
                    }
                } catch {}
            }
            addLog(`Found ${loadBotUrls.size} Load Bot URLs`);

            for (const loadUrl of loadBotUrls) {
                try {
                    const xml = await fetchTextSafe(loadUrl, 8000);
                    if (xml && isValidDerivBot(xml)) {
                        const name = extractNameFromXml(xml) || loadUrl.split('/').pop()?.replace('.xml', '') || 'Loaded Bot';
                        if (!seenContent.has(xml)) {
                            seenContent.add(xml);
                            allBots.push({ name, xml: xml.trim(), source: 'load-button:' + loadUrl, size: xml.length, fromTab: 'Load Bot' });
                            addLog(`  Load Bot: ${name} (${(xml.length / 1024).toFixed(1)} KB)`);
                        }
                    }
                } catch {}
            }
            addLog(`After Load Buttons: ${allBots.length} bots`);

            addLog('\n--- Step 3c: Scanning crawled JS files for embedded XML ---');
            setProgress('Scanning crawled JS files...');
            const crawledJsResults = await Promise.allSettled([...crawledJsUrls].map(async (jsUrl) => {
                const js = await fetchTextSafe(jsUrl, 10000);
                if (js) {
                    discoverAssets(js, jsUrl);
                    const embedded = extractEmbeddedBotsFromJs(js, jsUrl, seenContent);
                    for (const bot of embedded) {
                        allBots.push({ ...bot, fromTab: 'Embedded JS' });
                        addLog(`  Embedded: ${bot.name} (${(bot.size / 1024).toFixed(1)} KB)`);
                    }
                }
            }));
            addLog(`After crawled JS scan: ${discoveredFiles.size} .xml files, ${allBots.length} embedded bots`);

            addLog('\n--- Step 4: Fetching discovered custom bot files ---');
            setProgress(`Fetching ${discoveredFiles.size} candidate files...`);

            const dirs = ['/xml/', '/bots/', '/public/xml/', '/assets/xml/', '/static/xml/', '/bot/', '/strategies/', '/files/', '/downloads/', '/'];
            const fetchQueue: { url: string; name: string }[] = [];

            for (const xmlUrl of discoveredXmlUrls) {
                const name = decodeURIComponent(new URL(xmlUrl).pathname.split('/').pop() || 'bot.xml');
                if (!visited.has(xmlUrl)) { visited.add(xmlUrl); fetchQueue.push({ url: xmlUrl, name }); }
            }
            for (const fname of discoveredFiles) {
                for (const dir of dirs) {
                    const tryUrl = `${baseUrl}${dir}${fname}`;
                    if (!visited.has(tryUrl)) { visited.add(tryUrl); fetchQueue.push({ url: tryUrl, name: fname }); }
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
                    if (isBuiltInBotBundle(fUrl)) return;

                    if (isValidDerivBot(content) && !seenContent.has(content)) {
                        seenContent.add(content);
                        const botName = extractNameFromXml(content) || name.replace(/\.xml$/i, '').replace(/[_-]/g, ' ')
                            .replace(/([a-z])([A-Z])/g, '$1 $2')
                            .replace(/\b\w/g, c => c.toUpperCase());
                        if (!hasCustomBotName(botName)) return;
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
                setError('No bots found. This site either does not serve .xml bot files, or bots are stored in a database/localStorage. The site may keep bots in JavaScript bundles, JSON, API responses, or non-standard paths that could not be reached.');
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

    const extractFromCurrentPage = useCallback(async () => {
        setIsExtracting(true);
        setError('');
        setExtractedBots([]);
        setScanLog([]);

        const addLog = (msg: string) => setScanLog(prev => [...prev, msg]);
        const seenContent = new Set<string>();

        addLog('--- Extract from Current Page (DOM mode) ---');
        setProgress('Scanning current page DOM...');

        try {
            const domBots = scanCurrentPageDOM();
            addLog(`Found ${domBots.length} load buttons/links in DOM`);

            const allBots: ExtractedBot[] = [];
            for (const bot of domBots) {
                if (bot.fetchUrl) {
                    addLog(`Fetching: ${bot.name} from ${bot.fetchUrl}`);
                    try {
                        const res = await fetch(bot.fetchUrl, { credentials: 'include' });
                        if (res.ok) {
                            const xml = await res.text();
                            if (xml && isValidDerivBot(xml)) {
                                const name = extractNameFromXml(xml) || bot.name;
                                if (!seenContent.has(xml)) {
                                    seenContent.add(xml);
                                    allBots.push({ name, xml: xml.trim(), source: bot.source, size: xml.length, fromTab: 'Current Page' });
                                    addLog(`  ✅ ${name} (${(xml.length / 1024).toFixed(1)} KB)`);
                                }
                            } else {
                                addLog(`  ❌ Not valid bot XML`);
                            }
                        }
                    } catch (e) {
                        addLog(`  ❌ Fetch failed`);
                    }
                }
            }

            setExtractedBots(allBots);
            setProgress('');
            addLog(`=== COMPLETE: ${allBots.length} bot(s) extracted from current page ===`);

            if (allBots.length === 0) {
                setError('No bots found on current page. Make sure you are on a Deriv bot site with a bot library visible.');
            }
        } catch (err: any) {
            setError(`Current page extraction failed: ${err.message}`);
            setProgress('');
        } finally {
            setIsExtracting(false);
        }
    }, []);

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
                    <button
                        className='bot-extractor__btn bot-extractor__btn--current'
                        onClick={extractFromCurrentPage}
                        disabled={isExtracting || isDeepExtracting}
                        title='Run extractor on this page (must be on a Deriv bot site)'
                    >
                        Run on This Page
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

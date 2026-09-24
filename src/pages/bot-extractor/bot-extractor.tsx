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

// Common paths where Deriv bots are often hosted
const COMMON_BOT_PATHS = [
    '/xml/', '/bots/', '/strategies/', '/files/', '/downloads/',
    '/bot/', '/blockly/', '/deriv/', '/binary/', '/trade/',
    '/xml/bots/', '/xml/strategies/', '/bots/xml/', '/strategies/xml/',
    '/public/xml/', '/assets/xml/', '/static/xml/',
    '/wp-content/uploads/',
];

// Known Deriv bot filenames to probe (common across third-party sites)
const KNOWN_BOT_NAMES = [
    'Poverty_Killer', 'BEST_RISE_FALL', 'MAKOTI_AUTOMATED_RISE_FALL',
    'UNDER8_R67_PRO', 'NEW_BOT_WITH_ENTRY_POINT', 'SPLIT_MARTINGALE_BOT_PREMIUM',
    'EVEN_ODD_KILLER', 'DIFFERS_AUTO', 'Market_Killer', 'O_U_KILLER',
    'HIGH_LOW', 'UNDER765', 'Entry_Digit', 'AI_Analyst', 'Multi_Killer',
    'Digit_Hunter', 'Martingale', 'martingale', 'dalembert', 'oscars_grind',
    'reverse_martingale', 'accumulators_dalembert', 'accumulators_martingale',
    'reverse_dalembert', '1_3_2_6', 'accumulator', 'digit_differ',
    'rise_fall', 'run_high_low', 'tick_high_low', 'smart_martingale',
    'grid_bot', 'scalping', 'trend_following', 'volatility_bot',
    'deriv_bot', 'binary_bot', 'blockly_bot', 'custom_strategy',
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

    const fetchWithProxy = useCallback(async (targetUrl: string): Promise<string> => {
        for (const proxyFn of CORS_PROXIES) {
            try {
                const proxyUrl = proxyFn(targetUrl);
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 15000);
                const res = await fetch(proxyUrl, { signal: controller.signal });
                clearTimeout(timeout);
                if (res.ok) {
                    const text = await res.text();
                    if (text && text.length > 100) return text;
                }
            } catch {
                // Try next proxy
            }
        }
        throw new Error('All proxies failed');
    }, []);

    const extractXmlFromHtml = useCallback((html: string, baseUrl: string): { bots: ExtractedBot[], links: string[] } => {
        const bots: ExtractedBot[] = [];
        const links: string[] = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // 1. Find ALL links (to follow recursively)
        doc.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href');
            if (href) {
                try {
                    const fullUrl = new URL(href, baseUrl).href;
                    links.push(fullUrl);
                } catch {}
            }
        });

        // 2. <link> tags pointing to .xml
        doc.querySelectorAll('link[href$=".xml"], link[href*=".xml?"]').forEach(link => {
            const href = link.getAttribute('href');
            if (href) {
                try {
                    const fullUrl = new URL(href, baseUrl).href;
                    if (!bots.some(b => b.source === fullUrl)) {
                        bots.push({ name: decodeURIComponent(href.split('/').pop()?.replace('.xml', '') || 'Unknown'), xml: '', source: fullUrl, size: 0 });
                    }
                } catch {}
            }
        });

        // 3. <a> tags pointing to .xml
        doc.querySelectorAll('a[href$=".xml"], a[href*=".xml?"]').forEach(a => {
            const href = a.getAttribute('href');
            if (href) {
                try {
                    const fullUrl = new URL(href, baseUrl).href;
                    const name = a.textContent?.trim() || decodeURIComponent(href.split('/').pop()?.replace('.xml', '') || 'Unknown');
                    if (!bots.some(b => b.source === fullUrl)) {
                        bots.push({ name, xml: '', source: fullUrl, size: 0 });
                    }
                } catch {}
            }
        });

        // Also check for .xml references in script src attributes (SPAs import XML as modules)
        doc.querySelectorAll('script[src]').forEach(script => {
            const src = script.getAttribute('src') || '';
            if (src.match(/\.xml(\?|$)/i)) {
                try {
                    const fullUrl = new URL(src, baseUrl).href;
                    if (!bots.some(b => b.source === fullUrl)) {
                        bots.push({ name: decodeURIComponent(src.split('/').pop()?.replace('.xml', '') || 'Imported Bot'), xml: '', source: fullUrl, size: 0 });
                    }
                } catch {}
            }
        });

        // 4. <script type="text/xml"> or <script type="application/xml">
        doc.querySelectorAll('script[type="text/xml"], script[type="application/xml"]').forEach((script, i) => {
            const content = script.textContent || '';
            if (content.includes('<block')) {
                bots.push({
                    name: script.getAttribute('data-name') || `Inline Bot ${i + 1}`,
                    xml: content.trim(),
                    source: 'inline',
                    size: content.length,
                });
            }
        });

        // 5. data-xml, data-bot, data-strategy attributes
        doc.querySelectorAll('[data-xml], [data-bot], [data-strategy]').forEach((el, i) => {
            const xmlData = el.getAttribute('data-xml') || el.getAttribute('data-bot') || el.getAttribute('data-strategy');
            if (xmlData && (xmlData.includes('<xml') || xmlData.includes('<block'))) {
                const name = el.getAttribute('data-name') || el.textContent?.trim().substring(0, 50) || `Extracted Bot ${i + 1}`;
                bots.push({ name, xml: xmlData.trim(), source: 'data-attribute', size: xmlData.length });
            }
        });

        // 6. Direct <xml> elements
        doc.querySelectorAll('xml').forEach((el, i) => {
            const content = el.outerHTML;
            if (content.includes('<block') && !bots.some(b => b.xml === content)) {
                bots.push({ name: `XML Bot ${i + 1}`, xml: content, source: 'inline-xml', size: content.length });
            }
        });

        // 7. XML patterns in all text (pre, code, div with white-space: pre)
        const scanElements = doc.querySelectorAll('pre, code, [style*="white-space"]');
        scanElements.forEach(el => {
            const content = el.textContent || '';
            const xmlPattern = /<(?:xml|blockly)[^>]*>[\s\S]*?<\/(?:xml|blockly)>/gi;
            let match;
            while ((match = xmlPattern.exec(content)) !== null) {
                const xmlContent = match[0];
                if (xmlContent.includes('<block') && !bots.some(b => b.xml === xmlContent)) {
                    bots.push({ name: `Code Bot ${bots.length + 1}`, xml: xmlContent, source: 'code-block', size: xmlContent.length });
                }
            }
        });

        // 8. Blockly.Xml.textToDom() patterns in scripts
        const allText = doc.body?.innerHTML || '';
        const textToDomPattern = /Blockly\.Xml\.textToDom\((['"`])([\s\S]*?)\1\)/gi;
        let match2;
        while ((match2 = textToDomPattern.exec(allText)) !== null) {
            const xmlContent = match2[2].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\'/g, "'");
            if (xmlContent.includes('<block') && !bots.some(b => b.xml === xmlContent)) {
                bots.push({ name: `Script Bot ${bots.length + 1}`, xml: xmlContent, source: 'script-extract', size: xmlContent.length });
            }
        }

        // 9. strategy_to_load patterns
        const strategyPattern = /strategy_to_load\s*=\s*(['"`])([\s\S]*?)\1/gi;
        let match3;
        while ((match3 = strategyPattern.exec(allText)) !== null) {
            const xmlContent = match3[2].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\'/g, "'");
            if (xmlContent.includes('<block') && !bots.some(b => b.xml === xmlContent)) {
                bots.push({ name: `Strategy Bot ${bots.length + 1}`, xml: xmlContent, source: 'strategy-extract', size: xmlContent.length });
            }
        }

        // 10. workspaceXml or xmlContent variable assignments
        const varPattern = /(?:workspaceXml|xmlContent|xmlString|botXml|blockXml)\s*=\s*(['"`])([\s\S]*?)\1/gi;
        let match4;
        while ((match4 = varPattern.exec(allText)) !== null) {
            const xmlContent = match4[2].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\'/g, "'");
            if ((xmlContent.includes('<block') || xmlContent.includes('<xml')) && !bots.some(b => b.xml === xmlContent)) {
                bots.push({ name: `Var Bot ${bots.length + 1}`, xml: xmlContent, source: 'var-extract', size: xmlContent.length });
            }
        }

        return { bots, links };
    }, []);

    const extractBots = useCallback(async () => {
        if (!url.trim()) {
            setError('Please enter a URL');
            return;
        }

        let targetUrl = url.trim();
        if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

        setIsExtracting(true);
        setError('');
        setExtractedBots([]);
        setScanLog([]);

        const allBots: ExtractedBot[] = [];
        const seenSources = new Set<string>();
        const visitedUrls = new Set<string>();

        const addBot = (bot: ExtractedBot) => {
            const key = bot.xml || bot.source;
            if (!seenSources.has(key)) {
                seenSources.add(key);
                allBots.push(bot);
            }
        };

        const isValidUrl = (u: string) => {
            try { new URL(u); return true; } catch { return false; }
        };

        const isSameDomain = (u: string, base: string) => {
            try { return new URL(u).hostname === new URL(base).hostname; } catch { return false; }
        };

        try {
            // Phase 1: Fetch main page
            addLog(`Fetching: ${targetUrl}`);
            setProgress('Fetching main page...');
            const html = await fetchWithProxy(targetUrl);
            const { bots: mainBots, links: mainLinks } = extractXmlFromHtml(html, targetUrl);
            mainBots.forEach(addBot);
            addLog(`Main page: found ${mainBots.length} bot(s), ${mainLinks.length} links`);
            visitedUrls.add(targetUrl);

            // Phase 1b: Scan JS bundles for embedded XML bots (SPA sites bundle XML in JS)
            setProgress('Scanning JavaScript bundles...');
            const jsUrls: string[] = [];
            const jsMatches = html.matchAll(/src=["']([^"']*\.js(?:\?[^"']*)?)["']/gi);
            for (const m of jsMatches) {
                try {
                    const full = new URL(m[1], targetUrl).href;
                    if (!visitedUrls.has(full)) jsUrls.push(full);
                } catch {}
            }
            if (jsUrls.length > 0) {
                addLog(`Found ${jsUrls.length} JS bundle(s) — scanning for embedded XML...`);
                const xmlFileRefs = new Set<string>();

                // Also discover lazy-loaded chunks from chunk hash maps in JS bundles
                const chunkUrls: string[] = [];

                const jsResults = await Promise.allSettled(
                    jsUrls.map(async (jsUrl) => {
                        try {
                            visitedUrls.add(jsUrl);
                            addLog(`Fetching: ${jsUrl.split('/').pop()}`);
                            const jsContent = await fetchWithProxy(jsUrl);
                            if (!jsContent) { addLog(`  ${jsUrl.split('/').pop()}: empty response`); return { url: jsUrl, found: 0 }; }
                            addLog(`  ${jsUrl.split('/').pop()}: ${jsContent.length} bytes`);

                            let found = 0;

                            // Simple indexOf search for <xml — avoids regex issues on large content
                            let pos = 0;
                            while (pos < jsContent.length) {
                                const xmlStart = jsContent.indexOf('<xml', pos);
                                if (xmlStart === -1) break;

                                // Find the closing </xml> after this <xml
                                const xmlEnd = jsContent.indexOf('</xml>', xmlStart);
                                if (xmlEnd === -1) { pos = xmlStart + 4; continue; }

                                const rawXml = jsContent.substring(xmlStart, xmlEnd + 6);

                                // Unescape JS string escapes
                                let xml = rawXml
                                    .replace(/\\n/g, '\n').replace(/\\t/g, '\t')
                                    .replace(/\\"/g, '"').replace(/\\'/g, "'")
                                    .replace(/\\\//g, '/');

                                if (xml.length > 100 && xml.includes('<block') && !allBots.some(b => b.xml === xml)) {
                                    const nameMatch = xml.match(/<category[^>]*name=["']([^"']+)["']/i);
                                    addBot({
                                        name: nameMatch?.[1] || `JS Bot ${allBots.length + 1}`,
                                        xml, source: jsUrl, size: xml.length,
                                    });
                                    found++;
                                }

                                pos = xmlEnd + 6;
                            }

                            // Also search for escaped XML: \u003Cxml or \x3Cxml
                            const escSequences = ['\\u003Cxml', '\\x3Cxml'];
                            for (const esc of escSequences) {
                                let epos = 0;
                                while (epos < jsContent.length) {
                                    const eStart = jsContent.indexOf(esc, epos);
                                    if (eStart === -1) break;
                                    const eEnd = jsContent.indexOf('\\u003E/xml>', eStart);
                                    const eEnd2 = jsContent.indexOf('\\x3E/xml>', eStart);
                                    const eEnd3 = jsContent.indexOf('</xml>', eStart);
                                    const bestEnd = [eEnd, eEnd2, eEnd3].filter(x => x > 0).sort((a, b) => a - b)[0];
                                    if (!bestEnd) { epos = eStart + 10; continue; }

                                    let xml = jsContent.substring(eStart, bestEnd + 6)
                                        .replace(/\\u003C/g, '<').replace(/\\x3C/g, '<')
                                        .replace(/\\u003E/g, '>').replace(/\\x3E/g, '>')
                                        .replace(/\\n/g, '\n').replace(/\\t/g, '\t')
                                        .replace(/\\"/g, '"').replace(/\\'/g, "'")
                                        .replace(/\\\//g, '/');

                                    if (xml.length > 100 && xml.includes('<block') && !allBots.some(b => b.xml === xml)) {
                                        addBot({
                                            name: `JS Bot ${allBots.length + 1}`,
                                            xml, source: jsUrl, size: xml.length,
                                        });
                                        found++;
                                    }
                                    epos = bestEnd + 6;
                                }
                            }

                            // Find .xml file references for Phase 1c
                            const dotXmlPattern = /["'`](\.\/[a-zA-Z0-9_\-]+\.xml(?:\?[^"'`]*)?)["'`]/gi;
                            let fm: RegExpExecArray | null;
                            while ((fm = dotXmlPattern.exec(jsContent)) !== null) {
                                try {
                                    const full = new URL(fm[1], jsUrl).href;
                                    if (!visitedUrls.has(full)) xmlFileRefs.add(full);
                                } catch {}
                            }
                            const pathXmlPattern = /["'`](\/[a-zA-Z0-9_\-\/]+\.xml(?:\?[^"'`]*)?)["'`]/gi;
                            while ((fm = pathXmlPattern.exec(jsContent)) !== null) {
                                try {
                                    const full = new URL(fm[1], jsUrl).href;
                                    if (!visitedUrls.has(full)) xmlFileRefs.add(full);
                                } catch {}
                            }

                            // Discover lazy-loaded chunks: look for {id:"hash",...} chunk maps
                            const chunkMapPattern = /\{(\d+):"([a-f0-9]{6,8})"(?:,(\d+):"([a-f0-9]{6,8})")*\}/g;
                            let cm: RegExpExecArray | null;
                            while ((cm = chunkMapPattern.exec(jsContent)) !== null) {
                                const mapStr = cm[0];
                                const entries = [...mapStr.matchAll(/(\d+):"([a-f0-9]{6,8})"/g)];
                                for (const entry of entries) {
                                    const chunkId = entry[1];
                                    const chunkHash = entry[2];
                                    const origin = new URL(jsUrl).origin;
                                    const chunkUrl = `${origin}/static/js/${chunkId}.${chunkHash}.js`;
                                    if (!visitedUrls.has(chunkUrl)) chunkUrls.push(chunkUrl);
                                }
                            }

                            return { url: jsUrl, found };
                        } catch (err) {
                            addLog(`  ${jsUrl.split('/').pop()}: error — ${err}`);
                            return { url: jsUrl, found: 0 };
                        }
                    })
                );

                // Scan lazy-loaded chunks for .xml filenames and embedded XML
                if (chunkUrls.length > 0) {
                    addLog(`Found ${chunkUrls.length} lazy-loaded chunk(s) — scanning...`);
                    await Promise.allSettled(
                        chunkUrls.map(async (chunkUrl) => {
                            try {
                                const chunkContent = await fetchWithProxy(chunkUrl);
                                if (!chunkContent || chunkContent.length < 1000) return;

                                // Search for .xml filename references
                                const xmlFilePattern = /["'`]([a-zA-Z0-9_ .\-]+\.xml)["'`]/gi;
                                let xfm: RegExpExecArray | null;
                                while ((xfm = xmlFilePattern.exec(chunkContent)) !== null) {
                                    const fileName = xfm[1];
                                    if (fileName.length > 3 && !fileName.includes('blockly') && !fileName.includes('module$')) {
                                        // Try fetching from common directories
                                        const dirs = ['/xml/', '/bots/', '/public/xml/', '/assets/xml/'];
                                        for (const dir of dirs) {
                                            const tryUrl = `${new URL(targetUrl).origin}${dir}${fileName}`;
                                            if (!visitedUrls.has(tryUrl)) xmlFileRefs.add(tryUrl);
                                        }
                                    }
                                }

                                // Also search for embedded XML blocks
                                let cpos = 0;
                                while (cpos < chunkContent.length) {
                                    const xmlStart = chunkContent.indexOf('<xml', cpos);
                                    if (xmlStart === -1) break;
                                    const xmlEnd = chunkContent.indexOf('</xml>', xmlStart);
                                    if (xmlEnd === -1) { cpos = xmlStart + 4; continue; }
                                    const rawXml = chunkContent.substring(xmlStart, xmlEnd + 6);
                                    let xml = rawXml
                                        .replace(/\\n/g, '\n').replace(/\\t/g, '\t')
                                        .replace(/\\"/g, '"').replace(/\\'/g, "'")
                                        .replace(/\\\//g, '/');
                                    if (xml.length > 100 && xml.includes('<block') && !allBots.some(b => b.xml === xml)) {
                                        const nameMatch = xml.match(/<category[^>]*name=["']([^"']+)["']/i);
                                        addBot({
                                            name: nameMatch?.[1] || `Chunk Bot ${allBots.length + 1}`,
                                            xml, source: chunkUrl, size: xml.length,
                                        });
                                    }
                                    cpos = xmlEnd + 6;
                                }
                            } catch {}
                        })
                    );
                }
                const jsWithBots = jsResults
                    .filter((r): r is PromiseFulfilledResult<{ url: string; found: number }> => r.status === 'fulfilled' && r.value.found > 0);
                addLog(`JS bundles: ${jsWithBots.length} contained bot(s) — ${jsWithBots.reduce((s, r) => s + r.value.found, 0)} total`);

                // Phase 1c: Fetch .xml files referenced in JS bundles
                if (xmlFileRefs.size > 0) {
                    addLog(`Found ${xmlFileRefs.size} .xml file ref(s) in JS — fetching...`);
                    const xmlResults = await Promise.allSettled(
                        [...xmlFileRefs].map(async (xmlUrl) => {
                            try {
                                visitedUrls.add(xmlUrl);
                                const content = await fetchWithProxy(xmlUrl);
                                if (content && content.includes('<block')) {
                                    const name = decodeURIComponent(xmlUrl.split('/').pop()?.replace('.xml', '') || 'XML Bot');
                                    addBot({ name, xml: content.trim(), source: xmlUrl, size: content.length });
                                    return { url: xmlUrl, found: 1 };
                                }
                                return { url: xmlUrl, found: 0 };
                            } catch {
                                return { url: xmlUrl, found: 0 };
                            }
                        })
                    );
                    const xmlsWithBots = xmlResults
                        .filter((r): r is PromiseFulfilledResult<{ url: string; found: number }> => r.status === 'fulfilled' && r.value.found > 0);
                    addLog(`XML files: ${xmlsWithBots.length} loaded successfully`);
                }
            }

            // Phase 1d: Probe known bot filenames in common directories
            const baseUrl = new URL(targetUrl).origin;
            const probeDirs = ['/xml/', '/bots/', '/public/xml/', '/assets/xml/', '/static/xml/', '/files/', '/strategies/'];
            const probeNames = KNOWN_BOT_NAMES;
            const totalProbes = probeDirs.length * probeNames.length;
            addLog(`Probing ${totalProbes} known bot filenames...`);
            setProgress('Probing known bot filenames...');

            const probeResults = await Promise.allSettled(
                probeDirs.flatMap(dir =>
                    probeNames.map(async (name) => {
                        try {
                            const probeUrl = `${baseUrl}${dir}${name}.xml`;
                            if (visitedUrls.has(probeUrl)) return { url: probeUrl, found: false };
                            visitedUrls.add(probeUrl);
                            const content = await fetchWithProxy(probeUrl);
                            if (content && content.includes('<block') && content.length > 200) {
                                return { url: probeUrl, found: true, name, content };
                            }
                            return { url: probeUrl, found: false };
                        } catch {
                            return { url: '', found: false };
                        }
                    })
                )
            );

            const foundProbes = probeResults
                .filter((r): r is PromiseFulfilledResult<{ url: string; found: true; name: string; content: string }> => r.status === 'fulfilled' && r.value.found);
            foundProbes.forEach(r => {
                addBot({
                    name: r.value.name.replace(/_/g, ' '),
                    xml: r.value.content.trim(),
                    source: r.value.url,
                    size: r.value.content.length,
                });
            });
            addLog(`Probe results: ${foundProbes.length} bot(s) found`);

            // Phase 2: Check common bot paths
            setProgress('Scanning common bot directories...');
            const pathsToCheck = [...COMMON_BOT_PATHS];
            addLog(`Scanning ${pathsToCheck.length} common paths...`);

            const pathResults = await Promise.allSettled(
                pathsToCheck.map(async (path) => {
                    try {
                        const pathUrl = baseUrl + path;
                        const content = await fetchWithProxy(pathUrl);
                        if (content) {
                            const { bots, links } = extractXmlFromHtml(content, pathUrl);
                            bots.forEach(addBot);
                            return { path, found: bots.length, links };
                        }
                        return { path, found: 0, links: [] };
                    } catch {
                        return { path, found: 0, links: [] };
                    }
                })
            );

            const pathsWithBots = pathResults
                .filter((r): r is PromiseFulfilledResult<{ path: string; found: number; links: string[] }> => r.status === 'fulfilled' && r.value.found > 0);
            addLog(`Common paths: ${pathsWithBots.length} had bots`);

            // Collect links from common paths for deeper scanning
            const deepLinks: string[] = [];
            pathResults.forEach(r => {
                if (r.status === 'fulfilled') {
                    r.value.links.forEach(l => {
                        if (isSameDomain(l, targetUrl) && isValidUrl(l)) deepLinks.push(l);
                    });
                }
            });

            // Phase 3: Scan main page links for subpages with bots
            setProgress('Scanning linked pages...');
            const subpageLinks = mainLinks
                .filter(l => isSameDomain(l, targetUrl) && isValidUrl(l) && !visitedUrls.has(l))
                .filter(l => !l.match(/\.(png|jpg|gif|svg|css|js|ico|woff|ttf)(\?|$)/i))
                .slice(0, 30); // Limit to 30 subpages

            addLog(`Scanning ${subpageLinks.length} subpages...`);
            setProgress(`Scanning ${subpageLinks.length} subpages for bots...`);

            const subpageResults = await Promise.allSettled(
                subpageLinks.map(async (link) => {
                    try {
                        visitedUrls.add(link);
                        const content = await fetchWithProxy(link);
                        const { bots, links } = extractXmlFromHtml(content, link);
                        bots.forEach(addBot);
                        return { link, found: bots.length };
                    } catch {
                        return { link, found: 0 };
                    }
                })
            );

            const subpagesWithBots = subpageResults
                .filter((r): r is PromiseFulfilledResult<{ link: string; found: number }> => r.status === 'fulfilled' && r.value.found > 0);
            addLog(`Subpages: ${subpagesWithBots.length} had bots`);

            // Phase 4: Check robots.txt for sitemap and hidden paths
            setProgress('Checking robots.txt...');
            try {
                const robotsUrl = baseUrl + '/robots.txt';
                const robotsTxt = await fetchWithProxy(robotsUrl);
                addLog('Found robots.txt');

                // Extract sitemap URLs
                const sitemapMatches = robotsTxt.match(/Sitemap:\s*(.+)/gi);
                if (sitemapMatches) {
                    addLog(`Found ${sitemapMatches.length} sitemap(s) in robots.txt`);
                    for (const sm of sitemapMatches.slice(0, 3)) {
                        const smUrl = sm.replace(/Sitemap:\s*/i, '').trim();
                        if (isValidUrl(smUrl)) {
                            try {
                                const smContent = await fetchWithProxy(smUrl);
                                // Extract URLs from sitemap
                                const urlMatches = smContent.match(/<loc>(.*?)<\/loc>/gi);
                                if (urlMatches) {
                                    const xmlUrls = urlMatches
                                        .map(u => u.replace(/<\/?loc>/gi, '').trim())
                                        .filter(u => u.match(/\.xml/i) && isSameDomain(u, targetUrl));
                                    addLog(`Sitemap: found ${xmlUrls.length} XML URLs`);
                                    for (const xmlUrl of xmlUrls.slice(0, 20)) {
                                        if (!visitedUrls.has(xmlUrl)) {
                                            visitedUrls.add(xmlUrl);
                                            try {
                                                const xmlContent = await fetchWithProxy(xmlUrl);
                                                if (xmlContent.includes('<block') || xmlContent.includes('<xml')) {
                                                    addBot({
                                                        name: decodeURIComponent(xmlUrl.split('/').pop()?.replace('.xml', '') || 'Sitemap Bot'),
                                                        xml: xmlContent.trim(),
                                                        source: xmlUrl,
                                                        size: xmlContent.length,
                                                    });
                                                }
                                            } catch {}
                                        }
                                    }
                                }
                            } catch {}
                        }
                    }
                }

                // Extract Disallowed paths that look like bot directories
                const disallowedPaths = robotsTxt.match(/Disallow:\s*(.+)/gi);
                if (disallowedPaths) {
                    const botPaths = disallowedPaths
                        .map(d => d.replace(/Disallow:\s*/i, '').trim())
                        .filter(p => p.match(/(bot|xml|strat|download|file)/i));
                    addLog(`Found ${botPaths.length} potential bot paths in robots.txt`);
                    for (const p of botPaths.slice(0, 10)) {
                        const checkUrl = baseUrl + p;
                        if (!visitedUrls.has(checkUrl)) {
                            visitedUrls.add(checkUrl);
                            try {
                                const content = await fetchWithProxy(checkUrl);
                                const { bots } = extractXmlFromHtml(content, checkUrl);
                                bots.forEach(addBot);
                            } catch {}
                        }
                    }
                }
            } catch {
                addLog('No robots.txt found');
            }

            // Phase 5: Deep scan collected links (depth 2)
            const remainingLinks = [...deepLinks]
                .filter(l => !visitedUrls.has(l) && isValidUrl(l))
                .filter(l => l.match(/(xml|bot|strat|download|file)/i))
                .slice(0, 20);

            if (remainingLinks.length > 0) {
                addLog(`Deep scanning ${remainingLinks.length} additional links...`);
                setProgress(`Deep scanning ${remainingLinks.length} links...`);

                await Promise.allSettled(
                    remainingLinks.map(async (link) => {
                        try {
                            visitedUrls.add(link);
                            const content = await fetchWithProxy(link);
                            const { bots } = extractXmlFromHtml(content, link);
                            bots.forEach(addBot);
                        } catch {}
                    })
                );
            }

            // Phase 6: Try common bot page names
            setProgress('Checking common bot page names...');
            const commonPages = [
                'bots', 'free-bots', 'strategies', 'downloads', 'xml',
                'bot-list', 'bot-gallery', 'trading-bots', 'deriv-bots',
                'blockly-bots', 'binary-bot', 'dbot-strategies',
            ];

            const pageResults = await Promise.allSettled(
                commonPages.map(async (page) => {
                    try {
                        const pageUrl = `${baseUrl}/${page}`;
                        if (visitedUrls.has(pageUrl)) return { page, found: 0 };
                        visitedUrls.add(pageUrl);
                        const content = await fetchWithProxy(pageUrl);
                        if (content) {
                            const { bots } = extractXmlFromHtml(content, pageUrl);
                            bots.forEach(addBot);
                            return { page, found: bots.length };
                        }
                        return { page, found: 0 };
                    } catch {
                        return { page, found: 0 };
                    }
                })
            );

            const pagesWithBots = pageResults
                .filter((r): r is PromiseFulfilledResult<{ page: string; found: number }> => r.status === 'fulfilled' && r.value.found > 0);
            addLog(`Common pages: ${pagesWithBots.length} had bots`);

            // Done
            setExtractedBots(allBots);
            setProgress('');
            addLog(`\n=== DONE: Found ${allBots.length} bot(s) total ===`);

            if (allBots.length === 0) {
                setError('No XML bots found. The site may load content dynamically after page load, or bots may not be in standard XML format.');
            }
        } catch (err: any) {
            setError(`Extraction failed: ${err.message}. Check the URL and try again.`);
            setProgress('');
        } finally {
            setIsExtracting(false);
        }
    }, [url, fetchWithProxy, extractXmlFromHtml, addLog]);

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
                    Paste a link to any Deriv third-party site to extract all available XML bots
                </p>
            </div>

            <div className='bot-extractor__input-section'>
                <div className='bot-extractor__input-row'>
                    <input
                        type='text'
                        className='bot-extractor__input'
                        placeholder='Paste site URL (e.g. https://example.com/bots)'
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
                                        <span className='bot-extractor__bot-source'>{bot.source}</span>
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
                        Scans: page HTML, common bot directories, sitemaps, robots.txt, linked pages, inline XML, Blockly scripts
                    </p>
                </div>
            )}
        </div>
    );
};

export default BotExtractor;

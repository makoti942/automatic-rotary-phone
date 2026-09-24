import React, { useState, useCallback } from 'react';
import { useStore } from '@deriv/stores';
import { DBOT_TABS } from '@/constants/bot-contents';
import './bot-extractor.scss';

interface ExtractedBot {
    name: string;
    xml: string;
    source: string;
    size: number;
}

const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

const BotExtractor = () => {
    const { dashboard, load_modal } = useStore();
    const { setActiveTab } = dashboard;

    const [url, setUrl] = useState('');
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractedBots, setExtractedBots] = useState<ExtractedBot[]>([]);
    const [error, setError] = useState('');
    const [progress, setProgress] = useState('');
    const [loadedBots, setLoadedBots] = useState<Set<string>>(new Set());

    const fetchWithProxy = useCallback(async (targetUrl: string): Promise<string> => {
        const proxyUrl = `${CORS_PROXY}${encodeURIComponent(targetUrl)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        return res.text();
    }, []);

    const extractXmlFromHtml = useCallback((html: string, baseUrl: string): ExtractedBot[] => {
        const bots: ExtractedBot[] = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // 1. Find all <link> tags pointing to .xml files
        const links = doc.querySelectorAll('link[href$=".xml"], link[href*=".xml?"]');
        links.forEach(link => {
            const href = link.getAttribute('href');
            if (href) {
                const fullUrl = new URL(href, baseUrl).href;
                bots.push({ name: href.split('/').pop()?.replace('.xml', '') || 'Unknown Bot', xml: '', source: fullUrl, size: 0 });
            }
        });

        // 2. Find all <a> tags pointing to .xml files
        const anchors = doc.querySelectorAll('a[href$=".xml"], a[href*=".xml?"]');
        anchors.forEach(a => {
            const href = a.getAttribute('href');
            if (href) {
                const fullUrl = new URL(href, baseUrl).href;
                const name = a.textContent?.trim() || href.split('/').pop()?.replace('.xml', '') || 'Unknown Bot';
                if (!bots.some(b => b.source === fullUrl)) {
                    bots.push({ name, xml: '', source: fullUrl, size: 0 });
                }
            }
        });

        // 3. Find all <script> tags with type="text/xml" or containing XML block definitions
        const scripts = doc.querySelectorAll('script[type="text/xml"], script[type="application/xml"]');
        scripts.forEach((script, i) => {
            const content = script.textContent || '';
            if (content.includes('<xml') || content.includes('<block')) {
                bots.push({
                    name: script.getAttribute('data-name') || `Inline Bot ${i + 1}`,
                    xml: content.trim(),
                    source: 'inline',
                    size: content.length,
                });
            }
        });

        // 4. Find inline XML in data attributes
        const xmlElements = doc.querySelectorAll('[data-xml], [data-bot], [data-strategy]');
        xmlElements.forEach((el, i) => {
            const xmlData = el.getAttribute('data-xml') || el.getAttribute('data-bot') || el.getAttribute('data-strategy');
            if (xmlData && (xmlData.includes('<xml') || xmlData.includes('<block'))) {
                const name = el.getAttribute('data-name') || el.textContent?.trim().substring(0, 50) || `Extracted Bot ${i + 1}`;
                bots.push({ name, xml: xmlData.trim(), source: 'data-attribute', size: xmlData.length });
            }
        });

        // 5. Find <xml> elements directly in the HTML (old-school Binary Bot style)
        const xmlElementsDirect = doc.querySelectorAll('xml');
        xmlElementsDirect.forEach((el, i) => {
            const content = el.outerHTML;
            if (content.includes('<block')) {
                bots.push({
                    name: el.getAttribute('data-name') || `XML Bot ${i + 1}`,
                    xml: content,
                    source: 'inline-xml',
                    size: content.length,
                });
            }
        });

        // 6. Search for XML patterns in all text nodes (catches bots in <pre>, <code>, etc.)
        const allText = doc.body?.innerHTML || '';
        const xmlPattern = /<(?:xml|blockly)[^>]*>[\s\S]*?<\/(?:xml|blockly)>/gi;
        let match;
        while ((match = xmlPattern.exec(allText)) !== null) {
            const xmlContent = match[0];
            if (xmlContent.includes('<block') && !bots.some(b => b.xml === xmlContent)) {
                bots.push({
                    name: `Scanned Bot ${bots.length + 1}`,
                    xml: xmlContent,
                    source: 'text-scan',
                    size: xmlContent.length,
                });
            }
        }

        // 7. Look for var workspace = Blockly.Xml.textToDom patterns in scripts
        const textToDomPattern = /Blockly\.Xml\.textToDom\(['"`]([\s\S]*?)['"`]\)/gi;
        let match2;
        while ((match2 = textToDomPattern.exec(allText)) !== null) {
            const xmlContent = match2[1]
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
                .replace(/\\"/g, '"')
                .replace(/\\'/g, "'");
            if (xmlContent.includes('<block') && !bots.some(b => b.xml === xmlContent)) {
                bots.push({
                    name: `Script Bot ${bots.length + 1}`,
                    xml: xmlContent,
                    source: 'script-extract',
                    size: xmlContent.length,
                });
            }
        }

        // 8. Look for strategy_to_load patterns
        const strategyPattern = /strategy_to_load\s*=\s*['"`]([\s\S]*?)['"`]/gi;
        let match3;
        while ((match3 = strategyPattern.exec(allText)) !== null) {
            const xmlContent = match3[1]
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
                .replace(/\\"/g, '"')
                .replace(/\\'/g, "'");
            if (xmlContent.includes('<block') && !bots.some(b => b.xml === xmlContent)) {
                bots.push({
                    name: `Strategy Bot ${bots.length + 1}`,
                    xml: xmlContent,
                    source: 'strategy-extract',
                    size: xmlContent.length,
                });
            }
        }

        return bots;
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
        setProgress('Fetching page...');

        try {
            const html = await fetchWithProxy(targetUrl);
            setProgress('Scanning for bots...');

            const bots = extractXmlFromHtml(html, targetUrl);
            setProgress(`Found ${bots.length} potential bot(s). Fetching XML content...`);

            // Fetch XML content for linked bots
            const enrichedBots: ExtractedBot[] = [];
            for (let i = 0; i < bots.length; i++) {
                const bot = bots[i];
                setProgress(`Loading bot ${i + 1}/${bots.length}: ${bot.name}...`);

                if (bot.xml) {
                    // Already have XML content (inline)
                    enrichedBots.push(bot);
                } else if (bot.source && bot.source !== 'inline' && bot.source !== 'data-attribute') {
                    try {
                        const xmlContent = await fetchWithProxy(bot.source);
                        if (xmlContent.includes('<xml') || xmlContent.includes('<block')) {
                            enrichedBots.push({ ...bot, xml: xmlContent.trim(), size: xmlContent.length });
                        }
                    } catch {
                        // Skip bots we can't fetch
                    }
                }
            }

            setExtractedBots(enrichedBots);
            if (enrichedBots.length === 0) {
                setError('No XML bots found on this page. The site may use dynamic loading or a different bot format.');
            }
        } catch (err: any) {
            setError(`Extraction failed: ${err.message || 'Unknown error'}. Check the URL and try again.`);
        } finally {
            setIsExtracting(false);
            setProgress('');
        }
    }, [url, fetchWithProxy, extractXmlFromHtml]);

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
                        Supports: Binary Bot, Deriv Bot, and any site with XML strategy files
                    </p>
                </div>
            )}
        </div>
    );
};

export default BotExtractor;

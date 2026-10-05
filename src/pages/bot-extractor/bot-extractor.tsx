import React, { useState, useCallback, useEffect } from 'react';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import localForage from 'localforage';
import './bot-extractor.scss';

interface ExtractedBot {
    name: string;
    xml: string;
    source: string;
    size: number;
    fromTab: string;
    catalogOnly?: boolean;
}

function getBotSourceSite(source: string): string {
    try {
        const urlMatch = source.match(/https?:\/\/[^\s]+/i)?.[0];
        if (urlMatch) return new URL(urlMatch).hostname.replace(/^www\./i, '');
    } catch {}
    return 'Current page';
}

const EXTRACTED_BOTS_STORAGE_KEY = 'bot-extractor:extracted-bots:v1';
const EXTRACTED_BOTS_DB_KEY = 'bot-extractor:extracted-bots:v2';
const BOT_DOWNLOAD_PASSWORD = '**********';
const LEGACY_PRIME_ORIGIN = 'https://www.legacyprime.live';
const LEGACY_PRIME_HOSTS = /(?:^|\.)(?:legacyprime\.live|nexusempire\.live|dtradinghub\.com)$/i;

const LEGACY_PRIME_PRODUCT_LABELS: Record<string, string> = {
    apex_ai_v3: 'Apex AI V3',
    apex_ai_v3_lifetime: 'Apex AI V3 Lifetime',
    apex_ai_v3_daily: 'Apex AI V3 Daily',
    apex_ai_v3_weekly: 'Apex AI V3 Weekly',
    apex_ai_v3_monthly: 'Apex AI V3 Monthly',
    ai_version_two: 'Apex AI V2',
    ai_version_two_lifetime: 'Apex AI V2 Lifetime',
    ai_version_two_daily: 'Apex AI V2 Daily',
    ai_version_two_weekly: 'Apex AI V2 Weekly',
    ai_version_two_monthly: 'Apex AI V2 Monthly',
    novagrid2026: 'NovaGrid 2026',
    novagridElite: 'NovaGrid Elite',
    optima_ai: 'Optima AI',
    optima_ai_lifetime: 'Optima AI Lifetime',
    optima_ai_daily: 'Optima AI Daily',
    optima_ai_weekly: 'Optima AI Weekly',
    optima_ai_monthly: 'Optima AI Monthly',
    binarybeast_v2_pro: 'BinaryBeast V2 Pro',
    binarybeast_v2_pro_lifetime: 'BinaryBeast V2 Pro Lifetime',
    binarybeast_v2_pro_daily: 'BinaryBeast V2 Pro Daily',
    binarybeast_v2_pro_weekly: 'BinaryBeast V2 Pro Weekly',
    binarybeast_v2_pro_monthly: 'BinaryBeast V2 Pro Monthly',
    signals: 'Signals',
};

interface LegacyPrimeProduct {
    key: string;
    rotCount: number;
    dotCount: number;
    hasMeta: boolean;
}

interface WebpackXmlChunk {
    fileName: string;
    chunkId: string;
    chunkName: string;
    hash: string;
    url: string;
}

function isLegacyPrimeUrl(value: string): boolean {
    try {
        const host = new URL(value.startsWith('http') ? value : `https://${value}`).hostname.replace(/^www\./i, '');
        return LEGACY_PRIME_HOSTS.test(host) || /legacyprime/i.test(host);
    } catch {
        return /legacyprime/i.test(value);
    }
}

function findLegacyPrimeEntryScript(html: string, pageUrl: string): string | null {
    const patterns = [
        /["']((?:https?:\/\/[^"']+)?\/static\/js\/index\.[a-f0-9]+\.js)["']/i,
        /["']((?:https?:\/\/[^"']+)?\/static\/js\/index\.js)["']/i,
        /src=["']([^"']*\/static\/js\/[^"']*index[^"']*\.js)["']/i,
    ];
    for (const re of patterns) {
        const match = html.match(re);
        if (match?.[1]) {
            try { return new URL(match[1], pageUrl).href; } catch {}
        }
    }
    const candidates = [...html.matchAll(/["']([^"']*\/static\/js\/[^"']+\.js)["']/gi)]
        .map(entry => entry[1])
        .filter(Boolean);
    const indexScript = candidates.find(path => /\/index\.[a-f0-9]+\.js$/i.test(path) || /\/index\.js$/i.test(path));
    if (indexScript) {
        try { return new URL(indexScript, pageUrl).href; } catch {}
    }
    return null;
}

function parseWebpackXmlChunks(jsContent: string, baseUrl: string): WebpackXmlChunk[] {
    const fileNameToChunkId = new Map<string, string>();
    let match: RegExpExecArray | null;

    const contextRe = /["'](\.\/[A-Za-z0-9_\-]+\.xml)["']\s*:\s*\[\s*["'][^"']+["']\s*,\s*["'](\d+)["']\s*\]/g;
    while ((match = contextRe.exec(jsContent))) {
        fileNameToChunkId.set(match[1].replace(/^\.\//, ''), match[2]);
    }
    const compactContextRe = /["'](\.\/[A-Za-z0-9_\-]+\.xml)["']\s*:\s*["']?(\d+)["']?/g;
    while ((match = compactContextRe.exec(jsContent))) {
        const fileName = match[1].replace(/^\.\//, '');
        if (!fileNameToChunkId.has(fileName)) fileNameToChunkId.set(fileName, match[2]);
    }

    const nameMap = new Map<string, string>();
    const hashMap = new Map<string, string>();
    const runtimeMatch = jsContent.match(/(?:d\.u|__webpack_require__\.u)\s*=\s*[^;]{0,4000}/s);
    const runtimeMaps = runtimeMatch
        ? [...runtimeMatch[0].matchAll(/\(\{([^{}]+)\}\)\[e\]/g)].map(entry => entry[1])
        : [];
    if (runtimeMaps.length >= 1) {
        for (const entry of runtimeMaps[0].matchAll(/(?:^|,)(\d+)\s*:\s*["']([^"']+)["']/g)) {
            if (/-xml$/i.test(entry[2]) || entry[2] === 'dbot-collection') nameMap.set(entry[1], entry[2]);
        }
    }
    if (runtimeMaps.length >= 2) {
        for (const entry of runtimeMaps[1].matchAll(/(?:^|,)(\d+)\s*:\s*["']([a-f0-9]{6,})["']/g)) {
            hashMap.set(entry[1], entry[2]);
        }
    }
    if (!nameMap.size) {
        const nameRe = /(?:^|[,{])(\d+)\s*:\s*["']([A-Za-z0-9_\-]+-xml)["']/g;
        while ((match = nameRe.exec(jsContent))) nameMap.set(match[1], match[2]);
    }
    if (!hashMap.size) {
        const hashRe = /(?:^|[,{])(\d+)\s*:\s*["']([a-f0-9]{8})["']/g;
        while ((match = hashRe.exec(jsContent))) hashMap.set(match[1], match[2]);
    }

    const chunks: WebpackXmlChunk[] = [];
    for (const [fileName, chunkId] of fileNameToChunkId) {
        const chunkName = nameMap.get(chunkId);
        const hash = hashMap.get(chunkId);
        if (!chunkName || !hash) continue;
        try {
            chunks.push({
                fileName,
                chunkId,
                chunkName,
                hash,
                url: new URL(`/static/js/async/${chunkName}.${hash}.js`, baseUrl).href,
            });
        } catch {}
    }
    return chunks;
}

function extractXmlFromWebpackChunk(jsText: string): string | null {
    const quoted = jsText.match(/'(<xml\b[\s\S]*?<\/xml>)'/) || jsText.match(/"(<xml\b[\s\S]*?<\/xml>)"/);
    if (quoted?.[1]) {
        const decoded = decodeMarkup(quoted[1]).trim();
        if (isValidDerivBot(decoded)) return decoded;
    }
    return extractXmlDocuments(jsText)[0] || null;
}

function formatLegacyPrimeBotName(fileName: string): string {
    const base = fileName.replace(/\.xml$/i, '');
    if (/^[\d_]+$/.test(base)) return base.replace(/_/g, '-');
    return base
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, char => char.toUpperCase());
}

function catalogLegacyPrimeProducts(whitelistText: string): { products: LegacyPrimeProduct[]; lastUpdated: string; note: string } {
    try {
        const parsed = JSON.parse(whitelistText);
        const products: LegacyPrimeProduct[] = [];
        for (const [key, value] of Object.entries(parsed || {})) {
            if (key === 'lastUpdated' || key === 'note') continue;
            const entry = value as any;
            if (!entry || typeof entry !== 'object') continue;
            if (!('rot' in entry) && !('dot' in entry) && !('meta' in entry)) continue;
            products.push({
                key,
                rotCount: Array.isArray(entry.rot) ? entry.rot.length : 0,
                dotCount: Array.isArray(entry.dot) ? entry.dot.length : 0,
                hasMeta: !!(entry.meta && Object.keys(entry.meta).length),
            });
        }
        return { products, lastUpdated: parsed?.lastUpdated || '', note: parsed?.note || '' };
    } catch {
        return { products: [], lastUpdated: '', note: '' };
    }
}

function extractLegacyPrimeStrategyCodes(jsContent: string): string[] {
    const codes = new Set<string>();
    const caseRe = /case\s*["']([A-Z][A-Z0-9_]{2,})["']\s*:/g;
    let match: RegExpExecArray | null;
    while ((match = caseRe.exec(jsContent))) {
        const code = match[1];
        if (/^(?:Blockly|math_|lists_|text_|logic_|controls_|loops_|variables_|procedures_)/.test(code)) continue;
        if (/SNIPER|PRIME|UNDER|OVER|MOMENT|CASCADE|OSAM|MKOR|DIFFER|EVEN|TIME|FLIP|BOLLINGER|STATE|LEGOO|DP|REVERSE|BONNIE|PATTERN|FREQ|ZONE|STREAK|MULTI|DIGIT|PRICE|REVERSAL|POINT|CUSTOM|ATHENA|APEX|COLD|TREND|MATCH|FIRE/i.test(code)) {
            codes.add(code);
        }
    }
    const bonnieRe = /Bonnie[A-Za-z0-9_]*/g;
    while ((match = bonnieRe.exec(jsContent))) codes.add(match[0]);
    return [...codes].sort();
}

function extractLegacyPrimeProductFlags(jsContent: string): string[] {
    const flags = new Set<string>();
    const flagRe = /plentyProfitsPro|evenOddUnder[0-9][A-Za-z]*|speedTradingEnabled|SpeedTradingEnabled|athena_full_control|toolbar_chartlord|toolbar_entry_strategy|toolbar_entry_app_id|apex_ai|ai_version|novagrid|optima_ai|binarybeast|Anex/gi;
    let match: RegExpExecArray | null;
    while ((match = flagRe.exec(jsContent))) flags.add(match[0]);
    return [...flags].sort();
}

/**
 * Foreign bot sites can ship newer/custom Blockly block types. Register a
 * visual compatibility block instead of deleting or rewriting those blocks.
 * The original XML stays untouched; this only supplies Blockly with a shape
 * so it can render and edit the imported document.
 */
function registerCompatibilityBlocks(xml: string): string[] {
    if (typeof window === 'undefined' || !window.Blockly) return [];
    const Blockly = window.Blockly as any;
    const registered: string[] = [];
    try {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        const types = new Set(Array.from(doc.querySelectorAll('block, shadow'))
            .map(node => node.getAttribute('type'))
            .filter(Boolean) as string[]);
        types.forEach(type => {
            if (Blockly.Blocks[type]) return;
            Blockly.Blocks[type] = {
                init(this: any) {
                    this.appendDummyInput('__compatibility_header').appendField(`Imported: ${type}`);
                    const source = Array.from(doc.querySelectorAll('block, shadow'))
                        .find(node => node.getAttribute('type') === type) as Element | undefined;
                    source?.querySelectorAll(':scope > field').forEach((field: Element) => {
                        const name = field.getAttribute('name');
                        if (name) this.appendDummyInput(`__field_${name}`).appendField(field.textContent || '', name);
                    });
                    source?.querySelectorAll(':scope > value').forEach((value: Element) => {
                        const name = value.getAttribute('name');
                        if (name) this.appendValueInput(name).setCheck(null).appendField(name);
                    });
                    source?.querySelectorAll(':scope > statement').forEach((statement: Element) => {
                        const name = statement.getAttribute('name');
                        if (name) this.appendStatementInput(name).setCheck(null).appendField(name);
                    });
                    const isValueBlock = source?.parentElement?.tagName.toLowerCase() === 'value';
                    if (isValueBlock) this.setOutput(true, null);
                    else {
                        this.setPreviousStatement(true, null);
                        this.setNextStatement(true, null);
                    }
                    this.setColour(210);
                    this.setTooltip('Imported compatibility block. Original XML preserved.');
                },
            };
            Blockly.JavaScript.javascriptGenerator.forBlock[type] = (block: any) => {
                const generator = Blockly.JavaScript.javascriptGenerator;
                const purchase = block.getFieldValue?.('PURCHASE_LIST');
                if (purchase) {
                    const prediction = generator.valueToCode(block, 'PREDICTION', generator.ORDER_ATOMIC);
                    return `Bot.purchase(${JSON.stringify(purchase)}${prediction ? `, ${prediction}` : ''});\n`;
                }
                const option = block.getFieldValue?.('OPTION');
                const variableId = block.getFieldValue?.('VAR');
                if (option !== null && option !== undefined && variableId) {
                    const variable = generator.variableDB_?.getName(variableId, Blockly.Variables.CATEGORY_NAME) || JSON.stringify(variableId);
                    if (block.outputConnection && !block.previousConnection) {
                        return [`${variable} === ${JSON.stringify(option)}`, generator.ORDER_EQUALITY];
                    }
                    return `${variable} = ${JSON.stringify(option)};\n`;
                }
                const isValueBlock = block.outputConnection && !block.previousConnection;
                if (isValueBlock) return ['0', generator.ORDER_ATOMIC];
                return '';
            };
            registered.push(type);
        });
    } catch {
        // Let the official loader report malformed XML; do not mutate it.
    }
    return registered;
}

function mergeExtractedBots(existing: ExtractedBot[], incoming: ExtractedBot[]): ExtractedBot[] {
    const merged = [...existing];
    const seen = new Set(existing.map(bot => bot.xml.trim() || `${bot.source}|${bot.name}`));
    for (const bot of incoming) {
        const xml = bot.xml.trim();
        const catalogIndex = merged.findIndex(existingBot => existingBot.catalogOnly && existingBot.name.toLowerCase() === bot.name.toLowerCase() && xml);
        if (catalogIndex >= 0) {
            merged[catalogIndex] = { ...bot, xml, size: bot.size || xml.length };
            seen.add(xml);
            continue;
        }
        const key = xml || `${bot.source}|${bot.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({ ...bot, xml, size: bot.size || xml.length });
    }
    return merged.slice(-250);
}

const CORS_PROXIES = [
    (url: string) => `/api/proxy?url=${encodeURIComponent(url)}`,
    (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

const LEGACYPRIME_FREE_BOTS: Array<{ name: string; tab: string }> = [
    { name: 'CFX Even/Odd', tab: 'Free Bots · Even/Odd' },
    { name: 'CFX-025 Enhanced', tab: 'Free Bots · Even/Odd' },
    { name: 'Even Odd Ghost V1 by Dexter', tab: 'Free Bots · Even/Odd' },
    { name: 'CFX-025 Base', tab: 'Free Bots · Even/Odd' },
    { name: 'PATEL (with Entry)', tab: 'Free Bots · Over/Under' },
    { name: 'CEOSpeedBot (With Entry)', tab: 'Free Bots · Over/Under / Rise/Fall' },
    { name: 'Over/Under Ghost by States FX', tab: 'Free Bots · Over/Under' },
    { name: 'Over/Under Ghost V2 by States FX', tab: 'Free Bots · Over/Under' },
    { name: 'Over2 Master', tab: 'Free Bots · Over/Under' },
    { name: 'CFX Rise/Fall', tab: 'Free Bots · Rise/Fall' },
    { name: 'MatchesMaster', tab: 'Free Bots · Matches' },
    { name: 'Game Changer AI - etrades', tab: 'Free Bots · Multi-strategy' },
    { name: 'Digit Hunter Pro', tab: 'Free Bots · Multi-strategy' },
    { name: 'MarketMaker Pro Enhanced', tab: 'Free Bots · Multi-strategy' },
    { name: 'Deriv Killer', tab: 'Free Bots · Multi-strategy' },
];

async function discoverLegacyPrimeCatalog(
    baseUrl: string,
    fetchText: (url: string, timeout?: number) => Promise<string | null>,
    addLog: (message: string) => void,
): Promise<ExtractedBot[]> {
    const source = `${baseUrl}/api/membership/bots`;
    const catalog: ExtractedBot[] = LEGACYPRIME_FREE_BOTS.map(bot => ({
        name: bot.name,
        xml: '',
        source: `catalog:${baseUrl}#${encodeURIComponent(bot.name)}`,
        size: 0,
        fromTab: bot.tab,
        catalogOnly: true,
    }));

    const membership = await fetchText(source, 8000);
    try {
        const payload = membership ? JSON.parse(membership) : null;
        for (const bot of Array.isArray(payload?.bots) ? payload.bots : []) {
            if (!bot?.name) continue;
            catalog.push({
                name: String(bot.name),
                xml: '',
                source: `catalog:${source}#${String(bot.id || bot.name)}`,
                size: 0,
                fromTab: 'Membership Bots',
                catalogOnly: true,
            });
        }
    } catch {
        addLog('LegacyPrime membership catalog was not readable.');
    }

    addLog(`LegacyPrime catalog: ${catalog.length} named bot(s) found; XML access is shown honestly where the site protects it.`);
    return catalog;
}

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
    if (!/<xml\b[^>]*\bis_dbot=["']true["']/i.test(trimmed)) return false;
    const blockCount = (trimmed.match(/<block\b/gi) || []).length;
    if (blockCount < 5) return false;
    const hasTradeDefinition = /<block\b[^>]*type=["']trade_definition["']/i.test(trimmed);
    const hasPurchase = /<block\b[^>]*type=["'](?:purchase|apollo_purchase|apollo_purchase2)["']/i.test(trimmed);
    const hasTradeFlow = /<block\b[^>]*type=["'](?:before_purchase|during_purchase|after_purchase|trade_again)["']/i.test(trimmed)
        || /<statement\s+name=["'](?:BEFOREPURCHASE_STACK|DURINGPURCHASE_STACK|AFTERPURCHASE_STACK)["']/i.test(trimmed);
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
    const matchesStockTemplate = /(?:^|[\\/])(?:accumulators?|dalembert|martingale|max-stake|oscars?|reverse|1_3_2_6|dbot-collection)[^\\/]*?(?:-xml)?(?:\.[a-f0-9]{6,})?\.js$/i.test(source);
    if (!matchesStockTemplate) return false;
    try {
        const host = new URL(source).hostname;
        // Official Deriv hosts ship these as noise. White-label sites use the
        // same stock templates as their public Free Bots library.
        return /(^|\.)deriv\.com$/i.test(host) || /derivbot/i.test(host) || /blockly/i.test(host);
    } catch {
        return false;
    }
}

function normalizeBotName(name: string | null | undefined): string | null {
    if (!name) return null;
    const cleaned = name.replace(/[_-]+/g, ' ').replace(/\\s+/g, ' ').trim();
    if (!cleaned || /^(?:bot|xml|data|payload|content|strategy|workspace|document|template)(?:\\s*\\d+)?$/i.test(cleaned)) return null;
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
        const name = normalizeBotName(guessNameFromContext(jsContent, jsContent.indexOf(xml.slice(0, 40)), xml))
            || normalizeBotName(guessNameFromChunkSource(jsSource));
        if (!name) return [];
        seenContent.add(xml);
        return [{ name, xml, source: 'embedded:' + jsSource, size: xml.length }];
    });
}
function guessNameFromChunkSource(source: string): string {
    try {
        const filename = decodeURIComponent(new URL(source).pathname.split('/').pop() || '');
        const isXmlChunk = /-xml\.[a-f0-9]{6,}\.js$/i.test(filename);
        const chunk = filename.replace(/\.[a-f0-9]{6,}\.js$/i, '').replace(/-xml$/i, '');
        if (!isXmlChunk && !/(?:free|bot|strategy|scalper)/i.test(chunk)) return '';
        return chunk.replace(/^(?:dollarprinter|dbotspace|dbtraders|traderkit|money8gg|exwager|osam|mkorean)-/i, '')
            .replace(/^(?:free|bots?|strateg(?:y|ies)|scalper)-/i, '').replace(/[-_]+/g, ' ');
    } catch { return ''; }
}
function guessNameFromContext(jsContent: string, position: number, xml: string): string {
    const beforeDocument = jsContent.substring(0, position);
    const moduleMatches = [...beforeDocument.matchAll(/(?:^|[,{}])(\d+):function\(/g)];
    const moduleId = moduleMatches.pop()?.[1];
    if (moduleId) {
        const escapedId = moduleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const moduleFile = jsContent.match(new RegExp(`["']([^"']+\\.xml)["']\\s*:\\s*["']${escapedId}["']`, 'i'));
        if (moduleFile) return normalizeBotName(moduleFile[1].replace(/^\.\//, '').replace(/\.xml$/i, '')) || '';
    }
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
    return '';
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
    const [extractedBots, setExtractedBots] = useState<ExtractedBot[]>(() => {
        if (typeof window === 'undefined') return [];
        try {
            const saved = window.localStorage.getItem(EXTRACTED_BOTS_STORAGE_KEY);
            const parsed = saved ? JSON.parse(saved) : [];
            return Array.isArray(parsed) ? parsed.filter(bot => bot?.name && (bot?.xml || bot?.catalogOnly)) : [];
        } catch { return []; }
    });
    const [isLibraryHydrated, setIsLibraryHydrated] = useState(false);
    const [error, setError] = useState('');
    const [progress, setProgress] = useState('');
    const [loadedBots, setLoadedBots] = useState<Set<string>>(new Set());
    const [scanLog, setScanLog] = useState<string[]>([]);
    const [isBotDrawerOpen, setIsBotDrawerOpen] = useState(false);
    const [botSearch, setBotSearch] = useState('');
    const drawerTouchStartX = React.useRef<number | null>(null);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const saved = await localForage.getItem<ExtractedBot[]>(EXTRACTED_BOTS_DB_KEY);
                if (active && Array.isArray(saved) && saved.length) setExtractedBots(saved.filter(bot => bot?.name && (bot?.xml || bot?.catalogOnly)));
                else if (active) {
                    const legacy = window.localStorage.getItem(EXTRACTED_BOTS_STORAGE_KEY);
                    const parsed = legacy ? JSON.parse(legacy) : [];
                    if (Array.isArray(parsed) && parsed.length) {
                        const valid = parsed.filter(bot => bot?.name && (bot?.xml || bot?.catalogOnly));
                        setExtractedBots(valid);
                        await localForage.setItem(EXTRACTED_BOTS_DB_KEY, valid);
                    }
                }
            } catch {
                // Keep the synchronously restored legacy list if IndexedDB is unavailable.
            } finally {
                if (active) setIsLibraryHydrated(true);
            }
        })();
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!isLibraryHydrated) return;
        localForage.setItem(EXTRACTED_BOTS_DB_KEY, extractedBots).catch(() => {});
    }, [extractedBots, isLibraryHydrated]);

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

    const extractFromLegacyPrime = useCallback(async (overrideUrl?: string) => {
        const rawUrl = (overrideUrl || url || LEGACY_PRIME_ORIGIN).trim();
        let targetUrl = rawUrl;
        if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;
        if (!isLegacyPrimeUrl(targetUrl)) {
            setError('Legacy Prime extractor targets legacyprime.live. Paste a Legacy Prime URL or leave the field empty.');
            return;
        }

        setIsExtracting(true);
        setError('');
        setScanLog([]);

        const addLocalLog = (msg: string) => setScanLog(prev => [...prev, msg]);
        const seenContent = new Set<string>();
        const allBots: ExtractedBot[] = [];

        const fetchSafe = async (fetchTarget: string, timeout = 20000): Promise<string | null> => {
            for (const proxyFn of CORS_PROXIES) {
                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), timeout);
                    const res = await fetch(proxyFn(fetchTarget), { signal: controller.signal });
                    clearTimeout(timer);
                    if (res.ok) {
                        const text = await res.text();
                        if (text && text.length > 20) return text;
                    }
                } catch {}
            }
            return null;
        };

        try {
            addLocalLog('--- Legacy Prime Extract ---');
            addLocalLog(`Target: ${targetUrl}`);
            setProgress('Fetching Legacy Prime homepage...');

            let origin = LEGACY_PRIME_ORIGIN;
            try { origin = new URL(targetUrl).origin; } catch {}

            let entryScript = '';
            for (const pageUrl of [targetUrl, `${origin}/`, `${origin}/app`]) {
                const page = await fetchSafe(pageUrl);
                if (!page) continue;
                if (!/<!doctype html|<html\b/i.test(page.slice(0, 800)) && !page.includes('static/js/')) continue;
                addLocalLog(`Fetched page: ${pageUrl} (${(page.length / 1024).toFixed(1)} KB)`);
                entryScript = findLegacyPrimeEntryScript(page, pageUrl) || '';
                if (entryScript) {
                    addLocalLog(`Entry script: ${entryScript}`);
                    break;
                }
            }

            if (!entryScript) {
                addLocalLog('Entry script not found in HTML — probing common paths...');
                for (const probe of [`${origin}/static/js/index.js`, `${origin}/static/js/main.js`]) {
                    const body = await fetchSafe(probe);
                    if (body && body.includes('webpack') && body.includes('.xml')) {
                        entryScript = probe;
                        addLocalLog(`Entry script (probe): ${probe}`);
                        break;
                    }
                }
            }

            if (!entryScript) {
                throw new Error('Could not locate the Legacy Prime entry JavaScript bundle. The site layout may have changed.');
            }

            setProgress('Parsing webpack XML context map...');
            addLocalLog('\n--- Step 2: Parsing webpack runtime ---');
            const entryJs = await fetchSafe(entryScript, 45000);
            if (!entryJs || /<!doctype html/i.test(entryJs.slice(0, 200))) {
                throw new Error('Failed to fetch the Legacy Prime entry bundle.');
            }

            const chunks = parseWebpackXmlChunks(entryJs, origin);
            addLocalLog(`Found ${chunks.length} stock XML template chunk(s)`);
            for (const chunk of chunks) {
                addLocalLog(`  ${chunk.fileName} -> ${chunk.chunkName}.${chunk.hash}.js`);
            }

            setProgress(`Fetching ${chunks.length} XML chunks...`);
            addLocalLog('\n--- Step 3: Downloading stock Deriv XML templates ---');
            if (!chunks.length) addLocalLog('  (no webpack XML chunks discovered)');

            const chunkResults = await Promise.allSettled(chunks.map(async chunk => ({
                chunk,
                js: await fetchSafe(chunk.url, 30000),
            })));
            for (const result of chunkResults) {
                if (result.status !== 'fulfilled' || !result.value.js) {
                    addLocalLog('  ❌ Failed to download a chunk');
                    continue;
                }
                const { chunk, js } = result.value;
                const xml = extractXmlFromWebpackChunk(js);
                if (!xml || !isValidDerivBot(xml)) {
                    addLocalLog(`  ❌ ${chunk.fileName}: no valid bot XML in chunk`);
                    continue;
                }
                if (seenContent.has(xml)) {
                    addLocalLog(`  ⏭ ${chunk.fileName}: duplicate XML skipped`);
                    continue;
                }
                seenContent.add(xml);
                const name = formatLegacyPrimeBotName(chunk.fileName);
                allBots.push({ name, xml, source: chunk.url, size: xml.length, fromTab: 'Legacy Prime' });
                addLocalLog(`  ✅ ${name} (${(xml.length / 1024).toFixed(1)} KB)`);
            }

            setProgress('Cataloging Legacy Prime products...');
            addLocalLog('\n--- Step 4: Public Legacy Prime APIs ---');
            const whitelist = await fetchSafe(`${origin}/api/premium-whitelist`, 15000);
            if (whitelist) {
                const catalog = catalogLegacyPrimeProducts(whitelist);
                addLocalLog(`Premium whitelist updated: ${catalog.lastUpdated || 'unknown'}`);
                if (catalog.products.length) {
                    addLocalLog(`Premium product keys (${catalog.products.length}):`);
                    for (const product of catalog.products) {
                        const label = LEGACY_PRIME_PRODUCT_LABELS[product.key] || product.key;
                        addLocalLog(`  • ${label} (${product.key}): ${product.rotCount} real / ${product.dotCount} demo wallet(s)${product.hasMeta ? ' · has customer meta' : ''}`);
                    }
                    addLocalLog('Note: Apex AI V2/V3, NovaGrid, Optima AI, BinaryBeast, Signals, Anex are OAuth + whitelist gated. Their XML is not publicly downloadable without a whitelisted wallet.');
                }
            } else {
                addLocalLog('  premium-whitelist API unreachable');
            }

            const videos = await fetchSafe(`${origin}/api/tutorial-videos`, 12000);
            if (videos) {
                try {
                    const parsedVideos = JSON.parse(videos);
                    const list = Array.isArray(parsedVideos?.videos) ? parsedVideos.videos : [];
                    addLocalLog(`Tutorial videos: ${list.length}`);
                    for (const video of list.slice(0, 8)) {
                        addLocalLog(`  • ${video.title || video.id}`);
                    }
                } catch {
                    addLocalLog('  tutorial-videos: response not JSON');
                }
            }

            addLocalLog('\n--- Step 5: Athena / entry strategy catalog ---');
            const strategies = extractLegacyPrimeStrategyCodes(entryJs);
            addLocalLog(`Strategy codes found: ${strategies.length}`);
            if (strategies.length) addLocalLog(strategies.join(', '));
            const flags = extractLegacyPrimeProductFlags(entryJs);
            if (flags.length) addLocalLog(`Product flags: ${flags.join(', ')}`);

            addLocalLog('\n--- Step 6: Probing premium XML paths ---');
            setProgress('Probing premium bot paths...');
            const baseProducts = ['apex_ai_v3', 'ai_version_two', 'novagrid2026', 'novagridElite', 'optima_ai', 'binarybeast_v2_pro', 'signals', 'the_anex'];
            const probeTemplates = [
                (product: string) => `${origin}/xml/${product}.xml`,
                (product: string) => `${origin}/bots/${product}.xml`,
                (product: string) => `${origin}/api/premium/${product}.xml`,
            ];
            let gated = 0;
            let premiumFound = 0;
            for (const product of baseProducts) {
                for (const build of probeTemplates) {
                    const probeUrl = build(product);
                    const body = await fetchSafe(probeUrl, 6000);
                    if (!body) continue;
                    if (/<html|<!doctype/i.test(body.slice(0, 300))) {
                        gated++;
                        continue;
                    }
                    const xml = extractXmlFromWebpackChunk(body) || (isValidDerivBot(body) ? body.trim() : null);
                    if (xml && isValidDerivBot(xml) && !seenContent.has(xml)) {
                        seenContent.add(xml);
                        const name = LEGACY_PRIME_PRODUCT_LABELS[product] || formatLegacyPrimeBotName(product);
                        allBots.push({ name, xml, source: probeUrl, size: xml.length, fromTab: 'Legacy Prime Premium' });
                        premiumFound++;
                        addLocalLog(`  ✅ Premium XML: ${name}`);
                    }
                }
            }
            if (!premiumFound) {
                addLocalLog(`  No public premium XML (SPA shell / gated) on probed paths (${gated} SPA responses).`);
                addLocalLog('  Premium bots require a whitelisted OAuth wallet (ROT/DOT) on legacyprime.live.');
            }

            setExtractedBots(prev => mergeExtractedBots(prev, allBots));
            setProgress('');
            addLocalLog(`\n=== Client extract: ${allBots.length} bot(s) ===`);
            addLocalLog('Stock Deriv templates are public on Legacy Prime. Premium AI bots are membership-gated.');

            if (!allBots.length) {
                addLocalLog('\nClient webpack path found 0 bots — trying server deep-extract fallback...');
                setProgress('Trying server deep extract...');
                try {
                    const res = await fetch('/api/deep-extract', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: targetUrl }),
                    });
                    if (res.ok) {
                        const data = await res.json();
                        const serverBots: ExtractedBot[] = (data.bots || []).map((bot: any, i: number) => ({
                            name: bot.name || `Legacy Prime Bot ${i + 1}`,
                            xml: bot.xml,
                            source: bot.source || targetUrl,
                            size: bot.size || bot.xml?.length || 0,
                            fromTab: 'Legacy Prime',
                        }));
                        const valid = serverBots.filter(bot => bot.xml && isValidDerivBot(bot.xml));
                        if (valid.length) {
                            setExtractedBots(prev => mergeExtractedBots(prev, valid));
                            addLocalLog(`Server fallback extracted ${valid.length} bot(s)`);
                            addLocalLog(`=== COMPLETE: ${valid.length} bot(s) extracted ===`);
                        } else {
                            addLocalLog(`Server fallback returned ${data.count || 0} bot(s), none valid`);
                            addLocalLog('=== COMPLETE: 0 bot(s) extracted ===');
                            setError('No bots extracted from Legacy Prime. Public stock templates should normally be available — the site bundle layout may have changed.');
                        }
                    } else {
                        addLocalLog(`Server fallback HTTP ${res.status}`);
                        addLocalLog('=== COMPLETE: 0 bot(s) extracted ===');
                        setError('No bots extracted from Legacy Prime. Public stock templates should normally be available — the site bundle layout may have changed.');
                    }
                } catch (fallbackErr: any) {
                    addLocalLog(`Server fallback failed: ${fallbackErr.message}`);
                    addLocalLog('=== COMPLETE: 0 bot(s) extracted ===');
                    setError('No bots extracted from Legacy Prime. Public stock templates should normally be available — the site bundle layout may have changed.');
                }
                setProgress('');
            } else {
                addLocalLog(`=== COMPLETE: ${allBots.length} bot(s) extracted ===`);
            }
        } catch (err: any) {
            setError(`Legacy Prime extraction failed: ${err.message}`);
            setProgress('');
        } finally {
            setIsExtracting(false);
        }
    }, [url]);

    const extractBots = useCallback(async () => {
        if (!url.trim()) { setError('Please enter a URL'); return; }

        let targetUrl = url.trim();
        if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

        if (isLegacyPrimeUrl(targetUrl)) {
            await extractFromLegacyPrime(targetUrl);
            return;
        }

        setIsExtracting(true);
        setError('');
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
                    const sourcePath = value.split(/[?#]/)[0].replace(/^\.\//, '').replace(/^\//, '');
                    discoveredFiles.add(sourcePath || value.split('/').pop()!.split(/[?#]/)[0]);
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
            for (const manifest of ['/bots.json', '/bot-manifest.json', '/xml/manifest.json', '/assets/bots.json', '/public/xml/manifest.json']) {
                discoveredDataUrls.add(`${baseUrl}${manifest}`);
            }

            addLog('--- Step 1: Fetching main page ---');
            setProgress('Fetching main page...');
            const mainHtml = await fetchTextSafe(targetUrl);
            if (!mainHtml) throw new Error('Failed to fetch main page');
            discoverAssets(mainHtml, targetUrl);
            addLog(`Main page scanned, ${discoveredFiles.size} .xml files found`);

            if (/^(?:www\.)?legacyprime\.live$/i.test(new URL(targetUrl).hostname)) {
                addLog('\n--- LegacyPrime catalog discovery ---');
                allBots.push(...await discoverLegacyPrimeCatalog(baseUrl, fetchTextSafe, addLog));
            }

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
                const exactUrl = `${baseUrl}/${fname}`;
                if (!visited.has(exactUrl)) { visited.add(exactUrl); fetchQueue.push({ url: exactUrl, name: fname }); }
                for (const dir of dirs) {
                    if (dir === '/') continue;
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

            setExtractedBots(prev => mergeExtractedBots(prev, allBots));
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
    }, [url, addLog, extractFromLegacyPrime]);

    const loadBotToBuilder = useCallback(async (bot: ExtractedBot) => {
        if (!bot.xml) {
            setError(`${bot.name} is listed in the public catalog, but its XML requires access on the source site.`);
            return;
        }
        const tempId = `extracted_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        try {
            const xml = decodeMarkup(bot.xml).trim();
            if (!isValidDerivBot(xml)) throw new Error('The extracted XML is incomplete or invalid');

            // The extractor is a sub-tab, so Blockly may not be mounted yet.
            // Switch first, wait for the real workspace, then import. Importing
            // before this point silently leaves the old workspace unchanged.
            setActiveTab(DBOT_TABS.BOT_BUILDER);
            let workspace = window.Blockly?.derivWorkspace;
            for (let attempt = 0; !workspace && attempt < 20; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 100));
                workspace = window.Blockly?.derivWorkspace;
            }
            if (!workspace) throw new Error('Bot Builder workspace is still loading. Please try Load to Builder again.');
            // Register foreign block definitions only after the real Blockly
            // runtime is mounted. This is the temporary compatibility bridge
            // for site-specific blocks not shipped by this app.
            const compatibilityBlocks = registerCompatibilityBlocks(xml);
            await load_modal.loadStrategyToBuilder(
                { id: tempId, xml, name: bot.name, save_type: 'pending' },
                true
            );
            setLoadedBots(prev => new Set(prev).add(bot.source));
            if (compatibilityBlocks.length) {
                setError(`Loaded ${bot.name}. Preserved the original XML and added ${compatibilityBlocks.length} visual compatibility block(s): ${compatibilityBlocks.join(', ')}`);
            }
        } catch (err: any) {
            setError(`Failed to load bot: ${err.message}`);
        }
    }, [load_modal, setActiveTab]);

    const downloadBot = useCallback((bot: ExtractedBot) => {
        if (!bot.xml) {
            setError(`${bot.name} cannot be downloaded because the source site did not expose its XML publicly.`);
            return;
        }
        const password = window.prompt('Enter the Bot Builder download password:');
        if (password !== BOT_DOWNLOAD_PASSWORD) {
            if (password !== null) setError('Incorrect download password.');
            return;
        }

        const safeName = bot.name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 100) || 'extracted-bot';
        const blob = new Blob([decodeMarkup(bot.xml).trim()], { type: 'text/xml;charset=utf-8' });
        const downloadUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = downloadUrl;
        anchor.download = `${safeName}.xml`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(downloadUrl);
    }, []);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !isExtracting) extractBots();
    }, [extractBots, isExtracting]);

    const deepExtractBots = useCallback(async () => {
        if (!url.trim()) { setError('Please enter a URL'); return; }

        let targetUrl = url.trim();
        if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

        if (isLegacyPrimeUrl(targetUrl)) {
            await extractFromLegacyPrime(targetUrl);
            return;
        }

        setIsDeepExtracting(true);
        setError('');
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

            setExtractedBots(prev => mergeExtractedBots(prev, allBots));
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
    }, [url, extractFromLegacyPrime]);

    const extractFromCurrentPage = useCallback(async () => {
        setIsExtracting(true);
        setError('');
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

            setExtractedBots(prev => mergeExtractedBots(prev, allBots));
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
                <div>
                    <h2 className='bot-extractor__title'>Bot Extractor</h2>
                    <p className='bot-extractor__subtitle'>
                        Scan any Deriv site — finds bot filenames from JS bundles and .xml files
                    </p>
                </div>
                <button
                    className='bot-extractor__library-button'
                    onClick={() => setIsBotDrawerOpen(true)}
                    type='button'
                    aria-label={`Show all ${extractedBots.length} extracted bots`}
                >
                    <span className='bot-extractor__library-icon'>☰</span>
                    <span>Show All Bots</span>
                    <span className='bot-extractor__library-count'>{extractedBots.length}</span>
                </button>
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
                        <div>
                            <h3>Extracted Bots ({extractedBots.length})</h3>
                            <p className='bot-extractor__results-subtitle'>Saved on this device and available after navigation</p>
                        </div>
                    </div>
                    <div className='bot-extractor__results-description'>
                        <p className='bot-extractor__results-subtitle'>
                            Real bots copied from the site — each card contains the complete XML and a dedicated loader.
                        </p>
                    </div>

                    <div className='bot-extractor__bot-list'>
                        {extractedBots.slice(-12).map((bot, index) => (
                            <div key={index} className={`bot-extractor__bot-card ${bot.catalogOnly ? 'bot-extractor__bot-card--catalog-only' : ''}`}>
                                <div className='bot-extractor__bot-info'>
                                    <div className='bot-extractor__bot-name'>{bot.name}</div>
                                    <div className='bot-extractor__bot-meta'>
                                        <span className='bot-extractor__bot-source'>From {getBotSourceSite(bot.source)}</span>
                                        <span className='bot-extractor__bot-tab'>{bot.fromTab}</span>
                                        <span className='bot-extractor__bot-size'>
                                            {bot.catalogOnly ? 'XML access required' : `${(bot.size / 1024).toFixed(1)} KB`}
                                        </span>
                                    </div>
                                </div>
                                <div className='bot-extractor__bot-actions'>
                                    <button
                                        className={`bot-extractor__btn bot-extractor__btn--load ${loadedBots.has(bot.source) ? 'bot-extractor__btn--loaded' : ''}`}
                                        onClick={() => loadBotToBuilder(bot)}
                                        disabled={loadedBots.has(bot.source) || bot.catalogOnly}
                                    >
                                        {bot.catalogOnly ? 'XML access required' : loadedBots.has(bot.source) ? 'Loaded ✓' : 'Load to Builder'}
                                    </button>
                                    <button className='bot-extractor__btn bot-extractor__btn--download' onClick={() => downloadBot(bot)} type='button' disabled={bot.catalogOnly}>
                                        {bot.catalogOnly ? 'XML not public' : 'Download XML'}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {isBotDrawerOpen && (
                <>
                    <button className='bot-extractor__drawer-backdrop' onClick={() => setIsBotDrawerOpen(false)} aria-label='Close extracted bot library' type='button' />
                    <aside
                        className='bot-extractor__drawer'
                        aria-label='All extracted bots'
                        onTouchStart={event => { drawerTouchStartX.current = event.touches[0]?.clientX ?? null; }}
                        onTouchEnd={event => {
                            const startX = drawerTouchStartX.current;
                            const endX = event.changedTouches[0]?.clientX ?? startX;
                            drawerTouchStartX.current = null;
                            if (startX !== null && endX !== null && endX - startX > 80) setIsBotDrawerOpen(false);
                        }}
                    >
                        <div className='bot-extractor__drawer-header'>
                            <button className='bot-extractor__drawer-close' onClick={() => setIsBotDrawerOpen(false)} type='button' aria-label='Close'>×</button>
                            <div>
                                <h3>All Extracted Bots</h3>
                                <p>{extractedBots.length} bot{extractedBots.length === 1 ? '' : 's'} saved on this device</p>
                            </div>
                        </div>
                        <input
                            className='bot-extractor__drawer-search'
                            type='search'
                            value={botSearch}
                            onChange={event => setBotSearch(event.target.value)}
                            placeholder='Search extracted bots...'
                            aria-label='Search extracted bots'
                        />
                        <div className='bot-extractor__drawer-list'>
                            {extractedBots.slice().reverse().filter(bot => {
                                const query = botSearch.trim().toLowerCase();
                                return !query || `${bot.name} ${getBotSourceSite(bot.source)} ${bot.fromTab}`.toLowerCase().includes(query);
                            }).map((bot, index) => (
                                <div key={`${bot.source}-${index}`} className={`bot-extractor__bot-card ${bot.catalogOnly ? 'bot-extractor__bot-card--catalog-only' : ''}`}>
                                    <div className='bot-extractor__bot-info'>
                                        <div className='bot-extractor__bot-name'>{bot.name}</div>
                                        <div className='bot-extractor__bot-meta'>
                                            <span className='bot-extractor__bot-source'>From {getBotSourceSite(bot.source)}</span>
                                            <span className='bot-extractor__bot-tab'>{bot.fromTab}</span>
                                            <span className='bot-extractor__bot-size'>{bot.catalogOnly ? 'XML access required' : `${(bot.size / 1024).toFixed(1)} KB`}</span>
                                        </div>
                                    </div>
                                    <div className='bot-extractor__bot-actions'>
                                        <button className={`bot-extractor__btn bot-extractor__btn--load ${loadedBots.has(bot.source) ? 'bot-extractor__btn--loaded' : ''}`} onClick={() => loadBotToBuilder(bot)} disabled={loadedBots.has(bot.source) || bot.catalogOnly}>
                                            {bot.catalogOnly ? 'XML access required' : loadedBots.has(bot.source) ? 'Loaded ✓' : 'Load to Builder'}
                                        </button>
                                        <button className='bot-extractor__btn bot-extractor__btn--download' onClick={() => downloadBot(bot)} type='button' disabled={bot.catalogOnly}>
                                            {bot.catalogOnly ? 'XML not public' : 'Download XML'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {extractedBots.length > 0 && !extractedBots.some(bot => {
                                const query = botSearch.trim().toLowerCase();
                                return !query || `${bot.name} ${getBotSourceSite(bot.source)} ${bot.fromTab}`.toLowerCase().includes(query);
                            }) && <div className='bot-extractor__drawer-empty'>No bots match “{botSearch}”.</div>}
                        </div>
                    </aside>
                </>
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

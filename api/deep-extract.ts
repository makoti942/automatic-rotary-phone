import type { VercelRequest, VercelResponse } from '@vercel/node';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

interface ExtractedBot {
  name: string;
  xml: string;
  source: string;
  size: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, '--disable-web-security', '--disable-features=IsolateOrigins'],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(30000);

    const bots: ExtractedBot[] = [];
    const seenXml = new Set<string>();

    await page.goto(url, { waitUntil: 'networkidle2' });

    // Wait for any dynamic content
    await new Promise(r => setTimeout(r, 3000));

    // Find all bot links in the rendered DOM
    const botLinks = await page.evaluate(() => {
      const links: string[] = [];
      document.querySelectorAll('a[href*=".xml"], a[href*="/xml/"]').forEach(a => {
        const href = a.getAttribute('href');
        if (href) {
          try {
            links.push(new URL(href, window.location.href).href);
          } catch {}
        }
      });
      return links;
    });

    // Also find bot cards/buttons that might trigger loads
    const botTriggers = await page.evaluate(() => {
      const triggers: { selector: string; text: string }[] = [];
      document.querySelectorAll('button, a, [role="button"], .bot-card, [class*="bot"]').forEach(el => {
        const text = el.textContent?.trim() || '';
        if (text.length > 2 && text.length < 100) {
          triggers.push({ selector: getSelector(el), text });
        }
      });
      return triggers.slice(0, 20);
    });

    // Try clicking potential bot triggers to load dynamic content
    for (const trigger of botTriggers) {
      try {
        await page.click(trigger.selector, { delay: 100 });
        await new Promise(r => setTimeout(r, 1000));
      } catch {}
    }

    // Scan network requests for .xml files
    const xmlRequests: string[] = [];
    page.on('response', response => {
      const url = response.url();
      if (url.includes('.xml') && !xmlRequests.includes(url)) {
        xmlRequests.push(url);
      }
    });

    // Reload and capture network
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));

    // Fetch each discovered .xml
    for (const xmlUrl of xmlRequests) {
      try {
        const response = await page.goto(xmlUrl, { waitUntil: 'networkidle2' });
        const content = await response.text();
        if (content && content.includes('<block') && content.length > 200 && !seenXml.has(content)) {
          seenXml.add(content);
          const name = xmlUrl.split('/').pop()?.replace('.xml', '').replace(/[_-]/g, ' ') || 'Unknown Bot';
          bots.push({ name, xml: content.trim(), source: xmlUrl, size: content.length });
        }
      } catch {}
    }

    // Also extract embedded XML from page content
    const pageContent = await page.content();
    const embeddedBots = extractEmbeddedXml(pageContent, url);
    for (const bot of embeddedBots) {
      if (!seenXml.has(bot.xml)) {
        seenXml.add(bot.xml);
        bots.push(bot);
      }
    }

    // Try common .xml paths
    const baseUrl = new URL(url).origin;
    const commonPaths = ['/xml/', '/bots/', '/public/xml/', '/assets/xml/', '/static/xml/'];
    const commonNames = [
      'Poverty_Killer', 'BEST_RISE_FALL', 'MAKOTI_AUTOMATED_RISE_FALL',
      'UNDER_6', 'UNDER6', 'UNDER_6_BOT', 'UNDER6_BOT',
      'OVER_1', 'OVER1', 'Market_Killer', 'O_U_KILLER',
      'HIGH_LOW', 'EVEN_ODD_KILLER', 'DIFFERS_AUTO',
      'AI_Analyst', 'Multi_Killer', 'Digit_Hunter',
      'Entry_Digit', 'STARTER_BOT', 'FREE_BOT'
    ];

    for (const path of commonPaths) {
      for (const name of commonNames) {
        const tryUrl = `${baseUrl}${path}${name}.xml`;
        if (xmlRequests.includes(tryUrl)) continue;
        try {
          const response = await page.goto(tryUrl, { waitUntil: 'networkidle2', timeout: 10000 });
          if (response.ok()) {
            const content = await response.text();
            if (content && content.includes('<block') && content.length > 200 && !seenXml.has(content)) {
              seenXml.add(content);
              bots.push({ name: name.replace(/_/g, ' '), xml: content.trim(), source: tryUrl, size: content.length });
            }
          }
        } catch {}
      }
    }

    await browser.close();

    return res.json({ bots, count: bots.length });

  } catch (error: any) {
    if (browser) await browser.close();
    console.error('Deep extract error:', error);
    return res.status(500).json({ error: error.message || 'Extraction failed' });
  }
}

function extractEmbeddedXml(html: string, sourceUrl: string): ExtractedBot[] {
  const bots: ExtractedBot[] = [];
  let pos = 0;
  while (pos < html.length) {
    const xmlStart = html.indexOf('<xml', pos);
    if (xmlStart === -1) break;
    const xmlEnd = html.indexOf('</xml>', xmlStart);
    if (xmlEnd === -1) { pos = xmlStart + 4; continue; }

    let xml = html.substring(xmlStart, xmlEnd + 6);
    xml = xml
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, "'")
      .replace(/&/g, '&');

    if (xml.length > 100 && xml.includes('<block')) {
      const nameMatch = xml.match(/<category[^>]*name=["']([^"']+)["']/i);
      const blockMatch = xml.match(/type=["']([a-z_]+)["']/i);
      const name = nameMatch?.[1] || blockMatch?.[1] || `Bot ${bots.length + 1}`;
      bots.push({ name, xml, source: sourceUrl, size: xml.length });
    }
    pos = xmlEnd + 6;
  }
  return bots;
}

function getSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  if (el.className) return `.${el.className.split(' ')[0]}`;
  const path: string[] = [];
  while (el.parentElement) {
    const siblings = Array.from(el.parentElement.children).filter(c => c.tagName === el.tagName);
    const index = siblings.indexOf(el) + 1;
    path.unshift(`${el.tagName.toLowerCase()}:nth-child(${index})`);
    el = el.parentElement;
    if (path.length > 3) break;
  }
  return path.join(' > ');
}
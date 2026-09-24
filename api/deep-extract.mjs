import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

async function handler(req, res) {
  console.log('=== HANDLER START ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);

  if (req.method !== 'POST') {
    console.log('Method not allowed');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;
  console.log('Request body:', req.body);
  if (!url || !url.startsWith('http')) {
    console.log('Invalid URL');
    return res.status(400).json({ error: 'Invalid URL' });
  }

  console.log('Target URL:', url);

  let browser;
  try {
    console.log('=== LAUNCHING BROWSER ===');
    console.log('Chromium executable path:', await chromium.executablePath());
    console.log('Chromium args:', chromium.args);

    const launchOptions = {
      args: [...chromium.args, '--disable-web-security', '--disable-features=IsolateOrigins', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote'],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    };
    console.log('Launch options prepared');

    browser = await puppeteer.launch(launchOptions);
    console.log('=== BROWSER LAUNCHED SUCCESSFULLY ===');

    const page = await browser.newPage();
    console.log('New page created');
    page.setDefaultNavigationTimeout(15000);
    page.setDefaultTimeout(15000);

    const bots = [];
    const seenXml = new Set();
    const xmlRequests = [];

    // Capture ALL network responses
    page.on('response', response => {
      const responseUrl = response.url();
      if (responseUrl.includes('.xml') && !xmlRequests.includes(responseUrl)) {
        xmlRequests.push(responseUrl);
        console.log('Found XML request:', responseUrl);
      }
    });

    console.log('Navigating to:', url);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    console.log('Page loaded successfully');

    // Wait for dynamic content
    await new Promise(r => setTimeout(r, 2000));
    console.log('Waited for dynamic content');

    // Find bot links in DOM
    const botLinks = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll('a[href*=".xml"], a[href*="/xml/"]').forEach(a => {
        const href = a.getAttribute('href');
        if (href) {
          try { links.push(new URL(href, window.location.href).href); } catch {}
        }
      });
      return links;
    });
    console.log('Bot links found:', botLinks.length, botLinks);

    // Add DOM links to xmlRequests
    for (const link of botLinks) if (!xmlRequests.includes(link)) xmlRequests.push(link);

    // Click potential bot triggers
    const botTriggers = await page.evaluate(() => {
      const triggers = [];
      document.querySelectorAll('button, a, [role="button"], .bot-card, [class*="bot"], [class*="strategy"]').forEach(el => {
        const text = el.textContent?.trim() || '';
        if (text.length > 2 && text.length < 100) {
          const selector = el.id ? `#${el.id}` : (el.className ? `.${el.className.split(' ')[0]}` : '');
          if (selector) triggers.push({ selector, text });
        }
      });
      return triggers.slice(0, 10);
    });
    console.log('Triggers to click:', botTriggers.length, botTriggers);

    for (const trigger of botTriggers) {
      try {
        await page.click(trigger.selector, { delay: 100 });
        await new Promise(r => setTimeout(r, 500));
      } catch (e) { console.log('Click failed:', trigger.selector, e); }
    }

    // Fetch each discovered .xml
    console.log('Fetching', xmlRequests.length, 'XML files...');
    for (const xmlUrl of xmlRequests) {
      try {
        const response = await page.goto(xmlUrl, { waitUntil: 'networkidle2', timeout: 8000 });
        if (response.ok()) {
          const content = await response.text();
          if (content && content.includes('<block') && content.length > 200 && !seenXml.has(content)) {
            seenXml.add(content);
            const name = xmlUrl.split('/').pop()?.replace('.xml', '').replace(/[_-]/g, ' ') || 'Unknown Bot';
            bots.push({ name, xml: content.trim(), source: xmlUrl, size: content.length });
            console.log('Extracted:', name, 'size:', content.length);
          }
        }
      } catch (e) { console.log('Failed to fetch', xmlUrl, e); }
    }

    // Extract embedded XML from page
    const pageContent = await page.content();
    const embeddedBots = extractEmbeddedXml(pageContent, url);
    for (const bot of embeddedBots) {
      if (!seenXml.has(bot.xml)) {
        seenXml.add(bot.xml);
        bots.push(bot);
      }
    }
    console.log('Embedded bots:', embeddedBots.length);

    // Try common paths as fallback
    const baseUrl = new URL(url).origin;
    const commonPaths = ['/xml/', '/bots/'];
    const commonNames = ['Poverty_Killer', 'BEST_RISE_FALL', 'MAKOTI_AUTOMATED_RISE_FALL', 'UNDER_6', 'UNDER6', 'UNDER_6_BOT', 'OVER_1', 'Market_Killer', 'O_U_KILLER', 'HIGH_LOW', 'EVEN_ODD_KILLER', 'DIFFERS_AUTO', 'AI_Analyst', 'Multi_Killer', 'Digit_Hunter', 'Entry_Digit', 'STARTER_BOT'];

    for (const path of commonPaths) {
      for (const name of commonNames) {
        const tryUrl = `${baseUrl}${path}${name}.xml`;
        if (xmlRequests.includes(tryUrl)) continue;
        try {
          const response = await page.goto(tryUrl, { waitUntil: 'networkidle2', timeout: 5000 });
          if (response.ok()) {
            const content = await response.text();
            if (content && content.includes('<block') && content.length > 200 && !seenXml.has(content)) {
              seenXml.add(content);
              bots.push({ name: name.replace(/_/g, ' '), xml: content.trim(), source: tryUrl, size: content.length });
              console.log('Extracted from common:', name);
            }
          }
        } catch {}
      }
    }

    await browser.close();
    console.log('=== DEEP EXTRACT COMPLETE: ' + bots.length + ' bots ===');
    return res.json({ bots, count: bots.length });

  } catch (error) {
    console.error('=== DEEP EXTRACT ERROR ===', error);
    if (browser) { try { await browser.close(); } catch {} }
    return res.status(500).json({ error: error.message || 'Extraction failed', stack: error.stack });
  }
}

function extractEmbeddedXml(html, sourceUrl) {
  const bots = [];
  let pos = 0;
  while (pos < html.length) {
    const xmlStart = html.indexOf('<xml', pos);
    if (xmlStart === -1) break;
    const xmlEnd = html.indexOf('</xml>', xmlStart);
    if (xmlEnd === -1) { pos = xmlStart + 4; continue; }

    let xml = html.substring(xmlStart, xmlEnd + 6);
    xml = xml.replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, "'").replace(/&/g, '&');

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

export default handler;
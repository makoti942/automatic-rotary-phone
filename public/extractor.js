(function() {
  if (window.BotExtractorLoaded) return;
  window.BotExtractorLoaded = true;

  const style = document.createElement('style');
  style.textContent = `
    #be-panel {position:fixed; top:20px; right:20px; width:400px; max-height:80vh; background:#0d1117; border:1px solid #30363d; border-radius:8px; padding:16px; z-index:999999; font-family:system-ui; color:#e6edf3; overflow:auto;}
    #be-panel h3 {margin:0 0 12px; color:#58a6ff; font-size:16px;}
    #be-panel .btn {background:#238636; color:#fff; border:none; padding:8px 12px; border-radius:4px; cursor:pointer; margin-right:4px; font-size:13px; width:100%;}
    #be-panel .btn:hover {background:#2ea043;}
    #be-panel .btn:disabled {background:#30363d; color:#8b949e;}
    #be-panel .btn.sec {background:#30363d;}
    #be-panel .log {background:#161b22; border:1px solid #30363d; border-radius:4px; padding:8px; margin-top:12px; max-height:300px; overflow:auto; font-family:monospace; font-size:11px;}
    #be-panel .log div {padding:2px 0; border-bottom:1px solid #21262d;}
    #be-panel .bot {background:#161b22; border:1px solid #30363d; border-radius:4px; padding:8px; margin-top:8px; font-size:12px;}
    #be-panel .bot-name {font-weight:600; color:#58a6ff;}
    #be-panel textarea {width:100%; background:#161b22; border:1px solid #30363d; color:#e6edf3; padding:6px; border-radius:4px; font-family:monospace; font-size:10px; min-height:150px;}
    #be-panel .close {float:right; background:none; border:none; color:#8b949e; cursor:pointer; font-size:18px; line-height:1;}
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'be-panel';
  panel.innerHTML = `
    <button class="close" onclick="this.closest('#be-panel').remove()">&times;</button>
    <h3>Bot Extractor</h3>
    <button class="btn" onclick="window.BE.scan()">Scan DOM</button>
    <button class="btn sec" onclick="window.BE.extract()">Extract All</button>
    <div class="log" id="be-log"></div>
    <div id="be-bots"></div>
  `;
  document.body.appendChild(panel);

  const logEl = document.getElementById('be-log');
  const botsEl = document.getElementById('be-bots');
  const seen = new Set();
  const targets = [];

  function log(msg) { logEl.innerHTML += '<div>' + msg + '</div>'; logEl.scrollTop = logEl.scrollHeight; }

  function isValid(xml) {
    if (!xml || xml.length < 1000) return false;
    const t = xml.trim();
    if (!t.startsWith('<xml') && !t.startsWith('<?xml')) return false;
    if (!t.includes('<block')) return false;
    const blocks = (t.match(/<block /g) || []).length;
    if (blocks < 5) return false;
    if (!t.includes('type="bot_run"') && !t.includes('type="deriv_bot"')) return false;
    if (!t.includes('type="trade_definition"') && !t.includes('type="purchase"') && !t.includes('type="submarket"')) return false;
    if (t.includes('Blockly.Blocks') || t.includes('Blockly.JavaScript')) return false;
    return true;
  }

  function getName(xml) {
    const m = xml.match(/<field name="BOT_NAME">([^<]+)<\/field>/i);
    if (m) return m[1].trim();
    const m2 = xml.match(/<mutation[^>]*bot_name=["']([^"']+)["']/i);
    if (m2) return m2[1].trim();
    const m3 = xml.match(/<title[^>]*>([^<]{2,50})<\/title>/i);
    if (m3 && !m3[1].match(/^\d+$/)) return m3[1].trim();
    return 'Unnamed Bot';
  }

  window.BE = {
    scan() {
      log('--- Scanning DOM ---');
      targets.length = 0;
      document.querySelectorAll('button[data-bot], button[data-xml], button[data-id], button[data-url], button[onclick*="load" i]').forEach(btn => {
        const url = btn.dataset.bot || btn.dataset.xml || btn.dataset.id || btn.dataset.url || (btn.onclick?.toString().match(/["']([^"']*load[^"']*)["']/i) || [])[1];
        if (url) try { targets.push({name: btn.textContent?.trim() || 'Button', url: new URL(url, location.origin).href, src: 'btn'}); } catch {}
      });
      document.querySelectorAll('select[name*="bot" i], select[id*="bot" i]').forEach(sel => [...sel.options].forEach(opt => {
        if (opt.value) try { targets.push({name: opt.textContent?.trim() || 'Select', url: new URL(opt.value, location.origin).href, src: 'sel'}); } catch {}
      }));
      document.querySelectorAll('a[href$=".xml"], a[href*="/bot/"], a[href*="/api/bot"], a[href*="load" i]').forEach(a => {
        try { targets.push({name: a.textContent?.trim() || 'Link', url: new URL(a.href, location.origin).href, src: 'link'}); } catch {}
      });
      document.querySelectorAll('[onclick]').forEach(el => {
        (el.onclick?.toString().match(/["']([^"']+\.xml)["']/g) || []).forEach(u => {
          try { targets.push({name: el.textContent?.trim() || 'Click', url: new URL(u.replace(/["']/g,''), location.origin).href, src: 'click'}); } catch {}
        });
      });
      log('Found ' + targets.length + ' targets');
      targets.forEach((t,i) => log((i+1) + '. ' + t.name + ' (' + t.src + '): ' + t.url));
    },
    async extract() {
      if (!targets.length) { log('Scan first'); return; }
      log('--- Extracting ---');
      for (const t of targets) {
        log('Fetching ' + t.name + '...');
        try {
          const res = await fetch(t.url, {credentials: 'include'});
          if (res.ok) {
            const xml = await res.text();
            if (isValid(xml)) {
              const name = getName(xml);
              if (!seen.has(xml)) {
                seen.add(xml);
                log('  ✅ ' + name + ' (' + (xml.length/1024).toFixed(1) + ' KB)');
                const div = document.createElement('div');
                div.className = 'bot';
                div.innerHTML = '<div class="bot-name">' + name + '</div><textarea readonly>' + xml.replace(/</g,'<').replace(/>/g,'>') + '</textarea>';
                botsEl.appendChild(div);
              }
            } else log('  ❌ Invalid (' + xml.length + ' chars)');
          }
        } catch (e) { log('  ❌ ' + e.message); }
      }
      log('=== DONE: ' + seen.size + ' bots ===');
    }
  };
})();

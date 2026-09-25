(function() {
  if (window.BotExtractorLoaded) return;
  window.BotExtractorLoaded = true;

  const style = document.createElement("style");
  style.textContent = `
    #be-panel {position:fixed; top:20px; right:20px; width:420px; max-height:85vh; background:#0d1117; border:1px solid #30363d; border-radius:8px; padding:16px; z-index:999999; font-family:system-ui; color:#e6edf3; overflow:auto;}
    #be-panel h3 {margin:0 0 12px; color:#58a6ff; font-size:16px;}
    #be-panel .btn {background:#238636; color:#fff; border:none; padding:8px 12px; border-radius:4px; cursor:pointer; margin:4px 4px 4px 0; font-size:13px;}
    #be-panel .btn:hover {background:#2ea043;}
    #be-panel .btn:disabled {background:#30363d; color:#8b949e;}
    #be-panel .btn.sec {background:#30363d;}
    #be-panel .log {background:#161b22; border:1px solid #30363d; border-radius:4px; padding:8px; margin-top:12px; max-height:250px; overflow:auto; font-family:monospace; font-size:11px;}
    #be-panel .log div {padding:2px 0; border-bottom:1px solid #21262d;}
    #be-panel .bot {background:#161b22; border:1px solid #30363d; border-radius:4px; padding:8px; margin-top:8px; font-size:12px;}
    #be-panel .bot-name {font-weight:600; color:#58a6ff; margin-bottom:4px;}
    #be-panel textarea {width:100%; background:#161b22; border:1px solid #30363d; color:#e6edf3; padding:6px; border-radius:4px; font-family:monospace; font-size:10px; min-height:150px;}
    #be-panel .close {float:right; background:none; border:none; color:#8b949e; cursor:pointer; font-size:18px; line-height:1;}
    #be-panel .status {color:#8b949e; font-size:12px; margin-bottom:8px;}
  `;
  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.id = "be-panel";
  panel.innerHTML = `
    <button class="close" onclick="this.closest(\"#be-panel\").remove()">&times;</button>
    <h3>Bot Extractor</h3>
    <div class="status">Page: <span id="be-url"></span></div>
    <button class="btn" onclick="window.BE.scan()">1. Scan DOM (All Patterns)</button>
    <button class="btn sec" onclick="window.BE.deepScan()">2. Deep Scan (All Scripts)</button>
    <button class="btn sec" onclick="window.BE.extract()">3. Extract All Found</button>
    <div class="log" id="be-log"></div>
    <div id="be-bots"></div>
  `;
  document.body.appendChild(panel);

  document.getElementById("be-url").textContent = location.href;

  const logEl = document.getElementById("be-log");
  const botsEl = document.getElementById("be-bots");
  const seen = new Set();
  const targets = [];

  function log(msg) { logEl.innerHTML += "<div>" + msg + "</div>"; logEl.scrollTop = logEl.scrollHeight; }

  function isValid(xml) {
    if (!xml || xml.length < 1000) return false;
    const t = xml.trim();
    if (!t.startsWith("<xml") && !t.startsWith("<?xml")) return false;
    if (!t.includes("<block")) return false;
    const blocks = (t.match(/<block /g) || []).length;
    if (blocks < 5) return false;
    if (!t.includes('type="bot_run"') && !t.includes('type="deriv_bot"')) return false;
    if (!t.includes('type="trade_definition"') && !t.includes('type="purchase"') && !t.includes('type="submarket"')) return false;
    if (t.includes("Blockly.Blocks") || t.includes("Blockly.JavaScript")) return false;
    return true;
  }

  function getName(xml) {
    const m = xml.match(/<field name="BOT_NAME">([^<]+)<\/field>/i);
    if (m) return m[1].trim();
    const m2 = xml.match(/<mutation[^>]*bot_name=["\']([^"\']+)["\']/i);
    if (m2) return m2[1].trim();
    const m3 = xml.match(/<title[^>]*>([^<]{2,50})<\/title>/i);
    if (m3 && !m3[1].match(/^\d+$/)) return m3[1].trim();
    return "Unnamed Bot";
  }

  function addTarget(name, url, src) {
    try {
      const full = new URL(url, location.origin).href;
      if (full.startsWith(location.origin) && !targets.some(t => t.url === full)) {
        targets.push({name, url: full, src});
        return true;
      }
    } catch {}
    return false;
  }

  window.BE = {
    scan() {
      log("--- Scan 1: DOM Elements ---");
      targets.length = 0;
      let count = 0;

      // 1. Buttons with data-* attributes
      document.querySelectorAll("button[data-bot], button[data-xml], button[data-id], button[data-url], button[data-file], button[data-path], button[data-strategy]").forEach(btn => {
        const attrs = ["data-bot","data-xml","data-id","data-url","data-file","data-path","data-strategy"];
        attrs.forEach(a => { if (btn.dataset[a.replace("data-","")]) count += addTarget(btn.textContent?.trim() || "Button", btn.dataset[a.replace("data-","")], "btn:" + a); });
      });

      // 2. Buttons with onclick containing load/fetch/bot/xml
      document.querySelectorAll("button[onclick], a[onclick], div[onclick], span[onclick]").forEach(el => {
        const onclick = el.onclick?.toString() || el.getAttribute("onclick") || "";
        if (/load|fetch|bot|xml|import/i.test(onclick)) {
          const urls = onclick.match(/["\']([^"\']+\.(xml|json))["\']/g) || onclick.match(/["\']([^"\']*(?:bot|load|strategy)[^"\']*)["\']/g) || [];
          urls.forEach(u => count += addTarget(el.textContent?.trim() || "Click", u.replace(/["\']/g,""), "onclick"));
        }
      });

      // 3. Any element with data-bot-xml, data-bot-url, etc.
      document.querySelectorAll("[data-bot-xml], [data-bot-url], [data-xml-url], [data-strategy-url]").forEach(el => {
        const val = el.dataset.botXml || el.dataset.botUrl || el.dataset.xmlUrl || el.dataset.strategyUrl;
        if (val) count += addTarget(el.textContent?.trim() || "DataAttr", val, "data-attr");
      });

      // 4. Select dropdowns
      document.querySelectorAll("select").forEach(sel => {
        if (/bot|strategy|xml/i.test(sel.name + sel.id + sel.className)) {
          [...sel.options].forEach(opt => { if (opt.value) count += addTarget(opt.textContent?.trim() || "Option", opt.value, "select"); });
        }
      });

      // 5. Links to .xml, /bot/, /api/, /load/
      document.querySelectorAll("a[href]").forEach(a => {
        const href = a.href;
        if (/\.xml(\?|$)/i.test(href) || /\/bot\//i.test(href) || /\/api\/(bot|strategy)/i.test(href) || /\/load\//i.test(href)) {
          count += addTarget(a.textContent?.trim() || "Link", href, "link");
        }
      });

      // 6. Any element with onclick that looks like it loads something
      document.querySelectorAll("[onclick]").forEach(el => {
        const oc = el.onclick?.toString() || el.getAttribute("onclick") || "";
        const matches = oc.match(/["\']([^"\']+\.xml)["\']/g) || oc.match(/fetch\(["\']([^"\']+)["\']/g) || oc.match(/\.load\(["\']([^"\']+)["\']/g);
        if (matches) matches.forEach(m => count += addTarget(el.textContent?.trim() || "OnClick", m.replace(/["\']|fetch\(|\.load\(/g,""), "onclick"));
      });

      log("Found " + targets.length + " unique targets");
      targets.forEach((t,i) => log("  " + (i+1) + ". " + t.name + " (" + t.src + "): " + t.url));
    },

    deepScan() {
      log("--- Scan 2: Deep Search (All Scripts) ---");
      // Search all inline scripts for XML patterns
      document.querySelectorAll("script:not([src])").forEach((scr, i) => {
        const content = scr.textContent;
        if (content && content.includes("<xml") && content.includes("bot_run")) {
          log("  Inline script #" + i + " has bot XML pattern");
          targets.push({name: "Inline Script #" + i, url: "inline:" + i, src: "inline", xml: content});
        }
      });
      // Search for any .xml strings in all scripts
      document.querySelectorAll("script").forEach((scr, i) => {
        const content = scr.textContent || "";
        const xmlUrls = content.match(/["\']([^"\']+\.xml)["\']/g) || [];
        xmlUrls.forEach(u => { const clean = u.replace(/["\']/g,""); addTarget("Script XML", clean, "script"); });
      });
      log("Deep scan added " + targets.length + " total targets");
    },

    async extract() {
      if (!targets.length) { log("Run Scan first"); return; }
      log("--- Extracting " + targets.length + " targets ---");
      let extracted = 0;
      for (const t of targets) {
        log("Fetching: " + t.name + "...");
        try {
          let xml = t.xml;
          if (!xml) {
            const res = await fetch(t.url, {credentials: "include"});
            if (!res.ok) throw new Error(res.status);
            xml = await res.text();
          }
          if (isValid(xml)) {
            const name = getName(xml);
            if (!seen.has(xml)) {
              seen.add(xml); extracted++;
              log("  ✅ " + name + " (" + (xml.length/1024).toFixed(1) + " KB)");
              const div = document.createElement("div");
              div.className = "bot";
              div.innerHTML = "<div class=\"bot-name\">" + name + "</div><textarea readonly>" + xml.replace(/</g,"<").replace(/>/g,">") + "</textarea>";
              botsEl.appendChild(div);
            }
          } else {
            log("  ❌ Invalid (" + xml.length + " chars, " + (xml.match(/<block /g)||[]).length + " blocks)");
          }
        } catch (e) { log("  ❌ " + e.message); }
      }
      log("=== DONE: " + extracted + " bots extracted ===");
    }
  };
})();

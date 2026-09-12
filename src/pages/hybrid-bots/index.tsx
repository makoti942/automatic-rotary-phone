import React, { useState, useRef, useEffect, useCallback } from 'react';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    xml?: string;
}

// Default bot XML - starting template that AI can modify
const DEFAULT_BOT_XML = `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <block type="trade_definition" id=";DRiUDJb/?L%m+Sz=o%H" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="U8g+X\`yjDHRtTyG*zD1n" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">1HZ100V</field>
        <next>
          <block type="trade_definition_tradetype" id="PC?:047~gRT0kEDNgJbV" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">callput</field>
            <field name="TRADETYPE_LIST">callput</field>
            <next>
              <block type="trade_definition_contracttype" id="KFpRWiJF5pPjjgK]e7|B" deletable="false" movable="false">
                <field name="TYPE_LIST">both</field>
                <next>
                  <block type="trade_definition_candleinterval" id="85Q=fXN\`FdG^f+z(Zvw!" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="\`vLz[G,Q|nJ[I(pPhUG:" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id=";Dw9LIH45qq?(8by-KN~" deletable="false" movable="false">
                            <field name="RESTARTONERROR">TRUE</field>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="QKnh0!cFFfCO=2Q,|coD">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="false" vh_enabled="false"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <field name="VIRTUAL_HOOK_ENABLED">FALSE</field>
        <field name="BULK_TRADE_ENABLED">FALSE</field>
        <value name="DURATION">
          <shadow type="math_number_positive" id="F/NI.jeXj)72BIi=|wA}">
            <field name="NUM">1</field>
          </shadow>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number_positive" id="u,AyDGk-hH;M~a,M([0q">
            <field name="NUM">1</field>
          </shadow>
        </value>
      </block>
    </statement>
  </block>
  <block type="during_purchase" id="GI=iH=l7IML?3WpK8!X|" x="714" y="60">
    <statement name="DURING_PURCHASE_STACK">
      <block type="controls_if" id="y!egOXOF/+4Z:w4bu.z|">
        <value name="IF0">
          <block type="check_sell" id="zjr1MYZl9:}Qc;7yJEgX"></block>
        </value>
      </block>
    </statement>
  </block>
  <block type="after_purchase" id=",o32@Vprh/Y9UQ;#2Bw*" x="714" y="292">
    <statement name="AFTERPURCHASE_STACK">
      <block type="trade_again" id="^S=V.{fW;z+IFiFPZf*O"></block>
    </statement>
  </block>
  <block type="before_purchase" id="FAz)bi}Od@GOa(J@Q}hM" deletable="false" x="0" y="658">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="purchase" id="Q^f0TDoFUuDtbB)O)wI1">
        <field name="PURCHASE_LIST">CALL</field>
      </block>
    </statement>
  </block>
</xml>`;

const SYSTEM_PROMPT = `You are an expert Deriv Bot XML builder. You create and modify Blockly/Deriv Bot XML files based on user strategy descriptions.

## CRITICAL RULES - XML MUST BE COMPLETE:
1. **NO EMPTY FIELDS** - Every field, value, statement must have content
2. **NO PLACEHOLDER TEXT** - Never leave "TODO", "FIXME", or empty strings
3. **ALL VARIABLES DEFINED** - Every variables_get must have a matching variables_set
4. **ALL NOTIFICATIONS FILLED** - text_join blocks must have complete strings
5. **ALL MATH BLOCKS FILLED** - math_number blocks must have NUM field
6. **ALL LOGIC COMPLETE** - Every if/else must have proper conditions
7. **VALID BLOCK TYPES ONLY** - Use ONLY the block types listed below

## Your Behavior:
1. **Ask clarifying questions** if the strategy description is vague
2. **Confirm understanding** before generating XML
3. **Generate COMPLETE XML** - no empty spaces, all fields filled
4. **Test mentally** - trace through the logic to verify it works

## COMPLETE LIST OF ALL 133 VALID BLOCK TYPES (use ONLY these):

### Trade Definition (14):
trade_definition, trade_definition_market, trade_definition_tradetype, trade_definition_contracttype, trade_definition_candleinterval, trade_definition_tradeoptions, trade_definition_restartbuysell, trade_definition_restartonerror, trade_definition_multiplier, trade_definition_accumulator, multiplier_take_profit, multiplier_stop_loss, accumulator_take_profit

### Before Purchase (4):
before_purchase, purchase, ask_price, payout

### During Purchase (4):
during_purchase, check_sell, sell_price, sell_at_market

### After Purchase (4):
after_purchase, trade_again, read_details, contract_check_result

### Tick Analysis (14):
tick_analysis, ticks, ticks_string, tick, tick_string, ohlc, stat_list, stat, last_digit, read_ohlc, lastDigitList, ohlc_values, check_direction, get_ohlc

### Indicators (9):
sma_statement, smaa_statement, ema_statement, rsi_statement, rsia_statement, emaa_statement, bb_statement, bba_statement, macda_statement

### Indicator Parts (7):
fast_ema_period, signal_ema_period, std_dev_multiplier_up, period, std_dev_multiplier_down, input_list, slow_ema_period

### Logic (7):
controls_if, logic_boolean, logic_compare, logic_negate, logic_null, logic_operation, logic_ternary

### Math (14):
math_arithmetic, math_change, math_constant, math_constrain, math_modulo, math_number, math_number_positive, math_number_property, math_on_list, math_random_float, math_random_int, math_round, math_single, math_trig

### Text (13):
text, text_append, text_changeCase, text_charAt, text_getSubstring, text_indexOf, text_isEmpty, text_join, text_length, text_print, text_prompt_ext, text_statement, text_trim

### Lists (11):
lists_create_with, lists_getIndex, lists_getSublist, lists_indexOf, lists_isEmpty, lists_length, lists_repeat, lists_setIndex, lists_sort, lists_split, lists_statement

### Variables (2):
variables_get, variables_set

### Loops (6):
controls_flow_statements, controls_for, controls_forEach, controls_repeat, controls_repeat_ext, controls_whileUntil

### Functions (5):
procedures_callnoreturn, procedures_callreturn, procedures_defnoreturn, procedures_defreturn, procedures_ifreturn

### Tools > Time (5):
totimestamp, todatetime, timeout, tick_delay, epoch

### Tools > Misc (11):
console, useless_block, block_holder, total_runs, barrier_offset, total_profit, total_profit_string, notify_telegram, notify, loader, balance

### Tools > Candle (3):
read_ohlc_obj, ohlc_values_in_list, is_candle_black

## FIELD VALUES:

### MARKET_LIST: synthetic_index, forex, commodities, indices, stocks
### SUBMARKET_LIST: random_index, major_pairs, minor_pairs, exotic_pairs, etc.
### SYMBOL_LIST: R_10, R_25, R_50, R_75, R_100, 1HZ10V, 1HZ25V, 1HZ50V, 1HZ75V, 1HZ100V
### TRADETYPECAT_LIST: callput, digits, touchnotouch, rises_falls, endsinouts, staysinouts, multiders
### TRADETYPE_LIST: callput, callputeuropean, digit, touchnotouch, etc.
### TYPE_LIST: both, call, put, DIGITMATCH, DIGITDIFF, DIGITOVER, DIGITUNDER, DIGITEVEN, DIGITODD, CALL, PUT, RUNHIGH, RUNLOW
### DURATIONTYPE_LIST: t (tick), m (minute), h (hour), d (day)
### CANDLEINTERVAL_LIST: 60, 300, 900, 1800, 3600
### PURCHASE_LIST: CALL, PUT, DIGITMATCH, DIGITDIFF, DIGITOVER, DIGITUNDER, RUNHIGH, RUNLOW
### DETAIL_INDEX: trade_type, contract_type, entry_spot, exit_spot, barrier, payout, profit
### COMPARE_OP: EQ, NEQ, LT, LTE, GT, GTE
### MATH_OP: ADD, MINUS, MULTIPLY, DIVIDE, POWER, MOD
### LOGIC_OP: AND, OR
### BOOLEAN: TRUE, FALSE
### STAT_TYPE: average, count, sum, minimum, maximum
### DIRECTION: both, forwards, backwards
### OHLC_FIELD: open, high, low, close

## COMPLETE WORKING EXAMPLE - Digit Bot with Recovery:

\`\`\`xml
<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <block type="trade_definition" id="a1" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="a2" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">R_50</field>
        <next>
          <block type="trade_definition_tradetype" id="a3" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">digits</field>
            <field name="TRADETYPE_LIST">digit</field>
            <next>
              <block type="trade_definition_contracttype" id="a4" deletable="false" movable="false">
                <field name="TYPE_LIST">DIGITUNDER</field>
                <next>
                  <block type="trade_definition_candleinterval" id="a5" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="a6" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="a7" deletable="false" movable="false">
                            <field name="RESTARTONERROR">TRUE</field>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="a8">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="true" vh_enabled="false"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <field name="VIRTUAL_HOOK_ENABLED">FALSE</field>
        <field name="BULK_TRADE_ENABLED">FALSE</field>
        <field name="PREDICTION">7</field>
        <value name="DURATION">
          <shadow type="math_number_positive" id="a9">
            <field name="NUM">1</field>
          </shadow>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number_positive" id="a10">
            <field name="NUM">0.35</field>
          </shadow>
        </value>
      </block>
    </statement>
  </block>
  <block type="tick_analysis" id="b1" x="350" y="60">
    <statement name="TICKANALYSIS_STACK">
      <block type="variables_set" id="b2">
        <field name="VAR">last_digit</field>
        <value name="VALUE">
          <block type="last_digit" id="b3"></block>
        </value>
      </block>
    </statement>
  </block>
  <block type="before_purchase" id="c1" deletable="false" x="0" y="658">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="purchase" id="c2">
        <field name="PURCHASE_LIST">DIGITUNDER</field>
      </block>
    </statement>
  </block>
  <block type="during_purchase" id="d1" x="714" y="60">
    <statement name="DURING_PURCHASE_STACK">
      <block type="controls_if" id="d2">
        <value name="IF0">
          <block type="check_sell" id="d3"></block>
        </value>
        <statement name="DO0">
          <block type="sell" id="d4"></block>
        </statement>
      </block>
    </statement>
  </block>
  <block type="after_purchase" id="e1" x="714" y="292">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if" id="e2">
        <value name="IF0">
          <block type="logic_compare" id="e3">
            <field name="OP">EQ</field>
            <value name="A">
              <block type="read_details" id="e4">
                <field name="DETAIL_INDEX">profit</field>
              </block>
            </value>
            <value name="B">
              <block type="math_number" id="e5">
                <field name="NUM">0</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="trade_option" id="e6">
            <field name="TRADE_OPTION">BARRIER</field>
            <value name="TRADE_OPTION_VALUE">
              <block type="math_number" id="e7">
                <field name="NUM">6</field>
              </block>
            </value>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="trade_option" id="e8">
            <field name="TRADE_OPTION">BARRIER</field>
            <value name="TRADE_OPTION_VALUE">
              <block type="math_number" id="e9">
                <field name="NUM">7</field>
              </block>
            </value>
          </block>
        </statement>
      </block>
      <block type="trade_again" id="e10"></block>
    </statement>
  </block>
</xml>
\`\`\`

## HOW EACH BLOCK WORKS:

### trade_definition_tradeoptions:
- DURATIONTYPE_LIST: "t" for ticks, "m" for minutes
- DURATION: number of ticks/minutes
- AMOUNT: stake amount (decimal allowed)
- PREDICTION: digit for DIGITMATCH/DIGITDIFF/DIGITOVER/DIGITUNDER
- BARRIER: barrier offset for barrier trades

### read_details:
- DETAIL_INDEX: "profit" to check if win/loss
- Returns: number (positive = win, negative = loss, 0 = even)

### trade_option:
- TRADE_OPTION: "BARRIER", "PREDICTION", "AMOUNT"
- TRADE_OPTION_VALUE: the new value

### check_result:
- Returns: "win", "loss", or "draw"

### variables_set:
- VAR: variable name (string)
- VALUE: the value to assign

### logic_compare:
- OP: EQ, NEQ, LT, LTE, GT, GTE
- A, B: values to compare

### math_arithmetic:
- OP: ADD, MINUS, MULTIPLY, DIVIDE, POWER, MOD
- A, B: operands

## COMPLETENESS CHECKLIST (verify before outputting):
□ All block IDs are unique
□ All <field> elements have values
□ All <value> elements have child blocks
□ All <statement> elements have child blocks
□ All variables_set have matching variables_get
□ All math_number blocks have NUM field
□ All text blocks have TEXT field
□ All logic_compare blocks have OP, A, B
□ All controls_if blocks have IF0 condition
□ No empty strings or placeholders

## Output Format:
- When asking questions: respond naturally
- When generating XML: return ONLY valid XML in \`\`\`xml ... \`\`\`
- The XML must be COMPLETE and LOADABLE into Deriv Bot Builder`;

async function callGroq(messages: any[]): Promise<string> {
    try {
        const res = await fetch('/api/groq', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages,
                temperature: 0.3,
                max_tokens: 4096,
            }),
        });
        const data = await res.json();
        if (data?.choices?.[0]?.message?.content) {
            return data.choices[0].message.content;
        }
        throw new Error(data?.error?.message || 'No response from AI');
    } catch (e: any) {
        throw new Error(`AI error: ${e.message}`);
    }
}

function extractXml(text: string): string | null {
    // Try to find XML in the response
    const xmlMatch = text.match(/```xml\s*([\s\S]*?)```/) || text.match(/<xml[\s\S]*?<\/xml>/);
    if (xmlMatch) return xmlMatch[1] || xmlMatch[0];
    // If the whole response looks like XML
    if (text.trim().startsWith('<xml')) return text.trim();
    return null;
}

function ls(key: string, def: string) { try { return localStorage.getItem(key) || def; } catch { return def; } }
function lsSet(key: string, val: string) { try { localStorage.setItem(key, val); } catch {} }

export const BuildBot: React.FC = () => {
    const [messages, setMessages] = useState<ChatMessage[]>(() => {
        try {
            const saved = ls('buildbot_history', '[]');
            return JSON.parse(saved);
        } catch { return []; }
    });
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [generatedXml, setGeneratedXml] = useState<string>(() => ls('buildbot_xml', ''));
    const [error, setError] = useState('');
    const chatEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        lsSet('buildbot_history', JSON.stringify(messages));
    }, [messages]);

    useEffect(() => {
        lsSet('buildbot_xml', generatedXml);
    }, [generatedXml]);

    const sendMessage = useCallback(async () => {
        const text = input.trim();
        if (!text || loading) return;

        const userMsg: ChatMessage = { role: 'user', content: text };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);
        setError('');

        try {
            // Build conversation for AI
            const chatMessages = [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `Here is the current bot XML:\n\`\`\`xml\n${generatedXml || DEFAULT_BOT_XML}\n\`\`\`` },
                ...messages.map(m => ({ role: m.role, content: m.content })),
                { role: 'user', content: text },
            ];

            const response = await callGroq(chatMessages);
            const xml = extractXml(response);

            const assistantMsg: ChatMessage = {
                role: 'assistant',
                content: response,
                xml: xml || undefined,
            };
            setMessages(prev => [...prev, assistantMsg]);

            if (xml) {
                setGeneratedXml(xml);
            }
            // No error if no XML - AI might be asking questions
        } catch (e: any) {
            setError(e.message || 'Failed to get AI response');
            setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }]);
        } finally {
            setLoading(false);
        }
    }, [input, loading, messages, generatedXml]);

    const loadToWorkspace = useCallback(() => {
        if (!generatedXml) return;
        try {
            // Validate XML completeness
            const issues: string[] = [];

            // Check for invalid block types
            const invalidBlocks = ['contract_details', 'check_result', 'sell', 'trade_option', 'readOhlc', 'controls_if_else', 'lists_create_empty'];
            for (const b of invalidBlocks) {
                if (generatedXml.includes(`type="${b}"`)) {
                    let fix = '';
                    if (b === 'sell') fix = 'use sell_at_market or sell_price';
                    else if (b === 'trade_option') fix = 'use trade_again';
                    else if (b === 'check_result') fix = 'use contract_check_result';
                    else if (b === 'readOhlc') fix = 'use read_ohlc';
                    else if (b === 'controls_if_else') fix = 'use controls_if with ELSE statement';
                    else if (b === 'lists_create_empty') fix = 'use lists_create_with';
                    else if (b === 'contract_details') fix = 'use read_details';
                    issues.push(`Invalid block: ${b} → ${fix}`);
                }
            }

            // Check for empty fields
            const fieldMatches = generatedXml.match(/<field name="[^"]*"><\/field>/g);
            if (fieldMatches) {
                issues.push(`Empty fields found: ${fieldMatches.length}`);
            }

            // Check for placeholder text
            const placeholders = generatedXml.match(/(TODO|FIXME|XXX|PLACEHOLDER)/gi);
            if (placeholders) {
                issues.push('Contains placeholder text');
            }

            // Check for required trade_definition
            if (!generatedXml.includes('trade_definition"')) {
                issues.push('Missing trade_definition block');
            }

            // Check for required before_purchase
            if (!generatedXml.includes('before_purchase"')) {
                issues.push('Missing before_purchase block');
            }

            if (issues.length > 0) {
                alert(`XML has ${issues.length} issues:\n${issues.join('\n')}\n\nPlease ask AI to fix these.`);
                return;
            }

            const workspace = window.Blockly?.derivWorkspace;
            if (workspace) {
                const xmlDom = new DOMParser().parseFromString(generatedXml, 'text/xml').documentElement;
                workspace.clear();
                window.Blockly.Xml.clearWorkspaceAndLoadFromXml(xmlDom, workspace);
                alert('Bot loaded into workspace!');
            } else {
                alert('Bot Builder workspace not found. Please open the Bot Builder tab first.');
            }
        } catch (e: any) {
            alert(`Error loading bot: ${e.message}`);
        }
    }, [generatedXml]);

    const clearChat = useCallback(() => {
        setMessages([]);
        setGeneratedXml('');
        setError('');
        localStorage.removeItem('buildbot_history');
        localStorage.removeItem('buildbot_xml');
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 8, fontSize: 11, fontFamily: 'monospace' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ color: '#ffd700', fontWeight: 'bold', fontSize: 13 }}>🤖 Build Bot</span>
                <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={clearChat}
                        style={{ padding: '2px 6px', background: '#333', color: '#aaa', border: '1px solid #555', borderRadius: 3, cursor: 'pointer', fontSize: 9 }}>
                        Clear
                    </button>
                    {generatedXml && (
                        <button onClick={loadToWorkspace}
                            style={{ padding: '2px 8px', background: '#4caf50', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 10, fontWeight: 'bold' }}>
                            Load Bot
                        </button>
                    )}
                </div>
            </div>

            {/* Chat messages */}
            <div style={{
                flex: 1, overflowY: 'auto', background: '#0d0d1a', borderRadius: 4,
                padding: 6, marginBottom: 6, border: '1px solid #222', maxHeight: 300,
            }}>
                {messages.length === 0 && (
                    <div style={{ color: '#666', textAlign: 'center', padding: 20 }}>
                        <div style={{ fontSize: 14, marginBottom: 8 }}>🤖</div>
                        <div>Describe your strategy and I'll build a bot for you.</div>
                        <div style={{ marginTop: 8, fontSize: 9, color: '#555' }}>
                            Example: "Trade under 7 on R_50, if loss recover with under 5, martingale 2x"
                        </div>
                    </div>
                )}
                {messages.map((msg, i) => (
                    <div key={i} style={{
                        marginBottom: 8,
                        padding: 6,
                        borderRadius: 4,
                        background: msg.role === 'user' ? '#1a1a3e' : '#1a2e1a',
                        border: `1px solid ${msg.role === 'user' ? '#335' : '#353'}`,
                    }}>
                        <div style={{
                            fontSize: 9, fontWeight: 'bold', marginBottom: 4,
                            color: msg.role === 'user' ? '#6ea8fe' : '#4caf50',
                        }}>
                            {msg.role === 'user' ? 'You' : 'AI Builder'}
                        </div>
                        <div style={{ color: '#ddd', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                            {msg.xml ? (
                                <div>
                                    <div style={{ color: '#4caf50', marginBottom: 4 }}>✅ Bot XML generated</div>
                                    <div style={{ fontSize: 9, color: '#888', wordBreak: 'break-all' }}>
                                        {msg.xml.substring(0, 100)}...
                                    </div>
                                </div>
                            ) : msg.content}
                        </div>
                    </div>
                ))}
                {loading && (
                    <div style={{ color: '#666', textAlign: 'center', padding: 10 }}>
                        AI is building your bot...
                    </div>
                )}
                <div ref={chatEndRef} />
            </div>

            {/* Error */}
            {error && (
                <div style={{ color: '#f44336', fontSize: 10, marginBottom: 4, padding: 4, background: '#1a0a0a', borderRadius: 3 }}>
                    {error}
                </div>
            )}

            {/* Input */}
            <div style={{ display: 'flex', gap: 4 }}>
                <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Describe your strategy..."
                    disabled={loading}
                    style={{
                        flex: 1, resize: 'none', height: 50, padding: 6,
                        background: '#1a1a2e', border: '1px solid #333', color: '#fff',
                        borderRadius: 4, fontSize: 11, fontFamily: 'monospace',
                    }}
                />
                <button onClick={sendMessage} disabled={loading || !input.trim()}
                    style={{
                        padding: '0 12px', background: loading ? '#333' : '#2196f3',
                        color: '#fff', border: 'none', borderRadius: 4, cursor: loading ? 'not-allowed' : 'pointer',
                        fontSize: 11, fontWeight: 'bold',
                    }}>
                    Send
                </button>
            </div>

            {/* XML Preview */}
            {generatedXml && (
                <details style={{ marginTop: 6 }}>
                    <summary style={{ color: '#888', cursor: 'pointer', fontSize: 10 }}>
                        View Generated XML ({generatedXml.length} chars)
                    </summary>
                    <pre style={{
                        background: '#0d0d1a', padding: 6, borderRadius: 4,
                        fontSize: 9, color: '#aaa', overflowX: 'auto', maxHeight: 150,
                        border: '1px solid #222', marginTop: 4,
                    }}>
                        {generatedXml}
                    </pre>
                </details>
            )}
        </div>
    );
};

export default BuildBot;

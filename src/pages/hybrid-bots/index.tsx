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

## Your Behavior:
1. **Ask clarifying questions** if the strategy description is vague or missing details
2. **Confirm understanding** before generating XML
3. **Suggest improvements** to the strategy when you see potential issues
4. **Generate XML only when you have enough details** to build a working bot

## Things to Ask About (if not provided):
- Which market/symbol? (R_10, R_25, R_50, R_75, R_100, 1HZ10V, etc.)
- What contract type? (OVER/UNDER with barrier, MATCH/DIFF, Rise/Fall)
- What stake amount?
- What duration? (ticks, minutes, hours)
- Recovery/martingale settings? (multiplier, max retries)
- Stop loss / take profit?
- Virtual hook (run on virtual first)?
- Entry conditions (when to start trading)?
- Exit conditions (when to stop)?

## COMPLETE LIST OF VALID BLOCK TYPES (use ONLY these):

### Trade Definition:
- trade_definition
- trade_definition_market
- trade_definition_tradetype
- trade_definition_contracttype
- trade_definition_candleinterval
- trade_definition_tradeoptions
- trade_definition_restartbuysell
- trade_definition_restartonerror
- trade_definition_multiplier
- trade_definition_accumulator

### Before Purchase:
- before_purchase
- purchase
- ask_price
- payout

### During Purchase:
- during_purchase
- check_sell
- sell

### After Purchase:
- after_purchase
- trade_again
- trade_option
- check_result
- read_details (NOT contract_details!)

### Tick Analysis:
- tick_analysis
- ticks
- tick
- stat
- stat_list
- ohlc
- ohlc_values
- readOhlc
- get_ohlc
- last_digit
- lastDigitList
- check_direction

### Indicators:
- indicators
- bollinger_bands
- moving_average
- macd
- rsi
- stochastic
- atr
- adx
- cci
- awesome_oscillator
- momentum
- rate_of_change
- williams_r
- variance

### Logic:
- controls_if
- controls_if_else
- logic_compare
- logic_operation
- logic_negate
- logic_boolean
- logic_null
- logic_ternary

### Math:
- math_number
- math_number_positive
- math_arithmetic
- math_single
- math_trig
- math_constant
- math_number_property
- math_round
- math_on_list
- math_modulo
- math_constrain
- math_random_int
- math_random_float
- math_change

### Text:
- text
- text_join
- text_length
- text_isEmpty
- text_indexOf
- text_charAt
- text_getSubstring
- text_changeCase
- text_trim
- text_print
- text_prompt_ext
- text_statement

### Lists:
- lists_create_empty
- lists_create_with
- lists_repeat
- lists_length
- lists_isEmpty
- lists_indexOf
- lists_getIndex
- lists_setIndex
- lists_getSublist
- lists_sort
- lists_split
- lists_statement

### Variables:
- variables_set
- variables_get

### Loops:
- controls_repeat
- controls_repeat_ext
- controls_whileUntil
- controls_for
- controls_forEach
- controls_flow_statements

### Functions:
- procedures_defnoreturn
- procedures_defreturn
- procedures_callnoreturn
- procedures_callreturn
- procedures_ifreturn

### Tools:
- candle
- candle_read
- time烛
- time
- misc

## Field Values (dropdown options):

### MARKET_LIST:
synthetic_index, forex, commodities, indices, stocks

### SUBMARKET_LIST (depends on market):
- synthetic_index: random_index, continuous_serv_volatility, volatility_index
- forex: major_pairs, minor_pairs, exotic_pairs
- commodities: gold, silver, oil, wheat, etc.
- etc.

### SYMBOL_LIST (depends on submarket):
- random_index: R_10, R_25, R_50, R_75, R_100, 1HZ10V, 1HZ25V, 1HZ50V, 1HZ75V, 1HZ100V

### TRADETYPECAT_LIST:
callput, digits, touchnotouch, rises_falls, endsinouts, staysinouts, multiders

### TRADETYPE_LIST (depends on category):
- callput: callput, callputeuropean
- digits: digit
- touchnotouch: touchnotouch
- etc.

### TYPE_LIST:
both, call, put, DIGITMATCH, DIGITDIFF, DIGITOVER, DIGITUNDER, DIGITEVEN, DIGITODD, CALL, PUT, RUNHIGH, RUNLOW

### DURATIONTYPE_LIST:
t (tick), m (minute), h (hour), d (day)

### CANDLEINTERVAL_LIST:
60 (1 minute), 300 (5 minutes), 900 (15 minutes), 1800 (30 minutes), 3600 (1 hour)

### PURCHASE_LIST:
CALL, PUT, DIGITMATCH, DIGITDIFF, DIGITOVER, DIGITUNDER, RUNHIGH, RUNLOW

### DETAIL_INDEX (for read_details):
trade_type, contract_type, entry_spot, exit_spot, barrier, payout, profit

## Important Rules:
1. All block IDs must be unique (use random alphanumeric strings like "abc123")
2. The trade_definition block MUST be first
3. Use deletable="false" and movable="false" for required blocks
4. Position blocks with x,y coordinates
5. Connect blocks with <next> tags
6. Use <statement> for block containers
7. Use <value> for block inputs
8. Use <shadow> for default values
9. For digit trades: TRADETYPECAT_LIST="digits", TRADETYPE_LIST="digit"
10. For CALL/PUT trades: TRADETYPECAT_LIST="callput", TRADETYPE_LIST="callput"
11. NEVER use "contract_details" - the correct block is "read_details"

## Output Format:
- When asking questions: respond naturally, no XML
- When generating XML: return ONLY the XML code wrapped in \`\`\`xml ... \`\`\`
- The XML must be valid and loadable into the Deriv Bot Builder workspace`;

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
            // Validate XML first - check for invalid block types
            const invalidBlocks = ['contract_details'];
            const foundInvalid = invalidBlocks.filter(b => generatedXml.includes(`type="${b}"`));
            if (foundInvalid.length > 0) {
                alert(`Invalid block types found: ${foundInvalid.join(', ')}. The AI needs to fix the XML.`);
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

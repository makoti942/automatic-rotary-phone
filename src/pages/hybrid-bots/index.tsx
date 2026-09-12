import React, { useState, useRef, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';

interface ChatQuestionOption {
    label: string;
    value: string;
}

interface ChatQuestion {
    id: string;
    question: string;
    options: ChatQuestionOption[];
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    xml?: string;
    questions?: ChatQuestion[];
}

// Default bot XML - starting template that AI can modify.
// Note the <variables> declaration + INITIALIZATION statement + AMOUNT reading a variable.
const DEFAULT_BOT_XML = `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="stakeVar">stake</variable>
    <variable id="is_recovery_var">is_recovery</variable>
  </variables>
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
    <statement name="INITIALIZATION">
      <block type="variables_set" id="iniStake">
        <field name="VAR" id="stakeVar">stake</field>
        <value name="VALUE">
          <block type="math_number" id="iniStakeNum">
            <field name="NUM">0.35</field>
          </block>
        </value>
        <next>
          <block type="variables_set" id="iniIsRecovery">
            <field name="VAR" id="is_recovery_var">is_recovery</field>
            <value name="VALUE">
              <block type="logic_boolean" id="iniIsRecoveryBool">
                <field name="BOOL">FALSE</field>
              </block>
            </value>
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
          <block type="variables_get" id="getStakeAmount">
            <field name="VAR" id="stakeVar">stake</field>
          </block>
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

const SYSTEM_PROMPT = `You are an expert Deriv Bot XML builder. You create or modify Blockly/Deriv Bot XML from user strategy descriptions. Build the ENTIRE bot in ONE response. Return ONLY valid XML inside \`\`\`xml ... \`\`\` when building.

## HARD RULES
1. NO empty fields/values/statements. No placeholders/TODO/empty strings.
2. Use ONLY the block types and field values listed below.
3. EVERY variables_get/set uses <field name="VAR" id="...">Name</field> and MUST match a <variable id="...">Name</variable> declared in the top <variables> block.
4. All variables are initialized in the trade_definition INITIALIZATION statement (runs once at start).
5. The XML must be COMPLETE and LOADABLE into Deriv Bot Builder.

## ASKING QUESTIONS
If details are missing, ask clickable questions BEFORE building. End your reply with EXACTLY:
[QUESTIONS]
Q: Which symbol?
- R_50
- R_100
- 1HZ100V
Q: Stake per trade?
- 0.35
- 0.50
- 1.00
[/QUESTIONS]
Format: each question line starts "Q: " (one space), each option line starts "- " (dash + one space). ALWAYS give 2-4 options per question (the user CLICKS an option, never types). Include sensible default values. You may add a short intro line before the block. When you have all answers, STOP asking and build.

## VALID BLOCK TYPES (use ONLY these)
Trade Definition: trade_definition, trade_definition_market, trade_definition_tradetype, trade_definition_contracttype, trade_definition_candleinterval, trade_definition_tradeoptions, trade_definition_restartbuysell, trade_definition_restartonerror, trade_definition_multiplier, trade_definition_accumulator, multiplier_take_profit, multiplier_stop_loss, accumulator_take_profit
Before/During/After: before_purchase, purchase, ask_price, payout, during_purchase, check_sell, sell_price, sell_at_market, after_purchase, trade_again, read_details, contract_check_result
Tick Analysis: tick_analysis, ticks, ticks_string, tick, tick_string, ohlc, stat_list, stat, last_digit, read_ohlc, lastDigitList, ohlc_values, check_direction, get_ohlc
Indicators: sma_statement, smaa_statement, ema_statement, rsi_statement, rsia_statement, emaa_statement, bb_statement, bba_statement, macda_statement
Indicator Parts: fast_ema_period, signal_ema_period, std_dev_multiplier_up, period, std_dev_multiplier_down, input_list, slow_ema_period
Logic: controls_if, logic_boolean, logic_compare, logic_negate, logic_null, logic_operation, logic_ternary
Math: math_arithmetic, math_change, math_constant, math_constrain, math_modulo, math_number, math_number_positive, math_number_property, math_on_list, math_random_float, math_random_int, math_round, math_single, math_trig
Text: text, text_append, text_changeCase, text_charAt, text_getSubstring, text_indexOf, text_isEmpty, text_join, text_length, text_print, text_prompt_ext, text_statement, text_trim
Lists: lists_create_with, lists_getIndex, lists_getSublist, lists_indexOf, lists_isEmpty, lists_length, lists_repeat, lists_setIndex, lists_sort, lists_split, lists_statement
Variables: variables_get, variables_set
Loops: controls_flow_statements, controls_for, controls_forEach, controls_repeat, controls_repeat_ext, controls_whileUntil
Functions: procedures_callnoreturn, procedures_callreturn, procedures_defnoreturn, procedures_defreturn, procedures_ifreturn
Time: totimestamp, todatetime, timeout, tick_delay, epoch
Misc: console, useless_block, block_holder, total_runs, barrier_offset, total_profit, total_profit_string, notify_telegram, notify, loader, balance
Candle: read_ohlc_obj, ohlc_values_in_list, is_candle_black

## FIELD VALUES (EXACT names/values)
MARKET_LIST: synthetic_index, forex, commodities, indices, stocks
SUBMARKET_LIST: random_index, major_pairs, minor_pairs, exotic_pairs, etc.
SYMBOL_LIST: R_10, R_25, R_50, R_75, R_100, 1HZ10V, 1HZ25V, 1HZ50V, 1HZ75V, 1HZ100V
TRADETYPECAT_LIST: callput, digits, touchnotouch, rises_falls, endsinouts, staysinouts, multiders
TRADETYPE_LIST: callput, callputeuropean, overunder (digits Over/Under), matchesdiffers (digits Matches/Differs), touchnotouch, etc.
TYPE_LIST: both, call, put, DIGITMATCH, DIGITDIFF, DIGITOVER, DIGITUNDER, DIGITEVEN, DIGITODD, CALL, PUT, RUNHIGH, RUNLOW
PURCHASE_LIST: CALL, PUT, DIGITMATCH, DIGITDIFF, DIGITOVER, DIGITUNDER, RUNHIGH, RUNLOW
DURATIONTYPE_LIST: t (tick), m (minute), h (hour), d (day)
CANDLEINTERVAL_LIST: 60, 300, 900, 1800, 3600
DETAIL_INDEX (read_details - use the NUMBER): 1=deal ref, 2=purchase price, 3=payout, 4=profit, 5=contract type, 6=entry spot time, 7=entry spot price, 8=exit spot time, 9=exit spot price, 10=barrier, 11=result
CHECK_RESULT (contract_check_result): win, loss
COMPARE_OP: EQ, NEQ, LT, LTE, GT, GTE
MATH_OP: ADD, MINUS, MULTIPLY, DIVIDE, POWER, MOD
LOGIC_OP: AND, OR
BOOLEAN: TRUE, FALSE
STAT_TYPE: average, count, sum, minimum, maximum
DIRECTION: both, forwards, backwards
OHLC_FIELD: open, high, low, close
For DIGIT OVER/UNDER bots: TRADETYPECAT_LIST=digits, TRADETYPE_LIST=overunder, TYPE_LIST=both. The actual contract is chosen by the purchase block's PURCHASE_LIST (DIGITOVER or DIGITUNDER).

## REFERENCE: martingale/recovery bot that declares + uses its own variables
Variables are DECLARED in a <variables> block at the top of the XML, and trade_definition has THREE statements: TRADE_OPTIONS (market > tradetype > contracttype > candleinterval > restartbuysell > restartonerror), INITIALIZATION (run-once variable setup), SUBMARKET (duration + amount + prediction). Amount/prediction read variables so after_purchase can change them.

\`\`\`xml
<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="init_stake">Initial Stake</variable>
    <variable id="stake">Current Stake</variable>
    <variable id="mart_factor">Martingale Factor</variable>
    <variable id="is_recovery">is_recovery</variable>
  </variables>
  <block type="trade_definition" id="td1" deletable="false" x="0" y="0">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="m1" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">1HZ50V</field>
        <next>
          <block type="trade_definition_tradetype" id="tt1" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">digits</field>
            <field name="TRADETYPE_LIST">overunder</field>
            <next>
              <block type="trade_definition_contracttype" id="ct1" deletable="false" movable="false">
                <field name="TYPE_LIST">both</field>
                <next>
                  <block type="trade_definition_candleinterval" id="ci1" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="rbs1" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="roe1" deletable="false" movable="false">
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
    <statement name="INITIALIZATION">
      <block type="variables_set" id="ini1">
        <field name="VAR" id="init_stake">Initial Stake</field>
        <value name="VALUE"><block type="math_number" id="n1"><field name="NUM">1</field></block></value>
        <next>
          <block type="variables_set" id="ini2">
            <field name="VAR" id="mart_factor">Martingale Factor</field>
            <value name="VALUE"><block type="math_number" id="n2"><field name="NUM">2</field></block></value>
            <next>
              <block type="variables_set" id="ini3">
                <field name="VAR" id="stake">Current Stake</field>
                <value name="VALUE"><block type="variables_get" id="g1"><field name="VAR" id="init_stake">Initial Stake</field></block></value>
                <next>
                  <block type="variables_set" id="ini4">
                    <field name="VAR" id="is_recovery">is_recovery</field>
                    <value name="VALUE"><block type="logic_boolean" id="b0"><field name="BOOL">FALSE</field></block></value>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="so1">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="true" vh_enabled="false"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <field name="VIRTUAL_HOOK_ENABLED">FALSE</field>
        <field name="BULK_TRADE_ENABLED">FALSE</field>
        <value name="DURATION"><shadow type="math_number_positive" id="d1"><field name="NUM">1</field></shadow></value>
        <value name="AMOUNT"><block type="variables_get" id="g2"><field name="VAR" id="stake">Current Stake</field></block></value>
        <value name="PREDICTION">
          <shadow type="math_number_positive" id="d2"><field name="NUM">1</field></shadow>
          <block type="variables_get" id="g3"><field name="VAR" id="is_recovery">is_recovery</field></block>
        </value>
      </block>
    </statement>
  </block>
  <block type="before_purchase" id="bp1" deletable="false" x="0" y="700">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="controls_if" id="if0">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0"><block type="logic_compare" id="lc0"><field name="OP">EQ</field><value name="A"><block type="variables_get" id="g4"><field name="VAR" id="is_recovery">is_recovery</field></block></value><value name="B"><block type="logic_boolean" id="b1"><field name="BOOL">FALSE</field></block></value></block></value>
        <statement name="DO0"><block type="purchase" id="p1"><field name="PURCHASE_LIST">DIGITUNDER</field></block></statement>
        <statement name="ELSE"><block type="purchase" id="p2"><field name="PURCHASE_LIST">DIGITOVER</field></block></statement>
      </block>
    </statement>
  </block>
  <block type="after_purchase" id="ap1" x="714" y="292">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if" id="if1">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0"><block type="contract_check_result" id="ccr1"><field name="CHECK_RESULT">win</field></block></value>
        <statement name="DO0">
          <block type="variables_set" id="w1">
            <field name="VAR" id="stake">Current Stake</field>
            <value name="VALUE"><block type="variables_get" id="g5"><field name="VAR" id="init_stake">Initial Stake</field></block></value>
            <next>
              <block type="variables_set" id="w2">
                <field name="VAR" id="is_recovery">is_recovery</field>
                <value name="VALUE"><block type="logic_boolean" id="b2"><field name="BOOL">FALSE</field></block></value>
              </block>
            </next>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="variables_set" id="l1">
            <field name="VAR" id="stake">Current Stake</field>
            <value name="VALUE"><block type="math_arithmetic" id="ma1"><field name="OP">MULTIPLY</field><value name="A"><block type="variables_get" id="g6"><field name="VAR" id="stake">Current Stake</field></block></value><value name="B"><block type="variables_get" id="g7"><field name="VAR" id="mart_factor">Martingale Factor</field></block></value></block></value>
            <next>
              <block type="variables_set" id="l2">
                <field name="VAR" id="is_recovery">is_recovery</field>
                <value name="VALUE"><block type="logic_boolean" id="b3"><field name="BOOL">TRUE</field></block></value>
                <next><block type="trade_again" id="ta1"></block></next>
              </block>
            </next>
          </block>
        </statement>
      </block>
    </statement>
  </block>
</xml>
\`\`\`

## HOW EACH BLOCK WORKS
trade_definition_tradeoptions: DURATIONTYPE_LIST t/m/h; DURATION numeric; AMOUNT read a variable (variables_get) so recovery can change stake; PREDICTION digit read a variable so recovery can change barrier. Its <mutation> MUST have has_prediction="true" when the contract needs a prediction digit.
read_details: DETAIL_INDEX MUST be a NUMBER — use 4 = profit (positive win, negative loss).
contract_check_result: field name CHECK_RESULT with "win" or "loss"; put it directly in a controls_if IF0 condition. Do NOT use trade_option to change amount/prediction (no such block) — change variables instead.
variables_set/variables_get: <field name="VAR" id="varId">Name</field>, id must match the <variable id="..."> declaration.
logic_compare: OP EQ/NEQ/LT/LTE/GT/GTE, values A and B.
math_arithmetic: OP ADD/MINUS/MULTIPLY/DIVIDE/POWER/MOD, operands A and B.
notify: REQUIRED fields NOTIFICATION_TYPE (success/info/warn/error) and NOTIFICATION_SOUND (silent/announcement/earned-money/job-done/error/severe-error) plus a MESSAGE value (use text_join to combine text + variables).

## REQUIRED BOT STRUCTURE (distinct x,y coords)
1. trade_definition (x=0,y=0): FULL nested TRADE_OPTIONS chain (market > tradetype > contracttype > candleinterval > restartbuysell > restartonerror) + SUBMARKET statement holding trade_definition_tradeoptions (duration + amount + prediction/barrier).
2. tick_analysis or before_purchase area for entry/setup logic (x=350,y=60): set variables, compute stakes, conditions.
3. before_purchase (x=0,y=658): a purchase block (PURCHASE_LIST matching contract type). Pick withdrawal mode via variables when needed.
4. during_purchase (x=714,y=60): check_sell → if TRUE, sell via sell_at_market.
5. after_purchase (x=714,y=292): decide win/loss with contract_check_result or read_details(profit>0). On LOSS: multiply stake variable by martingale factor, switch barrier/prediction for recovery, notify. On WIN: reset stake to base, notify. END with trade_again so the bot loops.

## COMPLEX STRATEGY RULES
- Anything that changes over time (stake, prediction, is_recovery, total profit, loss count, martingale level) MUST be a variable, initialized in INITIALIZATION.
- Do martingale/recovery in after_purchase: on win reset stake=initial + is_recovery=FALSE + prediction=normal; on loss stake=stake*martingale + is_recovery=TRUE + prediction=recovery.
- SUBMARKET amount/prediction must READ variables so they change every trade.
- Report each result with notify or text_print (use text_join for text + variables).
- Nest logic_compare inside controls_if IF0 for conditions; use contract_check_result for win/loss.
- Default martingale multiplier on loss is x2 unless the user specifies another.

## COMPLETENESS CHECKLIST (verify before outputting)
All block IDs unique; all <field> filled; all <value>/<statement> have child blocks; every variable used IS declared in <variables> with matching id; all variables initialized in INITIALIZATION; DETAIL_INDEX numeric (4=profit); math_number has NUM; text has TEXT; logic_compare has OP/A/B; controls_if has IF0; no empty strings/placeholders.`;

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

// Parse [QUESTIONS]...[/QUESTIONS] block into selectable cards
function parseQuestions(text: string): ChatQuestion[] | null {
    const m = text.match(/\[QUESTIONS\]([\s\S]*?)\[\/QUESTIONS\]/);
    if (!m) return null;
    const questions: ChatQuestion[] = [];
    let current: ChatQuestion | null = null;
    for (const rawLine of m[1].split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('Q:')) {
            if (current) questions.push(current);
            current = {
                id: `q${questions.length + 1}`,
                question: line.slice(2).trim(),
                options: [],
            };
        } else if (line.startsWith('- ') && current) {
            const optRaw = line.slice(2).trim();
            current.options.push({ label: optRaw, value: optRaw });
        }
    }
    if (current) questions.push(current);
    return questions.length > 0 ? questions : null;
}

// Strip the [QUESTIONS] block from displayed content
function stripQuestions(text: string): string {
    return text.replace(/\[QUESTIONS\][\s\S]*?\[\/QUESTIONS\]/, '').replace(/\n{2,}/g, '\n').trim();
}

// ── Valid block types (verified from source code) ──
const VALID_BLOCKS: Set<string> = new Set([
    // Trade Definition
    'trade_definition', 'trade_definition_market', 'trade_definition_tradetype', 'trade_definition_contracttype',
    'trade_definition_candleinterval', 'trade_definition_tradeoptions', 'trade_definition_tradeoptions_payout',
    'trade_definition_restartbuysell', 'trade_definition_restartonerror', 'trade_definition_multiplier',
    'trade_definition_accumulator', 'multiplier_take_profit', 'multiplier_stop_loss', 'accumulator_take_profit',
    // Before Purchase
    'before_purchase', 'purchase', 'ask_price', 'payout',
    // During Purchase
    'during_purchase', 'check_sell', 'sell_price', 'sell_at_market',
    // After Purchase
    'after_purchase', 'trade_again', 'read_details', 'contract_check_result',
    // Tick Analysis
    'tick_analysis', 'ticks', 'ticks_string', 'tick', 'tick_string', 'ohlc', 'stat_list', 'stat',
    'last_digit', 'read_ohlc', 'lastDigitList', 'ohlc_values', 'check_direction', 'get_ohlc',
    // Indicators + Parts
    'sma_statement', 'smaa_statement', 'ema_statement', 'rsi_statement', 'rsia_statement', 'emaa_statement',
    'bb_statement', 'bba_statement', 'macda_statement',
    'fast_ema_period', 'signal_ema_period', 'std_dev_multiplier_up', 'period', 'std_dev_multiplier_down',
    'input_list', 'slow_ema_period',
    // Logic
    'controls_if', 'logic_boolean', 'logic_compare', 'logic_negate', 'logic_null', 'logic_operation', 'logic_ternary',
    // Math
    'math_arithmetic', 'math_change', 'math_constant', 'math_constrain', 'math_modulo', 'math_number',
    'math_number_positive', 'math_number_property', 'math_on_list', 'math_random_float', 'math_random_int',
    'math_round', 'math_single', 'math_trig',
    // Text
    'text', 'text_append', 'text_changeCase', 'text_charAt', 'text_getSubstring', 'text_indexOf', 'text_isEmpty',
    'text_join', 'text_length', 'text_print', 'text_prompt_ext', 'text_statement', 'text_trim',
    // Lists
    'lists_create_with', 'lists_getIndex', 'lists_getSublist', 'lists_indexOf', 'lists_isEmpty', 'lists_length',
    'lists_repeat', 'lists_setIndex', 'lists_sort', 'lists_split', 'lists_statement',
    // Variables
    'variables_get', 'variables_set',
    // Loops
    'controls_flow_statements', 'controls_for', 'controls_forEach', 'controls_repeat', 'controls_repeat_ext',
    'controls_whileUntil',
    // Functions
    'procedures_callnoreturn', 'procedures_callreturn', 'procedures_defnoreturn', 'procedures_defreturn',
    'procedures_ifreturn',
    // Tools
    'totimestamp', 'todatetime', 'timeout', 'tick_delay', 'epoch',
    'console', 'useless_block', 'block_holder', 'total_runs', 'barrier_offset', 'total_profit',
    'total_profit_string', 'notify_telegram', 'notify', 'loader', 'balance',
    'read_ohlc_obj', 'ohlc_values_in_list', 'is_candle_black',
]);

// Invalid block name → correct block name
const BLOCK_CORRECTIONS: Record<string, string> = {
    contract_details: 'read_details',
    contract_check_result_details: 'read_details',
    check_result: 'contract_check_result',
    sell: 'sell_at_market',
    buy: 'purchase',
    trade_option: 'trade_again',
    readOhlc: 'read_ohlc',
    read_ohlc_values: 'ohlc_values',
    controls_if_else: 'controls_if',
    lists_create_empty: 'lists_create_with',
    candle: 'read_ohlc_obj',
    candle_read: 'read_ohlc_obj',
    indicator: 'sma_statement',
    stochastic: 'sma_statement',
    moving_average: 'sma_statement',
    macd: 'macda_statement',
    bollinger_bands: 'bb_statement',
    rsi: 'rsi_statement',
    atr: 'sma_statement',
    adx: 'sma_statement',
    cci: 'sma_statement',
    awesome_oscillator: 'sma_statement',
    momentum: 'sma_statement',
    rate_of_change: 'sma_statement',
    williams_r: 'sma_statement',
    variance: 'sma_statement',
    tick_delay_seconds: 'tick_delay',
    notify_telegram_message: 'notify_telegram',
    text_to_number: 'text_length',
    number_to_text: 'text',
    digit_analysis: 'last_digit',
    previous_ticks: 'ticks',
    current_tick: 'tick',
    is_candle_green: 'is_candle_black',
    total_trades: 'total_runs',
};

// Parse XML, autocorrect invalid block types, strip uncorrectable ones.
// Returns { cleanXml, fixes, removed }
function sanitizeXml(rawXml: string): { cleanXml: string; fixes: string[]; removed: string[] } {
    const fixes: string[] = [];
    const removed: string[] = [];
    let cleanXml = rawXml;

    try {
        const doc = new DOMParser().parseFromString(rawXml, 'text/xml');
        if (doc.querySelector('parsererror')) throw new Error('parse error');
        const targets = Array.from(doc.querySelectorAll('block, shadow'));
        for (const el of targets) {
            const t = el.getAttribute('type');
            if (!t) continue;
            if (VALID_BLOCKS.has(t)) continue;
            const correction = BLOCK_CORRECTIONS[t];
            if (correction) {
                if (correction === 'controls_if') {
                    // controls_if_else → controls_if: just fix type, ELSE statement stays usable
                    el.setAttribute('type', correction);
                    fixes.push(`${t} → ${correction}`);
                } else {
                    el.setAttribute('type', correction);
                    fixes.push(`${t} → ${correction}`);
                }
            } else {
                // Unknown block: remove it to avoid breaking the whole load
                el.parentNode?.removeChild(el);
                removed.push(t);
            }
        }
        const serializer = new XMLSerializer();
        cleanXml = serializer.serializeToString(doc.documentElement);
    } catch (_) {
        // Fallback: string replacements only
        let fixed = rawXml;
        for (const [bad, good] of Object.entries(BLOCK_CORRECTIONS)) {
            const re = new RegExp(`type="${bad}"`, 'g');
            if (re.test(fixed)) {
                fixed = fixed.replace(re, `type="${good}"`);
                fixes.push(`${bad} → ${good}`);
            }
        }
        cleanXml = fixed;
    }

    // Autocorrect read_details DETAIL_INDEX text values → numeric indices
    const DETAIL_INDEX_VALUES: Record<string, string> = {
        profit: '4',
        payout: '3',
        'purchase price': '2',
        'deal reference id': '1',
        'contract type': '5',
        'entry spot time': '6',
        'entry spot price': '7',
        'exit spot time': '8',
        'exit spot price': '9',
        barrier: '10',
        result: '11',
    };
    for (const [bad, good] of Object.entries(DETAIL_INDEX_VALUES)) {
        const re = new RegExp(`(<field name="DETAIL_INDEX">)\\s*${bad}\\s*(</field>)`, 'gi');
        if (re.test(cleanXml)) {
            cleanXml = cleanXml.replace(re, `$1${good}$2`);
            fixes.push(`DETAIL_INDEX ${bad} → ${good}`);
        }
    }

    return { cleanXml, fixes, removed };
}

function ls(key: string, def: string) { try { return localStorage.getItem(key) || def; } catch { return def; } }
function lsSet(key: string, val: string) { try { localStorage.setItem(key, val); } catch {} }

export const BuildBot = observer(() => {
    const { dashboard, load_modal } = useStore();
    const { setActiveTab } = dashboard;
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
    const [selections, setSelections] = useState<Record<number, Record<string, string>>>({});
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

    const sendMessage = useCallback(async (overrideText?: string) => {
        const text = (typeof overrideText === 'string' ? overrideText : input).trim();
        if (!text || loading) return;

        const userMsg: ChatMessage = { role: 'user', content: text };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);
        setError('');

        try {
            // Build conversation for AI (trim old history to avoid token limits)
            const recentHistory = messages.slice(-4).map(m => ({ role: m.role, content: m.content }));
            const chatMessages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...(generatedXml ? [{ role: 'user', content: `Here is the current bot XML:\n\`\`\`xml\n${generatedXml}\n\`\`\`` }] : []),
                ...recentHistory,
                { role: 'user', content: text },
            ];

            const response = await callGroq(chatMessages);
            const xml = extractXml(response);
            const questions = parseQuestions(response);
            const content = questions ? stripQuestions(response) : response;
            // Strip embedded XML from the stored message text (kept separately in `xml`),
            // so history doesn't re-send full bot dumps and blow the Groq token limit.
            const cleanContent = content.replace(/```xml\s*[\s\S]*?```/g, '[XML omitted]');

            const assistantMsg: ChatMessage = {
                role: 'assistant',
                content: cleanContent,
                xml: xml || undefined,
                questions: questions || undefined,
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

    const submitAnswers = useCallback(async (msgIndex: number, questions: ChatQuestion[]) => {
        const answers = selections[msgIndex] || {};
        const answered = questions.filter(q => answers[q.id]).map(q => ({ q, v: answers[q.id] }));
        if (answered.length === 0) return;
        const text = answered.map((a, i) => `${i + 1}) ${a.q.question}: ${a.v}`).join('\n');
        // Clear the selections for this message
        setSelections(prev => {
            const next = { ...prev };
            delete next[msgIndex];
            return next;
        });
        await sendMessage(text);
    }, [selections, sendMessage]);

    const loadToWorkspace = useCallback(async () => {
        if (!generatedXml) return;
        try {
            // Autocorrect invalid block types and strip unknown ones
            const { cleanXml, fixes, removed } = sanitizeXml(generatedXml);

            const issues: string[] = [];

            // Check for empty fields
            const fieldMatches = cleanXml.match(/<field name="[^"]*"><\/field>/g);
            if (fieldMatches) {
                issues.push(`Empty fields found: ${fieldMatches.length}`);
            }

            // Check for placeholder text
            const placeholders = cleanXml.match(/(TODO|FIXME|XXX|PLACEHOLDER)/gi);
            if (placeholders) {
                issues.push('Contains placeholder text');
            }

            // Check for required trade_definition
            if (!cleanXml.includes('trade_definition"')) {
                issues.push('Missing trade_definition block');
            }

            // Check for required before_purchase
            if (!cleanXml.includes('before_purchase"')) {
                issues.push('Missing before_purchase block');
            }

            let summary = '';
            if (fixes.length > 0) summary += `\n✅ Autocorrected ${fixes.length} block(s):\n- ${fixes.join('\n- ')}`;
            if (removed.length > 0) summary += `\n⚠️ Removed ${removed.length} unknown block(s): ${removed.join(', ')}`;
            if (issues.length > 0) {
                alert(`⚠️ XML has ${issues.length} issue(s):\n${issues.join('\n')}${summary}\n\nFix them or ask the AI to regenerate.`);
                return;
            }

            // Save the cleaned XML so subsequent loads use it
            if (cleanXml !== generatedXml) {
                setGeneratedXml(cleanXml);
            }

            // Wait for workspace to be ready
            const waitForWorkspace = () => new Promise<void>((resolve, reject) => {
                let attempts = 0;
                const check = () => {
                    attempts++;
                    if (window.Blockly?.derivWorkspace) {
                        resolve();
                    } else if (attempts >= 30) {
                        reject(new Error('Workspace not available'));
                    } else {
                        setTimeout(check, 100);
                    }
                };
                check();
            });

            await waitForWorkspace();

            // Navigate to bot builder tab first
            setActiveTab(DBOT_TABS.BOT_BUILDER);

            // Small delay to ensure tab is rendered
            await new Promise(r => setTimeout(r, 200));

            // Load using the proper store method
            const tempId = `buildbot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await load_modal.loadStrategyToBuilder(
                { id: tempId, xml: cleanXml, name: 'Build Bot Strategy', save_type: 'pending' },
                true
            );

            alert(`Bot loaded into workspace!${summary}`);
        } catch (e: any) {
            alert(`Error loading bot: ${e.message}`);
        }
    }, [generatedXml, setGeneratedXml, setActiveTab, load_modal]);

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
                        {msg.questions && msg.questions.length > 0 && (
                            <div style={{ marginTop: 6 }}>
                                {msg.questions.map(q => {
                                    const msgSel = selections[i] || {};
                                    const selected = msgSel[q.id];
                                    const setOne = (v: string) => setSelections(prev => ({
                                        ...prev,
                                        [i]: { ...(prev[i] || {}), [q.id]: v },
                                    }));
                                    return (
                                        <div key={q.id} style={{ marginBottom: 6 }}>
                                            <div style={{ fontSize: 10, color: '#eee', marginBottom: 3 }}>
                                                {q.question}
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                                {q.options.map(opt => {
                                                    const isSel = selected === opt.value;
                                                    return (
                                                        <button
                                                            key={opt.value}
                                                            onClick={() => setOne(opt.value)}
                                                            style={{
                                                                padding: '2px 8px',
                                                                fontSize: 10,
                                                                fontFamily: 'monospace',
                                                                background: isSel ? '#2196f3' : '#1a1a2e',
                                                                color: isSel ? '#fff' : '#bbb',
                                                                border: isSel ? '1px solid #2196f3' : '1px solid #444',
                                                                borderRadius: 12,
                                                                cursor: 'pointer',
                                                            }}>
                                                            {opt.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                                <button onClick={() => submitAnswers(i, msg.questions!)}
                                    disabled={loading || Object.keys(selections[i] || {}).length === 0}
                                    style={{
                                        padding: '3px 12px',
                                        background: loading || Object.keys(selections[i] || {}).length === 0 ? '#333' : '#4caf50',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: 3,
                                        cursor: loading || Object.keys(selections[i] || {}).length === 0 ? 'not-allowed' : 'pointer',
                                        fontSize: 10,
                                        fontWeight: 'bold',
                                        marginTop: 4,
                                    }}>
                                    ✓ Submit Answers
                                </button>
                            </div>
                        )}
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
                <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
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
});

export default BuildBot;

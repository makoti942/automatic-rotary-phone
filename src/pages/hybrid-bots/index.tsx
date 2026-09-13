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

const SYSTEM_PROMPT = `You are an expert Deriv Bot builder. You output a JSON specification — the client builds the full Blockly XML from your spec. Keep the JSON concise (under 800 chars).

## RULES
- If details are missing, use sensible defaults. Do NOT ask questions.
- Always output the JSON spec, nothing else (no explanations, no XML).

## DEFAULTS (use when user doesn't specify)
symbol: R_100, stake: 1, duration: 1, duration_unit: "t" (tick), market: synthetic_index, submarket: random_index, tradetype: overunder, type: both, candle_interval: 60, restart_on_error: true, loop: true, martingale_factor: 2

## JSON SPEC FORMAT
\`\`\`json
{
  "symbol": "R_100",
  "stake": 1,
  "duration": 1,
  "duration_unit": "t",
  "market": "synthetic_index",
  "submarket": "random_index",
  "tradetype": "overunder",
  "type": "both",
  "candle_interval": 60,
  "loop": true,

  "normal_direction": "over",
  "normal_barrier": 2,
  "recovery_enabled": true,
  "recovery_direction": "under",
  "recovery_barrier": 7,
  "martingale_enabled": true,
  "martingale_factor": 2,

  "entry": {
    "type": "last_digit_eq",
    "digit": 0
  },

  "notify_win": true,
  "notify_loss": true,
  "variables": [
    {"id": "loss_count", "name": "Loss Count", "initial_value": 0}
  ]
}
\`\`\`

## ENTRY CONDITIONS (what "entry" object values mean)
- \`{"type": "last_digit_eq", "digit": 0}\` — wait until last digit equals 0, then trade
- \`{"type": "last_digit_in", "digits": [0, 5, 9]}\` — wait until last digit is one of these
- \`{"type": "last_digit_not_in", "digits": [0, 5, 9]}\` — wait until last digit is NOT one of these
- \`{"type": "always"}\` — no entry condition, trade immediately (DEFAULT if no entry field)

## STRATEGY MAPPING
- "Over 7" → normal_direction:"over", normal_barrier:7
- "Under 4" → normal_direction:"under", normal_barrier:4
- "Waits for digit 0 then execute" → entry:{type:"last_digit_eq", digit:0}
- "Recovery Under 5" → recovery_direction:"under", recovery_barrier:5
- "Martingale 2x" → martingale_factor:2
- "R_50" → symbol:"R_50"
- "stake 0.50" → stake:0.50

## OUTPUT
Output ONLY the JSON spec inside \`\`\`json ... \`\`\` blocks. Nothing else.`;

async function callGroq(messages: any[]): Promise<string> {
    try {
        const res = await fetch('/api/groq', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages,
                temperature: 0.3,
                max_tokens: 1500,
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

function buildBotXml(spec: any): string | null {
    if (!spec || typeof spec !== 'object') return null;

    // Normalize the richer spec format
    const symbol = spec.symbol || 'R_100';
    const stake = Number(spec.stake) || 1;
    const duration = Number(spec.duration) || 1;
    const durationUnit = spec.duration_unit || 't';
    const market = spec.market || 'synthetic_index';
    const submarket = spec.submarket || 'random_index';
    const tradetype = spec.tradetype || 'overunder';
    const type = spec.type || 'both';
    const candleInterval = Number(spec.candle_interval) || 60;
    const restartOnError = spec.restart_on_error !== false;
    const loop = spec.loop !== false;

    // Normal trade settings
    const normalDir = spec.normal_direction || 'over';
    const normalBarrier = Number(spec.normal_barrier) || 2;

    // Recovery settings
    const recEnabled = spec.recovery_enabled === true;
    const recDir = spec.recovery_direction || 'under';
    const recBarrier = Number(spec.recovery_barrier) || 7;

    // Martingale
    const martEnabled = spec.martingale_enabled === true;
    const martFactor = Number(spec.martingale_factor) || 2;

    // Entry condition
    const entry = spec.entry || { type: 'always' };
    const hasEntry = entry.type && entry.type !== 'always';

    // Notification
    const notifyWin = spec.notify_win === true;
    const notifyLoss = spec.notify_loss === true;

    // Custom variables
    const customVars: Array<{ id: string; name: string; initial_value: number | string | boolean }> =
        Array.isArray(spec.variables) ? spec.variables.filter((v: any) => v?.id && v?.name) : [];

    // Purchase list based on direction
    const normalPurchase = normalDir === 'under' ? 'DIGITUNDER' : 'DIGITOVER';
    const recPurchase = recDir === 'under' ? 'DIGITUNDER' : 'DIGITOVER';

    // ── Build XML ──
    const uid = () => Math.random().toString(36).slice(2, 8);

    // Variable declarations
    const baseVars = [
        '<variable id="init_stake">Initial Stake</variable>',
        '<variable id="stake">Current Stake</variable>',
        '<variable id="is_recovery">is_recovery</variable>',
    ];
    if (martEnabled) baseVars.push('<variable id="mart_factor">Martingale Factor</variable>');
    if (hasEntry) baseVars.push('<variable id="digit_triggered">Digit Triggered</variable>');
    if (recEnabled) {
        baseVars.push('<variable id="normal_barrier">Normal Barrier</variable>');
        baseVars.push('<variable id="recovery_barrier">Recovery Barrier</variable>');
        baseVars.push('<variable id="current_barrier">Current Barrier</variable>');
    }
    const customVarDecl = customVars.map(v => `<variable id="${v.id}">${v.name}</variable>`);
    const allVars = [...baseVars, ...customVarDecl];

    // INITIALIZATION chain
    const initBlocks: string[] = [];
    let initId = 0;
    const addInit = (varId: string, varName: string, valueXml: string) => {
        const nid = `ini${initId++}`;
        initBlocks.push(`<block type="variables_set" id="${nid}"><field name="VAR" id="${varId}">${varName}</field><value name="VALUE">${valueXml}</value>`);
    };
    const numVal = (id: string, n: number) => `<block type="math_number" id="${id}"><field name="NUM">${n}</field></block>`;
    const boolVal = (id: string, b: boolean) => `<block type="logic_boolean" id="${id}"><field name="BOOL">${b ? 'TRUE' : 'FALSE'}</block>`;
    const varGet = (id: string, varId: string, varName: string) => `<block type="variables_get" id="${id}"><field name="VAR" id="${varId}">${varName}</field></block>`;

    addInit('init_stake', 'Initial Stake', numVal('v_is', stake));
    addInit('stake', 'Current Stake', varGet('v_gs', 'init_stake', 'Initial Stake'));
    addInit('is_recovery', 'is_recovery', boolVal('v_ir', false));
    if (martEnabled) addInit('mart_factor', 'Martingale Factor', numVal('v_mf', martFactor));
    if (hasEntry) addInit('digit_triggered', 'Digit Triggered', boolVal('v_dt', false));
    if (recEnabled) {
        addInit('normal_barrier', 'Normal Barrier', numVal('v_nb', normalBarrier));
        addInit('recovery_barrier', 'Recovery Barrier', numVal('v_rb', recBarrier));
        addInit('current_barrier', 'Current Barrier', varGet('v_gc', 'normal_barrier', 'Normal Barrier'));
    }
    customVars.forEach((v, i) => {
        const val = typeof v.initial_value === 'number' ? numVal(`v_cv${i}`, v.initial_value) : boolVal(`v_cv${i}`, v.initial_value === true);
        addInit(v.id, v.name, val);
    });

    // Close the chain: each block wraps in <next>
    let initChain = '';
    for (let i = initBlocks.length - 1; i >= 0; i--) {
        if (i === initBlocks.length - 1) {
            initChain = initBlocks[i] + '</block>';
        } else {
            initChain = initBlocks[i] + `<next>${initChain}</next></block>`;
        }
    }

    // ── TICK ANALYSIS (entry digit check) ──
    let tickAnalysisXml = '';
    if (hasEntry) {
        let conditionXml = '';
        if (entry.type === 'last_digit_eq') {
            conditionXml = `<block type="logic_compare" id="tdc1"><field name="OP">EQ</field><value name="A"><block type="last_digit" id="tld1"></block></value><value name="B"><block type="math_number" id="tdv1"><field name="NUM">${entry.digit ?? 0}</field></block></value></block>`;
        } else if (entry.type === 'last_digit_in' && Array.isArray(entry.digits)) {
            // OR chain: last_digit == d1 OR last_digit == d2 OR ...
            const parts = entry.digits.map((d: number, i: number) => {
                return `<block type="logic_compare" id="tdc${i}"><field name="OP">EQ</field><value name="A"><block type="last_digit" id="tld${i}"></block></value><value name="B"><block type="math_number" id="tdv${i}"><field name="NUM">${d}</field></block></value></block>`;
            });
            if (parts.length === 1) {
                conditionXml = parts[0];
            } else {
                let orChain = `<block type="logic_operation" id="tdor1"><field name="OP">OR</field><value name="A">${parts[0]}</value><value name="B">${parts[1]}</value></block>`;
                for (let i = 2; i < parts.length; i++) {
                    orChain = `<block type="logic_operation" id="tdor${i}"><field name="OP">OR</field><value name="A">${orChain}</value><value name="B">${parts[i]}</value></block>`;
                }
                conditionXml = orChain;
            }
        } else if (entry.type === 'last_digit_not_in' && Array.isArray(entry.digits)) {
            const parts = entry.digits.map((d: number, i: number) => {
                return `<block type="logic_compare" id="tdc${i}"><field name="OP">EQ</field><value name="A"><block type="last_digit" id="tld${i}"></block></value><value name="B"><block type="math_number" id="tdv${i}"><field name="NUM">${d}</field></block></value></block>`;
            });
            let orChain = parts.length > 1
                ? (() => { let c = `<block type="logic_operation" id="tdor1"><field name="OP">OR</field><value name="A">${parts[0]}</value><value name="B">${parts[1]}</value></block>`; for (let i = 2; i < parts.length; i++) c = `<block type="logic_operation" id="tdor${i}"><field name="OP">OR</field><value name="A">${c}</value><value name="B">${parts[i]}</value></block>`; return c; })()
                : parts[0];
            conditionXml = `<block type="logic_negate" id="tdng1"><value name="BOOL">${orChain}</value></block>`;
        }

        if (conditionXml) {
            tickAnalysisXml = `
  <block type="tick_analysis" id="ta1" x="350" y="60">
    <statement name="TICKANALYSIS_STACK">
      <block type="controls_if" id="ta_if1">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0">${conditionXml}</value>
        <statement name="DO0">
          <block type="variables_set" id="ta_set1"><field name="VAR" id="digit_triggered">Digit Triggered</field><value name="VALUE">${boolVal('ta_b1', true)}</value></block>
        </statement>
        <statement name="ELSE">
          <block type="variables_set" id="ta_set2"><field name="VAR" id="digit_triggered">Digit Triggered</field><value name="VALUE">${boolVal('ta_b2', false)}</value></block>
        </statement>
      </block>
    </statement>
  </block>`;
        }
    }

    // ── BEFORE PURCHASE ──
    let beforePurchaseXml: string;
    if (hasEntry) {
        // Conditional: if digit_triggered, purchase normally; else do nothing
        if (recEnabled) {
            // Also switch barrier based on recovery mode
            beforePurchaseXml = `
  <block type="before_purchase" id="bp1" deletable="false" x="0" y="658">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="controls_if" id="bp_if1">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0"><block type="variables_get" id="bp_vg1"><field name="VAR" id="digit_triggered">Digit Triggered</field></block></value>
        <statement name="DO0">
          <block type="controls_if" id="bp_if2">
            <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
            <value name="IF0"><block type="variables_get" id="bp_vg2"><field name="VAR" id="is_recovery">is_recovery</field></block></value>
            <statement name="DO0"><block type="purchase" id="bp_pu1"><field name="PURCHASE_LIST">${recPurchase}</field></block></statement>
            <statement name="ELSE"><block type="purchase" id="bp_pu2"><field name="PURCHASE_LIST">${normalPurchase}</field></block></statement>
          </block>
        </statement>
      </block>
    </statement>
  </block>`;
        } else {
            beforePurchaseXml = `
  <block type="before_purchase" id="bp1" deletable="false" x="0" y="658">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="controls_if" id="bp_if1">
        <value name="IF0"><block type="variables_get" id="bp_vg1"><field name="VAR" id="digit_triggered">Digit Triggered</field></block></value>
        <statement name="DO0">
          <block type="purchase" id="bp_pu1"><field name="PURCHASE_LIST">${normalPurchase}</field></block>
        </statement>
      </block>
    </statement>
  </block>`;
        }
    } else {
        // No entry condition — just purchase
        beforePurchaseXml = `
  <block type="before_purchase" id="bp1" deletable="false" x="0" y="658">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="purchase" id="bp_pu1"><field name="PURCHASE_LIST">${normalPurchase}</field></block>
    </statement>
  </block>`;
    }

    // ── AFTER PURCHASE ──
    const winStatements: string[] = [];
    winStatements.push(`<block type="variables_set" id="ap_w1"><field name="VAR" id="stake">Current Stake</field><value name="VALUE">${varGet('ap_wg1', 'init_stake', 'Initial Stake')}</value></block>`);
    winStatements.push(`<block type="variables_set" id="ap_w2"><field name="VAR" id="is_recovery">is_recovery</field><value name="VALUE">${boolVal('ap_wb1', false)}</value></block>`);
    if (recEnabled) winStatements.push(`<block type="variables_set" id="ap_w3"><field name="VAR" id="current_barrier">Current Barrier</field><value name="VALUE">${varGet('ap_wg2', 'normal_barrier', 'Normal Barrier')}</value></block>`);
    if (hasEntry) winStatements.push(`<block type="variables_set" id="ap_w4"><field name="VAR" id="digit_triggered">Digit Triggered</field><value name="VALUE">${boolVal('ap_wb2', false)}</value></block>`);

    // Chain win statements with <next>
    let winChain = '';
    for (let i = winStatements.length - 1; i >= 0; i--) {
        if (i === winStatements.length - 1) winChain = winStatements[i];
        else winChain = winStatements[i].replace(/<\/block>$/, `<next>${winChain}</next></block>`);
    }

    // Notify on win
    if (notifyWin) {
        winChain += `<next><block type="notify" id="ap_wn1"><field name="NOTIFICATION_TYPE">success</field><field name="NOTIFICATION_SOUND">earned-money</field><value name="MESSAGE"><block type="text_join" id="ap_wtj1"><mutation items="2"></mutation><value name="ADD0"><block type="text" id="ap_wt1"><field name="TEXT">Win! Stake reset to </field></block></value><value name="ADD1"><block type="variables_get" id="ap_wg3"><field name="VAR" id="stake">Current Stake</field></block></value></block></value></block></next>`;
    }

    const lossStatements: string[] = [];
    if (martEnabled) {
        lossStatements.push(`<block type="variables_set" id="ap_l1"><field name="VAR" id="stake">Current Stake</field><value name="VALUE"><block type="math_arithmetic" id="ap_lm1"><field name="OP">MULTIPLY</field><value name="A">${varGet('ap_lg1', 'stake', 'Current Stake')}</value><value name="B">${varGet('ap_lg2', 'mart_factor', 'Martingale Factor')}</value></block></value></block>`);
    }
    lossStatements.push(`<block type="variables_set" id="ap_l2"><field name="VAR" id="is_recovery">is_recovery</field><value name="VALUE">${boolVal('ap_lb1', true)}</value></block>`);
    if (recEnabled) lossStatements.push(`<block type="variables_set" id="ap_l3"><field name="VAR" id="current_barrier">Current Barrier</field><value name="VALUE">${varGet('ap_lg3', 'recovery_barrier', 'Recovery Barrier')}</value></block>`);

    let lossChain = '';
    for (let i = lossStatements.length - 1; i >= 0; i--) {
        if (i === lossStatements.length - 1) lossChain = lossStatements[i];
        else lossChain = lossStatements[i].replace(/<\/block>$/, `<next>${lossChain}</next></block>`);
    }

    if (notifyLoss) {
        lossChain += `<next><block type="notify" id="ap_ln1"><field name="NOTIFICATION_TYPE">error</field><field name="NOTIFICATION_SOUND">severe-error</field><value name="MESSAGE"><block type="text_join" id="ap_ltj1"><mutation items="2"></mutation><value name="ADD0"><block type="text" id="ap_lt1"><field name="TEXT">Loss! New stake: </field></block></value><value name="ADD1"><block type="variables_get" id="ap_lg4"><field name="VAR" id="stake">Current Stake</field></block></value></block></value></block></next>`;
    }

    const afterPurchaseXml = `
  <block type="after_purchase" id="ap1" x="714" y="292">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if" id="ap_if1">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0"><block type="logic_compare" id="ap_lc1"><field name="OP">GT</field><value name="A"><block type="read_details" id="ap_rd1"><field name="DETAIL_INDEX_LIST">4</field></block></value><value name="B"><block type="math_number" id="ap_mn1"><field name="NUM">0</field></block></value></block></value>
        <statement name="DO0">${winChain}</statement>
        <statement name="ELSE">${lossChain}</statement>
      </block>${loop ? `
      <block type="trade_again" id="ta1"><field name="TRADE_AGAIN">1</field></block>` : ''}
    </statement>
  </block>`;

    // ── ASSEMBLE ──
    return `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    ${allVars.join('\n    ')}
  </variables>
  <block type="trade_definition" id="td1" deletable="false" x="0" y="0">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="m1" deletable="false" movable="false">
        <field name="MARKET_LIST">${market}</field>
        <field name="SUBMARKET_LIST">${submarket}</field>
        <field name="SYMBOL_LIST">${symbol}</field>
        <next><block type="trade_definition_tradetype" id="tt1" deletable="false" movable="false">
          <field name="TRADETYPECAT_LIST">digits</field>
          <field name="TRADETYPE_LIST">${tradetype}</field>
          <next><block type="trade_definition_contracttype" id="ct1" deletable="false" movable="false">
            <field name="TYPE_LIST">${type}</field>
            <next><block type="trade_definition_candleinterval" id="ci1" deletable="false" movable="false">
              <field name="CANDLEINTERVAL_LIST">${candleInterval}</field>
              <next><block type="trade_definition_restartbuysell" id="rbs1" deletable="false" movable="false">
                <field name="TIME_MACHINE_ENABLED">FALSE</field>
                <next><block type="trade_definition_restartonerror" id="roe1" deletable="false" movable="false">
                  <field name="RESTARTONERROR">${restartOnError ? 'TRUE' : 'FALSE'}</field>
                </block></next>
              </block></next>
            </block></next>
          </block></next>
        </block></next>
      </block>
    </statement>
    <statement name="INITIALIZATION">${initChain}</statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="so1">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="true" vh_enabled="false"></mutation>
        <field name="DURATIONTYPE_LIST">${durationUnit}</field>
        <field name="VIRTUAL_HOOK_ENABLED">FALSE</field>
        <field name="BULK_TRADE_ENABLED">FALSE</field>
        <value name="DURATION"><shadow type="math_number_positive" id="d1"><field name="NUM">${duration}</field></shadow></value>
        <value name="AMOUNT">${varGet('so_am', 'stake', 'Current Stake')}</value>
        <value name="PREDICTION">
          <shadow type="math_number_positive" id="d2"><field name="NUM">${recEnabled ? normalBarrier : normalBarrier}</field></shadow>
          ${recEnabled ? varGet('so_pr', 'current_barrier', 'Current Barrier') : ''}
        </value>
      </block>
    </statement>
  </block>${tickAnalysisXml}${beforePurchaseXml}${afterPurchaseXml}
</xml>`;}

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
    const lastRequestTime = useRef<number>(0);

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
        let text = (typeof overrideText === 'string' ? overrideText : input).trim();
        if (!text || loading) return;

        // Cooldown: Groq free tier = 7000 input tokens/min. Enforce 60s gap.
        const now = Date.now();
        if (lastRequestTime.current && now - lastRequestTime.current < 60000) {
            const wait = Math.ceil((60000 - (now - lastRequestTime.current)) / 1000);
            setError(`Please wait ${wait}s before sending another request (Groq rate limit).`);
            return;
        }
        lastRequestTime.current = now;

        const userMsg: ChatMessage = { role: 'user', content: text };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);
        setError('');
        setGeneratedXml('');

        try {
            // Build conversation for AI — keep payload minimal to stay under 7000 ITPM
            // Token budget: ~5000 (system) + ~200 (history) + ~200 (user) = ~5400. Under 7000 ITPM.
            const MAX_INPUT_CHARS = 2000;
            if (text.length > MAX_INPUT_CHARS) {
                addLog(`⚠️ Strategy truncated to ${MAX_INPUT_CHARS} chars to fit Groq limits.`, 'warn');
                text = text.slice(0, MAX_INPUT_CHARS) + '...';
            }

            const recentHistory = messages.slice(-2).map(m => ({ role: m.role, content: m.content }));
            const chatMessages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...recentHistory,
                { role: 'user', content: text },
            ];

            const response = await callGroq(chatMessages);
            console.log('[BuildBot] AI raw response:', response);
            let xml = extractXml(response);

            // If no XML found, try extracting a JSON bot spec and building XML from it
            if (!xml) {
                console.log('[BuildBot] No XML found, trying JSON extraction');
                const jsonMatch = response.match(/```json\s*([\s\S]*?)```/) || response.match(/\{[\s\S]*"symbol"[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        const spec = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                        console.log('[BuildBot] Parsed JSON spec:', JSON.stringify(spec));
                        xml = buildBotXml(spec);
                        console.log('[BuildBot] Built XML from spec, length:', xml?.length);
                    } catch (e) { console.log('[BuildBot] JSON parse failed:', e); }
                }
                // Also try the whole response as JSON
                if (!xml) {
                    try {
                        const spec = JSON.parse(response);
                        if (spec.symbol || spec.tradetype) {
                            console.log('[BuildBot] Parsed whole-response JSON:', JSON.stringify(spec));
                            xml = buildBotXml(spec);
                        }
                    } catch {}
                }
            } else {
                console.log('[BuildBot] Found XML in response, length:', xml.length);
            }

            // Fill empty Deriv Bot XML fields so the bot always has text (notification, description, label).
            const filledXml = xml
                ? xml
                    .replace(/<field name="display_name"><\/field>/gi, '<field name="display_name">Custom Bot</field>')
                    .replace(/<field name="description"><\/field>/gi, '<field name="description">Built with AI</field>')
                    .replace(/<field name="label"><\/field>/gi, '<field name="label">Trade</field>')
                : null;

            const questions = parseQuestions(response);
            const content = questions ? stripQuestions(response) : response;
            // Strip embedded XML from the stored message text (kept separately in `xml`),
            // so history doesn't re-send full bot dumps and blow the Groq token limit.
            const cleanContent = content.replace(/```xml\s*[\s\S]*?```/g, '[XML omitted]');

            const assistantMsg: ChatMessage = {
                role: 'assistant',
                content: cleanContent,
                xml: filledXml || undefined,
                questions: questions || undefined,
            };
            setMessages(prev => [...prev, assistantMsg]);

            if (filledXml) {
                setGeneratedXml(filledXml);
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

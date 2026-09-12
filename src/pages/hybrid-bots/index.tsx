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

## HOW TO ASK QUESTIONS (IMPORTANT):
When you need more details before building, end your reply with a questions block in EXACTLY this format:

[QUESTIONS]
Q: Which symbol do you want to trade?
- R_50
- R_100
- 1HZ100V
Q: What stake per trade?
- 0.35
- 0.50
- 1.00
Q: What recovery after a loss?
- None
- Double stake (martingale x2)
- Switch to safer barrier
[/QUESTIONS]

RULES:
- Each question line starts with "Q: " (exactly one space after the colon)
- Each option line starts with "- " (dash + one space)
- Provide 2-4 options per question ALWAYS — never ask a question with no options
- Include the most likely/common choices as options
- If you need a numeric value, give sensible default options (e.g. stakes: 0.35, 0.50, 1.00)
- The user will CLICK one option per question (they do NOT type), so every question MUST have options
- You may add a short intro text before the block (e.g. "A few quick choices:"), but the block itself must be exactly as shown
- When you have all the answers you need, STOP asking and build the bot

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

## FIELD VALUES (use these EXACT values and field names):

MARKET_LIST: synthetic_index, forex, commodities, indices, stocks
SUBMARKET_LIST: random_index, major_pairs, minor_pairs, exotic_pairs, etc.
SYMBOL_LIST: R_10, R_25, R_50, R_75, R_100, 1HZ10V, 1HZ25V, 1HZ50V, 1HZ75V, 1HZ100V
TRADETYPECAT_LIST: callput, digits, touchnotouch, rises_falls, endsinouts, staysinouts, multiders
TRADETYPE_LIST: callput, callputeuropean, overunder (digits Over/Under), matchesdiffers (digits Matches/Differs), touchnotouch, etc.
TYPE_LIST: both, call, put, DIGITMATCH, DIGITDIFF, DIGITOVER, DIGITUNDER, DIGITEVEN, DIGITODD, CALL, PUT, RUNHIGH, RUNLOW
DURATIONTYPE_LIST: t (tick), m (minute), h (hour), d (day)
CANDLEINTERVAL_LIST: 60, 300, 900, 1800, 3600
PURCHASE_LIST: CALL, PUT, DIGITMATCH, DIGITDIFF, DIGITOVER, DIGITUNDER, RUNHIGH, RUNLOW
DETAIL_INDEX (read_details - in XML use the NUMBER): 1=deal reference id, 2=purchase price, 3=payout, 4=profit, 5=contract type, 6=entry spot time, 7=entry spot price, 8=exit spot time, 9=exit spot price, 10=barrier, 11=result
CHECK_RESULT (contract_check_result): win, loss
COMPARE_OP: EQ, NEQ, LT, LTE, GT, GTE
MATH_OP: ADD, MINUS, MULTIPLY, DIVIDE, POWER, MOD
LOGIC_OP: AND, OR
BOOLEAN: TRUE, FALSE
STAT_TYPE: average, count, sum, minimum, maximum
DIRECTION: both, forwards, backwards
OHLC_FIELD: open, high, low, close

For DIGIT OVER/UNDER bots: TRADETYPECAT_LIST=digits, TRADETYPE_LIST=overunder, TYPE_LIST=both. The actual contract bought is chosen by the purchase block's PURCHASE_LIST (DIGITOVER or DIGITUNDER).

## COMPLETE WORKING EXAMPLE - Digit Over/Under bot with Martingale Recovery and variables.
This is the reference structure. Variables are DECLARED in a <variables> block at the very
top of the XML (before any blocks) and referenced by their id in every variables_get/set.
The trade_definition block has THREE statements: TRADE_OPTIONS (market/tradetype/contracttype
chain), INITIALIZATION (run-once: set initial variable values), SUBMARKET (duration + amount +
prediction). Amount and prediction read VARIABLES so the after_purchase logic can change stake
and switch prediction between normal mode and recovery mode.

\`\`\`xml
<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="init_stake_var">Initial Stake</variable>
    <variable id="stake_var">Current Stake</variable>
    <variable id="mart_factor_var">Martingale Factor</variable>
    <variable id="pred_var">prediction</variable>
    <variable id="normal_pred_var">Normal Prediction</variable>
    <variable id="recovery_pred_var">Recovery Prediction</variable>
    <variable id="is_recovery_var">is_recovery</variable>
    <variable id="total_profit_var">Total Profit</variable>
    <variable id="first_trade_var">First Trade Done</variable>
    <variable id="tp_var">Target Profit</variable>
    <variable id="sl_var">Stop Loss</variable>
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
        <field name="VAR" id="init_stake_var">Initial Stake</field>
        <value name="VALUE">
          <block type="math_number" id="n1">
            <field name="NUM">1</field>
          </block>
        </value>
        <next>
          <block type="variables_set" id="ini2">
            <field name="VAR" id="mart_factor_var">Martingale Factor</field>
            <value name="VALUE">
              <block type="math_number" id="n2">
                <field name="NUM">2</field>
              </block>
            </value>
            <next>
              <block type="variables_set" id="ini3">
                <field name="VAR" id="normal_pred_var">Normal Prediction</field>
                <value name="VALUE">
                  <block type="math_number" id="n3">
                    <field name="NUM">7</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="ini4">
                    <field name="VAR" id="recovery_pred_var">Recovery Prediction</field>
                    <value name="VALUE">
                      <block type="math_number" id="n4">
                        <field name="NUM">4</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="ini5">
                        <field name="VAR" id="tp_var">Target Profit</field>
                        <value name="VALUE">
                          <block type="math_number" id="n5">
                            <field name="NUM">10</field>
                          </block>
                        </value>
                        <next>
                          <block type="variables_set" id="ini6">
                            <field name="VAR" id="sl_var">Stop Loss</field>
                            <value name="VALUE">
                              <block type="math_number" id="n6">
                                <field name="NUM">50</field>
                              </block>
                            </value>
                            <next>
                              <block type="variables_set" id="ini7">
                                <field name="VAR" id="total_profit_var">Total Profit</field>
                                <value name="VALUE">
                                  <block type="math_number" id="n7">
                                    <field name="NUM">0</field>
                                  </block>
                                </value>
                                <next>
                                  <block type="variables_set" id="ini8">
                                    <field name="VAR" id="pred_var">prediction</field>
                                    <value name="VALUE">
                                      <block type="variables_get" id="g1">
                                        <field name="VAR" id="normal_pred_var">Normal Prediction</field>
                                      </block>
                                    </value>
                                    <next>
                                      <block type="variables_set" id="ini9">
                                        <field name="VAR" id="stake_var">Current Stake</field>
                                        <value name="VALUE">
                                          <block type="variables_get" id="g2">
                                            <field name="VAR" id="init_stake_var">Initial Stake</field>
                                          </block>
                                        </value>
                                        <next>
                                          <block type="variables_set" id="ini10">
                                            <field name="VAR" id="is_recovery_var">is_recovery</field>
                                            <value name="VALUE">
                                              <block type="logic_boolean" id="b1">
                                                <field name="BOOL">FALSE</field>
                                              </block>
                                            </value>
                                            <next>
                                              <block type="variables_set" id="ini11">
                                                <field name="VAR" id="first_trade_var">First Trade Done</field>
                                                <value name="VALUE">
                                                  <block type="logic_boolean" id="b2">
                                                    <field name="BOOL">FALSE</field>
                                                  </block>
                                                </value>
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
      <block type="trade_definition_tradeoptions" id="so1">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="true" vh_enabled="false"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <field name="VIRTUAL_HOOK_ENABLED">FALSE</field>
        <field name="BULK_TRADE_ENABLED">FALSE</field>
        <value name="DURATION">
          <shadow type="math_number_positive" id="d1">
            <field name="NUM">1</field>
          </shadow>
        </value>
        <value name="AMOUNT">
          <block type="variables_get" id="g3">
            <field name="VAR" id="stake_var">Current Stake</field>
          </block>
        </value>
        <value name="PREDICTION">
          <shadow type="math_number_positive" id="d2">
            <field name="NUM">1</field>
          </shadow>
          <block type="variables_get" id="g4">
            <field name="VAR" id="pred_var">prediction</field>
          </block>
        </value>
      </block>
    </statement>
  </block>
  <block type="during_purchase" id="dp1" x="714" y="0">
    <statement name="DURING_PURCHASE_STACK">
      <block type="controls_if" id="if1">
        <value name="IF0">
          <block type="check_sell" id="cs1"></block>
        </value>
      </block>
    </statement>
  </block>
  <block type="before_purchase" id="bp1" deletable="false" x="0" y="700">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="controls_if" id="if2">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0">
          <block type="logic_compare" id="lc1">
            <field name="OP">EQ</field>
            <value name="A">
              <block type="variables_get" id="g5">
                <field name="VAR" id="is_recovery_var">is_recovery</field>
              </block>
            </value>
            <value name="B">
              <block type="logic_boolean" id="b3">
                <field name="BOOL">FALSE</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="purchase" id="p1">
            <field name="PURCHASE_LIST">DIGITUNDER</field>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="purchase" id="p2">
            <field name="PURCHASE_LIST">DIGITOVER</field>
          </block>
        </statement>
      </block>
    </statement>
  </block>
  <block type="after_purchase" id="ap1" x="714" y="292">
    <statement name="AFTERPURCHASE_STACK">
      <block type="variables_set" id="total1">
        <field name="VAR" id="total_profit_var">Total Profit</field>
        <value name="VALUE">
          <block type="math_arithmetic" id="ma1">
            <field name="OP">ADD</field>
            <value name="A">
              <block type="variables_get" id="g6">
                <field name="VAR" id="total_profit_var">Total Profit</field>
              </block>
            </value>
            <value name="B">
              <block type="read_details" id="rd1">
                <field name="DETAIL_INDEX">4</field>
              </block>
            </value>
          </block>
        </value>
        <next>
          <block type="controls_if" id="if3">
            <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
            <value name="IF0">
              <block type="contract_check_result" id="ccr1">
                <field name="CHECK_RESULT">win</field>
              </block>
            </value>
            <statement name="DO0">
              <block type="variables_set" id="win1">
                <field name="VAR" id="stake_var">Current Stake</field>
                <value name="VALUE">
                  <block type="variables_get" id="g7">
                    <field name="VAR" id="init_stake_var">Initial Stake</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="win2">
                    <field name="VAR" id="pred_var">prediction</field>
                    <value name="VALUE">
                      <block type="variables_get" id="g8">
                        <field name="VAR" id="normal_pred_var">Normal Prediction</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="win3">
                        <field name="VAR" id="is_recovery_var">is_recovery</field>
                        <value name="VALUE">
                          <block type="logic_boolean" id="b4">
                            <field name="BOOL">FALSE</field>
                          </block>
                        </value>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </statement>
            <statement name="ELSE">
              <block type="variables_set" id="loss1">
                <field name="VAR" id="stake_var">Current Stake</field>
                <value name="VALUE">
                  <block type="math_arithmetic" id="ma2">
                    <field name="OP">MULTIPLY</field>
                    <value name="A">
                      <block type="variables_get" id="g9">
                        <field name="VAR" id="stake_var">Current Stake</field>
                      </block>
                    </value>
                    <value name="B">
                      <block type="variables_get" id="g10">
                        <field name="VAR" id="mart_factor_var">Martingale Factor</field>
                      </block>
                    </value>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="loss2">
                    <field name="VAR" id="pred_var">prediction</field>
                    <value name="VALUE">
                      <block type="variables_get" id="g11">
                        <field name="VAR" id="recovery_pred_var">Recovery Prediction</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="loss3">
                        <field name="VAR" id="is_recovery_var">is_recovery</field>
                        <value name="VALUE">
                          <block type="logic_boolean" id="b5">
                            <field name="BOOL">TRUE</field>
                          </block>
                        </value>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </statement>
          </block>
          <block type="trade_again" id="ta1"></block>
        </next>
      </block>
    </statement>
  </block>
</xml>
\`\`\`

## VARIABLES & MARTINGALE EXAMPLE (how to create and use variables):

To create a variable, use variables_set. To read it later, use variables_get.
The VAR field is the variable NAME as a plain string (e.g. "stake"). Every variables_get
must reference a variable that was set somewhere in the bot first.

\`\`\`xml
<!-- Set a variable named "stake" to 0.35 -->
<block type="variables_set" id="v1">
  <field name="VAR">stake</field>
  <value name="VALUE">
    <block type="math_number" id="v2">
      <field name="NUM">0.35</field>
    </block>
  </value>
</block>

<!-- Read the variable: get "stake", use it in math (stake * 2 for martingale) -->
<block type="variables_set" id="v3">
  <field name="VAR">stake</field>
  <value name="VALUE">
    <block type="math_arithmetic" id="v4">
      <field name="OP">MULTIPLY</field>
      <value name="A">
        <block type="variables_get" id="v5">
          <field name="VAR">stake</field>
        </block>
      </value>
      <value name="B">
        <block type="math_number" id="v6">
          <field name="NUM">2</field>
        </block>
      </value>
    </block>
  </value>
</block>

<!-- Compare variable to a number -->
<block type="logic_compare" id="v7">
  <field name="OP">GT</field>
  <value name="A">
    <block type="variables_get" id="v8">
      <field name="VAR">stake</field>
    </block>
  </value>
  <value name="B">
    <block type="math_number" id="v9">
      <field name="NUM">2.8</field>
    </block>
  </value>
</block>

<!-- Notify / log text: join strings with variables -->
<block type="notify" id="n1">
  <field name="NOTIFICATION_TYPE">info</field>
  <field name="NOTIFICATION_SOUND">silent</field>
  <value name="MESSAGE">
    <block type="text_join" id="n2">
      <mutation items="3"></mutation>
      <value name="ADD0">
        <block type="text" id="n3">
          <field name="TEXT">Stake is now </field>
        </block>
      </value>
      <value name="ADD1">
        <block type="variables_get" id="n4">
          <field name="VAR">stake</field>
        </block>
      </value>
      <value name="ADD2">
        <block type="text" id="n5">
          <field name="TEXT"> USD</field>
        </block>
      </value>
    </block>
  </value>
</block>
\`\`\`

## HOW EACH BLOCK WORKS:

### trade_definition_tradeoptions:
- DURATIONTYPE_LIST: "t" for ticks, "m" for minutes, "h" for hours
- DURATION: number of ticks/minutes/hours
- AMOUNT: stake amount (decimal allowed). Read a variable (variables_get) so recovery can change stake.
- PREDICTION: digit for DIGITMATCH/DIGITDIFF/DIGITOVER/DIGITUNDER. Read a variable (variables_get) so recovery can change prediction.
- The <mutation> on this block MUST have has_prediction="true" when the contract needs a prediction digit.

### read_details:
- DETAIL_INDEX: MUST be a NUMBER. Use 4 = profit. Positive = win, negative = loss.
- Other indices: 1=deal reference id, 2=purchase price, 3=payout, 5=contract type, 6=entry spot time, 7=entry spot price, 8=exit spot time, 9=exit spot price, 10=barrier, 11=result

### contract_check_result:
- Field name is CHECK_RESULT with value "win" or "loss" (this block tells you the last trade result)
- Returns a Boolean you put directly in a controls_if IF0 condition
- Do NOT change the amount/prediction with trade_option - there is no such block. Change variables instead.

### variables_set:
- <field name="VAR" id="varId">Variable Name</field> - id MUST match a <variable id="..."> declared in the top <variables> block
- VALUE: the value to assign

### variables_get:
- <field name="VAR" id="varId">Variable Name</field> - same id/name as declared

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
□ EVERY variable used in variables_set/get is DECLARED in the top <variables> block, and the id matches
□ All variables are initialized in the trade_definition INITIALIZATION statement
□ read_details uses numeric DETAIL_INDEX (4 = profit)
□ All math_number blocks have NUM field
□ All text blocks have TEXT field
□ All logic_compare blocks have OP, A, B
□ All controls_if blocks have IF0 condition
□ No empty strings or placeholders

## REQUIRED BOT STRUCTURE — a complete bot ALWAYS has these areas arranged at distinct x,y coordinates:
1. trade_definition (x=0, y=0) with the FULL nested chain in TRADE_OPTIONS:
   market → tradetype → contracttype → candleinterval → restartbuysell → restartonerror,
   and a SUBMARKET statement holding trade_definition_tradeoptions (duration + amount + prediction/barrier)
2. tick_analysis (or before_purchase) area for any setup/entry logic (x=350, y=60) — set variables, compute stakes, conditions
3. before_purchase (x=0, y=658) with a purchase block (PURCHASE_LIST matching the contract type)
4. during_purchase (x=714, y=60) with check_sell → if it returns TRUE, sell via sell_at_market
5. after_purchase (x=714, y=292):
   - Decide win/loss with contract_check_result (fields: win, loss, draw) or read_details (profit > 0)
   - On LOSS: increase the stake variable (martingale), switch barrier if recovery, notify the user
   - On WIN: reset the stake variable back to base, notify the user
   - END with trade_again so the bot loops continuously

## COMPLEX STRATEGY RULES:
- Any value that changes over time (stake, prediction, is_recovery, total profit, loss-count, martingale level) MUST be a variable
- Initialize variables in the trade_definition INITIALIZATION statement (runs once at start)
- Do the martingale/recovery logic in after_purchase: on win reset stake to initial + is_recovery=FALSE + prediction=normal; on loss multiply stake by martingale factor + is_recovery=TRUE + prediction=recovery
- The SUBMARKET amount/prediction must READ variables (variables_get) so they change every trade
- Use notify or text_print to report each trade result; use text_join to combine text with variables
- If you need conditions, nest logic_compare inside controls_if IF0. For win/loss, use contract_check_result
- Always double the stake on loss ×2 (martingale) unless the user specifies another multiplier

## Output Format:
- When asking questions: respond naturally
- When generating XML: return ONLY valid XML in \`\`\`xml ... \`\`\`
- Build the ENTIRE bot in ONE response — every area above must be present
- The XML must be COMPLETE and LOADABLE into Deriv Bot Builder`;

async function callGroq(messages: any[]): Promise<string> {
    try {
        const res = await fetch('/api/groq', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages,
                temperature: 0.3,
                max_tokens: 8192,
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
        const text = (overrideText ?? input).trim();
        if (!text || loading) return;

        const userMsg: ChatMessage = { role: 'user', content: text };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);
        setError('');

        try {
            // Build conversation for AI (trim old history to avoid token limits)
            const recentHistory = messages.slice(-6).map(m => ({ role: m.role, content: m.content }));
            const chatMessages = [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `Here is the current bot XML:\n\`\`\`xml\n${generatedXml || DEFAULT_BOT_XML}\n\`\`\`` },
                ...recentHistory,
                { role: 'user', content: text },
            ];

            const response = await callGroq(chatMessages);
            const xml = extractXml(response);
            const questions = parseQuestions(response);
            const cleanContent = questions ? stripQuestions(response) : response;

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
});

export default BuildBot;

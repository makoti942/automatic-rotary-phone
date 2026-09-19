import React, { useCallback, useRef, useState, useEffect } from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS, PIP_SIZES, openMakotiWS, MakotiWS } from './makoti-ws';
import { onNewSystemMessage } from '@/auth/NewDerivAuth';
import { MwSelect } from './mw-select';
import DBotStore from '@/external/bot-skeleton/scratch/dbot-store';

const ENTRY_BOT_TEMPLATE = `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="^6#nw2SaD1$YyI2F;/K;">text</variable>
    <variable id="initStakeVar">Initial Stake</variable>
    <variable id="total_profit">Total Profit</variable>
    <variable id="martFactorVar">Martingale Factor</variable>
    <variable id="stakeVar">Current Stake</variable>
    <variable id="Y5/XSGh1;v85;8*pTo7c">prediction</variable>
    <variable id="first_trade_done">First Trade Done</variable>
    <variable id="normal_pred_var">Normal Prediction</variable>
    <variable id="recovery_pred_var">Recovery Prediction</variable>
    <variable id="is_recovery_var">is_recovery</variable>
    <variable id="entry_digit">Entry Digit</variable>
    <variable id="tp">Target Profit</variable>
    <variable id="sl">Stop Loss</variable>
    <variable id="initializedVar">Martingale Initialized</variable>
  </variables>
  <block type="trade_definition" id="}F,4#Sa]HciWV~Jye~gS" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="O=Zr3]zqZ|*|,(##^,4c" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">__SYMBOL__</field>
        <next>
          <block type="trade_definition_tradetype" id="i40q+Oi2S.]BY-XJFe9^" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">digits</field>
            <field name="TRADETYPE_LIST">overunder</field>
            <next>
              <block type="trade_definition_contracttype" id="LK05VSNer$#lcXas8F@e" deletable="false" movable="false">
                <field name="TYPE_LIST">both</field>
                <next>
                  <block type="trade_definition_candleinterval" id="` + '`nkOFF!xRr2R8Ezn7K9n' + `" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="T-9x~q$,1Ey3?SzFdNq#" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="UaD8ITktDA15Ca1).)ah" deletable="false" movable="false">
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
      <block type="variables_set" id="setInitialStakeValue">
        <field name="VAR" id="initStakeVar">Initial Stake</field>
        <value name="VALUE">
                <block type="math_number" id="initialStakeValue">
                    <field name="NUM">__STAKE__</field>
          </block>
        </value>
        <next>
          <block type="variables_set" id="setMartingaleFactor">
            <field name="VAR" id="martFactorVar">Martingale Factor</field>
            <value name="VALUE">
              <block type="math_number" id="martFactorValue">
                <field name="NUM">2</field>
              </block>
            </value>
            <next>
              <block type="variables_set" id="setNormalPred">
                <field name="VAR" id="normal_pred_var">Normal Prediction</field>
                <value name="VALUE">
                  <block type="math_number" id="+0EAx;9?l]rH{O0/1hR=">
                    <field name="NUM">__NORMAL_PRED__</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="setRecoveryPred">
                    <field name="VAR" id="recovery_pred_var">Recovery Prediction</field>
                    <value name="VALUE">
                      <block type="math_number" id="7:(PiLkUR8q3fW_XG)=1">
                        <field name="NUM">5</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="setEntryDigit">
                        <field name="VAR" id="entry_digit">Entry Digit</field>
                        <value name="VALUE">
                          <block type="math_number" id="Ozejkz7EJvDFP9jt]*]z">
                            <field name="NUM">__ENTRY_DIGIT__</field>
                          </block>
                        </value>
                        <next>
                          <block type="variables_set" id="$1%D(\`QsOR%}PvNX/SB!">
                            <field name="VAR" id="Y5/XSGh1;v85;8*pTo7c">prediction</field>
                            <value name="VALUE">
                              <block type="variables_get" id="uhLXGL;h}k/!fYrY%s+g">
                                <field name="VAR" id="normal_pred_var">Normal Prediction</field>
                              </block>
                            </value>
                            <next>
                              <block type="variables_set" id="setTargetProfit">
                                <field name="VAR" id="tp">Target Profit</field>
                                <value name="VALUE">
                                  <block type="math_number" id="Fp@weP]m3}8FM?!ZUkU%">
                                    <field name="NUM">__TAKE_PROFIT__</field>
                                  </block>
                                </value>
                                <next>
                                  <block type="variables_set" id="setStopLoss">
                                    <field name="VAR" id="sl">Stop Loss</field>
                                    <value name="VALUE">
                                      <block type="math_number" id="rM5S%;hX_EE$28Xl#dtG">
                                        <field name="NUM">__STOP_LOSS__</field>
                                      </block>
                                    </value>
                                    <next>
                                      <block type="variables_set" id="setTotalProfit" collapsed="true">
                                        <field name="VAR" id="total_profit">Total Profit</field>
                                        <value name="VALUE">
                                          <block type="math_number" id="4*4-LHcQtmXex^lp]*PM">
                                            <field name="NUM">0</field>
                                          </block>
                                        </value>
                                        <next>
                                          <block type="variables_set" id="setFirstTradeDone" collapsed="true">
                                            <field name="VAR" id="first_trade_done">First Trade Done</field>
                                            <value name="VALUE">
                                              <block type="logic_boolean" id="D!yw{m7IWMs1uF]G]@Bd">
                                                <field name="BOOL">FALSE</field>
                                              </block>
                                            </value>
                                            <next>
                                              <block type="variables_set" id="markInitialized" collapsed="true">
                                                <field name="VAR" id="initializedVar">Martingale Initialized</field>
                                                <value name="VALUE">
                                                  <block type="logic_boolean" id="initializedTrue">
                                                    <field name="BOOL">TRUE</field>
                                                  </block>
                                                </value>
                                                <next>
                                                  <block type="variables_set" id="setCurrentStakeInitial" collapsed="true">
                                                    <field name="VAR" id="stakeVar">Current Stake</field>
                                                    <value name="VALUE">
                                                      <block type="variables_get" id="getInitialStake">
                                                        <field name="VAR" id="initStakeVar">Initial Stake</field>
                                                      </block>
                                                    </value>
                                                    <next>
                                                      <block type="variables_set" id="setIsRecovery" collapsed="true">
                                                        <field name="VAR" id="is_recovery_var">is_recovery</field>
                                                        <value name="VALUE">
                                                          <block type="logic_boolean" id="D^h5FipZ~WD=;#p_gg?N">
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
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="/6=T~KI\`X+mn5$|K,]tI">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="true" vh_enabled="false"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <field name="VIRTUAL_HOOK_ENABLED">FALSE</field>
        <field name="BULK_TRADE_ENABLED">FALSE</field>
        <value name="DURATION">
          <shadow type="math_number_positive" id="T8\`V0lfU%!:y1+zCGft1">
            <field name="NUM">1</field>
          </shadow>
        </value>
        <value name="AMOUNT">
          <block type="variables_get" id="getStakeAmount">
            <field name="VAR" id="stakeVar">Current Stake</field>
          </block>
        </value>
        <value name="PREDICTION">
          <shadow type="math_number_positive" id="5@![w:8{U1\`h/%,(o8n(" inline="true">
            <field name="NUM">1</field>
          </shadow>
          <block type="variables_get" id="Cene|SE6T:[5DbOK\`J83">
            <field name="VAR" id="Y5/XSGh1;v85;8*pTo7c">prediction</field>
          </block>
        </value>
      </block>
    </statement>
  </block>
  <block type="during_purchase" id="+w,G6!xJ[/-nmPnseM#W" x="1034" y="60">
    <statement name="DURING_PURCHASE_STACK">
      <block type="controls_if" id="#V}P95eI72f!K:%T2~l_">
        <value name="IF0">
          <block type="check_sell" id="}59N!Q/\`.q~;0abDkIs#"></block>
        </value>
      </block>
    </statement>
  </block>
  <block type="after_purchase" id="c;hEA7}nM@_,g?5*L(=e" x="1034" y="292">
    <statement name="AFTERPURCHASE_STACK">
      <block type="variables_set" id="updateTotalProfit">
        <field name="VAR" id="total_profit">Total Profit</field>
        <value name="VALUE">
          <block type="math_arithmetic" id="addProfit">
            <field name="OP">ADD</field>
            <value name="A">
              <block type="variables_get" id="getTotalProfitA">
                <field name="VAR" id="total_profit">Total Profit</field>
              </block>
            </value>
            <value name="B">
              <block type="read_details" id="getContractProfit">
                <field name="DETAIL_INDEX">4</field>
              </block>
            </value>
          </block>
        </value>
        <next>
          <block type="controls_if" id="martingaleResultCheck">
            <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
            <value name="IF0">
              <block type="contract_check_result" id="checkWinResult">
                <field name="CHECK_RESULT">win</field>
              </block>
            </value>
            <statement name="DO0">
              <block type="variables_set" id="resetStakeAfterWin">
                <field name="VAR" id="stakeVar">Current Stake</field>
                <value name="VALUE">
                  <block type="variables_get" id="getInitialStakeOnWin">
                    <field name="VAR" id="initStakeVar">Initial Stake</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="resetRecovery">
                    <field name="VAR" id="is_recovery_var">is_recovery</field>
                    <value name="VALUE">
                      <block type="logic_boolean" id="mT0S7Y0xat726shrm(cA">
                        <field name="BOOL">FALSE</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="resetPrediction">
                        <field name="VAR" id="Y5/XSGh1;v85;8*pTo7c">prediction</field>
                        <value name="VALUE">
                          <block type="variables_get" id=",5DgI1~^8~V?u}7{Z$Nk">
                            <field name="VAR" id="normal_pred_var">Normal Prediction</field>
                          </block>
                        </value>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </statement>
            <statement name="ELSE">
              <block type="variables_set" id="increaseStakeAfterLoss">
                <field name="VAR" id="stakeVar">Current Stake</field>
                <value name="VALUE">
                  <block type="math_arithmetic" id="multiplyStakeByFactor">
                    <field name="OP">MULTIPLY</field>
                    <value name="A">
                      <shadow type="math_number" id="stakeShadow">
                        <field name="NUM">1</field>
                      </shadow>
                      <block type="variables_get" id="getCurrentStakeForMultiply">
                        <field name="VAR" id="stakeVar">Current Stake</field>
                      </block>
                    </value>
                    <value name="B">
                      <shadow type="math_number" id="factorShadow">
                        <field name="NUM">2</field>
                      </shadow>
                      <block type="variables_get" id="getMartingaleFactor">
                        <field name="VAR" id="martFactorVar">Martingale Factor</field>
                      </block>
                    </value>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="setRecovery">
                    <field name="VAR" id="is_recovery_var">is_recovery</field>
                    <value name="VALUE">
                      <block type="logic_boolean" id="HF(2UU5\`,6?ynX7@0?(M">
                        <field name="BOOL">TRUE</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="setRecoveryPrediction">
                        <field name="VAR" id="Y5/XSGh1;v85;8*pTo7c">prediction</field>
                        <value name="VALUE">
                          <block type="variables_get" id="j_]jtwpDTR{#1P*mHFE3">
                            <field name="VAR" id="recovery_pred_var">Recovery Prediction</field>
                          </block>
                        </value>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </statement>
            <next>
              <block type="controls_if" id="checkTPSL">
                <mutation xmlns="http://www.w3.org/1999/xhtml" elseif="1" else="1"></mutation>
                <value name="IF0">
                  <block type="logic_compare" id="compareTP">
                    <field name="OP">GTE</field>
                    <value name="A">
                      <block type="variables_get" id="getTotalProfitTP">
                        <field name="VAR" id="total_profit">Total Profit</field>
                      </block>
                    </value>
                    <value name="B">
                      <block type="variables_get" id="getTP">
                        <field name="VAR" id="tp">Target Profit</field>
                      </block>
                    </value>
                  </block>
                </value>
                <statement name="DO0">
                  <block type="text_print" id="printTP">
                    <value name="TEXT">
                      <block type="text" id="9JNhfx#$PxDW75.((^Tu">
                        <field name="TEXT">take profit hit</field>
                      </block>
                    </value>
                  </block>
                </statement>
                <value name="IF1">
                  <block type="logic_compare" id="compareSL">
                    <field name="OP">LTE</field>
                    <value name="A">
                      <block type="variables_get" id="getTotalProfitSL">
                        <field name="VAR" id="total_profit">Total Profit</field>
                      </block>
                    </value>
                    <value name="B">
                      <block type="math_single" id="negateSL">
                        <field name="OP">NEG</field>
                        <value name="NUM">
                          <block type="variables_get" id="getSL">
                            <field name="VAR" id="sl">Stop Loss</field>
                          </block>
                        </value>
                      </block>
                    </value>
                  </block>
                </value>
                <statement name="DO1">
                  <block type="text_print" id="printSL">
                    <value name="TEXT">
                      <block type="text" id="slText">
                        <field name="TEXT">Stop Loss Hit</field>
                      </block>
                    </value>
                  </block>
                </statement>
                <statement name="ELSE">
                  <block type="trade_again" id="G=znPPs6=xtZA|o(KBQX"></block>
                </statement>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
  </block>
  <block type="before_purchase" id="D_FIc+E9*cr|grV8}?n?" deletable="false" x="0" y="1264">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="controls_if" id="checkEntryCondition">
        <value name="IF0">
          <block type="logic_operation" id="orCondition">
            <field name="OP">OR</field>
            <value name="A">
              <block type="logic_compare" id="isFirstTradeDone">
                <field name="OP">EQ</field>
                <value name="A">
                  <block type="variables_get" id="9EtEqsYO\`|b7=3Sg!MjX">
                    <field name="VAR" id="first_trade_done">First Trade Done</field>
                  </block>
                </value>
                <value name="B">
                  <block type="logic_boolean" id="EU)Jw)jT3[([d#s\`5BNz">
                    <field name="BOOL">TRUE</field>
                  </block>
                </value>
              </block>
            </value>
            <value name="B">
              <block type="logic_compare" id="compareDigit">
                <field name="OP">EQ</field>
                <value name="A">
                  <block type="last_digit" id="getLastDigit"></block>
                </value>
                <value name="B">
                  <block type="variables_get" id="getEntryDigit">
                    <field name="VAR" id="entry_digit">Entry Digit</field>
                  </block>
                </value>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="variables_set" id="markFirstTradeDone">
            <field name="VAR" id="first_trade_done">First Trade Done</field>
            <value name="VALUE">
              <block type="logic_boolean" id="qiUsUt/MLSb/fE$\{fQgu">
                <field name="BOOL">TRUE</field>
              </block>
            </value>
            <next>
              <block type="controls_if" id="checkRecoveryPurchase">
                <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
                <value name="IF0">
                  <block type="logic_compare" id="compareIsRecovery">
                    <field name="OP">EQ</field>
                    <value name="A">
                      <block type="variables_get" id="i5_IE{q2r8~RBa1~r!q,">
                        <field name="VAR" id="is_recovery_var">is_recovery</field>
                      </block>
                    </value>
                    <value name="B">
                      <block type="logic_boolean" id="M@15MjSpUG$7=w~=Mu_/">
                        <field name="BOOL">FALSE</field>
                      </block>
                    </value>
                  </block>
                </value>
                <statement name="DO0">
                  <block type="purchase" id="og/YYS3nvV1*r61Co/hE">
                    <field name="PURCHASE_LIST">__CONTRACT_TYPE__</field>
                  </block>
                </statement>
                <statement name="ELSE">
                  <block type="purchase" id="purchaseRecovery">
                    <field name="PURCHASE_LIST">__CONTRACT_TYPE__</field>
                  </block>
                </statement>
              </block>
            </next>
          </block>
        </statement>
      </block>
    </statement>
  </block>
</xml>`;

type BotId = 'pvty_kill' | 'rf_v4' | 'entry_digit';

interface SymbolDigitResult {
    symbol: string;
    label: string;
    pcts: number[];
    totalTicks: number;
    qualifies: boolean;
    detail: string;
}

interface SymbolDirectionResult {
    symbol: string;
    label: string;
    choppinessScore: number;
    bodyRatio: number;
    directionChanges: number;
    trendStrength: number;
    recentBodyRatio: number;
    qualifies: boolean;
    detail: string;
}

interface TriggerDigitResult {
    symbol: string;
    label: string;
    baselinePcts: number[];
    baselineWinPct: number;
    triggers: TriggerInfo[];
    qualifies: boolean;
    detail: string;
}

interface TriggerInfo {
    digit: number;
    occurrences: number;
    avgWinPctAfter: number;
    boost: number;
    consistency: number;
    windowSizes: { window: number; winPct: number; boost: number }[];
    digitShifts: { digit: number; before: number; after: number; shift: number }[];
    patternTrend: {
        olderBoost: number;
        recentBoost: number;
        olderOccurrences: number;
        recentOccurrences: number;
        trend: 'strengthening' | 'weakening' | 'stable' | 'new' | 'dying';
        trendPercent: number;
    };
    momentum: {
        winMomentum100: number;
        winMomentum50: number;
        winMomentum20: number;
        overallMomentum: number;
    };
    decayCurve: number[];
    bestEntryWindow: { start: number; end: number; peakWinPct: number };
    digitSurges: { digit: number; surgePct: number; count: number }[];
    confidence: number;
    digitPower: number[];
    // Tier 1 improvements
    zScore: number;         // statistical significance of boost
    pValue: number;         // probability boost is noise
    significance: 'high' | 'medium' | 'low' | 'none';
    triggerPower: number;   // how strong the trigger digit is in current market
    // Tier 2: Deep Digit Ecosystem Analysis
    trajectory: {
        slopes: number[];              // per-digit slope: positive=rising, negative=falling
        acceleration: number[];        // per-digit: is the slope itself changing?
        windows: number[][];           // [digit][window] = percentage in that 100-tick window
        stability: number[];           // per-digit: variance of trajectory (low=stable)
    };
    crossDigit: {
        matrix: number[][];            // [trigger][target] = influence score (-10 to +10)
        dominantEffects: number;       // count of digits significantly affected
        netEffect: number;             // net direction: positive = trigger promotes wins
    };
    dominance: {
        currentDominant: number;       // which digit is currently strongest (0-9)
        currentSuppressed: number;     // which digit is currently weakest (0-9)
        triggerRank: number;           // where trigger digit ranks (1=strongest)
        dominanceShift: number;        // positive = dominance shifting toward trigger
        suppressionRelief: number;     // how much suppressed digits rebound after trigger
    };
    predictive: {
        predictedBoost: number;        // what model predicts boost should be
        predictionAccuracy: number;    // how close prediction matches reality (0-100)
        forecastConfidence: number;    // how reliable the forecast is (0-100)
    };
    losingFilter: {
        pass: boolean;                 // did the filter pass?
        belowThreshold: number;        // how many losing digits are < 10%
        decreasing: number;            // how many losing digits have negative growth
        totalLosing: number;           // total losing digits
        growth: number[];              // per-digit growth (recent 30 vs overall 1000)
    };
    // Tier 3: New Engines
    generator: {
        patternStrength: number;       // 0-100: how predictable the digit sequence is
        cycleLength: number;           // detected cycle length (0 = no cycle)
        rhythmScore: number;           // 0-100: how rhythmic digit appearance is
        sequenceEntropy: number;       // 0-100: low entropy = predictable pattern
        afterTriggerPatterns: {        // what patterns appear after this trigger
            repeatRate: number;        // % of times the same digit follows trigger
            alternationRate: number;   // % of times a different digit follows trigger
            avgSequenceLength: number; // avg consecutive same-digit runs after trigger
        };
    };
    fullTick: {
        velocity: number;              // price rate of change (ticks per unit)
        acceleration: number;          // change in velocity
        volatility: number;            // price standard deviation
        trend: 'up' | 'down' | 'flat';
        trendStrength: number;         // 0-100: how strong the trend is
        priceRange: number;            // high - low in last 200 ticks
        momentumScore: number;         // 0-100: composite momentum score
    };
    distribution: {
        fillRate: number;              // how fast winning digits fill after trigger (0-100)
        concentration: number;         // 0-100: how concentrated the distribution is
        entropy: number;               // 0-100: high entropy = evenly spread (bad for us)
        winningMomentum: number;       // rate of change of winning digit %
        losingMomentum: number;        // rate of change of losing digit %
        balanceShift: number;          // positive = distribution shifting toward wins
    };
}

type ScanResult = SymbolDigitResult | SymbolDirectionResult | TriggerDigitResult;

function isDigitResult(r: ScanResult): r is SymbolDigitResult {
    return (r as SymbolDigitResult).pcts !== undefined && 'totalTicks' in r && !('triggers' in r);
}

function isTriggerResult(r: ScanResult): r is TriggerDigitResult {
    return 'triggers' in r;
}

function calcDigitPcts(digits: number[]): number[] {
    const counts = Array(10).fill(0);
    digits.forEach(d => { if (d >= 0 && d <= 9) counts[d]++; });
    const total = digits.length || 1;
    return counts.map(c => (c / total) * 100);
}

// ── Engine 3 helper: Distribution Promoter ──
function analyzeDistribution(afterDigits: number[], isWin: (d: number) => boolean) {
    if (afterDigits.length < 10) return { fillRate: 0, concentration: 0, entropy: 100, winningMomentum: 0, losingMomentum: 0, balanceShift: 0 };
    const n = afterDigits.length;
    const first25 = afterDigits.slice(0, Math.min(25, n));
    const fillRate = Math.min(100, Math.max(0, (first25.filter(d => isWin(d)).length / first25.length) * 100));
    const pcts = Array(10).fill(0).map((_, d) => (afterDigits.filter(x => x === d).length / n) * 100);
    const meanPct = 10;
    const gini = pcts.reduce((s, p) => s + Math.abs(p - meanPct), 0) / 200;
    const concentration = Math.min(100, Math.max(0, gini * 1000));
    let postEntropy = 0;
    for (let d = 0; d < 10; d++) { const p = pcts[d] / 100; if (p > 0) postEntropy -= p * Math.log2(p); }
    const entropy = Math.round((postEntropy / 3.32) * 100 * 10) / 10;
    // Slope of win accumulation
    const winCounts: number[] = [];
    let wAcc = 0;
    for (let i = 0; i < Math.min(25, n); i++) { if (isWin(afterDigits[i])) wAcc++; winCounts.push(wAcc); }
    let winningMomentum = 0;
    if (winCounts.length >= 5) {
        let sx = 0, sy = 0, sxy = 0, sx2 = 0;
        for (let i = 0; i < winCounts.length; i++) { sx += i; sy += winCounts[i]; sxy += i * winCounts[i]; sx2 += i * i; }
        const nn = winCounts.length; const mx = sx / nn; const my = sy / nn;
        const denom = sx2 - nn * mx * mx;
        winningMomentum = denom > 0 ? Math.round(((sxy - nn * mx * my) / denom) * 1000) / 10 : 0;
    }
    // Slope of loss accumulation
    const loseCounts: number[] = [];
    let lAcc = 0;
    for (let i = 0; i < Math.min(25, n); i++) { if (!isWin(afterDigits[i])) lAcc++; loseCounts.push(lAcc); }
    let losingMomentum = 0;
    if (loseCounts.length >= 5) {
        let sx = 0, sy = 0, sxy = 0, sx2 = 0;
        for (let i = 0; i < loseCounts.length; i++) { sx += i; sy += loseCounts[i]; sxy += i * loseCounts[i]; sx2 += i * i; }
        const nn = loseCounts.length; const mx = sx / nn; const my = sy / nn;
        const denom = sx2 - nn * mx * mx;
        losingMomentum = denom > 0 ? Math.round(((sxy - nn * mx * my) / denom) * 1000) / 10 : 0;
    }
    const balanceShift = Math.round((winningMomentum - losingMomentum) * 10) / 10;
    return { fillRate, concentration, entropy, winningMomentum, losingMomentum, balanceShift };
}

// ── Entry Digit Trigger Analysis v3 ──
// Deep analysis: digit generator pattern reader, full tick momentum, distribution promoter
function analyzeTriggerDigits(
    digits: number[],
    contractType: 'DIGITOVER' | 'DIGITUNDER',
    barrier: number,
    rawPrices: number[] = [],
): { baselinePcts: number[]; baselineWinPct: number; triggers: TriggerInfo[] } {
    const len = digits.length;
    if (len < 30) return { baselinePcts: Array(10).fill(0), baselineWinPct: 0, triggers: [] };

    const isWin = (d: number) => contractType === 'DIGITOVER' ? d > barrier : d < barrier;

    // ── Rolling baseline percentages across 3 windows ──
    const win100 = calcDigitPcts(digits.slice(-100));
    const win50 = calcDigitPcts(digits.slice(-50));
    const win20 = calcDigitPcts(digits.slice(-20));

    // Baseline win% from full dataset
    const baselineWinPct = (digits.filter(d => isWin(d)).length / len) * 100;
    const baselinePcts = win100;

    // ── Digit Power Score: which digits are gaining/losing strength ──
    // Power = weighted combination of frequency + momentum
    const digitPower = Array(10).fill(0).map((_, d) => {
        const freq = win20[d]; // current frequency
        const momentum = win20[d] - win100[d]; // acceleration
        const consistency = win50[d] - win100[d]; // medium-term trend
        // Power: current freq weighted by momentum
        return freq + (momentum * 2) + (consistency * 0.5);
    });

    // ══════════════════════════════════════════════════════════════
    // TIER 2: DEEP DIGIT ECOSYSTEM ANALYSIS
    // ══════════════════════════════════════════════════════════════

    // ── Layer 1: Digit Percentage Trajectory (DPT) ──
    // Smoothed trajectory: weighted average of 3 window sizes (50, 100, 200)
    // This produces meaningful decimal values (e.g., 10.3% instead of 10.0%)
    // because different window sizes yield different percentage values
    const WINDOW_COUNT = 15;
    const WINDOW_SIZE = Math.floor(len / WINDOW_COUNT);
    const digitTrajectoryWindows: number[][] = Array.from({ length: 10 }, () => []);

    for (let w = 0; w < WINDOW_COUNT; w++) {
        const start = w * WINDOW_SIZE;
        const end = Math.min(start + WINDOW_SIZE, len);
        // Weighted average of 3 different window sizes for smooth decimals
        const pcts50 = calcDigitPcts(digits.slice(start, Math.min(start + 50, end)));
        const pcts100 = calcDigitPcts(digits.slice(start, end));
        const pcts200 = calcDigitPcts(digits.slice(Math.max(0, start - 50), Math.min(end + 50, len)));
        for (let d = 0; d < 10; d++) {
            // Weight: 50-tick (40%) + 100-tick (35%) + 200-tick (25%) = smooth decimals
            const smoothed = pcts50[d] * 0.40 + pcts100[d] * 0.35 + pcts200[d] * 0.25;
            digitTrajectoryWindows[d].push(Math.round(smoothed * 10) / 10); // 1 decimal
        }
    }

    // Linear regression slope for each digit's trajectory
    const trajectorySlopes = Array(10).fill(0);
    const trajectoryAcceleration = Array(10).fill(0);
    const trajectoryStability = Array(10).fill(0);

    for (let d = 0; d < 10; d++) {
        const vals = digitTrajectoryWindows[d];
        const n = vals.length;
        if (n < 3) continue;

        // Slope via least-squares regression
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += vals[i];
            sumXY += i * vals[i];
            sumX2 += i * i;
        }
        const meanX = sumX / n;
        const meanY = sumY / n;
        const denom = sumX2 - n * meanX * meanX;
        const slope = denom !== 0 ? (sumXY - n * meanX * meanY) / denom : 0;
        trajectorySlopes[d] = slope;

        // Acceleration: slope of second half minus slope of first half
        const halfN = Math.floor(n / 2);
        const firstHalf = vals.slice(0, halfN);
        const secondHalf = vals.slice(halfN);

        const calcSlope = (arr: number[]) => {
            if (arr.length < 2) return 0;
            let sx = 0, sy = 0, sxy = 0, sx2 = 0;
            for (let i = 0; i < arr.length; i++) {
                sx += i; sy += arr[i]; sxy += i * arr[i]; sx2 += i * i;
            }
            const mx = sx / arr.length, my = sy / arr.length;
            const dn = sx2 - arr.length * mx * mx;
            return dn !== 0 ? (sxy - arr.length * mx * my) / dn : 0;
        };

        trajectoryAcceleration[d] = calcSlope(secondHalf) - calcSlope(firstHalf);

        // Stability: inverse of variance (low variance = high stability)
        // Thresholds lowered for decimal precision (variance measured in %²)
        const mean = meanY;
        let variance = 0;
        for (let i = 0; i < n; i++) variance += (vals[i] - mean) ** 2;
        variance /= n;
        trajectoryStability[d] = variance < 0.5 ? 10 : variance < 2 ? 7 : variance < 5 ? 4 : 1;
    }

    // ── Digit Growth: recent 30 ticks vs overall (same as manual trade) ──
    // Positive growth = digit increasing, negative = decreasing
    const overallPcts = calcDigitPcts(digits.slice(-1000));
    const recentPcts30 = calcDigitPcts(digits.slice(-30));
    const digitGrowth = Array(10).fill(0).map((_, d) =>
        Math.round((recentPcts30[d] - overallPcts[d]) * 10) / 10
    );

    // ── Layer 2: Cross-Digit Influence Matrix (CDI) ──
    // For each digit X, measure how it affects every other digit Y in the next 20 ticks
    const crossDigitMatrix: number[][] = Array.from({ length: 10 }, () => Array(10).fill(0));
    const crossDigitWindow = 20;

    // Smoothed baseline: weighted average of 100, 200, 500-tick windows for decimal precision
    const baselineSmoothed = Array(10).fill(0).map((_, d) => {
        const p100 = calcDigitPcts(digits.slice(-100));
        const p200 = calcDigitPcts(digits.slice(-200));
        const p500 = calcDigitPcts(digits.slice(-500));
        return Math.round((p100[d] * 0.3 + p200[d] * 0.4 + p500[d] * 0.3) * 10) / 10;
    });

    for (let src = 0; src < 10; src++) {
        const srcPositions: number[] = [];
        for (let i = 0; i < len - crossDigitWindow; i++) {
            if (digits[i] === src) srcPositions.push(i);
        }
        if (srcPositions.length < 3) continue;

        // Collect digits in the next 20 ticks after each src appearance
        const afterSrc: number[] = [];
        for (const pos of srcPositions) {
            for (let j = pos + 1; j < Math.min(pos + crossDigitWindow, len); j++) {
                afterSrc.push(digits[j]);
            }
        }
        // Smoothed post-trigger: weighted average of immediate (20-tick) and extended (40-tick) windows
        const afterPcts20 = calcDigitPcts(afterSrc);
        const afterSrcExtended: number[] = [];
        for (const pos of srcPositions) {
            for (let j = pos + 1; j < Math.min(pos + 40, len); j++) {
                afterSrcExtended.push(digits[j]);
            }
        }
        const afterPcts40 = calcDigitPcts(afterSrcExtended);
        const afterSrcPcts = Array(10).fill(0).map((_, d) =>
            Math.round((afterPcts20[d] * 0.6 + afterPcts40[d] * 0.4) * 10) / 10
        );

        for (let tgt = 0; tgt < 10; tgt++) {
            crossDigitMatrix[src][tgt] = Math.round((afterSrcPcts[tgt] - baselineSmoothed[tgt]) * 10) / 10;
        }
    }

    // ── Layer 3: Digit Dominance Index (DDI) ──
    // Which digits are currently dominating/suppressed — smoothed for decimal precision
    const recentSmoothed = Array(10).fill(0).map((_, d) => {
        const p100 = calcDigitPcts(digits.slice(-100));
        const p200 = calcDigitPcts(digits.slice(-200));
        const p50 = calcDigitPcts(digits.slice(-50));
        return Math.round((p50[d] * 0.4 + p100[d] * 0.35 + p200[d] * 0.25) * 10) / 10;
    });
    const oldSmoothed = Array(10).fill(0).map((_, d) => {
        const half = Math.floor(len / 2);
        const p100 = calcDigitPcts(digits.slice(0, half));
        const p200 = calcDigitPcts(digits.slice(0, Math.min(half, 200)));
        const p500 = calcDigitPcts(digits.slice(0, Math.min(half, 500)));
        return Math.round((p100[d] * 0.4 + p200[d] * 0.3 + p500[d] * 0.3) * 10) / 10;
    });
    const recentPcts = recentSmoothed;
    const oldPcts = oldSmoothed;

    // Rank digits by current percentage
    const digitRanks = recentPcts
        .map((pct, d) => ({ digit: d, pct }))
        .sort((a, b) => b.pct - a.pct);

    const currentDominant = digitRanks[0].digit;
    const currentSuppressed = digitRanks[9].digit;

    // Dominance shift: compare first half vs second half rankings
    const oldRanks = oldPcts
        .map((pct, d) => ({ digit: d, pct }))
        .sort((a, b) => b.pct - a.pct);
    const oldDominant = oldRanks[0].digit;

    // Cross-digit effect on suppressed digits after trigger
    const suppressionReliefMap = Array(10).fill(0);
    for (let triggerD = 0; triggerD < 10; triggerD++) {
        const suppressedPctsAfterTrigger = crossDigitMatrix[triggerD][currentSuppressed];
        suppressionReliefMap[triggerD] = suppressedPctsAfterTrigger;
    }

    // ══════════════════════════════════════════════════════════════
    // TIER 3: NEW ENGINES
    // ══════════════════════════════════════════════════════════════

    // ── Engine 1: Digit Generator Pattern Reader ──
    // Reads sequences, cycles, rhythms, and momentum of the digit generator
    const genLen = Math.min(len, 500); // analyze last 500 for pattern detection
    const genDigits = digits.slice(-genLen);

    // Pattern Strength: measure how predictable the next digit is
    // Count bigram (2-digit) and trigram (3-digit) frequencies
    const bigramCount = new Map<string, number>();
    const trigramCount = new Map<string, number>();
    for (let i = 0; i < genLen - 1; i++) {
        const bg = `${genDigits[i]}${genDigits[i + 1]}`;
        bigramCount.set(bg, (bigramCount.get(bg) || 0) + 1);
        if (i < genLen - 2) {
            const tg = `${genDigits[i]}${genDigits[i + 1]}${genDigits[i + 2]}`;
            trigramCount.set(tg, (trigramCount.get(tg) || 0) + 1);
        }
    }
    // Pattern strength = how much the most common bigram exceeds random chance (1/100 = 1%)
    const maxBigramFreq = Math.max(...Array.from(bigramCount.values()));
    const patternStrength = Math.min(100, Math.max(0, ((maxBigramFreq / (genLen - 1)) / 0.01 - 1) * 20));

    // Cycle Detection: find repeating patterns in digit sequence
    let cycleLength = 0;
    let bestCycleScore = 0;
    for (let cycle = 3; cycle <= 20; cycle++) {
        let matches = 0;
        let checked = 0;
        for (let i = 0; i < genLen - cycle; i++) {
            if (genDigits[i] === genDigits[i + cycle]) matches++;
            checked++;
        }
        const score = checked > 0 ? matches / checked : 0;
        if (score > 0.3 && score > bestCycleScore) {
            bestCycleScore = score;
            cycleLength = cycle;
        }
    }

    // Rhythm Score: measure digit alternation (no long runs of same digit)
    let alternations = 0;
    let maxRun = 1, currentRun = 1;
    for (let i = 1; i < genLen; i++) {
        if (genDigits[i] !== genDigits[i - 1]) {
            alternations++;
            currentRun = 1;
        } else {
            currentRun++;
            if (currentRun > maxRun) maxRun = currentRun;
        }
    }
    const rhythmScore = Math.min(100, Math.max(0, (alternations / (genLen - 1)) * 100));

    // Sequence Entropy: low entropy = predictable
    const digitFreq = Array(10).fill(0);
    genDigits.forEach(d => digitFreq[d]++);
    let entropy = 0;
    for (let d = 0; d < 10; d++) {
        const p = digitFreq[d] / genLen;
        if (p > 0) entropy -= p * Math.log2(p);
    }
    // Normalize: max entropy for 10 uniform digits = log2(10) ≈ 3.32
    const normalizedEntropy = (entropy / 3.32) * 100;

    // ── Engine 2: Full Tick Momentum ──
    // Analyze full price movement (velocity, acceleration, volatility)
    let fullTickVelocity = 0;
    let fullTickAcceleration = 0;
    let fullTickVolatility = 0;
    let fullTickTrend: 'up' | 'down' | 'flat' = 'flat';
    let fullTickTrendStrength = 0;
    let fullTickPriceRange = 0;
    let fullTickMomentumScore = 50;

    if (rawPrices.length >= 20) {
        const rp = rawPrices.slice(-200);
        const rpLen = rp.length;

        // Price velocity: average change between consecutive ticks
        let totalChange = 0;
        let changes: number[] = [];
        for (let i = 1; i < rpLen; i++) {
            const change = rp[i] - rp[i - 1];
            totalChange += change;
            changes.push(change);
        }
        fullTickVelocity = totalChange / (rpLen - 1);

        // Price acceleration: change in velocity
        const half = Math.floor(rpLen / 2);
        const firstHalfVel = changes.slice(0, half).reduce((s, c) => s + c, 0) / Math.max(half, 1);
        const secondHalfVel = changes.slice(half).reduce((s, c) => s + c, 0) / Math.max(rpLen - half, 1);
        fullTickAcceleration = secondHalfVel - firstHalfVel;

        // Volatility: standard deviation of changes
        const meanChange = totalChange / (rpLen - 1);
        const variance = changes.reduce((s, c) => s + (c - meanChange) ** 2, 0) / (rpLen - 1);
        fullTickVolatility = Math.sqrt(variance);

        // Price range
        fullTickPriceRange = Math.max(...rp) - Math.min(...rp);

        // Trend detection
        const recentPrices = rp.slice(-50);
        const olderPrices = rp.slice(-100, -50);
        const recentAvg = recentPrices.reduce((s, p) => s + p, 0) / recentPrices.length;
        const olderAvg = olderPrices.length > 0 ? olderPrices.reduce((s, p) => s + p, 0) / olderPrices.length : recentAvg;
        const trendDiff = recentAvg - olderAvg;
        const trendThreshold = fullTickVolatility * 0.3;

        if (trendDiff > trendThreshold) {
            fullTickTrend = 'up';
            fullTickTrendStrength = Math.min(100, (trendDiff / trendThreshold) * 50);
        } else if (trendDiff < -trendThreshold) {
            fullTickTrend = 'down';
            fullTickTrendStrength = Math.min(100, (Math.abs(trendDiff) / trendThreshold) * 50);
        } else {
            fullTickTrend = 'flat';
            fullTickTrendStrength = Math.min(50, 50 - (Math.abs(trendDiff) / trendThreshold) * 50);
        }

        // Momentum score: combine velocity, acceleration, and trend
        const velScore = Math.min(50, Math.max(-50, fullTickVelocity * 1000));
        const accelScore = Math.min(30, Math.max(-30, fullTickAcceleration * 10000));
        const trendScore = fullTickTrend === 'up' ? fullTickTrendStrength * 0.5
            : fullTickTrend === 'down' ? -fullTickTrendStrength * 0.5 : 0;
        fullTickMomentumScore = Math.min(100, Math.max(0, 50 + velScore + accelScore + trendScore));
    }

    const globalGenerator = {
        patternStrength: Math.round(patternStrength * 10) / 10,
        cycleLength,
        rhythmScore: Math.round(rhythmScore * 10) / 10,
        sequenceEntropy: Math.round(normalizedEntropy * 10) / 10,
        afterTriggerPatterns: { repeatRate: 0, alternationRate: 0, avgSequenceLength: 0 },
    };

    const globalFullTick = {
        velocity: Math.round(fullTickVelocity * 100000) / 100000,
        acceleration: Math.round(fullTickAcceleration * 100000) / 100000,
        volatility: Math.round(fullTickVolatility * 100000) / 100000,
        trend: fullTickTrend,
        trendStrength: Math.round(fullTickTrendStrength * 10) / 10,
        priceRange: Math.round(fullTickPriceRange * 100) / 100,
        momentumScore: Math.round(fullTickMomentumScore * 10) / 10,
    };

    const triggers: TriggerInfo[] = [];

    for (let triggerDigit = 0; triggerDigit <= 9; triggerDigit++) {
        // Find all positions where this trigger digit appears
        const positions: number[] = [];
        for (let i = 0; i < len - 1; i++) {
            if (digits[i] === triggerDigit) positions.push(i);
        }

        if (positions.length < 3) continue;

        // ── Collect ALL digits that appear after each trigger occurrence ──
        const decayWindowSize = 25; // analyze up to 25 ticks after trigger
        const afterDigits: number[] = [];
        for (const pos of positions) {
            const end = Math.min(pos + decayWindowSize, len);
            for (let j = pos + 1; j < end; j++) {
                afterDigits.push(digits[j]);
            }
        }

        if (afterDigits.length === 0) continue;

        // ── Engine 3: Distribution Promoter (per-trigger) ──
        const distAnalysis = analyzeDistribution(afterDigits, isWin);

        // ── Per-trigger Generator patterns ──
        // After this trigger, what patterns emerge?
        let repeatCount = 0, altCount = 0, runLen = 0, totalRuns = 0, runSum = 0;
        for (const pos of positions) {
            if (pos + 1 < len) {
                if (digits[pos + 1] === triggerDigit) repeatCount++;
                else altCount++;
            }
            // Measure consecutive runs after trigger
            let currentRun = 1;
            for (let j = pos + 2; j < Math.min(pos + 10, len); j++) {
                if (digits[j] === digits[j - 1]) currentRun++;
                else break;
            }
            runSum += currentRun;
            totalRuns++;
        }
        const totalTransitions = repeatCount + altCount || 1;
        const perTriggerGenerator = {
            patternStrength: globalGenerator.patternStrength,
            cycleLength: globalGenerator.cycleLength,
            rhythmScore: globalGenerator.rhythmScore,
            sequenceEntropy: globalGenerator.sequenceEntropy,
            afterTriggerPatterns: {
                repeatRate: Math.round((repeatCount / totalTransitions) * 100 * 10) / 10,
                alternationRate: Math.round((altCount / totalTransitions) * 100 * 10) / 10,
                avgSequenceLength: totalRuns > 0 ? Math.round((runSum / totalRuns) * 10) / 10 : 0,
            },
        };

        // ── Decay Curve: win% at each tick position after trigger ──
        // For each tick offset (1, 2, 3... 25), compute the win% across all trigger occurrences
        const decayCurve: number[] = [];
        for (let offset = 1; offset <= decayWindowSize; offset++) {
            let winCount = 0;
            let totalCount = 0;
            for (const pos of positions) {
                const tickIdx = pos + offset;
                if (tickIdx < len) {
                    totalCount++;
                    if (isWin(digits[tickIdx])) winCount++;
                }
            }
            decayCurve.push(totalCount > 0 ? (winCount / totalCount) * 100 : baselineWinPct);
        }

        // Find the best entry window (3-tick sliding window with highest avg win%)
        let bestStart = 0, bestEnd = 3, bestPeak = 0;
        for (let start = 0; start < decayCurve.length - 2; start++) {
            const avg = (decayCurve[start] + decayCurve[start + 1] + decayCurve[start + 2]) / 3;
            if (avg > bestPeak) {
                bestPeak = avg;
                bestStart = start;
                bestEnd = start + 3;
            }
        }

        // ── Calculate digit distribution AFTER trigger (smoothed) ──
        const afterPctsRaw = calcDigitPcts(afterDigits);
        // Smooth after-trigger percentages with extended window
        const afterDigitsExtended: number[] = [];
        for (const pos of positions) {
            const end = Math.min(pos + 40, len);
            for (let j = pos + 1; j < end; j++) afterDigitsExtended.push(digits[j]);
        }
        const afterPctsExt = calcDigitPcts(afterDigitsExtended);
        const afterPcts = Array(10).fill(0).map((_, d) =>
            Math.round((afterPctsRaw[d] * 0.6 + afterPctsExt[d] * 0.4) * 10) / 10
        );
        const digitShifts = baselineSmoothed.map((before, d) => ({
            digit: d,
            before,
            after: afterPcts[d],
            shift: afterPcts[d] - before,
        }));

        // ── Winning digit % after trigger (rounded to 1 decimal) ──
        const afterWinCount = afterDigits.filter(d => isWin(d)).length;
        const avgWinPctAfter = Math.round(((afterWinCount / afterDigits.length) * 100) * 10) / 10;
        const boost = Math.round((avgWinPctAfter - baselineWinPct) * 10) / 10;

        // ── Rolling Momentum: how win% changes across windows after trigger ──
        // For each trigger occurrence, compute win% in the first 100, 50, 20 ticks after
        let winM100 = 0, winM50 = 0, winM20 = 0, totalM100 = 0, totalM50 = 0, totalM20 = 0;
        for (const pos of positions) {
            for (let j = pos + 1; j < Math.min(pos + 101, len); j++) {
                totalM100++;
                if (isWin(digits[j])) winM100++;
            }
            for (let j = pos + 1; j < Math.min(pos + 51, len); j++) {
                totalM50++;
                if (isWin(digits[j])) winM50++;
            }
            for (let j = pos + 1; j < Math.min(pos + 21, len); j++) {
                totalM20++;
                if (isWin(digits[j])) winM20++;
            }
        }
        const pctM100 = totalM100 > 0 ? Math.round(((winM100 / totalM100) * 100) * 10) / 10 : baselineWinPct;
        const pctM50 = totalM50 > 0 ? Math.round(((winM50 / totalM50) * 100) * 10) / 10 : baselineWinPct;
        const pctM20 = totalM20 > 0 ? Math.round(((winM20 / totalM20) * 100) * 10) / 10 : baselineWinPct;
        const overallMomentum = Math.round((pctM20 - pctM100) * 10) / 10; // positive = win rate improving recently

        // ── Consistency: check across sub-windows ──
        const subWindows = [5, 10, 15, 20];
        let windowsWithBoost = 0;
        const windowResults: { window: number; winPct: number; boost: number }[] = [];
        for (const sw of subWindows) {
            let swWin = 0, swTotal = 0;
            for (const pos of positions) {
                const end = Math.min(pos + sw, len);
                for (let j = pos + 1; j < end; j++) {
                    swTotal++;
                    if (isWin(digits[j])) swWin++;
                }
            }
            if (swTotal === 0) continue;
            const swWinPct = Math.round(((swWin / swTotal) * 100) * 10) / 10;
            const swBoost = Math.round((swWinPct - baselineWinPct) * 10) / 10;
            windowResults.push({ window: sw, winPct: swWinPct, boost: swBoost });
            if (swBoost > 0) windowsWithBoost++;
        }
        const consistency = windowResults.length > 0
            ? (windowsWithBoost / windowResults.length) * 100
            : 0;

        // ── Inter-Digit Correlation: which specific digits surge after this trigger ──
        const digitSurges = Array(10).fill(0).map((_, d) => ({
            digit: d,
            surgePct: afterPcts[d] - baselinePcts[d],
            count: afterDigits.filter(x => x === d).length,
        })).filter(s => s.surgePct > 1) // only digits that actually surge
          .sort((a, b) => b.surgePct - a.surgePct);

        // ── Pattern Strength Over Time ──
        const halfLen = Math.floor(len / 2);
        const olderPositions = positions.filter(p => p < halfLen);
        const recentPositions = positions.filter(p => p >= halfLen);

        let olderBoost = 0;
        let olderOccurrences = olderPositions.length;
        if (olderOccurrences >= 2) {
            const olderAfter: number[] = [];
            for (const pos of olderPositions) {
                const end = Math.min(pos + 20, halfLen);
                for (let j = pos + 1; j < end; j++) olderAfter.push(digits[j]);
            }
            if (olderAfter.length > 0) {
                olderBoost = Math.round((((olderAfter.filter(d => isWin(d)).length / olderAfter.length) * 100) - baselineWinPct) * 10) / 10;
            }
        }

        let recentBoost = 0;
        let recentOccurrences = recentPositions.length;
        if (recentOccurrences >= 2) {
            const recentAfter: number[] = [];
            for (const pos of recentPositions) {
                const end = Math.min(pos + 20, len);
                for (let j = pos + 1; j < end; j++) recentAfter.push(digits[j]);
            }
            if (recentAfter.length > 0) {
                recentBoost = Math.round((((recentAfter.filter(d => isWin(d)).length / recentAfter.length) * 100) - baselineWinPct) * 10) / 10;
            }
        }

        let trend: 'strengthening' | 'weakening' | 'stable' | 'new' | 'dying';
        let trendPercent = 0;
        if (olderOccurrences < 2 && recentOccurrences >= 2) { trend = 'new'; trendPercent = recentBoost; }
        else if (olderOccurrences >= 2 && recentOccurrences < 2) { trend = 'dying'; trendPercent = Math.round(-olderBoost * 10) / 10; }
        else if (olderOccurrences >= 2 && recentOccurrences >= 2) {
            trendPercent = Math.round((recentBoost - olderBoost) * 10) / 10;
            if (trendPercent > 5) trend = 'strengthening';
            else if (trendPercent < -5) trend = 'weakening';
            else trend = 'stable';
        } else { trend = 'stable'; trendPercent = 0; }

        // ── Composite Confidence Score (0-100) ──
        // Tier 1 improvements: z-score significance, digitPower integration, sample-size weighting

        // B: Z-Score — statistical significance of boost vs noise
        // H0: trigger has no effect, win% = baselineWinPct
        // SE = sqrt(p*(1-p)/n) where p = baseline win proportion, n = post-trigger sample size
        const n = afterDigits.length;
        const p = baselineWinPct / 100;
        const se = Math.sqrt(p * (1 - p) / Math.max(n, 1));
        const observedP = avgWinPctAfter / 100;
        const zScore = se > 0 ? (observedP - p) / se : 0;

        // Approximate p-value from z-score (two-tailed)
        // Using approximation: p ≈ 2 * (1 - Φ(|z|)) where Φ is standard normal CDF
        const absZ = Math.abs(zScore);
        const pValue = absZ < 0.5 ? 0.62 : absZ < 1 ? 0.32 : absZ < 1.5 ? 0.13 : absZ < 2 ? 0.046 : absZ < 2.5 ? 0.012 : absZ < 3 ? 0.0027 : 0.0003;

        // Significance tier
        let significance: 'high' | 'medium' | 'low' | 'none';
        if (pValue < 0.01 && positions.length >= 10) significance = 'high';
        else if (pValue < 0.05 && positions.length >= 6) significance = 'medium';
        else if (pValue < 0.15 && positions.length >= 4) significance = 'low';
        else significance = 'none';

        // C: Trigger Power — how strong the trigger digit itself is in current market
        const triggerPower = digitPower[triggerDigit];

        // ══════════════════════════════════════════════════════════════
        // TIER 2: Deep Digit Ecosystem — Per-Trigger Calculations
        // ══════════════════════════════════════════════════════════════

        // Layer 4: Predictive Signal Strength (PSS)
        // Build predicted digit distribution for next 20 ticks using smoothed percentages
        const predictedDist = Array(10).fill(0).map((_, d) => {
            let predicted = baselineSmoothed[d];
            // Trajectory projection: slope * 2 (project 20 ticks ahead)
            predicted += trajectorySlopes[d] * 2;
            // Cross-digit effect: how trigger digit affects this digit
            predicted += crossDigitMatrix[triggerDigit][d];
            // Dominance relief: suppressed digits tend to bounce back
            if (d === currentSuppressed) predicted += 1.5;
            if (d === currentDominant) predicted -= 0.3;
            return Math.max(0, Math.round(predicted * 10) / 10);
        });

        // Normalize predicted distribution to 100%
        const predictedTotal = predictedDist.reduce((s, v) => s + v, 0);
        const normalizedPredicted = predictedDist.map(v => predictedTotal > 0 ? (v / predictedTotal) * 100 : 10);

        // Predicted win% from predicted distribution
        const predictedWinPct = normalizedPredicted.reduce((sum, pct, d) =>
            sum + (isWin(d) ? pct : 0), 0);

        // Prediction accuracy: how close predicted boost matches actual boost
        const predictedBoost = predictedWinPct - baselineWinPct;
        const predictionAccuracy = Math.max(0, 100 - Math.abs(predictedBoost - boost) * 2);

        // Forecast confidence: based on trajectory stability + cross-digit consistency
        const triggerTrajectoryStability = trajectoryStability[triggerDigit];
        const triggerCrossDigitEffects = crossDigitMatrix[triggerDigit].filter(v => Math.abs(v) > 1).length;
        const forecastConfidence = Math.min(100,
            triggerTrajectoryStability * 5 + triggerCrossDigitEffects * 8 + predictionAccuracy * 0.3
        );

        // Dominance rank of trigger digit
        const triggerRank = digitRanks.findIndex(r => r.digit === triggerDigit) + 1;
        const dominanceShift = oldRanks.findIndex(r => r.digit === triggerDigit) - triggerRank;
        const suppressionRelief = suppressionReliefMap[triggerDigit];

        // Cross-digit dominant effects count and net effect
        const crossDigitEffects = crossDigitMatrix[triggerDigit].filter(v => Math.abs(v) > 1).length;
        const crossDigitNetEffect = crossDigitMatrix[triggerDigit].reduce((sum, v, d) =>
            sum + (isWin(d) ? v : -v), 0);

        // ── Losing Digit Filter ──
        // At least half of losing digits must be < 10% AND have negative growth (decreasing)
        const losingDigits = Array(10).fill(0).map((_, d) => !isWin(d));
        const losingDigitIndices = losingDigits.map((isLosing, d) => isLosing ? d : -1).filter(d => d >= 0);
        const losingCount = losingDigitIndices.length;
        const losingBelowThreshold = losingDigitIndices.filter(d => baselineSmoothed[d] < 10).length;
        const losingDecreasing = losingDigitIndices.filter(d => digitGrowth[d] < 0).length;
        const losingMet = losingBelowThreshold >= Math.ceil(losingCount / 2);
        const losingFading = losingDecreasing >= Math.ceil(losingCount / 2);
        const losingFilterPass = losingMet && losingFading;

        // ══════════════════════════════════════════════════════════════
        // CONFIDENCE SCORE (Tier 1 + Tier 2 + Losing Filter)
        // ══════════════════════════════════════════════════════════════

        const sampleWeight = Math.min(1, positions.length / 20);

        // Tier 1 components (rebalanced)
        const boostScore = Math.min(20, Math.max(0, boost * 1.5)); // 0-20
        const consistencyScore = (consistency / 100) * 10; // 0-10
        const momentumScore = Math.min(10, Math.max(0, overallMomentum * 1.2)); // 0-10
        const decayScore = Math.min(10, Math.max(0, (bestPeak - baselineWinPct) * 1.2)); // 0-10
        const occScore = Math.min(5, (positions.length / 15) * 5); // 0-5
        const powerBonus = Math.min(5, Math.max(0, triggerPower * 0.5)); // 0-5

        // Tier 2 components (new)
        // Trajectory Score: slope alignment + acceleration + stability
        const trajectoryScore = Math.min(15, Math.max(0,
            Math.abs(trajectorySlopes[triggerDigit]) * 3 +
            Math.abs(trajectoryAcceleration[triggerDigit]) * 2 +
            triggerTrajectoryStability * 0.8
        )); // 0-15

        // Cross-Digit Score: how many digits it affects + net direction
        const crossDigitScore = Math.min(10, Math.max(0,
            crossDigitEffects * 1.5 + Math.abs(crossDigitNetEffect) * 1.5
        )); // 0-10

        // Dominance Score: trigger rank + shift + suppression relief
        const dominanceScoreVal = Math.min(10, Math.max(0,
            (10 - triggerRank) * 1 +
            Math.abs(dominanceShift) * 1.5 +
            suppressionRelief * 1
        )); // 0-10

        // Predictive Score: how accurate the model prediction is
        const predictiveScoreVal = Math.min(5, Math.max(0,
            predictionAccuracy * 0.05
        )); // 0-5

        // Tier 3 components (new engines)
        // Generator Score: how predictable the digit pattern is + after-trigger behavior
        const genScore = Math.min(10, Math.max(0,
            perTriggerGenerator.patternStrength * 0.03 +
            perTriggerGenerator.rhythmScore * 0.03 +
            (100 - perTriggerGenerator.sequenceEntropy) * 0.02 +
            perTriggerGenerator.afterTriggerPatterns.repeatRate * 0.02
        )); // 0-10

        // Full Tick Score: momentum + trend alignment
        const fullTickScore = Math.min(8, Math.max(0,
            Math.abs(fullTickMomentumScore - 50) * 0.1 +
            (fullTickTrend === 'flat' ? 2 : 0) + // flat is good for entry digit
            (fullTickVolatility < 0.001 ? 3 : fullTickVolatility < 0.005 ? 2 : 1) // low vol = good
        )); // 0-8

        // Distribution Score: how quickly winning digits fill + balance shift
        const distScore = Math.min(12, Math.max(0,
            distAnalysis.fillRate * 0.05 +
            distAnalysis.balanceShift * 0.3 +
            (100 - distAnalysis.entropy) * 0.03 +
            distAnalysis.winningMomentum * 0.1
        )); // 0-12

        // Raw score
        const rawScore = boostScore + consistencyScore + momentumScore + decayScore
            + occScore + powerBonus + trajectoryScore + crossDigitScore
            + dominanceScoreVal + predictiveScoreVal
            + genScore + fullTickScore + distScore;

        // Apply sample-size penalty + losing digit filter
        const losingFilterMultiplier = losingFilterPass ? 1.0 : 0.6;
        const confidence = Math.min(100, rawScore * sampleWeight * losingFilterMultiplier);

        triggers.push({
            digit: triggerDigit,
            occurrences: positions.length,
            avgWinPctAfter,
            boost,
            consistency,
            windowSizes: windowResults,
            digitShifts,
            patternTrend: {
                olderBoost, recentBoost, olderOccurrences, recentOccurrences,
                trend, trendPercent,
            },
            momentum: {
                winMomentum100: pctM100,
                winMomentum50: pctM50,
                winMomentum20: pctM20,
                overallMomentum,
            },
            decayCurve,
            bestEntryWindow: { start: bestStart + 1, end: bestEnd + 1, peakWinPct: bestPeak },
            digitSurges,
            confidence,
            digitPower,
            zScore,
            pValue,
            significance,
            triggerPower,
            // Tier 2 fields
            trajectory: {
                slopes: trajectorySlopes,
                acceleration: trajectoryAcceleration,
                windows: digitTrajectoryWindows,
                stability: trajectoryStability,
            },
            crossDigit: {
                matrix: crossDigitMatrix,
                dominantEffects: crossDigitEffects,
                netEffect: crossDigitNetEffect,
            },
            dominance: {
                currentDominant,
                currentSuppressed,
                triggerRank,
                dominanceShift,
                suppressionRelief,
            },
            predictive: {
                predictedBoost,
                predictionAccuracy,
                forecastConfidence,
            },
            losingFilter: {
                pass: losingFilterPass,
                belowThreshold: losingBelowThreshold,
                decreasing: losingDecreasing,
                totalLosing: losingCount,
                growth: digitGrowth,
            },
            generator: perTriggerGenerator,
            fullTick: globalFullTick,
            distribution: distAnalysis,
        });
    }

    // Sort by confidence (highest first), then boost
    triggers.sort((a, b) => {
        if (Math.abs(a.confidence - b.confidence) > 5) return b.confidence - a.confidence;
        return b.boost - a.boost;
    });

    return { baselinePcts, baselineWinPct, triggers };
}

/* ── Micro-choppiness analysis on the current growing candle ────────────── */
// Analyzes tick-level price action within the current (still-open) candle.
// Measures direction flip frequency, tick-run length, and body indecision.
// Higher score = more random / choppy (bad for 1-tick predictions).
function calcMicroChoppiness(prices: number[]): SymbolDirectionResult {
    const len = prices.length;
    if (len < 5) {
        return { symbol: '', label: '', choppinessScore: 0, bodyRatio: 0, directionChanges: 0, trendStrength: 0, recentBodyRatio: 0, qualifies: false, detail: 'Insufficient ticks' };
    }

    const open = prices[0];
    const close = prices[len - 1];
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const range = high - low || 1;

    // ── 1. Tick-level direction flips ───────────────────────────────
    let flips = 0, totalDir = 0, prevDir = 0;
    let runSum = 0, runCount = 0, curRun = 1;

    for (let i = 1; i < len; i++) {
        const dir = prices[i] > prices[i - 1] ? 1 : prices[i] < prices[i - 1] ? -1 : 0;
        if (dir === 0) continue;
        totalDir++;
        if (prevDir !== 0 && dir !== prevDir) {
            flips++;
            runSum += curRun;
            runCount++;
            curRun = 1;
        } else {
            curRun++;
        }
        prevDir = dir;
    }
    if (curRun > 0) { runSum += curRun; runCount++; }
    const avgRun = runCount > 0 ? runSum / runCount : 1;
    const flipRate = totalDir > 1 ? flips / (totalDir - 1) : 0;

    // ── 2. Body-to-range ratio (small = indecision = choppy) ─────────
    const body = Math.abs(close - open);
    const bodyRatio = body / range;

    // ── 3. Wick balance (balanced = indecision) ──────────────────────
    const upperWick = high - Math.max(open, close);
    const lowerWick = Math.min(open, close) - low;
    const totalWick = upperWick + lowerWick;
    const wickBalance = totalWick > 0 ? 1 - Math.abs(upperWick - lowerWick) / totalWick : 0.5;

    // ── 4. Reversal oscillation amplitude ───────────────────────────
    const rangePct = range / (open || 1);
    const rangeScore = rangePct > 0 ? Math.min(1, rangePct * 200) : 0;

    // ── Composite score ─────────────────────────────────────────────
    const score = Math.min(100, Math.round(
        flipRate             * 30 +   // frequent direction flips
        Math.max(0, 1 - avgRun / 3) * 25 +  // short tick runs
        (1 - bodyRatio)      * 25 +   // small body = indecision
        wickBalance          * 10 +   // balanced wicks = stalemate
        rangeScore           * 10     // wide range relative to price = noise
    ));

    return {
        symbol: '', label: '',
        choppinessScore: score,
        bodyRatio: Math.round(bodyRatio * 100),
        directionChanges: flips,
        trendStrength: Math.round(avgRun * 10),
        recentBodyRatio: Math.round(rangeScore * 100),
        qualifies: score >= 55,
        detail: `Score: ${score}% | Flips: ${flips}/${totalDir} | Run: ${avgRun.toFixed(1)}t | Body: ${(bodyRatio * 100).toFixed(0)}%`,
    };
}

// ─── Global POC listener (survives WS reconnect via onNewSystemMessage) ──
// Flags ONLY when a real (non-virtual) contract settles as a WIN, so the
// auto-switcher only changes volatility after a real-trade win — never on
// losses and never on virtual-hook wins/losses.
(window as any).__makoti_lastContractSettled = false;

let _pocUnsub: (() => void) | null = null;

function startPocListener() {
    if (_pocUnsub) return;
    _pocUnsub = onNewSystemMessage((event: MessageEvent) => {
        try {
            const d = JSON.parse(event.data);
            const c = d?.proposal_open_contract;
            if (d?.msg_type === 'proposal_open_contract' && c?.is_sold && !c.is_virtual && Number(c.profit) > 0) {
                (window as any).__makoti_lastContractSettled = true;
            }
        } catch (_) {}
    });
}

function stopPocListener() {
    if (_pocUnsub) {
        _pocUnsub();
        _pocUnsub = null;
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Scanner Component
═══════════════════════════════════════════════════════════════════════════ */
export const Scanner: React.FC = () => {
    const [bot, setBot] = useState<BotId>('pvty_kill');
    const [scanning, setScanning] = useState(false);
    const [progress, setProgress] = useState('');
    const [results, setResults] = useState<ScanResult[]>([]);
    const [bestSymbols, setBestSymbols] = useState<string[]>([]);
    const [autoSwitch, setAutoSwitch] = useState(false);
    const [autoSwitcherActive, setAutoSwitcherActive] = useState(false);
    const [pendingSymbol, setPendingSymbol] = useState('');
    const [notification, setNotification] = useState<{ msg: string; type: 'info' | 'success' | 'warn' } | null>(null);

    // Entry Digit config
    const [entryContractType, setEntryContractType] = useState<'DIGITOVER' | 'DIGITUNDER'>('DIGITUNDER');
    const [entryBarrier, setEntryBarrier] = useState(7);
    const [entryStake, setEntryStake] = useState('1');
    const [entryTP, setEntryTP] = useState('10');
    const [entrySL, setEntrySL] = useState('50');

    // Single vs all volatilities
    const [singleVol, setSingleVol] = useState(false);
    const [singleVolSymbol, setSingleVolSymbol] = useState(ALL_SYMBOLS[0]);
    const singleVolRef = useRef(false);
    const singleVolSymbolRef = useRef(ALL_SYMBOLS[0]);
    const symbolsToScanRef = useRef<string[]>(ALL_SYMBOLS);

    // Sync refs
    useEffect(() => { singleVolRef.current = singleVol; }, [singleVol]);
    useEffect(() => { singleVolSymbolRef.current = singleVolSymbol; }, [singleVolSymbol]);

    // Top prediction for Load Bot feature
    const [topPrediction, setTopPrediction] = useState<{
        symbol: string; label: string; entryDigit: number;
        contractType: 'DIGITOVER' | 'DIGITUNDER'; barrier: number;
    } | null>(null);

    // Refs for logic (avoid stale closures)
    const wsRef = useRef<MakotiWS | null>(null);
    const pendingRef = useRef<Set<string>>(new Set());
    const collectedRef = useRef<Map<string, any>>(new Map());
    const botRef = useRef<BotId>('pvty_kill');
    const autoSwitchRef = useRef(false);
    const scanningRef = useRef(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const currentBestRef = useRef<string>('');
    const pendingSymbolRef = useRef<string>('');
    const msgHandlerRef = useRef<(data: any) => void>(() => {});
    const cancelScanRef = useRef<(() => void) | null>(null);
    const entryContractTypeRef = useRef<'DIGITOVER' | 'DIGITUNDER'>('DIGITUNDER');
    const entryBarrierRef = useRef(7);

    // Sync Entry Digit refs
    useEffect(() => { entryContractTypeRef.current = entryContractType; }, [entryContractType]);
    useEffect(() => { entryBarrierRef.current = entryBarrier; }, [entryBarrier]);

    const showNotify = useCallback((msg: string, type: 'info' | 'success' | 'warn' = 'info') => {
        setNotification({ msg, type });
        setTimeout(() => setNotification(null), 3500);
    }, []);

    const setPending = useCallback((sym: string) => {
        setPendingSymbol(sym);
        pendingSymbolRef.current = sym;
    }, []);

    const clearPending = useCallback(() => {
        setPendingSymbol('');
        pendingSymbolRef.current = '';
    }, []);

    const applySwitch = useCallback((sym: string) => {
        currentBestRef.current = sym;
        clearPending();
        // 1. Runtime override — used by Purchase.js applyAlternateMarketsToCurrentTradeOptions
        try { window.DBot = window.DBot || {}; (window.DBot as any).__force_symbol = sym; } catch (_) {}
        // 2. QuickStrategy store — may or may not exist depending on the active tab
        try { const rs = (window as any).__store_instance; if (rs?.quick_strategy) rs.quick_strategy.setValue('symbol', sym); } catch (_) {}
        // 3. Blockly workspace — updates the trade_definition_market SYMBOL_LIST field.
        //    The block's onchange handler will call DBotStore.instance.dashboard.setBotBuilderSymbol automatically.
        try {
            const ws = (window as any).Blockly?.derivWorkspace;
            if (ws) {
                const b = ws.getAllBlocks().find((bl: any) => bl.type === 'trade_definition_market');
                if (b) b.setFieldValue('SYMBOL_LIST', sym);
            }
        } catch (_) {}
        // 4. Dashboard store — update directly via DBotStore.instance (the canonical access pattern).
        try {
            const store = DBotStore.instance;
            if (store?.dashboard?.setBotBuilderSymbol) store.dashboard.setBotBuilderSymbol(sym);
        } catch (_) {}
        (window as any).__makoti_lastContractSettled = false;
        showNotify(`Volatility Updated: ${SYMBOL_LABELS[sym]}`, 'success');
    }, [showNotify, clearPending]);

    const cleanup = useCallback(() => {
        try { wsRef.current?.close(); } catch (_) {}
        wsRef.current = null;
    }, []);

    const loadBotToBuilder = useCallback(async () => {
        if (!topPrediction) return;
        const xml = ENTRY_BOT_TEMPLATE
            .replace('__SYMBOL__', topPrediction.symbol)
            .replace('__NORMAL_PRED__', String(topPrediction.barrier))
            .replace('__ENTRY_DIGIT__', String(topPrediction.entryDigit))
            .replace('__STAKE__', entryStake)
            .replace('__TAKE_PROFIT__', entryTP)
            .replace('__STOP_LOSS__', entrySL)
            .replace(/__CONTRACT_TYPE__/g, topPrediction.contractType);
        try {
            const store = DBotStore.instance;
            if (store?.load_modal) {
                await store.load_modal.loadStrategyToBuilder(
                    { id: `entry_bot_${Date.now()}`, xml, name: `${topPrediction.label} — D${topPrediction.entryDigit} ${topPrediction.contractType} ${topPrediction.barrier}`, save_type: 'pending' },
                    true
                );
                showNotify('Bot loaded into workspace!', 'success');
                (window.DBot as any)?.__minimizeWidget?.();
            }
        } catch (e: any) {
            showNotify(`Failed to load bot: ${e.message}`, 'warn');
        }
    }, [topPrediction, entryStake, entryTP, entrySL, showNotify]);

    /* ── Create persistent WS (reused across auto-scan cycles) ──────────── */
    const ensureWs = useCallback(() => {
        if (wsRef.current && wsRef.current.isOpen()) return wsRef.current;
        cleanup();
        const sendTicksRequest = () => {
            if (!window._newSystemWS || window._newSystemWS.readyState !== WebSocket.OPEN) return;
            const bot = botRef.current;
            const count = bot === 'pvty_kill' ? 1000 : bot === 'entry_digit' ? 1500 : 60;
            const syms = symbolsToScanRef.current;
            setProgress(`Fetching ${count} ticks from ${syms.length === 1 ? SYMBOL_LABELS[syms[0]] : `${syms.length} volatilities`}…`);
            syms.forEach(sym => {
                window._newSystemWS.send(JSON.stringify({ ticks_history: sym, count, end: 'latest', style: 'ticks' }));
            });
        };
        const mws = openMakotiWS(
            (data) => msgHandlerRef.current(data),
            () => { if (scanningRef.current) sendTicksRequest(); },
            () => { cancelScanRef.current?.(); },
            { skipAuth: true }
        );
        wsRef.current = mws;
        return mws;
    }, [cleanup]);

    /* ── Perform a single scan ──────────────────────────────────────────── */
    const performScan = useCallback((initial = false) => {
        if (scanningRef.current) return;
        const currentBot = botRef.current;
        cancelScanRef.current = null;
        scanningRef.current = true;
        setScanning(true);
        setProgress('Connecting to Deriv API…');
        if (initial) { setResults([]); setBestSymbols([]); setTopPrediction(null); }

        let finalized = false;
        symbolsToScanRef.current = singleVolRef.current ? [singleVolSymbolRef.current] : ALL_SYMBOLS;
        const symbolsToScan = symbolsToScanRef.current;
        pendingRef.current = new Set(symbolsToScan);
        collectedRef.current = new Map();
        const timeoutMs = currentBot === 'pvty_kill' ? 20000 : currentBot === 'entry_digit' ? 45000 : 10000;
        const scanTimeout = setTimeout(() => {
            if (!finalized) finalize();
        }, timeoutMs);

        msgHandlerRef.current = (data: any) => {
            if (data.error) {
                if (data.msg_type === 'history') {
                    const sym: string = data.echo_req?.ticks_history;
                if (sym && pendingRef.current.has(sym)) {
                    pendingRef.current.delete(sym);
                    setProgress(`Fetched ${symbolsToScan.length - pendingRef.current.size} / ${symbolsToScan.length}…`);
                    if (pendingRef.current.size === 0 && !finalized) { clearTimeout(scanTimeout); finalize(); }
                }
            }
            return;
        }
        if (data.msg_type === 'history' && data.history?.prices) {
            const sym: string = data.echo_req?.ticks_history;
            if (!sym || !pendingRef.current.has(sym)) return;
            pendingRef.current.delete(sym);
            collectedRef.current.set(sym, data.history.prices.map(Number));
            setProgress(`Fetched ${symbolsToScan.length - pendingRef.current.size} / ${symbolsToScan.length}…`);
            if (pendingRef.current.size === 0 && !finalized) { clearTimeout(scanTimeout); finalize(); }
            }
        };

        const finalize = () => {
            if (finalized) return;
            finalized = true;
            cancelScanRef.current = null;
            clearTimeout(scanTimeout);

            let best: string[] = [];
            let bestScore = 0;
            if (currentBot === 'pvty_kill') {
                const scanResults: SymbolDigitResult[] = [];
                collectedRef.current.forEach((prices: number[], sym) => {
                    if (!prices || prices.length < 100) return;
                    const pipSize = PIP_SIZES[sym] || 2;
                    const digits = prices.map(p => Number(Number(p).toFixed(pipSize).slice(-1)));
                    const pcts = calcDigitPcts(digits);
                    const qualifies = pcts[7] < 10 && pcts[8] < 10 && pcts[9] < 10;
                    scanResults.push({
                        symbol: sym, label: SYMBOL_LABELS[sym],
                        pcts, totalTicks: prices.length,
                        qualifies,
                        detail: qualifies ? '✅ 7,8,9 below 10%' : `7:${pcts[7].toFixed(1)}% 8:${pcts[8].toFixed(1)}% 9:${pcts[9].toFixed(1)}%`,
                    });
                });
                scanResults.sort((a, b) => {
                    /* First: qualifying volatilities (all three below 10%) come first */
                    if (a.qualifies && !b.qualifies) return -1;
                    if (!a.qualifies && b.qualifies) return 1;
                    /* Then: lowest sum of 7+8+9 wins */
                    return (a.pcts[7] + a.pcts[8] + a.pcts[9]) - (b.pcts[7] + b.pcts[8] + b.pcts[9]);
                });
                best = scanResults.map(r => r.symbol);
                bestScore = Math.round(Math.max(scanResults[0]?.pcts[7] ?? 0, scanResults[0]?.pcts[8] ?? 0, scanResults[0]?.pcts[9] ?? 0));
                setResults(scanResults);
                setBestSymbols(best.slice(0, 3));
            } else if (currentBot === 'entry_digit') {
                // Entry Digit Trigger Analysis — progressive, one volatility at a time
                const entryType = botRef.current === 'entry_digit' ? entryContractTypeRef.current : 'DIGITOVER';
                const entryBar = botRef.current === 'entry_digit' ? entryBarrierRef.current : 3;

                const symbols = Array.from(collectedRef.current.entries()).filter(([, p]) => p && p.length >= 30);
                const scanResults: TriggerDigitResult[] = [];
                let idx = 0;

                const analyzeNext = () => {
                    if (idx >= symbols.length) {
                        // Done — sort and finalize
                        scanResults.sort((a, b) => {
                            if (a.qualifies && !b.qualifies) return -1;
                            if (!a.qualifies && b.qualifies) return 1;
                            return (b.triggers[0]?.confidence ?? 0) - (a.triggers[0]?.confidence ?? 0);
                        });
                        best = scanResults.map(r => r.symbol);
                        bestScore = Math.round(scanResults[0]?.triggers[0]?.confidence ?? 0);
                        setResults(scanResults);
                        setBestSymbols(best.slice(0, 3));
                        setScanning(false);
                        scanningRef.current = false;

                        // Show prediction
                        const topResult = scanResults[0];
                        const topTrigger = topResult?.triggers[0];
                        if (topTrigger) {
                            const trendLabel = topTrigger.patternTrend.trend === 'strengthening' ? 'STRENGTHENING'
                                : topTrigger.patternTrend.trend === 'weakening' ? 'WEAKENING'
                                : topTrigger.patternTrend.trend === 'new' ? 'NEW PATTERN'
                                : topTrigger.patternTrend.trend === 'dying' ? 'DYING' : 'STABLE';
                            setProgress(`PREDICTION → ${topResult.label} | Entry Digit: Digit ${topTrigger.digit} | ${trendLabel} | Score: ${topTrigger.confidence.toFixed(0)}/100 | ${topTrigger.significance === 'high' ? '★ SIGNIFICANT' : topTrigger.significance === 'medium' ? '◆ MODERATE' : topTrigger.significance === 'low' ? '○ MARGINAL' : '× NOISE'}`);
                            setTopPrediction({
                                symbol: topResult.symbol, label: topResult.label,
                                entryDigit: topTrigger.digit,
                                contractType: entryContractTypeRef.current,
                                barrier: entryBarrierRef.current,
                            });
                        } else {
                            setProgress('No strong trigger pattern found');
                            setTopPrediction(null);
                        }
                        cleanup();
                        return;
                    }

                    const [sym, prices] = symbols[idx];
                    const pipSize = PIP_SIZES[sym] || 2;
                    const digits = prices.map(p => Number(Number(p).toFixed(pipSize).slice(-1)));
                    const analysis = analyzeTriggerDigits(digits, entryType, entryBar, prices);

                    const bestTrigger = analysis.triggers[0];
                    const qualifies = bestTrigger !== undefined && bestTrigger.confidence >= 40 && bestTrigger.significance !== 'none';
                    const detail = bestTrigger
                        ? `Best: D${bestTrigger.digit} (${bestTrigger.occurrences}x) | ${bestTrigger.boost.toFixed(1)}% boost | ${bestTrigger.consistency.toFixed(0)}% consistent | Score: ${bestTrigger.confidence.toFixed(0)}/100`
                        : 'No strong trigger found';

                    scanResults.push({
                        symbol: sym, label: SYMBOL_LABELS[sym],
                        baselinePcts: analysis.baselinePcts,
                        baselineWinPct: analysis.baselineWinPct,
                        triggers: analysis.triggers,
                        qualifies,
                        detail,
                    });

                    idx++;
                    setProgress(`Analyzing ${SYMBOL_LABELS[sym]}… (${idx}/${symbols.length})`);
                    setResults([...scanResults]);

                    setTimeout(analyzeNext, 400);
                };

                // Start progressive analysis after a small delay
                setTimeout(analyzeNext, 100);
                return; // Exit finalize early — analysis continues async
            } else {
                const scanResults: SymbolDirectionResult[] = [];
                collectedRef.current.forEach((prices: number[], sym) => {
                    if (!prices || prices.length < 5) return;
                    const a = calcMicroChoppiness(prices);
                    a.symbol = sym; a.label = SYMBOL_LABELS[sym];
                    scanResults.push(a);
                });
                scanResults.sort((a, b) => b.choppinessScore - a.choppinessScore);
                best = scanResults.map(r => r.symbol);
                bestScore = scanResults[0]?.choppinessScore ?? 0;
                setResults(scanResults);
                setBestSymbols(best.slice(0, 3));
            }

            setScanning(false);
            scanningRef.current = false;

            const bestSym = best[0] || '';
            const bestLabel = bestSym ? SYMBOL_LABELS[bestSym] : '—';

            if (currentBot === 'rf_v4') {
                if (bestSym && bestSym !== currentBestRef.current && autoSwitchRef.current) {
                    if ((window as any).__makoti_lastContractSettled) {
                        applySwitch(bestSym);
                    } else {
                        setPending(bestSym);
                        showNotify(`Waiting for contract settlement to switch to ${bestLabel}…`, 'warn');
                    }
                }

                const ps = pendingSymbolRef.current;
                if (ps && (window as any).__makoti_lastContractSettled && autoSwitchRef.current) {
                    if (best.indexOf(ps) >= 0) applySwitch(ps);
                    else clearPending();
                }

                if (autoSwitchRef.current) {
                    const p = pendingSymbolRef.current;
                    setProgress(p ? `Auto: Pending ${SYMBOL_LABELS[p]} (wait settle)` : `Auto: Best ${bestLabel} (${bestScore}%)`);
                } else {
                    setProgress(`Top: ${bestLabel} (${bestScore}%)`);
                    cleanup();
                }
            } else if (currentBot === 'entry_digit') {
                const entryResults = results as TriggerDigitResult[];
                const bestTrigger = entryResults[0]?.triggers[0];
                if (bestTrigger) {
                    const curType = entryContractTypeRef.current;
                    const curBar = entryBarrierRef.current;
                    const winDigits = curType === 'DIGITOVER'
                        ? `${curBar + 1}-9`
                        : `0-${curBar - 1}`;
                    setProgress(`Best: ${bestLabel} | Trigger: D${bestTrigger.digit} → +${bestTrigger.boost.toFixed(1)}% boost on ${winDigits} | ${bestTrigger.consistency.toFixed(0)}% consistent`);
                } else {
                    setProgress('No strong trigger pattern found across volatilities');
                }
                cleanup();
            } else {
                setProgress(`Top: ${bestLabel} (max 7/8/9: ${bestScore}%)`);
                cleanup();
            }
        };
        cancelScanRef.current = finalize;

        const mws = ensureWs();
        if (mws.isOpen()) {
            if (currentBot === 'pvty_kill') {
                setProgress(`Fetching 1000 ticks from ${symbolsToScan.length === 1 ? SYMBOL_LABELS[symbolsToScan[0]] : `${symbolsToScan.length} volatilities`}…`);
                symbolsToScan.forEach(sym => mws.send({ ticks_history: sym, count: 1000, end: 'latest', style: 'ticks' }));
            } else if (currentBot === 'entry_digit') {
                setProgress(`Fetching 1500 ticks from ${symbolsToScan.length === 1 ? SYMBOL_LABELS[symbolsToScan[0]] : `${symbolsToScan.length} volatilities`}…`);
                symbolsToScan.forEach(sym => mws.send({ ticks_history: sym, count: 1500, end: 'latest', style: 'ticks' }));
            } else {
                setProgress(`Fetching 60 ticks from ${symbolsToScan.length === 1 ? SYMBOL_LABELS[symbolsToScan[0]] : `${symbolsToScan.length} volatilities`}…`);
                symbolsToScan.forEach(sym => mws.send({ ticks_history: sym, count: 60, end: 'latest', style: 'ticks' }));
            }
        }
        // If not open yet, ensureWs will trigger onReady → which fires the requests
    }, [cleanup, ensureWs, showNotify, applySwitch, setPending, clearPending]);

    /* ── Manual analyze button ──────────────────────────────────────────── */
    const analyze = useCallback(() => {
        if (scanningRef.current) return;
        botRef.current = bot;

        if (autoSwitch && bot === 'rf_v4') {
            currentBestRef.current = '';
            clearPending();
            autoSwitchRef.current = true;
            setAutoSwitcherActive(true);
            startPocListener();
            if (intervalRef.current) clearInterval(intervalRef.current);
            intervalRef.current = setInterval(() => performScan(false), 3000);
            performScan(true); // initial scan with results cleared
        } else {
            autoSwitchRef.current = false;
            setAutoSwitcherActive(false);
            stopPocListener();
            if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
            performScan(true);
        }
    }, [bot, autoSwitch, performScan, clearPending]);

    /* ── Toggle auto-switcher ───────────────────────────────────────────── */
    const toggleAutoSwitch = useCallback(() => {
        setAutoSwitch(prev => {
            if (prev) {
                autoSwitchRef.current = false;
                setAutoSwitcherActive(false);
                clearPending();
                currentBestRef.current = '';
                stopPocListener();
                if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
            }
            return !prev;
        });
    }, [clearPending]);

    useEffect(() => {
        return () => {
            autoSwitchRef.current = false;
            stopPocListener();
            if (intervalRef.current) clearInterval(intervalRef.current);
            try { wsRef.current?.close(); } catch (_) {}
        };
    }, []);

    return (
        <div className='mw-scanner scanner-theme'>
            {notification && (
                <div className={`mw-scanner__notif mw-scanner__notif--${notification.type}`}>{notification.msg}</div>
            )}
            <div className='mw-scanner__controls'>
                <div className='mw-field'>
                    <label className='mw-label'>Bot Selection</label>
                    <MwSelect value={bot} options={[
                        { value: 'pvty_kill', label: 'Poverty Killer' },
                        { value: 'rf_v4', label: 'Rise/Fall V4' },
                        { value: 'entry_digit', label: 'Entry Digit' },
                    ]}
                        onChange={v => setBot(v as BotId)} disabled={scanning} />
                </div>
                <div className='mw-scanner__desc'>
                    {bot === 'pvty_kill'
                        ? 'Scans 1 000 ticks per volatility. Finds markets where digits 7, 8 and 9 each stay below 10%.'
                        : bot === 'entry_digit'
                        ? 'Deep trigger analysis — finds which digit appearance causes winning digits to surge. Provides the perfect entry trigger digit for your contract.'
                        : 'Analyses 60 recent ticks per volatility (current candle). Finds choppy micro-markets — auto-switches every 3s.'}
                </div>
                {bot === 'entry_digit' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
                        <div className='mw-field'>
                            <label className='mw-label'>Stake ($)</label>
                            <input className='mw-input' type='number' min='0.35' step='0.01'
                                value={entryStake}
                                onChange={e => setEntryStake(e.target.value)}
                                disabled={scanning} />
                        </div>
                        <div className='mw-field'>
                            <label className='mw-label'>Contract Type</label>
                            <MwSelect value={entryContractType} options={[
                                { value: 'DIGITOVER', label: 'OVER' },
                                { value: 'DIGITUNDER', label: 'UNDER' },
                            ]}
                                onChange={v => setEntryContractType(v as 'DIGITOVER' | 'DIGITUNDER')} disabled={scanning} />
                        </div>
                        <div className='mw-field'>
                            <label className='mw-label'>Barrier Digit</label>
                            <input className='mw-input' type='number' min={0} max={9}
                                defaultValue={entryBarrier}
                                key={entryBarrier}
                                onChange={e => {
                                    const v = parseInt(e.target.value);
                                    if (!isNaN(v) && v >= 0 && v <= 9) setEntryBarrier(v);
                                }}
                                disabled={scanning}
                                style={{ width: 60, textAlign: 'center' }} />
                        </div>
                        <div className='mw-field'>
                            <label className='mw-label'>Take Profit ($)</label>
                            <input className='mw-input' type='number' min='1' step='1'
                                value={entryTP}
                                onChange={e => setEntryTP(e.target.value)}
                                disabled={scanning} />
                        </div>
                        <div className='mw-field'>
                            <label className='mw-label'>Stop Loss ($)</label>
                            <input className='mw-input' type='number' min='1' step='1'
                                value={entrySL}
                                onChange={e => setEntrySL(e.target.value)}
                                disabled={scanning} />
                        </div>
                    </div>
                )}
                {bot === 'rf_v4' && (
                    <label className='mw-switch-row'>
                        <span className='mw-switch-label'>Auto Switcher</span>
                        <div className='mw-toggle' onClick={toggleAutoSwitch}>
                            <div className={`mw-toggle__track${autoSwitch ? ' mw-toggle__track--on' : ''}`}>
                                <div className={`mw-toggle__thumb${autoSwitch ? ' mw-toggle__thumb--on' : ''}`} />
                            </div>
                        </div>
                        {autoSwitcherActive && <span className='mw-switch-active'>ACTIVE</span>}
                        {pendingSymbol && <span className='mw-switch-pending'>⏳ WIN REQUIRED</span>}
                    </label>
                )}
                <label className='mw-switch-row'>
                    <span className='mw-switch-label'>Single Volatility</span>
                    <div className='mw-toggle' onClick={() => { if (!scanning) setSingleVol(v => !v); }}>
                        <div className={`mw-toggle__track${singleVol ? ' mw-toggle__track--on' : ''}`}>
                            <div className={`mw-toggle__thumb${singleVol ? ' mw-toggle__thumb--on' : ''}`} />
                        </div>
                    </div>
                </label>
                {singleVol && (
                    <div className='mw-field' style={{ marginBottom: 6 }}>
                        <label className='mw-label'>Volatility</label>
                        <MwSelect value={singleVolSymbol}
                            options={ALL_SYMBOLS.map(s => ({ value: s, label: SYMBOL_LABELS[s] }))}
                            onChange={v => setSingleVolSymbol(v)} disabled={scanning} />
                    </div>
                )}
                <button className={`mw-btn mw-btn--scan${scanning ? ' mw-btn--busy' : ''}`} onClick={analyze} disabled={scanning}>
                    {scanning ? <><span className='mw-spin' /> Analyzing…</> : 'Analyze'}
                </button>
                {progress && (
                    <div className='mw-scanner__progress' style={progress.startsWith('PREDICTION') ? {
                        background: '#1a3d1a', border: '1px solid #4caf50', borderRadius: 4,
                        padding: 8, marginTop: 6, fontSize: 12, color: '#fff', fontWeight: 'bold',
                    } : {}}>
                        {progress.startsWith('PREDICTION') ? (() => {
                            const parts = progress.replace('PREDICTION → ', '').split(' | ');
                            return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {parts.map((p, i) => <span key={i}>{p}</span>)}
                                </div>
                            );
                        })() : progress}
                    </div>
                )}
                {topPrediction && !scanning && (
                    <button className='mw-btn' onClick={loadBotToBuilder}
                        style={{ marginTop: 6, background: '#2196f3', color: '#fff', fontWeight: 'bold', width: '100%' }}>
                        Load Bot to Workspace
                    </button>
                )}
            </div>
            {results.length > 0 && (
                <div className='mw-scanner__results'>
                    <div className='mw-scanner__results-head'>
                        {bot === 'pvty_kill'
                            ? 'Digit 7 / 8 / 9 Distribution (1 000 ticks)'
                            : bot === 'entry_digit'
                            ? `Entry Digit Trigger Analysis (1500 ticks) — ${entryContractType === 'DIGITOVER' ? 'OVER' : 'UNDER'} ${entryBarrier}`
                            : `Micro-Choppiness (current candle, 60 ticks) ${autoSwitcherActive ? '— Auto-switching ON' : ''}`}
                    </div>
                    {bestSymbols.length > 0 && (
                        <div className='mw-scanner__best'>
                            <span className='mw-scanner__best-lbl'>Best:</span>
                            {bestSymbols.map(s => <span key={s} className='mw-scanner__badge'>{SYMBOL_LABELS[s]}</span>)}
                        </div>
                    )}
                    <div className='mw-scanner__list'>
                        {results.map((r, idx) => (
                            <div key={r.symbol} className={`mw-scanner__row${idx === 0 ? ' mw-scanner__row--match' : ''}`}>
                                <div className='mw-scanner__row-head'>
                                    <span className='mw-scanner__sym'>{r.label}</span>
                                    <span className='mw-scanner__row-detail'>{r.detail}</span>
                                    {idx === 0 && <span className='mw-scanner__tag'>BEST</span>}
                                </div>
                                {isDigitResult(r) && (
                                    <div className='mw-scanner__bars'>
                                        {r.pcts.map((p, i) => (
                                            <div key={i} className={`mw-scanner__bar-wrap${[7, 8, 9].includes(i) ? ' mw-scanner__bar-wrap--hi' : ''}`} title={`Digit ${i}: ${p.toFixed(2)}%`}>
                                                <div className='mw-scanner__bar-fill' style={{ height: `${Math.min(100, p * 4)}%` }} />
                                                <span className='mw-scanner__bar-pct'>{p.toFixed(1)}%</span>
                                                <span className='mw-scanner__bar-lbl'>{i}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {isTriggerResult(r) && (
                                    <div style={{ padding: '4px 0' }}>
                                        {/* Baseline digit distribution */}
                                        <div style={{ fontSize: 9, color: '#888', marginBottom: 4 }}>
                                            Baseline (1500 ticks) — Win rate: <span style={{ color: '#ffd700' }}>{r.baselineWinPct.toFixed(1)}%</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: 3, marginBottom: 8, flexWrap: 'wrap' }}>
                                            {r.baselinePcts.map((p, i) => {
                                                const isWin = entryContractType === 'DIGITOVER' ? i > entryBarrier : i < entryBarrier;
                                                return (
                                                    <div key={i} style={{
                                                        background: isWin ? '#1a3d1a' : '#2d1a1a',
                                                        border: `1px solid ${isWin ? '#4caf50' : '#666'}`,
                                                        borderRadius: 3, padding: '1px 4px', fontSize: 8, textAlign: 'center',
                                                        minWidth: 32,
                                                    }}>
                                                        <div style={{ color: isWin ? '#4caf50' : '#f44336', fontWeight: 'bold' }}>D{i}</div>
                                                        <div style={{ color: '#ccc' }}>{p.toFixed(1)}%</div>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Top triggers with full percentage comparison */}
                                        {r.triggers.slice(0, 3).map((t, ti) => {
                                            const trendColor = t.patternTrend.trend === 'strengthening' ? '#4caf50'
                                                : t.patternTrend.trend === 'weakening' ? '#f44336'
                                                : t.patternTrend.trend === 'new' ? '#2196f3'
                                                : t.patternTrend.trend === 'dying' ? '#ff9800' : '#888';
                                            const trendLabel = t.patternTrend.trend === 'strengthening' ? '↑ STRENGTHENING'
                                                : t.patternTrend.trend === 'weakening' ? '↓ WEAKENING'
                                                : t.patternTrend.trend === 'new' ? '★ NEW'
                                                : t.patternTrend.trend === 'dying' ? '✕ DYING' : '→ STABLE';
                                            return (
                                            <div key={t.digit} style={{
                                                background: ti === 0 ? '#0f1f0f' : '#111',
                                                border: `2px solid ${ti === 0 ? '#4caf50' : '#333'}`,
                                                borderRadius: 6, padding: 10, marginBottom: 8,
                                            }}>
                                                {/* Big trigger digit + boost */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                                                    <div style={{
                                                        width: 52, height: 52, borderRadius: 8,
                                                        background: '#ffd700', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        flexDirection: 'column', flexShrink: 0,
                                                    }}>
                                                        <div style={{ fontSize: 8, color: '#000', fontWeight: 'bold' }}>TRIGGER</div>
                                                        <div style={{ fontSize: 22, color: '#000', fontWeight: 'bold', lineHeight: 1 }}>D{t.digit}</div>
                                                    </div>
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                                                            <span style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>
                                                                {r.baselineWinPct.toFixed(0)}% → {t.avgWinPctAfter.toFixed(0)}% win rate
                                                            </span>
                                                            <span style={{ color: t.boost > 10 ? '#4caf50' : '#ff9800', fontSize: 14, fontWeight: 'bold' }}>
                                                                +{t.boost.toFixed(1)}%
                                                            </span>
                                                        </div>
                                                        <div style={{ display: 'flex', gap: 12, fontSize: 9, color: '#888' }}>
                                                            <span>{t.occurrences}x appeared</span>
                                                            <span>{t.consistency.toFixed(0)}% consistent</span>
                                                            <span style={{ color: trendColor, fontWeight: 'bold' }}>{trendLabel}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Digit shift bars - visual comparison */}
                                                <div style={{ fontSize: 9, color: '#aaa', marginBottom: 6 }}>
                                                    After D{t.digit}, digit distribution shifts:
                                                </div>
                                                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                                    {t.digitShifts.filter(s => Math.abs(s.shift) > 1).sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift)).map(s => {
                                                        const isWin = entryContractType === 'DIGITOVER' ? s.digit > entryBarrier : s.digit < entryBarrier;
                                                        const isPositive = isWin ? s.shift > 0 : s.shift < 0;
                                                        return (
                                                            <div key={s.digit} style={{
                                                                background: '#0d0d1a', border: '1px solid #333',
                                                                borderRadius: 4, padding: '4px 8px', textAlign: 'center', minWidth: 55,
                                                            }}>
                                                                <div style={{ fontSize: 10, fontWeight: 'bold', color: isWin ? '#4caf50' : '#f44336' }}>D{s.digit}</div>
                                                                <div style={{ fontSize: 8, color: '#666' }}>{s.before.toFixed(0)}% → {s.after.toFixed(0)}%</div>
                                                                <div style={{ fontSize: 11, fontWeight: 'bold', color: isPositive ? '#4caf50' : '#f44336' }}>
                                                                    {s.shift > 0 ? '+' : ''}{s.shift.toFixed(1)}%
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {/* Confidence + Momentum + Decay peak + Significance */}
                                                <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                                    <div style={{
                                                        background: t.confidence >= 60 ? '#1a3d1a' : t.confidence >= 40 ? '#3d3a1a' : '#3d1a1a',
                                                        border: `1px solid ${t.confidence >= 60 ? '#4caf50' : t.confidence >= 40 ? '#ffc107' : '#f44336'}`,
                                                        borderRadius: 4, padding: '3px 8px', fontSize: 10, fontWeight: 'bold',
                                                        color: t.confidence >= 60 ? '#4caf50' : t.confidence >= 40 ? '#ffc107' : '#f44336',
                                                    }}>
                                                        Score: {t.confidence.toFixed(0)}/100
                                                    </div>
                                                    <div style={{
                                                        background: t.significance === 'high' ? '#1a3d1a' : t.significance === 'medium' ? '#3d3a1a' : t.significance === 'low' ? '#3d2a1a' : '#3d1a1a',
                                                        border: `1px solid ${t.significance === 'high' ? '#4caf50' : t.significance === 'medium' ? '#ffc107' : t.significance === 'low' ? '#ff9800' : '#f44336'}`,
                                                        borderRadius: 4, padding: '3px 8px', fontSize: 10, fontWeight: 'bold',
                                                        color: t.significance === 'high' ? '#4caf50' : t.significance === 'medium' ? '#ffc107' : t.significance === 'low' ? '#ff9800' : '#f44336',
                                                    }}>
                                                        {t.significance === 'high' ? '★ SIGNIFICANT' : t.significance === 'medium' ? '◆ MODERATE' : t.significance === 'low' ? '○ MARGINAL' : '× NOISE'}
                                                        {t.pValue < 1 && <span style={{ opacity: 0.7 }}> (p={t.pValue.toFixed(3)})</span>}
                                                    </div>
                                                    <div style={{
                                                        background: t.momentum.overallMomentum > 0 ? '#1a3d1a' : '#3d1a1a',
                                                        border: `1px solid ${t.momentum.overallMomentum > 0 ? '#4caf50' : '#f44336'}`,
                                                        borderRadius: 4, padding: '3px 8px', fontSize: 10,
                                                        color: t.momentum.overallMomentum > 0 ? '#4caf50' : '#f44336',
                                                    }}>
                                                        Momentum: {t.momentum.overallMomentum > 0 ? '+' : ''}{t.momentum.overallMomentum.toFixed(1)}%
                                                    </div>
                                                    <div style={{
                                                        background: '#1a1a3d', border: '1px solid #666',
                                                        borderRadius: 4, padding: '3px 8px', fontSize: 10, color: '#aaa',
                                                    }}>
                                                        Peak: tick {t.bestEntryWindow.start}-{t.bestEntryWindow.end} @ {t.bestEntryWindow.peakWinPct.toFixed(0)}%
                                                    </div>
                                                </div>

                                                {/* Digit surge info: which specific digits are boosted */}
                                                {t.digitSurges.length > 0 && (
                                                    <div style={{ marginTop: 6, fontSize: 9, color: '#888' }}>
                                                        Digits that surge after D{t.digit}:{' '}
                                                        {t.digitSurges.slice(0, 5).map((s, si) => (
                                                            <span key={s.digit} style={{
                                                                color: (entryContractType === 'DIGITOVER' ? s.digit > entryBarrier : s.digit < entryBarrier) ? '#4caf50' : '#888',
                                                                fontWeight: si === 0 ? 'bold' : 'normal',
                                                            }}>
                                                                D{s.digit}+{s.surgePct.toFixed(1)}%{si < Math.min(t.digitSurges.length, 5) - 1 ? ', ' : ''}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Trend detail */}
                                                <div style={{ marginTop: 4, fontSize: 8, color: '#555' }}>
                                                    First 50 ticks: {t.patternTrend.olderBoost > 0 ? '+' : ''}{t.patternTrend.olderBoost.toFixed(1)}% boost ({t.patternTrend.olderOccurrences}x)
                                                    {' | '}
                                                    Last 50 ticks: {t.patternTrend.recentBoost > 0 ? '+' : ''}{t.patternTrend.recentBoost.toFixed(1)}% boost ({t.patternTrend.recentOccurrences}x)
                                                </div>

                                                {/* ── TIER 2: Trajectory Visualization ── */}
                                                <div style={{ marginTop: 8, background: '#0a0a1a', border: '1px solid #333', borderRadius: 4, padding: 6 }}>
                                                    <div style={{ fontSize: 9, color: '#ffd700', fontWeight: 'bold', marginBottom: 4 }}>
                                                        DIGIT TRAJECTORIES (15 windows × 100 ticks)
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                                        {t.trajectory.slopes.map((slope, d) => {
                                                            const accel = t.trajectory.acceleration[d];
                                                            const stab = t.trajectory.stability[d];
                                                            const arrow = slope > 0.3 ? '▲' : slope < -0.3 ? '▼' : '─';
                                                            const accelArrow = accel > 0.2 ? '↗' : accel < -0.2 ? '↘' : '';
                                                            const color = slope > 0.3 ? '#4caf50' : slope < -0.3 ? '#f44336' : '#888';
                                                            const isTriggerD = d === t.digit;
                                                            return (
                                                                <div key={d} style={{
                                                                    background: isTriggerD ? '#1a1a0d' : '#0d0d1a',
                                                                    border: `1px solid ${isTriggerD ? '#ffd700' : '#333'}`,
                                                                    borderRadius: 3, padding: '3px 6px', textAlign: 'center', minWidth: 42,
                                                                }}>
                                                                    <div style={{ fontSize: 8, color: isTriggerD ? '#ffd700' : '#666', fontWeight: 'bold' }}>D{d}</div>
                                                                    <div style={{ fontSize: 14, color, lineHeight: 1 }}>{arrow}</div>
                                                                    <div style={{ fontSize: 7, color: '#666' }}>
                                                                        {slope > 0 ? '+' : ''}{slope.toFixed(2)}%{accelArrow}
                                                                    </div>
                                                                    <div style={{ fontSize: 6, color: '#555' }}>stab:{stab}</div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                {/* ── TIER 2: Cross-Digit Influence Matrix ── */}
                                                <div style={{ marginTop: 6, background: '#0a0a1a', border: '1px solid #333', borderRadius: 4, padding: 6 }}>
                                                    <div style={{ fontSize: 9, color: '#2196f3', fontWeight: 'bold', marginBottom: 4 }}>
                                                        CROSS-DIGIT INFLUENCE (D{t.digit} → others)
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                                        {t.crossDigit.matrix[t.digit].map((influence, tgt) => {
                                                            const isWin = entryContractType === 'DIGITOVER' ? tgt > entryBarrier : tgt < entryBarrier;
                                                            const absInf = Math.abs(influence);
                                                            const bgColor = absInf > 3 ? (influence > 0 ? '#0d2d0d' : '#2d0d0d') : '#0d0d1a';
                                                            const borderColor = absInf > 3 ? (influence > 0 ? '#4caf50' : '#f44336') : '#333';
                                                            return (
                                                                <div key={tgt} style={{
                                                                    background: bgColor, border: `1px solid ${borderColor}`,
                                                                    borderRadius: 3, padding: '3px 5px', textAlign: 'center', minWidth: 42,
                                                                }}>
                                                                    <div style={{ fontSize: 8, color: isWin ? '#4caf50' : '#f44336', fontWeight: 'bold' }}>D{tgt}</div>
                                                                    <div style={{ fontSize: 10, fontWeight: 'bold', color: influence > 0 ? '#4caf50' : influence < 0 ? '#f44336' : '#888' }}>
                                                                        {influence > 0 ? '+' : ''}{influence.toFixed(1)}%
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    <div style={{ marginTop: 4, fontSize: 8, color: '#666' }}>
                                                        {t.crossDigit.dominantEffects} digits significantly affected | net: {t.crossDigit.netEffect > 0 ? '+' : ''}{t.crossDigit.netEffect.toFixed(1)}%
                                                    </div>
                                                </div>

                                                {/* ── TIER 2: Dominance + Predictive ── */}
                                                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                    {/* Dominance Rank */}
                                                    <div style={{
                                                        background: '#0d1a0d', border: '1px solid #4caf50',
                                                        borderRadius: 4, padding: '4px 8px', fontSize: 9, flex: 1, minWidth: 120,
                                                    }}>
                                                        <div style={{ color: '#4caf50', fontWeight: 'bold', marginBottom: 2 }}>
                                                            DOMINANCE
                                                        </div>
                                                        <div style={{ color: '#ccc' }}>
                                                            Trigger D{t.digit} ranked <span style={{ color: '#ffd700', fontWeight: 'bold' }}>#{t.dominance.triggerRank}</span> / 10
                                                        </div>
                                                        <div style={{ color: '#888', fontSize: 8 }}>
                                                            Dominant: D{t.dominance.currentDominant} | Suppressed: D{t.dominance.currentSuppressed}
                                                        </div>
                                                        <div style={{ color: t.dominance.dominanceShift > 0 ? '#4caf50' : '#f44336', fontSize: 8 }}>
                                                            Shift: {t.dominance.dominanceShift > 0 ? '↑ gaining' : t.dominance.dominanceShift < 0 ? '↓ losing' : '→ stable'}
                                                            {t.dominance.suppressionRelief > 0 && ` | Relief: +${t.dominance.suppressionRelief.toFixed(1)}%`}
                                                        </div>
                                                    </div>

                                                    {/* Predictive Accuracy */}
                                                    <div style={{
                                                        background: t.predictive.predictionAccuracy > 70 ? '#0d1a0d' : t.predictive.predictionAccuracy > 40 ? '#1a1a0d' : '#1a0d0d',
                                                        border: `1px solid ${t.predictive.predictionAccuracy > 70 ? '#4caf50' : t.predictive.predictionAccuracy > 40 ? '#ffc107' : '#f44336'}`,
                                                        borderRadius: 4, padding: '4px 8px', fontSize: 9, flex: 1, minWidth: 120,
                                                    }}>
                                                        <div style={{
                                                            color: t.predictive.predictionAccuracy > 70 ? '#4caf50' : t.predictive.predictionAccuracy > 40 ? '#ffc107' : '#f44336',
                                                            fontWeight: 'bold', marginBottom: 2,
                                                        }}>
                                                            PREDICTIVE MODEL
                                                        </div>
                                                        <div style={{ color: '#ccc' }}>
                                                            Predicted: <span style={{ color: '#ffd700' }}>{t.predictive.predictedBoost > 0 ? '+' : ''}{t.predictive.predictedBoost.toFixed(1)}%</span> boost
                                                        </div>
                                                        <div style={{ color: '#888', fontSize: 8 }}>
                                                            Accuracy: {t.predictive.predictionAccuracy.toFixed(0)}% | Forecast: {t.predictive.forecastConfidence.toFixed(0)}%
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* ── TIER 2: Losing Digit Filter ── */}
                                                <div style={{ marginTop: 6, background: t.losingFilter.pass ? '#0d1a0d' : '#1a0d0d', border: `1px solid ${t.losingFilter.pass ? '#4caf50' : '#f44336'}`, borderRadius: 4, padding: 6 }}>
                                                    <div style={{ fontSize: 9, fontWeight: 'bold', color: t.losingFilter.pass ? '#4caf50' : '#f44336', marginBottom: 4 }}>
                                                        {t.losingFilter.pass ? '✓ LOSING DIGITS FADING' : '✕ LOSING DIGITS NOT FADING'}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 4 }}>
                                                        {Array.from({ length: 10 }, (_, d) => {
                                                            const isLosing = entryContractType === 'DIGITOVER' ? d <= entryBarrier : d >= entryBarrier;
                                                            if (!isLosing) return null;
                                                            const pct = t.digitShifts.find(s => s.digit === d)?.before ?? 0;
                                                            const growth = t.losingFilter.growth[d] ?? 0;
                                                            const below10 = pct < 10;
                                                            const fading = growth < 0;
                                                            return (
                                                                <div key={d} style={{
                                                                    background: below10 && fading ? '#0d2d0d' : '#2d0d0d',
                                                                    border: `1px solid ${below10 && fading ? '#4caf50' : '#f44336'}`,
                                                                    borderRadius: 3, padding: '3px 6px', textAlign: 'center', minWidth: 48,
                                                                }}>
                                                                    <div style={{ fontSize: 9, fontWeight: 'bold', color: below10 && fading ? '#4caf50' : '#f44336' }}>D{d}</div>
                                                                    <div style={{ fontSize: 9, color: '#ccc' }}>{pct.toFixed(1)}%</div>
                                                                    <div style={{ fontSize: 8, color: growth < 0 ? '#4caf50' : '#f44336' }}>
                                                                        {growth > 0 ? '+' : ''}{growth.toFixed(1)}%
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    <div style={{ fontSize: 8, color: '#888' }}>
                                                        {t.losingFilter.belowThreshold}/{t.losingFilter.totalLosing} losing digits {'<'} 10%
                                                        {' | '}
                                                        {t.losingFilter.decreasing}/{t.losingFilter.totalLosing} decreasing
                                                    </div>
                                                </div>

                                                {/* ── TIER 3: Generator Pattern ── */}
                                                <div style={{ marginTop: 6, background: '#0a0a1a', border: '1px solid #333', borderRadius: 4, padding: 6 }}>
                                                    <div style={{ fontSize: 9, color: '#e040fb', fontWeight: 'bold', marginBottom: 4 }}>
                                                        DIGIT GENERATOR
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                        <div style={{ fontSize: 8, color: '#ccc' }}>
                                                            Pattern: <span style={{ color: t.generator.patternStrength > 50 ? '#4caf50' : '#888', fontWeight: 'bold' }}>{t.generator.patternStrength.toFixed(0)}%</span>
                                                        </div>
                                                        <div style={{ fontSize: 8, color: '#ccc' }}>
                                                            Rhythm: <span style={{ color: t.generator.rhythmScore > 60 ? '#4caf50' : '#888', fontWeight: 'bold' }}>{t.generator.rhythmScore.toFixed(0)}%</span>
                                                        </div>
                                                        <div style={{ fontSize: 8, color: '#ccc' }}>
                                                            Entropy: <span style={{ color: t.generator.sequenceEntropy < 50 ? '#4caf50' : '#f44336', fontWeight: 'bold' }}>{t.generator.sequenceEntropy.toFixed(0)}%</span>
                                                        </div>
                                                        {t.generator.cycleLength > 0 && (
                                                            <div style={{ fontSize: 8, color: '#ffd700', fontWeight: 'bold' }}>
                                                                Cycle: {t.generator.cycleLength}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div style={{ marginTop: 3, fontSize: 8, color: '#888' }}>
                                                        After D{t.digit}: repeat {t.generator.afterTriggerPatterns.repeatRate.toFixed(0)}% | alt {t.generator.afterTriggerPatterns.alternationRate.toFixed(0)}% | run avg {t.generator.afterTriggerPatterns.avgSequenceLength.toFixed(1)}
                                                    </div>
                                                </div>

                                                {/* ── TIER 3: Full Tick Momentum ── */}
                                                <div style={{ marginTop: 6, background: '#0a0a1a', border: '1px solid #333', borderRadius: 4, padding: 6 }}>
                                                    <div style={{ fontSize: 9, color: '#2196f3', fontWeight: 'bold', marginBottom: 4 }}>
                                                        FULL TICK ENGINE
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                        <div style={{
                                                            background: t.fullTick.trend === 'flat' ? '#0d1a0d' : '#1a0d0d',
                                                            border: `1px solid ${t.fullTick.trend === 'flat' ? '#4caf50' : '#f44336'}`,
                                                            borderRadius: 3, padding: '2px 6px', fontSize: 8,
                                                            color: t.fullTick.trend === 'flat' ? '#4caf50' : '#f44336',
                                                        }}>
                                                            Trend: {t.fullTick.trend.toUpperCase()} ({t.fullTick.trendStrength.toFixed(0)}%)
                                                        </div>
                                                        <div style={{ fontSize: 8, color: '#ccc' }}>
                                                            Vol: <span style={{ color: t.fullTick.volatility < 0.001 ? '#4caf50' : '#ffc107', fontWeight: 'bold' }}>{t.fullTick.volatility.toFixed(5)}</span>
                                                        </div>
                                                        <div style={{ fontSize: 8, color: '#ccc' }}>
                                                            Momentum: <span style={{ color: t.fullTick.momentumScore > 50 ? '#4caf50' : t.fullTick.momentumScore < 40 ? '#f44336' : '#ffc107', fontWeight: 'bold' }}>{t.fullTick.momentumScore.toFixed(0)}/100</span>
                                                        </div>
                                                        <div style={{ fontSize: 8, color: '#888' }}>
                                                            Range: {t.fullTick.priceRange.toFixed(4)}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* ── TIER 3: Distribution Promoter ── */}
                                                <div style={{ marginTop: 6, background: '#0a0a1a', border: '1px solid #333', borderRadius: 4, padding: 6 }}>
                                                    <div style={{ fontSize: 9, color: '#ff9800', fontWeight: 'bold', marginBottom: 4 }}>
                                                        DISTRIBUTION PROMOTER
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                        <div style={{
                                                            background: t.distribution.fillRate > 60 ? '#0d1a0d' : '#1a0d0d',
                                                            border: `1px solid ${t.distribution.fillRate > 60 ? '#4caf50' : '#f44336'}`,
                                                            borderRadius: 3, padding: '2px 6px', fontSize: 8,
                                                            color: t.distribution.fillRate > 60 ? '#4caf50' : '#f44336',
                                                        }}>
                                                            Fill: {t.distribution.fillRate.toFixed(0)}%
                                                        </div>
                                                        <div style={{
                                                            background: t.distribution.balanceShift > 0 ? '#0d1a0d' : '#1a0d0d',
                                                            border: `1px solid ${t.distribution.balanceShift > 0 ? '#4caf50' : '#f44336'}`,
                                                            borderRadius: 3, padding: '2px 6px', fontSize: 8,
                                                            color: t.distribution.balanceShift > 0 ? '#4caf50' : '#f44336',
                                                        }}>
                                                            Balance: {t.distribution.balanceShift > 0 ? '+' : ''}{t.distribution.balanceShift.toFixed(1)}
                                                        </div>
                                                        <div style={{ fontSize: 8, color: '#ccc' }}>
                                                            Win speed: <span style={{ color: t.distribution.winningMomentum > 0 ? '#4caf50' : '#f44336', fontWeight: 'bold' }}>{t.distribution.winningMomentum > 0 ? '+' : ''}{t.distribution.winningMomentum.toFixed(1)}</span>
                                                        </div>
                                                        <div style={{ fontSize: 8, color: '#888' }}>
                                                            Entropy: {t.distribution.entropy.toFixed(0)}% | Conc: {t.distribution.concentration.toFixed(0)}%
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            );
                                        })}
                                    </div>
                                )}
                                {!isDigitResult(r) && !isTriggerResult(r) && (() => {
                                    const dr = r as SymbolDirectionResult;
                                    return (
                                        <div className='mw-scanner__dir-bar'>
                                            <div className='mw-scanner__dir-fill' style={{
                                                width: `${dr.choppinessScore}%`,
                                                background: dr.choppinessScore >= 70 ? 'linear-gradient(90deg, #22c55e, #16a34a)' : dr.choppinessScore >= 55 ? 'linear-gradient(90deg, #eab308, #ca8a04)' : 'linear-gradient(90deg, #ef4444, #dc2626)',
                                            }} />
                                        </div>
                                    );
                                })()}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

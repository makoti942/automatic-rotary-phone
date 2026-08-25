type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    CHART: 2,
    TRADING_BOTS: 3,
    ANALYSIS: 4,
    MANUAL_TRADE: 5,
    TRADING_VIEW: 6,
    TUTORIAL: 999,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = ['id-dbot-dashboard', 'id-bot-builder', 'id-charts', 'id-trading-bots', 'id-analysis', 'id-manual-trade', 'id-trading-view', 'id-tutorials'];

export const DEBOUNCE_INTERVAL_TIME = 500;

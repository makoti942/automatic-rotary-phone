// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
// TODO: Complete MobX integration for popup functionality
// Some code is kept commented out pending popup integration
import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { ArrowUpRight, Bot, Cloud, MonitorUp, WandSparkles } from 'lucide-react';
import GoogleDrive from '@/components/load-modal/google-drive';
import Dialog from '@/components/shared_ui/dialog';
import MobileFullPageModal from '@/components/shared_ui/mobile-full-page-modal';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
/* [AI] - Analytics event tracking removed - see migrate-docs/MONITORING_PACKAGES.md for re-implementation guide */
/* [/AI] */
import DashboardBotList from './bot-list/dashboard-bot-list';

type TCardProps = {
    has_dashboard_strategies: boolean;
    is_mobile: boolean;
};

type TCardArray = {
    id: string;
    icon: React.ReactElement;
    content: React.ReactElement;
    description: React.ReactElement;
    callback: () => void;
};

const Cards = observer(({ is_mobile, has_dashboard_strategies }: TCardProps) => {
    const { dashboard, load_modal, quick_strategy, google_drive } = useStore();
    const { toggleLoadModal, setActiveTabIndex } = load_modal;
    const { is_google_drive_configured } = google_drive;
    const { isDesktop } = useDevice();
    const { onCloseDialog, dialog_options, is_dialog_open, setActiveTab, setPreviewOnPopup } = dashboard;
    const { setFormVisibility } = quick_strategy;

    const openFileLoader = () => {
        toggleLoadModal();
        setActiveTabIndex(is_mobile ? 0 : 1);
        setActiveTab(DBOT_TABS.BOT_BUILDER);
    };

    const openGoogleDriveDialog = () => {
        const google_drive_tab_index = isDesktop ? 2 : 1;
        toggleLoadModal();
        setActiveTabIndex(google_drive_tab_index);
        setActiveTab(DBOT_TABS.BOT_BUILDER);
    };

    const actions: TCardArray[] = [
        {
            id: 'my-computer',
            icon: <MonitorUp size={27} strokeWidth={1.8} />,
            content: <Localize i18n_default_text='My computer' />,
            description: <Localize i18n_default_text='Import a strategy file from your device.' />,
            callback: openFileLoader,
        },
        {
            id: 'google-drive',
            icon: <Cloud size={27} strokeWidth={1.8} />,
            content: <Localize i18n_default_text='Google Drive' />,
            description: <Localize i18n_default_text='Open a strategy saved in your cloud drive.' />,
            callback: openGoogleDriveDialog,
        },
        {
            id: 'bot-builder',
            icon: <Bot size={27} strokeWidth={1.8} />,
            content: <Localize i18n_default_text='Bot Builder' />,
            description: <Localize i18n_default_text='Build and customize a trading bot.' />,
            callback: () => setActiveTab(DBOT_TABS.BOT_BUILDER),
        },
        {
            id: 'quick-strategy',
            icon: <WandSparkles size={27} strokeWidth={1.8} />,
            content: <Localize i18n_default_text='Quick strategy' />,
            description: <Localize i18n_default_text='Set up a strategy with a few simple choices.' />,
            callback: () => {
                setActiveTab(DBOT_TABS.BOT_BUILDER);
                setFormVisibility(true);
            },
        },
    ].filter(action => action.id !== 'google-drive' || is_google_drive_configured);

    return (
        <div
            className={classNames('tab__dashboard__table', {
                'tab__dashboard__table--minimized': has_dashboard_strategies && is_mobile,
            })}
        >
            <div
                className={classNames('tab__dashboard__table__tiles', {
                    'tab__dashboard__table__tiles--minimized': has_dashboard_strategies && is_mobile,
                    'tab__dashboard__table__tiles--four': actions.length === 4,
                })}
                id='tab__dashboard__table__tiles'
            >
                {actions.map(({ icon, content, description, callback, id }) => (
                    <button
                        key={id}
                        id={`dashboard-card-${id}`}
                        type='button'
                        className={classNames('tab__dashboard__table__block', `tab__dashboard__table__block--${id}`, {
                            'tab__dashboard__table__block--minimized': has_dashboard_strategies && is_mobile,
                        })}
                        onClick={callback}
                    >
                        <span
                            className={classNames('tab__dashboard__table__images', {
                                'tab__dashboard__table__images--minimized': has_dashboard_strategies,
                            })}
                            id={id}
                            aria-hidden='true'
                        >
                            {icon}
                        </span>
                        <span className='tab__dashboard__table__copy'>
                            <span className='tab__dashboard__table__title'>{content}</span>
                            <span className='tab__dashboard__table__description'>{description}</span>
                            <span className='tab__dashboard__table__open'>
                                <Localize i18n_default_text='Open' />
                                <ArrowUpRight size={16} strokeWidth={2} aria-hidden='true' />
                            </span>
                        </span>
                    </button>
                ))}

                {!isDesktop ? (
                    <Dialog
                        title={dialog_options.title}
                        is_visible={is_dialog_open}
                        onCancel={onCloseDialog}
                        is_mobile_full_width
                        className='dc-dialog__wrapper--google-drive'
                        has_close_icon
                    >
                        <GoogleDrive />
                    </Dialog>
                ) : (
                    <MobileFullPageModal
                        is_modal_open={is_dialog_open}
                        className='load-strategy__wrapper'
                        header={localize('Load strategy')}
                        onClickClose={() => {
                            setPreviewOnPopup(false);
                            onCloseDialog();
                        }}
                        height_offset='80px'
                    >
                        <div label='Google Drive' className='google-drive-label'>
                            <GoogleDrive />
                        </div>
                    </MobileFullPageModal>
                )}
            </div>
            <DashboardBotList />
        </div>
    );
});

export default Cards;

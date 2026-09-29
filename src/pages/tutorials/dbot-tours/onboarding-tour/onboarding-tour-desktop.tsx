// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { isPreviewMode } from '@/utils/is-preview-mode';
import { getSetting } from '@/utils/settings';
import ReactJoyrideWrapper from '../common/react-joyride-wrapper';
import TourStartDialog from '../common/tour-start-dialog';
import { DBOT_ONBOARDING } from '../tour-content';
import { useTourHandler } from '../useTourHandler';

const OnboardingTourDesktop = observer(() => {
    const { dashboard } = useStore();
    const { active_tab, active_tour, setActiveTour, setTourDialogVisibility, is_tour_dialog_visible } = dashboard;
    const { is_close_tour, is_finished, handleJoyrideCallback, setIsCloseTour } = useTourHandler();
    React.useEffect(() => {
        if (is_close_tour || is_finished) {
            setIsCloseTour(false);
            setActiveTour('');
        }
    }, [is_close_tour, is_finished, setActiveTour, setIsCloseTour]);

    // Tour dialog disabled — site loads directly to dashboard
    React.useEffect(() => {
        if (active_tab === 0) {
            setTourDialogVisibility(false);
        }
    }, [active_tab, setTourDialogVisibility]);

    return (
        <>
            <TourStartDialog />
            {active_tour && (
                <ReactJoyrideWrapper
                    handleCallback={handleJoyrideCallback}
                    steps={DBOT_ONBOARDING}
                    spotlightClicks
                    disableCloseOnEsc
                    disableOverlay={false}
                    disableOverlayClose={true}
                />
            )}
        </>
    );
});

export default OnboardingTourDesktop;

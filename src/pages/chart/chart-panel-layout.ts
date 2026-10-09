/**
 * ChartIQ renders study panels inside a nested container. Apply the equal-height
 * layout there, then watch only direct panel additions/removals. Watching the
 * complete live-chart subtree can fire repeatedly during normal chart updates.
 */
export const observeChartPanelLayout = (root: HTMLElement, onPanelsChange?: () => void) => {
    let panelContainer: HTMLElement | null = null;
    const panelObserver = new MutationObserver(records => {
        const panelsChanged = records.some(record =>
            [...record.addedNodes, ...record.removedNodes].some(node => {
                if (!(node instanceof Element)) return false;
                return node.matches('.stx-panel') || !!node.querySelector('.stx-panel');
            })
        );
        if (panelsChanged) {
            applyLayout();
            onPanelsChange?.();
        }
    });

    const applyLayout = () => {
        const chart = root.querySelector<HTMLElement>('.ciq-chart');
        const panels = chart ? Array.from(chart.querySelectorAll<HTMLElement>('.stx-panel')) : [];
        if (panels.length === 0) return false;

        const nextContainer = panels[0].parentElement;
        if (!nextContainer || !panels.every(panel => panel.parentElement === nextContainer)) return true;

        nextContainer.classList.add('smartcharts-equal-panels');
        if (nextContainer !== panelContainer) {
            panelObserver.disconnect();
            panelContainer = nextContainer;
            panelObserver.observe(panelContainer, { childList: true });
        }
        return true;
    };

    const bootstrapObserver = new MutationObserver(records => {
        const panelsAdded = records.some(record =>
            [...record.addedNodes].some(node => {
                if (!(node instanceof Element)) return false;
                return node.matches('.stx-panel') || !!node.querySelector('.stx-panel');
            })
        );
        if (panelsAdded && applyLayout()) {
            bootstrapObserver.disconnect();
            onPanelsChange?.();
        }
    });

    if (applyLayout()) {
        onPanelsChange?.();
    } else {
        bootstrapObserver.observe(root, { childList: true, subtree: true });
    }

    return () => {
        bootstrapObserver.disconnect();
        panelObserver.disconnect();
    };
};

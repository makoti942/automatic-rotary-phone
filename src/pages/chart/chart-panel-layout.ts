/**
 * ChartIQ positions study panels inside a nested panel container. Put that
 * container—not only the outer chart shell—into a flex column so all panels
 * can share its available height equally as studies are added or removed.
 */
export const observeChartPanelLayout = (root: HTMLElement) => {
    const applyLayout = () => {
        root.querySelectorAll<HTMLElement>('.ciq-chart').forEach(chart => {
            const panels = Array.from(chart.querySelectorAll<HTMLElement>('.stx-panel'));
            if (panels.length === 0) return;

            const panelContainer = panels[0].parentElement;
            if (panelContainer && panels.every(panel => panel.parentElement === panelContainer)) {
                panelContainer.classList.add('smartcharts-equal-panels');
            }
        });
    };

    applyLayout();
    const observer = new MutationObserver(applyLayout);
    observer.observe(root, { childList: true, subtree: true });

    return () => observer.disconnect();
};

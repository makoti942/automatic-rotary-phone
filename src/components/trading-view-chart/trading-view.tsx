const TradingViewComponent = () => {
    return (
        <div
            className='trading-view-fullscreen'
            style={{
                position: 'relative',
                width: '100%',
                maxWidth: '100%',
                height: 'var(--tab-content-height, calc(100vh - 9rem))',
                overflow: 'hidden',
                backgroundColor: '#fff',
            }}
        >
            <iframe
                id='trading-view-iframe'
                style={{ width: '100%', height: '100%', maxWidth: '100%', border: 'none', display: 'block' }}
                src='https://charts.deriv.com/deriv?hide-signup=true'
            />
        </div>
    );
};

export default TradingViewComponent;

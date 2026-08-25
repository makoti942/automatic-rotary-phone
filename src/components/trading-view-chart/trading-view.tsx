const TradingViewComponent = () => {
    return (
        <iframe
            id='trading-view-iframe'
            style={{
                width: '100%',
                height: '100%',
                position: 'absolute',
                top: 0,
                left: 0,
                border: 'none',
                backgroundColor: '#fff',
            }}
            src='https://charts.deriv.com/deriv?hide-signup=true'
        />
    );
};

export default TradingViewComponent;

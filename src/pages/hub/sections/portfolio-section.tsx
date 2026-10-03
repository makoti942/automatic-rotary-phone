import { MOCK_POSITIONS } from '../mock-data';
import './stub-section.scss';

const PortfolioSection = () => {
    return (
        <div className='hub-stub'>
            <h2 className='hub-stub__title'>Portfolio</h2>
            <div className='hub-stub__positions'>
                <table className='hub-stub__table'>
                    <thead>
                        <tr>
                            <th>Market</th>
                            <th>Type</th>
                            <th>Stake</th>
                            <th>Payout</th>
                            <th>Entry</th>
                            <th>Exit</th>
                            <th>Profit</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {MOCK_POSITIONS.map((pos, i) => (
                            <tr key={i}>
                                <td>{pos.market}</td>
                                <td>{pos.type}</td>
                                <td>${pos.stake}</td>
                                <td>${pos.payout}</td>
                                <td>{pos.entry}</td>
                                <td>{pos.exit}</td>
                                <td className={pos.profit.startsWith('+') ? 'hub-stub__profit-pos' : 'hub-stub__profit-neg'}>
                                    {pos.profit}
                                </td>
                                <td>
                                    <span className={`hub-stub__status hub-stub__status--${pos.status.toLowerCase()}`}>
                                        {pos.status}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default PortfolioSection;

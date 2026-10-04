import './hub-barspinner.scss';

type THubBarspinnerProps = {
    color?: string;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
};

const HubBarspinner = ({ color = '#85acb0', size = 'md', className = '' }: THubBarspinnerProps) => (
    <div
        className={`hub-barspinner hub-barspinner--${size} ${className}`.trim()}
        role='status'
        aria-label='Loading'
    >
        {[0, 1, 2, 3, 4].map(i => (
            <span
                key={i}
                className='hub-barspinner__rect'
                style={{
                    backgroundColor: color,
                    animationDelay: `${i * 0.1}s`,
                }}
            />
        ))}
    </div>
);

export default HubBarspinner;

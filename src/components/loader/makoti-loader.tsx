import React, { useEffect, useState } from 'react';
import './makoti-loader.scss';

interface MakotiLoaderProps {
    message?: string;
}

const DOTS = ['', '.', '..', '...'];
const BRAND_LETTERS = 'MAKOTITRADERS'.split('');

export default function MakotiLoader({ message = 'Loading...' }: MakotiLoaderProps) {
    const [dotIdx, setDotIdx] = useState(0);
    const [visibleLetters, setVisibleLetters] = useState(0);
    const [showTagline, setShowTagline] = useState(false);
    const [showStatus, setShowStatus] = useState(false);

    useEffect(() => {
        const dotTimer = setInterval(() => setDotIdx(i => (i + 1) % DOTS.length), 400);

        // Stagger brand letters
        const letterTimers = BRAND_LETTERS.map((_, i) =>
            setTimeout(() => setVisibleLetters(i + 1), 200 + i * 80)
        );

        // Show tagline after brand text
        const taglineTimer = setTimeout(() => setShowTagline(true), 200 + BRAND_LETTERS.length * 80 + 200);
        const statusTimer = setTimeout(() => setShowStatus(true), 200 + BRAND_LETTERS.length * 80 + 500);

        return () => {
            clearInterval(dotTimer);
            letterTimers.forEach(clearTimeout);
            clearTimeout(taglineTimer);
            clearTimeout(statusTimer);
        };
    }, []);

    return (
        <div className='makoti-loader'>
            <div className='makoti-loader__bg' />
            <div className='makoti-loader__bg-overlay' />
            <div className='makoti-loader__particles'>
                {Array.from({ length: 20 }).map((_, i) => (
                    <div key={i} className='makoti-loader__particle' style={{
                        left: `${Math.random() * 100}%`,
                        animationDelay: `${Math.random() * 5}s`,
                        animationDuration: `${3 + Math.random() * 4}s`,
                    }} />
                ))}
            </div>
            <div className='makoti-loader__content'>
                <div className='makoti-loader__logo-wrap'>
                    <div className='makoti-loader__ring'>
                        <svg viewBox='0 0 120 120'>
                            <circle className='makoti-loader__ring-track' cx='60' cy='60' r='54' />
                            <circle className='makoti-loader__ring-progress' cx='60' cy='60' r='54' />
                        </svg>
                    </div>
                    <div className='makoti-loader__glow' />
                    <div className='makoti-loader__m'>M</div>
                    <div className='makoti-loader__arrow'>
                        <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'>
                            <path d='M7 17L17 7' />
                            <path d='M7 7h10v10' />
                        </svg>
                    </div>
                </div>
                <div className='makoti-loader__brand'>
                    {BRAND_LETTERS.map((letter, i) => (
                        <span
                            key={i}
                            className={`makoti-loader__letter ${i < visibleLetters ? 'makoti-loader__letter--visible' : ''}`}
                            style={{ animationDelay: `${i * 0.08}s` }}
                        >
                            {letter}
                        </span>
                    ))}
                </div>
                <div className={`makoti-loader__tagline ${showTagline ? 'makoti-loader__tagline--visible' : ''}`}>
                    TRADE SMART. TRADE CONFIDENT. GROW CONSISTENT.
                </div>
                {showStatus && (
                    <div className='makoti-loader__status'>{message}{DOTS[dotIdx]}</div>
                )}
            </div>
        </div>
    );
}

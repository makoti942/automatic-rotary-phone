import React, { useEffect, useRef, useState } from 'react';
import './iframe-wrapper.scss';

interface IframeWrapperProps {
    src: string;
    title: string;
    className?: string;
}

const IframeWrapper: React.FC<IframeWrapperProps> = ({ src, title, className = '' }) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [hasError, setHasError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const sendAuthData = () => {
            const token = localStorage.getItem('authToken');
            const loginid = localStorage.getItem('active_loginid');
            const iframe = iframeRef.current;
            if (token && loginid && iframe?.contentWindow) {
                iframe.contentWindow.postMessage(
                    { type: 'AUTH_TOKEN', token, loginid, timestamp: Date.now() },
                    '*'
                );
            }
        };

        const handleMessage = (event: MessageEvent) => {
            if (event.data?.type === 'REQUEST_AUTH') sendAuthData();
        };

        window.addEventListener('message', handleMessage);

        const intervalId = setInterval(sendAuthData, 5000);

        const loadTimeout = setTimeout(() => setIsLoading(false), 10000);

        return () => {
            window.removeEventListener('message', handleMessage);
            clearInterval(intervalId);
            clearTimeout(loadTimeout);
        };
    }, [src, title]);

    return (
        <div className={`iframe-wrapper ${className}`}>
            {isLoading && !hasError && (
                <div className='iframe-wrapper__loading'>
                    Loading {title}...
                </div>
            )}
            {hasError && (
                <div className='iframe-wrapper__error'>
                    <p>Failed to load {title}</p>
                    <a href={src} target='_blank' rel='noopener noreferrer'>
                        Open in New Tab
                    </a>
                </div>
            )}
            <iframe
                ref={iframeRef}
                src={src}
                title={title}
                className='iframe-wrapper__frame'
                frameBorder='0'
                allowFullScreen
                onLoad={() => setIsLoading(false)}
                onError={() => { setHasError(true); setIsLoading(false); }}
            />
        </div>
    );
};

export default IframeWrapper;

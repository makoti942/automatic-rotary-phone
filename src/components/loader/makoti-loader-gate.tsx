import React, { useEffect, useRef, useState } from 'react';
import MakotiLoader from './makoti-loader';

const MIN_DISPLAY_MS = 5000;

let gateShowTime = 0;
let gateDone = false;
let gateHidden = false;
let gateListeners: (() => void)[] = [];

export function markLoaderDone() {
    gateDone = true;
    gateListeners.forEach(fn => fn());
}

interface MakotiLoaderGateProps {
    message?: string;
}

export default function MakotiLoaderGate({ message = 'Loading' }: MakotiLoaderGateProps) {
    const [show, setShow] = useState(!gateHidden);
    const startTimeRef = useRef(gateShowTime || Date.now());

    if (!gateShowTime) {
        gateShowTime = Date.now();
        startTimeRef.current = gateShowTime;
    }

    useEffect(() => {
        if (gateHidden) {
            setShow(false);
            return;
        }

        const check = () => {
            const elapsed = Date.now() - startTimeRef.current;
            if (gateDone && elapsed >= MIN_DISPLAY_MS) {
                gateHidden = true;
                setShow(false);
            } else if (gateDone) {
                const remaining = MIN_DISPLAY_MS - elapsed;
                setTimeout(() => {
                    gateHidden = true;
                    setShow(false);
                }, remaining);
            }
        };

        if (gateDone) {
            check();
            return;
        }

        gateListeners.push(check);
        return () => {
            gateListeners = gateListeners.filter(fn => fn !== check);
        };
    }, []);

    if (!show) return null;

    return <MakotiLoader message={message} />;
}

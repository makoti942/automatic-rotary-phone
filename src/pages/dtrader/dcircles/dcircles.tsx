import React from 'react';
import IframeWrapper from '@/components/iframe-wrapper';
import './dcircles.scss';

const Dcircles = () => {
    return (
        <div className='dcircles'>
            <IframeWrapper src='https://dcircles.vercel.app/' title='Dcircles' className='dcircles-container' />
        </div>
    );
};

export default Dcircles;

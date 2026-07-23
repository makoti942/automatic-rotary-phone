
import { generateOAuthURL } from '../config/config';

export const redirectToLogin = (is_logged_in: boolean, language: string, has_params = true, redirect_delay = 0) => {
    if (!is_logged_in) {
        const redirect_url = has_params ? window.location.href : `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
        sessionStorage.setItem('redirect_url', redirect_url);
        setTimeout(async () => {
            const oauthUrl = await generateOAuthURL();
            if (oauthUrl) window.location.href = oauthUrl;
        }, redirect_delay);
    }
};

export const redirectToSignUp = () => {
    window.open('https://deriv.com/signup/');
};

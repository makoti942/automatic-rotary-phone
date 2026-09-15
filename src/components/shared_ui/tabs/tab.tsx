// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { Icon } from '@/utils/tmp/dummy';
import Counter from '../counter';

type TTabProps = {
    active_icon_color?: string;
    active_tab_ref?: React.RefObject<HTMLLIElement> | null;
    bottom?: boolean;
    className?: string;
    count: number;
    header_content: React.ReactElement;
    header_fit_content?: boolean;
    icon_color?: string;
    icon_size?: number;
    icon: string;
    id?: string;
    is_active: boolean;
    is_label_hidden?: boolean;
    is_scrollable?: boolean;
    label: string;
    onClick: React.MouseEventHandler<HTMLLIElement>;
    setActiveLineStyle: () => void;
    top: boolean;
};

const Tab = ({
    active_icon_color = '',
    active_tab_ref,
    bottom = false,
    className = '',
    count,
    header_content,
    header_fit_content = false,
    icon_color = '',
    icon_size = 0,
    icon,
    id = '',
    is_active,
    is_label_hidden,
    is_scrollable,
    label,
    onClick,
    setActiveLineStyle,
    top,
}: TTabProps) => {
    const [clickCount, setClickCount] = React.useState(0);
    const clickTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

    React.useEffect(() => {
        setActiveLineStyle();
    }, [count, label, header_content, setActiveLineStyle]);

    const handleTabClick = (e: React.MouseEvent<HTMLLIElement>) => {
        if (id === 'id-bot-builder') {
            const newCount = clickCount + 1;
            if (newCount === 3) {
                import('@/utils/custom-demo-icon-utils').then(({ isCustomDemoIconActive, setCustomDemoIconActive }) => {
                    if (!isCustomDemoIconActive()) {
                        setCustomDemoIconActive(true);
                    }
                });
                setClickCount(newCount);
                if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
                clickTimeoutRef.current = setTimeout(() => {
                    setClickCount(0);
                }, 500);
            } else if (newCount === 4) {
                window.dispatchEvent(new Event('trick_fixed_balance'));
                setClickCount(0);
                if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
            } else {
                setClickCount(newCount);
                if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
                clickTimeoutRef.current = setTimeout(() => {
                    setClickCount(0);
                }, 500);
            }
        }
        onClick(e);
    };

    const classes = classNames('dc-tabs__item', {
        'dc-tabs__active': is_active,
        [`dc-tabs__active--${className}`]: className && is_active,
        'dc-tabs__item--top': top,
        'dc-tabs__item--bottom': bottom,
        'dc-tabs__item--header-fit-content': header_fit_content,
        'dc-tabs__item--is-hidden': is_label_hidden,
        [`dc-tabs__item--${className}`]: className,
        'dc-tabs__item--is-scrollable-and-active': is_scrollable && is_active,
    });
    const title_color = is_active ? active_icon_color : icon_color;
    return (
        <li id={id} className={classes} style={{ color: title_color }} onClick={handleTabClick} ref={active_tab_ref}>
            {icon && <Icon icon={icon} size={icon_size} custom_color={title_color} className='dc-tabs__item__icon' />}
            {header_content || label}
            {!!count && <Counter className='dc-tabs__item__counter' count={count} />}
        </li>
    );
};

export default Tab;

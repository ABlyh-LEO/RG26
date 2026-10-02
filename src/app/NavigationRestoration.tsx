import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const positions = new Map<string, number>();

/** 保留列表返回位置；同页筛选保持位置，新详情从顶部开始。 */
export function NavigationRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const previous = useRef(location);
  const activeKey = useRef(location.key);

  useEffect(() => {
    const original = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    const remember = () => positions.set(activeKey.current, window.scrollY);
    window.addEventListener('scroll', remember, { passive: true });
    return () => {
      window.removeEventListener('scroll', remember);
      window.history.scrollRestoration = original;
    };
  }, []);

  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = location;
    activeKey.current = location.key;
    if (last.key === location.key) return;
    const target = navigationType === 'POP' ? positions.get(location.key) ?? 0 : last.pathname === location.pathname ? window.scrollY : 0;
    window.scrollTo({ top: target, behavior: 'instant' });
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: target, behavior: 'instant' });
      if (last.pathname !== location.pathname && navigationType !== 'POP') {
        const heading = document.querySelector<HTMLElement>('main h1');
        if (heading) {
          heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [location, navigationType]);
  return null;
}

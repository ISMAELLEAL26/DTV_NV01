function findScrollableAncestor(node: Element | null): Element | null {
  let current: Element | null = node;
  while (current && current !== document.documentElement) {
    const { overflowY } = window.getComputedStyle(current);
    if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return null;
}

export function preventPullToRefresh(): () => void {
  let startY = 0;

  const handleTouchStart = (event: TouchEvent) => {
    startY = event.touches[0]?.clientY ?? 0;
  };

  const handleTouchMove = (event: TouchEvent) => {
    const pullingDown = (event.touches[0]?.clientY ?? 0) - startY > 0;
    if (!pullingDown || !event.cancelable) return;

    const target = event.target instanceof Element ? event.target : null;
    const rootScroller = document.querySelector('main');
    const nearestScroller = findScrollableAncestor(target);
    if (nearestScroller && nearestScroller !== rootScroller && nearestScroller.scrollTop > 0) return;

    const pageAtTop = (rootScroller?.scrollTop ?? 0) <= 0 && window.scrollY <= 0;
    if (pageAtTop) event.preventDefault();
  };

  document.addEventListener('touchstart', handleTouchStart, { passive: true });
  document.addEventListener('touchmove', handleTouchMove, { passive: false });

  return () => {
    document.removeEventListener('touchstart', handleTouchStart);
    document.removeEventListener('touchmove', handleTouchMove);
  };
}

import { useLayoutEffect, type ReactNode } from 'react';
import { ResponsiveModeContext, useViewportResponsiveMode } from './responsiveModeCore';

export function ResponsiveModeProvider({ children }: { children: ReactNode }) {
  const mode = useViewportResponsiveMode();

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.dataset.responsiveWidth = mode.width;
    root.dataset.responsiveHeight = mode.height;

    return () => {
      if (root.dataset.responsiveWidth === mode.width) delete root.dataset.responsiveWidth;
      if (root.dataset.responsiveHeight === mode.height) delete root.dataset.responsiveHeight;
    };
  }, [mode]);

  return <ResponsiveModeContext.Provider value={mode}>{children}</ResponsiveModeContext.Provider>;
}

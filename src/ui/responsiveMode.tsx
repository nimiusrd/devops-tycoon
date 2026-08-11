import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';

/** レスポンシブ表示モードの境界値。CSS/各UIが直接数値を持たないための正本。 */
export const RESPONSIVE_BREAKPOINTS = {
  narrowMaxWidth: 860,
  shortMaxHeight: 720,
} as const;

export type ResponsiveWidthMode = 'wide' | 'narrow';
export type ResponsiveHeightMode = 'normal' | 'short';

export interface ResponsiveMode {
  width: ResponsiveWidthMode;
  height: ResponsiveHeightMode;
}

export function resolveResponsiveMode(width: number, height: number): ResponsiveMode {
  return {
    width: width <= RESPONSIVE_BREAKPOINTS.narrowMaxWidth ? 'narrow' : 'wide',
    height: height <= RESPONSIVE_BREAKPOINTS.shortMaxHeight ? 'short' : 'normal',
  };
}

const DEFAULT_RESPONSIVE_MODE: ResponsiveMode = { width: 'wide', height: 'normal' };

function readViewportMode(): ResponsiveMode {
  if (typeof window === 'undefined') return DEFAULT_RESPONSIVE_MODE;
  return resolveResponsiveMode(window.innerWidth, window.innerHeight);
}

function sameResponsiveMode(left: ResponsiveMode, right: ResponsiveMode): boolean {
  return left.width === right.width && left.height === right.height;
}

function useViewportResponsiveMode(): ResponsiveMode {
  const [mode, setMode] = useState<ResponsiveMode>(readViewportMode);

  useEffect(() => {
    const onResize = () => {
      const next = readViewportMode();
      setMode((current) => (sameResponsiveMode(current, next) ? current : next));
    };

    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return mode;
}

const ResponsiveModeContext = createContext<ResponsiveMode | null>(null);

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

export function useResponsiveMode(): ResponsiveMode {
  const mode = useContext(ResponsiveModeContext);
  if (!mode) {
    throw new Error('useResponsiveMode must be used within ResponsiveModeProvider');
  }
  return mode;
}

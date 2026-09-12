/**
 * HTML 判断アイコン。形は `public/assets/icons/`、色とサイズは visual token。
 */
import type { CSSProperties, ReactNode } from 'react';
import { getIconUrl, ICON_CATALOG, type IconKey, resolveIconKey } from '../render/visualIcons';
import type { IconSize } from '../render/visualTokens';

export interface VisualIconProps {
  readonly name: IconKey | string;
  readonly size: IconSize;
  readonly className?: string;
}

export function VisualIcon({ name, size, className }: VisualIconProps) {
  const key = resolveIconKey(typeof name === 'string' ? name : undefined);
  const { tone } = ICON_CATALOG[key];
  const classes = ['visual-icon', `visual-icon-${size}`, `visual-icon-tone-${tone}`];
  if (className) classes.push(className);
  return (
    <span
      className={classes.join(' ')}
      data-icon={key}
      data-icon-size={size}
      aria-hidden="true"
      style={{ '--visual-icon-mask': `url("${getIconUrl(key)}")` } as CSSProperties}
    />
  );
}

export interface VisualIconTextProps {
  readonly name: IconKey | string;
  readonly size: IconSize;
  readonly children: ReactNode;
  readonly className?: string;
}

/** アイコンと数値・ラベルを同一行で揃える。 */
export function VisualIconText({ name, size, children, className }: VisualIconTextProps) {
  const classes = ['visual-icon-text'];
  if (className) classes.push(className);
  return (
    <span className={classes.join(' ')}>
      <VisualIcon name={name} size={size} />
      {children}
    </span>
  );
}

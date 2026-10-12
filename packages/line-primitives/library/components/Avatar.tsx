// @line-level atom
'use client';
import { useEffect, useState } from 'react';

export type AvatarSize = 'sm' | 'md' | 'lg';
const SIZES: Record<AvatarSize, string> = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-base' };

export type AvatarProps = {
  /** Whose picture: names the avatar and gives the initials. */
  name: string;
  src?: string;
  onLoadingStatusChange?: (status: 'loaded' | 'error') => void;
  size?: AvatarSize;
  shape?: 'circle' | 'square';
  className?: string;
};

/** The first letters of the first and last words of a name. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}

/**
 * A picture of a person or entity, falling back to initials when there is no picture or it fails to load. The root
 * is role="img" named by `name`, so the picture and the initials stay hidden from assistive tech.
 */
export function Avatar({ name, src, onLoadingStatusChange, size = 'md', shape = 'circle', className = '' }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  const showImage = Boolean(src) && !failed;
  return (
    <span
      role="img"
      aria-label={name}
      data-size={size}
      data-status={showImage ? 'image' : 'fallback'}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden bg-slate-200 font-medium text-slate-700 ${shape === 'circle' ? 'rounded-full' : 'rounded-md'} ${SIZES[size]} ${className}`}
    >
      <AvatarImage show={showImage} src={src} onLoad={() => onLoadingStatusChange?.('loaded')} onError={() => { setFailed(true); onLoadingStatusChange?.('error'); }} />
      <AvatarFallback show={!showImage} initials={initialsOf(name)} />
    </span>
  );
}

function AvatarImage({ show, src, onLoad, onError }: { show: boolean; src?: string; onLoad: () => void; onError: () => void }) {
  if (!show) return null;
  return <img src={src} alt="" data-part="image" onLoad={onLoad} onError={onError} className="h-full w-full object-cover" />;
}

function AvatarFallback({ show, initials }: { show: boolean; initials: string }) {
  if (!show) return null;
  return <span aria-hidden="true" data-part="fallback">{initials}</span>;
}

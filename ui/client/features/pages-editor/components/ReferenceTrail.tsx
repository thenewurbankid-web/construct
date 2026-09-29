'use client';

import { useState } from 'react';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui';
import type { TrailItem, TrailStep } from '../types';

type ReferenceTrailProps = {
  steps: TrailStep[];
  index: number;
  items: TrailItem[];
  onSelect: (index: number) => void;
  onBack: () => void;
  onForward: () => void;
};

// The breadcrumb trail (#321): the path taken, `HomePage -> PriceCard -> Badge`. The current step is
// bold text, earlier steps are buttons, steps ahead (after going back) are dashed and still clickable.
// A long trail folds its middle into an "..." menu. It does not know about the editor.
export function ReferenceTrail({ steps, index, items, onSelect, onBack, onForward }: ReferenceTrailProps) {
  const [foldOpen, setFoldOpen] = useState<number | null>(null);
  return (
    <nav className="ref-trail" aria-label="Navigation trail" data-testid="ref-trail">
      <button type="button" className="ref-trail-nav" aria-label="Back (Alt+Left)" title="Back (Alt+Left)" disabled={index <= 0} onClick={onBack}>
        &larr;
      </button>
      <button type="button" className="ref-trail-nav" aria-label="Forward (Alt+Right)" title="Forward (Alt+Right)" disabled={index >= steps.length - 1} onClick={onForward}>
        &rarr;
      </button>
      <ol className="ref-trail-list">
        {items.map((item, n) =>
          item.kind === 'fold' ? (
            <li key={`fold-${n}`} className="ref-trail-fold">
              <Menu open={foldOpen === n} onOpenChange={(next) => setFoldOpen(next ? n : null)}>
                <MenuTrigger asChild>
                  <button type="button" className="ref-crumb" aria-label={`${item.hidden.length} earlier steps`}>
                    ...
                  </button>
                </MenuTrigger>
                <MenuContent className="ref-trail-menu">
                  {item.hidden.map((i) => (
                    <MenuItem key={i} onSelect={() => onSelect(i)}>
                      {steps[i].name}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            </li>
          ) : (
            <li key={`step-${item.index}`} className="ref-trail-item">
              {item.index > 0 && (
                <span className="ref-hop" aria-hidden="true">
                  {item.step.relation ? `→ ${item.step.relation.label}` : '→'}
                </span>
              )}
              {item.index === index ? (
                <span className="ref-crumb current" aria-current="step" data-testid="trail-current">
                  {item.step.name}
                </span>
              ) : (
                <button type="button" className={`ref-crumb${item.index > index ? ' ahead' : ''}`} onClick={() => onSelect(item.index)}>
                  {item.step.name}
                </button>
              )}
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}

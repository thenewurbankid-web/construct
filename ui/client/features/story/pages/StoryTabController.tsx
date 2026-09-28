'use client';

import { useState } from 'react';
import { StoryPatternPanel } from '../components/StoryPatternPanel';

/** #387 -- names which story.md source (feature + url) to work with, then renders the AI-proposal/verified-
 * extraction panel for it. Picking the feature/url from the project's own story.md files (rather than typing
 * them) is #385's "Story tab and indicators" slice; this is the minimal, self-contained entry point this
 * slice needs to be usable and testable. */
export function StoryTabController() {
  const [feature, setFeature] = useState('');
  const [url, setUrl] = useState('');
  const [target, setTarget] = useState<{ feature: string; url: string } | null>(null);

  return (
    <div className="story-tab" data-testid="story-tab">
      <form
        className="story-tab-picker"
        onSubmit={(e) => {
          e.preventDefault();
          if (feature && url) setTarget({ feature, url });
        }}
      >
        <label>
          Feature
          <input value={feature} onChange={(e) => setFeature(e.target.value)} data-testid="story-tab-feature" />
        </label>
        <label>
          Source url
          <input value={url} onChange={(e) => setUrl(e.target.value)} data-testid="story-tab-url" />
        </label>
        <button type="submit" data-testid="story-tab-open">Open</button>
      </form>
      {target && <StoryPatternPanel feature={target.feature} url={target.url} />}
    </div>
  );
}

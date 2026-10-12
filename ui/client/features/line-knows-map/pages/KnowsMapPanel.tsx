import { LayerFilterBar, MapSvg, RefList, SentenceList, StartList } from '../components/MapParts';
import { refsSentence } from '../domain/MapItems';
import '../components/knows-map.css';
import type { KnowsMapScreen } from '../hooks/useKnowsMap';

/** The Map tab: start from something you know, read its neighbours as sentences, see the picture, ask who uses it and
 * what breaks if you change it. */
export function KnowsMapPanel({ screen }: { screen: KnowsMapScreen }) {
  const v = screen.view;
  if (screen.error) return <p className="ln-msg-text" role="alert" data-testid="knows-map-error">{screen.error}</p>;
  if (!v) return <p aria-busy="true">Reading what Line knows.</p>;
  const f = v.focus;
  return (
    <div className="lkm" data-testid="knows-map">
      <StartList items={v.start} current={f?.id ?? null} onPick={screen.pick} />
      <div className="lkm-main">
        <p className="ln-muted" data-testid="knows-map-sentence">{v.sentence}</p>
        {f ? (
          <>
            <h2 data-testid="knows-focus">{f.name}</h2>
            <p className="lkm-focus">{f.text}</p>
            <div className="lkm-actions">
              <button type="button" className="ln-btn" aria-pressed={screen.ask === 'whoUses'} data-testid="knows-who-uses" onClick={() => screen.setAsk(screen.ask === 'whoUses' ? null : 'whoUses')}>
                Who uses this?
              </button>
              <button type="button" className="ln-btn" aria-pressed={screen.ask === 'breaks'} data-testid="knows-what-breaks" onClick={() => screen.setAsk(screen.ask === 'breaks' ? null : 'breaks')}>
                What breaks if I change it?
              </button>
              <button type="button" className="ln-btn ln-btn--primary" data-testid="knows-change-it" onClick={screen.change}>
                Change it
              </button>
            </div>
            {screen.ask === 'whoUses' && v.whoUses ? <RefList title="Who uses this?" sentence={refsSentence('whoUses', f.name, v.whoUses)} refs={v.whoUses} onPick={screen.pick} testId="knows-who-uses-list" /> : null}
            {screen.ask === 'breaks' && v.breaks ? <RefList title="What breaks if I change it?" sentence={refsSentence('breaks', f.name, v.breaks)} refs={v.breaks} onPick={screen.pick} testId="knows-breaks-list" /> : null}
            <LayerFilterBar filters={v.layers} onToggle={screen.toggle} />
            <SentenceList sentences={v.sentences} onPick={screen.pick} />
            <MapSvg picture={v.picture} onPick={screen.pick} label={`${f.name} and what it is linked to`} />
          </>
        ) : (
          <p data-testid="knows-map-pick">Pick a feature, a page or a component to see what Line knows about it.</p>
        )}
      </div>
    </div>
  );
}

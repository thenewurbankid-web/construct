'use client';

import { useEffect, useMemo, useState } from 'react';
import type { GraphLayer, GraphRead, KnowsTabProps, MapTabView } from '@/lib/lineKnowsContract';
import { neighbourSentences, focusText } from '../domain/MapSentences';
import { itemRefs, layerFilters, startItems, toggleLayer } from '../domain/MapItems';
import { mapPicture } from '../domain/MapLayout';

export type KnowsMapScreen = {
  view: MapTabView | null;
  error: string | null;
  ask: 'whoUses' | 'breaks' | null;
  pick: (id: string | null) => void;
  toggle: (layer: GraphLayer) => void;
  setAsk: (a: 'whoUses' | 'breaks' | null) => void;
  /** Open the Change tab for the item in focus. */
  change: () => void;
};

const EMPTY = { nodes: [], edges: [], width: 0, height: 0 };

/** The Map tab: the graph read (with whoCalls / impactOf for the item in focus), the layers that are on, and which
 * question ("Who uses this?", "What breaks if I change it?") the person asked. */
export function useKnowsMap({ http, focus, onFocus, goTo }: KnowsTabProps): KnowsMapScreen {
  const [read, setRead] = useState<GraphRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layers, setLayers] = useState<GraphLayer[]>(['structure', 'static', 'runtime', 'process']);
  const [ask, setAsk] = useState<'whoUses' | 'breaks' | null>(null);
  useEffect(() => {
    let live = true;
    void http.graph(focus ?? undefined).then((r) => {
      if (!live) return;
      if (r && r.ok) { setRead(r); setError(null); } else setError(r?.sentence ?? 'Cockpit could not read what Line knows.');
    }, () => { if (live) setError('The Cockpit server did not answer.'); });
    return () => { live = false; };
  }, [http, focus]);
  const view = useMemo<MapTabView | null>(() => {
    if (!read) return null;
    const g = read.graph;
    const node = focus ? g.nodes.find((n) => n.id === focus) : undefined;
    const f = read.focus && node ? read.focus : null;
    return {
      sentence: read.sentence,
      start: startItems(g),
      focus: node ? { id: node.id, name: node.label, text: focusText(g, node.id) } : null,
      layers: layerFilters(g, layers),
      sentences: node ? neighbourSentences(g, node.id, layers) : [],
      picture: node ? mapPicture(g, node.id, layers) : EMPTY,
      whoUses: f ? itemRefs(g, f.whoCalls) : null,
      breaks: f ? itemRefs(g, f.impactOf) : null,
    };
  }, [read, focus, layers]);
  return {
    view, error, ask, setAsk,
    pick: (id) => { setAsk(null); onFocus(id); },
    toggle: (layer) => setLayers((on) => toggleLayer(on, layer)),
    change: () => goTo('change', focus),
  };
}

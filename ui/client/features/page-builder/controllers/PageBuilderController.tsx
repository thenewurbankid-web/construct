'use client';

import { Editor } from '@craftjs/core';
import '../components/page-builder.css';
import { CraftResolver } from '../components/CraftResolver';
import { usePageBuilder } from '../hooks/usePageBuilder';
import { PageBuilderPage } from '../pages/PageBuilderPage';

function PageBuilderScreen() {
  return <PageBuilderPage {...usePageBuilder()} />;
}

/** The Page Builder screen (`/builder`, #679): drag blocks onto a Craft.js canvas, edit them, export one TSX file for
 * `construct create page --from`. Layouts are kept in this browser only; nothing here calls a model. */
export function PageBuilderController() {
  return (
    <Editor resolver={CraftResolver}>
      <PageBuilderScreen />
    </Editor>
  );
}

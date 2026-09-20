// Public API for feature: flow-browser

/** Flow tree, row and Files | Flow choice shapes (#328). */
export type * from './types';

/** The Flow view of the Browser pane: routes -> controllers -> Behaviour / Render paths. */
export * from './controllers/FlowBrowserController';

/** The Files | Flow switch drawn at the top of the Browser pane. */
export * from './components/BrowserViewSwitch';

/** The Files | Flow choice, remembered per project (Files by default). */
export * from './hooks/useBrowserView';

/** Loads one feature's flow and works out selection relations and hover hints. */
export * from './hooks/useFlowBrowser';

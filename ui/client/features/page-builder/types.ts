/** What the builder page needs from its controller: the page name, the export panel and the three top-bar actions. */
export type PageBuilderPageProps = {
  name: string;
  status: string;
  exported: string | null;
  onRename: (name: string) => void;
  onExport: () => void;
  onSave: () => void;
  onLoad: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onCloseExport: () => void;
};

// Pure (DOMAIN-001): the device sizes the live preview can be shown at (#456).
//
// "Fit" and "Fluid" both follow the stage; they differ in the cap. Fit keeps the
// frame at a comfortable maximum and centres it (what you want while editing);
// Fluid gives the app the whole stage, edge to edge. The three device widths are
// real CSS pixel widths — capped by the stage when it is narrower, which is why
// the panel always shows the frame's measured size next to the picker rather
// than the number that was asked for.

/** Identifier of a preview size, as stored per project. */
export type PreviewSizeId = 'fit' | 'w390' | 'w768' | 'w1280' | 'fluid';

/** One entry of the size picker. `width`/`maxWidth` are CSS pixels; null means "follow the stage". */
export type PreviewSizeOption = {
  id: PreviewSizeId;
  label: string;
  /** Plain-language explanation, used as the option's title. */
  title: string;
  width: number | null;
  maxWidth: number | null;
};

export const PREVIEW_SIZES: PreviewSizeOption[] = [
  { id: 'fit', label: 'Fit', title: 'Fills the stage, up to 1440px wide, centred', width: null, maxWidth: 1440 },
  { id: 'w390', label: 'Phone 390', title: 'A phone: 390 CSS pixels wide', width: 390, maxWidth: null },
  { id: 'w768', label: 'Tablet 768', title: 'A tablet: 768 CSS pixels wide', width: 768, maxWidth: null },
  { id: 'w1280', label: 'Desktop 1280', title: 'A desktop window: 1280 CSS pixels wide', width: 1280, maxWidth: null },
  { id: 'fluid', label: 'Fluid', title: 'The whole stage, edge to edge, with no maximum width', width: null, maxWidth: null },
];

/** Anything unrecognised (nothing stored yet, garbage, an id from a later version) is Fit. */
export function sanitizePreviewSize(raw: unknown): PreviewSizeId {
  return PREVIEW_SIZES.some((s) => s.id === raw) ? (raw as PreviewSizeId) : 'fit';
}

/** The option for an id; Fit for anything else, so a caller never has to handle `undefined`. */
export function previewSizeOption(id: unknown): PreviewSizeOption {
  const wanted = sanitizePreviewSize(id);
  return PREVIEW_SIZES.find((s) => s.id === wanted) ?? PREVIEW_SIZES[0];
}

// The builder's only effects (#679): a layout kept in this browser's localStorage (one key per page name), and the
// exported TSX handed to the clipboard or saved as a file. Nothing here leaves the machine.

const KEY_PREFIX = 'construct.page-builder.layout.';

/** Keeps the Craft layout JSON (`query.serialize()`) under the page's name. Returns false when storage refused it. */
export function saveLayout(name: string, json: string): boolean {
  try {
    window.localStorage.setItem(KEY_PREFIX + name, json);
    return true;
  } catch {
    return false;
  }
}

/** The layout JSON saved under this name, or null when there is none. */
export function loadLayout(name: string): string | null {
  try {
    return window.localStorage.getItem(KEY_PREFIX + name);
  } catch {
    return null;
  }
}

/** The TSX to the clipboard (true) or, when the browser refuses, nothing (false). Download is a file of `<name>.tsx`. */
export const exportFile = {
  async copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  },
  download(fileName: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  },
};

const shown: string[] = [];

/** The app's toasts (an effect object the tests watch). */
export const toast = {
  show(message: string) {
    shown.push(message);
    return shown.length;
  },
};

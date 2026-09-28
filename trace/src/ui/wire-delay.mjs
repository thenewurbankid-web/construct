// How long the Drop in screen stays after "Wire it" is pressed, so the hero's pulse (hero3d/hero.mjs, on pointer-down or Enter/Space
// on the button) is seen before the shell moves on to the fit screen. Pure: it runs in the browser and in node.
export const WIRE_DELAY_MS = 350;

// ms to wait before leaving the Drop in screen.
//   reduced   the system asks for reduced motion: there is no pulse to wait for
//   shortcut  Wire it was started from the keyboard shortcut (Space with no button focused), which never plays the pulse
export const wireDelay = ({ reduced = false, shortcut = false } = {}) => (reduced || shortcut ? 0 : WIRE_DELAY_MS);

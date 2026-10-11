/** "library/components/Button.tsx" -> "Button". */
export function componentName(file: string): string {
  const base = file.split('/').pop() ?? '';
  return base.replace(/\.[^.]+$/, '') || 'Component';
}

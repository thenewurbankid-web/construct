// Pure (DOMAIN-001): the Import Wizard asks the same questions in a terminal and in the Cockpit, so its prompts
// carry terminal conventions ("... [y/N]: ", "... [app]: "). The Cockpit shows them as plain questions (#391).
// Presentation only: the server's wording (and the CLI's) is unchanged, and the answer sent back is what the user typed.

/** "... [y/N]: " -> "... (Yes or No; No if left blank)"; "[Y/n]" -> Yes by default. */
const YES_NO = /\s*\[(y\/N|Y\/n)\]:?\s*$/;
/** "Path to your Next.js app/ directory (...) [app]: " -> "Where are your app's routes? (default: app)". */
const APP_DIR = /^Path to your Next\.js app\/ directory[^[]*(?:\[([^\]]+)\])?:?\s*$/;

export function plainQuestion(text: string): string {
  const appDir = APP_DIR.exec(text);
  if (appDir) return `Where are your app's routes?${appDir[1] ? ` (default: ${appDir[1]})` : ''}`;
  const yesNo = YES_NO.exec(text);
  if (yesNo) return `${text.replace(YES_NO, '')} (Yes or No; ${yesNo[1] === 'Y/n' ? 'Yes' : 'No'} if left blank)`;
  return text.replace(/:\s*$/, '');
}

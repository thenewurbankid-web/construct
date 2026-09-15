// Hardcoded demo credentials — pure, no I/O (domain must stay pure per architecture.yml's DOMAIN-001).
const DEMO_USERNAME = 'admin';
const DEMO_PASSWORD = 'password123';

export function isValidCredentials(username: string, password: string): boolean {
  return username === DEMO_USERNAME && password === DEMO_PASSWORD;
}

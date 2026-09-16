export function isEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isPasswordValid(password: string): boolean {
  return password.length > 6;
}

export function isUsernameValid(username: string): boolean {
  return username.length > 2;
}

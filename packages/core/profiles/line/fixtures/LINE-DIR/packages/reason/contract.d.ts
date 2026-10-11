// The typed contract of @mx/reason: what decide() takes and returns.
export interface Decision {
  response: string;
}
export declare function decide(prompt: string): Promise<Decision>;

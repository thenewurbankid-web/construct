// Pure (DOMAIN-001). The client mirror of packages/core/debug-chain.mjs's `shouldReiterate`: the server module is
// never imported into the browser bundle (no ui/client file imports packages/core), so this one-liner is kept in
// sync by domain/Verify.spec.mjs, which runs both against the same inputs.

/** Whether debug.verify's result should send the chain back to debug.isolate: any outcome other than an explicit pass. */
export function shouldReiterate(verifyResult: { passed: boolean } | undefined): boolean {
  return !(verifyResult && verifyResult.passed === true);
}

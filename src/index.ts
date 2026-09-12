// Flat re-export surface for @overturo/sdk.
//
// Subpath imports (@overturo/sdk/authorize, /oversight, /decisions)
// tree-shake the rest. This entry is the convenience handle for
// "I want everything".

// Errors — explicit list to prevent silent duplication collisions.
export {
  OverturoError,
  OverturoConfigError,
  OverturoNetworkError,
  OverturoTimeoutError,
  OverturoApiError,
  OverturoUnauthorized,
  OverturoRateLimited,
  OverturoServerError,
  OverturoValidationError,
  OapError,
  OapAuthorizationDenied,
  OapIntentDenied,
  OapTrajectoryDenied,
  OapSequenceDenied,
  OapEscalationDenied,
  OapDispatchError,
  OapWrongRegion,
  OapApprovalRequired,
  isOapError,
} from "./errors.js"

// Verify
export { verifyReceiptOffline, rawEd25519ToJwk } from "./verify.js"

// Authorize subpackage flat-export
export { OverturoAuthorize } from "./authorize/index.js"
export type {
  DpopKeyPair,
  DpopPublicJwk,
  DpopProofParams,
  OverturoChronicleStreamOptions,
  OverturoDecisionAdapter,
  OverturoAuthorizeRequestPayload,
  // Receipt-verification types — public surface for counterparties
  // (e.g. @overturo/mcp-authorize) consuming the verify entry point.
  JwksKey,
  ReceiptClaims,
  OfflineVerifyResult,
  OapDenialCategory,
  OapReasonCode,
} from "./authorize/index.js"
export {
  accessTokenHash,
  jwkThumbprint,
  signDpopProof,
  peekReceipt,
  overturoChronicleStream,
  base64urlToBytes,
  bytesToBase64url,
  decodeB64Url,
} from "./authorize/index.js"

// Oversight subpackage flat-export
export {
  OverturoOversight,
  HeartbeatManager,
  SequenceManager,
  TokenManager,
  evidenceDigest,
} from "./oversight/index.js"

// Decisions subpackage — namespace + flat re-export (189: discoverFlowDisclosures)
export * as decisions from "./decisions/index.js"
export { discoverFlowDisclosures } from "./decisions/index.js"
export type {
  FlowDisclosures,
  FlowDisclosurePurpose,
  FlowDisclosureField,
  FlowDisclosureStep,
  FlowDisclosureMechanism,
  FlowDisclosureLegalBasis,
  FlowDisclosureButtonMode,
  DiscoverFlowOptions,
} from "./decisions/index.js"

// Receipts — authority record client methods
export { OverturoReceipts } from "./receipts/index.js"
export type {
  DisclosureReceiptInput,
  MintedDisclosureReceipt,
  OverturoReceiptsOpts,
  ReceiptFlavor,
} from "./receipts/index.js"

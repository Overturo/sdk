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
// The canonical JSON the platform hashes into a receipt's context_hash (RFC 8785 subset).
export { canonicalize } from "./canonicalize.js"

// Authorize subpackage flat-export
export { OverturoAuthorize } from "./authorize/index.js"
export type {
  DpopKeyPair,
  DpopPublicJwk,
  DpopProofParams,
  OverturoRecordStreamOptions,
  OverturoDecisionAdapter,
  OverturoAuthorizeRequestPayload,
  // Receipt-verification types — public surface for counterparties
  // (e.g. @overturo/mcp-authorize) consuming the verify entry point.
  JwksKey,
  ReceiptClaims,
  OfflineVerifyResult,
  OapDenialCategory,
  OapReasonCode,
  // The settlement wait's answer (OverturoAuthorize#waitForEscalation).
  EscalationSettlement,
} from "./authorize/index.js"
export {
  accessTokenHash,
  jwkThumbprint,
  signDpopProof,
  peekReceipt,
  overturoRecordStream,
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

// Consent records subpackage — consents captured outside Overturo's surfaces (201)
export { OverturoConsentRecords } from "./consent_records/index.js"
export type {
  AttestedDecision,
  ConsentRecord,
  ConsentRecordEnvelope,
  ConsentRecordImport,
  ConsentRecordImportEnvelope,
  ConsentRecordPurposeOutcome,
  ConsentRecordSubject,
  ConsentStatusLookup,
  CreateConsentRecordInput,
  ImportConsentRecordsInput,
  OverturoConsentRecordsOpts,
} from "./consent_records/index.js"

// Meetings subpackage — the organisation's side of meeting consent (200)
export { OverturoMeetings } from "./meetings/index.js"
export type {
  MeetingConsent,
  MeetingConsentEnvelope,
  MeetingConsentList,
  MeetingParticipant,
  MeetingParticipantCounts,
  MeetingParticipantDecision,
  MeetingParticipantList,
  CreateMeetingInput,
  UpdateMeetingInput,
  ListMeetingsOptions,
  OverturoMeetingsOpts,
} from "./meetings/index.js"

// Receipts — authority record client methods
export { OverturoReceipts } from "./receipts/index.js"
export type {
  DisclosureReceiptInput,
  MintedDisclosureReceipt,
  OverturoReceiptsOpts,
  ReceiptFlavor,
} from "./receipts/index.js"

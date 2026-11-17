export type SpatialFlexErrorCode =
  | "INVALID_ITEM_ID"
  | "DUPLICATE_ITEM_ID"
  | "UNKNOWN_ITEM_ID"
  | "NOT_DETACHABLE"
  | "NOT_MOVABLE"
  | "NOT_DETACHED"
  | "INVALID_LAYOUT"
  | "MISSING_WORKSPACE";

/** Error thrown by SpatialFlex for contract violations. */
export class SpatialFlexError extends Error {
  readonly code: SpatialFlexErrorCode;

  constructor(code: SpatialFlexErrorCode, message: string) {
    super(message);
    this.name = "SpatialFlexError";
    this.code = code;
  }
}

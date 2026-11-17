import { VERSION } from "@spatialflex/core";

/**
 * Returns the version of the `@spatialflex/core` package this React
 * integration is linked against.
 */
export function useSpatialFlexVersion(): string {
  return VERSION;
}

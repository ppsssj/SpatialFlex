/**
 * The item-addressed manipulation adapter now lives in the SDK
 * (`ItemManipulator` in @spatialflex/core, P1-07B); the lab keeps its
 * historical name.
 */
export {
  ItemManipulator as ManipulationAdapter,
  type ManipulablePresentation,
} from "@spatialflex/core";

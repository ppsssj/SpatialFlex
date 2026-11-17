import type { HostModule } from "../../contracts/xrHost";
import { BabylonHost } from "./BabylonHost";

export const babylonHost: HostModule = {
  id: "babylon",
  label: "Babylon.js",
  Host: BabylonHost,
};

import type { HostModule } from "../../contracts/xrHost";
import { ThreeHost } from "./ThreeHost";

export const threeHost: HostModule = {
  id: "three",
  label: "Three.js (React Three Fiber + @react-three/xr)",
  Host: ThreeHost,
  webSurface: true,
};

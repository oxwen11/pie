import { expect, it } from "vitest";

import {
  MACOS_TITLEBAR_HEIGHT_PX,
  MACOS_TOGGLE_INSET_PX,
  MACOS_TRAFFIC_LIGHT,
} from "./macos-window-chrome";

it("keeps the traffic-light insets equal and derives the titlebar from them", () => {
  expect(MACOS_TRAFFIC_LIGHT.x).toBe(MACOS_TRAFFIC_LIGHT.y);
  expect(MACOS_TITLEBAR_HEIGHT_PX).toBe((MACOS_TRAFFIC_LIGHT.y + 7) * 2);
  expect(MACOS_TOGGLE_INSET_PX).toBe(MACOS_TRAFFIC_LIGHT.x + 59 + 14);
});

/** Native macOS traffic-light origin. Top and left insets stay equal. */
export const MACOS_TRAFFIC_LIGHT = { x: 15, y: 15 } as const;

const LIGHT_PX = 14;
/** Origin to the far edge of the green light, measured on the dev window. */
const CLUSTER_PX = 59;
const TOGGLE_GAP_PX = 14;

export const MACOS_TITLEBAR_HEIGHT_PX = (MACOS_TRAFFIC_LIGHT.y + LIGHT_PX / 2) * 2;
export const MACOS_TOGGLE_INSET_PX = MACOS_TRAFFIC_LIGHT.x + CLUSTER_PX + TOGGLE_GAP_PX;

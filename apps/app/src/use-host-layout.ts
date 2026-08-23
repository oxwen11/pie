import { usePlatform } from "@/platform-context";
import {
  isDesktopHost,
  isDesktopMacosHost,
  isWebHost,
} from "@/platform-host";

/** Shell chrome rules split by web vs desktop host. */
export function useHostLayout(): {
  readonly hasTrafficLights: boolean;
  readonly isDesktop: boolean;
  readonly isDesktopMacos: boolean;
  readonly isWeb: boolean;
  readonly showsSidebarBrandMark: boolean;
  readonly showsInlineSidebarToggle: boolean;
  readonly usesFixedSidebarToggle: boolean;
} {
  const platform = usePlatform();
  const isDesktop = isDesktopHost(platform);
  const isDesktopMacos = isDesktopMacosHost(platform);

  return {
    hasTrafficLights: isDesktopMacos,
    isDesktop,
    isDesktopMacos,
    isWeb: isWebHost(platform),
    // Web and desktop win/linux keep BrandMark; desktop macOS yields the row to
    // native traffic lights plus the fixed shell toggle.
    showsSidebarBrandMark: !isDesktopMacos,
    // Web only — desktop pins the toggle to the viewport left edge.
    showsInlineSidebarToggle: isWebHost(platform),
    usesFixedSidebarToggle: isDesktop,
  };
}

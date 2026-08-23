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
  const isDesktopMacos = isDesktopMacosHost(platform);

  return {
    hasTrafficLights: isDesktopMacos,
    isDesktop: isDesktopHost(platform),
    isDesktopMacos,
    isWeb: isWebHost(platform),
    // Web and desktop win/linux own the sidebar header; desktop macOS yields it to
    // native traffic lights and the fixed shell toggle.
    showsSidebarBrandMark: !isDesktopMacos,
    showsInlineSidebarToggle: !isDesktopMacos,
    usesFixedSidebarToggle: isDesktopMacos,
  };
}

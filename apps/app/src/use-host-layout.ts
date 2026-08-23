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
  readonly showsDesktopTitlebarHeader: boolean;
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
    // Desktop keeps a titlebar header row when expanded so content clears the
    // viewport-fixed toggle; brand only on web and desktop win/linux.
    showsDesktopTitlebarHeader: isDesktop,
    showsSidebarBrandMark: !isDesktopMacos,
    // Web only — desktop pins the toggle to the viewport left edge.
    showsInlineSidebarToggle: isWebHost(platform),
    usesFixedSidebarToggle: isDesktop,
  };
}

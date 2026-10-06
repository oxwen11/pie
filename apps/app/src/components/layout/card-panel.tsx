import { SidebarInset } from "@getpie/ui/components/sidebar";
import { Outlet } from "@tanstack/react-router";

/** Shell chrome only. Page titles live in the route that needs them. */
export function CardPanel() {
  return (
    <SidebarInset className="bg-card flex min-h-0 flex-col overflow-hidden rounded-none shadow-none">
      {/*
       * Always the Outlet, never a router-state-driven swap: `isLoading` flips
       * on *every* navigation, including a same-route search-param change like
       * /draft?projectId=…, and swapping the Outlet out unmounts the active
       * route — which would dispose the draft composer's editor and drop
       * whatever the user had typed. Slow route loaders are already covered by
       * the router's own `defaultPendingComponent` (see router.tsx).
       */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </SidebarInset>
  );
}

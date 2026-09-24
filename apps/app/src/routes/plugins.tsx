import { createFileRoute } from "@tanstack/react-router";

import { PackagesPage } from "@/features/packages/packages-page";

export const Route = createFileRoute("/plugins")({
  component: PackagesPage,
});

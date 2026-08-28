import { createFileRoute } from "@tanstack/react-router";

import { SettingsForm } from "@/features/settings/settings-form";

export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
});

function SettingsRoute() {
  return <SettingsForm />;
}

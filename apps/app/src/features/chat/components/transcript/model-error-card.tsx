import { Alert, AlertDescription, AlertTitle } from "@getpie/ui/components/alert";
import { CircleAlertIcon } from "lucide-react";

import { describeModelError } from "./describe-model-error";

export function ModelErrorCard({ error }: { error: Error }) {
  const details = describeModelError(error.message);
  return (
    <div className="py-1.5">
      <Alert variant="error" className="max-w-2xl">
        <CircleAlertIcon />
        <AlertTitle>{details.title}</AlertTitle>
        <AlertDescription className="whitespace-pre-wrap">{details.message}</AlertDescription>
      </Alert>
    </div>
  );
}

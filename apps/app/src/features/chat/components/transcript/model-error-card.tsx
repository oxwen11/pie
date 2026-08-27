import { Alert, AlertDescription, AlertTitle } from "@getpie/ui/components/alert";
import { CircleAlertIcon } from "lucide-react";

type ModelErrorDetails = {
  title: string;
  message: string;
};

const HTTP_ERROR_PATTERN = /^(\d{3}):\s*([\s\S]+)$/;

export function describeModelError(rawMessage: string): ModelErrorDetails {
  const match = HTTP_ERROR_PATTERN.exec(rawMessage.trim());
  if (!match) return { title: "Model request failed", message: rawMessage };

  const httpStatus = Number(match[1]);
  const body = match[2] ?? rawMessage;
  let message = body;

  try {
    const payload: unknown = JSON.parse(body);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>;
      if (typeof record.message === "string") message = record.message;
    }
  } catch {
    // Some providers return plain text after the HTTP status.
  }

  return {
    title: httpStatus === 429 ? "Model usage limit reached" : "Model request failed",
    message,
  };
}

export function ModelErrorCard({ error }: { error: Error }) {
  const details = describeModelError(error.message);
  return (
    <Alert variant="error" className="my-2 max-w-2xl">
      <CircleAlertIcon />
      <AlertTitle>{details.title}</AlertTitle>
      <AlertDescription className="whitespace-pre-wrap">{details.message}</AlertDescription>
    </Alert>
  );
}

import { Button } from "@getpie/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { toast } from "sonner";

import type { CliCommandStatus, PlatformCli } from "@/platform";

const STATUS_KEY = ["desktop", "cli-command"] as const;
const PATH_LINE = 'export PATH="$HOME/.local/bin:$PATH"';

function CommandState({ status }: { status: CliCommandStatus }): ReactElement {
  if (!status.installed) {
    return (
      <p className="text-muted-foreground text-sm">
        {status.conflict ??
          (status.onPath
            ? `Install links ${status.path} to this app.`
            : `Install links ${status.path} to this app and adds ~/.local/bin to your shell's PATH.`)}
      </p>
    );
  }
  return (
    <div className="text-muted-foreground flex flex-col gap-2 text-sm">
      <p>
        Installed at <code className="text-foreground">{status.path}</code>.{" "}
        {status.onPath ? (
          <>
            Open a new terminal, then run <code className="text-foreground">pie</code>.
          </>
        ) : (
          "Add ~/.local/bin to your PATH:"
        )}
      </p>
      {status.onPath ? null : (
        <code className="bg-muted text-foreground rounded-md px-2 py-1 text-xs select-all">
          {PATH_LINE}
        </code>
      )}
      {status.shadowedBy === null ? null : (
        <p>
          <code className="text-foreground">{status.shadowedBy}</code> comes first on your PATH, so
          terminals run that one instead.
        </p>
      )}
    </div>
  );
}

/** Settings → Command line: install the `pie` command this desktop build ships. */
export function CommandLineSettings({ cli }: { cli: PlatformCli }): ReactElement | null {
  const queryClient = useQueryClient();
  // The files can change outside the app (a terminal, another install), so
  // re-read on mount and focus instead of the app-wide Infinity staleTime.
  const statusQuery = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => cli.status(),
    staleTime: 0,
  });
  const change = useMutation({
    mutationFn: (action: "install" | "uninstall") =>
      action === "install" ? cli.install() : cli.uninstall(),
    onSuccess: (next) => {
      queryClient.setQueryData(STATUS_KEY, next);
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
      toast.error(error instanceof Error ? error.message : "Could not change the pie command");
    },
  });
  const status = statusQuery.data;
  if (status === undefined) return null;

  return (
    <section className="flex flex-col gap-3" id="command-line">
      <h2 className="text-sm font-medium">Command line</h2>
      <p className="text-muted-foreground text-sm">
        Run Pie from a terminal with the <code className="text-foreground">pie</code> command. It
        runs this app, so its version always matches.
      </p>
      <CommandState status={status} />
      <div>
        <Button
          disabled={change.isPending || (!status.installed && status.conflict !== null)}
          type="button"
          variant="outline"
          onClick={() => change.mutate(status.installed ? "uninstall" : "install")}
        >
          {status.installed ? "Uninstall" : "Install"}
        </Button>
      </div>
    </section>
  );
}

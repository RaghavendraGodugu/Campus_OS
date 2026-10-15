import { useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";

import { downloadReport } from "../api/client";
import Button from "./ui/Button";

/**
 * Download a report as CSV or PDF.
 *
 * ## Why this fetches a blob instead of linking to the endpoint
 *
 * A plain `<a href>` would be one line and would also be useless on failure: a
 * 403 or a rejected parameter opens a blank tab, the user sees nothing, and
 * concludes the button is broken. The export carries the same scope rules as
 * the screen, so "you cannot see this report" has to arrive as a message this
 * page can actually show.
 *
 * ## The object URL is revoked on a timer, not on unmount
 *
 * Revoking immediately cancels the download that was just started. Revoking on
 * unmount leaks one blob per export for the life of the tab, and under React's
 * development double-mount an unmount cleanup revokes the URL before the
 * browser has read it. A timer avoids both: the blob outlives the click and is
 * still reclaimed.
 */

const REVOKE_DELAY_MS = 60_000;

export default function ReportExport({ kind, range, department }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const timers = useRef([]);

  const run = async (format) => {
    setBusy(format);
    setError(null);

    try {
      const { url, filename } = await downloadReport(kind, {
        format,
        range,
        department,
      });

      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();

      timers.current.push(
        setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS),
      );
    } catch (caught) {
      setError(caught?.message ?? "The export could not be produced.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => run("csv")}
          disabled={busy !== null}
        >
          {busy === "csv" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <FileSpreadsheet className="size-4" aria-hidden="true" />
          )}
          CSV
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => run("pdf")}
          disabled={busy !== null}
        >
          {busy === "pdf" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <FileText className="size-4" aria-hidden="true" />
          )}
          PDF
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <p className="text-xs text-ink-500 dark:text-ink-400">
        <Download className="mr-1 inline size-3" aria-hidden="true" />
        Exports carry the same scope as this page.
      </p>
    </div>
  );
}

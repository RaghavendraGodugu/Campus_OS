import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Paperclip, Trash2, Upload } from "lucide-react";

import { apiDelete, apiGet, apiPost } from "../api/client";
import { Card } from "./ui/Card";
import Button from "./ui/Button";
import Field, { inputClass } from "./ui/Field";
import { EmptyState } from "./ui/States";

/** Accepted types, matching the server's allowlist exactly. */
const ACCEPT = "application/pdf,image/jpeg,image/png";

const MAX_MB = 10;

/** Human-readable byte count. */
function size(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Attach and manage documents.
 *
 * ## The browser checks are for comfort, not safety
 *
 * The file's type and size are decided on the server, from its content. The
 * accept list here stops an obviously wrong file reaching the network at all;
 * it is never what makes a file safe, and the server's refusal is what does.
 *
 * The client-side size check exists so an oversized file is refused with an
 * explanation rather than after a long upload. It is not the limit — the server
 * enforces its own, which is the one that counts.
 *
 * ## Removal is guarded server-side
 *
 * Once a request starts being processed, a document is evidence and the server
 * refuses deletion. This offers the button anyway and shows the refusal,
 * because hiding it would teach the student that the option does not exist
 * rather than that it is closed for a reason.
 */
export default function DocumentPanel({
  endpoint,
  parentReference,
  required = [],
  canUpload = true,
  canRemove = true,
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef(null);

  const [label, setLabel] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const queryKey = ["documents", endpoint, parentReference];

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => apiGet(`${endpoint}/${parentReference}/documents`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey });
    setNotice(null);
  };

  const upload = useMutation({
    mutationFn: async (file) => {
      const form = new FormData();
      if (label.trim()) form.append("label", label.trim());
      form.append("file", file);

      return apiPost(`${endpoint}/${parentReference}/documents`, form, {
        // Let the browser set the multipart boundary; setting it by hand is
        // the classic way to produce a body the parser cannot read.
        headers: { "Content-Type": undefined },
      });
    },
    onSuccess: (response) => {
      setError(null);
      setLabel("");
      if (inputRef.current) inputRef.current.value = "";
      setNotice(
        response.data?.satisfiesRequired
          ? "Attached, and recorded against a required item."
          : "Attached.",
      );
      invalidate();
    },
    onError: (failure) => setError(failure.message),
  });

  const remove = useMutation({
    mutationFn: (id) => apiDelete(`/documents/${id}`),
    onSuccess: invalidate,
    onError: (failure) => setError(failure.message),
  });

  const download = async (id) => {
    try {
      setError(null);
      const response = await fetch(`/api/v1/documents/${id}/download`, {
        credentials: "include",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? "That document could not be opened.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError("That document could not be opened.");
    }
  };

  const documents = data?.data ?? [];
  const missing = data?.meta?.missing ?? required;

  const onFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);

    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`That file is ${size(file.size)}. The maximum is ${MAX_MB} MB.`);
      event.target.value = "";
      return;
    }

    upload.mutate(file);
  };

  return (
    <Card
      title="Documents"
      description="PDF, JPEG or PNG, up to 10 MB. Private: only you and the staff handling this can open them."
    >
      <div className="space-y-5">
        {missing.length > 0 && (
          <div className="rounded-lg bg-amber-50 px-3 py-2.5">
            <p className="text-xs font-medium text-amber-900">Still needed:</p>
            <ul className="mt-1 space-y-0.5">
              {missing.map((item) => (
                <li key={item.name} className="text-xs text-amber-800">
                  • {item.name}
                  {item.description && (
                    <span className="text-amber-700">
                      {" "}
                      — {item.description}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {missing.length === 0 && documents.length > 0 && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            Everything this application asked for has been attached.
          </p>
        )}

        {isLoading && (
          <p className="text-sm text-ink-500">Loading documents…</p>
        )}
        {isError && (
          <p className="text-sm text-red-600">Could not load the documents.</p>
        )}

        {!isLoading && documents.length === 0 && (
          <EmptyState
            icon={Paperclip}
            title="Nothing attached"
            description="Upload the documents listed above so this can be processed."
          />
        )}

        {documents.length > 0 && (
          <ul className="divide-y divide-ink-100">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center gap-3 py-3 first:pt-0"
              >
                <FileText
                  className="size-4 shrink-0 text-ink-400"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-800">
                    {document.label ?? document.originalName}
                  </p>
                  <p className="text-xs text-ink-500">
                    {size(document.size)} ·{" "}
                    {document.mimeType.replace("application/", "")}
                  </p>
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => download(document.id)}
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  Open
                </Button>

                {canRemove && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={remove.isPending}
                    onClick={() => remove.mutate(document.id)}
                    aria-label={`Remove ${document.originalName}`}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canUpload && (
          <div className="space-y-3 border-t border-ink-100 pt-4">
            <Field
              label="What is this?"
              htmlFor="document-label"
              hint="Match one of the items above where possible."
            >
              <input
                id="document-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="e.g. ID proof"
                maxLength={120}
                className={inputClass}
              />
            </Field>

            <div>
              <label
                htmlFor="document-file"
                className="block text-sm font-medium text-ink-700"
              >
                Choose a file
              </label>
              <input
                ref={inputRef}
                id="document-file"
                type="file"
                accept={ACCEPT}
                onChange={onFile}
                disabled={upload.isPending}
                className="mt-1.5 block w-full text-sm text-ink-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3.5 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
              />
            </div>
          </div>
        )}

        {upload.isPending && (
          <p
            className="flex items-center gap-2 text-xs text-ink-500"
            role="status"
          >
            <Upload className="size-3.5 animate-pulse" aria-hidden="true" />
            Uploading and checking the file…
          </p>
        )}

        {notice && (
          <p
            role="status"
            className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
          >
            {notice}
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}

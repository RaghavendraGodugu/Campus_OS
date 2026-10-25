import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BadgeCheck, Download, Plus } from "lucide-react";

import { apiGet, fetchDocument } from "../api/client";
import BulkIssueBar from "../components/BulkIssueBar";
import { formatDate } from "../lib/format";
import { Card } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Pagination from "../components/ui/Pagination";
import { EmptyState, ErrorState } from "../components/ui/States";
import { SkeletonList, SkeletonRegion } from "../components/ui/Skeleton";

/**
 * Certificates.
 *
 * ## Downloads go through the app, not to the API URL
 *
 * A certificate PDF is private: the server checks who may have it before
 * producing a single byte. Navigating straight to the endpoint would work for
 * the holder and reveal nothing to anyone else, but it renders an authorisation
 * failure as a blank tab rather than as a message. Fetching it as a blob lets a
 * refusal surface as something readable.
 */
export default function Certificates({ mode = "own" }) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["certificates", mode, page],
    queryFn: () => apiGet(`/certificates?page=${page}&limit=20`),
  });

  const download = useMutation({
    mutationFn: async (certificateId) => {
      const url = await fetchDocument(
        `/certificates/${certificateId}/download`,
      );
      window.open(url, "_blank", "noopener");
      // The blob stays alive long enough for the tab to load it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  });

  const items = data?.data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
            Certificates
          </h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500">
            {mode === "own"
              ? "Applications you have made, and the documents issued."
              : "Certificate applications in your department."}
          </p>
        </div>

        {/* Only a student can apply, which is the same condition the API
            enforces, so the button never leads to a 403. */}
        {mode === "own" && (
          <Link
            to="/certificates/new"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-linear-to-b from-brand-500 to-brand-600 px-5 text-sm font-medium text-white shadow-brand ring-1 ring-brand-600/20 transition-all duration-150 hover:to-brand-700 hover:shadow-raised active:scale-[0.98]"
          >
            <Plus className="size-4" aria-hidden="true" />
            Apply for a certificate
          </Link>
        )}
      </header>

      {isLoading && (
        <SkeletonRegion label="Loading certificates">
          <SkeletonList rows={6} />
        </SkeletonRegion>
      )}
      {isError && (
        <ErrorState message={error?.message} onRetry={() => refetch()} />
      )}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={BadgeCheck}
          title="No certificates yet"
          description="You have not applied for anything yet. Choose the certificate you need and it will be issued from your student record."
          action={
            mode === "own" ? (
              <Link
                to="/certificates/new"
                className="inline-flex h-9.5 items-center gap-2 rounded-xl bg-linear-to-b from-brand-500 to-brand-600 px-4 text-sm font-medium text-white shadow-brand ring-1 ring-brand-600/20 transition-all duration-150 hover:to-brand-700 hover:shadow-raised active:scale-[0.98]"
              >
                <Plus className="size-4" aria-hidden="true" />
                Apply for a certificate
              </Link>
            ) : null
          }
        />
      )}

      <BulkIssueBar
        selected={selected}
        onClear={() => setSelected([])}
        onIssued={() => {
          setSelected([]);
          refetch();
        }}
      />

      {items.length > 0 && (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-ink-100">
            {items.map((certificate) => {
              const id = certificate._id ?? certificate.id;
              // Only an APPROVED certificate can be bulk-issued, so only an
              // approved one gets a checkbox. Offering one on a pending
              // application would invite a click that is refused.
              const approvable = certificate.status === "APPROVED";
              const checked = selected.includes(id);

              return (
                <li key={id} className="flex items-start gap-3 px-5 py-4">
                  {approvable ? (
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-600 dark:border-ink-600"
                      aria-label={`Select ${certificate.reference}`}
                      checked={checked}
                      onChange={(event) =>
                        setSelected((prev) =>
                          event.target.checked
                            ? [...prev, id]
                            : prev.filter((entry) => entry !== id),
                        )
                      }
                    />
                  ) : (
                    <span aria-hidden="true" className="mt-1 size-4 shrink-0" />
                  )}

                  <div className="min-w-0 flex-1">
                    <Link
                      to={`${mode === "own" ? "/certificates" : "/management/certificates"}/${certificate.reference}`}
                      className="mb-2 block text-sm font-medium text-brand-700 dark:text-brand-300 hover:underline"
                    >
                      Open {certificate.reference}
                    </Link>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-900 dark:text-ink-100">
                          {String(certificate.type ?? "")
                            .replace(/_/g, " ")
                            .toLowerCase()}
                          {certificate.copies > 1 &&
                            ` · ${certificate.copies} copies`}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400 dark:text-ink-500">
                          {certificate.reference}
                          {certificate.purpose && ` · ${certificate.purpose}`}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge status={certificate.status} />

                        {/* Only a GENERATED certificate has a document to fetch. */}
                        {certificate.status === "GENERATED" &&
                          certificate.document && (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={download.isPending}
                              onClick={() =>
                                download.mutate(
                                  certificate._id ?? certificate.id,
                                )
                              }
                            >
                              <Download
                                className="size-3.5"
                                aria-hidden="true"
                              />
                              PDF
                            </Button>
                          )}
                      </div>
                    </div>

                    {certificate.verificationCode && (
                      <p className="mt-2 text-[11px] text-ink-400 dark:text-ink-500 dark:text-ink-400 dark:text-ink-500">
                        Verification code {certificate.verificationCode} ·
                        issued {formatDate(certificate.issuedAt)}
                      </p>
                    )}

                    {certificate.rejectionReason && (
                      <p className="mt-2 rounded-lg bg-red-50 dark:bg-red-500/12 px-3 py-2 text-xs text-red-800 dark:text-red-200">
                        Declined: {certificate.rejectionReason}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {data?.meta && (
            <Pagination
              page={page}
              limit={data.meta.limit}
              total={data.meta.total}
              onPage={setPage}
            />
          )}
        </Card>
      )}
    </div>
  );
}

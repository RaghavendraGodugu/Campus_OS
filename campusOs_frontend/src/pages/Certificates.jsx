import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BadgeCheck, Download } from "lucide-react";

import { apiGet, fetchDocument } from "../api/client";
import { formatDate } from "../lib/format";
import { Card } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Pagination from "../components/ui/Pagination";
import { EmptyState, ErrorState, Loading } from "../components/ui/States";

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
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Certificates
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {mode === "own"
            ? "Applications you have made, and the documents issued."
            : "Certificate applications in your department."}
        </p>
      </header>

      {isLoading && <Loading label="Loading certificates" />}
      {isError && (
        <ErrorState message={error?.message} onRetry={() => refetch()} />
      )}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={BadgeCheck}
          title="No certificates"
          description="Applied-for certificates will appear here once they are issued."
        />
      )}

      {items.length > 0 && (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-ink-100">
            {items.map((certificate) => (
              <li key={certificate._id ?? certificate.id} className="px-5 py-4">
                <Link
                  to={`${mode === "own" ? "/certificates" : "/management/certificates"}/${certificate.reference}`}
                  className="mb-2 block text-sm font-medium text-brand-700 hover:underline"
                >
                  Open {certificate.reference}
                </Link>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900">
                      {String(certificate.type ?? "")
                        .replace(/_/g, " ")
                        .toLowerCase()}
                      {certificate.copies > 1 &&
                        ` · ${certificate.copies} copies`}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500">
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
                            download.mutate(certificate._id ?? certificate.id)
                          }
                        >
                          <Download className="size-3.5" aria-hidden="true" />
                          PDF
                        </Button>
                      )}
                  </div>
                </div>

                {certificate.verificationCode && (
                  <p className="mt-2 text-[11px] text-ink-400">
                    Verification code {certificate.verificationCode} · issued{" "}
                    {formatDate(certificate.issuedAt)}
                  </p>
                )}

                {certificate.rejectionReason && (
                  <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                    Declined: {certificate.rejectionReason}
                  </p>
                )}
              </li>
            ))}
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

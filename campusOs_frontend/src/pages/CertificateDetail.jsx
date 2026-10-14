import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, ShieldCheck } from "lucide-react";

import { apiGet, fetchDocument } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatDateTime, humanise } from "../lib/format";
import { Card } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import TransitionPanel, {
  DangerousAction,
} from "../components/TransitionPanel";
import DocumentPanel from "../components/DocumentPanel";
import { ErrorState } from "../components/ui/States";
import {
  SkeletonHeading,
  SkeletonPanel,
  SkeletonRegion,
} from "../components/ui/Skeleton";

/**
 * One certificate, and the actions that produce or undo it.
 *
 * ## Issuing is separated from moving the status
 *
 * A certificate reaches GENERATED through an issue call, not a bare transition,
 * because issuing produces a document with a verification code that a person
 * will rely on. Revoking is irreversible in the same way. Both ask for a reason,
 * which lands in the audit trail permanently.
 *
 * ## The download is private
 *
 * The PDF is served only after the server has decided this viewer may have it,
 * so it is fetched as a blob rather than navigated to: an authorisation failure
 * surfaces as a message instead of a blank tab.
 */
export default function CertificateDetail() {
  const { reference } = useParams();
  const { can, canAny } = useAuth();
  const queryClient = useQueryClient();
  const [downloadError, setDownloadError] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["certificate", reference],
    queryFn: () => apiGet(`/certificates/${reference}`),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["certificate", reference] });

  const download = useMutation({
    mutationFn: async () => {
      setDownloadError(null);
      const url = await fetchDocument(`/certificates/${reference}/download`);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: (failure) => setDownloadError(failure.message),
  });

  if (isLoading)
    return (
      <SkeletonRegion label="Loading certificate">
        <div className="space-y-6">
          <SkeletonHeading />
          <div className="grid gap-4 sm:grid-cols-2">
            <SkeletonPanel lines={3} />
            <SkeletonPanel lines={3} />
          </div>
          <SkeletonPanel lines={5} />
        </div>
      </SkeletonRegion>
    );
  if (isError) {
    return (
      <ErrorState
        title="Certificate not available"
        message={error?.message}
        onRetry={() => refetch()}
      />
    );
  }

  const certificate = data.data;
  const base = "/certificates";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        to={
          canAny("certificate:read:assigned", "certificate:read:institution")
            ? "/management/certificates"
            : "/certificates"
        }
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 dark:text-ink-400 hover:text-ink-800"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All certificates
      </Link>

      <header className="rounded-xl bg-white dark:bg-surface px-6 py-5 shadow-sm ring-1 ring-ink-200/70 dark:ring-ink-600">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-ink-900">
              {humanise(certificate.type)}
              {certificate.copies > 1 && ` · ${certificate.copies} copies`}
            </h1>
            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
              {certificate.reference}
              {certificate.purpose && ` · ${certificate.purpose}`}
            </p>
          </div>
          <Badge status={certificate.status} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-ink-100 dark:border-ink-700/50 pt-4 sm:grid-cols-4">
          <Detail
            label="Applied"
            value={formatDateTime(certificate.submittedAt)}
          />
          <Detail label="Issued" value={formatDateTime(certificate.issuedAt)} />
          <Detail
            label="Issued by"
            value={certificate.issuedBy?.fullName ?? "—"}
          />
          <Detail
            label="Verification"
            value={certificate.verificationCode ?? "—"}
          />
        </dl>

        {certificate.rejectionReason && (
          <p className="mt-4 rounded-lg bg-red-50 dark:bg-red-500/12 px-3 py-2 text-sm text-red-800 dark:text-red-200">
            Declined: {certificate.rejectionReason}
          </p>
        )}

        {certificate.revocation && (
          <div className="mt-4 rounded-lg bg-red-50 dark:bg-red-500/12 px-3 py-2 text-sm text-red-800 dark:text-red-200">
            <p className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="size-4" aria-hidden="true" />
              Revoked {formatDateTime(certificate.revocation.revokedAt)}
            </p>
            {certificate.revocation.reason && (
              <p className="mt-1">{certificate.revocation.reason}</p>
            )}
          </div>
        )}
      </header>

      {/* ===== The document ===== */}
      {certificate.status === "GENERATED" && certificate.document && (
        <Card
          title="Document"
          description="Served privately. The download is checked against your permissions."
        >
          <Button
            variant="secondary"
            loading={download.isPending}
            onClick={() => download.mutate()}
          >
            <Download className="size-4" aria-hidden="true" />
            Download PDF
          </Button>

          {downloadError && (
            <p
              role="alert"
              className="mt-3 rounded-lg bg-red-50 dark:bg-red-500/12 px-3 py-2 text-sm text-red-700 dark:text-red-300"
            >
              {downloadError}
            </p>
          )}
        </Card>
      )}

      <DocumentPanel endpoint="/certificates" parentReference={reference} />

      {/* ===== Actions ===== */}
      <TransitionPanel
        endpoint={base}
        record={certificate}
        transitions={certificate.availableTransitions}
        onDone={invalidate}
        emptyNote="No workflow actions are available to you here."
      />

      {can("certificate:issue:institution") &&
        certificate.status === "APPROVED" &&
        !certificate.document && (
          <DangerousAction
            title="Issue this certificate"
            description="Generates the PDF, assigns a verification code and sends it to the student. This produces a document people rely on."
            buttonLabel="Issue certificate"
            confirmLabel="Issue and notify"
            variant="primary"
            endpoint={`${base}/${reference}/issue`}
            requiresReason={false}
            onDone={invalidate}
          />
        )}

      {can("certificate:revoke:institution") &&
        certificate.status === "GENERATED" && (
          <DangerousAction
            title="Revoke this certificate"
            description="Permanent. The record is kept and the revocation is shown on every copy."
            buttonLabel="Revoke"
            confirmLabel="Revoke permanently"
            endpoint={`${base}/${reference}/revoke`}
            onDone={invalidate}
          />
        )}

      {/* ===== History ===== */}
      <Card title="History">
        <ol className="space-y-4">
          {(certificate.statusHistory ?? []).map((entry, index) => (
            <li key={entry._id ?? index} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-brand-600" />
                {index < certificate.statusHistory.length - 1 && (
                  <span className="mt-1 w-px flex-1 bg-ink-200 dark:bg-ink-700/50" />
                )}
              </div>
              <div className="pb-1">
                <p className="text-sm font-medium text-ink-800">
                  {entry.from ? `${humanise(entry.from)} → ` : ""}
                  {humanise(entry.to)}
                </p>
                <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                  {formatDateTime(entry.at)}
                  {entry.actorRole && ` · ${humanise(entry.actorRole)}`}
                  {entry.note && ` · ${entry.note}`}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-ink-500 dark:text-ink-400 uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink-800">{value ?? "—"}</dd>
    </div>
  );
}

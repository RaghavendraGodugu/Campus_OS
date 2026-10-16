import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Percent, ShieldAlert } from "lucide-react";

import { apiGet, apiPatch, apiPost } from "../api/client";
import { formatDate, formatMoney } from "../lib/format";
import Button from "./ui/Button";
import Field, { inputClass } from "./ui/Field";
import Modal from "./ui/Modal";
import { ErrorState } from "./ui/States";
import { SkeletonList, SkeletonRegion } from "./ui/Skeleton";

/**
 * Instalments and penalty policy on one invoice.
 *
 * ## Splitting is refused once a payment lands
 *
 * The schedule would no longer sum to what the student was told they owe, and
 * the difference would come out of their pocket silently. The screen says so
 * before the control is offered, rather than letting somebody discover it by
 * being refused.
 *
 * ## Percentages are entered as percentages, not basis points
 *
 * The API speaks basis points because it must never hold a float percentage.
 * A finance officer thinks "1.5% per month" and typing 150 bps into a box
 * labelled "penalty rate" is a mistake waiting to happen — one hundred times
 * the intended charge.
 *
 * ## The policy is snapshotted
 *
 * Setting a rate here attaches it to this invoice. Changing the college's rate
 * next month does not retroactively alter terms this student already agreed to,
 * and the screen says so.
 */

const MAX_INSTALMENTS = 24;

export default function InstalmentPanel({
  invoiceId,
  total,
  paidAmount,
  canManage,
}) {
  const queryClient = useQueryClient();
  const [scheduling, setScheduling] = useState(false);
  const [settingPolicy, setSettingPolicy] = useState(false);

  const schedule = useQuery({
    queryKey: ["invoice-schedule", invoiceId],
    queryFn: () => apiGet(`/invoices/${invoiceId}/schedule`),
    enabled: Boolean(invoiceId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: ["invoice-schedule", invoiceId],
    });
    queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
  };

  const sweep = useMutation({
    mutationFn: () =>
      apiPost("/invoices/penalty-sweep", { invoiceIds: [invoiceId] }),
    onSuccess: invalidate,
  });

  const data = schedule.data?.data;
  const instalments = data?.instalments ?? [];
  const penalty = data?.penalty;
  const hasPayment = (paidAmount ?? 0) > 0;

  return (
    <section aria-label="Instalments and penalties" className="space-y-4">
      {schedule.isLoading ? (
        <SkeletonRegion label="Loading the payment schedule">
          <SkeletonList rows={3} />
        </SkeletonRegion>
      ) : schedule.isError ? (
        <ErrorState
          message={schedule.error?.message}
          onRetry={() => schedule.refetch()}
        />
      ) : (
        <>
          {instalments.length === 0 ? (
            <div className="rounded-card border border-dashed border-ink-300 px-5 py-6 text-center dark:border-ink-600">
              <CalendarClock
                className="mx-auto size-6 text-ink-400 dark:text-ink-500"
                aria-hidden="true"
              />
              <p className="mt-2 text-sm font-medium text-ink-800 dark:text-ink-100">
                Payable in one go
              </p>
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                This invoice has no instalment schedule. Splitting it is
                available until a payment lands against it.
              </p>

              {canManage && !hasPayment && (
                <Button
                  className="mt-4"
                  size="sm"
                  onClick={() => setScheduling(true)}
                >
                  Split into instalments
                </Button>
              )}

              {hasPayment && (
                <p className="mt-3 text-xs text-ink-500 dark:text-ink-400">
                  A payment has already landed, so this can no longer be split.
                </p>
              )}
            </div>
          ) : (
            <>
              <ol className="space-y-2">
                {instalments.map((instalment) => (
                  <li
                    key={instalment.sequence}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-200 px-4 py-3 dark:border-ink-700"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink-900 dark:text-ink-100">
                        Instalment {instalment.sequence} of {instalments.length}
                      </p>
                      <p className="text-xs text-ink-500 dark:text-ink-400">
                        Due {formatDate(instalment.dueAt)}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-sm font-medium text-ink-900 dark:text-ink-100">
                        {formatMoney(instalment.amount)}
                      </p>
                      <p
                        className={`text-xs ${
                          instalment.isPaid
                            ? "text-brand-700 dark:text-brand-300"
                            : instalment.outstanding > 0
                              ? "text-accent-700 dark:text-accent-300"
                              : "text-ink-500 dark:text-ink-400"
                        }`}
                      >
                        {instalment.isPaid
                          ? "Paid"
                          : `${formatMoney(instalment.outstanding)} outstanding`}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              {/*
                The last instalment is larger than the others by design, so the
                schedule sums to the total exactly. Saying so stops somebody
                treating it as a bug and "correcting" it.
              */}
              {instalments.length > 1 && (
                <p className="text-xs text-ink-500 dark:text-ink-400">
                  The final instalment absorbs the rounding remainder, so the
                  schedule adds up to {formatMoney(total)} exactly.
                </p>
              )}
            </>
          )}

          {canManage && (
            <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4 dark:border-ink-700/50">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSettingPolicy(true)}
              >
                <Percent className="size-4" aria-hidden="true" />
                Penalty policy
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => sweep.mutate()}
                disabled={sweep.isPending || !penalty?.rateBps}
              >
                <ShieldAlert className="size-4" aria-hidden="true" />
                Check overdue penalty
              </Button>
            </div>
          )}

          {sweep.data && (
            <p role="status" className="text-xs text-ink-600 dark:text-ink-300">
              {sweep.data.data.message}
              {/*
                When nothing was charged, say why. "0 invoices charged" on its
                own leaves somebody wondering whether the sweep is broken.
              */}
              {sweep.data.data.data.charged.length === 0 &&
                sweep.data.data.data.skipped[0] &&
                ` (${sweep.data.data.data.skipped[0].reason})`}
            </p>
          )}

          {scheduling && (
            <ScheduleDialog
              invoiceId={invoiceId}
              total={total}
              onClose={() => setScheduling(false)}
              onDone={() => {
                setScheduling(false);
                invalidate();
              }}
            />
          )}

          {settingPolicy && penalty && (
            <PolicyDialog
              invoiceId={invoiceId}
              policy={penalty}
              onClose={() => setSettingPolicy(false)}
              onDone={() => {
                setSettingPolicy(false);
                invalidate();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

function ScheduleDialog({ invoiceId, total, onClose, onDone }) {
  const [count, setCount] = useState(3);
  const [firstDueAt, setFirstDueAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [periodDays, setPeriodDays] = useState(30);
  const [error, setError] = useState(null);

  const create = useMutation({
    mutationFn: () =>
      apiPost(`/invoices/${invoiceId}/schedule`, {
        instalments: Number(count),
        firstDueAt,
        periodDays: Number(periodDays),
      }),
    onSuccess: onDone,
    onError: (caught) => setError(caught?.message),
  });

  // A preview only: the last instalment takes the remainder.
  const preview = Array.from({ length: Number(count) || 1 }, (_, index) => {
    const base = Math.floor(total / (Number(count) || 1));
    return index === Number(count) - 1 ? total - base * index : base;
  });

  return (
    <Modal
      open
      title="Split into instalments"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            Create schedule
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Instalments" htmlFor="inst-count" required>
            <input
              id="inst-count"
              type="number"
              min={1}
              max={MAX_INSTALMENTS}
              value={count}
              onChange={(event) => setCount(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="First due" htmlFor="inst-first" required>
            <input
              id="inst-first"
              type="date"
              value={firstDueAt}
              onChange={(event) => setFirstDueAt(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Days between" htmlFor="inst-period">
            <input
              id="inst-period"
              type="number"
              min={1}
              max={365}
              value={periodDays}
              onChange={(event) => setPeriodDays(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="rounded-lg bg-ink-50 p-3 dark:bg-ink-100/40">
          <p className="text-xs font-medium text-ink-800 dark:text-ink-100">
            Adds up to {formatMoney(total)}
          </p>
          <ul className="mt-1 text-xs text-ink-600 dark:text-ink-300">
            {preview.map((amount, index) => (
              <li key={index}>
                {index + 1}: {formatMoney(amount)}
              </li>
            ))}
          </ul>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function PolicyDialog({ invoiceId, policy, onClose, onDone }) {
  // Percentages in the box; the API takes basis points.
  const [ratePercent, setRatePercent] = useState(
    String((policy.rateBps ?? 0) / 100),
  );
  const [graceDays, setGraceDays] = useState(String(policy.graceDays ?? 0));
  const [periodDays, setPeriodDays] = useState(String(policy.periodDays ?? 30));
  const [capPercent, setCapPercent] = useState(
    String((policy.capBps ?? 0) / 100),
  );
  const [error, setError] = useState(null);

  const save = useMutation({
    mutationFn: () =>
      apiPatch(`/invoices/${invoiceId}/penalty-policy`, {
        rateBps: Math.round(Number(ratePercent || 0) * 100),
        graceDays: Number(graceDays || 0),
        periodDays: Number(periodDays || 30),
        capBps: Math.round(Number(capPercent || 0) * 100),
      }),
    onSuccess: onDone,
    onError: (caught) => setError(caught?.message),
  });

  return (
    <Modal
      open
      title="Late-payment penalty"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save policy
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-ink-500 dark:text-ink-400">
          This policy is attached to this invoice. Changing the college&apos;s
          rate later will not alter terms this student has already agreed to.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rate per period (%)" htmlFor="pol-rate" required>
            <input
              id="pol-rate"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={ratePercent}
              onChange={(event) => setRatePercent(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Days between periods" htmlFor="pol-period">
            <input
              id="pol-period"
              type="number"
              min={1}
              max={365}
              value={periodDays}
              onChange={(event) => setPeriodDays(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field
            label="Grace days"
            htmlFor="pol-grace"
            hint="Charging starts after these days, not at the due date."
          >
            <input
              id="pol-grace"
              type="number"
              min={0}
              max={90}
              value={graceDays}
              onChange={(event) => setGraceDays(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field
            label="Cap (% of invoice)"
            htmlFor="pol-cap"
            hint="0 means no cap."
          >
            <input
              id="pol-cap"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={capPercent}
              onChange={(event) => setCapPercent(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Save } from "lucide-react";

import { apiGet, apiPut } from "../../api/client";
import Button from "../../components/ui/Button";
import Field, { inputClass } from "../../components/ui/Field";
import { ErrorState } from "../../components/ui/States";
import { SkeletonForm, SkeletonRegion } from "../../components/ui/Skeleton";
import { GST_RATES, formatRate } from "./constants";

/**
 * The institution's GST profile.
 *
 * ## There is no state code field, and that is the point
 *
 * A GSTIN's first two digits *are* the state the registration is in. Offering a
 * separate box invites the two to disagree, and a profile claiming state 07
 * while carrying a GSTIN beginning 29 issues invoices stating the wrong place of
 * supply — wrong on the document, and invisible on it.
 *
 * The state is therefore derived, and shown read-only, so the value in use is
 * visible without being editable into a contradiction.
 *
 * ## Why it is one screen for the whole college
 *
 * There is one supplier. A per-department registration would mean an invoice
 * picks a GSTIN at random, and a tax invoice's GSTIN must be the registered
 * one.
 */

export default function GstProfile() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);

  const profile = useQuery({
    queryKey: ["tax-profile"],
    queryFn: () => apiGet("/tax-profile"),
    // Seeded from the server value once it arrives, so the read-only state code
    // can be derived from the GSTIN the college actually registered with.
    onSuccess: (response) => {
      const existing = response.data.profile;
      if (existing && !form) setForm(existing);
    },
  });

  const save = useMutation({
    mutationFn: (payload) => apiPut("/tax-profile", payload),
    onSuccess: (response) => {
      setForm(response.data.profile);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["tax-profile"] });
    },
    onError: (caught) =>
      setError(
        caught?.fieldErrors
          ? Object.entries(caught.fieldErrors)
              .map(([field, message]) => `${field}: ${message}`)
              .join(" ")
          : (caught?.message ?? "The profile could not be saved"),
      ),
  });

  if (profile.isLoading) {
    return (
      <SkeletonRegion label="Loading the GST profile">
        <SkeletonForm fields={5} />
      </SkeletonRegion>
    );
  }

  if (profile.isError) {
    return (
      <ErrorState
        message={profile.error?.message}
        onRetry={() => profile.refetch()}
      />
    );
  }

  const current = form ?? {
    legalName: "",
    gstin: "",
    placeOfSupply: "",
    addressLine1: "",
    addressLine2: "",
    pincode: "",
    email: "",
    authorisedSignatory: "",
  };

  // Derived, never typed. See the note at the top of this file.
  const derivedState = /^[0-9]{2}/.test(current.gstin)
    ? current.gstin.slice(0, 2)
    : null;

  const set = (key) => (event) =>
    setForm({ ...current, [key]: event.target.value });

  return (
    <div className="space-y-5">
      <header>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-100">
          <Building2 className="size-4" aria-hidden="true" />
          Tax registration
        </h2>
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
          One registration for the whole college. Without it, invoices can carry
          a tax total but are not valid tax invoices — which is shown on each
          one rather than being refused.
        </p>
      </header>

      <div className="space-y-4">
        <Field label="Registered legal name" htmlFor="gst-legal" required>
          <input
            id="gst-legal"
            value={current.legalName}
            onChange={set("legalName")}
            maxLength={160}
            className={inputClass}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="GSTIN"
            htmlFor="gstin"
            required
            hint="15 characters. The first two are the state."
          >
            <input
              id="gstin"
              value={current.gstin}
              onChange={set("gstin")}
              maxLength={15}
              placeholder="29ABCDE1234F1Z5"
              className={`${inputClass} font-mono uppercase`}
            />
          </Field>

          <Field label="State" htmlFor="gst-state" hint="Taken from the GSTIN.">
            <input
              id="gst-state"
              value={derivedState ?? ""}
              readOnly
              disabled
              className={`${inputClass} bg-ink-50 dark:bg-ink-100/40`}
            />
          </Field>

          <Field label="Place of supply" htmlFor="gst-pos" required>
            <input
              id="gst-pos"
              value={current.placeOfSupply}
              onChange={set("placeOfSupply")}
              maxLength={120}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Address line 1" htmlFor="gst-addr1" required>
          <input
            id="gst-addr1"
            value={current.addressLine1}
            onChange={set("addressLine1")}
            maxLength={160}
            className={inputClass}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Address line 2" htmlFor="gst-addr2">
            <input
              id="gst-addr2"
              value={current.addressLine2 ?? ""}
              onChange={set("addressLine2")}
              maxLength={160}
              className={inputClass}
            />
          </Field>

          <Field label="PIN code" htmlFor="gst-pin">
            <input
              id="gst-pin"
              value={current.pincode ?? ""}
              onChange={set("pincode")}
              maxLength={6}
              inputMode="numeric"
              className={inputClass}
            />
          </Field>

          <Field label="Signatory email" htmlFor="gst-email">
            <input
              id="gst-email"
              type="email"
              value={current.email ?? ""}
              onChange={set("email")}
              className={inputClass}
            />
          </Field>
        </div>

        <p className="text-xs text-ink-500 dark:text-ink-400">
          Chargeable GST slabs: {GST_RATES.map(formatRate).join(", ")}. A line
          with tax must carry an HSN code of 2 to 8 digits.
        </p>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/12 dark:text-red-200"
          >
            {error}
          </p>
        )}

        <Button onClick={() => save.mutate(current)} loading={save.isPending}>
          <Save className="size-4" aria-hidden="true" />
          Save registration
        </Button>
      </div>
    </div>
  );
}

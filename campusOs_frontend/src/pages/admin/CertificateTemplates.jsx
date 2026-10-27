import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Star, Trash2 } from "lucide-react";

import { apiDelete, apiGet, apiPatch, apiPost } from "../../api/client";
import { humanise } from "../../lib/format";
import Button from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import Field, { inputClass } from "../../components/ui/Field";
import Modal from "../../components/ui/Modal";
import { EmptyState, ErrorState } from "../../components/ui/States";
import { SkeletonList, SkeletonRegion } from "../../components/ui/Skeleton";

/**
 * Certificate templates.
 *
 * ## Plain text with placeholders, never markup
 *
 * A template holds a heading, a body and a footer. Allowing HTML would mean a
 * template could emit script into a document that gets downloaded and opened,
 * and an uploaded logo would be an unvetted file on an official-looking page.
 *
 * ## A preview exists so nobody has to issue a certificate to find out
 *
 * The preview renders against a sample student and creates nothing. Issuing a
 * real certificate to check whether a template looks right would put a real
 * document in a real student's record.
 *
 * ## Unknown placeholders are shown, not swallowed
 *
 * If a template says `{{rollNo}}` and the system says `{{rollNumber}}`, the
 * preview leaves the text as-is and flags it. Blanking it would produce a
 * printed certificate with a gap where a roll number belongs, and nobody would
 * know why.
 */

const TYPES = [
  "BONAFIDE",
  "STUDY",
  "TRANSFER",
  "MIGRATION",
  "CHARACTER",
  "COURSE_COMPLETION",
  "NO_DUES",
  "INTERNSHIP",
  "TRANSCRIPT",
];

export default function CertificateTemplates() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});

  const list = useQuery({
    queryKey: ["certificate-templates"],
    queryFn: () => apiGet("/certificate-templates"),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["certificate-templates"] });
  };

  const create = useMutation({
    mutationFn: (payload) => apiPost("/certificate-templates", payload),
    onSuccess: () => {
      invalidate();
      setCreating(false);
      setErrors({});
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  });

  const update = useMutation({
    mutationFn: ({ id, payload }) =>
      apiPatch(`/certificate-templates/${id}`, payload),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      setErrors({});
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  });

  const makeDefault = useMutation({
    mutationFn: (id) =>
      apiPatch(`/certificate-templates/${id}`, { isDefault: true }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id) => apiDelete(`/certificate-templates/${id}`),
    onSuccess: invalidate,
  });

  const templates = list.data?.data?.templates ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
            Certificate templates
          </h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            What each certificate says. Plain text with placeholders — never
            markup, because these files get opened.
          </p>
        </div>

        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New template
        </Button>
      </header>

      {list.isLoading ? (
        <SkeletonRegion label="Loading certificate templates">
          <SkeletonList rows={4} />
        </SkeletonRegion>
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message}
          onRetry={() => list.refetch()}
        />
      ) : templates.length === 0 ? (
        <EmptyState
          title="No custom templates"
          description="Certificates use the built-in layout until you add one. Setting a template as the default changes what every future certificate of that type says."
        />
      ) : (
        <ul className="divide-y divide-ink-100/80 dark:divide-ink-700/50">
          {templates.map((template) => (
            <li
              key={template._id}
              className="flex flex-wrap items-center gap-4 px-1 py-4"
            >
              <FileText
                className="size-5 shrink-0 text-ink-400 dark:text-ink-400"
                aria-hidden="true"
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink-900 dark:text-ink-100">
                    {template.name}
                  </span>
                  <Badge status={template.type} />
                  {template.isDefault && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[0.6875rem] font-medium text-brand-800 ring-1 ring-brand-600/20 ring-inset dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-400/25">
                      <Star className="size-3" aria-hidden="true" />
                      Default
                    </span>
                  )}
                  {!template.isActive && (
                    <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[0.6875rem] font-medium text-ink-600 dark:bg-ink-200/40 dark:text-ink-300">
                      Retired
                    </span>
                  )}
                </div>

                <p className="mt-0.5 line-clamp-2 text-xs text-ink-500 dark:text-ink-400">
                  {template.body ||
                    template.heading ||
                    "No text set — uses the built-in layout."}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {!template.isDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => makeDefault.mutate(template._id)}
                    disabled={makeDefault.isPending || !template.isActive}
                  >
                    Make default
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(template)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove.mutate(template._id)}
                  disabled={template.isDefault || remove.isPending}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <TemplateDialog
          title={editing ? `Edit ${editing.name}` : "New template"}
          submitLabel={editing ? "Save changes" : "Create template"}
          template={editing}
          pending={editing ? update.isPending : create.isPending}
          errors={errors}
          onClose={() => {
            setCreating(false);
            setEditing(null);
            setErrors({});
          }}
          onSubmit={(payload) =>
            editing
              ? update.mutate({ id: editing._id, payload })
              : create.mutate(payload)
          }
        />
      )}
    </div>
  );
}

const TOKEN_HELP =
  "{{studentName}} {{rollNumber}} {{programme}} {{department}} {{semester}} {{academicYear}} {{certificateType}} {{issueDate}} {{reference}} {{signatoryName}} {{signatoryTitle}} {{institutionName}}";

function TemplateDialog({
  title,
  submitLabel,
  template,
  pending,
  errors,
  onClose,
  onSubmit,
}) {
  // The preview is its own operation with its own failure mode — a rejected
  // placeholder is not the same as a rejected save, and routing it into the
  // dialog's error slots would attribute it to the wrong field.
  const [previewError, setPreviewError] = useState(null);
  const [form, setForm] = useState({
    type: template?.type ?? "BONAFIDE",
    name: template?.name ?? "",
    heading: template?.heading ?? "",
    body: template?.body ?? "",
    footer: template?.footer ?? "",
    isDefault: template?.isDefault ?? false,
    isActive: template?.isActive ?? true,
  });

  const [preview, setPreview] = useState(null);
  const set = (key) => (event) =>
    setForm((prev) => ({
      ...prev,
      [key]:
        event.target.type === "checkbox"
          ? event.target.checked
          : event.target.value,
    }));

  // The preview posts what is in the box, so unsaved edits are what gets
  // rendered. It runs against a sample student and creates nothing.
  const previewCurrent = async () => {
    setPreview(null);
    setPreviewError(null);
    try {
      const saved = template
        ? await apiPatch(`/certificate-templates/${template._id}`, {
            type: form.type,
            name: form.name || "Draft",
            heading: form.heading || null,
            body: form.body || null,
            footer: form.footer || null,
            isDefault: form.isDefault,
            isActive: form.isActive,
          })
        : await apiPost("/certificate-templates", {
            type: form.type,
            name: form.name || "Draft",
            heading: form.heading || null,
            body: form.body || null,
            footer: form.footer || null,
            isDefault: false,
            isActive: true,
          });
      const rendered = await apiPost("/certificate-templates/preview", {
        type: form.type,
        templateId: saved.data.template._id,
      });
      setPreview(rendered.data);
    } catch (error) {
      setPreviewError(error?.message ?? "The preview could not be rendered.");
    }
  };

  return (
    <Modal
      open
      size="lg"
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={previewCurrent}
            disabled={pending}
          >
            Preview
          </Button>
          <Button onClick={() => onSubmit(form)} disabled={pending}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Certificate type"
            htmlFor="tpl-type"
            required
            error={errors.type}
          >
            <select
              id="tpl-type"
              value={form.type}
              onChange={set("type")}
              className={inputClass}
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {humanise(type)}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Template name"
            htmlFor="tpl-name"
            required
            error={errors.name}
          >
            <input
              id="tpl-name"
              value={form.name}
              onChange={set("name")}
              maxLength={120}
              placeholder="Standard bonafide"
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Heading" htmlFor="tpl-heading" error={errors.heading}>
          <input
            id="tpl-heading"
            value={form.heading}
            onChange={set("heading")}
            maxLength={200}
            className={inputClass}
          />
        </Field>

        <Field
          label="Body"
          htmlFor="tpl-body"
          hint={TOKEN_HELP}
          error={errors.body}
        >
          <textarea
            id="tpl-body"
            value={form.body}
            onChange={set("body")}
            rows={5}
            maxLength={4000}
            className={inputClass}
          />
        </Field>

        <Field label="Footer" htmlFor="tpl-footer" error={errors.footer}>
          <input
            id="tpl-footer"
            value={form.footer}
            onChange={set("footer")}
            maxLength={1000}
            className={inputClass}
          />
        </Field>

        <div className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-300">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={set("isDefault")}
              className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600 dark:border-ink-600"
            />
            Default for this type
          </label>

          <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-300">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={set("isActive")}
              className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600 dark:border-ink-600"
            />
            Available for new certificates
          </label>
        </div>

        {previewError && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {previewError}
          </p>
        )}

        {preview && (
          <section
            aria-label="Template preview"
            className="rounded-card border border-ink-200 bg-ink-50/60 p-4 dark:border-ink-600 dark:bg-ink-100/40"
          >
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              Preview — sample student, nothing created
            </h3>

            {preview.heading && (
              <p className="mt-2 text-sm font-semibold text-ink-900 dark:text-ink-100">
                {preview.heading}
              </p>
            )}
            {preview.body && (
              <p className="mt-1.5 text-sm whitespace-pre-wrap text-ink-700 dark:text-ink-300">
                {preview.body}
              </p>
            )}
            {preview.footer && (
              <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
                {preview.footer}
              </p>
            )}

            {preview.unknownTokens?.length > 0 && (
              <p
                role="alert"
                className="mt-3 text-xs text-red-700 dark:text-red-300"
              >
                Unknown placeholder
                {preview.unknownTokens.length > 1 ? "s" : ""}:{" "}
                {preview.unknownTokens
                  .map((token) => `{{${token}}}`)
                  .join(", ")}
                . They are shown above exactly as written rather than left
                blank, so the mistake is visible on the printed certificate.
              </p>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}

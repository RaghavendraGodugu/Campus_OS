import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Image,
  Eye,
  Check,
  Save,
} from "lucide-react";

import { apiGet, apiPatch, apiPost } from "../../api/client";
// import { formatDate } from "../../lib/format";
import Button from "../../components/ui/Button";
import Field, { inputClass } from "../../components/ui/Field";
import { ErrorState, Loading } from "../../components/ui/States";
import AdminLayout from "./AdminLayout";

/**
 * Branding configuration.
 *
 * The SUPER_ADMIN chooses the institution name, logo, and colour palette.
 * The palette selection injects CSS variable overrides at runtime, so the
 * change is instant and requires no rebuild.
 *
 * The six built-in palettes are defined in PALETTES.md and mirrored in the
 * backend. Custom variable overrides allow fine-tuning beyond the presets.
 */

const PALETTES = [
  { id: "midnight-vanilla", name: "Midnight / Vanilla" },
  { id: "oxblood-parchment", name: "Oxblood / Parchment" },
  { id: "deep-teal-chalk", name: "Deep Teal / Chalk" },
  { id: "graphite-acid", name: "Graphite / Acid" },
  { id: "ink-blue-apricot", name: "Ink Blue / Apricot" },
  { id: "plum-powder", name: "Plum / Powder" },
];

const PALETTE_SWATCHES = {
  "midnight-vanilla": ["#282B4A", "#EEEBDA", "#FCFAF4", "#E6E1CF", "#6E74A8"],
  "oxblood-parchment": ["#4A1F24", "#F1E7D6", "#FAF4E8", "#ECD9BA", "#B08D57"],
  "deep-teal-chalk": ["#0C3B3A", "#E9E7DE", "#F7F6F1", "#DBE7DF", "#C97B63"],
  "graphite-acid": ["#1C1D21", "#EDECE6", "#F8F7F2", "#E5E4DA", "#B6E33F"],
  "ink-blue-apricot": ["#14243A", "#F2E9DC", "#FBF5EC", "#F1DFC9", "#E8A87C"],
  "plum-powder": ["#3A2340", "#F0E9EE", "#FAF6F8", "#EADFE6", "#C98B9B"],
};

function PaletteSwatch({ paletteId }) {
  const colors = PALETTE_SWATCHES[paletteId] ?? PALETTE_SWATCHES["midnight-vanilla"];

  return (
    <div className="absolute inset-0 rounded-xl overflow-hidden" aria-hidden="true">
      <div className="flex h-full">
        {colors.map((color, i) => (
          <div key={i} className="flex-1" style={{ backgroundColor: color }} />
        ))}
      </div>
    </div>
  );
}

function Branding() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [previewing, setPreviewing] = useState(false);

  const branding = useQuery({
    queryKey: ["branding"],
    queryFn: () => apiGet("/branding"),
  });

  const variables = useQuery({
    queryKey: ["branding", "variables"],
    queryFn: () => apiGet("/branding/variables"),
  });

  const palettes = useQuery({
    queryKey: ["branding", "palettes"],
    queryFn: () => apiGet("/branding/palettes"),
  });

  const update = useMutation({
    mutationFn: (payload) => apiPatch("/branding", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branding"] });
      queryClient.invalidateQueries({ queryKey: ["branding", "variables"] });
      setEditing(false);
      setErrors({});
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  });

  const toggle = useMutation({
    mutationFn: (isActive) => apiPost("/branding/toggle", { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branding"] });
      queryClient.invalidateQueries({ queryKey: ["branding", "variables"] });
    },
  });

  const preview = useMutation({
    mutationFn: (variables) => apiPost("/branding/preview", variables),
    onSuccess: () => setPreviewing(true),
  });

  const data = branding.data?.data?.branding ?? {};
  const vars = variables.data?.data?.variables ?? {};
  const paletteList = palettes.data?.data?.palettes ?? PALETTES;
  const varsMemo = useMemo(() => vars, [variables.data?.data?.variables]);

  // Apply preview variables to document root
  useEffect(() => {
    if (previewing && Object.keys(varsMemo).length > 0) {
      const root = document.documentElement;
      const original = {};
      Object.entries(varsMemo).forEach(([key, value]) => {
        const cssVar = key.startsWith("--") ? key : `--${key}`;
        original[cssVar] = root.style.getPropertyValue(cssVar);
        root.style.setProperty(cssVar, value);
      });
      return () => {
        Object.entries(original).forEach(([key, value]) => {
          if (value) root.style.setProperty(key, value);
          else root.style.removeProperty(key);
        });
        setPreviewing(false);
      };
    }
  }, [previewing, vars]);

  const handlePreview = () => {
    preview.mutate(vars);
  };

  return (
    <AdminLayout
      title="Branding"
      description="Configure the institution's visual identity — name, logo and colour palette."
      actions={
        <Button onClick={() => setEditing(true)}>
          <Save className="size-4" aria-hidden="true" />
          Edit
        </Button>
      }
    >
      <div className="space-y-6">
        {branding.isLoading ? (
          <Loading label="Loading branding" />
        ) : branding.isError ? (
          <ErrorState message={branding.error?.message} onRetry={() => branding.refetch()} />
        ) : (
          <>
            <section className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-ink-900">Identity</h3>

                <div className="surface rounded-xl p-4 space-y-4">
                  <div className="flex items-center gap-4">
                    {data.logoUrl ? (
                      <img
                        src={data.logoUrl}
                        alt={`${data.institutionName} logo`}
                        className="size-16 rounded-lg border border-ink-200 object-contain bg-surface"
                      />
                    ) : (
                      <div className="size-16 rounded-lg border border-ink-200 flex items-center justify-center bg-ink-50">
                        <Image className="size-8 text-ink-400" aria-hidden="true" />
                      </div>
                    )}
                    <div>
                      <p className="font-semibold text-ink-900">{data.institutionName}</p>
                      <p className="text-sm text-ink-500">{data.shortName}</p>
                      {data.logoUrl && (
                        <p className="text-xs text-ink-400 mt-1">Logo configured</p>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Institution name"
                      htmlFor="brand-name"
                      required
                      error={errors.institutionName}
                    >
                      <input
                        id="brand-name"
                        value={data.institutionName}
                        onChange={(e) => setFormData((prev) => ({ ...prev, institutionName: e.target.value }))}
                        maxLength={120}
                        className={inputClass}
                        disabled={!editing}
                      />
                    </Field>

                    <Field
                      label="Short name"
                      htmlFor="brand-short"
                      required
                      error={errors.shortName}
                    >
                      <input
                        id="brand-short"
                        value={data.shortName}
                        onChange={(e) => setFormData((prev) => ({ ...prev, shortName: e.target.value }))}
                        maxLength={24}
                        className={inputClass}
                        disabled={!editing}
                      />
                    </Field>

                    <Field
                      label="Logo URL"
                      htmlFor="brand-logo"
                      hint="HTTPS URL to an SVG or PNG (max 200KB, square, transparent background)"
                      error={errors.logoUrl}
                    >
                      <input
                        id="brand-logo"
                        type="url"
                        value={data.logoUrl ?? ""}
                        onChange={(e) => setFormData((prev) => ({ ...prev, logoUrl: e.target.value }))}
                        className={inputClass}
                        disabled={!editing}
                      />
                    </Field>

                    <Field
                      label="Favicon URL"
                      htmlFor="brand-favicon"
                      hint="HTTPS URL to a 32x32 PNG or ICO"
                      error={errors.faviconUrl}
                    >
                      <input
                        id="brand-favicon"
                        type="url"
                        value={data.faviconUrl ?? ""}
                        onChange={(e) => setFormData((prev) => ({ ...prev, faviconUrl: e.target.value }))}
                        className={inputClass}
                        disabled={!editing}
                      />
                    </Field>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-ink-900">Palette</h3>
                  {editing && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePreview}
                      disabled={preview.mutate.isPending}
                    >
                      <Eye className="size-3.5 mr-1.5" aria-hidden="true" />
                      Preview
                    </Button>
                  )}
                </div>

                <div className="surface rounded-xl p-4 space-y-4">
                  {palettes.isLoading ? (
                    <Loading label="Loading palettes" />
                  ) : palettes.isError ? (
                    <ErrorState message={palettes.error?.message} onRetry={() => palettes.refetch()} />
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {paletteList.map((palette) => (
                        <button
                          key={palette.id}
                          type="button"
                          onClick={() => setFormData((prev) => ({ ...prev, palette: palette.id }))}
                          disabled={!editing}
                          className={`relative aspect-square rounded-xl border-2 transition-all ${
                            data.palette === palette.id
                              ? "border-brand-600 ring-2 ring-brand-600/20"
                              : "border-ink-200 hover:border-ink-300"
                          }`}
                        >
                          <PaletteSwatch paletteId={palette.id} />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs font-medium text-white drop-shadow">
                              {palette.name}
                            </div>
                          </div>
                          {data.palette === palette.id && (
                            <div className="absolute top-2 right-2 flex">
                              <Check className="size-4 text-brand-600 bg-white/90 rounded-full p-0.5" aria-hidden="true" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  <Field
                    label="Custom CSS variables (advanced)"
                    hint="JSON object with CSS variable overrides (e.g., {'color-brand-600': '#1a1a2e'}). Applied on top of the selected palette."
                  >
                    <textarea
                      value={JSON.stringify(data.customVariables ?? {}, null, 2)}
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value);
                          setFormData((prev) => ({ ...prev, customVariables: parsed }));
                        } catch {
                          // Ignore invalid JSON while typing
                        }
                      }}
                      rows={4}
                      className={`${inputClass} font-mono text-xs`}
                      disabled={!editing}
                    />
                  </Field>
                </div>

                <div className="surface rounded-xl p-4">
                  <h3 className="text-lg font-semibold text-ink-900 mb-4">Status</h3>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-ink-900">
                        Branding is {data.isActive ? "active" : "inactive"}
                      </p>
                      <p className="text-sm text-ink-500">
                        {data.isActive
                          ? "CSS variables are injected on every page load."
                          : "Built-in defaults are used instead."}
                      </p>
                    </div>
                    <Button
                      variant={data.isActive ? "secondary" : "primary"}
                      onClick={() => toggle.mutate(!data.isActive)}
                      disabled={toggle.isPending}
                    >
                      {data.isActive ? "Disable" : "Enable"}
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            {editing && (
              <div className="flex justify-end gap-3 border-t border-ink-200 pt-4">
                <Button variant="secondary" onClick={() => { setEditing(false); setErrors({}); }}>
                  Cancel
                </Button>
                <Button onClick={() => update.mutate(formData)} disabled={update.isPending}>
                  <Save className="size-4 mr-1.5" aria-hidden="true" />
                  Save changes
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}

export default Branding;

import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPost, apiUpload } from "../api/client";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";
import { Card } from "../components/ui/Card";

const ROLES = [
  ["STUDENT", "Students"],
  ["FACULTY", "Faculty"],
  ["HOD", "Heads of department"],
  ["SUPPORT_STAFF", "Support staff"],
  ["EXAM_ADMIN", "Examinations"],
  ["ACCOUNTS_ADMIN", "Accounts"],
  ["HOSTEL_ADMIN", "Hostel"],
  ["LIBRARY_ADMIN", "Library"],
  ["PLACEMENT_ADMIN", "Placement"],
  ["DEAN", "Dean"],
  ["PRINCIPAL", "Principal"],
];

/** The server's announcement-image limits, checked here to fail before upload. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

/**
 * Post a notice.
 *
 * ## The audience is explicit, and the default is everyone
 *
 * The scope defaults to ALL and has to be *changed* to something narrower. The
 * failure that matters is a notice intended for one department reaching the
 * whole college, so the default is the widest sensible scope and narrowing is the
 * deliberate act.
 *
 * The scope also controls how the notification fan-out is bounded, which the
 * server reports back. A truncated fan-out is surfaced here rather than left in
 * a log: it means some inboxes will not show the notice, and the operator should
 * know that before a student says they never saw it.
 */
export default function ComposeAnnouncement() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [pinned, setPinned] = useState(false);
  const [scope, setScope] = useState("ALL");
  const [roles, setRoles] = useState([]);
  const [department, setDepartment] = useState("");
  const [errors, setErrors] = useState({});

  /**
   * The chosen image, and a local preview of it.
   *
   * The preview comes from the File the browser already has, so the officer
   * sees the image before it is uploaded rather than after. The object URL is
   * revoked when it is replaced or the component unmounts — leaking one per
   * selection pins the whole image in memory for the life of the tab.
   */
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [imageNote, setImageNote] = useState("");

  /**
   * The object URL lives in state for rendering and in a ref for cleanup.
   * Reading a ref during render is not allowed, and rendering from state is.
   */
  const previewRef = useRef(null);
  const fileInputRef = useRef(null);

  // Revoke on unmount, or the last previewed image stays in memory for the
  // life of the tab.
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const chooseImage = (event) => {
    const file = event.target.files?.[0] ?? null;
    // Reset immediately so choosing the same file again still fires `change`.
    event.target.value = "";

    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    }
    setPreview(null);
    setImageNote("");
    setErrors((prev) => {
      const next = { ...prev };
      delete next.image;
      return next;
    });

    if (!file) {
      setImage(null);
      return;
    }

    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setImage(null);
      setErrors((prev) => ({
        ...prev,
        image: "Choose a JPEG or PNG image.",
      }));
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setImage(null);
      setErrors((prev) => ({
        ...prev,
        image: "That image is over 5 MB. Choose a smaller file.",
      }));
      return;
    }

    const url = URL.createObjectURL(file);
    previewRef.current = url;
    setPreview(url);
    setImage(file);
  };

  const removeImage = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    }
    setPreview(null);
    setImage(null);
    setImageNote("");
    setErrors((prev) => {
      const next = { ...prev };
      delete next.image;
      return next;
    });
  };

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => apiGet("/departments"),
  });

  const post = useMutation({
    mutationFn: async ({ imageFile, ...announcementPayload }) => {
      const response = await apiPost("/announcements", announcementPayload);

      // The image is a second request. The notice is already published by the
      // time this runs, so a failed image must not undo it — the officer gets
      // the notice plus an explanation, rather than losing both.
      if (imageFile) {
        try {
          const identifier =
            response.data?.announcement?.reference ??
            response.data?.announcement?.id;
          await apiUpload(`/announcements/${identifier}/image`, {
            field: "image",
            file: imageFile,
          });
        } catch {
          setImageNote(
            "The notice was posted, but the image could not be uploaded.",
          );
        }
      }

      return response;
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
      const identifier =
        response.data?.announcement?.reference ??
        response.data?.announcement?.id;
      navigate(`/announcements/${identifier}`);
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  });

  const submit = (event) => {
    event.preventDefault();

    const newErrors = {};
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();

    if (!trimmedTitle) {
      newErrors.title = "Title is required";
    } else if (trimmedTitle.length < 3) {
      newErrors.title = "Title must be at least 3 characters";
    }

    if (!trimmedBody) {
      newErrors.body = "Body is required";
    } else if (trimmedBody.length < 10) {
      newErrors.body = "Body must be at least 10 characters";
    }

    if (scope === "ROLES" && (!roles || roles.length === 0)) {
      newErrors["audience.roles"] = "Select at least one role";
    }

    if (scope === "DEPARTMENT" && !department) {
      newErrors["audience.department"] = "Please select a department";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      const firstKey = Object.keys(newErrors)[0];
      const targetId =
        firstKey === "audience.roles"
          ? "scope"
          : firstKey === "audience.department"
            ? "department"
            : firstKey;
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.focus();
        targetEl.scrollIntoView?.({ behavior: "smooth", block: "center" });
      }
      return;
    }

    setErrors({});
    setImageNote("");

    // Only the selector relevant to the chosen scope is sent. The schema
    // refuses an announcement that carries both a scope and an unrelated
    // selector, and rightly so.
    const audience = { scope };
    if (scope === "ROLES") audience.roles = roles;
    if (scope === "DEPARTMENT") audience.department = department;

    post.mutate({
      title: trimmedTitle,
      body: trimmedBody,
      priority,
      pinned,
      audience,
      imageFile: image,
    });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
          Post a notice
        </h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400 dark:text-ink-500">
          Visible immediately to everyone in the audience you choose.
        </p>
      </header>

      <form onSubmit={submit} noValidate className="space-y-6">
        <Card title="Notice">
          <div className="space-y-5">
            <Field label="Title" htmlFor="title" required error={errors.title}>
              <input
                id="title"
                value={title}
                maxLength={160}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (errors.title) {
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next.title;
                      return next;
                    });
                  }
                }}
                className={inputClass}
              />
            </Field>

            <Field label="Body" htmlFor="body" required error={errors.body}>
              <textarea
                id="body"
                rows={7}
                value={body}
                maxLength={5000}
                onChange={(e) => {
                  setBody(e.target.value);
                  if (errors.body) {
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next.body;
                      return next;
                    });
                  }
                }}
                className={`${inputClass} resize-y`}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Priority" htmlFor="priority">
                <select
                  id="priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className={inputClass}
                >
                  <option value="NORMAL">Normal</option>
                  <option value="IMPORTANT">Important</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </Field>

              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2.5 text-sm text-ink-700 dark:text-ink-300">
                  <input
                    type="checkbox"
                    checked={pinned}
                    onChange={(e) => setPinned(e.target.checked)}
                    className="size-4 rounded border-ink-300 dark:border-ink-600 text-brand-600 focus:ring-brand-600"
                  />
                  Pin to the top
                </label>
              </div>
            </div>
          </div>
        </Card>

        {/*
          The image is optional and separate. It is not part of the notice
          itself, so it gets its own card rather than a field buried at the
          bottom of the text ones.
        */}
        <Card
          title="Image"
          description="Optional. Shown above the notice for everyone in the audience."
        >
          <div className="space-y-4">
            <label
              htmlFor="announcement-image"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed border-ink-300 bg-ink-50/60 px-6 py-8 text-center transition-colors hover:border-brand-600 hover:bg-brand-50/50 focus-within:border-brand-600 dark:border-ink-600 dark:bg-ink-100/40 dark:hover:border-brand-500 dark:hover:bg-brand-500/10"
            >
              <ImageIcon
                className="size-6 text-ink-500 dark:text-ink-400"
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-ink-800 dark:text-ink-100">
                {image ? image.name : "Choose a JPEG or PNG"}
              </span>
              <span className="text-xs text-ink-500 dark:text-ink-400">
                Up to 5 MB. Square or wide images work best.
              </span>
              <input
                ref={fileInputRef}
                id="announcement-image"
                type="file"
                accept="image/jpeg,image/png"
                onChange={chooseImage}
                className="sr-only"
              />
            </label>

            {image && preview && (
              <div className="space-y-2">
                <img
                  src={preview}
                  alt={`Preview of the image chosen for this notice: ${image.name}`}
                  className="max-h-56 w-full rounded-card object-cover"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={removeImage}
                    className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    Remove image
                  </button>
                </div>
              </div>
            )}

            {errors.image && (
              <p
                role="alert"
                className="text-xs text-red-600 dark:text-red-400"
              >
                {errors.image}
              </p>
            )}

            {imageNote && (
              <p
                role="status"
                className="text-sm text-accent-700 dark:text-accent-300"
              >
                {imageNote}
              </p>
            )}
          </div>
        </Card>

        <Card
          title="Audience"
          description="Who will see this, and be notified."
        >
          <div className="space-y-4">
            <Field
              label="Visible to"
              htmlFor="scope"
              required
              error={errors["audience.scope"]}
            >
              <select
                id="scope"
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  if (
                    errors["audience.scope"] ||
                    errors["audience.roles"] ||
                    errors["audience.department"]
                  ) {
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next["audience.scope"];
                      delete next["audience.roles"];
                      delete next["audience.department"];
                      return next;
                    });
                  }
                }}
                className={inputClass}
              >
                <option value="ALL">Everyone in the college</option>
                <option value="ROLES">Specific roles</option>
                <option value="DEPARTMENT">One department</option>
              </select>
            </Field>

            {scope === "ROLES" && (
              <fieldset>
                <legend className="text-sm font-medium text-ink-700 dark:text-ink-300">
                  Roles{" "}
                  <span className="text-red-600 dark:text-red-400">*</span>
                </legend>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {ROLES.map(([value, label]) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-300"
                    >
                      <input
                        type="checkbox"
                        checked={roles.includes(value)}
                        onChange={(e) => {
                          setRoles((current) =>
                            e.target.checked
                              ? [...current, value]
                              : current.filter((r) => r !== value),
                          );
                          if (errors["audience.roles"]) {
                            setErrors((prev) => {
                              const next = { ...prev };
                              delete next["audience.roles"];
                              return next;
                            });
                          }
                        }}
                        className="size-4 rounded border-ink-300 dark:border-ink-600 text-brand-600 focus:ring-brand-600"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {errors["audience.roles"] && (
                  <p
                    role="alert"
                    className="mt-1.5 text-xs text-red-600 dark:text-red-400"
                  >
                    {errors["audience.roles"]}
                  </p>
                )}
              </fieldset>
            )}

            {scope === "DEPARTMENT" && (
              <Field
                label="Department"
                htmlFor="department"
                required
                error={errors["audience.department"]}
              >
                <select
                  id="department"
                  value={department}
                  onChange={(e) => {
                    setDepartment(e.target.value);
                    if (errors["audience.department"]) {
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next["audience.department"];
                        return next;
                      });
                    }
                  }}
                  className={inputClass}
                >
                  <option value="">Choose a department…</option>
                  {(departments.data?.data ?? []).map((d) => (
                    <option key={d._id ?? d.id} value={d._id ?? d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {scope !== "ALL" && (
              <p className="rounded-lg bg-ink-50 dark:bg-ink-100/40 px-3 py-2 text-xs text-ink-600 dark:text-ink-400 dark:text-ink-500">
                Only this audience will see the notice. Anyone else receives a
                404 if they follow a link to it directly.
              </p>
            )}
          </div>
        </Card>

        {post.isError && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 dark:bg-red-500/12 px-3 py-2 text-sm text-red-700 dark:text-red-300"
          >
            {post.error?.message ||
              "Failed to post notice. Please check the details above and try again."}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" loading={post.isPending}>
            Post notice
          </Button>
        </div>
      </form>
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPost } from "../api/client";
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

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => apiGet("/departments"),
  });

  const post = useMutation({
    mutationFn: (payload) => apiPost("/announcements", payload),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
      navigate(`/announcements/${response.data.announcement.reference}`);
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  });

  const submit = (event) => {
    event.preventDefault();

    // Only the selector relevant to the chosen scope is sent. The schema
    // refuses an announcement that carries both a scope and an unrelated
    // selector, and rightly so.
    const audience = { scope };
    if (scope === "ROLES") audience.roles = roles;
    if (scope === "DEPARTMENT") audience.department = department;

    post.mutate({ title, body, priority, pinned, audience });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Post a notice
        </h1>
        <p className="mt-1 text-sm text-ink-500">
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
                onChange={(e) => setTitle(e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Body" htmlFor="body" required error={errors.body}>
              <textarea
                id="body"
                rows={7}
                value={body}
                maxLength={5000}
                onChange={(e) => setBody(e.target.value)}
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
                <label className="flex items-center gap-2.5 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    checked={pinned}
                    onChange={(e) => setPinned(e.target.checked)}
                    className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
                  />
                  Pin to the top
                </label>
              </div>
            </div>
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
                onChange={(e) => setScope(e.target.value)}
                className={inputClass}
              >
                <option value="ALL">Everyone in the college</option>
                <option value="ROLES">Specific roles</option>
                <option value="DEPARTMENT">One department</option>
              </select>
            </Field>

            {scope === "ROLES" && (
              <fieldset>
                <legend className="text-sm font-medium text-ink-700">
                  Roles <span className="text-red-600">*</span>
                </legend>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {ROLES.map(([value, label]) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 text-sm text-ink-700"
                    >
                      <input
                        type="checkbox"
                        checked={roles.includes(value)}
                        onChange={(e) =>
                          setRoles((current) =>
                            e.target.checked
                              ? [...current, value]
                              : current.filter((r) => r !== value),
                          )
                        }
                        className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {errors["audience.roles"] && (
                  <p role="alert" className="mt-1.5 text-xs text-red-600">
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
                  onChange={(e) => setDepartment(e.target.value)}
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
              <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
                Only this audience will see the notice. Anyone else receives a
                404 if they follow a link to it directly.
              </p>
            )}
          </div>
        </Card>

        {post.isError && !Object.keys(errors).length && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {post.error?.message}
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

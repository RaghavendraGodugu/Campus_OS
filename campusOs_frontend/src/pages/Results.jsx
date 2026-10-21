import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  FileCheck2,
  GraduationCap,
  Plus,
  Send,
  TriangleAlert,
} from "lucide-react";

import { apiGet, apiPost } from "../api/client";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";
import Modal from "../components/ui/Modal";
import { EmptyState, ErrorState, Loading } from "../components/ui/States";

/**
 * Results.
 *
 * A student sees only what their programme's results office has released. A
 * teacher sees the marks sheet for subjects they teach: components, per-student
 * marks, the derived total and grade, and the release control for the
 * programme.
 *
 * Nothing here computes a percentage. The server returns `percentage`, `grade`
 * and `status`; this page formats and colours them. That is what keeps a
 * corrected mark from leaving a stale result on screen.
 */

const GRADE_TONE = {
  O: "emerald",
  "A+": "emerald",
  A: "emerald",
  "B+": "brand",
  B: "brand",
  C: "amber",
  F: "red",
};

const TONE_TEXT = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  brand: "text-brand-700 dark:text-brand-300",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-300",
};

const ASSESSMENT_KINDS = [
  "INTERNAL",
  "EXTERNAL",
  "PRACTICAL",
  "PROJECT",
  "VIVA",
];

const KIND_LABEL = {
  INTERNAL: "Internal",
  EXTERNAL: "End semester",
  PRACTICAL: "Practical",
  PROJECT: "Project",
  VIVA: "Viva",
};

export default function Results() {
  const { user, can, canAny } = useAuth();
  const isStudent = user?.role === "STUDENT";
  const canEnter = canAny(
    "result:enter:own",
    "result:manage:department",
    "result:manage:institution",
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Results
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-500 dark:text-ink-400">
          {isStudent
            ? "Results appear here once your programme's results office releases them. Marks are never shown before release."
            : "Enter component marks, check the derived grades, then release the programme's results."}
        </p>
      </header>

      {isStudent && <StudentResults />}
      {!isStudent && canEnter && (
        <MarksWorkspace
          canPublish={
            can("result:publish:department") ||
            can("result:publish:institution")
          }
        />
      )}
      {!isStudent && !canEnter && (
        <EmptyState
          icon={GraduationCap}
          title="No results workspace for this role"
          description="Results are entered by faculty and released by the examination office or a head of department."
        />
      )}
    </div>
  );
}

// ===== Student =====

function StudentResults() {
  const query = useQuery({
    queryKey: ["results", "me"],
    queryFn: () => apiGet("/results/me"),
  });

  const data = query.data?.data;

  if (query.isPending) return <Loading label="Loading your results" />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error?.message ?? "Your results could not be loaded."}
        onRetry={() => query.refetch()}
      />
    );
  }

  if (!data?.term) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No term is open"
        description="Results are published against a term."
      />
    );
  }

  if (!data.published) {
    return (
      <EmptyState
        icon={FileCheck2}
        title="Results not released yet"
        description={`${data.term.name} results have not been released for your programme. They will appear here once the examination office publishes them.`}
      />
    );
  }

  if (!data.results.length) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No results in this term"
        description="No subjects with assessment components were found for your semester."
      />
    );
  }

  const tone = TONE_TEXT[GRADE_TONE[data.overall?.grade] ?? "brand"];

  return (
    <div className="space-y-6">
      <section className="surface p-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
              {data.term.name} · released{" "}
              {new Date(data.release.publishedAt).toLocaleDateString()}
            </p>
            <p className={`mt-2 text-5xl font-semibold tracking-tight ${tone}`}>
              {data.overall?.percentage ?? "—"}
              <span className="text-2xl">%</span>
            </p>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              {data.overall
                ? `${data.overall.obtained} of ${data.overall.maxMarks} marks`
                : "No marks recorded"}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="rounded-full bg-brand-50 dark:bg-brand-500/15 px-3 py-1.5 text-sm font-semibold text-brand-700 dark:text-brand-300 ring-1 ring-brand-200/70 dark:ring-brand-400/25 ring-inset">
              Grade {data.overall?.grade ?? "—"}
            </span>
            {data.arrears.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 ring-1 ring-red-200/70 dark:bg-red-500/12 dark:text-red-300 dark:ring-red-400/25">
                <TriangleAlert className="size-4" aria-hidden="true" />
                {data.arrears.length} arrears
              </span>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.results.map((result) => {
          const gradeTone = TONE_TEXT[GRADE_TONE[result.grade] ?? "brand"];
          return (
            <section key={result.subject.id} className="surface p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-ink-900">
                    {result.subject.code} · {result.subject.name}
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                    {result.obtained} / {result.maxMarks} marks
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-2xl font-semibold ${gradeTone}`}>
                    {result.percentage ?? "—"}%
                  </p>
                  <p className="text-xs font-medium text-ink-500 dark:text-ink-400">
                    Grade {result.grade ?? "—"}
                  </p>
                </div>
              </div>

              <ul className="mt-4 space-y-1.5 border-t border-ink-100 dark:border-ink-700/50 pt-3">
                {result.components.map((component) => (
                  <li
                    key={component.assessmentId}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="text-ink-600 dark:text-ink-300">
                      {component.name}{" "}
                      <span className="text-ink-400">
                        ({KIND_LABEL[component.kind] ?? component.kind})
                      </span>
                    </span>
                    <span className="tabular-nums text-ink-800 dark:text-ink-200">
                      {component.marksObtained ?? "—"} / {component.maxMarks}
                    </span>
                  </li>
                ))}
              </ul>

              {result.status === "FAIL" && (
                <p className="mt-3 text-xs font-medium text-red-600 dark:text-red-300">
                  Below the pass mark. This subject counts as an arrear.
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ===== Staff =====

function MarksWorkspace({ canPublish }) {
  const { user, can } = useAuth();
  const [subjectId, setSubjectId] = useState("");
  const [adding, setAdding] = useState(false);
  const [marking, setMarking] = useState(null);
  const [publishing, setPublishing] = useState(false);

  const subjectsQuery = useQuery({
    queryKey: ["subjects", "active"],
    queryFn: () => apiGet("/subjects?active=true"),
  });
  const timetableQuery = useQuery({
    queryKey: ["timetable"],
    queryFn: () => apiGet("/timetable"),
  });

  const options = useMemo(() => {
    if (can("result:manage:institution")) {
      return subjectsQuery.data?.data?.subjects ?? [];
    }

    if (can("result:manage:department")) {
      const all = subjectsQuery.data?.data?.subjects ?? [];
      return all.filter(
        (subject) =>
          String(subject.department?.id ?? subject.department) ===
          String(user?.department),
      );
    }

    const entries = timetableQuery.data?.data?.entries ?? [];
    const seen = new Map();
    for (const entry of entries) {
      if (entry.subject) seen.set(entry.subject.id, entry.subject);
    }
    return [...seen.values()];
  }, [can, subjectsQuery.data, timetableQuery.data, user?.department]);

  const selected = subjectId || options[0]?.id || "";

  const grid = useQuery({
    queryKey: ["results", "subject", selected],
    queryFn: () => apiGet(`/results/subjects/${selected}`),
    enabled: Boolean(selected),
  });

  const data = grid.data?.data;

  if (subjectsQuery.isPending && timetableQuery.isPending) {
    return <Loading label="Loading subjects" />;
  }

  if (!options.length) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No subjects to grade"
        description="You need a scheduled subject before marks can be entered."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="w-full max-w-sm">
          <label
            htmlFor="result-subject"
            className="block text-[0.8125rem] font-medium text-ink-700"
          >
            Subject
          </label>
          <select
            id="result-subject"
            className={`${inputClass} mt-1.5`}
            value={selected}
            onChange={(event) => setSubjectId(event.target.value)}
          >
            {options.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.code} · {subject.name} (sem {subject.semester})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add component
          </Button>
          {canPublish && data?.term && (
            <Button onClick={() => setPublishing(true)}>
              <Send className="size-4" aria-hidden="true" />
              Release results
            </Button>
          )}
        </div>
      </div>

      {grid.isPending && <Loading label="Loading the marks sheet" />}
      {grid.isError && (
        <ErrorState
          message={
            grid.error?.message ?? "The marks sheet could not be loaded."
          }
          onRetry={() => grid.refetch()}
        />
      )}

      {data && !data.term && (
        <EmptyState
          icon={GraduationCap}
          title="No term is open"
          description="Marks belong to a term."
        />
      )}

      {data?.term && (
        <>
          {data.assessments.length === 0 ? (
            <EmptyState
              icon={Award}
              title="No components yet"
              description="Add the internal, practical or end-semester components for this subject before entering marks."
              action={
                <Button onClick={() => setAdding(true)}>
                  <Plus className="size-4" aria-hidden="true" />
                  Add component
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.assessments.map((assessment) => (
                <div key={assessment.id} className="surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">
                        {assessment.name}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                        {KIND_LABEL[assessment.kind] ?? assessment.kind} · max{" "}
                        {assessment.maxMarks}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setMarking(assessment)}
                    >
                      Enter marks
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="surface overflow-hidden">
            <div className="border-b border-ink-200/60 dark:border-ink-700/50 px-5 py-4">
              <h2 className="text-[0.9375rem] font-semibold text-ink-900">
                Derived results
              </h2>
              <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                {data.term.name}. Percentages and grades are computed from the
                component marks; nothing is stored.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-ink-200/70 dark:border-ink-700/60 text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400">
                  <tr>
                    <th className="px-5 py-3 font-medium">Roll</th>
                    <th className="px-5 py-3 font-medium">Student</th>
                    <th className="px-5 py-3 font-medium">Marks</th>
                    <th className="px-5 py-3 font-medium">%</th>
                    <th className="px-5 py-3 font-medium">Grade</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100/90 dark:divide-ink-700/50">
                  {data.students.map((student) => (
                    <tr key={student.studentId}>
                      <td className="px-5 py-3 font-mono text-xs text-ink-600 dark:text-ink-300">
                        {student.rollNumber}
                      </td>
                      <td className="px-5 py-3 font-medium text-ink-900">
                        {student.name}
                      </td>
                      <td className="px-5 py-3 tabular-nums text-ink-600 dark:text-ink-300">
                        {student.obtained} / {student.maxMarks}
                      </td>
                      <td className="px-5 py-3 tabular-nums">
                        {student.percentage ?? "—"}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`font-semibold ${TONE_TEXT[GRADE_TONE[student.grade] ?? "brand"]}`}
                        >
                          {student.grade ?? "—"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            student.status === "FAIL"
                              ? "bg-red-50 text-red-700 ring-1 ring-red-200/70 dark:bg-red-500/12 dark:text-red-300 dark:ring-red-400/25"
                              : student.status === "PASS"
                                ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200/70 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-400/25"
                                : "bg-ink-100 text-ink-600 dark:bg-ink-200/40 dark:text-ink-300"
                          }`}
                        >
                          {student.complete ? student.status : "Marks missing"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <AddComponentDialog
        open={adding}
        onClose={() => setAdding(false)}
        subjectId={selected}
        termId={data?.term?.id}
      />

      {marking && data?.term && (
        <MarksDialog
          assessment={marking}
          students={data.students}
          onClose={() => setMarking(null)}
          subjectId={selected}
        />
      )}

      {publishing && data && (
        <PublishDialog
          subject={data.subject}
          term={data.term}
          onClose={() => setPublishing(false)}
        />
      )}
    </div>
  );
}

function AddComponentDialog({ open, onClose, subjectId, termId }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    kind: "INTERNAL",
    maxMarks: "20",
  });
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () =>
      apiPost("/results/assessments", {
        term: termId,
        subject: subjectId,
        name: form.name.trim(),
        kind: form.kind,
        maxMarks: Number(form.maxMarks),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["results"] });
      setForm({ name: "", kind: "INTERNAL", maxMarks: "20" });
      setError("");
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });

  const invalid = !form.name.trim() || Number(form.maxMarks) < 1 || !termId;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add an assessment component"
      description="The maximum marks are the denominator for the subject's result."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={invalid}
            onClick={() => create.mutate()}
          >
            Add component
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalid) create.mutate();
        }}
        className="space-y-4"
      >
        <Field
          label="Name"
          htmlFor="component-name"
          required
          hint="e.g. Internal 1"
        >
          <input
            id="component-name"
            className={inputClass}
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            maxLength={80}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kind" htmlFor="component-kind">
            <select
              id="component-kind"
              className={inputClass}
              value={form.kind}
              onChange={(event) =>
                setForm((current) => ({ ...current, kind: event.target.value }))
              }
            >
              {ASSESSMENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABEL[kind]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Maximum marks" htmlFor="component-max" required>
            <input
              id="component-max"
              type="number"
              min="1"
              max="500"
              className={inputClass}
              value={form.maxMarks}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  maxMarks: event.target.value,
                }))
              }
            />
          </Field>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-300">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function MarksDialog({ assessment, students, subjectId, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      students.map((student) => {
        const component = student.components.find(
          (item) => item.assessmentId === assessment.id,
        );
        return [
          student.studentId,
          component?.marksObtained === null ||
          component?.marksObtained === undefined
            ? ""
            : String(component.marksObtained),
        ];
      }),
    ),
  );
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () =>
      apiPost("/results/marks", {
        assessment: assessment.id,
        marks: students.map((student) => ({
          student: student.studentId,
          marksObtained: Number(values[student.studentId]),
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["results", "subject", subjectId],
      });
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });

  const invalid = students.some((student) => {
    const raw = values[student.studentId];
    if (raw === "" || raw === undefined) return true;
    const number = Number(raw);
    return Number.isNaN(number) || number < 0 || number > assessment.maxMarks;
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Marks · ${assessment.name}`}
      description={`Maximum ${assessment.maxMarks}. Saving updates the derived result immediately.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={invalid}
            onClick={() => save.mutate()}
          >
            Save marks
          </Button>
        </>
      }
    >
      <div className="max-h-96 overflow-y-auto rounded-xl ring-1 ring-ink-200/70 dark:ring-ink-700/60">
        <ul className="divide-y divide-ink-100/90 dark:divide-ink-700/50">
          {students.map((student) => (
            <li
              key={student.studentId}
              className="flex items-center justify-between gap-4 px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink-900">
                  {student.name}
                </p>
                <p className="font-mono text-[0.6875rem] text-ink-500">
                  {student.rollNumber}
                </p>
              </div>
              <input
                type="number"
                min="0"
                max={assessment.maxMarks}
                aria-label={`Marks for ${student.name}`}
                className={`${inputClass} w-24 text-right`}
                value={values[student.studentId] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [student.studentId]: event.target.value,
                  }))
                }
              />
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
    </Modal>
  );
}

function PublishDialog({ subject, term, onClose }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  const publish = useMutation({
    mutationFn: () =>
      apiPost("/results/publish", {
        term: term.id,
        program: subject.program.id,
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["results"] });
      setDone(response.data);
    },
    onError: (failure) => setError(failure.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Release results"
      description={`${subject.program.code} · ${term.name}`}
      footer={
        done ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={publish.isPending}
              onClick={() => publish.mutate()}
            >
              Release to students
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p className="text-sm text-ink-700 dark:text-ink-300">
          Results for {done.release.program.code} are released. Students in this
          programme can now see their grades.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-700 dark:text-ink-300">
            This makes every result for <strong>{subject.program.code}</strong>{" "}
            in <strong>{term.name}</strong> visible to students. It cannot be
            undone from this screen.
          </p>
          <p className="text-xs text-ink-500 dark:text-ink-400">
            Every component of every subject must have a mark for every student.
            The release is refused if anything is missing.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
    </Modal>
  );
}

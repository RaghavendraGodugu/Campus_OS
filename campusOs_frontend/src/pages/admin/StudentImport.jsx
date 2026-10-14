import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  ListChecks,
  RotateCcw,
  ShieldAlert,
  Upload,
  Users,
} from "lucide-react";

import { apiPost } from "../../api/client";
import Button from "../../components/ui/Button";
import Modal from "../../components/ui/Modal";

/**
 * Bulk student import.
 *
 * ## Two steps, on purpose
 *
 * Check, then import. Nothing is written until the whole file has been read and
 * judged, so the registrar sees every problem — with line numbers — before
 * anything exists. An import of two hundred students should not be the moment
 * somebody discovers row 147 has a typo in it.
 *
 * ## The passwords come back once
 *
 * Two hundred passwords cannot be read off a screen, so they come back as a
 * downloadable file. That file is the only place they exist in clear: the
 * accounts store bcrypt hashes, the audit trail records none of it, and nobody
 * can reproduce the list afterwards. The button says so before the import runs,
 * not after.
 *
 * ## Import is never partly applied
 *
 * If any row is wrong the whole thing is refused. Half a cohort imported leaves
 * some students able to sign in and some not, and afterwards nobody can tell
 * which is which.
 */

const COLUMNS = [
  "rollNumber",
  "fullName",
  "email",
  "programCode",
  "departmentCode",
  "semester",
  "year",
  "section",
  "batchYear",
  "enrolmentDate",
];

const SAMPLE = [
  COLUMNS.join(","),
  [
    "26CS001",
    "Ananya Sharma",
    "ananya@campusos.local",
    "BTCS",
    "CSE",
    "1",
    "1",
    "A",
    "2026",
    "2026-08-01",
  ].join(","),
  [
    "26CS002",
    '"Kumar, Raghav"',
    "raghav@campusos.local",
    "BTCS",
    "CSE",
    "1",
    "1",
    "B",
    "2026",
    "2026-08-01",
  ].join(","),
].join("\n");

/** Offer the browser's save dialog rather than dumping text on the page. */
function download(filename, contents) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function StudentImport() {
  const inputRef = useRef(null);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);

  const check = useMutation({
    mutationFn: (value) =>
      apiPost("/admin/students/import/validate", { csv: value }),
    onSuccess: () => {
      setResult(null);
      setConfirming(false);
    },
    onError: (failure) => {
      setError(failure.message);
      setResult(null);
    },
  });

  const commit = useMutation({
    mutationFn: (value) =>
      apiPost("/admin/students/import/commit", { csv: value }),
    onSuccess: (response) => {
      setResult(response);
      setConfirming(false);
    },
    onError: (failure) => {
      setError(failure.message);
      setConfirming(false);
    },
  });

  const report = check.data?.data;

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setResult(null);
    setFileName(file.name);

    if (file.size > 4 * 1024 * 1024) {
      setError(
        "That file is larger than 4MB. Split it, or import it in batches.",
      );
      setCsv("");
      return;
    }

    try {
      setCsv(await file.text());
    } catch {
      setError("That file could not be read.");
      setCsv("");
    }
  };

  const reset = () => {
    setCsv("");
    setFileName("");
    setError(null);
    setResult(null);
    check.reset();
    if (inputRef.current) inputRef.current.value = "";
  };

  const credentialsCsv = () => {
    const rows = result.meta.credentials.map((entry) =>
      [
        entry.rollNumber,
        entry.fullName,
        entry.email,
        entry.temporaryPassword,
      ].join(","),
    );

    return ["rollNumber,fullName,email,temporaryPassword", ...rows].join("\n");
  };

  if (result) {
    return (
      <div className="surface-raised animate-rise p-6 sm:p-7">
        <span className="grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 ring-inset">
          <CheckCircle2 className="size-6" aria-hidden="true" />
        </span>

        <h2 className="mt-4 text-xl font-semibold tracking-tight text-ink-900">
          {result.data.imported} student{result.data.imported === 1 ? "" : "s"}{" "}
          imported
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
          Each one has an account and a student record, linked. Nobody can sign
          in until they replace the password you are about to hand them.
        </p>

        <div className="mt-6 rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50/70 p-5">
          <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
            Temporary passwords
          </p>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-700">
            {result.meta.notice}
          </p>
          <Button
            className="mt-3"
            onClick={() =>
              download("campusos-student-passwords.csv", credentialsCsv())
            }
          >
            <Download className="size-4" aria-hidden="true" />
            Download the {result.data.imported} password
            {result.data.imported === 1 ? "" : "s"}
          </Button>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={reset}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="surface overflow-hidden">
        <div className="border-b border-ink-200/70 px-4 py-3.5 sm:px-5">
          <h2 className="text-[0.9375rem] font-semibold tracking-tight text-ink-900">
            Choose a file
          </h2>
          <p className="mt-1 text-[0.8125rem] text-ink-500">
            Up to 2,000 students, 4MB. Nothing is written until you check it.
          </p>
        </div>

        <div className="px-4 py-5 sm:px-5">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="sr-only"
            />
            <Button onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" aria-hidden="true" />
              {fileName ? "Choose a different file" : "Choose a CSV file"}
            </Button>

            {fileName && (
              <p className="flex items-center gap-2 text-sm text-ink-600">
                <FileSpreadsheet
                  className="size-4 text-ink-400"
                  aria-hidden="true"
                />
                {fileName}
              </p>
            )}

            <button
              type="button"
              onClick={() => download("campusos-students-template.csv", SAMPLE)}
              className="ml-auto text-sm font-medium text-brand-700 transition-colors hover:text-brand-900"
            >
              Download the template
            </button>
          </div>

          {csv && (
            <div className="mt-5 rounded-2xl bg-ink-50 p-4 ring-1 ring-ink-200 ring-inset">
              <p className="text-xs font-semibold tracking-wide text-ink-600 uppercase">
                Columns expected
              </p>
              <p className="mt-2 font-mono text-xs leading-relaxed break-all text-ink-600">
                {COLUMNS.join(", ")}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-ink-500">
                Extra columns are ignored, so an export from another system is
                fine. A value containing a comma must be wrapped in quotes.
              </p>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-red-200 ring-inset"
            >
              {error}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              disabled={!csv || check.isPending}
              loading={check.isPending}
              onClick={() => check.mutate(csv)}
            >
              <ListChecks className="size-4" aria-hidden="true" />
              Check this file
            </Button>

            {(csv || report) && (
              <Button variant="ghost" onClick={reset}>
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {report && (
        <Report report={report} onConfirm={() => setConfirming(true)} />
      )}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Import ${report?.totals.toCreate ?? 0} students?`}
        description="This creates an account and a student record for every row, and nothing is applied partly."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              loading={commit.isPending}
              onClick={() => commit.mutate(csv)}
            >
              Import {report?.totals.toCreate ?? 0} students
            </Button>
          </>
        }
      >
        <ul className="space-y-2.5 text-sm text-ink-600">
          {[
            "Each student gets a generated password, shown once afterwards.",
            "They cannot use their account until they replace it.",
            "No password is written to the audit trail.",
            "You can hand the file to whoever administers the accounts.",
          ].map((line) => (
            <li key={line} className="flex gap-2.5">
              <CheckCircle2
                className="mt-0.5 size-4 shrink-0 text-emerald-600"
                aria-hidden="true"
              />
              {line}
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

function Report({ report, onConfirm }) {
  if (!report.valid) {
    return (
      <div className="surface overflow-hidden ring-red-200">
        <div className="flex items-start gap-3.5 border-b border-red-200/70 bg-red-50/70 px-4 py-4 sm:px-5">
          <ShieldAlert
            className="mt-0.5 size-5 shrink-0 text-red-600"
            aria-hidden="true"
          />
          <div>
            <h3 className="text-[0.9375rem] font-semibold text-red-900">
              {report.totals.problems} row
              {report.totals.problems === 1 ? "" : "s"} need attention
            </h3>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-red-800">
              {report.message}
            </p>
          </div>
        </div>

        <ul className="divide-y divide-ink-100/90">
          {report.problems.map((problem) => (
            <li key={problem.line} className="px-4 py-3.5 sm:px-5">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
                Line {problem.line}
                {problem.rollNumber && (
                  <span className="font-mono text-xs text-ink-500">
                    {problem.rollNumber}
                  </span>
                )}
              </p>
              <ul className="mt-1.5 space-y-1">
                {problem.issues.map((issue) => (
                  <li
                    key={issue}
                    className="flex gap-2 text-[0.8125rem] text-red-700"
                  >
                    <span aria-hidden="true" className="text-red-300">
                      —
                    </span>
                    {issue}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-200/70 bg-emerald-50/60 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3.5">
          <CheckCircle2
            className="mt-0.5 size-5 shrink-0 text-emerald-600"
            aria-hidden="true"
          />
          <div>
            <h3 className="text-[0.9375rem] font-semibold text-emerald-900">
              {report.totals.toCreate} student
              {report.totals.toCreate === 1 ? "" : "s"} ready
            </h3>
            <p className="mt-1 text-[0.8125rem] text-emerald-800">
              {report.message} Nothing has been written yet.
            </p>
          </div>
        </div>

        <Button onClick={onConfirm}>
          <Users className="size-4" aria-hidden="true" />
          Import them
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            The first {report.preview.length} rows, as they will be imported
          </caption>
          <thead className="border-b border-ink-200/70 bg-ink-50/60 text-xs text-ink-500">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">
                Line
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Roll number
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Name
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Email
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100/90">
            {report.preview.map((row) => (
              <tr key={row.line}>
                <td className="px-4 py-2.5 text-ink-500 tabular-nums sm:px-5">
                  {row.line}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-ink-800">
                  {row.rollNumber}
                </td>
                <td className="px-4 py-2.5 text-ink-800">{row.fullName}</td>
                <td className="px-4 py-2.5 text-ink-600">{row.email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.preview.length < report.totals.rows && (
        <p className="flex items-center gap-2 border-t border-ink-200/70 px-4 py-3 text-xs text-ink-500 sm:px-5">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          Showing the first {report.preview.length} of {report.totals.rows}{" "}
          rows.
        </p>
      )}
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, LibraryBig, Plus, Search, Undo2 } from "lucide-react";

import { apiGet, apiPost } from "../api/client";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";
import Field, { inputClass } from "../components/ui/Field";
import Modal from "../components/ui/Modal";
import { EmptyState, ErrorState, Loading } from "../components/ui/States";

/**
 * Library.
 *
 * Everyone can search the catalogue and see what is on the shelf. A student
 * sees their own loans; library staff issue, return and add titles. Availability
 * is computed by the server (`copiesTotal - copiesIssued`), never re-derived
 * here.
 */
export default function Library() {
  const { user, can } = useAuth();
  const isStudent = user?.role === "STUDENT";
  const canIssue = can("library:issue:institution");
  const canManage = can("library:manage:institution");

  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [adding, setAdding] = useState(false);
  const [issuing, setIssuing] = useState(null);

  const books = useQuery({
    queryKey: ["library", "books", applied],
    queryFn: () =>
      apiGet(
        `/library/books${applied ? `?q=${encodeURIComponent(applied)}` : ""}`,
      ),
  });

  const loans = useQuery({
    queryKey: ["library", "me"],
    queryFn: () => apiGet("/library/me"),
    enabled: isStudent,
  });

  const issues = useQuery({
    queryKey: ["library", "issues"],
    queryFn: () => apiGet("/library/issues?status=ISSUED"),
    enabled: canIssue,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            Library
          </h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            Search the catalogue, see what is available, and track loans.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" /> Add a title
          </Button>
        )}
      </header>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(q.trim());
        }}
      >
        <div className="relative min-w-64 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-400"
            aria-hidden="true"
          />
          <input
            aria-label="Search books"
            className={`${inputClass} pl-10`}
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Title, author or ISBN"
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {applied && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setQ("");
              setApplied("");
            }}
          >
            Clear
          </Button>
        )}
      </form>

      <section className="surface overflow-hidden">
        <div className="border-b border-ink-200/60 dark:border-ink-700/50 px-5 py-4">
          <h2 className="text-[0.9375rem] font-semibold text-ink-900">
            Catalogue
          </h2>
        </div>

        {books.isPending && <Loading label="Loading the catalogue" />}
        {books.isError && (
          <div className="p-5">
            <ErrorState
              message={books.error?.message}
              onRetry={() => books.refetch()}
            />
          </div>
        )}

        {books.isSuccess && (books.data?.data?.books ?? []).length === 0 && (
          <div className="p-5">
            <EmptyState
              icon={BookOpen}
              title="No titles found"
              description={
                applied ? "Try a different search." : "The catalogue is empty."
              }
            />
          </div>
        )}

        {books.isSuccess && (books.data?.data?.books ?? []).length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink-200/70 dark:border-ink-700/60 text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400">
                <tr>
                  <th className="px-5 py-3 font-medium">Title</th>
                  <th className="px-5 py-3 font-medium">Author</th>
                  <th className="px-5 py-3 font-medium">Category</th>
                  <th className="px-5 py-3 font-medium">Available</th>
                  {canIssue && <th className="px-5 py-3 font-medium"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100/90 dark:divide-ink-700/50">
                {(books.data?.data?.books ?? []).map((book) => {
                  const available = book.copiesTotal - book.copiesIssued;
                  return (
                    <tr key={book.id}>
                      <td className="px-5 py-3 font-medium text-ink-900">
                        {book.title}
                      </td>
                      <td className="px-5 py-3 text-ink-600 dark:text-ink-300">
                        {book.author}
                      </td>
                      <td className="px-5 py-3 text-ink-600 dark:text-ink-300">
                        {book.category}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            available > 0
                              ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200/70 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-400/25"
                              : "bg-red-50 text-red-700 ring-1 ring-red-200/70 dark:bg-red-500/12 dark:text-red-300 dark:ring-red-400/25"
                          }`}
                        >
                          {available} of {book.copiesTotal}
                        </span>
                      </td>
                      {canIssue && (
                        <td className="px-5 py-3 text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={available < 1}
                            onClick={() => setIssuing(book)}
                          >
                            Issue
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isStudent && <MyLoans query={loans} />}
      {canIssue && <IssuedList query={issues} />}

      {adding && <AddBookDialog onClose={() => setAdding(false)} />}
      {issuing && (
        <IssueDialog book={issuing} onClose={() => setIssuing(null)} />
      )}
    </div>
  );
}

function MyLoans({ query }) {
  if (query.isPending) return <Loading label="Loading your loans" />;
  if (query.isError)
    return (
      <ErrorState
        message={query.error?.message}
        onRetry={() => query.refetch()}
      />
    );

  const rows = query.data?.data?.issues ?? [];
  if (!rows.length) {
    return (
      <EmptyState
        icon={LibraryBig}
        title="No books borrowed"
        description="Titles you borrow appear here with their due dates."
      />
    );
  }

  return (
    <section className="surface overflow-hidden">
      <div className="border-b border-ink-200/60 dark:border-ink-700/50 px-5 py-4">
        <h2 className="text-[0.9375rem] font-semibold text-ink-900">
          My loans
        </h2>
      </div>
      <ul className="divide-y divide-ink-100/90 dark:divide-ink-700/50">
        {rows.map((issue) => {
          const overdue =
            issue.status === "ISSUED" && new Date(issue.dueAt) < new Date();
          return (
            <li
              key={issue.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
            >
              <div>
                <p className="text-sm font-medium text-ink-900">
                  {issue.book?.title}
                </p>
                <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                  {issue.book?.author} · due{" "}
                  {new Date(issue.dueAt).toLocaleDateString()}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  issue.status === "RETURNED"
                    ? "bg-ink-100 text-ink-600 dark:bg-ink-200/40 dark:text-ink-300"
                    : overdue
                      ? "bg-red-50 text-red-700 ring-1 ring-red-200/70 dark:bg-red-500/12 dark:text-red-300 dark:ring-red-400/25"
                      : "bg-brand-50 text-brand-700 ring-1 ring-brand-200/70 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-400/25"
                }`}
              >
                {issue.status === "RETURNED"
                  ? "returned"
                  : overdue
                    ? "overdue"
                    : "on loan"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function IssuedList({ query }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const returnBook = useMutation({
    mutationFn: (id) => apiPost(`/library/issues/${id}/return`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library", "issues"] });
      queryClient.invalidateQueries({ queryKey: ["library", "books"] });
    },
    onError: (failure) => setError(failure.message),
  });

  if (query.isPending) return <Loading label="Loading issued books" />;
  if (query.isError)
    return (
      <ErrorState
        message={query.error?.message}
        onRetry={() => query.refetch()}
      />
    );

  const rows = query.data?.data?.issues ?? [];

  return (
    <section className="surface overflow-hidden">
      <div className="border-b border-ink-200/60 dark:border-ink-700/50 px-5 py-4">
        <h2 className="text-[0.9375rem] font-semibold text-ink-900">
          Books on loan
        </h2>
      </div>
      {rows.length === 0 ? (
        <div className="p-5">
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Nothing is currently issued.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink-200/70 dark:border-ink-700/60 text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400">
              <tr>
                <th className="px-5 py-3 font-medium">Student</th>
                <th className="px-5 py-3 font-medium">Book</th>
                <th className="px-5 py-3 font-medium">Due</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100/90 dark:divide-ink-700/50">
              {rows.map((issue) => (
                <tr key={issue.id}>
                  <td className="px-5 py-3">
                    <span className="font-medium text-ink-900">
                      {issue.student?.user?.fullName ?? "—"}
                    </span>
                    <span className="ml-2 font-mono text-xs text-ink-500">
                      {issue.student?.rollNumber}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-ink-600 dark:text-ink-300">
                    {issue.book?.title}
                  </td>
                  <td className="px-5 py-3 text-ink-600 dark:text-ink-300">
                    {new Date(issue.dueAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={returnBook.isPending}
                      onClick={() => returnBook.mutate(issue.id)}
                    >
                      <Undo2 className="size-3.5" aria-hidden="true" /> Return
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="px-5 py-3 text-sm text-red-600 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </section>
  );
}

function AddBookDialog({ onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: "",
    author: "",
    category: "",
    copiesTotal: "1",
  });
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () =>
      apiPost("/library/books", {
        title: form.title.trim(),
        author: form.author.trim(),
        category: form.category.trim() || undefined,
        copiesTotal: Number(form.copiesTotal),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library", "books"] });
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a title"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={!form.title.trim() || !form.author.trim()}
            onClick={() => create.mutate()}
          >
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" htmlFor="book-title" required>
          <input
            id="book-title"
            className={inputClass}
            value={form.title}
            onChange={(event) =>
              setForm((c) => ({ ...c, title: event.target.value }))
            }
          />
        </Field>
        <Field label="Author" htmlFor="book-author" required>
          <input
            id="book-author"
            className={inputClass}
            value={form.author}
            onChange={(event) =>
              setForm((c) => ({ ...c, author: event.target.value }))
            }
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="book-category">
            <input
              id="book-category"
              className={inputClass}
              value={form.category}
              onChange={(event) =>
                setForm((c) => ({ ...c, category: event.target.value }))
              }
              placeholder="Computer Science"
            />
          </Field>
          <Field label="Copies" htmlFor="book-copies" required>
            <input
              id="book-copies"
              type="number"
              min="1"
              max="1000"
              className={inputClass}
              value={form.copiesTotal}
              onChange={(event) =>
                setForm((c) => ({ ...c, copiesTotal: event.target.value }))
              }
            />
          </Field>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function IssueDialog({ book, onClose }) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState("");
  const [studentId, setStudentId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState("");

  const students = useQuery({
    queryKey: ["library", "students", searched],
    queryFn: () =>
      apiGet(`/library/students?q=${encodeURIComponent(searched)}`),
    enabled: searched.trim().length >= 2,
  });

  const issue = useMutation({
    mutationFn: () =>
      apiPost("/library/issues", { book: book.id, student: studentId, dueAt }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });

  const options = students.data?.data?.students ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title={`Issue · ${book.title}`}
      description={`${book.copiesTotal - book.copiesIssued} copies available.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={issue.isPending}
            disabled={!studentId || !dueAt}
            onClick={() => issue.mutate()}
          >
            Issue
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Find a student"
          htmlFor="issue-search"
          hint="At least 2 characters."
        >
          <div className="flex gap-2">
            <input
              id="issue-search"
              className={inputClass}
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Roll number or name"
            />
            <Button variant="secondary" onClick={() => setSearched(q)}>
              <Search className="size-4" aria-hidden="true" /> Search
            </Button>
          </div>
        </Field>

        {options.length > 0 && (
          <Field label="Student" htmlFor="issue-student" required>
            <select
              id="issue-student"
              className={inputClass}
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
            >
              <option value="">Choose a student</option>
              {options.map((student) => (
                <option key={student.studentId} value={student.studentId}>
                  {student.rollNumber} · {student.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Due date" htmlFor="issue-due" required>
          <input
            id="issue-due"
            type="date"
            className={inputClass}
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
        </Field>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

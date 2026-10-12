import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";

import { apiGet, apiPost } from "../api/client";
import Button from "../components/ui/Button";
import DynamicField from "../components/DynamicField";
import { Card } from "../components/ui/Card";
import { ErrorState, Loading } from "../components/ui/States";

/**
 * Raise a request.
 *
 * ## The form is described by the server
 *
 * Choosing a request type loads its field definitions and the form is built from
 * them. Adding a service therefore needs no frontend change — which is the whole
 * point of keeping the catalogue in the database.
 *
 * ## A number is submitted as a number, not a string
 *
 * An input yields a string, and a string in a numeric field is the first step
 * toward a float arriving at a total. Numbers are coerced here, once, on the
 * way out; the server validates them again regardless.
 */
export default function NewRequest() {
  const navigate = useNavigate();

  const [typeId, setTypeId] = useState("");
  const [values, setValues] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});

  const types = useQuery({
    queryKey: ["request-types"],
    queryFn: () => apiGet("/request-types"),
  });

  const selected = types.data?.data?.find((type) => type._id === typeId);

  const submit = useMutation({
    mutationFn: (payload) => apiPost("/requests", payload),
    onSuccess: (response) => {
      navigate(`/requests/${response.data.reference ?? response.data._id}`);
    },
    onError: (error) => {
      // The server names the offending field; surface it next to the input.
      setFieldErrors(error.fieldErrors ?? {});
    },
  });

  const changeType = (nextId) => {
    setTypeId(nextId);
    // Values belong to the previous type's shape. Carrying them across would
    // submit a field the new type does not declare.
    setValues({});
    setFieldErrors({});
  };

  const onSubmit = (event) => {
    event.preventDefault();
    if (!selected) return;

    const data = {};
    for (const field of selected.fields ?? []) {
      const raw = values[field.name];

      if (field.type === "BOOLEAN") {
        data[field.name] = Boolean(raw);
      } else if (field.type === "NUMBER") {
        // Coerced once, here. Blank stays absent rather than becoming zero.
        if (raw !== undefined && raw !== "") data[field.name] = Number(raw);
      } else if (raw !== undefined && raw !== "") {
        data[field.name] = raw;
      }
    }

    submit.mutate({
      requestType: selected._id,
      title: selected.name,
      description: selected.description,
      data,
    });
  };

  if (types.isLoading) return <Loading label="Loading the service catalogue" />;
  if (types.isError) {
    return (
      <ErrorState
        message={types.error?.message}
        onRetry={() => types.refetch()}
      />
    );
  }

  const available = types.data?.data ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Raise a request
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Choose the service you need and answer its questions.
        </p>
      </header>

      {available.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-600">
            No services are published yet. An administrator can add them from
            the catalogue.
          </p>
        </Card>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <Card title="Service">
            <div className="space-y-2">
              {available.map((type) => (
                <label
                  key={type._id}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg p-3 ring-1 transition-colors ${
                    typeId === type._id
                      ? "bg-brand-50 ring-brand-400"
                      : "ring-ink-200 hover:bg-ink-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="requestType"
                    value={type._id}
                    checked={typeId === type._id}
                    onChange={() => changeType(type._id)}
                    className="mt-1 size-4 text-brand-600 focus:ring-brand-600"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink-800">
                      {type.name}
                    </span>
                    {type.description && (
                      <span className="mt-0.5 block text-xs text-ink-500">
                        {type.description}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </Card>

          {selected && (
            <Card title="Your answers">
              <div className="space-y-5">
                {(selected.fields ?? []).map((field) => (
                  <DynamicField
                    key={field.name}
                    field={field}
                    value={values[field.name]}
                    error={
                      fieldErrors[field.name] ??
                      fieldErrors[`data.${field.name}`]
                    }
                    onChange={(next) =>
                      setValues((current) => ({
                        ...current,
                        [field.name]: next,
                      }))
                    }
                  />
                ))}

                {selected.requiresPayment && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    This service carries a fee. You will be invoiced once it is
                    submitted.
                  </p>
                )}

                {submit.isError && !Object.keys(fieldErrors).length && (
                  <p
                    role="alert"
                    className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
                  >
                    {submit.error?.message}
                  </p>
                )}
              </div>
            </Card>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!selected}
              loading={submit.isPending}
            >
              Submit request
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

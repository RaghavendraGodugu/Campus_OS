/**
 * Complaint workflow definition.
 *
 * Modelled separately from the request workflow because a complaint is a
 * grievance: it needs acknowledgement, investigation and resolution as distinct
 * steps, and it can be reopened after resolution. Those are exactly the states
 * a service request does not have (spec §10).
 *
 * Like the request table, this is the single source of legal transitions.
 */

const { COMPLAINT_STATUS } = require("../config/constants");
const { P } = require("./permissions");

/**
 * @typedef {object} ComplaintTransition
 * @property {string} to
 * @property {string} permission
 * @property {boolean} [reasonRequired]
 * @property {string} [label]
 * @property {boolean} [noteRequired] Whether a student-visible note must accompany it.
 */

/**
 * from -> legal transitions.
 *
 * ```
 * OPEN ──acknowledge──▶ ACKNOWLEDGED ──investigate──▶ INVESTIGATING
 *                                              │
 *                              ┌───────────────┼───────────────┐
 *                              ▼                               ▼
 *                          RESOLVED                        REJECTED
 *                              │
 *                       (student, within window)
 *                              ▼
 *                          REOPENED ──investigate──▶ INVESTIGATING ──▶ RESOLVED
 * ```
 *
 * `REJECTED` is distinct from `RESOLVED`: a rejection means the complaint was
 * not upheld, and a student should be able to contest that, which is why
 * rejection is not terminal while resolution is reopenable but must be re-entered
 * through REOPENED.
 */
const COMPLAINT_TRANSITIONS = {
  [COMPLAINT_STATUS.OPEN]: [
    {
      to: COMPLAINT_STATUS.ACKNOWLEDGED,
      permission: P.COMPLAINT_ACKNOWLEDGE,
      noteRequired: true,
      label: "Acknowledge",
      description: "Confirms receipt and starts the resolution clock.",
    },
    {
      to: COMPLAINT_STATUS.RESOLVED,
      permission: P.COMPLAINT_RESOLVE,
      // The student-visible note carries the explanation; requiring a separate
      // `reason` as well would ask the handler to write the same text twice.
      noteRequired: true,
      label: "Resolve directly",
      description: "For matters resolvable without investigation.",
    },
  ],

  [COMPLAINT_STATUS.ACKNOWLEDGED]: [
    {
      to: COMPLAINT_STATUS.INVESTIGATING,
      permission: P.COMPLAINT_INVESTIGATE,
      label: "Begin investigation",
    },
    {
      to: COMPLAINT_STATUS.RESOLVED,
      permission: P.COMPLAINT_RESOLVE,
      noteRequired: true,
      label: "Resolve",
    },
    {
      to: COMPLAINT_STATUS.REJECTED,
      permission: P.COMPLAINT_RESOLVE,
      noteRequired: true,
      label: "Reject",
      description: "The complaint is not upheld. The reason is shown to the student.",
    },
  ],

  [COMPLAINT_STATUS.INVESTIGATING]: [
    {
      to: COMPLAINT_STATUS.RESOLVED,
      permission: P.COMPLAINT_RESOLVE,
      noteRequired: true,
      label: "Resolve",
    },
    {
      to: COMPLAINT_STATUS.REJECTED,
      permission: P.COMPLAINT_RESOLVE,
      noteRequired: true,
      label: "Reject",
    },
  ],

  /**
   * Reopening is the student's, not the handler's. This is the route by which a
   * dissatisfied student returns a matter to the queue, which is why the
   * student owns this edge rather than staff.
   */
  [COMPLAINT_STATUS.RESOLVED]: [
    {
      to: COMPLAINT_STATUS.REOPENED,
      permission: P.COMPLAINT_REOPEN_OWN,
      reasonRequired: true,
      label: "Reopen",
      description: "Student disputes the outcome and asks for it to be looked at again.",
    },
  ],

  [COMPLAINT_STATUS.REJECTED]: [
    {
      to: COMPLAINT_STATUS.REOPENED,
      permission: P.COMPLAINT_REOPEN_OWN,
      reasonRequired: true,
      label: "Reopen",
    },
  ],

  [COMPLAINT_STATUS.REOPENED]: [
    {
      to: COMPLAINT_STATUS.INVESTIGATING,
      permission: P.COMPLAINT_INVESTIGATE,
      label: "Resume investigation",
    },
    {
      to: COMPLAINT_STATUS.RESOLVED,
      permission: P.COMPLAINT_RESOLVE,
      noteRequired: true,
      label: "Resolve",
    },
    {
      to: COMPLAINT_STATUS.REJECTED,
      permission: P.COMPLAINT_RESOLVE,
      noteRequired: true,
      label: "Reject",
    },
  ],
};

/** Terminal for the workflow: no outbound edges exist. */
function complaintTransitionsFrom(from) {
  return COMPLAINT_TRANSITIONS[from] ?? [];
}

function findComplaintTransition(from, to) {
  return complaintTransitionsFrom(from).find((t) => t.to === to) ?? null;
}

function canComplaintTransition(from, to) {
  return findComplaintTransition(from, to) !== null;
}

/** Statuses in which no further staff action is expected. */
const CLOSED_STATUSES = Object.freeze([
  COMPLAINT_STATUS.RESOLVED,
  COMPLAINT_STATUS.REJECTED,
]);

/** Statuses that count as "still being worked on" for SLA purposes. */
const OPEN_STATUSES = Object.freeze([
  COMPLAINT_STATUS.OPEN,
  COMPLAINT_STATUS.ACKNOWLEDGED,
  COMPLAINT_STATUS.INVESTIGATING,
  COMPLAINT_STATUS.REOPENED,
]);

function isComplaintOpen(status) {
  return OPEN_STATUSES.includes(status);
}

/**
 * Transitions the caller may perform right now.
 * Presentation only — the server re-validates on submit.
 */
function availableComplaintTransitions(from, hasPermission) {
  return complaintTransitionsFrom(from).filter((t) => hasPermission(t.permission));
}

module.exports = {
  COMPLAINT_TRANSITIONS,
  complaintTransitionsFrom,
  findComplaintTransition,
  canComplaintTransition,
  isComplaintOpen,
  availableComplaintTransitions,
  CLOSED_STATUSES,
  OPEN_STATUSES,
};

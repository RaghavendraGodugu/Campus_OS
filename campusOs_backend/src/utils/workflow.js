/**
 * Request workflow definition.
 *
 * ## Why transitions are data, not scattered `if` statements
 *
 * The spec (§9) forbids arbitrary status changes. Encoding the legal edges in
 * one table makes the entire workflow reviewable at a glance, testable in
 * isolation, and impossible to extend accidentally — adding a status without
 * deciding its inbound edges simply leaves it unreachable.
 *
 * `workflow.service.js` is the only module permitted to write `status`, and it
 * consults this table for every change.
 *
 * ## Edge shape
 *
 * ```
 * DRAFT ──submit──▶ SUBMITTED ──assign──▶ ASSIGNED ──start──▶ UNDER_REVIEW
 *                       │                                          │
 *                       │cancel                            ┌───────┴────────┐
 *                       ▼                                   ▼                ▼
 *                   CANCELLED                      ACTION_REQUIRED   APPROVAL_PENDING
 *                                                       │  ▲                    │
 *                                              respond│  │request info        approve/reject
 *                                                       ▼  │                    ▼
 *                                                   UNDER_REVIEW            APPROVED
 *                                                                             │
 *                                                                 process      ▼
 *                                                                       PROCESSING
 *                                                                             │ complete
 *                                                                             ▼
 *                                                                          COMPLETED
 * ```
 *
 * `ESCALATED` is reachable from any active state by a privileged role, and can
 * return to `UNDER_REVIEW` once resolved.
 */

const { REQUEST_STATUS } = require("../config/constants");
const { P } = require("./permissions");

/**
 * One legal transition.
 *
 * @typedef {object} Transition
 * @property {string} to            Target status.
 * @property {string} permission    Permission the actor must hold.
 * @property {boolean} [reasonRequired] Whether a reason must be supplied.
 * @property {string} [label]       Verb shown in the UI ("Approve request").
 * @property {string} [studentVisible] Whether this step appears on the
 *   student's timeline. Internal processing steps do not.
 * @property {string} [description] Explains the step, for documentation.
 */

/**
 * from -> allowed transitions.
 *
 * Each entry lists *every* legal destination from that status. Absence of a
 * status from this map means it is terminal by construction, which is the safe
 * default: an unknown status rejects every move.
 */
const TRANSITIONS = {
  [REQUEST_STATUS.DRAFT]: [
    {
      to: REQUEST_STATUS.SUBMITTED,
      permission: P.REQUEST_CREATE,
      label: "Submit request",
      studentVisible: true,
      description: "Student submits the completed application for processing.",
    },
    {
      to: REQUEST_STATUS.CANCELLED,
      permission: P.REQUEST_CANCEL_OWN,
      reasonRequired: false,
      label: "Discard draft",
      studentVisible: true,
    },
  ],

  [REQUEST_STATUS.SUBMITTED]: [
    {
      to: REQUEST_STATUS.ASSIGNED,
      permission: P.REQUEST_ASSIGN_DEPARTMENT,
      label: "Assign",
      studentVisible: true,
      description: "A staff member takes ownership of the request.",
    },
    {
      to: REQUEST_STATUS.CANCELLED,
      permission: P.REQUEST_CANCEL_OWN,
      label: "Cancel",
      studentVisible: true,
      description: "Student withdraws before processing begins.",
    },
    {
      to: REQUEST_STATUS.ESCALATED,
      permission: P.REQUEST_ESCALATE,
      reasonRequired: true,
      label: "Escalate",
      studentVisible: true,
    },
  ],

  [REQUEST_STATUS.ASSIGNED]: [
    {
      to: REQUEST_STATUS.UNDER_REVIEW,
      permission: P.REQUEST_REVIEW_ASSIGNED,
      label: "Start review",
      studentVisible: true,
      description: "The assignee begins examining the application.",
    },
    {
      to: REQUEST_STATUS.ESCALATED,
      permission: P.REQUEST_ESCALATE,
      reasonRequired: true,
      label: "Escalate",
      studentVisible: true,
    },
  ],

  [REQUEST_STATUS.UNDER_REVIEW]: [
    {
      to: REQUEST_STATUS.ACTION_REQUIRED,
      permission: P.REQUEST_REVIEW_ASSIGNED,
      reasonRequired: true,
      label: "Request more information",
      studentVisible: true,
      description: "Pauses processing until the student supplies what is missing.",
    },
    {
      to: REQUEST_STATUS.APPROVAL_PENDING,
      permission: P.REQUEST_REVIEW_ASSIGNED,
      label: "Send for approval",
      studentVisible: true,
    },
    {
      to: REQUEST_STATUS.ESCALATED,
      permission: P.REQUEST_ESCALATE,
      reasonRequired: true,
      label: "Escalate",
      studentVisible: true,
    },
  ],

  [REQUEST_STATUS.ACTION_REQUIRED]: [
    {
      to: REQUEST_STATUS.UNDER_REVIEW,
      permission: P.REQUEST_RESPOND_OWN,
      label: "Submit requested information",
      studentVisible: true,
      description: "Student responds; processing resumes automatically.",
    },
    {
      to: REQUEST_STATUS.CANCELLED,
      permission: P.REQUEST_CANCEL_OWN,
      label: "Cancel",
      studentVisible: true,
    },
    {
      to: REQUEST_STATUS.ESCALATED,
      permission: P.REQUEST_ESCALATE,
      reasonRequired: true,
      label: "Escalate",
      studentVisible: true,
    },
  ],

  [REQUEST_STATUS.APPROVAL_PENDING]: [
    {
      to: REQUEST_STATUS.APPROVED,
      permission: P.REQUEST_APPROVE_DEPARTMENT,
      label: "Approve",
      studentVisible: true,
    },
    {
      to: REQUEST_STATUS.REJECTED,
      permission: P.REQUEST_APPROVE_DEPARTMENT,
      reasonRequired: true,
      label: "Reject",
      studentVisible: true,
      description: "Terminal. A reason is mandatory and shown to the student.",
    },
    {
      // Sent back for more scrutiny rather than decided.
      to: REQUEST_STATUS.UNDER_REVIEW,
      permission: P.REQUEST_APPROVE_DEPARTMENT,
      reasonRequired: true,
      label: "Return for review",
      studentVisible: true,
    },
    {
      to: REQUEST_STATUS.ESCALATED,
      permission: P.REQUEST_ESCALATE,
      reasonRequired: true,
      label: "Escalate",
      studentVisible: true,
    },
  ],

  [REQUEST_STATUS.APPROVED]: [
    {
      to: REQUEST_STATUS.PROCESSING,
      permission: P.REQUEST_PROCESS_ASSIGNED,
      label: "Start processing",
      studentVisible: true,
      description: "Approval granted; the service is now being delivered.",
    },
    {
      to: REQUEST_STATUS.ESCALATED,
      permission: P.REQUEST_ESCALATE,
      reasonRequired: true,
      label: "Escalate",
      studentVisible: true,
    },
  ],

  [REQUEST_STATUS.PROCESSING]: [
    {
      to: REQUEST_STATUS.COMPLETED,
      permission: P.REQUEST_COMPLETE_ASSIGNED,
      reasonRequired: true,
      label: "Mark complete",
      studentVisible: true,
      description: "Terminal. A resolution summary is mandatory.",
    },
    {
      to: REQUEST_STATUS.ESCALATED,
      permission: P.REQUEST_ESCALATE,
      reasonRequired: true,
      label: "Escalate",
      studentVisible: true,
    },
  ],

  [REQUEST_STATUS.ESCALATED]: [
    {
      to: REQUEST_STATUS.UNDER_REVIEW,
      permission: P.REQUEST_ESCALATE,
      reasonRequired: true,
      label: "Resume review",
      studentVisible: true,
      description: "Escalation resolved; work returns to the owning department.",
    },
  ],

  // Terminal states appear as keys with empty lists, so `isTerminal()` can be
  // answered from the table rather than a separate hardcoded list.
  [REQUEST_STATUS.COMPLETED]: [],
  [REQUEST_STATUS.REJECTED]: [],
  [REQUEST_STATUS.CANCELLED]: [],
};

/**
 * Transitions available from a status.
 * @param {string} from
 * @returns {Transition[]} Empty for a terminal or unknown status.
 */
function transitionsFrom(from) {
  return TRANSITIONS[from] ?? [];
}

/**
 * Is this a terminal status?
 *
 * Terminal means "no outbound transitions", which is derived from the table so
 * the two cannot disagree.
 *
 * @param {string} status
 */
function isTerminal(status) {
  return transitionsFrom(status).length === 0;
}

/**
 * Find a specific transition.
 *
 * @param {string} from
 * @param {string} to
 * @returns {Transition|null}
 */
function findTransition(from, to) {
  return transitionsFrom(from).find((t) => t.to === to) ?? null;
}

/**
 * Is a move legal *ignoring* who is performing it?
 *
 * Answers "does this edge exist?", not "may this caller take it?" — the second
 * question requires the permission check in workflow.service.js.
 *
 * @param {string} from
 * @param {string} to
 */
function canTransition(from, to) {
  return findTransition(from, to) !== null;
}

/**
 * Transitions a given user may perform from a status.
 *
 * Used to render the available actions, so the UI never offers a move that the
 * server would reject. Presentation only — the server re-checks every time.
 *
 * @param {string} from
 * @param {(user: {role: string}) => boolean} hasPermission
 * @returns {Transition[]}
 */
function availableTransitions(from, hasPermission) {
  return transitionsFrom(from).filter((t) => hasPermission(t.permission));
}

/**
 * Student-facing timeline: transitions worth showing on the student's request
 * page. Internal-only steps are filtered out here rather than in the client.
 *
 * @param {Array<object>} history
 * @returns {Array<object>}
 */
function studentVisibleHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .map((entry) => {
      const transition = entry.from ? findTransition(entry.from, entry.to) : null;
      // The initial submission has no inbound edge; it is always visible.
      if (!transition) return entry.from === null ? entry : null;
      return transition.studentVisible ? entry : null;
    })
    .filter(Boolean);
}

module.exports = {
  TRANSITIONS,
  transitionsFrom,
  findTransition,
  canTransition,
  isTerminal,
  availableTransitions,
  studentVisibleHistory,
};

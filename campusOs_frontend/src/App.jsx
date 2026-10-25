import { Navigate, Route, Routes } from "react-router-dom";

import RequireAuth from "./components/RequireAuth";
import RequirePermission from "./components/RequirePermission";
import AppShell from "./components/layout/AppShell";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import Timetable from "./pages/Timetable";
import Attendance from "./pages/Attendance";
import Results from "./pages/Results";
import Hostel from "./pages/Hostel";
import Library from "./pages/Library";
import Placements from "./pages/Placements";
import CampusOverview from "./pages/CampusOverview";
import Events from "./pages/Events";
import StaffDirectory from "./pages/StaffDirectory";
import Academics from "./pages/Academics";
import ApplyCertificate from "./pages/ApplyCertificate";
import VerifyCertificate from "./pages/VerifyCertificate";
import SetPassword from "./pages/SetPassword";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import VerifyEmail from "./pages/VerifyEmail";
import Grievance from "./pages/Grievance";
import People from "./pages/admin/People";
import Departments from "./pages/admin/Departments";
import Programmes from "./pages/admin/Programmes";
import RequestTypes from "./pages/admin/RequestTypes";
import StudentImport from "./pages/admin/StudentImport";
import Announcements from "./pages/Announcements";
import AnnouncementDetail from "./pages/AnnouncementDetail";
import Complaints from "./pages/Complaints";
import NewComplaint from "./pages/NewComplaint";
import Certificates from "./pages/Certificates";
import Reports from "./pages/Reports";
import AuditTrail from "./pages/AuditTrail";
import ComposeAnnouncement from "./pages/ComposeAnnouncement";
import Terms from "./pages/admin/Terms";
import CertificateTemplates from "./pages/admin/CertificateTemplates";
import GstProfile from "./pages/admin/GstProfile";
import CertificateDetail from "./pages/CertificateDetail";
import ComplaintDetail from "./pages/ComplaintDetail";
import Requests from "./pages/Requests";
import NewRequest from "./pages/NewRequest";
import RequestDetail from "./pages/RequestDetail";
import Invoices from "./pages/Invoices";
import InvoiceDetail from "./pages/InvoiceDetail";
import Refunds from "./pages/Refunds";
import NotFound from "./pages/NotFound";

/**
 * Routes.
 *
 * The permission on each route is a courtesy to the reader, not a control. The
 * server re-derives permissions on every request, so a route guarded here and
 * reached anyway would fetch nothing.
 */
export default function App() {
  return (
    <Routes>
      {/* Public: no session, and deliberately outside the signed-in shell. A
          bank counter is not going to have a CampusOS login. */}
      <Route path="/verify" element={<VerifyCertificate />} />

      {/* Public, like /verify: the person who most needs to report something is
          often the person least able to file it under their own name. */}
      <Route path="/grievance" element={<Grievance />} />

      <Route path="/login" element={<Login />} />

      {/*
        Locked out, or arriving from a link in an email. All three are outside
        the shell: by definition there is no session to put them in.
      */}
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />

      {/*
        Reachable while signed in, but deliberately outside the shell: a person
        who owes a password change should not see navigation to pages they are
        not meant to be using yet.
      */}
      <Route
        path="/set-password"
        element={
          <RequireAuth allowUnchangedPassword>
            <SetPassword />
          </RequireAuth>
        }
      />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        {/* Available to every signed-in role; the content varies by role. */}
        <Route path="profile" element={<Profile />} />

        {/*
          The timetable is one page with four scopes: the server returns a
          student's programme, a faculty member's own classes, a HOD's
          department or the institution, depending on who is asking.
        */}
        <Route
          path="timetable"
          element={
            <RequirePermission
              permissions={[
                "timetable:read:own",
                "timetable:read:department",
                "timetable:read:institution",
              ]}
            >
              <Timetable />
            </RequirePermission>
          }
        />

        <Route
          path="attendance"
          element={
            <RequirePermission
              permissions={[
                "attendance:read:own",
                "attendance:read:department",
                "attendance:read:institution",
              ]}
            >
              <Attendance />
            </RequirePermission>
          }
        />

        <Route
          path="results"
          element={
            <RequirePermission
              permissions={[
                "result:read:own",
                "result:read:department",
                "result:read:institution",
              ]}
            >
              <Results />
            </RequirePermission>
          }
        />

        <Route
          path="events"
          element={
            <RequirePermission permissions={["event:read"]}>
              <Events />
            </RequirePermission>
          }
        />
        <Route
          path="directory"
          element={
            <RequirePermission permissions={["staff-directory:read"]}>
              <StaffDirectory />
            </RequirePermission>
          }
        />
        <Route
          path="hostel"
          element={
            <RequirePermission
              permissions={["hostel:read:own", "hostel:read:institution"]}
            >
              <Hostel />
            </RequirePermission>
          }
        />
        <Route
          path="library"
          element={
            <RequirePermission
              permissions={["library:read:own", "library:read:institution"]}
            >
              <Library />
            </RequirePermission>
          }
        />
        <Route
          path="placements"
          element={
            <RequirePermission
              permissions={["placement:read:own", "placement:read:institution"]}
            >
              <Placements />
            </RequirePermission>
          }
        />

        <Route
          path="analytics"
          element={
            <RequirePermission
              permissions={[
                "hostel:read:institution",
                "library:read:institution",
                "placement:read:institution",
                "attendance:read:institution",
                "result:read:institution",
              ]}
            >
              <CampusOverview />
            </RequirePermission>
          }
        />

        <Route
          path="management/academics"
          element={
            <RequirePermission
              permissions={[
                "subject:manage:institution",
                "subject:manage:department",
                "room:manage:institution",
              ]}
            >
              <Academics />
            </RequirePermission>
          }
        />

        {/* Administration. Gated on permissions the server re-checks on every
            request — the guard here is for the reader, not a control. */}
        <Route
          path="admin/people"
          element={
            <RequirePermission permissions={["user:read:institution"]}>
              <People />
            </RequirePermission>
          }
        />
        <Route
          path="admin/services"
          element={
            <RequirePermission
              permissions={["request-type:manage:institution"]}
            >
              <RequestTypes />
            </RequirePermission>
          }
        />
        <Route
          path="admin/students"
          element={
            <RequirePermission permissions={["user:manage:institution"]}>
              <StudentImport />
            </RequirePermission>
          }
        />
        <Route
          path="admin/departments"
          element={
            <RequirePermission permissions={["department:manage:institution"]}>
              <Departments />
            </RequirePermission>
          }
        />
        <Route
          path="admin/programmes"
          element={
            <RequirePermission permissions={["program:manage:institution"]}>
              <Programmes />
            </RequirePermission>
          }
        />

        {/* Declared before the two-segment route below, so "new" is never read
            as a request reference. */}
        <Route
          path="requests/new"
          element={
            <RequirePermission permission="request:create:own">
              <NewRequest />
            </RequirePermission>
          }
        />
        <Route
          path="requests"
          element={
            <RequirePermission permission="request:read:own">
              <Requests mode="own" />
            </RequirePermission>
          }
        />
        <Route
          path="requests/:reference"
          element={
            <RequirePermission permission="request:read:own">
              <RequestDetail />
            </RequirePermission>
          }
        />
        {/* Literal paths first: "new" must not be read as a reference. */}
        <Route
          path="complaints/new"
          element={
            <RequirePermission permission="complaint:create:own">
              <NewComplaint />
            </RequirePermission>
          }
        />
        <Route
          path="complaints"
          element={
            <RequirePermission permission="complaint:create:own">
              <Complaints mode="own" />
            </RequirePermission>
          }
        />
        <Route
          path="certificates"
          element={
            <RequirePermission permission="certificate:apply:own">
              <Certificates mode="own" />
            </RequirePermission>
          }
        />

        {/* Declared before the reference route so "new" is never read as one. */}
        <Route
          path="certificates/new"
          element={
            <RequirePermission permission="certificate:apply:own">
              <ApplyCertificate />
            </RequirePermission>
          }
        />

        {/* Detail routes, one permission set per audience. Declared after the
            list routes so "new" is never parsed as a reference. */}
        <Route
          path="certificates/:reference"
          element={
            <RequirePermission permissions={["certificate:apply:own"]}>
              <CertificateDetail />
            </RequirePermission>
          }
        />
        <Route
          path="complaints/:reference"
          element={
            <RequirePermission permissions={["complaint:create:own"]}>
              <ComplaintDetail />
            </RequirePermission>
          }
        />
        <Route
          path="requests/:reference"
          element={
            <RequirePermission
              permissions={["request:read:own", "request:read:assigned"]}
            >
              <RequestDetail />
            </RequirePermission>
          }
        />
        <Route
          path="management/certificates/:reference"
          element={
            <RequirePermission
              permissions={[
                "certificate:read:assigned",
                "certificate:read:department",
                "certificate:read:institution",
              ]}
            >
              <CertificateDetail />
            </RequirePermission>
          }
        />
        <Route
          path="management/complaints/:reference"
          element={
            <RequirePermission
              permissions={[
                "complaint:read:assigned",
                "complaint:read:institution",
              ]}
            >
              <ComplaintDetail />
            </RequirePermission>
          }
        />
        <Route
          path="management/requests/:reference"
          element={
            <RequirePermission permissions={["request:read:assigned"]}>
              <RequestDetail />
            </RequirePermission>
          }
        />

        <Route
          path="management/requests"
          element={
            <RequirePermission permission="request:read:assigned">
              <Requests mode="assigned" />
            </RequirePermission>
          }
        />

        <Route
          path="announcements"
          element={
            <RequirePermission permission="announcement:read:institution">
              <Announcements />
            </RequirePermission>
          }
        />
        <Route
          path="announcements/:reference"
          element={
            <RequirePermission permission="announcement:read:institution">
              <AnnouncementDetail />
            </RequirePermission>
          }
        />

        <Route
          path="finance/invoices"
          element={
            /*
             * Either the student's own invoices or the institution's, because
             * the accounts department lives on the same screen — a separate
             * "management" copy would be the same page twice.
             *
             * Hiding links is convenience, not control: the API still decides
             * per invoice whether this reader may see it.
             */
            <RequirePermission
              permissions={["invoice:read:own", "invoice:read:institution"]}
            >
              <Invoices />
            </RequirePermission>
          }
        />
        <Route
          path="finance/invoices/:reference"
          element={
            /*
             * The accounts department could not open an invoice at all before
             * this: the route was gated on `invoice:read:own`, which they do
             * not hold, so the one screen that shows what a student owes was
             * unreachable for the people who collect it.
             */
            <RequirePermission
              permissions={["invoice:read:own", "invoice:read:institution"]}
            >
              <InvoiceDetail />
            </RequirePermission>
          }
        />
        <Route
          path="finance/refunds"
          element={
            <RequirePermission permission="refund:request:own">
              <Refunds />
            </RequirePermission>
          }
        />

        <Route
          path="management/complaints"
          element={
            <RequirePermission permission="complaint:read:assigned">
              <Complaints mode="assigned" />
            </RequirePermission>
          }
        />
        {/* Any read scope. Gated on the assigned variant alone, only support
            staff could ever open it. */}
        <Route
          path="management/certificates"
          element={
            <RequirePermission
              permissions={[
                "certificate:read:assigned",
                "certificate:read:department",
                "certificate:read:institution",
              ]}
            >
              <Certificates mode="assigned" />
            </RequirePermission>
          }
        />

        {/* Any scope qualifies. The server narrows what a report contains;
            the client must not refuse the Dean a page the server would serve. */}
        <Route
          path="reports"
          element={
            <RequirePermission
              permissions={[
                "report:read:institution",
                "report:read:department",
              ]}
            >
              <Reports />
            </RequirePermission>
          }
        />
        <Route
          path="audit"
          element={
            <RequirePermission
              permissions={["audit:read:institution", "audit:read:department"]}
            >
              <AuditTrail />
            </RequirePermission>
          }
        />
        <Route
          path="management/announcements"
          element={
            <RequirePermission permission="announcement:manage:institution">
              <ComposeAnnouncement />
            </RequirePermission>
          }
        />
        <Route
          path="management/terms"
          element={
            <RequirePermission permission="academic-term:manage:institution">
              <Terms />
            </RequirePermission>
          }
        />
        <Route
          path="management/certificate-templates"
          element={
            <RequirePermission permission="certificate:issue:institution">
              <CertificateTemplates />
            </RequirePermission>
          }
        />
        <Route
          path="management/tax"
          element={
            <RequirePermission permission="invoice:manage:institution">
              <GstProfile />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

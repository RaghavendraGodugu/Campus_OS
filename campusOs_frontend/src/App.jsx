import { Navigate, Route, Routes } from "react-router-dom";

import RequireAuth from "./components/RequireAuth";
import RequirePermission from "./components/RequirePermission";
import AppShell from "./components/layout/AppShell";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Announcements from "./pages/Announcements";
import AnnouncementDetail from "./pages/AnnouncementDetail";
import Invoices from "./pages/Invoices";
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
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />

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
            <RequirePermission permission="invoice:read:own">
              <Invoices />
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

        {/* Implemented next: requests, complaints, certificates, management,
            reports and the audit trail. */}
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

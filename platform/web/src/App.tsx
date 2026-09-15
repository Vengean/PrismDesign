import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import CreateWorkspace from "@/pages/CreateWorkspace";
import WorkspaceSettings from "@/pages/WorkspaceSettings";
import WorkspaceDetail from "@/pages/WorkspaceDetail";
import UserManagement from "@/pages/UserManagement";
import ChangePassword from "@/pages/ChangePassword";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/workspace/create" element={<CreateWorkspace />} />
        <Route path="/workspace/:id" element={<WorkspaceDetail />} />
        <Route path="/workspace/:id/settings" element={<WorkspaceSettings />} />
        <Route path="/admin/users" element={<UserManagement />} />
        <Route path="/settings/password" element={<ChangePassword />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

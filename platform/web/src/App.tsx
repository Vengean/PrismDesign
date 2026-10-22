import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import UserManagement from "@/pages/UserManagement";
import ChangePassword from "@/pages/ChangePassword";
import Projects, { CreateProject } from "@/pages/Projects";
import ProjectDetail from "@/pages/ProjectDetail";

import PreviewContinue from "@/pages/PreviewContinue";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/preview/continue" element={<PreviewContinue />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/create" element={<CreateProject />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/admin/users" element={<UserManagement />} />
        <Route path="/settings/password" element={<ChangePassword />} />
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}

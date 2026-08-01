import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { Layout } from "./Layout";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { Dashboard } from "./pages/Dashboard";
import { JobDetail } from "./pages/JobDetail";
import { Profile } from "./pages/Profile";
import { Admin } from "./pages/Admin";
import { Activity } from "./pages/Activity";
import { Billing } from "./pages/Billing";
import { Tracker } from "./pages/Tracker";

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="centered-page">Loading...</p>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RequireAdmin({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  if (user?.role !== "admin") return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/jobs/:id" element={<JobDetail />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/tracker" element={<Tracker />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/profile" element={<Profile />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <Admin />
            </RequireAdmin>
          }
        />
      </Route>
    </Routes>
  );
}

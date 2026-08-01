import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { ThemeToggle } from "./ThemeToggle";

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="app-shell">
      <nav className="topnav">
        <Link to="/" className="topnav-brand">
          <span className="brand-mark">J</span>Jobvana
        </Link>
        <div className="topnav-links">
          <NavLink to="/" end>
            Jobs
          </NavLink>
          <NavLink to="/activity">Activity</NavLink>
          <NavLink to="/tracker">Tracker</NavLink>
          <NavLink to="/billing">Billing</NavLink>
          <NavLink to="/profile">Profile</NavLink>
          {user?.role === "admin" && <NavLink to="/admin">Admin</NavLink>}
        </div>
        <div className="topnav-user">
          <ThemeToggle />
          <span>{user?.email}</span>
          <button onClick={handleLogout}>Log out</button>
        </div>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

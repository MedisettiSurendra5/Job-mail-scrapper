import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { ApiError } from "../api";

export function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setSubmitting(true);
    try {
      await signup(email, password);
      navigate("/");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sign up failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="centered-page">
      <form className="card login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <span className="brand-mark">J</span>
          <h1>Jobvana</h1>
        </div>
        <p className="muted login-tagline">Find the right people, reach out, get hired.</p>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Creating account..." : "Sign up"}
        </button>
        <p className="muted small login-tagline">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}

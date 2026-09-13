import { useState } from "react";
import { QrCode, Lock, User } from "lucide-react";
import api from "../api";

export default function Login({ onLogin }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post("/api/auth/login", { email, password });
      localStorage.setItem("vqr_token", res.data.token);
      onLogin(res.data.user);
    } catch {
      setError("Invalid email or password. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-bg">
      {/* Animated background orbs */}
      <div className="login-orb login-orb--1" />
      <div className="login-orb login-orb--2" />
      <div className="login-orb login-orb--3" />

      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <QrCode size={28} />
        </div>

        <div className="login-brand">VERIK TECHNOLOGIES</div>
        <h1 className="login-title">QR Campaign Manager</h1>
        <p className="login-sub">Permanent tracking infrastructure for every campaign.</p>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="field-group">
            <label htmlFor="login-email" className="field-label">Email</label>
            <div className="field-wrap">
              <User size={16} className="field-icon" />
              <input
                id="login-email"
                type="email"
                className="field-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                autoComplete="email"
                required
              />
            </div>
          </div>

          <div className="field-group">
            <label htmlFor="login-password" className="field-label">Password</label>
            <div className="field-wrap">
              <Lock size={16} className="field-icon" />
              <input
                id="login-password"
                type="password"
                className="field-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="btn btn--primary btn--full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="login-footer">Verik Technologies · Universal QR Platform v2</p>
      </div>
    </div>
  );
}

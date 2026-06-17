import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Lock } from "lucide-react";
import Footer from "../components/Footer";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login, token, role } = useAuth();

  useEffect(() => {
    if (token) {
      if (role === "admin") navigate("/admin");
      else navigate("/");
    }
  }, [token, role, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (data.success) {
        login(data.token, data.role);
        if (data.role === "admin") navigate("/admin");
        else navigate("/");
      } else {
        setError(data.message || "Invalid password");
      }
    } catch (err) {
      setError("Server error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--color-bg-base)]">
      <div className="card w-full max-w-sm !p-8 shadow-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-[12px] bg-[var(--color-brand-100)] flex items-center justify-center mb-4">
            <Lock className="text-[var(--color-brand-500)]" size={24} />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-[var(--color-text-main)]">Access CGal</h2>
          <p className="text-[14px] text-[var(--color-text-muted)] mt-2">Enter admin or guest password</p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <input
              type="password"
              className="input-capsule w-full text-center tracking-widest placeholder:tracking-normal !bg-white"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          {error && <div className="text-center text-sm text-[var(--color-danger)] font-medium">{error}</div>}
          <button type="submit" disabled={loading} className="btn-primary mt-2 w-full">
            {loading ? "Authenticating..." : "Enter"}
          </button>
        </form>
      </div>
      <div className="absolute bottom-0 inset-x-0">
        <Footer />
      </div>
    </div>
  );
}

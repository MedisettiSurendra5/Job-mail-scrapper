import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api";
import type { User } from "./api";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ user: User }>("/auth/me")
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post<{ user: User }>("/auth/login", { email, password });
    setUser(res.user);
  }

  async function signup(email: string, password: string) {
    const res = await api.post<{ user: User }>("/auth/signup", { email, password });
    setUser(res.user);
  }

  async function logout() {
    await api.post("/auth/logout");
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, signup, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

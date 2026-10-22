import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {safeLoginNext} from "@/lib/auth-redirect";
import { api } from "@/lib/api";

interface AuthUser {
  id: string;
  role: string;
}

function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser);
  const navigate = useNavigate();

  const login = useCallback(
    async (username: string, password: string, next="/projects") => {
      const data = await api.login(username, password);
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setUser(data.user);
      navigate(safeLoginNext(next),{replace:true});
    },
    [navigate]
  );

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
    navigate("/login");
  }, [navigate]);

  return { user, isAdmin: user?.role === "admin", login, logout };
}

import React, { createContext, useContext, useState, useEffect } from "react";

type Role = "admin" | "guest" | null;

interface AuthContextType {
  token: string | null;
  role: Role;
  login: (token: string, role: Role) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  role: null,
  login: () => {},
  logout: () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [token, setToken] = useState<string | null>(localStorage.getItem("app_token"));
  const [role, setRole] = useState<Role>(localStorage.getItem("app_role") as Role);

  useEffect(() => {
    if (token && role) {
      localStorage.setItem("app_token", token);
      localStorage.setItem("app_role", role);
    } else {
      localStorage.removeItem("app_token");
      localStorage.removeItem("app_role");
    }
  }, [token, role]);

  const login = (newToken: string, newRole: Role) => {
    setToken(newToken);
    setRole(newRole);
  };
  
  const logout = () => {
    setToken(null);
    setRole(null);
  };

  return (
    <AuthContext.Provider value={{ token, role, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

import type { Request } from "express";

export interface User {
  id: string;
  password_hash: string;
  role: "admin" | "user";
  created_at: string;
}

export interface JwtPayload {
  userId: string;
  role: "admin" | "user";
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

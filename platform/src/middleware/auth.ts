import type { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { AuthRequest, JwtPayload } from "../types.js";
import { findUserById } from "../services/db.js";

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    const user = findUserById(decoded.userId);
    if (!user) { res.status(401).json({ error: "User no longer exists" }); return; }
    req.user = { userId: user.id, role: user.role as JwtPayload["role"] };
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

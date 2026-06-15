import { Router, type Router as RouterType } from "express";
import bcrypt from "bcryptjs";
import { findUserById, updatePassword } from "../services/db.js";
import { signToken, authenticate } from "../middleware/auth.js";
import type { AuthRequest } from "../types.js";

const router: RouterType = Router();

router.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  const user = findUserById(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = signToken({ userId: user.id, role: user.role as "admin" | "user" });
  res.json({
    token,
    user: { id: user.id, role: user.role },
  });
});

router.post("/change-password", authenticate, (req, res) => {
  const authReq = req as AuthRequest;
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    res.status(400).json({ error: "Old password and new password required" });
    return;
  }

  if (newPassword.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  const user = findUserById(authReq.user!.userId);
  if (!user || !bcrypt.compareSync(oldPassword, user.password_hash)) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  updatePassword(user.id, hash);
  res.json({ message: "Password updated" });
});

export default router;

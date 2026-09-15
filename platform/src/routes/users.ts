import { Router, type Router as RouterType } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { listUsers, createUser, deleteUser, findUserById, updatePassword } from "../services/db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";

const router: RouterType = Router();

router.use(authenticate, requireAdmin);

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let password = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}

router.get("/", (_req, res) => {
  const users = listUsers();
  res.json(users);
});

router.post("/", (req, res) => {
  const { id } = req.body;
  if (!id || typeof id !== "string" || id.trim().length === 0) {
    res.status(400).json({ error: "User ID is required" });
    return;
  }

  const existing = findUserById(id.trim());
  if (existing) {
    res.status(409).json({ error: "User already exists" });
    return;
  }

  const password = generatePassword();
  const hash = bcrypt.hashSync(password, 10);
  createUser(id.trim(), hash);

  res.status(201).json({ id: id.trim(), password });
});

router.delete("/:id", (req, res) => {
  const { id } = req.params;
  const user = findUserById(id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.role === "admin") {
    res.status(400).json({ error: "Cannot delete admin user" });
    return;
  }

  deleteUser(id);
  res.json({ message: "User deleted" });
});

router.post("/:id/reset-password", (req, res) => {
  const { id } = req.params;
  const user = findUserById(id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const password = generatePassword();
  const hash = bcrypt.hashSync(password, 10);
  updatePassword(id, hash);

  res.json({ id, password });
});

export default router;

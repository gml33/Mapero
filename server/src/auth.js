import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from './db.js';

const ROUNDS = 10;

/** Crea un usuario y devuelve { token, username }. */
export async function register(username, password) {
  const name = String(username).trim().slice(0, 30);
  if (!name || !password || password.length < 3) {
    const e = new Error('Usuario o contraseña inválidos');
    e.status = 400;
    throw e;
  }
  const hash = await bcrypt.hash(password, ROUNDS);
  let user;
  try {
    const r = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [name, hash]);
    user = r.rows[0];
  } catch (e) {
    if (e.code === '23505') {
      const err = new Error('El usuario ya existe');
      err.status = 409;
      throw err;
    }
    throw e;
  }
  return createSession(user);
}

/** Valida credenciales y devuelve { token, username }. */
export async function login(username, password) {
  const name = String(username).trim();
  const r = await pool.query(
    'SELECT id, username, password_hash FROM users WHERE username = $1', [name]);
  const user = r.rows[0];
  if (!user) {
    const e = new Error('Credenciales inválidas');
    e.status = 401;
    throw e;
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    const e = new Error('Credenciales inválidas');
    e.status = 401;
    throw e;
  }
  return createSession({ id: user.id, username: user.username });
}

async function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, user.id]);
  return { token, username: user.username };
}

/** Middleware: valida el Bearer token y adjunta req.user = { id, username }. */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Falta token' });
    }
    const r = await pool.query(
      `SELECT u.id, u.username, u.role FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = $1`, [token]);
    if (!r.rows[0]) {
      return res.status(401).json({ error: 'Token inválido' });
    }
    req.user = r.rows[0];
    next();
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
}

/** Crea un usuario con rol (uso desde el panel admin). */
export async function createUser(username, password, role = 'user') {
  const name = String(username).trim().slice(0, 30);
  if (!name || !password || password.length < 3) {
    const e = new Error('Usuario o contraseña inválidos');
    e.status = 400;
    throw e;
  }
  const hash = await bcrypt.hash(password, ROUNDS);
  try {
    const r = await pool.query(
      `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)
       RETURNING id, username, role`, [name, hash, role]);
    return r.rows[0];
  } catch (e) {
    if (e.code === '23505') {
      const err = new Error('El usuario ya existe');
      err.status = 409;
      throw err;
    }
    throw e;
  }
}

/** Cambia el rol de un usuario. */
export async function setUserRole(id, role) {
  await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
}

/** Cambia la contraseña de un usuario. */
export async function setUserPassword(id, password) {
  if (!password || password.length < 3) {
    const e = new Error('Contraseña demasiado corta');
    e.status = 400;
    throw e;
  }
  const hash = await bcrypt.hash(password, ROUNDS);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
}

/** Middleware: requiere sesión válida y rol de administrador. */
export async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (req.user && req.user.role === 'admin') {
      next();
    } else {
      res.status(403).json({ error: 'No autorizado' });
    }
  });
}

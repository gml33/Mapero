import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from './db.js';

const ROUNDS = 10;
// Una contraseña de 3 caracteres no resiste fuerza bruta. 8 es el mínimo
// razonable sin molestar al usuario de una app personal.
const MIN_PASSWORD = 8;
// Duración de una sesión: 30 días. Pasado ese plazo el token deja de servir.
const SESSION_DAYS = 30;

/** Longitud mínima de contraseña. */
export function minPassword() {
  return MIN_PASSWORD;
}

/** Crea un usuario y devuelve { token, username }. */
export async function register(username, password) {
  const name = String(username).trim().slice(0, 30);
  if (!name || !password || password.length < MIN_PASSWORD) {
    const e = new Error(`Usuario o contraseña inválidos (mínimo ${MIN_PASSWORD} caracteres)`);
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
  await pool.query(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, now() + $3 * interval '1 day')`,
    [token, user.id, SESSION_DAYS]);
  return { token, username: user.username };
}

/**
 * Devuelve el usuario de un token, o null si no existe o venció.
 * La búsqueda ya exige `expires_at > now()`, así que un token pasado de plazo
 * se invalida solo.
 */
export async function userForToken(token) {
  if (!token || typeof token !== 'string') return null;
  const r = await pool.query(
    `SELECT u.id, u.username, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`, [token]);
  return r.rows[0] || null;
}

/** Cierra la sesión de un token. Devuelve cuántas se borraron. */
export async function revokeToken(token) {
  if (!token) return 0;
  const r = await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  return r.rowCount;
}

/** Token que viene en la cabecera Authorization, o null. */
export function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/**
 * Token de una conexión WebSocket. El browser no permite mandar cabeceras en un
 * WebSocket, así que el cliente lo pasa por query (?token=...).
 */
export function socketToken(req) {
  try {
    return new URL(req.url, 'http://localhost').searchParams.get('token');
  } catch {
    return null;
  }
}

/** Middleware: valida el Bearer token y adjunta req.user = { id, username, role }. */
export async function requireAuth(req, res, next) {
  try {
    const user = await userForToken(bearerToken(req));
    if (!user) {
      return res.status(401).json({ error: 'Falta token' });
    }
    req.user = user;
    next();
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
}

/** Crea un usuario con rol (uso desde el panel admin). */
export async function createUser(username, password, role = 'user') {
  const name = String(username).trim().slice(0, 30);
  if (!name || !password || password.length < MIN_PASSWORD) {
    const e = new Error(`Usuario o contraseña inválidos (mínimo ${MIN_PASSWORD} caracteres)`);
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
  if (!password || password.length < MIN_PASSWORD) {
    const e = new Error(`Contraseña demasiado corta (mínimo ${MIN_PASSWORD})`);
    e.status = 400;
    throw e;
  }
  const hash = await bcrypt.hash(password, ROUNDS);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
  // Cambiar la contraseña cierra las sesiones abiertas: si alguien la tenía
  // robada, deja de servir.
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [id]);
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

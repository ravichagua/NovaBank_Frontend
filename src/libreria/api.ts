import { Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { limpiarTokens, obtenerTokenAcceso, obtenerTokenRefresco, guardarTokens } from './tokensSeguros';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

if (!API_URL) {
  console.warn('EXPO_PUBLIC_API_URL no está configurada — revisa el archivo .env');
}

function sanitizeHeaderValue(value: string, maxLength = 60): string {
  const cleaned = value.replace(/[^\x20-\x7E]/g, '').trim();
  return (cleaned || 'Desconocido').slice(0, maxLength);
}

const DEVICE_HEADERS: Record<string, string> = {
  'X-Device-Model': sanitizeHeaderValue(
    [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || Device.deviceName || 'Desconocido'
  ),
  'X-Platform': Platform.OS,
  'X-App-Version': sanitizeHeaderValue(Constants.expoConfig?.version ?? '0.0.0', 20),
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

export class SessionExpiredError extends Error {}

export type PublicUser = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  dni: string | null;
};

type AuthResponse = { user: PublicUser; accessToken: string; refreshToken: string };

async function rawRequest(path: string, options: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...DEVICE_HEADERS, ...(options.headers ?? {}) },
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? 'Ocurrió un error inesperado', body ?? undefined);
  }
  return body;
}

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = await obtenerTokenRefresco();
      if (!refreshToken) throw new SessionExpiredError('No hay sesión activa');
      try {
        const data: AuthResponse = await rawRequest('/api/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        });
        await guardarTokens(data.accessToken, data.refreshToken);
        return data.accessToken;
      } catch (err) {
        await limpiarTokens();
        throw new SessionExpiredError('Tu sesión expiró, inicia sesión nuevamente');
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function authedRequest(path: string, options: RequestInit = {}) {
  let accessToken = await obtenerTokenAcceso();

  const attempt = (token: string | null) =>
    rawRequest(path, {
      ...options,
      headers: { ...(options.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });

  try {
    return await attempt(accessToken);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      accessToken = await refreshAccessToken();
      return attempt(accessToken);
    }
    throw err;
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

export type DniLookupResult = {
  dni: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  fullName: string;
};

export const dniApi = {
  async lookup(dni: string): Promise<DniLookupResult> {
    return rawRequest(`/api/dni/${dni}`, { method: 'GET' });
  },
};

export type FaceMatchResult = { matched: boolean; confidence: number; threshold: number };

export const verificationApi = {
  async requestRegisterOtp(email: string) {
    await rawRequest('/api/verification/otp/request', { method: 'POST', body: JSON.stringify({ email }) });
  },

  async verifyRegisterOtp(email: string, code: string) {
    await rawRequest('/api/verification/otp/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
  },

  async faceMatch(input: { dni: string; selfie: string; dniPhoto: string }): Promise<FaceMatchResult> {
    return rawRequest('/api/verification/face-match', { method: 'POST', body: JSON.stringify(input) });
  },
};

export type AccountSummary = {
  accountNumber: string;
  cci: string;
  cardNumber: string;
  cardExpiry: string;
  availableBalance: number;
  heldBalance: number;
  creditLine: number;
  cardDebt: number;
  minPayment: number;
  cutDate: string;
  cardBlocked: boolean;
  memberSince: string;
};

export const accountApi = {
  async get(): Promise<AccountSummary> {
    return authedRequest('/api/account');
  },

  async setCardBlocked(blocked: boolean): Promise<{ cardBlocked: boolean }> {
    return authedRequest('/api/account/card-block', { method: 'POST', body: JSON.stringify({ blocked }) });
  },

  async pagarTarjeta(amount: number): Promise<AccountSummary> {
    return authedRequest('/api/account/pay-card', { method: 'POST', body: JSON.stringify({ amount }) });
  },

  async revelarCvv(otpCode: string): Promise<{ cvv: string }> {
    return authedRequest('/api/account/reveal-cvv', { method: 'POST', body: JSON.stringify({ otpCode }) });
  },
};

export type ApiTransaction = {
  id: string;
  name: string;
  meta: string;
  amount: number;
  kind: 'credit' | 'debit';
  category: string;
  icon: string;
  iconBg: string;
  iconFg: string;
  createdAt: string;
};

export const transactionsApi = {
  async list(limit = 50): Promise<ApiTransaction[]> {
    const data: { items: ApiTransaction[] } = await authedRequest(`/api/transactions?limit=${limit}`);
    return data.items;
  },
};

export const profileApi = {
  async requestOtp() {
    await authedRequest('/api/profile/otp/request', { method: 'POST' });
  },

  async updateEmail(newEmail: string, otpCode: string): Promise<PublicUser> {
    const data: { user: PublicUser } = await authedRequest('/api/profile/email', {
      method: 'POST',
      body: JSON.stringify({ newEmail, otpCode }),
    });
    return data.user;
  },

  async updatePhone(newPhone: string, otpCode: string): Promise<PublicUser> {
    const data: { user: PublicUser } = await authedRequest('/api/profile/phone', {
      method: 'POST',
      body: JSON.stringify({ newPhone, otpCode }),
    });
    return data.user;
  },

  async updatePassword(currentPassword: string, newPassword: string, otpCode: string) {
    await authedRequest('/api/profile/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword, otpCode }),
    });
  },
};

export const authApi = {
  async register(input: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
    dni?: string;
    otpCode: string;
    dniPhoto?: string;
    selfie?: string;
  }) {
    const data: AuthResponse = await rawRequest('/api/auth/register', { method: 'POST', body: JSON.stringify(input) });
    await guardarTokens(data.accessToken, data.refreshToken);
    return data.user;
  },

  async iniciarSesion(input: { email: string; password: string }) {
    const data: AuthResponse = await rawRequest('/api/auth/login', { method: 'POST', body: JSON.stringify(input) });
    await guardarTokens(data.accessToken, data.refreshToken);
    return data.user;
  },

  async faceLogin(input: { email: string; selfie: string }) {
    const data: AuthResponse = await rawRequest('/api/auth/face-login', { method: 'POST', body: JSON.stringify(input) });
    await guardarTokens(data.accessToken, data.refreshToken);
    return data.user;
  },

  async me(): Promise<PublicUser> {
    return authedRequest('/api/auth/me');
  },

  async requestPasswordReset(email: string) {
    await rawRequest('/api/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email }) });
  },

  async confirmPasswordReset(input: { email: string; code: string; newPassword: string }) {
    await rawRequest('/api/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify(input) });
  },

  async cerrarSesion() {
    const refreshToken = await obtenerTokenRefresco();
    await limpiarTokens();
    if (refreshToken) {
      await rawRequest('/api/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }).catch(() => {});
    }
  },
};

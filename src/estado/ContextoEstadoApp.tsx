import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Session, Tx } from './tipos';
import { DatosDni } from '../libreria/dni';
import {
  AccountSummary,
  accountApi,
  ApiTransaction,
  ApiError,
  authApi,
  profileApi,
  PublicUser,
  transactionsApi,
  verificationApi,
  withTimeout,
} from '../libreria/api';
import { obtenerTokenAcceso, obtenerUltimoCorreo, obtenerTokenRefresco, guardarUltimaCuenta } from '../libreria/tokensSeguros';

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function formatearMiembroDesde(iso: string) {
  const fecha = new Date(iso);
  return `${MESES_ES[fecha.getMonth()]} ${fecha.getFullYear()}`;
}

function aTransaccionLocal(t: ApiTransaction): Tx {
  const creada = new Date(t.createdAt);
  const ahora = new Date();
  const inicioDelDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diasAtras = Math.round((inicioDelDia(ahora) - inicioDelDia(creada)) / 86_400_000);
  return {
    id: t.id,
    name: t.name,
    meta: t.meta,
    amount: t.amount,
    kind: t.kind,
    icon: t.icon,
    iconBg: t.iconBg,
    iconFg: t.iconFg,
    category: t.category as Tx['category'],
    daysAgo: Math.max(0, diasAtras),
    time: creada.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
  };
}

const TIEMPO_LIMITE_VERIFICACION_SESION_MS = 12_000;
const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function inicialesDe(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || 'NB'
  );
}

function aplicarUsuarioApi(u: Usuario, apiUser: PublicUser): Usuario {
  return {
    ...u,
    name: apiUser.fullName,
    iniciales: inicialesDe(apiUser.fullName),
    email: apiUser.email,
    dni: apiUser.dni ?? u.dni,
    phone: apiUser.phone ?? u.phone,
    password: '',
  };
}

type Usuario = {
  name: string;
  iniciales: string;
  email: string;
  dni: string;
  phone: string;
  password: string;
  accountNumber: string;
  cci: string;
  memberSince: string;
  cardNumber: string;
  cardExpiry: string;
};

type PropositoOtp = 'register' | 'recover' | 'edit' | null;

const usuarioPorDefecto: Usuario = {
  name: 'Ana Quispe Rojas',
  iniciales: 'AQ',
  email: 'ana.quispe@gmail.com',
  dni: '72481903',
  phone: '987214550',
  password: 'NovaBank2026',
  accountNumber: '191-7734-2201',
  cci: '002-191-00177342201-45',
  memberSince: 'marzo 2024',
  cardNumber: '4417 8820 1134 2201',
  cardExpiry: '09/29',
};

function generarOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function usarEstadoAppInterno() {
  const [ahora, setNow] = useState(Date.now());

  const [sesion, setSesion] = useState<Session>('checking');
  const [expirado, setExpirado] = useState(false);
  const [usuario, setUser] = useState<Usuario>(usuarioPorDefecto);
  const [usuarioPendiente, setPendingUser] = useState<Usuario | null>(null);

  const [disponible, setAvailable] = useState(0);
  const [retenido, setHeld] = useState(0);
  const [lineaCredito, setCreditLine] = useState(0);
  const [deudaTarjeta, setCardDebt] = useState(0);
  const [pagoMinimo, setMinPayment] = useState(0);
  const [fechaCorte, setCutDate] = useState('');
  const [cargandoCuenta, setAccountLoading] = useState(false);

  const [transacciones, setTransactions] = useState<Tx[]>([]);

  const [tarjetaBloqueada, setCardBlocked] = useState(false);

  const [intentos, setAttempts] = useState(0);
  const [bloqueadoHasta, setBlockedUntil] = useState<number | null>(null);

  const [otp, setOtp] = useState<string | null>(null);
  const [propositoOtp, setPropositoOtp] = useState<PropositoOtp>(null);
  const [otpDeadline, setOtpDeadline] = useState<number>(0);
  const [_contextoOtp, setOtpContext] = useState<any>(null);

  const [dniEscaneado, setDniEscaneado] = useState<DatosDni | null>(null);
  const [fotoFrenteDni, setFotoFrenteDni] = useState<string | null>(null);
  const [numeroFrenteDni, setNumeroFrenteDni] = useState<string | null>(null);
  const [selfiePendiente, setSelfiePendiente] = useState<string | null>(null);
  const [otpCorreoVerificado, setOtpCorreoVerificado] = useState<string | null>(null);

  const lastActivity = useRef(Date.now());
  const tocar = useCallback(() => {
    lastActivity.current = Date.now();
    if (expirado) setExpirado(false);
  }, [expirado]);

  const restaurarSesion = useCallback(async (): Promise<boolean> => {
    try {
      const [accessToken, refreshToken] = await Promise.all([obtenerTokenAcceso(), obtenerTokenRefresco()]);
      if (!accessToken && !refreshToken) {
        setSesion('out');
        return false;
      }
      const apiUser = await withTimeout(authApi.me(), TIEMPO_LIMITE_VERIFICACION_SESION_MS);
      setUser((u) => aplicarUsuarioApi(u, apiUser));
      setSesion('in');
      tocar();
      return true;
    } catch {
      setSesion('out');
      return false;
    }
  }, [tocar]);

  // Restauración silenciosa en el arranque en frío
  useEffect(() => {
    restaurarSesion();
  }, [restaurarSesion]);

  const applyAccountSummary = useCallback((summary: AccountSummary) => {
    setAvailable(summary.availableBalance);
    setHeld(summary.heldBalance);
    setCreditLine(summary.creditLine);
    setCardDebt(summary.cardDebt);
    setMinPayment(summary.minPayment);
    setCutDate(summary.cutDate);
    setCardBlocked(summary.cardBlocked);
    setUser((u) => ({
      ...u,
      accountNumber: summary.accountNumber,
      cci: summary.cci,
      cardNumber: summary.cardNumber,
      cardExpiry: summary.cardExpiry,
      memberSince: formatearMiembroDesde(summary.memberSince),
    }));
  }, []);

  const refrescarCuenta = useCallback(async () => {
    setAccountLoading(true);
    try {
      const [summary, txs] = await Promise.all([
        accountApi.get(),
        transactionsApi.list(50),
      ]);
      applyAccountSummary(summary);
      setTransactions(txs.map(aTransaccionLocal));
    } catch {
      // Se deja lo último que se cargó tal cual.
    } finally {
      setAccountLoading(false);
    }
  }, [applyAccountSummary]);

  useEffect(() => {
    if (sesion === 'in') refrescarCuenta();
  }, [sesion, refrescarCuenta]);

  // Vigilante de inactividad
  useEffect(() => {
    if (sesion !== 'in') return;
    const id = setInterval(() => {
      const idleMs = Date.now() - lastActivity.current;
      if (idleMs > 3 * 60 * 1000) {
        setExpirado(true);
        setSesion('out');
      }
    }, 5000);
    return () => clearInterval(id);
  }, [sesion]);

  const hasActiveTimer = otpDeadline > Date.now() || !!bloqueadoHasta;
  useEffect(() => {
    if (!hasActiveTimer) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasActiveTimer]);

  const tiempoBloqueoRestante = bloqueadoHasta ? Math.max(0, Math.round((bloqueadoHasta - ahora) / 1000)) : 0;
  useEffect(() => {
    if (bloqueadoHasta && tiempoBloqueoRestante === 0) {
      setBlockedUntil(null);
      setAttempts(0);
    }
  }, [tiempoBloqueoRestante, bloqueadoHasta]);

  const otpRestante = Math.max(0, Math.round((otpDeadline - ahora) / 1000));

  const iniciarOtp = useCallback((purpose: PropositoOtp, ctx?: any) => {
    const code = generarOtp();
    setOtp(code);
    setPropositoOtp(purpose);
    setOtpContext(ctx ?? null);
    setOtpDeadline(Date.now() + 60_000);
    return code;
  }, []);

  const reenviarOtp = useCallback(() => {
    const code = generarOtp();
    setOtp(code);
    setOtpDeadline(Date.now() + 60_000);
    return code;
  }, []);

  const verificarOtp = useCallback((code: string) => {
    return code.length === 6 && code === otp;
  }, [otp]);

  const iniciarRegistro = useCallback((data: { name: string; email: string; dni: string; phone: string; password: string }) => {
    const u: Usuario = {
      ...usuarioPorDefecto,
      name: data.name || usuarioPorDefecto.name,
      iniciales: inicialesDe(data.name || usuarioPorDefecto.name),
      email: data.email,
      dni: data.dni,
      phone: data.phone,
      password: data.password,
    };
    setPendingUser(u);
  }, []);

  const verificarCorreoRegistro = useCallback(async (correo: string, codigo: string): Promise<{ ok: true } | { ok: false; message: string }> => {
    try {
      await verificationApi.verifyRegisterOtp(correo, codigo);
      setOtpCorreoVerificado(codigo);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'No se pudo verificar el código. Intenta de nuevo.' };
    }
  }, []);

  const completarRegistro = useCallback(async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (!usuarioPendiente) return { ok: false, message: 'No hay un registro en curso.' };
    if (!otpCorreoVerificado) return { ok: false, message: 'Primero verifica tu correo.' };
    try {
      const apiUser = await authApi.register({
        email: usuarioPendiente.email,
        password: usuarioPendiente.password,
        fullName: usuarioPendiente.name,
        phone: usuarioPendiente.phone,
        dni: usuarioPendiente.dni,
        otpCode: otpCorreoVerificado,
        dniPhoto: fotoFrenteDni ?? undefined,
        selfie: selfiePendiente ?? undefined,
      });
      setUser(aplicarUsuarioApi(usuarioPendiente, apiUser));
      await refrescarCuenta();
      await guardarUltimaCuenta(usuarioPendiente.email, apiUser.fullName);
      setPendingUser(null);
      setFotoFrenteDni(null);
      setNumeroFrenteDni(null);
      setSelfiePendiente(null);
      setOtpCorreoVerificado(null);
      setAttempts(0);
      setBlockedUntil(null);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'No se pudo crear la cuenta. Intenta de nuevo.' };
    }
  }, [usuarioPendiente, otpCorreoVerificado, fotoFrenteDni, selfiePendiente, refrescarCuenta]);

  const iniciarSesion = useCallback(async (identifier: string, password: string) => {
    if (bloqueadoHasta && tiempoBloqueoRestante > 0) return { ok: false as const, blocked: true };

    const trimmed = identifier.trim();
    if (!RE_CORREO.test(trimmed)) {
      return { ok: false as const, blocked: false, message: 'Por ahora, ingresa con tu correo electrónico.' };
    }

    try {
      const apiUser = await authApi.iniciarSesion({ email: trimmed, password });
      setUser((u) => aplicarUsuarioApi(u, apiUser));
      await guardarUltimaCuenta(trimmed, apiUser.fullName);
      setAttempts(0);
      setSesion('in');
      tocar();
      return { ok: true as const };
    } catch (err) {
      if (err instanceof ApiError && err.status === 423) {
        const lockedUntil = typeof err.details?.lockedUntil === 'string' ? Date.parse(err.details.lockedUntil) : Date.now() + 15 * 60 * 1000;
        setBlockedUntil(lockedUntil);
        return { ok: false as const, blocked: true };
      }
      const next = intentos + 1;
      setAttempts(next);
      const message = err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor. Intenta de nuevo.';
      return { ok: false as const, blocked: false, intentos: next, message };
    }
  }, [intentos, tiempoBloqueoRestante, bloqueadoHasta, tocar]);

  const iniciarSesionConRostro = useCallback(async (selfieBase64: string) => {
    if (bloqueadoHasta && tiempoBloqueoRestante > 0) return { ok: false as const, reason: 'blocked' as const };

    const email = await obtenerUltimoCorreo();
    if (!email) {
      return { ok: false as const, reason: 'noAccount' as const, message: 'Primero inicia sesión con tu contraseña en este dispositivo.' };
    }

    try {
      const apiUser = await authApi.faceLogin({ email, selfie: selfieBase64 });
      setUser((u) => aplicarUsuarioApi(u, apiUser));
      await guardarUltimaCuenta(email, apiUser.fullName);
      setAttempts(0);
      setSesion('in');
      tocar();
      return { ok: true as const };
    } catch (err) {
      if (err instanceof ApiError && err.status === 423) {
        const lockedUntil = typeof err.details?.lockedUntil === 'string' ? Date.parse(err.details.lockedUntil) : Date.now() + 15 * 60 * 1000;
        setBlockedUntil(lockedUntil);
        return { ok: false as const, reason: 'blocked' as const };
      }
      if (err instanceof ApiError && err.status === 400) {
        return { ok: false as const, reason: 'notConfigured' as const, message: err.message };
      }
      const message = err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor. Intenta de nuevo.';
      return { ok: false as const, reason: 'noMatch' as const, message };
    }
  }, [tiempoBloqueoRestante, bloqueadoHasta, tocar]);

  const cerrarSesion = useCallback(() => {
    authApi.cerrarSesion().catch(() => {});
    setSesion('out');
    setExpirado(false);
  }, []);

  const solicitarBloqueoTarjeta = useCallback(async (next: boolean) => {
    setCardBlocked(next);
    try {
      const res = await accountApi.setCardBlocked(next);
      setCardBlocked(res.cardBlocked);
      return { ok: true as const };
    } catch (err) {
      setCardBlocked(!next);
      return { ok: false as const, message: err instanceof ApiError ? err.message : 'No se pudo actualizar la tarjeta. Intenta de nuevo.' };
    }
  }, []);

  const iniciarRecuperacion = useCallback((identifier: string) => {
    iniciarOtp('recover', { identifier });
  }, [iniciarOtp]);

  const solicitarOtpPerfil = useCallback(async () => {
    try {
      await profileApi.requestOtp();
      iniciarOtp('edit');
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, message: err instanceof ApiError ? err.message : 'No se pudo enviar el código. Intenta de nuevo.' };
    }
  }, [iniciarOtp]);

  const confirmarCambioCorreo = useCallback(async (newEmail: string, otpCode: string) => {
    try {
      const apiUser = await profileApi.updateEmail(newEmail, otpCode);
      setUser((u) => aplicarUsuarioApi(u, apiUser));
      await guardarUltimaCuenta(apiUser.email, apiUser.fullName);
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, message: err instanceof ApiError ? err.message : 'No se pudo actualizar el correo. Intenta de nuevo.' };
    }
  }, []);

  const confirmarCambioTelefono = useCallback(async (newPhone: string, otpCode: string) => {
    try {
      const apiUser = await profileApi.updatePhone(newPhone, otpCode);
      setUser((u) => aplicarUsuarioApi(u, apiUser));
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, message: err instanceof ApiError ? err.message : 'No se pudo actualizar el teléfono. Intenta de nuevo.' };
    }
  }, []);

  const cambiarContrasena = useCallback(async (currentPassword: string, newPassword: string, otpCode: string) => {
    try {
      await profileApi.updatePassword(currentPassword, newPassword, otpCode);
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, message: err instanceof ApiError ? err.message : 'No se pudo actualizar la contraseña. Intenta de nuevo.' };
    }
  }, []);

  const revelarCvv = useCallback(async (otpCode: string) => {
    try {
      const { cvv } = await accountApi.revelarCvv(otpCode);
      return { ok: true as const, cvv };
    } catch (err) {
      return { ok: false as const, message: err instanceof ApiError ? err.message : 'No se pudo verificar el código. Intenta de nuevo.' };
    }
  }, []);

  return {
    ahora, tocar,
    sesion, setSesion, expirado, setExpirado,
    usuario, usuarioPendiente, setPendingUser,
    disponible, retenido, lineaCredito, deudaTarjeta, pagoMinimo, fechaCorte, cargandoCuenta, refrescarCuenta,
    transacciones,
    tarjetaBloqueada, solicitarBloqueoTarjeta,
    intentos, bloqueadoHasta, tiempoBloqueoRestante,
    otp, propositoOtp, otpRestante, iniciarOtp, reenviarOtp, verificarOtp, setPropositoOtp,
    iniciarRegistro, completarRegistro, verificarCorreoRegistro, otpCorreoVerificado, setOtpCorreoVerificado,
    iniciarSesion, iniciarSesionConRostro, cerrarSesion, restaurarSesion,
    iniciarRecuperacion,
    solicitarOtpPerfil, confirmarCambioCorreo, confirmarCambioTelefono, cambiarContrasena,
    dniEscaneado, setDniEscaneado,
    fotoFrenteDni, setFotoFrenteDni,
    numeroFrenteDni, setNumeroFrenteDni,
    selfiePendiente, setSelfiePendiente,
    revelarCvv,
  };
}

type AppState = ReturnType<typeof usarEstadoAppInterno>;
const Ctx = createContext<AppState | null>(null);

export function ProveedorEstadoApp({ children }: { children: React.ReactNode }) {
  const value = usarEstadoAppInterno();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usarEstadoApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usarEstadoApp must be used within ProveedorEstadoApp');
  return ctx;
}

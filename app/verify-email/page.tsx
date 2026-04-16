"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";

type VerificationState = "loading" | "success" | "error" | "expired";

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-navy-50">
          <div className="w-12 h-12 rounded-full border-4 border-navy-200 border-t-brand-green animate-spin" />
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const email = searchParams.get("email");

  const [state, setState] = useState<VerificationState>("loading");
  const [message, setMessage] = useState("");
  const [resendLoading, setResendLoading] = useState(false);

  useEffect(() => {
    const verify = async () => {
      if (!token || !email) {
        setState("error");
        setMessage("Parámetros de verificación inválidos");
        return;
      }

      try {
        const response = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, email }),
        });

        const data = await response.json();

        if (data.success) {
          setState("success");
          setMessage("¡Email verificado correctamente!");

          // Auto-redirect to dashboard after 2 seconds
          setTimeout(() => {
            router.push("/dashboard");
          }, 2000);
        } else if (data.expired) {
          setState("expired");
          setMessage(
            "El enlace de verificación ha expirado. Solicita uno nuevo."
          );
        } else {
          setState("error");
          setMessage(data.message || "Error al verificar el email");
        }
      } catch (error) {
        setState("error");
        setMessage("Error de conexión. Intenta de nuevo.");
        console.error("Verification error:", error);
      }
    };

    verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, email]);

  const handleResendEmail = async () => {
    if (!email) return;

    setResendLoading(true);
    try {
      const response = await fetch("/api/auth/send-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage(
          "Email de verificación reenviado. Revisa tu bandeja de entrada."
        );
        setState("loading");
      } else {
        setMessage(data.message || "Error al reenviar el email");
        setState("error");
      }
    } catch (error) {
      setMessage("Error de conexión. Intenta de nuevo.");
      setState("error");
      console.error("Resend error:", error);
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy-50 px-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-navy-100 p-10 shadow-lg">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Logo href="/" size={36} />
        </div>

        {/* Loading state */}
        {state === "loading" && (
          <>
            <h1 className="text-2xl font-bold text-navy-900 text-center mb-4">
              Verificando email...
            </h1>
            <div className="flex justify-center mb-6">
              <div className="w-12 h-12 rounded-full border-4 border-navy-200 border-t-brand-green animate-spin" />
            </div>
            <p className="text-center text-navy-600">{message}</p>
          </>
        )}

        {/* Success state */}
        {state === "success" && (
          <>
            <div className="w-16 h-16 mx-auto rounded-full bg-brand-green/10 flex items-center justify-center text-4xl mb-6">
              ✓
            </div>
            <h1 className="text-2xl font-bold text-navy-900 text-center mb-2">
              ¡Verificado!
            </h1>
            <p className="text-center text-navy-600 mb-6">{message}</p>
            <p className="text-center text-sm text-navy-500">
              Redirigiendo al dashboard...
            </p>
          </>
        )}

        {/* Error state */}
        {state === "error" && !token && (
          <>
            <div className="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center text-3xl mb-6">
              ✕
            </div>
            <h1 className="text-2xl font-bold text-navy-900 text-center mb-2">
              Enlace inválido
            </h1>
            <p className="text-center text-navy-600 mb-6">{message}</p>
            <Link
              href="/register"
              className="block w-full py-3 rounded-xl bg-brand-green text-white font-semibold text-center hover:bg-brand-green-dark transition-colors"
            >
              Volver a registro
            </Link>
          </>
        )}

        {/* Expired state */}
        {state === "expired" && (
          <>
            <div className="w-16 h-16 mx-auto rounded-full bg-yellow-100 flex items-center justify-center text-3xl mb-6">
              ⏰
            </div>
            <h1 className="text-2xl font-bold text-navy-900 text-center mb-2">
              Enlace expirado
            </h1>
            <p className="text-center text-navy-600 mb-6">{message}</p>
            <button
              onClick={handleResendEmail}
              disabled={resendLoading}
              className="w-full py-3 rounded-xl bg-brand-green text-white font-semibold hover:bg-brand-green-dark transition-colors disabled:opacity-50 mb-3"
            >
              {resendLoading
                ? "Enviando..."
                : "Reenviar email de verificación"}
            </button>
            <Link
              href="/login"
              className="block w-full py-3 rounded-xl border-2 border-brand-green text-brand-green font-semibold text-center hover:bg-brand-green/10 transition-colors"
            >
              Ir a login
            </Link>
          </>
        )}

        {/* Generic error */}
        {state === "error" && token && (
          <>
            <div className="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center text-3xl mb-6">
              ✕
            </div>
            <h1 className="text-2xl font-bold text-navy-900 text-center mb-2">
              Error en verificación
            </h1>
            <p className="text-center text-navy-600 mb-6">{message}</p>
            <button
              onClick={handleResendEmail}
              disabled={resendLoading}
              className="w-full py-3 rounded-xl bg-brand-green text-white font-semibold hover:bg-brand-green-dark transition-colors disabled:opacity-50 mb-3"
            >
              {resendLoading
                ? "Enviando..."
                : "Reenviar email de verificación"}
            </button>
            <Link
              href="/login"
              className="block w-full py-3 rounded-xl border-2 border-brand-green text-brand-green font-semibold text-center hover:bg-brand-green/10 transition-colors"
            >
              Ir a login
            </Link>
          </>
        )}

        {/* Footer links */}
        {state !== "success" && state !== "loading" && (
          <div className="mt-6 pt-6 border-t border-navy-100 text-center">
            <p className="text-sm text-navy-600">
              ¿Necesitas ayuda?{" "}
              <a
                href="mailto:support@enlaze.es"
                className="text-brand-green font-semibold hover:underline"
              >
                Contáctanos
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

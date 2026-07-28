"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/toast";

// Muestra el aviso de "cuenta eliminada" cuando el borrado de cuenta redirige
// a la home con ?cuenta=eliminada, y limpia el parámetro de la URL.
export default function AccountDeletedNotice() {
  const { success } = useToast();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("cuenta") !== "eliminada") return;
    fired.current = true;

    success("Cuenta eliminada", {
      description:
        "Hemos borrado tu cuenta y todos tus datos de forma permanente. Gracias por haber usado Enlaze.",
      duration: 9000,
    });

    params.delete("cuenta");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (query ? `?${query}` : "")
    );
  }, [success]);

  return null;
}

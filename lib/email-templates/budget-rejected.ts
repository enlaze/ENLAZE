/**
 * Email template for Budget Rejected event
 * Sent to user when client rejects a budget
 */

export const subject = "Presupuesto rechazado";

export function getHtml(data: {
  userName: string;
  clientName: string;
  budgetAmount?: number;
  budgetId?: string;
  rejectionReason?: string;
}): string {
  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${subject}</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; background-color: #f4f7fa;">
      <div style="background-color: #f4f7fa; padding: 40px 20px; display: flex; justify-content: center; align-items: center; min-height: 100vh;">
        <div style="background: white; border-radius: 16px; max-width: 600px; width: 100%; padding: 40px; box-shadow: 0 2px 8px rgba(10, 25, 41, 0.08); border: 1px solid #e8eef4;">

          <!-- Header -->
          <div style="text-align: center; margin-bottom: 40px;">
            <div style="display: inline-block; background: #0f2744; border-radius: 12px; padding: 8px 16px; margin-bottom: 24px;">
              <span style="color: #00c896; font-weight: bold; font-size: 20px;">Enlaze</span>
            </div>
            <h1 style="color: #d32f2f; font-size: 28px; font-weight: 700; margin: 0; margin-bottom: 8px;">❌ Presupuesto rechazado</h1>
            <p style="color: #5a7185; font-size: 16px; margin: 0;">El cliente ha rechazado tu presupuesto</p>
          </div>

          <!-- Main content -->
          <div style="color: #3b5068; line-height: 1.6; margin-bottom: 32px;">
            <p style="font-size: 16px; margin: 0 0 16px 0;">¡Hola ${data.userName}!</p>
            <p style="font-size: 16px; margin: 0 0 24px 0;"><strong>${data.clientName}</strong> ha rechazado el presupuesto en <strong>Enlaze</strong>.</p>
          </div>

          <!-- Rejection card -->
          <div style="background: #ffebee; border-left: 4px solid #d32f2f; border-radius: 12px; padding: 20px; margin-bottom: 32px;">
            <p style="color: #d32f2f; font-size: 14px; font-weight: 600; margin: 0 0 8px 0;">✕ Estado: RECHAZADO</p>
            <p style="color: #0a1929; font-size: 18px; font-weight: 600; margin: 0 0 16px 0;">${data.clientName}</p>
            ${data.budgetAmount ? `
              <p style="color: #8899a8; font-size: 12px; margin: 0 0 8px 0; text-transform: uppercase; font-weight: 600;">Importe</p>
              <p style="color: #5a7185; font-size: 20px; font-weight: 700; margin: 0;">€${data.budgetAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            ` : ''}
            ${data.rejectionReason ? `
              <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #ffcdd2;">
                <p style="color: #8899a8; font-size: 12px; margin: 0 0 8px 0; text-transform: uppercase; font-weight: 600;">Motivo</p>
                <p style="color: #5a7185; font-size: 14px; margin: 0;">${data.rejectionReason}</p>
              </div>
            ` : ''}
          </div>

          <!-- Action items -->
          <div style="background: #f9fafb; border: 1px solid #e8eef4; border-radius: 12px; padding: 20px; margin-bottom: 32px;">
            <p style="color: #0a1929; font-size: 14px; font-weight: 600; margin: 0 0 12px 0;">Recomendaciones:</p>
            <ul style="color: #5a7185; font-size: 14px; margin: 0; padding: 0 0 0 20px;">
              <li style="margin-bottom: 8px;">Contactar con el cliente para conocer sus preocupaciones</li>
              <li style="margin-bottom: 8px;">Revisar y ajustar el presupuesto si es necesario</li>
              <li>Crear una nueva propuesta revisada</li>
            </ul>
          </div>

          <!-- CTA -->
          <div style="text-align: center; margin-bottom: 32px;">
            <a href="https://enlaze.es/dashboard/budgets${data.budgetId ? `/${data.budgetId}` : ''}" style="display: inline-block; background-color: #00c896; color: white; text-decoration: none; padding: 12px 32px; border-radius: 10px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(0, 200, 150, 0.3); transition: background-color 0.2s; border: none; cursor: pointer;">
              Ver presupuesto
            </a>
          </div>

          <!-- Footer -->
          <div style="border-top: 1px solid #e8eef4; padding-top: 24px; text-align: center;">
            <p style="color: #8899a8; font-size: 12px; margin: 0;">
              © 2024 Enlaze. Todos los derechos reservados.<br>
              <a href="https://enlaze.es" style="color: #00c896; text-decoration: none;">enlaze.es</a>
            </p>
          </div>

        </div>
      </div>
    </body>
    </html>
  `;
}

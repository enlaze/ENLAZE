# Notification System Documentation

## Overview

The Enlaze notification system provides automated email notifications for critical business events. Built with Resend, it respects user preferences and integrates seamlessly with Supabase auth and the activity log.

**Key Features:**
- ✅ 8 professional email templates (bilingual Spanish/English design)
- ✅ User preference management (enable/disable by event type)
- ✅ Automatic activity logging
- ✅ Error handling & retry logic
- ✅ Responsive HTML design with navy/green theme
- ✅ Production-ready with TypeScript strict mode

---

## Notification Events

### 1. Client Created
**Trigger:** When a new client is added to the system
**Template:** `lib/email-templates/client-created.ts`
**Function:** `notifyClientCreated()`
**Parameters:**
- `clientName` - Name of the new client
- `clientEmail` - Email address (optional)

**Example:**
```typescript
import { notifyClientCreated } from "@/lib/notification-service";
import { createClient } from "@/lib/supabase-browser";

const supabase = createClient();
await notifyClientCreated(supabase, "Empresa XYZ", "contacto@empresa.es");
```

### 2. Budget Sent
**Trigger:** When a budget is sent to a client
**Template:** `lib/email-templates/budget-sent.ts`
**Function:** `notifyBudgetSent()`
**Parameters:**
- `clientName` - Client receiving the budget
- `budgetAmount` - Budget amount in EUR (optional)
- `budgetId` - ID for linking to dashboard (optional)

### 3. Budget Accepted
**Trigger:** When a client accepts a budget
**Template:** `lib/email-templates/budget-accepted.ts`
**Function:** `notifyBudgetAccepted()`
**Parameters:**
- `clientName` - Client who accepted
- `budgetAmount` - Amount (optional)
- `budgetId` - Budget ID (optional)

### 4. Budget Rejected
**Trigger:** When a client rejects a budget
**Template:** `lib/email-templates/budget-rejected.ts`
**Function:** `notifyBudgetRejected()`
**Parameters:**
- `clientName` - Client who rejected
- `budgetAmount` - Amount (optional)
- `budgetId` - Budget ID (optional)
- `rejectionReason` - Reason for rejection (optional)

### 5. Invoice Paid
**Trigger:** When an invoice is marked as paid
**Template:** `lib/email-templates/invoice-paid.ts`
**Function:** `notifyInvoicePaid()`
**Parameters:**
- `clientName` - Client who paid
- `invoiceAmount` - Amount paid (optional)
- `invoiceId` - Invoice ID (optional)
- `invoiceNumber` - Invoice number (optional)

### 6. Supplier Added
**Trigger:** When a new supplier is registered
**Template:** `lib/email-templates/supplier-added.ts`
**Function:** `notifySupplierAdded()`
**Parameters:**
- `supplierName` - Name of supplier
- `supplierEmail` - Email (optional)
- `category` - Supplier category (optional)

### 7. Project Created
**Trigger:** When a new project/obra is created
**Template:** `lib/email-templates/project-created.ts`
**Function:** `notifyProjectCreated()`
**Parameters:**
- `projectName` - Name of project
- `clientName` - Associated client (optional)
- `projectId` - Project ID (optional)
- `startDate` - Project start date (optional)

### 8. Order Created
**Trigger:** When an order is sent to a supplier
**Template:** `lib/email-templates/order-created.ts`
**Function:** `notifyOrderCreated()`
**Parameters:**
- `supplierName` - Supplier name
- `orderAmount` - Order amount (optional)
- `orderId` - Order ID (optional)
- `orderNumber` - Order number (optional)

---

## API Reference

### Send Notification (Manual Trigger)
```
POST /api/notifications/send
Authorization: Bearer <user_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "event": "client_created",
  "data": {
    "clientName": "Empresa ABC",
    "clientEmail": "info@empresa.es"
  }
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "msg_1a2b3c..."
}
```

**Supported Events:**
- `client_created`
- `budget_sent`
- `budget_accepted`
- `budget_rejected`
- `invoice_paid`
- `supplier_added`
- `project_created`
- `order_created`

### Get User Preferences
```
GET /api/notifications/preferences
Authorization: Bearer <user_token>
```

**Response:**
```json
{
  "success": true,
  "preferences": {
    "client_created": true,
    "budget_sent": true,
    "budget_accepted": true,
    "budget_rejected": false,
    "invoice_paid": true,
    "supplier_added": true,
    "project_created": true,
    "order_created": true
  }
}
```

### Update User Preferences
```
POST /api/notifications/preferences
Authorization: Bearer <user_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "emailNotifications": {
    "client_created": true,
    "budget_sent": true,
    "budget_accepted": true,
    "budget_rejected": false,
    "invoice_paid": true,
    "supplier_added": true,
    "project_created": true,
    "order_created": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Preferencias guardadas correctamente",
  "preferences": {
    "client_created": true,
    ...
  }
}
```

---

## Integration Guide

### Step 1: Import the notification function
```typescript
import { notifyClientCreated } from "@/lib/notification-service";
```

### Step 2: Get Supabase client
```typescript
// In server components/routes
import { createClient } from "@/lib/supabase-server";
const supabase = await createClient();

// In client components
import { createClient } from "@/lib/supabase-browser";
const supabase = createClient();
```

### Step 3: Call the notification function
```typescript
const result = await notifyClientCreated(
  supabase,
  "Empresa XYZ",
  "contacto@empresa.es"
);

if (result.success) {
  console.log("Email sent:", result.messageId);
} else {
  console.error("Failed:", result.error);
}
```

### Integration Points in Enlaze

**Where to add notifications:**

1. **app/dashboard/clientes/page.tsx** (Client Created)
   ```typescript
   // After successful client creation
   // NOTIFY: Client Created
   await notifyClientCreated(supabase, newClient.name, newClient.email);
   ```

2. **Budget status change** (Budget Sent/Accepted/Rejected)
   ```typescript
   // When budget status changes
   if (newStatus === "sent") {
     // NOTIFY: Budget Sent
     await notifyBudgetSent(supabase, client.name, budget.amount, budget.id);
   }
   if (newStatus === "accepted") {
     // NOTIFY: Budget Accepted
     await notifyBudgetAccepted(supabase, client.name, budget.amount, budget.id);
   }
   if (newStatus === "rejected") {
     // NOTIFY: Budget Rejected
     await notifyBudgetRejected(supabase, client.name, budget.amount, budget.id);
   }
   ```

3. **Invoice Paid**
   ```typescript
   // When invoice status changes to paid
   // NOTIFY: Invoice Paid
   await notifyInvoicePaid(
     supabase,
     invoice.client_name,
     invoice.amount,
     invoice.id,
     invoice.number
   );
   ```

4. **Supplier Added**
   ```typescript
   // After new supplier registration
   // NOTIFY: Supplier Added
   await notifySupplierAdded(supabase, supplier.name, supplier.email, supplier.category);
   ```

5. **Project Created**
   ```typescript
   // After project creation
   // NOTIFY: Project Created
   await notifyProjectCreated(
     supabase,
     project.name,
     project.client_name,
     project.id,
     project.start_date
   );
   ```

6. **Order Created**
   ```typescript
   // After order creation
   // NOTIFY: Order Created
   await notifyOrderCreated(
     supabase,
     supplier.name,
     order.amount,
     order.id,
     order.number
   );
   ```

---

## Database Schema

### Option 1: Dedicated Table (Recommended)
```sql
CREATE TABLE notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_notifications JSONB DEFAULT '{
    "client_created": true,
    "budget_sent": true,
    "budget_accepted": true,
    "budget_rejected": false,
    "invoice_paid": true,
    "supplier_added": true,
    "project_created": true,
    "order_created": true
  }',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX notification_settings_user_id_idx ON notification_settings(user_id);
```

### Option 2: User Metadata (Fallback)
If the table doesn't exist, system automatically falls back to storing in `auth.users.user_metadata`:
```json
{
  "notification_settings": {
    "client_created": true,
    "budget_sent": true,
    ...
  }
}
```

### Activity Log Entry
All notifications are logged to `activity_log` table:
```sql
INSERT INTO activity_log (user_id, action, entity_type, metadata, created_at)
VALUES (
  'user-id',
  'notification.budget_sent',
  'notification',
  '{"clientName": "Empresa ABC", "budgetAmount": 5000, "budgetId": "budget-123"}',
  NOW()
);
```

---

## Error Handling

All notification functions follow a consistent pattern:

```typescript
interface NotificationResult {
  success: boolean;
  messageId?: string;  // Resend message ID if successful
  error?: string;      // Error message if failed
}
```

**Common Error Scenarios:**

| Error | Cause | Resolution |
|-------|-------|-----------|
| `RESEND_API_KEY no está configurado` | Missing API key | Add `RESEND_API_KEY` to `.env.local` |
| `Usuario no autenticado` | No user session | User must be logged in |
| `Usuario no tiene email configurado` | User email missing | Ensure user email in auth |
| `Error al enviar notificación` | Resend API failure | Check API key, rate limits |

**Retry Behavior:**
- Network errors: Automatically logged, manual retry recommended
- Permission errors: Checked before sending
- Rate limits: Returned as error (caller should implement backoff)

---

## Testing

### Manual Testing via API

1. **Test in development:**
```bash
# Start dev server
npm run dev

# Send test notification (replace token)
curl -X POST http://localhost:3000/api/notifications/send \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "client_created",
    "data": {
      "clientName": "Test Client",
      "clientEmail": "test@example.com"
    }
  }'
```

2. **Check Resend Dashboard:**
   - Go to https://resend.com/emails
   - Verify email appears in sent list
   - Check email preview and rendering

3. **Test Preferences API:**
```bash
# Get current preferences
curl http://localhost:3000/api/notifications/preferences \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"

# Update preferences
curl -X POST http://localhost:3000/api/notifications/preferences \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "emailNotifications": {
      "budget_sent": false,
      "invoice_paid": true
    }
  }'
```

### Template Testing

Each template exports `subject` and `getHtml()`:

```typescript
import * as budgetSent from "@/lib/email-templates/budget-sent";

// Render HTML
const html = budgetSent.getHtml({
  userName: "Juan García",
  clientName: "Empresa ABC",
  budgetAmount: 5000,
  budgetId: "budget-123"
});

console.log(budgetSent.subject); // "Presupuesto enviado"
```

---

## Troubleshooting

### Email not sending
1. Check RESEND_API_KEY is set in `.env.local`
2. Verify user is authenticated
3. Check user has email in profile
4. Review error returned in NotificationResult
5. Check Resend dashboard for rate limits

### Email looks broken
1. Template imports may have issues
2. Check Node version (recommend 18+)
3. Verify Resend API compatibility
4. Test in multiple email clients

### Preferences not saving
1. Ensure notification_settings table exists
2. Check user_id is correct
3. Verify Supabase permissions allow insert/update
4. Check database connection in Supabase dashboard

### Activity log not recording
1. Verify activity_log table exists
2. Check user_id is valid
3. Review database errors in console

---

## Configuration

### Environment Variables

```bash
# Required
RESEND_API_KEY=re_...

# Optional (defaults to noreply@enlaze.es)
RESEND_FROM_EMAIL=noreply@enlaze.es

# Supabase (required for all features)
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

### Email Addresses
- **From:** `noreply@enlaze.es` (or RESEND_FROM_EMAIL)
- **Reply-To:** `support@enlaze.es`

---

## Performance

- **Async by default:** All notification functions are fire-and-forget
- **No blocking:** Notifications don't block user actions
- **Batch friendly:** Can be called multiple times in succession
- **Rate limits:** Resend has generous free tier (100/day)

---

## Future Enhancements

Potential features for expansion:
- [ ] SMS notifications via Twilio
- [ ] In-app toast notifications (already exists in notifications.ts)
- [ ] Push notifications via browser API
- [ ] Email digest/summary (daily/weekly)
- [ ] Notification scheduling (send at specific times)
- [ ] Webhook notifications to external systems
- [ ] Multi-language template variants
- [ ] Template customization per user
- [ ] Attachment support (invoice PDFs, etc.)

---

## Security

- ✅ Server-side only (credentials protected)
- ✅ Requires authentication
- ✅ Activity logging for compliance
- ✅ No PII in email subjects
- ✅ Respects user preferences
- ✅ Rate limited by Resend
- ✅ No email stored in code

---

## Compliance

- GDPR: Respects notification preferences
- CCPA: Users can control email frequency
- Audit Trail: All notifications logged to activity_log
- Data Retention: Follows Supabase retention policy

---

## Support

For issues:
1. Check error message in NotificationResult
2. Review Resend dashboard status
3. Verify authentication and permissions
4. Check activity_log for previous attempts
5. Review browser/server console for errors

---

*Last Updated: 2026-04-16*
*Version: 1.0.0*

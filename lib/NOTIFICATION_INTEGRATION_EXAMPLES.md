# Notification System - Integration Examples

This document shows practical examples of how to integrate the notification system into your existing Enlaze features.

---

## Example 1: Client Created Notification

### Location: `app/dashboard/clientes/page.tsx`

**Before:**
```typescript
// Create new client
const { data: newClient, error } = await supabase
  .from("clients")
  .insert([{
    name: formData.name,
    email: formData.email,
    // ... other fields
  }])
  .select()
  .single();

if (error) {
  // handle error
  return;
}

// Show success toast
toast.success("Cliente creado exitosamente");
```

**After (with notification):**
```typescript
import { notifyClientCreated } from "@/lib/notification-service";

// Create new client
const { data: newClient, error } = await supabase
  .from("clients")
  .insert([{
    name: formData.name,
    email: formData.email,
    // ... other fields
  }])
  .select()
  .single();

if (error) {
  // handle error
  return;
}

// NOTIFY: Client Created
await notifyClientCreated(supabase, newClient.name, newClient.email);

// Show success toast
toast.success("Cliente creado exitosamente");
```

---

## Example 2: Budget Status Change Notifications

### Location: `app/dashboard/budgets/[id]/page.tsx` or API route

**Scenario:** User updates budget status

```typescript
import {
  notifyBudgetSent,
  notifyBudgetAccepted,
  notifyBudgetRejected,
} from "@/lib/notification-service";

async function updateBudgetStatus(budgetId: string, newStatus: string) {
  const { data: budget, error } = await supabase
    .from("budgets")
    .update({ status: newStatus })
    .eq("id", budgetId)
    .select()
    .single();

  if (error) {
    console.error("Failed to update budget:", error);
    return;
  }

  // Get client name for notification
  const { data: client } = await supabase
    .from("clients")
    .select("name")
    .eq("id", budget.client_id)
    .single();

  // NOTIFY: Based on status change
  if (newStatus === "sent") {
    await notifyBudgetSent(
      supabase,
      client?.name || "Cliente",
      budget.total_amount,
      budget.id
    );
  } else if (newStatus === "accepted") {
    await notifyBudgetAccepted(
      supabase,
      client?.name || "Cliente",
      budget.total_amount,
      budget.id
    );
  } else if (newStatus === "rejected") {
    await notifyBudgetRejected(
      supabase,
      client?.name || "Cliente",
      budget.total_amount,
      budget.id,
      budget.rejection_reason // if you have this field
    );
  }

  return budget;
}
```

---

## Example 3: Invoice Paid Notification

### Location: `app/dashboard/issued-invoices/[id]/page.tsx`

**Scenario:** User marks invoice as paid

```typescript
import { notifyInvoicePaid } from "@/lib/notification-service";

async function markInvoiceAsPaid(invoiceId: string) {
  const { data: invoice, error } = await supabase
    .from("issued_invoices")
    .update({
      status: "paid",
      paid_date: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .select()
    .single();

  if (error) {
    console.error("Failed to mark invoice as paid:", error);
    return;
  }

  // Get client info
  const { data: client } = await supabase
    .from("clients")
    .select("name")
    .eq("id", invoice.client_id)
    .single();

  // NOTIFY: Invoice Paid
  await notifyInvoicePaid(
    supabase,
    client?.name || "Cliente",
    invoice.total_amount,
    invoice.id,
    invoice.invoice_number
  );

  toast.success("Factura marcada como pagada");
  return invoice;
}
```

---

## Example 4: Supplier Added Notification

### Location: `app/dashboard/suppliers/page.tsx`

**Scenario:** User adds new supplier

```typescript
import { notifySupplierAdded } from "@/lib/notification-service";

async function addSupplier(formData: SupplierFormData) {
  const { data: newSupplier, error } = await supabase
    .from("suppliers")
    .insert([{
      name: formData.name,
      email: formData.email,
      category: formData.category,
      // ... other fields
    }])
    .select()
    .single();

  if (error) {
    console.error("Failed to add supplier:", error);
    return;
  }

  // NOTIFY: Supplier Added
  await notifySupplierAdded(
    supabase,
    newSupplier.name,
    newSupplier.email,
    newSupplier.category
  );

  toast.success("Proveedor registrado exitosamente");
  return newSupplier;
}
```

---

## Example 5: Project Created Notification

### Location: `app/dashboard/projects/page.tsx`

**Scenario:** User creates new project/obra

```typescript
import { notifyProjectCreated } from "@/lib/notification-service";

async function createProject(formData: ProjectFormData) {
  const { data: newProject, error } = await supabase
    .from("projects")
    .insert([{
      name: formData.name,
      client_id: formData.clientId,
      start_date: formData.startDate,
      // ... other fields
    }])
    .select()
    .single();

  if (error) {
    console.error("Failed to create project:", error);
    return;
  }

  // Get client name
  const { data: client } = await supabase
    .from("clients")
    .select("name")
    .eq("id", newProject.client_id)
    .single();

  // NOTIFY: Project Created
  await notifyProjectCreated(
    supabase,
    newProject.name,
    client?.name,
    newProject.id,
    newProject.start_date
  );

  toast.success("Proyecto creado exitosamente");
  return newProject;
}
```

---

## Example 6: Order Created Notification

### Location: `app/dashboard/orders/page.tsx` or API route

**Scenario:** User creates order to supplier

```typescript
import { notifyOrderCreated } from "@/lib/notification-service";

async function createOrder(formData: OrderFormData) {
  const { data: newOrder, error } = await supabase
    .from("orders")
    .insert([{
      supplier_id: formData.supplierId,
      total_amount: formData.amount,
      order_number: formData.orderNumber,
      // ... other fields
    }])
    .select()
    .single();

  if (error) {
    console.error("Failed to create order:", error);
    return;
  }

  // Get supplier name
  const { data: supplier } = await supabase
    .from("suppliers")
    .select("name")
    .eq("id", newOrder.supplier_id)
    .single();

  // NOTIFY: Order Created
  await notifyOrderCreated(
    supabase,
    supplier?.name || "Proveedor",
    newOrder.total_amount,
    newOrder.id,
    newOrder.order_number
  );

  toast.success("Pedido creado exitosamente");
  return newOrder;
}
```

---

## Example 7: Server-side Notification (API Route)

### Location: `app/api/budgets/status/route.ts`

**Scenario:** External system or webhook updates budget status

```typescript
import { createClient } from "@/lib/supabase-server";
import { notifyBudgetAccepted } from "@/lib/notification-service";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Verify auth
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { budgetId, status } = await request.json();

    // Update budget
    const { data: budget, error } = await supabase
      .from("budgets")
      .update({ status })
      .eq("id", budgetId)
      .select()
      .single();

    if (error) throw error;

    // Get client
    const { data: client } = await supabase
      .from("clients")
      .select("name")
      .eq("id", budget.client_id)
      .single();

    // NOTIFY: Conditional based on status
    if (status === "accepted") {
      const result = await notifyBudgetAccepted(
        supabase,
        client?.name || "Cliente",
        budget.total_amount,
        budget.id
      );

      if (!result.success) {
        console.warn("Notification failed:", result.error);
        // Don't fail the entire request if notification fails
      }
    }

    return Response.json({
      success: true,
      budget,
    });
  } catch (error) {
    console.error("Error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

---

## Example 8: Bulk Notification (Multiple Events)

### Location: Custom function in `lib/notification-helpers.ts`

**Scenario:** Process multiple notifications in sequence

```typescript
import { notifyInvoicePaid, notifyProjectCreated } from "@/lib/notification-service";

export async function processNewProject(
  supabase: SupabaseClient,
  projectData: any
) {
  const notifications = [];

  // NOTIFY: Project Created
  const projectResult = await notifyProjectCreated(
    supabase,
    projectData.name,
    projectData.clientName,
    projectData.id
  );
  notifications.push({
    event: "project_created",
    ...projectResult,
  });

  // If project was prepaid, also notify about payment
  if (projectData.isPrepaid) {
    const invoiceResult = await notifyInvoicePaid(
      supabase,
      projectData.clientName,
      projectData.amount,
      projectData.invoiceId
    );
    notifications.push({
      event: "invoice_paid",
      ...invoiceResult,
    });
  }

  return notifications;
}

// Usage:
const notifications = await processNewProject(supabase, newProjectData);
console.log("Sent notifications:", notifications);
```

---

## Example 9: Error Handling Pattern

**Scenario:** Handle notification failures gracefully

```typescript
import { notifyBudgetSent } from "@/lib/notification-service";

async function sendBudgetWithErrorHandling(supabase: any, budgetData: any) {
  // Update budget to sent status
  const { data: budget, error: updateError } = await supabase
    .from("budgets")
    .update({ status: "sent" })
    .eq("id", budgetData.id)
    .select()
    .single();

  if (updateError) {
    toast.error("Error al guardar presupuesto");
    return;
  }

  // Attempt to send notification
  const notifResult = await notifyBudgetSent(
    supabase,
    budgetData.clientName,
    budget.total_amount,
    budget.id
  );

  // Show user feedback based on result
  if (notifResult.success) {
    toast.success("Presupuesto enviado y notificación enviada");
  } else {
    toast.success("Presupuesto enviado (notificación fallida)");
    console.warn("Notification error:", notifResult.error);
    
    // Optionally: log to error tracking service
    // logError(notifResult.error, {
    //   component: "budgets",
    //   action: "sendBudget",
    //   budgetId: budget.id,
    // });
  }
}
```

---

## Example 10: Check User Preferences Before Showing UI

### Location: Settings page or feature flag check

```typescript
import { createClient } from "@/lib/supabase-browser";

async function checkIfNotificationsEnabled(eventType: string) {
  const supabase = createClient();

  const response = await fetch("/api/notifications/preferences", {
    method: "GET",
  });

  const { preferences } = await response.json();
  
  return preferences[eventType] === true;
}

// Usage: Show UI element only if user enabled this notification
const isBudgetNotifEnabled = await checkIfNotificationsEnabled("budget_sent");

if (isBudgetNotifEnabled) {
  // Show "Send to client" button
}
```

---

## Testing Checklist

When integrating notifications:

- [ ] Function imports correctly
- [ ] Supabase client is passed correctly
- [ ] Required parameters are provided
- [ ] Optional parameters are handled gracefully
- [ ] Error result is logged/handled
- [ ] Success toast shows (or notification log entry)
- [ ] Check email arrived in test inbox
- [ ] Email renders correctly
- [ ] Links in email work
- [ ] Test with notifications disabled in preferences
- [ ] Verify activity log entry created

---

## Quick Reference

```typescript
// All import in one place
import {
  notifyClientCreated,
  notifyBudgetSent,
  notifyBudgetAccepted,
  notifyBudgetRejected,
  notifyInvoicePaid,
  notifySupplierAdded,
  notifyProjectCreated,
  notifyOrderCreated,
} from "@/lib/notification-service";

// Get Supabase client (client-side)
import { createClient } from "@/lib/supabase-browser";
const supabase = createClient();

// Get Supabase client (server-side)
import { createClient } from "@/lib/supabase-server";
const supabase = await createClient();

// All return same structure
interface NotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
}
```

---

*Last Updated: 2026-04-16*

# ENLAZE — Compliance Core: Plan de Implementación

## A) Modelo de datos final (12 tablas nuevas + columnas en existentes)

### Tablas nuevas

#### 1. `activity_log` — Registro de toda acción relevante
```sql
id UUID PK
user_id UUID FK → auth.users
action TEXT NOT NULL         -- 'budget.created', 'invoice.issued', 'client.deleted', etc.
entity_type TEXT             -- 'budget', 'invoice', 'client', 'project', etc.
entity_id UUID
metadata JSONB DEFAULT '{}'  -- datos extra (old_value, new_value, etc.)
ip_address INET
user_agent TEXT
created_at TIMESTAMPTZ DEFAULT now()
```

#### 2. `legal_acceptances` — Aceptación de documentos legales
```sql
id UUID PK
user_id UUID FK → auth.users
document_type TEXT NOT NULL   -- 'terms', 'privacy', 'cookies', 'dpa'
document_version TEXT NOT NULL -- 'v1.0', 'v2.0'
accepted_at TIMESTAMPTZ DEFAULT now()
ip_address INET
user_agent TEXT
```

#### 3. `marketing_consents` — Consentimiento comercial (opt-in/out)
```sql
id UUID PK
user_id UUID FK → auth.users (nullable — puede ser un client)
client_id UUID FK → clients (nullable)
consent_type TEXT NOT NULL     -- 'email_marketing', 'newsletter', 'sms'
status TEXT NOT NULL           -- 'granted', 'revoked'
granted_at TIMESTAMPTZ
revoked_at TIMESTAMPTZ
ip_address INET
user_agent TEXT
source TEXT                    -- 'onboarding', 'settings', 'portal'
created_at TIMESTAMPTZ DEFAULT now()
```

#### 4. `portal_tokens` — Tokens de acceso al portal público
```sql
id UUID PK
project_id UUID FK → projects
token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid()
label TEXT                     -- 'Cliente principal', 'Arquitecto'
permissions JSONB DEFAULT '["read"]'
is_active BOOLEAN DEFAULT true
expires_at TIMESTAMPTZ         -- NULL = no expira
last_accessed_at TIMESTAMPTZ
access_count INTEGER DEFAULT 0
created_by UUID FK → auth.users
created_at TIMESTAMPTZ DEFAULT now()
revoked_at TIMESTAMPTZ
```

#### 5. `document_versions` — Versionado de documentos importantes
```sql
id UUID PK
entity_type TEXT NOT NULL      -- 'budget', 'issued_invoice', 'project_change', 'legal_doc'
entity_id UUID
version INTEGER NOT NULL
snapshot JSONB NOT NULL         -- copia completa del estado
changed_by UUID FK → auth.users
change_summary TEXT
created_at TIMESTAMPTZ DEFAULT now()
UNIQUE(entity_type, entity_id, version)
```

#### 6. `subprocessors` — Registro de encargados del tratamiento
```sql
id UUID PK
name TEXT NOT NULL
service TEXT NOT NULL           -- 'Hosting', 'Email', 'AI', 'Pagos'
country TEXT NOT NULL
privacy_url TEXT
dpa_signed BOOLEAN DEFAULT false
added_at TIMESTAMPTZ DEFAULT now()
removed_at TIMESTAMPTZ
is_active BOOLEAN DEFAULT true
```

#### 7. `processing_activities` — Registro de actividades de tratamiento (RGPD Art.30)
```sql
id UUID PK
activity_name TEXT NOT NULL
purpose TEXT NOT NULL
legal_basis TEXT NOT NULL       -- 'consent', 'contract', 'legal_obligation', 'legitimate_interest'
data_categories TEXT[]
data_subjects TEXT[]           -- ['clients', 'employees', 'suppliers']
retention_period TEXT
security_measures TEXT
international_transfers TEXT
created_at TIMESTAMPTZ DEFAULT now()
updated_at TIMESTAMPTZ DEFAULT now()
```

#### 8. `data_subject_requests` — Solicitudes de derechos ARCO+
```sql
id UUID PK
requester_name TEXT NOT NULL
requester_email TEXT NOT NULL
request_type TEXT NOT NULL     -- 'access', 'rectification', 'erasure', 'portability', 'objection', 'restriction'
status TEXT DEFAULT 'received' -- 'received', 'in_progress', 'completed', 'denied'
description TEXT
response TEXT
received_at TIMESTAMPTZ DEFAULT now()
responded_at TIMESTAMPTZ
completed_at TIMESTAMPTZ
handled_by UUID FK → auth.users
```

#### 9. `security_incidents` — Registro de incidentes de seguridad
```sql
id UUID PK
title TEXT NOT NULL
severity TEXT NOT NULL         -- 'low', 'medium', 'high', 'critical'
description TEXT
affected_data TEXT
affected_users INTEGER DEFAULT 0
detected_at TIMESTAMPTZ DEFAULT now()
resolved_at TIMESTAMPTZ
notified_aepd BOOLEAN DEFAULT false
notified_users BOOLEAN DEFAULT false
resolution TEXT
reported_by UUID FK → auth.users
created_at TIMESTAMPTZ DEFAULT now()
```

#### 10. `ai_runs` — Registro de ejecuciones de IA
```sql
id UUID PK
user_id UUID FK → auth.users
run_type TEXT NOT NULL          -- 'budget_generation', 'ocr_invoice', 'chat'
model TEXT NOT NULL             -- 'claude-sonnet-4-20250514', etc.
prompt_version TEXT
input_hash TEXT                 -- SHA-256 del input
output_hash TEXT                -- SHA-256 del output
tokens_in INTEGER
tokens_out INTEGER
duration_ms INTEGER
human_reviewed BOOLEAN DEFAULT false
reviewed_by UUID FK → auth.users
reviewed_at TIMESTAMPTZ
entity_type TEXT                -- 'budget', 'invoice'
entity_id UUID
created_at TIMESTAMPTZ DEFAULT now()
```

#### 11. `software_versions` — Registro de versiones del software
```sql
id UUID PK
version TEXT NOT NULL UNIQUE    -- 'v1.0.0', 'v1.1.0'
release_date TIMESTAMPTZ DEFAULT now()
changelog TEXT
verifactu_certified BOOLEAN DEFAULT false
is_current BOOLEAN DEFAULT false
```

#### 12. `fiscal_events` — Eventos fiscales de facturas
```sql
id UUID PK
invoice_id UUID FK → issued_invoices
event_type TEXT NOT NULL        -- 'created', 'issued', 'hash_generated', 'xml_generated', 'sent', 'paid', 'corrected', 'cancelled'
event_data JSONB DEFAULT '{}'
software_version_id UUID FK → software_versions
created_at TIMESTAMPTZ DEFAULT now()
```

### Columnas nuevas en tablas existentes

#### `clients` (6 columnas)
- marketing_status TEXT DEFAULT 'none' -- 'none', 'opted_in', 'opted_out'
- marketing_opt_in_at TIMESTAMPTZ
- marketing_opt_out_at TIMESTAMPTZ
- marketing_source TEXT
- privacy_notice_version TEXT
- last_contacted_at TIMESTAMPTZ

#### `budgets` (7 columnas)
- version INTEGER DEFAULT 1
- sent_at TIMESTAMPTZ
- viewed_at TIMESTAMPTZ
- accepted_at TIMESTAMPTZ
- rejected_at TIMESTAMPTZ
- accepted_by_name TEXT
- accepted_ip INET

#### `projects` (4 columnas)
- started_at TIMESTAMPTZ
- completed_at TIMESTAMPTZ
- archived_at TIMESTAMPTZ
- risk_level TEXT DEFAULT 'low'

#### `project_changes` (6 columnas)
- version INTEGER DEFAULT 1
- sent_to_client_at TIMESTAMPTZ
- approved_by_name TEXT
- impact_sale_amount NUMERIC(12,2) DEFAULT 0
- impact_cost_amount NUMERIC(12,2) DEFAULT 0
- related_issued_invoice_id UUID FK → issued_invoices

#### `payments` (3 columnas)
- due_date DATE
- reference TEXT
- proof_file_path TEXT

#### `issued_invoices` (4 columnas)
- xml_version TEXT
- software_version_id UUID FK → software_versions
- correction_of_invoice_id UUID FK → issued_invoices
- cancelled_at TIMESTAMPTZ

#### `profiles` (4 columnas)
- mfa_enabled BOOLEAN DEFAULT false
- last_login_at TIMESTAMPTZ
- last_login_ip INET
- role TEXT DEFAULT 'owner'

---

## B) Orden exacto de implementación

### Fase 1 — Trazabilidad base + Legal público (prioridad máxima)
1. Migración: `activity_log`, `legal_acceptances`, `marketing_consents`
2. Migración: columnas nuevas en `clients`, `profiles`
3. Crear helper `lib/activity-log.ts` (función reutilizable `logActivity()`)
4. Crear páginas legales públicas:
   - `/legal/aviso-legal/page.tsx`
   - `/legal/privacy/page.tsx`
   - `/legal/cookies/page.tsx`
   - `/legal/terms/page.tsx`
   - `/legal/dpa/page.tsx`
   - `/legal/subprocessors/page.tsx`
   - `/security/page.tsx`
   - `/legal/layout.tsx`
5. Actualizar onboarding: separar aceptación de términos, privacidad y marketing
6. Añadir footer con links legales en landing y portal

### Fase 2 — Versionado + Portal tokens + Timeline
1. Migración: `portal_tokens`, `document_versions`
2. Migración: columnas nuevas en `budgets`, `project_changes`
3. Migrar sistema actual de `access_token` en projects a `portal_tokens`
4. Crear componente `<AcceptanceTimeline />` reutilizable
5. Integrar timeline en presupuestos y cambios/extras
6. Añadir versionado automático al guardar presupuestos y cambios

### Fase 3 — Fiscal avanzado
1. Migración: `software_versions`, `fiscal_events`
2. Migración: columnas nuevas en `issued_invoices`, `payments`
3. Crear página `/dashboard/compliance/fiscal`
4. Integrar `fiscal_events` en el flujo de facturas emitidas
5. Añadir panel de trazabilidad fiscal en issued_invoices/[id]

### Fase 4 — IA, Seguridad, Compliance dashboard
1. Migración: `ai_runs`, `security_incidents`, `subprocessors`, `processing_activities`, `data_subject_requests`
2. Migración: columnas nuevas en `projects`
3. Crear helper `lib/ai-logger.ts`
4. Integrar `ai_runs` en generate-budget y OCR
5. Crear páginas:
   - `/dashboard/compliance/page.tsx` (semáforos)
   - `/dashboard/compliance/privacy/page.tsx`
   - `/dashboard/compliance/fiscal/page.tsx`
   - `/dashboard/compliance/security/page.tsx`
   - `/dashboard/compliance/ai/page.tsx`
   - `/dashboard/compliance/contracts/page.tsx`
   - `/dashboard/compliance/incidents/page.tsx`
   - `/dashboard/audit-log/page.tsx`

---

## C) Componentes reutilizables

| Componente | Uso |
|---|---|
| `lib/activity-log.ts` | logActivity(supabase, {action, entity_type, entity_id, metadata}) |
| `lib/ai-logger.ts` | logAiRun(supabase, {run_type, model, input, output, entity}) |
| `components/AcceptanceTimeline.tsx` | Timeline visual de envío → vista → aceptación/rechazo |
| `components/ComplianceStatus.tsx` | Semáforo verde/amarillo/rojo |
| `components/LegalAcceptance.tsx` | Checkbox con guardado de versión, IP, user agent |
| `components/AuditLogTable.tsx` | Tabla paginada del activity_log |

---

## D) Archivos Next.js a crear o modificar

### Nuevos (19 archivos)
- `app/legal/layout.tsx`
- `app/legal/aviso-legal/page.tsx`
- `app/legal/privacy/page.tsx`
- `app/legal/cookies/page.tsx`
- `app/legal/terms/page.tsx`
- `app/legal/dpa/page.tsx`
- `app/legal/subprocessors/page.tsx`
- `app/security/page.tsx`
- `app/dashboard/compliance/layout.tsx`
- `app/dashboard/compliance/page.tsx`
- `app/dashboard/compliance/privacy/page.tsx`
- `app/dashboard/compliance/fiscal/page.tsx`
- `app/dashboard/compliance/security/page.tsx`
- `app/dashboard/compliance/ai/page.tsx`
- `app/dashboard/compliance/contracts/page.tsx`
- `app/dashboard/compliance/incidents/page.tsx`
- `app/dashboard/audit-log/page.tsx`
- `lib/activity-log.ts`
- `lib/ai-logger.ts`

### Modificar (8 archivos)
- `app/onboarding/page.tsx` — separar aceptación legal y marketing
- `app/dashboard/budgets/[id]/page.tsx` — añadir timeline + versionado
- `app/dashboard/projects/[id]/page.tsx` — migrar a portal_tokens + timeline en cambios
- `app/dashboard/issued-invoices/[id]/page.tsx` — fiscal_events + software_version
- `app/api/generate-budget/route.ts` — registrar ai_runs
- `app/api/invoices/ocr/route.ts` — registrar ai_runs
- `app/portal/[token]/page.tsx` — usar portal_tokens en vez de access_token directo
- `app/dashboard/layout.tsx` — añadir Compliance y Audit Log al sidebar

---

## E) Garantía de no romper el flujo actual

1. **Todas las columnas nuevas son opcionales** (DEFAULT o nullable) → no rompe datos existentes
2. **Las tablas nuevas son aditivas** → no modifican el esquema de las existentes
3. **El activity_log es fire-and-forget** → si falla, no bloquea la operación principal
4. **Los portal_tokens conviven con access_token** → migración gradual, no corte
5. **Las páginas legales son rutas nuevas** → no tocan rutas existentes
6. **El compliance dashboard es un bloque nuevo** → no modifica dashboard actual
7. **Los ai_runs se registran post-respuesta** → no afectan la latencia del usuario

---

## F) Migraciones SQL

Se aplicarán 4 migraciones en orden:
1. `compliance_phase_1` — activity_log + legal_acceptances + marketing_consents + cols en clients/profiles
2. `compliance_phase_2` — portal_tokens + document_versions + cols en budgets/project_changes
3. `compliance_phase_3` — software_versions + fiscal_events + cols en issued_invoices/payments
4. `compliance_phase_4` — ai_runs + security_incidents + subprocessors + processing_activities + data_subject_requests + cols en projects

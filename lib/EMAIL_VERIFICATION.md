# Email Verification Flow - ENLAZE

## Overview

This document describes the email verification flow implemented for ENLAZE user registration. Users must verify their email address after signup before gaining full access to the platform.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER SIGNUP FLOW                              │
└─────────────────────────────────────────────────────────────────────┘

1. User fills registration form
   ↓
2. Form submission → POST /register
   ↓
3. Supabase auth.signUp() → User account created (unverified)
   ↓
4. Trigger verification email → POST /api/auth/send-verification-email
   ├─ Generate token (email:timestamp:random)
   ├─ Build verification URL: /verify-email?token=xxx&email=yyy
   └─ Send HTML email via Resend
   ↓
5. User receives email
   ↓
6. User clicks verification link → /verify-email page
   ├─ Auto-verify token via POST /api/auth/verify-email
   └─ Update user.user_metadata.email_verified = true
   ↓
7. Redirect to dashboard (auto-redirect after 2s)
   ↓
8. Dashboard checks email_verified flag
   └─ If false: Show yellow banner with resend option
   └─ If true: Full access granted
```

## Components

### 1. Email Service (`lib/email-service.ts`)

Provides three core functions:

#### `sendVerificationEmail(options)`
- **Purpose**: Send verification email via Resend API
- **Input**: `{ email, token, verifyUrl }`
- **Output**: `{ success: boolean, messageId?: string, error?: string }`
- **Features**:
  - Professional HTML template with Enlaze branding
  - Bilingual subject (Spanish/English)
  - Navy + green color scheme
  - 24-hour token validity notice
  - Security note in email

#### `generateVerificationToken(email)`
- **Purpose**: Create and encode a verification token
- **Input**: User email string
- **Output**: `{ token: string, expiresAt: Date }`
- **Token Format**: Base64-encoded `email:timestamp:random`
- **Validity**: 24 hours from generation

#### `verifyToken(token)`
- **Purpose**: Validate and decode a verification token
- **Input**: Token string from URL
- **Output**: `{ valid: boolean, email?: string, expired?: boolean }`
- **Checks**:
  - Valid Base64 decoding
  - Token timestamp within 24 hours
  - Email extraction

### 2. API Endpoints

#### `POST /api/auth/send-verification-email`

Sends verification email after user signup.

**Request Body:**
```json
{
  "email": "user@empresa.com"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Email de verificación enviado correctamente",
  "messageId": "msg_abc123"
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Error description in Spanish"
}
```

**Status Codes:**
- `200`: Email sent successfully
- `400`: Invalid email
- `500`: Resend API error

---

#### `POST /api/auth/verify-email`

Verifies token and updates user's email_verified status.

**Request Body:**
```json
{
  "token": "base64-encoded-token",
  "email": "user@empresa.com"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Email verificado correctamente",
  "redirect": "/dashboard"
}
```

**Response (Expired Token):**
```json
{
  "success": false,
  "message": "El enlace de verificación ha expirado. Solicita uno nuevo.",
  "expired": true
}
```

**Response (Invalid Token):**
```json
{
  "success": false,
  "message": "El enlace de verificación es inválido"
}
```

**Status Codes:**
- `200`: Verification successful
- `400`: Invalid/expired token
- `404`: User not found
- `500`: Database update error

---

### 3. Pages

#### `/verify-email` (`app/verify-email/page.tsx`)

Landing page when user clicks verification link.

**URL Pattern**: `/verify-email?token=xxx&email=yyy`

**States**:
- **Loading**: Initial state while verifying token
- **Success**: Email verified, auto-redirects to `/dashboard` after 2 seconds
- **Expired**: Token expired, shows "Resend email" button
- **Error**: Invalid token or other error

**Features**:
- Automatic token verification on mount
- Auto-redirect on success
- Resend button for expired tokens
- Responsive design (mobile-first)
- Themed with navy/green colors

---

### 4. Updated Pages

#### `/register` (`app/register/page.tsx`)

**Changes**:
- After successful `auth.signUp()`, calls `POST /api/auth/send-verification-email`
- Success message now explains next steps
- Shows email address user should check
- Displays 24-hour validity notice
- Link to "Go to login" page

#### `/dashboard` (`app/dashboard/layout.tsx`)

**Changes**:
- Checks `user.user_metadata.email_verified` on component mount
- If not verified: Shows yellow warning banner
  - Icon: ⚠️
  - Message: "Email sin verificar - Revisa tu bandeja de entrada..."
  - Button: "Reenviar email de verificación"
- Banner is dismissible (clicking resend resets)
- No content restrictions (informational only)

---

## Configuration

### Environment Variables

Required in `.env.local`:

```bash
# Site URL (used for email links)
NEXT_PUBLIC_SITE_URL=http://localhost:3000
# Production: https://enlaze.es

# Resend API Key (already in .env.local)
RESEND_API_KEY=re_xxxxxxxxxxxx

# Supabase credentials (already configured)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

### Resend Configuration

The verification email is sent from: `noreply@enlaze.es`

**Note**: Currently using Resend's default domain. To use custom domain:
1. Verify domain in Resend dashboard
2. Update `from` field in `lib/email-service.ts`
3. Set up DKIM/SPF records as shown in Resend docs

---

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     USER FLOW EXAMPLE                                │
└─────────────────────────────────────────────────────────────────────┘

User: Juan García (juan@empresa.com)
Password: SecurePass123

Timeline:
─────────────────────────────────────────────────────────────────────

1. 14:30 - User submits registration form
   • Form: name=Juan García, email=juan@empresa.com, password=SecurePass123
   • Browser: POST /register (client-side form handler)

2. 14:30 - Account created in Supabase Auth
   • Supabase: User created with email_verified=false
   • user.user_metadata = { full_name: "Juan García" }

3. 14:30 - Verification email triggered
   • Browser: POST /api/auth/send-verification-email
   • Backend: Generate token "anVhbkBlbXByZXNhLmNvbToxNzE0NzU...base64"
   • Backend: Build URL: https://enlaze.es/verify-email?token=xxx&email=juan@...
   • Resend: Send HTML email from noreply@enlaze.es
   • User: Receives email "Verifica tu email en Enlaze"

4. 14:35 - User checks inbox
   • Email subject: Verifica tu email en Enlaze | Verify your email...
   • Email body: Click button or copy link
   • User: Clicks "Verificar Email" button

5. 14:35 - Verification page loads
   • Browser: Navigate to /verify-email?token=xxx&email=juan@...
   • Page: Shows loading spinner "Verificando email..."
   • Browser: Auto-runs verification check

6. 14:35 - Token verification
   • Browser: POST /api/auth/verify-email { token, email }
   • Backend: Decode token, validate timestamp (< 24h)
   • Backend: Verify email matches token
   • Backend: Update user.user_metadata.email_verified = true
   • Backend: Response: { success: true, redirect: "/dashboard" }

7. 14:35 - Success display
   • Page: Shows checkmark "¡Verificado!"
   • Page: "Email verificado correctamente"
   • Page: Auto-redirect timer (2s countdown)

8. 14:37 - Dashboard access
   • Browser: Auto-redirect to /dashboard
   • Dashboard: Loads user data
   • Dashboard: Checks email_verified = true
   • Dashboard: NO warning banner shown
   • User: Full access to all features

─────────────────────────────────────────────────────────────────────

ALTERNATIVE: Token expires (user delayed)
─────────────────────────────────────────────────────────────────────

4. 15:05 Next day (25+ hours later) - User clicks old email link
   • Browser: Navigate to /verify-email?token=xxx&email=juan@...
   • Page: Shows loading spinner

5. 15:05 - Token validation fails
   • Backend: Decode token OK, but timestamp check fails (>24h old)
   • Backend: Response: { success: false, expired: true, ... }

6. 15:05 - Expired display
   • Page: Shows hourglass icon "⏰"
   • Page: "El enlace de verificación ha expirado"
   • Button: "Reenviar email de verificación"
   • User: Clicks resend button

7. 15:05 - New email sent
   • Browser: POST /api/auth/send-verification-email
   • User: Receives new email with fresh token
   • User: Clicks new link, verification succeeds

─────────────────────────────────────────────────────────────────────

ALTERNATIVE: User never verifies (accesses dashboard anyway)
─────────────────────────────────────────────────────────────────────

1. User logs in after signup (without verifying email)
2. Dashboard loads: Checks user.user_metadata.email_verified
3. Since false: Shows YELLOW BANNER at top
   - Message: "Email sin verificar"
   - Button: "Reenviar email de verificación"
4. User can still use dashboard (no feature restrictions)
5. Banner persists until email is verified
```

---

## Troubleshooting

### Email not received

**Check:**
1. Spam/Junk folder
2. Email is spelled correctly
3. Resend API key is valid and active
4. NEXT_PUBLIC_SITE_URL is correct (used in verification link)

**Solution:**
- Use "Reenviar email de verificación" button on `/verify-email` or dashboard banner
- Check Resend dashboard for failed deliveries
- Verify sender domain has proper SPF/DKIM records

### Token expired (24-hour limit)

**Check:**
- User clicked link more than 24 hours after signup

**Solution:**
- /verify-email page detects expiry and shows resend button
- User clicks "Reenviar email" to get fresh token
- No need to sign up again

### User cannot log in

**Check:**
- Email not verified is NOT a blocking issue
- User should be able to log in even with email_verified=false
- Dashboard shows warning banner instead

**Solution:**
- Verify Supabase credentials in .env.local
- Check Supabase dashboard for account status
- Ensure user's browser accepts cookies

### Verification succeeds but no redirect

**Check:**
- Network latency causing delay
- Browser JS executing properly
- Auto-redirect is waiting 2 seconds

**Solution:**
- Manual click: "Ir a Dashboard" link appears after success
- Check browser console for errors
- Verify /dashboard route exists and is accessible

---

## Security Considerations

1. **Token Format**: Base64 is encoding, not encryption
   - Tokens are readable if intercepted
   - Always use HTTPS in production (SSL/TLS)
   - Token includes timestamp for time-based expiry

2. **Email Verification is Optional**
   - Users can access dashboard without verified email
   - This is intentional (UX: allow early access)
   - Security: Email is still verified eventually

3. **CSRF Protection**
   - Email links redirect to same domain
   - No state stored in URL beyond token/email
   - POST requests use Content-Type validation

4. **Rate Limiting**
   - Resend API has built-in rate limits
   - Consider implementing email send rate limits if abuse occurs
   - Add to `/api/auth/send-verification-email` if needed

5. **User Enumeration**
   - Verification endpoints don't leak if email exists
   - Errors are generic ("Invalid token" vs "Email not found")
   - Resend email endpoint accepts any email (standard practice)

---

## Testing

### Manual Testing Checklist

- [ ] Sign up with valid email
- [ ] Check email received verification link
- [ ] Click link and verify email
- [ ] Dashboard shows no warning banner
- [ ] Log out and log back in
- [ ] Dashboard still shows no banner after reloading

### Edge Cases

- [ ] Copy/paste old token from email address bar (expired)
- [ ] Manually navigate to `/verify-email?token=invalid&email=test@test.com`
- [ ] Sign up, resend email, click old link (fails), click new link (works)
- [ ] Use wrong email in URL query params
- [ ] Verify same email multiple times (idempotent)

### Development Commands

```bash
# Start dev server
npm run dev

# Watch for email in console (dev mode)
RESEND_API_KEY=test_key npm run dev
# Note: Use actual key from Resend dashboard

# Build for production
npm run build

# Start production server
npm run start
```

---

## Future Enhancements

1. **Email Verification Required**
   - Add flag to block dashboard access until verified
   - Implement redirect middleware in layout

2. **SMS Verification**
   - Add SMS as alternative verification method
   - Use Resend SMS or Twilio

3. **Email Templates**
   - Move HTML to separate template files
   - Support multiple languages (currently Spanish/English subject)
   - Track email analytics in Resend

4. **Admin Dashboard**
   - View unverified users
   - Manually trigger verification emails
   - Resend failed emails

5. **Rate Limiting**
   - Limit verification email sends (e.g., 3 per hour)
   - Implement cooldown timer
   - Track failed attempts

6. **Webhook Events**
   - Supabase Auth webhooks on signup
   - Trigger verification email automatically
   - Log to audit trail

---

## References

- **Resend Docs**: https://resend.com/docs
- **Supabase Auth**: https://supabase.com/docs/guides/auth
- **Next.js API Routes**: https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- **Email Best Practices**: https://www.mailmodo.com/guides/transactional-email/

---

**Last Updated**: April 16, 2024  
**Version**: 1.0  
**Status**: Production Ready

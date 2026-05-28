# NexuzAI Data Map
*Internal Engineering Document*

This document maps the flow of sensitive data within the NexuzAI ecosystem to ensure compliance and security.

## 1. Data Entities

| Entity | Description | Sensitivity | Storage Location |
| :--- | :--- | :--- | :--- |
| **User Profile** | ID, Email, Full Name | High (PII) | Supabase `public.profiles` |
| **Auth Credentials**| Email, Password (hashed) | Critical | Supabase `auth.users` |
| **Generations** | Agent ID, Prompt, Output | Medium | Supabase `public.generations` |
| **Exports** | Generated files, paths | Medium | Supabase Storage (`exports` bucket) |
| **Usage Stats** | Request counts per day | Low | Supabase `public.usage_daily` |
| **Payment Info** | Customer codes, references | Medium | Supabase `public.profiles` |

## 2. Data Flows

### A. Authentication
- **User -> Supabase Auth:** Email/Password or OAuth provider.
- **Supabase Auth -> App:** JWT (JSON Web Token) containing User ID and Role.

### B. AI Generation
- **App -> Edge Function:** Prompt + JWT.
- **Edge Function -> OpenRouter:** Prompt (anonymized, no user PII).
- **OpenRouter -> Edge Function:** AI Response.
- **Edge Function -> Supabase DB:** Saves Prompt/Output (linked to User ID).
- **Edge Function -> App:** AI Response.

### C. Payment
- **App -> Edge Function:** Request to initialize payment.
- **Edge Function -> Paystack:** Email + Amount + User ID (metadata).
- **Paystack -> App:** Redirect URL.
- **Paystack Webhook -> Edge Function:** Confirmation of payment.
- **Edge Function -> Supabase DB:** Updates user plan in `public.profiles`.

## 3. Security Controls
- **Encryption at Rest:** Handled by Supabase (AWS/GCP infrastructure).
- **Encryption in Transit:** TLS 1.3 for all API calls.
- **Authentication:** JWT-based stateless authentication.
- **Authorization:** PostgreSQL Row Level Security (RLS) enforces `auth.uid() = user_id`.
- **Validation:** Server-side validation of prompt length and request size.

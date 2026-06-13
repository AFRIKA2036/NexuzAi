import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders, json } from '../_shared/logic.ts';

const ADMIN_EMAILS = (Deno.env.get('ADMIN_EMAILS') || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

async function isAuthorizedAdmin(adminClient: any, userId: string): Promise<boolean> {
  const { data: profile } = await adminClient
    .from('profiles')
    .select('email, app_metadata')
    .eq('id', userId)
    .single();

  if (!profile) return false;

  // Check configured admin emails
  if (ADMIN_EMAILS.length > 0 && ADMIN_EMAILS.includes(profile.email?.toLowerCase())) {
    return true;
  }

  // Check app_metadata
  const meta = profile.app_metadata || {};
  if (meta.is_admin === true || meta.role === 'admin') return true;
  if (Array.isArray(meta.roles) && meta.roles.includes('admin')) return true;

  return false;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors.headers });
  }
  if (!cors.allowed) {
    return json({ error: 'Origin not allowed' }, 403, cors.headers);
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, cors.headers);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401, cors.headers);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      return json({ error: 'Service configuration missing' }, 500, cors.headers);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Verify the caller is an admin
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: authError } = await admin.auth.getUser(token);
    if (authError || !userData.user) {
      return json({ error: 'Unauthorized' }, 401, cors.headers);
    }

    const isAdmin = await isAuthorizedAdmin(admin, userData.user.id);
    if (!isAdmin) {
      return json({ error: 'Admin access required' }, 403, cors.headers);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const targetEmail = String(body.email || '').toLowerCase();

    if (!targetEmail) {
      return json({ error: 'Email is required' }, 400, cors.headers);
    }

    if (action === 'promote') {
      // Find user by email
      const { data: users, error: listError } = await admin.auth.admin.listUsers();
      if (listError) {
        return json({ error: `Failed to list users: ${listError.message}` }, 500, cors.headers);
      }

      const targetUser = users.users.find((u) => u.email?.toLowerCase() === targetEmail);
      if (!targetUser) {
        return json({ error: `User not found: ${targetEmail}` }, 404, cors.headers);
      }

      // Update app_metadata to add admin role
      const currentMeta = targetUser.app_metadata || {};
      const updatedMeta = { ...currentMeta, is_admin: true, role: 'admin' };

      const { error: updateError } = await admin.auth.admin.updateUserById(targetUser.id, {
        app_metadata: updatedMeta,
      });

      if (updateError) {
        return json({ error: `Failed to update user: ${updateError.message}` }, 500, cors.headers);
      }

      // Also update profile plan to team if not already pro/team
      const { data: profile } = await admin
        .from('profiles')
        .select('plan')
        .eq('id', targetUser.id)
        .single();

      if (profile && profile.plan === 'free') {
        await admin.from('profiles').update({ plan: 'team' }).eq('id', targetUser.id);
      }

      return json(
        { success: true, message: `Promoted ${targetEmail} to admin`, userId: targetUser.id },
        200,
        cors.headers
      );
    }

    if (action === 'demote') {
      const { data: users, error: listError } = await admin.auth.admin.listUsers();
      if (listError) {
        return json({ error: `Failed to list users: ${listError.message}` }, 500, cors.headers);
      }

      const targetUser = users.users.find((u) => u.email?.toLowerCase() === targetEmail);
      if (!targetUser) {
        return json({ error: `User not found: ${targetEmail}` }, 404, cors.headers);
      }

      // Prevent self-demotion
      if (targetUser.id === userData.user.id) {
        return json({ error: 'Cannot demote yourself' }, 400, cors.headers);
      }

      const currentMeta = targetUser.app_metadata || {};
      const updatedMeta = { ...currentMeta, is_admin: false, role: 'user' };
      delete updatedMeta.roles; // Remove roles array if present

      const { error: updateError } = await admin.auth.admin.updateUserById(targetUser.id, {
        app_metadata: updatedMeta,
      });

      if (updateError) {
        return json({ error: `Failed to update user: ${updateError.message}` }, 500, cors.headers);
      }

      return json(
        { success: true, message: `Demoted ${targetEmail} from admin`, userId: targetUser.id },
        200,
        cors.headers
      );
    }

    if (action === 'list') {
      const { data: users, error: listError } = await admin.auth.admin.listUsers();
      if (listError) {
        return json({ error: `Failed to list users: ${listError.message}` }, 500, cors.headers);
      }

      const admins = users.users
        .filter((u) => {
          const meta = u.app_metadata || {};
          return meta.is_admin === true || meta.role === 'admin' || (Array.isArray(meta.roles) && meta.roles.includes('admin'));
        })
        .map((u) => ({
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
        }));

      return json({ admins }, 200, cors.headers);
    }

    return json({ error: `Unknown action: ${action}. Use 'promote', 'demote', or 'list'` }, 400, cors.headers);
  } catch (err) {
    console.error('[ADMIN_PROMOTE] unexpected error', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: 'Unexpected server error' }, 500, cors.headers);
  }
});
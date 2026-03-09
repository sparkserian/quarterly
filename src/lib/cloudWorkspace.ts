import type { PlannerForm } from '../types';
import { requireSupabase } from './supabase';

export type WorkspaceTheme = 'light' | 'dark';

export interface CloudWorkspaceRecord {
  id: string;
  user_id: string;
  workspace_name: string;
  planner_state: PlannerForm;
  theme: WorkspaceTheme;
  created_at: string;
  updated_at: string;
  last_synced_at: string;
}

async function getSignedInUserId() {
  const client = requireSupabase();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error('You must be signed in before loading or saving a cloud workspace.');
  }

  return user.id;
}

export async function loadWorkspaceFromCloud() {
  const client = requireSupabase();
  const userId = await getSignedInUserId();
  const { data, error } = await client
    .from('finance_app_workspaces')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle<CloudWorkspaceRecord>();

  if (error) {
    throw error;
  }

  return data;
}

export async function saveWorkspaceToCloud(form: PlannerForm, theme: WorkspaceTheme) {
  const client = requireSupabase();
  const userId = await getSignedInUserId();
  const now = new Date().toISOString();
  const payload = {
    user_id: userId,
    workspace_name: form.planName,
    planner_state: form,
    theme,
    last_synced_at: now,
  };

  const { data, error } = await client
    .from('finance_app_workspaces')
    .upsert(payload, {
      onConflict: 'user_id',
    })
    .select('*')
    .single<CloudWorkspaceRecord>();

  if (error) {
    throw error;
  }

  return data;
}

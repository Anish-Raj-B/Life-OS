import { useEffect, useRef, useState } from 'react';
import { Camera, Save, Plus, Trash2, ExternalLink, UserRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { updateRow } from '@/lib/api';
import {
  Badge, Button, Card, Field, Input, LoadingBlock, PageHeader, Progress, Select, TagInput,
  Textarea, useToast,
} from '@/components/ui';
import { useCollection } from '@/hooks/useCollection';
import { initials, safeUrl } from '@/lib/utils';
import type { Goal, LearningRecord, Task } from '@/lib/types';

interface ProfileForm {
  full_name: string;
  bio: string;
  current_role: string;
  career_objective: string;
  long_term_ambition: string;
  short_term_goals: string;
  current_projects: string;
  learning_priorities: string;
  career_direction: string;
  target_achievements: string;
  github_url: string;
  leetcode_url: string;
  picoctf_url: string;
  portfolio_url: string;
  timezone: string;
  interests: string[];
  skills: string[];
  technologies: string[];
  links: { label: string; url: string }[];
}

const empty: ProfileForm = {
  full_name: '',
  bio: '',
  current_role: '',
  career_objective: '',
  long_term_ambition: '',
  short_term_goals: '',
  current_projects: '',
  learning_priorities: '',
  career_direction: '',
  target_achievements: '',
  github_url: '',
  leetcode_url: '',
  picoctf_url: '',
  portfolio_url: '',
  timezone: 'Asia/Kolkata',
  interests: [],
  skills: [],
  technologies: [],
  links: [],
};

export default function Profile() {
  const { profile, user, refresh, isAdmin, loading } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: goals } = useCollection<Goal>('goals', 'created_at', false);
  const { data: tasks } = useCollection<Task>('tasks', 'created_at', false);
  const { data: learning } = useCollection<LearningRecord>('learning_records', 'record_date', false);

  const [form, setForm] = useState<ProfileForm>(empty);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setForm({
      full_name: profile.full_name ?? '',
      bio: profile.bio ?? '',
      current_role: profile.current_role ?? '',
      career_objective: profile.career_objective ?? '',
      long_term_ambition: profile.long_term_ambition ?? '',
      short_term_goals: profile.short_term_goals ?? '',
      current_projects: profile.current_projects ?? '',
      learning_priorities: profile.learning_priorities ?? '',
      career_direction: profile.career_direction ?? '',
      target_achievements: profile.target_achievements ?? '',
      github_url: profile.github_url ?? '',
      leetcode_url: profile.leetcode_url ?? '',
      picoctf_url: profile.picoctf_url ?? '',
      portfolio_url: profile.portfolio_url ?? '',
      timezone: profile.timezone ?? 'Asia/Kolkata',
      interests: profile.interests ?? [],
      skills: profile.skills ?? [],
      technologies: profile.technologies ?? [],
      links: profile.links ?? [],
    });
  }, [profile]);

  const save = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const links = form.links
        .map((l) => ({ label: l.label.trim() || l.url, url: safeUrl(l.url) }))
        .filter((l): l is { label: string; url: string } => Boolean(l.url));
      const urlFields = { github_url: form.github_url, leetcode_url: form.leetcode_url, picoctf_url: form.picoctf_url, portfolio_url: form.portfolio_url };
      for (const [key, value] of Object.entries(urlFields)) {
        if (value && !safeUrl(value)) throw new Error(`${key.replace('_url', '')} must be a valid http(s) URL.`);
      }
      await updateRow('profiles', user.id, {
        full_name: form.full_name.trim() || null,
        bio: form.bio.trim() || null,
        current_role: form.current_role.trim() || null,
        career_objective: form.career_objective.trim() || null,
        long_term_ambition: form.long_term_ambition.trim() || null,
        short_term_goals: form.short_term_goals.trim() || null,
        current_projects: form.current_projects.trim() || null,
        learning_priorities: form.learning_priorities.trim() || null,
        career_direction: form.career_direction.trim() || null,
        target_achievements: form.target_achievements.trim() || null,
        github_url: form.github_url || null,
        leetcode_url: form.leetcode_url || null,
        picoctf_url: form.picoctf_url || null,
        portfolio_url: form.portfolio_url || null,
        timezone: form.timezone,
        interests: form.interests,
        skills: form.skills,
        technologies: form.technologies,
        links,
        onboarded: true,
      }, profile?.version);
      await refresh();
      toast.success('Profile saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the profile.');
    } finally {
      setBusy(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    if (!user) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Avatar must be under 5 MB.');
      return;
    }
    setUploading(true);
    try {
      const path = `${user.id}/avatar-${Date.now()}.${file.name.split('.').pop() ?? 'png'}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      await updateRow('profiles', user.id, { avatar_url: data.publicUrl }, profile?.version);
      await refresh();
      toast.success('Photo updated.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const activeGoals = goals.filter((g) => g.status === 'active');
  const completedTasks = tasks.filter((t) => t.status === 'completed' && !t.deleted_at).length;
  const learningDays = new Set(learning.filter((l) => !l.deleted_at).map((l) => l.record_date)).size;

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        eyebrow="Identity"
        title="Profile"
        description="Your personal context. Nothing here is public — it is visible only inside your own account."
        actions={<Button variant="primary" icon={Save} loading={busy} onClick={() => void save()}>Save profile</Button>}
      />

      {error && <p className="mb-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Card>
            <div className="flex flex-col items-center text-center">
              <div className="relative">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="h-24 w-24 rounded-2xl object-cover ring-1 ring-line" />
                ) : (
                  <span className="grid h-24 w-24 place-items-center rounded-2xl bg-accent/15 text-2xl font-semibold text-accent">
                    {initials(profile?.full_name)}
                  </span>
                )}
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border border-line bg-surface text-muted hover:text-accent"
                  aria-label="Change photo"
                >
                  <Camera size={14} className={uploading ? 'animate-pulse' : ''} />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadAvatar(file); }}
                />
              </div>
              <h2 className="mt-3 text-base font-semibold text-ink">{profile?.full_name ?? 'Unnamed'}</h2>
              <p className="text-xs text-muted">{profile?.email}</p>
              <div className="mt-2 flex flex-wrap justify-center gap-1">
                {isAdmin && <Badge tone="accent"><ShieldCheck size={9} /> administrator</Badge>}
                <Badge tone={profile?.onboarded ? 'ok' : 'warn'}>{profile?.onboarded ? 'profile complete' : 'incomplete'}</Badge>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted">{form.bio || 'No biography yet.'}</p>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line/60 pt-3 text-center">
              <div><p className="text-lg font-semibold text-ink">{completedTasks}</p><p className="text-[9px] uppercase tracking-wider text-muted">tasks done</p></div>
              <div><p className="text-lg font-semibold text-ink">{learningDays}</p><p className="text-[9px] uppercase tracking-wider text-muted">study days</p></div>
              <div><p className="text-lg font-semibold text-ink">{activeGoals.length}</p><p className="text-[9px] uppercase tracking-wider text-muted">active goals</p></div>
            </div>
          </Card>

          <Card title="Links">
            <div className="space-y-2">
              {(['github_url', 'leetcode_url', 'picoctf_url', 'portfolio_url'] as const).map((key) => (
                <Field key={key} label={key.replace('_url', '').replace('_', ' ')}>
                  <Input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder="https://…" />
                </Field>
              ))}
              {form.links.map((link, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    placeholder="Label"
                    value={link.label}
                    onChange={(e) => { const next = [...form.links]; next[index] = { ...next[index], label: e.target.value }; setForm({ ...form, links: next }); }}
                    className="max-w-[110px]"
                  />
                  <Input
                    placeholder="https://…"
                    value={link.url}
                    onChange={(e) => { const next = [...form.links]; next[index] = { ...next[index], url: e.target.value }; setForm({ ...form, links: next }); }}
                  />
                  <Button variant="ghost" onClick={() => setForm({ ...form, links: form.links.filter((_, i) => i !== index) })} aria-label="Remove link"><Trash2 size={13} /></Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setForm({ ...form, links: [...form.links, { label: '', url: '' }] })}>Add link</Button>
            </div>
            {(form.github_url || form.portfolio_url) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {[...form.links, ...(['github_url', 'portfolio_url'] as const).map((k) => ({ label: k.replace('_url', ''), url: form[k] }))]
                  .filter((l) => safeUrl(l.url))
                  .map((l, i) => (
                    <a key={i} href={safeUrl(l.url)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-accent2 hover:underline">
                      <ExternalLink size={10} /> {l.label}
                    </a>
                  ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="About you">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Full name"><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
                <Field label="Current role / education"><Input value={form.current_role} onChange={(e) => setForm({ ...form, current_role: e.target.value })} /></Field>
              </div>
              <Field label="Short biography"><Textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Career objective"><Textarea value={form.career_objective} onChange={(e) => setForm({ ...form, career_objective: e.target.value })} /></Field>
                <Field label="Long-term ambition"><Textarea value={form.long_term_ambition} onChange={(e) => setForm({ ...form, long_term_ambition: e.target.value })} /></Field>
                <Field label="Short-term goals"><Textarea value={form.short_term_goals} onChange={(e) => setForm({ ...form, short_term_goals: e.target.value })} /></Field>
                <Field label="Career direction"><Textarea value={form.career_direction} onChange={(e) => setForm({ ...form, career_direction: e.target.value })} /></Field>
                <Field label="Current projects"><Textarea value={form.current_projects} onChange={(e) => setForm({ ...form, current_projects: e.target.value })} /></Field>
                <Field label="Learning priorities"><Textarea value={form.learning_priorities} onChange={(e) => setForm({ ...form, learning_priorities: e.target.value })} /></Field>
              </div>
              <Field label="Target achievements"><Textarea value={form.target_achievements} onChange={(e) => setForm({ ...form, target_achievements: e.target.value })} /></Field>
              <Field label="Timezone" hint="Used for learning-day boundaries and reminders.">
                <Select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                  {['Asia/Kolkata', 'UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'].map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          <Card title="Skills & interests" subtitle="Comma-separated becomes individual tags">
            <div className="space-y-3">
              <Field label="Areas of interest"><TagInput value={form.interests} onChange={(interests) => setForm({ ...form, interests })} /></Field>
              <Field label="Skills"><TagInput value={form.skills} onChange={(skills) => setForm({ ...form, skills })} /></Field>
              <Field label="Technologies being learned"><TagInput value={form.technologies} onChange={(technologies) => setForm({ ...form, technologies })} /></Field>
            </div>
          </Card>

          <Card title="Active goals" subtitle="Managed on the Goals page">
            {activeGoals.length === 0 ? (
              <p className="text-xs text-muted">No active goals yet.</p>
            ) : (
              <div className="space-y-3">
                {activeGoals.map((goal) => (
                  <div key={goal.id}>
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="truncate text-ink">{goal.name}</span>
                      <span className="text-muted">{goal.progress}%</span>
                    </div>
                    <Progress value={goal.progress} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card padded={false}>
            <div className="flex items-center justify-between px-4 py-3 text-[11px] text-muted">
              <span className="flex items-center gap-1.5"><UserRound size={12} /> Profile data is private to your account.</span>
              <Button size="sm" variant="primary" icon={Save} loading={busy} onClick={() => void save()}>Save</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

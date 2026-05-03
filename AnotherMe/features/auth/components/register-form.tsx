'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth/components/auth-provider';

interface AuthResponse {
  success: boolean;
  error?: string;
}

export function RegisterForm() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorText, setErrorText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorText('');

    if (password !== confirmPassword) {
      setErrorText('两次输入的密码不一致。');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName }),
      });
      const payload = (await response.json()) as AuthResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '注册失败');
      }

      await refresh();
      router.replace('/');
      router.refresh();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '注册失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">创建账号</h1>
        <p className="text-sm text-gray-500 mt-2">注册后即可使用完整课程工作区。</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">昵称</label>
        <input
          type="text"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className="w-full h-11 px-3 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
          placeholder="你的显示名称"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">邮箱</label>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="w-full h-11 px-3 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">密码</label>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={8}
          className="w-full h-11 px-3 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
          placeholder="至少 8 位"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">确认密码</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          minLength={8}
          className="w-full h-11 px-3 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
          placeholder="再次输入密码"
        />
      </div>

      {errorText ? <p className="text-sm text-red-600">{errorText}</p> : null}

      <button
        type="submit"
        disabled={submitting}
        className="w-full h-11 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-900 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {submitting ? '注册中...' : '注册并登录'}
      </button>

      <p className="text-sm text-gray-500 text-center">
        已有账号？{' '}
        <Link href="/login" className="text-gray-900 font-medium hover:underline">
          去登录
        </Link>
      </p>
    </form>
  );
}

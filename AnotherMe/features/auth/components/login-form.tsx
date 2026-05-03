'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth/components/auth-provider';

interface AuthResponse {
  success: boolean;
  error?: string;
}

export function LoginForm() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorText, setErrorText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorText('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as AuthResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '登录失败');
      }

      await refresh();
      router.replace('/');
      router.refresh();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">欢迎回来</h1>
        <p className="text-sm text-gray-500 mt-2">登录后继续使用课堂与互动功能。</p>
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

      {errorText ? <p className="text-sm text-red-600">{errorText}</p> : null}

      <button
        type="submit"
        disabled={submitting}
        className="w-full h-11 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-900 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {submitting ? '登录中...' : '登录'}
      </button>

      <p className="text-sm text-gray-500 text-center">
        还没有账号？{' '}
        <Link href="/register" className="text-gray-900 font-medium hover:underline">
          去注册
        </Link>
      </p>
    </form>
  );
}

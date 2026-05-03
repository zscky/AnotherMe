import { redirect } from 'next/navigation';
import { LoginForm } from '@/features/auth/components/login-form';
import { getAuthenticatedUserFromCookieStore } from '@/lib/auth/session';

export const runtime = 'nodejs';

export default async function LoginPage() {
  const user = await getAuthenticatedUserFromCookieStore();
  if (user) {
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-[#F3F2EE] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <LoginForm />
      </div>
    </div>
  );
}

import { redirect } from 'next/navigation';
import { RegisterForm } from '@/features/auth/components/register-form';
import { getAuthenticatedUserFromCookieStore } from '@/lib/auth/session';

export const runtime = 'nodejs';

export default async function RegisterPage() {
  const user = await getAuthenticatedUserFromCookieStore();
  if (user) {
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-[#F3F2EE] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <RegisterForm />
      </div>
    </div>
  );
}
